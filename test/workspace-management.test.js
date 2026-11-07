/**
 * T2 纯逻辑层测试：workspace 管理与归档（票 #3）。
 * 行为对齐内置源码行号（T1 缓存抽取件 .tmp-research/uiw-client.js）：
 * - distinguishingPathSuffixes：uiw client.js:2697-2712
 * - workspaceRenameReview：uiw client.js:1805-1807（WorkspaceDialogs 校验规则）
 * 测试 seam：module.logic（spec「Testing Decisions」；只测输入→输出）。
 */
import { describe, expect, it } from 'vitest';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClientModule, ts } from './helpers/client-artifact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'client.js');
const { module } = createClientModule(clientPath);
const logic = module.logic;

describe('distinguishingPathSuffixes（同名工作区消歧后缀）', () => {
  it('标题唯一的工作区没有后缀条目', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: '宁兰路桥', path: '/home/work/ninglan' },
      { id: 'w2', title: 'Obsidian', path: '/home/notes' },
    ]);
    expect(suffixes.size).toBe(0);
  });

  it('同名工作区各取最短的可区分尾段，保留路径自身分隔符', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'lab', path: '/home/a/lab' },
      { id: 'w2', title: 'lab', path: '/home/b/lab' },
    ]);
    expect(suffixes.get('w1')).toBe('a/lab');
    expect(suffixes.get('w2')).toBe('b/lab');
  });

  it('尾段仍相同时加长到可区分为止（slice 取的是尾 N 个分段元素）', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'lab', path: '/home/x/lab' },
      { id: 'w2', title: 'lab', path: '/home/x/deep/lab' },
    ]);
    // count=1：两行尾段同为 'lab' → 加长；count=2：w1 尾 3 元素 'x/lab'，w2 尾 3 元素 'deep/lab'，可区分。
    expect(suffixes.get('w1')).toBe('x/lab');
    expect(suffixes.get('w2')).toBe('deep/lab');
  });

  it('Windows 反斜杠路径同样按分隔符分段', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'docs', path: 'C:\\work\\a\\docs' },
      { id: 'w2', title: 'docs', path: 'D:\\docs' },
    ]);
    expect(suffixes.get('w1')).toBe('a\\docs');
    expect(suffixes.get('w2')).toBe('D:\\docs');
  });

  it('三行同名的最小公共区分（逐 peer 比较，不满足就加长）', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'p', path: '/r/one/p' },
      { id: 'w2', title: 'p', path: '/r/two/p' },
      { id: 'w3', title: 'q', path: '/r/one/q' },
    ]);
    expect(suffixes.get('w1')).toBe('one/p');
    expect(suffixes.get('w2')).toBe('two/p');
    expect(suffixes.has('w3')).toBe(false);
  });
});

describe('workspaceRenameReview（重命名对话框校验规则）', () => {
  const workspaces = [
    { workspaceId: 'w1', title: '宁兰路桥' },
    { workspaceId: 'w2', title: 'Obsidian' },
  ];
  const request = { action: 'rename', workspaceId: 'w1', displayTitle: '宁兰路桥', storedTitle: '宁兰路桥' };

  it('trim 后为空：blocked 且无 duplicate', () => {
    const review = logic.workspaceRenameReview('   ', request, workspaces, false);
    expect(review).toEqual({ trimmed: '', duplicate: false, blocked: true });
  });

  it('与存储标题相同（未改动）：blocked', () => {
    const review = logic.workspaceRenameReview('  宁兰路桥 ', request, workspaces, false);
    expect(review.blocked).toBe(true);
    expect(review.duplicate).toBe(false);
  });

  it('与其他 workspace 标题重名：blocked 且 duplicate 告警（比较存储标题，排除自身）', () => {
    const review = logic.workspaceRenameReview('Obsidian', request, workspaces, false);
    expect(review.duplicate).toBe(true);
    expect(review.blocked).toBe(true);
  });

  it('合法新名：不 blocked、无 duplicate，trimmed 去首尾空白', () => {
    const review = logic.workspaceRenameReview('  宁兰二标  ', request, workspaces, false);
    expect(review).toEqual({ trimmed: '宁兰二标', duplicate: false, blocked: false });
  });

  it('提交进行中（renaming）一律 blocked；无 request 时也 blocked', () => {
    expect(logic.workspaceRenameReview('x', request, workspaces, true).blocked).toBe(true);
    expect(logic.workspaceRenameReview('x', null, workspaces, false).blocked).toBe(true);
  });

  it('重名检查对默认工作区同样生效（传入的是映射后的标题列表）', () => {
    const mapped = [...workspaces, { workspaceId: 'w3', title: '默认工作区' }];
    const review = logic.workspaceRenameReview('默认工作区', request, mapped, false);
    expect(review.duplicate).toBe(true);
  });
});

