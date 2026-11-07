/**
 * `/session-tags` 连接通道的分派层（票 #4 / T3）。
 *
 * Host 半把 `ctx.connection.rpc.handle('/session-tags', …)` 收到的
 * `(endpoint, payload)` 交给 `handleTagRpc`；返回值即连接信封：
 *   { ok: true, value } | { ok: false, error: { code, message, details } }。
 * 处理器内部自捕获异常——连接层对抛错只会回 500「handler failure」，客户端拿不到
 * 结构化错误码；信封化后 Client 能按 code 分支（如 session-missing 时提示刷新）。
 *
 * 方法面（T4 契约，T4 的模式持久化可在此通道追加方法，勿改已有语义）：
 *   listPool       {}                            → { pool }
 *   listSessionTags { sessionId }                → { tags }
 *   listAll        {}                            → { pool, bySession }
 *   setSessionTags  { sessionId, tags }          → { tags, pool }
 *   createAndAttach { sessionId, name }          → { tag, tags, pool }
 *   forgetSession   { sessionId }                → { pruned }
 */
import { TagServiceError } from './tag-store.js';

const CODE_PREFIX = 'session-tags';

function ok(value) {
  return { ok: true, value };
}

function fail(code, message, details = {}) {
  return { ok: false, error: { code: `${CODE_PREFIX}/${code}`, message, details } };
}

/** 参数形状校验（只管形状，语义归服务层）。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const PAYLOAD_CHECKS = {
  listPool: () => null,
  listAll: () => null,
  listSessionTags: (args) => (isNonEmptyString(args?.sessionId) ? null : '需要 sessionId'),
  setSessionTags: (args) => {
    if (!isNonEmptyString(args?.sessionId)) return '需要 sessionId';
    if (!isStringArray(args?.tags)) return '需要 tags 字符串数组';
    return null;
  },
  createAndAttach: (args) => {
    if (!isNonEmptyString(args?.sessionId)) return '需要 sessionId';
    if (typeof args?.name !== 'string') return '需要 name 字符串';
    return null;
  },
  forgetSession: (args) => (isNonEmptyString(args?.sessionId) ? null : '需要 sessionId'),
};

/**
 * 分派一个连接层调用。
 * @param {object} service - `createTagService` 的产物（或同形替身）。
 * @param {string} method - 连接端点名（= RPC method）。
 * @param {unknown} args - 连接 payload（JSON 反序列化产物；缺省为 null）。
 * @returns {Promise<{ok: true, value: object} | {ok: false, error: {code: string, message: string, details: object}}>}
 */
export async function handleTagRpc(service, method, args) {
  const check = PAYLOAD_CHECKS[method];
  if (check === undefined || typeof service?.[method] !== 'function') {
    return fail('unknown-method', `未知方法：${String(method)}`);
  }
  const problem = check(args);
  if (problem !== null) return fail('invalid-args', problem);
  try {
    return ok(await service[method](args ?? {}));
  } catch (error) {
    if (error instanceof TagServiceError) {
      return fail(error.code, error.message);
    }
    return fail('internal', error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------------------
// HTTP 桥纯核（serveTagRpc）：Host 半在自己的 `/session-tags` prefix 路由上
// 承载与连接层 rpcFetchHandler 相同的信封语义（conn-index.js:888-917）。
// 之所以不用 `ctx.connection.rpc.handle`：它把路由登记在 connection 服务自身的
// ctx 上并以 `owner.webServer.register` 落地，而 connection 行没有 inject
// webServer（其 /api 路由走的是自己的 ctx.inject(['webServer']) 子作用域）——
// 从外部插件调用必然抛 "cannot get property webServer without inject"。
// ---------------------------------------------------------------------------

const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

/** 从 URL pathname 提取端点名（语义同 conn-index endpointFromPath）。 */
export function tagRpcEndpointFromPath(channel, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(`${channel}/`)) return undefined;
  const endpoint = pathname.slice(channel.length + 1);
  if (endpoint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) return undefined;
  return endpoint;
}

/**
 * 处理一次 HTTP 层的标签 RPC 请求（I/O 已剥离：进 rawBody 字符串，出状态行）。
 * @param {(method: string, args: unknown) => Promise<object>} dispatch - 通常为
 *   `(method, args) => handleTagRpc(service, method, args)`。
 * @param {string | undefined} endpoint - URL 提取的端点名；undefined/非法 → 404。
 * @param {string} rawBody - 原始请求体。
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
export async function serveTagRpc(dispatch, endpoint, rawBody) {
  if (endpoint === undefined || !ENDPOINT_SEGMENT_PATTERN.test(endpoint)) {
    return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' };
  }
  let message;
  try {
    message = JSON.parse(rawBody);
  } catch {
    return { status: 400, contentType: 'text/plain; charset=utf-8', body: 'body is not JSON' };
  }
  const valid = message !== null && typeof message === 'object'
    && message.type === 'client-request'
    && typeof message.rpcId === 'string'
    && typeof message.method === 'string';
  if (!valid) {
    const rawId = message !== null && typeof message === 'object' && typeof message.rpcId === 'string' ? message.rpcId : 'invalid-request';
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'server-response',
        rpcId: rawId,
        result: { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } },
      }),
    };
  }
  if (message.method !== endpoint) {
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'server-response',
        rpcId: message.rpcId,
        result: { ok: false, error: { code: 'gateway/bad-request', message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: {} } },
      }),
    };
  }
  const result = await dispatch(message.method, message.payload);
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result }),
  };
}
