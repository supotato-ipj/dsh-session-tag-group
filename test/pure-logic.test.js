/**
 * 纯逻辑层排序/分组语义测试（02 笔记 §6 行为清单 → 用例名；对齐内置 WorkspaceBrowser 纯函数）。
 * 测试 seam：module.logic（spec「Testing Decisions」；只测输入→输出，不测实现细节）。
 */
import { describe, expect, it } from 'vitest';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createClientModule,
  makeList,
  makeWorkspace,
  noStatuses,
  rowState,
  ts,
} from './helpers/client-artifact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'client.js');
const { module } = createClientModule(clientPath);
const logic = module.logic;

describe('orderByRecency（最近活跃排序）', () => {
  it('按 updatedAt 降序排列', () => {
    const summaries = {
      a: { updatedAt: ts(1) },
      b: { updatedAt: ts(3) },
      c: { updatedAt: ts(2) },
    };
    expect(logic.orderByRecency(['a', 'b', 'c'], summaries)).toEqual(['b', 'c', 'a']);
  });

  it('同分用 session id 字典序升序做确定性 tie-break', () => {
    const at = ts(5);
    const summaries = { b: { updatedAt: at }, a: { updatedAt: at }, c: { updatedAt: at } };
    expect(logic.orderByRecency(['c', 'a', 'b'], summaries)).toEqual(['a', 'b', 'c']);
  });

  it('无 summary 的成员暂缺（不进结果）', () => {
    const summaries = { a: { updatedAt: ts(1) } };
    expect(logic.orderByRecency(['a', 'ghost'], summaries)).toEqual(['a']);
  });
});

describe('reconcileManualOrder（手动序调和，置顶语义）', () => {
  const summaries = {
    p1: { updatedAt: ts(1) },
    p2: { updatedAt: ts(2) },
    m1: { updatedAt: ts(3) },
    m2: { updatedAt: ts(4) },
    arc: { updatedAt: ts(5) },
  };
  const state = rowState({ pinnedSessionIds: ['p2', 'p1'], archivedSessionIds: ['arc'] });

  it('置顶（非归档）按 pinnedSessionIds 顺序排最前，随后已存手动序，再其余按 recency，归档垫底', () => {
    const order = logic.reconcileManualOrder(
      ['m1', 'p1', 'arc', 'm2', 'p2'],
      ['m2', 'm1'],
      summaries,
      state,
    );
    expect(order).toEqual(['p2', 'p1', 'm2', 'm1', 'arc']);
  });

  it('无 savedOrder 时：置顶 → recency → 归档', () => {
    const order = logic.reconcileManualOrder(['arc', 'm2', 'p1', 'm1', 'p2'], undefined, summaries, state);
    expect(order).toEqual(['p2', 'p1', 'm2', 'm1', 'arc']);
  });

  it('归档的会话即使被置顶也不进置顶段（pin 不覆盖归档）', () => {
    const state2 = rowState({ pinnedSessionIds: ['arc'], archivedSessionIds: ['arc'] });
    const order = logic.reconcileManualOrder(['arc', 'm1'], [], summaries, state2);
    expect(order).toEqual(['m1', 'arc']);
  });

  it('savedOrder 里已消失的成员被忽略，不产生幽灵位', () => {
    const order = logic.reconcileManualOrder(['m1', 'p1', 'p2', 'arc'], ['ghost', 'm1'], summaries, state);
    expect(order).toEqual(['p2', 'p1', 'm1', 'arc']);
  });
});

