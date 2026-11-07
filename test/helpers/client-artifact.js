/**
 * 在 Node 里加载浏览器工件（对齐黄金样本 GTD-workbench test/helpers/client-harness.js 的做法）。
 *
 * `client.js` 是经典脚本：浏览器端由 `window.__ModuleLoader__` 收下；Node 端在带 `window`
 * 桩的 vm 上下文里跑，桩把工件截下来。本插件测试只需要 `logic`（纯逻辑层），所以
 * `require` 一律拒绝——工厂顶层不 require 任何模块，React/primitives 只在 `apply` 里解析。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadClientArtifact(clientPath) {
  const source = readFileSync(clientPath, 'utf8');
  let captured = null;
  const sandbox = {
    console,
    window: {
      __ModuleLoader__: {
        load: (artifact) => {
          captured = artifact;
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: clientPath });
  if (captured === null) throw new Error('client.js 没有向 window.__ModuleLoader__ 注册');
  return captured;
}

/**
 * 加载工件并跑工厂，拿到插件模块（含 `logic` 纯逻辑层）。
 * @param {string} clientPath - client.js 路径。
 * @returns {{ artifact: object, module: object }}
 */
export function createClientModule(clientPath) {
  const artifact = loadClientArtifact(clientPath);
  const module = artifact.factory((specifier) => {
    throw new Error('client.js 工厂顶层请求了模块：' + specifier + '（纯逻辑层不得依赖宿主模块）');
  });
  return { artifact, module };
}

/** 造一份 sessions list 快照（形状对齐 05 笔记 §3）。 */
export function makeList(rows) {
  const byId = {};
  const ids = [];
  for (const row of rows) {
    byId[row.id] = {
      retainedBy: {},
      running: false,
      blank: false,
      displayTitle: row.title ?? row.id,
      ...row,
    };
    ids.push(row.id);
  }
  return { ids, byId, phase: 'ready', projectionsBySession: {} };
}

/** 造 workspace 快照条目（形状对齐 05 笔记 §2）。 */
export function makeWorkspace(workspaceId, sessionIds, extras = {}) {
  return {
    workspaceId,
    title: extras.title ?? workspaceId,
    path: extras.path ?? '/ws/' + workspaceId,
    createdAt: extras.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: extras.updatedAt ?? '2026-01-01T00:00:00Z',
    sessionIds,
  };
}

/** 造 sessionStatus hook 快照（空状态图）。 */
export function noStatuses() {
  return new Map();
}

/** 默认 rowState（无置顶、无归档、隐藏归档）。 */
export function rowState(overrides = {}) {
  return {
    pinnedSessionIds: [],
    archivedSessionIds: [],
    archivedFilter: 'default',
    ...overrides,
  };
}

/** 固定时间戳：2026-11-07 12:00:00Z 起每隔 1 分钟。 */
export function ts(index) {
  return 1791748800000 + index * 60000;
}
