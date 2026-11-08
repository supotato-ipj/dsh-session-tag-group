/**
 * Host 半边（Node 侧）：标签数据服务 + `/session-tags` RPC 通道（票 #4 / T3）。
 *
 * 数据面：storage domain 全局 JSON（`session_tags` 域，tag-store.js 定义 spec 与
 * 服务逻辑），数据独立于 UI 存活——插件禁用即整 fiber 退出，盘上数据不受影响
 * （ADR-0001「UI 损坏不丢数据」；重装/重启后原样接续）。
 *
 * 通道面（Client→Host JSON RPC）：自己的 `/session-tags` prefix 路由（webServer
 * register + connection.admit 认证栅栏），信封 { ok, value|error } 由
 * handleTagRpc 装配、HTTP 层语义由 serveTagRpc 承载（均见 tag-rpc.js，契约有单测）。
 *
 * 关于 host.call 全局符号：lead 简报把它列在「Client builtins」下，但那是动态包
 * guard 门面的闭包参数（runner lib/client.js:310-337，Builtin Inspect 的口径）；
 * 静态 bundle 的工厂只拿 require（dsh-client-modules lib/client.js:819），页面
 * 全局也没有 host 符号（web shell dist 全文检索实证）。静态通道的三个候选里——
 * `ctx.connection.rpc.handle`（内部把路由挂在 connection 自身 ctx 并取
 * owner.webServer，而 connection 行没 inject webServer，外部插件调用必抛错，
 * 已实测）、`connection.fetch.register`（/api 共享通道的 exact 路由，但端点只能
 * 单段且污染 /api 命名空间，client rpc.call 的端点模式也进不去）——最终按
 * 01 笔记 §2 的本机路由通道落点：webServer.register prefix + admit 守门。
 * 详见笔记 10-t3-impl-notes.md。
 *
 * 清理面：删除会话双保险——
 * - 事件清理：`api-session/removed`（session/disposed 的转发，sc-index.js:3828-3830）
 *   → forgetSession（先经存在性谓词核实，保守不剪）；
 * - 惰性清理：每次读关联剪除不存在会话（插件停用期间的删除在下次读写兜住）。
 * 归档会话：仍在 workspace 槽位（workspaceRegistry.sessionIds），谓词判真 →
 * 关联永不剪除（spec 第 17 条）。
 */

import { createTagService, TAG_DOMAIN_SPEC } from './tag-store.js';
import { handleTagRpc, serveTagRpc, tagRpcEndpointFromPath } from './tag-rpc.js';

/** Client→Host 标签通道（CHANNEL_PATTERN ^\/[A-Za-z0-9._~-]+$ 合法）。 */
export const TAG_RPC_CHANNEL = '/session-tags';

/** 请求体上限：标签方法面的 payload 极小，1MB 已是天文数字。 */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Host 半依赖的服务（apply 内经 ctx.storageDomain / ctx.connection 访问）。 */
export const inject = ['storageDomain', 'connection'];

/**
 * 组装真实环境的会话存在性谓词。三层来源，前两层（workspace 槽位/归档集）
 * 命中即真；任何异常都按「存在」处理——宁留数据，不误剪。
 * @param {object} ctx - Host 插件上下文。
 */
export function hostSessionExists(ctx) {
  return async (sessionId) => {
    try {
      const registry = ctx.get('workspaceRegistry');
      if (registry !== undefined) {
        const archived = registry.archivedSessionIds;
        if (Array.isArray(archived) && archived.includes(sessionId)) return true;
        const workspaces = registry.list();
        if (Array.isArray(workspaces) && workspaces.some((workspace) => Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId))) {
          return true;
        }
      }
      const persistence = ctx.get('sessionPersistence');
      if (persistence !== undefined && typeof persistence.stat === 'function') {
        const stat = await persistence.stat(sessionId);
        return stat !== undefined && stat !== null;
      }
    } catch {
      return true;
    }
    // 无 workspace 槽位、无持久检查面：无法核实 → 保守视为存在。
    return true;
  };
}

/**
 * Host 插件入口。apply 允许异步（connection 的 apply 同形）。
 * @param {object} ctx - Host 插件上下文（inject：storageDomain + connection）。
 */
export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(TAG_DOMAIN_SPEC);
  // Cordis 的 ctx.effect(setup, label) 语义：setup **立即执行**，返回值才是 disposer
  // （cordis lib/index.js Fiber#effect；dsh 内置插件一律 `ctx.effect(() => xxx.register(...))`）。
  // 因此必须写成「setup 返回 teardown」——原写法 `() => domain.close()` 会在注册瞬间
  // 立刻关闭刚打开的 domain，之后 /session-tags 的每次读写都撞
  // `DomainError("closed", "domain 'session_tags' is closed")`（T3 起客户端首屏全量
  // 镜像因此一直失败）。惰性关闭：仅真正卸载时才 close。
  ctx.effect(() => () => domain.close(), 'session-tags: storage domain');

  const service = createTagService({ domain, sessionExists: hostSessionExists(ctx) });

  // RPC 路由：挂在自己的 `/session-tags` prefix 路由上，信封语义照抄连接层
  // rpcFetchHandler（serveTagRpc 纯核，有单测）。
  // 不用 `ctx.connection.rpc.handle`：它把路由登记在 connection 服务自身的 ctx
  // 上并以 owner.webServer.register 落地，而 connection 行没有 inject webServer
  // （其 /api 路由靠自己的 ctx.inject(['webServer']) 子作用域）——外部插件调用
  // 必抛 "cannot get property webServer without inject"（已实测）。认证栅栏用
  // connection.admit（同一 Host/Origin 围栏 + 浏览器 peer 判定）。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: TAG_RPC_CHANNEL,
      handler: async (req, res) => {
        const admission = ctx.connection.admit(req);
        if ('rejection' in admission) {
          res.writeHead(admission.rejection);
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const endpoint = tagRpcEndpointFromPath(TAG_RPC_CHANNEL, String(req.url ?? ''));
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_REQUEST_BODY_BYTES) { tooLarge = true; break; }
          chunks.push(chunk);
        }
        if (tooLarge) {
          res.writeHead(413);
          res.end('request body too large');
          return;
        }
        const outcome = await serveTagRpc(
          (method, args) => handleTagRpc(service, method, args),
          endpoint,
          Buffer.concat(chunks).toString('utf8'),
        );
        res.writeHead(outcome.status, { 'content-type': outcome.contentType });
        res.end(outcome.body);
      },
    }), 'session-tags: rpc route');
  });

  // 删除会话事件清理（误报由谓词守门；失败静默——惰性路径会兜住）。
  ctx.effect(
    () => ctx.on('api-session/removed', (sessionId) => {
      service.forgetSession({ sessionId }).catch(() => {});
    }),
    'session-tags: session-removed cleanup',
  );
}
