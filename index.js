/**
 * Host 半边（Node 侧）：T1 基线为最小可装载空壳。
 *
 * shadow 只发生在 Client 半（client.js 接管 `sidebar.workspaces` 槽位）；
 * Host 半当前不提供任何服务、不注入任何依赖——与内置 browser-only 插件的
 * 空壳形态一致（dsh-client-ui-sidebar lib/index.js:1-6）。
 *
 * 后续票在此落点：
 * - T3（#4）：Host 标签服务 + storage domain（defineDomain 全局 JSON）+ host.call 通道；
 * - T4（#5）：分组模式选择的 Host 侧持久化（与标签数据同域）。
 */

export function apply() {}