describe('hoverTimeLabel（悬停卡相对时间，uiw 2123-2126）', () => {
  const t = (key, params) => key + (params ? JSON.stringify(params) : '');

  it('now 桶保持裸词（不套 ago 模板）', () => {
    const relative = () => ({ unit: 'now', n: 0 });
    expect(logic.hoverTimeLabel(relative, ts(1), ts(1), t)).toBe('time.now');
  });

  it('距离值套 time.ago 模板，内层走 time.{unit}', () => {
    const relative = () => ({ unit: 'hours', n: 5 });
    expect(logic.hoverTimeLabel(relative, ts(1), ts(1), t)).toBe('time.ago' + JSON.stringify({ t: 'time.hours' + JSON.stringify({ n: 5 }) }));
  });
});

describe('createdLabel（悬停卡绝对创建时间，uiw 2132-2140）', () => {
  const t = (key, params) => key + (params ? JSON.stringify(params) : '');

  it('date.ymd 模板 + 两位补零的本地时分', () => {
    // 用本地时间构造：createdLabel 内部走本地 getFullYear/getMonth/getHours，构造与断言同基即与机器时区无关。
    const created = new Date(2026, 2, 5, 7, 8);
    const label = logic.createdLabel(created.getTime(), t);
    // t 桩对内层 date.ymd 调用同样生效：外层 time 值 = date.ymd{y,m,d} + ' 07:08'。
    expect(label).toBe('hover.created' + JSON.stringify({ time: 'date.ymd' + JSON.stringify({ y: 2026, m: 3, d: 5 }) + ' 07:08' }));
  });

  it('分钟两位补零（9:05 → 09:05）', () => {
    const created = new Date(2026, 11, 31, 9, 5);
    expect(logic.createdLabel(created.getTime(), t)).toContain('09:05');
  });
});

describe('hoverStatuses（悬停卡状态行，uiw 2401-2402）', () => {
  const t = (key, params) => key + (params ? JSON.stringify(params) : '');
  const base = { runningSubagentCount: 0 };

  it('未归档行与行内状态一致（全状态保留）', () => {
    const statuses = logic.hoverStatuses({ ...base, running: true, completed: true }, t);
    expect(statuses.map((s) => s.state)).toEqual(['ongoing']);
  });

  it('归档行剔除 done/idle 状态（归档行只剩活动态或无状态行）', () => {
    expect(logic.hoverStatuses({ ...base, completed: true, archived: true }, t)).toEqual([]);
    expect(logic.hoverStatuses({ ...base, archived: true }, t)).toEqual([]);
    const running = logic.hoverStatuses({ ...base, running: true, archived: true }, t);
    expect(running.map((s) => s.state)).toEqual(['ongoing']);
  });
});