describe('sectionMembers（分区成员排序）', () => {
  const pinned = new Set(['p1']);
  const archived = new Set(['a1']);
  const member = (id, blank = false) => ({ id, blank });

  it('blank 占位行 → pinned 行 → 其余行，各分区内部保持调用方顺序', () => {
    const members = [member('r1'), member('b1', true), member('a1'), member('p1'), member('r2')];
    expect(logic.sectionMembers(members, pinned, archived).map((m) => m.id)).toEqual(['b1', 'p1', 'r1', 'a1', 'r2']);
  });

  it('归档的置顶行落回其余区（不进 pinned 段）', () => {
    const members = [member('r1'), member('a1')];
    const pinnedWithArchived = new Set(['a1', 'p1']);
    expect(logic.sectionMembers(members, pinnedWithArchived, archived).map((m) => m.id)).toEqual(['r1', 'a1']);
  });
});

describe('sessionVisible（可见性）', () => {
  const archived = new Set(['arc']);
  const visible = (id, overrides = {}, filter = 'default', current = undefined) => {
    const session = { id, blank: false, ...overrides };
    return logic.sessionVisible(session, current, archived, filter);
  };

  it('subagent 子会话不显示', () => {
    expect(visible('s1', { origin: 'subagent' })).toBe(false);
  });

  it('blank 只显示当前选中的那个', () => {
    expect(visible('b1', { blank: true }, 'default', 'b1')).toBe(true);
    expect(visible('b1', { blank: true }, 'default', 'other')).toBe(false);
  });

  it('归档三态：default 隐藏、show 全显、only 仅归档', () => {
    expect(visible('arc')).toBe(false);
    expect(visible('arc', {}, 'show')).toBe(true);
    expect(visible('arc', {}, 'only')).toBe(true);
    expect(visible('live', {}, 'only')).toBe(false);
  });
});

