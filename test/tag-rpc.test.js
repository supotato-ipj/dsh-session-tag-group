/**
 * Client→Host JSON-RPC 契约测试（票 #4 / T3，通道 `/session-tags`）。
 *
 * seam：`handleTagRpc(service, method, args)`——把连接层的 (method, args) 分派到
 * 标签服务并把结果/错误装进连接信封。T4 的分组模式持久化将复用同一通道与信封。
 *
 * 信封契约（对齐 dsh-client-connection rpcResultSchema）：
 *   成功 { ok: true, value }；失败 { ok: false, error: { code, message, details } }。
 */
import { describe, expect, it } from 'vitest';

import { handleTagRpc, serveTagRpc } from '../tag-rpc.js';
import { createTagService } from '../tag-store.js';

function makeMemoryDomain(initial) {
  let globalValue = initial ?? null;
  return {
    global: {
      get: () => globalValue,
      set: async (value) => { globalValue = value; },
    },
  };
}

async function makeService() {
  return createTagService({ domain: makeMemoryDomain(), sessionExists: async () => true });
}

/** 造一个连接层等价的 dispatch（HTTP 桥的注入 seam）。 */
async function makeDispatch() {
  const service = await makeService();
  return (method, args) => handleTagRpc(service, method, args);
}

const envelope = (rpcId, result) => JSON.stringify({ type: 'server-response', rpcId, result });

describe('serveTagRpc：HTTP 桥（连接信封语义，镜像 conn-index rpcFetchHandler）', () => {
  it('合法信封 POST → 200 + server-response 成功信封', async () => {
    const dispatch = await makeDispatch();
    const outcome = await serveTagRpc(dispatch, 'listPool', JSON.stringify({ type: 'client-request', rpcId: 'r-1', method: 'listPool', payload: {} }));
    expect(outcome.status).toBe(200);
    expect(outcome.contentType).toBe('application/json');
    expect(JSON.parse(outcome.body)).toEqual({ type: 'server-response', rpcId: 'r-1', result: { ok: true, value: { pool: [] } } });
  });

  it('业务失败也回 200 信封（ok:false + error），不靠 HTTP 状态码传业务错', async () => {
    const dispatch = await makeDispatch();
    const outcome = await serveTagRpc(dispatch, 'setSessionTags', JSON.stringify({ type: 'client-request', rpcId: 'r-2', method: 'setSessionTags', payload: { sessionId: 's1', tags: 'oops' } }));
    expect(outcome.status).toBe(200);
    const body = JSON.parse(outcome.body);
    expect(body.result.ok).toBe(false);
    expect(body.result.error.code).toBe('session-tags/invalid-args');
  });

  it('method 与端点不符 → gateway/bad-request 信封', async () => {
    const dispatch = await makeDispatch();
    const outcome = await serveTagRpc(dispatch, 'listPool', JSON.stringify({ type: 'client-request', rpcId: 'r-3', method: 'listAll', payload: {} }));
    expect(outcome.status).toBe(200);
    const body = JSON.parse(outcome.body);
    expect(body.rpcId).toBe('r-3');
    expect(body.result.error.code).toBe('gateway/bad-request');
  });

  it('信封形状不对 → rpcId=invalid-request 的 gateway/bad-request 信封', async () => {
    const dispatch = await makeDispatch();
    const outcome = await serveTagRpc(dispatch, 'listPool', JSON.stringify({ hello: 1 }));
    const body = JSON.parse(outcome.body);
    expect(body.rpcId).toBe('invalid-request');
    expect(body.result.error.code).toBe('gateway/bad-request');
  });

  it('body 不是 JSON → 400 纯文本', async () => {
    const dispatch = await makeDispatch();
    const outcome = await serveTagRpc(dispatch, 'listPool', '{oops');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toBe('body is not JSON');
  });

  it('端点形状非法（含斜杠等）→ 404，不进 dispatch', async () => {
    const dispatch = await makeDispatch();
    let called = 0;
    const spy = async (method, args) => { called += 1; return { ok: true, value: {} }; };
    const outcome = await serveTagRpc(spy, undefined, JSON.stringify({ type: 'client-request', rpcId: 'r-4', method: 'listPool', payload: {} }));
    expect(outcome.status).toBe(404);
    expect(called).toBe(0);
  });
});

describe('handleTagRpc：方法分派', () => {
  it('setSessionTags → createAndAttach → listSessionTags → listPool 全链可用', async () => {
    const service = await makeService();
    expect(await handleTagRpc(service, 'setSessionTags', { sessionId: 's1', tags: ['a'] }))
      .toEqual({ ok: true, value: { tags: ['a'], pool: ['a'] } });
    expect(await handleTagRpc(service, 'createAndAttach', { sessionId: 's1', name: 'b' }))
      .toEqual({ ok: true, value: { tag: 'b', tags: ['a', 'b'], pool: ['a', 'b'] } });
    expect(await handleTagRpc(service, 'listSessionTags', { sessionId: 's1' }))
      .toEqual({ ok: true, value: { tags: ['a', 'b'] } });
    expect(await handleTagRpc(service, 'listPool', {}))
      .toEqual({ ok: true, value: { pool: ['a', 'b'] } });
    expect(await handleTagRpc(service, 'listAll', {}))
      .toEqual({ ok: true, value: { pool: ['a', 'b'], bySession: { s1: ['a', 'b'] } } });
  });

  it('forgetSession 返回 { pruned }', async () => {
    const service = await makeService();
    await handleTagRpc(service, 'setSessionTags', { sessionId: 's1', tags: ['a'] });
    expect(await handleTagRpc(service, 'forgetSession', { sessionId: 'exists' }))
      .toEqual({ ok: true, value: { pruned: false } });
  });
});

describe('handleTagRpc：错误信封', () => {
  it('未知方法 → session-tags/unknown-method', async () => {
    const service = await makeService();
    const result = await handleTagRpc(service, 'nope', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('session-tags/unknown-method');
  });

  it('参数形状不对 → session-tags/invalid-args（缺 sessionId / tags 非数组 / name 非字符串）', async () => {
    const service = await makeService();
    expect((await handleTagRpc(service, 'setSessionTags', {})).error.code).toBe('session-tags/invalid-args');
    expect((await handleTagRpc(service, 'setSessionTags', { sessionId: 's1', tags: 'a' })).error.code).toBe('session-tags/invalid-args');
    expect((await handleTagRpc(service, 'createAndAttach', { sessionId: 's1' })).error.code).toBe('session-tags/invalid-args');
    expect((await handleTagRpc(service, 'createAndAttach', { sessionId: 's1', name: '   ' })).error.code).toBe('session-tags/invalid-args');
    expect((await handleTagRpc(service, 'listSessionTags', {})).error.code).toBe('session-tags/invalid-args');
  });

  it('服务业务错误带上原 code（session-missing 等）', async () => {
    const service = createTagService({ domain: makeMemoryDomain(), sessionExists: async () => false });
    const result = await handleTagRpc(service, 'setSessionTags', { sessionId: 'ghost', tags: ['a'] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('session-tags/session-missing');
  });

  it('意外异常兜底成 internal 信封而非向连接层抛 500', async () => {
    const service = {
      listPool() { throw new Error('boom'); },
    };
    const result = await handleTagRpc(service, 'listPool', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('session-tags/internal');
    expect(typeof result.error.message).toBe('string');
  });
});