describe('pickFlowMachine（添加工作区目录流状态机，uiw 2740-2900 语义抽取）', () => {
  const machine = logic.createPickFlowMachine();

  it('初始：目录流与错误模态都关闭', () => {
    expect(machine.initial()).toEqual({ flowOpen: false, pickingFolder: false, errorOpen: false, modalError: null });
  });

  it('openFlow：清错误、开目录流，并先触发外层 onClose（先收菜单再开流）', () => {
    const current = { flowOpen: false, pickingFolder: false, errorOpen: true, modalError: 'x' };
    const next = machine.reduce(current, { type: 'openFlow' });
    expect(next.state).toEqual({ flowOpen: true, pickingFolder: false, errorOpen: false, modalError: null });
    expect(next.effects).toEqual([{ type: 'close' }]);
  });

  it('selectAdd 与 openFlow 同通道（菜单「添加工作区…」项）', () => {
    const next = machine.reduce(machine.initial(), { type: 'selectAdd' });
    expect(next.state.flowOpen).toBe(true);
    expect(next.effects).toEqual([{ type: 'close' }]);
  });

  it('pickSubmitted：进入 picking 忙态（采纳期间目录流保持打开且忙）', () => {
    const open = machine.reduce(machine.initial(), { type: 'openFlow' }).state;
    const next = machine.reduce(open, { type: 'pickSubmitted' });
    expect(next.state.pickingFolder).toBe(true);
    expect(next.state.flowOpen).toBe(true);
    expect(machine.flowBusy(next.state)).toBe(true);
  });

  it('adoptSucceeded：关流并触发 onPick（workspaceId 交外层 startSession）', () => {
    const open = machine.reduce(machine.initial(), { type: 'openFlow' }).state;
    const picking = machine.reduce(open, { type: 'pickSubmitted' }).state;
    const next = machine.reduce(picking, { type: 'adoptSucceeded', workspaceId: 'w9' });
    expect(next.state).toEqual({ flowOpen: false, pickingFolder: false, errorOpen: false, modalError: null });
    expect(next.effects).toEqual([{ type: 'pick', workspaceId: 'w9' }]);
  });

  it('adoptFailed：关流、开错误模态并展示原因（重试入口在模态上）', () => {
    const open = machine.reduce(machine.initial(), { type: 'openFlow' }).state;
    const picking = machine.reduce(open, { type: 'pickSubmitted' }).state;
    const next = machine.reduce(picking, { type: 'adoptFailed', message: '无法打开' });
    expect(next.state).toEqual({ flowOpen: false, pickingFolder: false, errorOpen: true, modalError: '无法打开' });
    expect(next.effects).toEqual([]);
  });

  it('flowCancel / flowError：取消只关流；错误关流并进模态', () => {
    const open = machine.reduce(machine.initial(), { type: 'openFlow' }).state;
    expect(machine.reduce(open, { type: 'flowCancel' }).state.flowOpen).toBe(false);
    const errored = machine.reduce(open, { type: 'flowError', message: '列表失败' });
    expect(errored.state).toEqual({ flowOpen: false, pickingFolder: false, errorOpen: true, modalError: '列表失败' });
  });

  it('flowUnavailable：流开着但占位者消失时收流（无静默僵尸流）', () => {
    const open = machine.reduce(machine.initial(), { type: 'openFlow' }).state;
    const next = machine.reduce(open, { type: 'flowUnavailable' });
    expect(next.state.flowOpen).toBe(false);
  });

  it('autoOpen 条件：picker 开着、add 是唯一入口且不忙（uiw 2821-2830）', () => {
    expect(machine.autoOpenShouldFire({ open: true, addIsTheOnlyEntry: true, flowBusy: false })).toBe(true);
    expect(machine.autoOpenShouldFire({ open: true, addIsTheOnlyEntry: true, flowBusy: true })).toBe(false);
    expect(machine.autoOpenShouldFire({ open: true, addIsTheOnlyEntry: false, flowBusy: false })).toBe(false);
    expect(machine.autoOpenShouldFire({ open: false, addIsTheOnlyEntry: true, flowBusy: false })).toBe(false);
  });

  it('errorDismiss：关模态清错误（重试按钮另走 openFlow）', () => {
    const errored = machine.reduce(machine.initial(), { type: 'flowError', message: 'x' }).state;
    expect(machine.reduce(errored, { type: 'errorDismiss' }).state).toEqual({ flowOpen: false, pickingFolder: false, errorOpen: false, modalError: null });
  });
});