describe('pinCurrentBlank（blank 置顶）', () => {
  it('当前选中的空白「新会话」恒排第一且不重复', () => {
    expect(logic.pinCurrentBlank(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(logic.pinCurrentBlank(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });
});

describe('owningGroupKey（归属权威）', () => {
  it('会话↔workspace 归属以 workspace.sessionIds 为权威，无归属落未分组键 ""', () => {
    const workspaces = [makeWorkspace('w1', ['s1']), makeWorkspace('w2', ['s2', 's3'])];
    expect(logic.owningGroupKey(workspaces, 's3')).toBe('w2');
    expect(logic.owningGroupKey(workspaces, 'loose')).toBe('');
  });
});

describe('deriveGroups（分组计算）', () => {
  const workspaces = [
    makeWorkspace('w1', ['s1', 's2']),
    makeWorkspace('w2', ['s3']),
  ];

  it('按 workspaces 传入顺序建组（成员序由调用方排好：browser 层已做过 orderByRecency）；组外散会话进「未分组」桶垫底', () => {
    const list = makeList([
      { id: 's1', updatedAt: ts(1) },
      { id: 's2', updatedAt: ts(2) },
      { id: 's3', updatedAt: ts(3) },
      { id: 'loose', updatedAt: ts(4) },
    ]);
    // 成员序对齐内置调用链：WorkspaceBrowser 先 orderByRecency 再传入（uiw client.js:3712-3717）。
    const callerOrdered = [
      makeWorkspace('w1', ['s2', 's1']),
      makeWorkspace('w2', ['s3']),
    ];
    const groups = logic.deriveGroups(list, callerOrdered, rowState(), noStatuses(), {
      expandedGroups: ['w1', 'w2', ''],
      ungroupedOrder: undefined,
    });
    expect(groups.map((g) => g.key)).toEqual(['w1', 'w2', '']);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(['loose']);
    expect(groups[2].label).toBe('');
  });

  it('deriveGroups 自身不再排序：传入序原样保留（排序职责在 browser 层纯函数）', () => {
    const list = makeList([
      { id: 's1', updatedAt: ts(2) },
      { id: 's2', updatedAt: ts(1) },
    ]);
    const groups = logic.deriveGroups(list, [makeWorkspace('w1', ['s1', 's2'])], rowState(), noStatuses(), {
      expandedGroups: ['w1'],
      ungroupedOrder: undefined,
    });
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('未展开组 sessions 为空但 sessionCount 保留', () => {
    const list = makeList([{ id: 's1', updatedAt: ts(1) }]);
    const groups = logic.deriveGroups(list, workspaces.slice(0, 1), rowState(), noStatuses(), {
      expandedGroups: [],
      ungroupedOrder: undefined,
    });
    expect(groups[0].expanded).toBe(false);
    expect(groups[0].sessionCount).toBe(1);
    expect(groups[0].sessions).toEqual([]);
  });

  it('归档保留槽位：default 隐藏、show 出现且原位保留', () => {
    const list = makeList([
      { id: 's1', updatedAt: ts(1) },
      { id: 'arc', updatedAt: ts(2) },
    ]);
    const ws = [makeWorkspace('w1', ['arc', 's1'])];
    const hidden = logic.deriveGroups(list, ws, rowState({ archivedSessionIds: ['arc'] }), noStatuses(), {
      expandedGroups: ['w1'],
      ungroupedOrder: undefined,
    });
    expect(hidden[0].sessionCount).toBe(1);
    const shown = logic.deriveGroups(list, ws, rowState({ archivedSessionIds: ['arc'], archivedFilter: 'show' }), noStatuses(), {
      expandedGroups: ['w1'],
      ungroupedOrder: undefined,
    });
    expect(shown[0].sessions.map((s) => s.id)).toEqual(['arc', 's1']);
    expect(shown[0].sessions[0].archived).toBe(true);
  });

  it('仅显示已归档时剔除无归档成员的组；未分组桶保留归档会话', () => {
    const list = makeList([
      { id: 'arc', updatedAt: ts(2) },
      { id: 's3', updatedAt: ts(3) },
    ]);
    const groups = logic.deriveGroups(list, workspaces, rowState({ archivedSessionIds: ['arc'], archivedFilter: 'only' }), noStatuses(), {
      expandedGroups: ['w2', ''],
      ungroupedOrder: undefined,
    });
    // w1 的 s1/s2 不在目录、w2 的 s3 未归档被滤掉 → 两组皆空剔除；arc 散在未分组桶且可见。
    expect(groups.map((g) => g.key)).toEqual(['']);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['arc']);
  });

  it('containsCurrent 标记当前会话所在组（retainedBy.mainView 权威）', () => {
    const list = makeList([
      { id: 's1', updatedAt: ts(1), retainedBy: { mainView: 1 } },
      { id: 's3', updatedAt: ts(2) },
    ]);
    const groups = logic.deriveGroups(list, workspaces, rowState(), noStatuses(), {
      expandedGroups: ['w1', 'w2'],
      ungroupedOrder: undefined,
    });
    expect(groups[0].containsCurrent).toBe(true);
    expect(groups[1].containsCurrent).toBe(false);
  });
});

describe('deriveFlat（平铺）', () => {
  it('成员全集含归档（sessionMemberIds = show 全量）；平铺展示跟随 archivedFilter，pinned 行前插', () => {
    const list = makeList([
      { id: 's1', updatedAt: ts(1) },
      { id: 'arc', updatedAt: ts(2) },
      { id: 's2', updatedAt: ts(3) },
    ]);
    expect(logic.sessionMemberIds(list)).toEqual(['s1', 'arc', 's2']);
    const state = rowState({ pinnedSessionIds: ['s1'], archivedSessionIds: ['arc'] });
    const hidden = logic.deriveFlat(list, logic.sessionMemberIds(list), state, noStatuses());
    expect(hidden.map((r) => r.id)).toEqual(['s1', 's2']);
    const shown = logic.deriveFlat(list, logic.sessionMemberIds(list), { ...state, archivedFilter: 'show' }, noStatuses());
    expect(shown.map((r) => r.id)).toEqual(['s1', 'arc', 's2']);
    expect(shown.find((r) => r.id === 's1').pinned).toBe(true);
    expect(shown.find((r) => r.id === 'arc').archived).toBe(true);
  });
});

describe('deriveSearchResults（搜索合并）', () => {
  const workspaces = [makeWorkspace('w1', ['s1'])];
  const list = makeList([
    { id: 's1', title: '宁兰路桥 会议', updatedAt: ts(2), cwd: '/ws/w1' },
    { id: 's2', title: 'Obsidian 笔记', updatedAt: ts(1) },
    { id: 's3', title: '其他', updatedAt: ts(3) },
  ]);

  it('本地匹配：标题/工作区名/session id 子串，大小写不敏感，blank 排除，recency 排前', () => {
    const results = logic.deriveSearchResults(list, workspaces, '宁兰', [], 'default', noStatuses(), { items: [], hasMore: false }, 20);
    expect(results.items.map((r) => r.id)).toEqual(['s1']);
    const byWs = logic.deriveSearchResults(list, workspaces, 'W1', [], 'default', noStatuses(), { items: [], hasMore: false }, 20);
    expect(byWs.items.map((r) => r.id)).toEqual(['s1']);
    const byId = logic.deriveSearchResults(list, workspaces, 'S2', [], 'default', noStatuses(), { items: [], hasMore: false }, 20);
    expect(byId.items.map((r) => r.id)).toEqual(['s2']);
    const blankList = makeList([{ id: 'blank1', blank: true, updatedAt: ts(9) }]);
    const blanks = logic.deriveSearchResults(blankList, [], 'new', [], 'default', noStatuses(), { items: [], hasMore: false }, 20);
    expect(blanks.items).toEqual([]);
  });

  it('Host 内容结果按后端序随后，去重（本地已有则带 snippet 原位），limit 截断与 hasMore', () => {
    const content = { items: [{ sessionId: 's3', snippet: '…其他…' }, { sessionId: 's1', snippet: '命中片段' }], hasMore: true };
    const results = logic.deriveSearchResults(list, workspaces, '其他 OR 会议'.slice(0, 0) || 'e', [], 'default', noStatuses(), content, 2);
    // 本地 'e' 命中（Obsidian / 会议），随后内容结果补 s3；s1 已在本地，带上 snippet。
    expect(results.items.length).toBeLessThanOrEqual(2);
    const merged = logic.deriveSearchResults(list, workspaces, '会议', [], 'default', noStatuses(), content, 20);
    expect(merged.items[0].id).toBe('s1');
    expect(merged.items[0].snippet).toBe('命中片段');
    expect(merged.items.some((r) => r.id === 's3' && r.snippet === '…其他…')).toBe(true);
    expect(merged.hasMore).toBe(true);
  });

  it('空查询直接空结果', () => {
    expect(logic.deriveSearchResults(list, workspaces, '  ', [], 'default', noStatuses(), { items: [], hasMore: false }, 20)).toEqual({ items: [], hasMore: false });
  });
});

describe('sanitizeSearchQuery（搜索词规范化）', () => {
  it('去 NUL；500 code units 上限且不劈代理对', () => {
    expect(logic.sanitizeSearchQuery('a\0b')).toBe('ab');
    const long = 'x'.repeat(600);
    expect(logic.sanitizeSearchQuery(long).length).toBe(500);
    const surrogateTail = 'x'.repeat(499) + '𝕊';
    expect(logic.sanitizeSearchQuery(surrogateTail).length).toBe(499);
  });
});

describe('水位线', () => {
  it('watermarkRows：blank 恒显 + 前 watermark 个非 blank', () => {
    const sessions = [{ id: 'blank', blank: true }, ...Array.from({ length: 8 }, (_, i) => ({ id: 'r' + String(i).padStart(2, '0') }))];
    const cut = logic.watermarkRows(sessions, 5);
    expect(cut.rows.length).toBe(6);
    expect(cut.hiddenCount).toBe(3);
    expect(cut.rows[0].id).toBe('blank');
  });

  it('requiredWatermark：running/待交互自动抬升到其位次（1-based 非.blank 计数）', () => {
    const plain = Array.from({ length: 10 }, (_, i) => ({ id: 'r' + String(i).padStart(2, '0') }));
    expect(logic.requiredWatermark(plain, undefined, undefined)).toBe(0);
    const withRunning = plain.map((row) => (row.id === 'r07' ? { ...row, running: true } : row));
    expect(logic.requiredWatermark(withRunning, undefined, undefined)).toBe(8);
    const withPending = plain.map((row) => (row.id === 'r02' ? { ...row, pendingInteraction: 'approval' } : row));
    expect(logic.requiredWatermark(withPending, undefined, undefined)).toBe(3);
    expect(logic.requiredWatermark(plain, 'r05', undefined)).toBe(6);
  });

  it('raiseWatermarks：超过基线的抬升入表，低于基线不入表，只升不降', () => {
    const raised = logic.raiseWatermarks({ g1: 3 }, new Map([['g1', 5], ['g2', 2]]));
    expect(raised).toEqual({ g1: 5 });
    expect(logic.raiseWatermarks({}, new Map([['g2', 7]]))).toEqual({ g2: 7 });
    expect(logic.raiseWatermarks({ g1: 5 }, new Map([['g1', 2]]))).toEqual({ g1: 5 });
  });
});

describe('sessionDragOrder（拖拽排序）', () => {
  const row = (id, pinned = false, blank = false) => ({ id, pinned, blank });
  const rowsList = [row('p1', true), row('p2', true), row('r1'), row('r2'), row('r3')];
  const order = ['p1', 'p2', 'r1', 'r2', 'r3'];

  it('同 pinned 段内 before 插入', () => {
    const next = logic.sessionDragOrder(order, rowsList, { sessionId: 'r2', pinned: false }, { id: 'r1', half: 'before' });
    expect(next).toEqual(['p1', 'p2', 'r2', 'r1', 'r3']);
  });

  it('跨 pinned 段拖拽被拒绝（p1 拖到普通区无效果）', () => {
    const next = logic.sessionDragOrder(order, rowsList, { sessionId: 'p1', pinned: true }, { id: 'r1', half: 'before' });
    expect(next).toBeUndefined();
  });

  it('自身插入无效果', () => {
    expect(logic.sessionDragOrder(order, rowsList, { sessionId: 'r1', pinned: false }, { id: 'r1', half: 'after' })).toBeUndefined();
  });
});

describe('sessionStatuses（状态点优先级）', () => {
  const t = (key, params) => key + (params ? JSON.stringify(params) : '');

  it('pendingInteraction > running > 子代理 > 未读完成 > idle', () => {
    const base = { runningSubagentCount: 0 };
    expect(logic.sessionStatuses({ ...base, pendingInteraction: 'approval', running: true }, t)[0].state).toBe('warning');
    expect(logic.sessionStatuses({ ...base, pendingInteraction: 'question' }, t)[0].label).toContain('waitingAnswer');
    expect(logic.sessionStatuses({ ...base, running: true, completed: true }, t)[0].state).toBe('ongoing');
    expect(logic.sessionStatuses({ ...base, runningSubagentCount: 2, completed: true }, t)[0].state).toBe('ongoing');
    expect(logic.sessionStatuses({ ...base, completed: true }, t)[0].state).toBe('done');
    expect(logic.sessionStatuses(base, t)[0].state).toBe('idle');
  });

  it('pending 与子代理并存时两个状态都在（pending 在前），pending 存在时带 compact 标签', () => {
    const statuses = logic.sessionStatuses({ pendingInteraction: 'plan-review', runningSubagentCount: 3 }, t);
    expect(statuses.map((s) => s.state)).toEqual(['warning', 'ongoing']);
    expect(statuses[0].trailingLabel).toContain('compact.planReview');
  });
});
