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

import { handleTagRpc } from '../tag-rpc.js';
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