describe('shortcutPatches（workspace.add 快捷键 store 补丁，uiw 39-71 语义）', () => {
  it('requestAdd：空闲时置 addRequested=true；directoryBusy 时 no-op', () => {
    expect(logic.shortcutPatchForAdd({ directoryBusy: false })).toEqual({ addRequested: true });
    expect(logic.shortcutPatchForAdd({ directoryBusy: true })).toEqual({});
  });

  it('closeAdd / directoryBusy 补丁语义', () => {
    expect(logic.shortcutPatchForCloseAdd()).toEqual({ addRequested: false });
    expect(logic.shortcutPatchForDirectoryBusy(true)).toEqual({ directoryBusy: true });
    expect(logic.shortcutPatchForDirectoryBusy(false)).toEqual({ directoryBusy: false });
  });

  it('applyShortcutPatch：无 getSnapshot/set 的 store 安全跳过（探测回退路径）', () => {
    expect(logic.applyShortcutPatch(null, { addRequested: true })).toBe(false);
    expect(logic.applyShortcutPatch({}, { addRequested: true })).toBe(false);
    const calls = [];
    const store = { getSnapshot: () => ({ addRequested: false, directoryBusy: false }), set: (v) => calls.push(v) };
    expect(logic.applyShortcutPatch(store, logic.shortcutPatchForAdd(store.getSnapshot()))).toBe(true);
    expect(calls).toEqual([{ addRequested: true, directoryBusy: false }]);
  });
});

describe('pickSharedViewStore（共享视图 store 探测，归档 toast / pin 序联动的关键）', () => {
  /** 造一个形状合法的 view store 句柄（内置 browserInjected 注册 options.store 同形）。 */
  const validHandle = () => ({
    create: () => ({ actions: { setArchivedFilter: () => {}, setGroupBy: () => {} } }),
  });

  it('从 slot entries 的 options.store（或裸 store）里选第一个形状合法的句柄', () => {
    const handle = validHandle();
    expect(logic.pickSharedViewStore([{ id: 'builtin', options: { store: handle } }])).toBe(handle);
    expect(logic.pickSharedViewStore([{ id: 'bare', store: handle }])).toBe(handle);
  });

  it('无 options.store 的条目跳过；全部不合法返回 null（回退本地实例）', () => {
    expect(logic.pickSharedViewStore([])).toBeNull();
    expect(logic.pickSharedViewStore([{ id: 'x', options: {} }])).toBeNull();
    expect(logic.pickSharedViewStore([null, { id: 'x', options: { store: null } }])).toBeNull();
  });

  it('形状校验拒绝缺 create / create 抛错 / 缺关键 actions 的句柄', () => {
    expect(logic.pickSharedViewStore([{ options: { store: {} } }])).toBeNull();
    expect(logic.pickSharedViewStore([{ options: { store: { create: () => { throw new Error('torn down'); } } } }])).toBeNull();
    expect(logic.pickSharedViewStore([{ options: { store: { create: () => ({ actions: {} }) } } }])).toBeNull();
    expect(logic.pickSharedViewStore([{ options: { store: { create: () => null } } }])).toBeNull();
  });

  it('多个条目时取首个合法者（先注册者优先，与内置共存时即内置句柄）', () => {
    const first = validHandle();
    const picked = logic.pickSharedViewStore([
      { id: 'a', options: {} },
      { id: 'b', options: { store: first } },
      { id: 'c', options: { store: validHandle() } },
    ]);
    expect(picked).toBe(first);
  });
});
