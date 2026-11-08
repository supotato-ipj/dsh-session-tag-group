/**
 * Host 半生命周期回归（boot 修复）：Cordis 的 `ctx.effect(setup, label)` 会**立即执行**
 * setup，返回值（函数）才是 disposer（cordis lib/index.js Fiber#effect）。
 *
 * 原实现 `ctx.effect(() => domain.close(), ...)` 在 apply 里瞬间关闭了刚打开的
 * storage domain，导致 `/session-tags` 的每次读写都返回
 * `domain 'session_tags' is closed`（客户端首屏镜像与模式恢复因此一直失败）。
 *
 * 这里用与 Cordis 同语义的假 ctx 锁住行为：apply 结束后 domain 必须仍开放，
 * 只有真正执行 disposer 时才关闭。
 */
import { describe, expect, it } from 'vitest';

import { apply, TAG_RPC_CHANNEL } from '../index.js';

/**
 * 与 Cordis Fiber#effect 等价的假 ctx：setup 立即执行、返回值即 disposer。
 * @returns {{ctx: object, domain: object, effects: object[], routes: object[], listeners: object[]}}
 */
function makeFakeCtx() {
  const effects = [];
  const routes = [];
  const listeners = [];
  const domain = {
    opened: 0,
    closed: 0,
    spec: undefined,
    global: { get: () => null, set: async () => {} },
    close() {
      this.closed += 1;
      return Promise.resolve();
    },
  };
  const ctx = {
    storageDomain: {
      async open(spec) {
        domain.opened += 1;
        domain.spec = spec;
        return domain;
      },
    },
    effect(setup, label) {
      const dispose = setup();
      effects.push({ dispose, label });
      return dispose;
    },
    inject(_deps, callback) {
      const webCtx = {
        effect: ctx.effect,
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          },
        },
      };
      callback(webCtx);
    },
    on(event, handler) {
      listeners.push({ event, handler });
      return () => {};
    },
    get() {
      return undefined;
    },
    connection: { admit: () => ({}) },
  };
  return { ctx, domain, effects, routes, listeners };
}

describe('Host 半生命周期（storage domain）', () => {
  it('apply 期间不关闭 domain；只有 effect disposer 才触发 close', async () => {
    const { ctx, domain, effects } = makeFakeCtx();
    await apply(ctx);

    expect(domain.opened).toBe(1);
    expect(domain.spec.name).toBe('session_tags');
    expect(domain.closed).toBe(0);

    const storage = effects.find((entry) => entry.label === 'session-tags: storage domain');
    expect(storage).toBeDefined();
    expect(typeof storage.dispose).toBe('function');

    storage.dispose();
    expect(domain.closed).toBe(1);
  });

  it('注册 /session-tags prefix 路由与 session-removed 清理', async () => {
    const { ctx, routes, listeners } = makeFakeCtx();
    await apply(ctx);

    expect(routes).toHaveLength(1);
    expect(routes[0].kind).toBe('prefix');
    expect(routes[0].path).toBe(TAG_RPC_CHANNEL);
    expect(typeof routes[0].handler).toBe('function');
    expect(listeners.map((entry) => entry.event)).toContain('api-session/removed');
  });
});
