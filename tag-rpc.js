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
