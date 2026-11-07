/**
 * 标签模式分组计算纯函数测试（票 #5 / T4）。
 *
 * seam：client.js 工厂的 `logic.deriveTagGroups` / `logic.tagSearchMatchIds`
 * （spec「Implementation Decisions」：分组计算纯函数，shadow UI 只是渲染器；
 * 「Testing Decisions」：只测输入→输出，覆盖全部分组细则）。
 *
 * 规则对照票面验收（每条至少一例）：
 * - 置顶会话聚合列表最上（sectionMembers/reconcileManualOrder 语义）；
 * - 标签组之间按组内最近活跃排序；组内按最近活跃排序（id tie-break）；
 * - 多标签会话在每个所属组都出现；未标签会话收进末尾「未标签」组；
 * - 归档会话排除（视图排除，关联不剪：取消归档恢复原位）；
 * - 行级 workspace 名标注（tags 模式限定字段）；
 * - 空态（无任何会话 / 无任何标签 / 全归档）；
 * - 搜索在分组结果内过滤（matchIds 通道 + tagSearchMatchIds 本地/内容合并）。
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

/** 主场景：两个 workspace + 一条游离会话；s2 挂双标签（跨 workspace 聚合的锚点）。 */
function mainWorld() {
  const list = makeList([
    { id: 's1', title: '宁兰路桥合同评审', updatedAt: ts(1) },
    { id: 's2', title: '路桥周报', updatedAt: ts(3) },
    { id: 's3', title: '插件重构', updatedAt: ts(4) },
    { id: 's4', title: '零散笔记', updatedAt: ts(0), cwd: '/home/me/project' },
  ]);
  const workspaces = [
    makeWorkspace('w-law', ['s1', 's2'], { title: '法律' }),
    makeWorkspace('w-eng', ['s3'], { title: '工程' }),
  ];
  const tags = {
    pool: ['宁兰路桥', 'Obsidian'],
    bySession: {
      s1: ['宁兰路桥'],
      s2: ['宁兰路桥', 'Obsidian'],
      s3: ['Obsidian'],
    },
  };
  return { list, workspaces, tags };
}

/** 分组树摘要：kind + key + 成员序，断言可读。 */
const outline = (groups) => groups.map((group) => ({ kind: group.kind, key: group.key, memberIds: group.memberIds }));

const derive = ({ list, workspaces, tags }, stateOverrides = {}, view = {}) =>
  logic.deriveTagGroups(list, workspaces, rowState(stateOverrides), noStatuses(), tags, view);

describe('deriveTagGroups：置顶聚合最上（sectionMembers/reconcileManualOrder 语义）', () => {
  it('置顶会话聚合进列表最上方的置顶段，不再重复出现在其标签组', () => {
    const world = mainWorld();
    const groups = derive(world, { pinnedSessionIds: ['s4'] });
    expect(outline(groups)).toEqual([
      { kind: 'pinned', key: logic.TAG_PINNED_KEY, memberIds: ['s4'] },
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3', 's2'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s2', 's1'] },
    ]);
    // 置顶会话不重复：任何标签组 / 未标签组都不含 s4。
    for (const group of groups.slice(1)) expect(group.memberIds).not.toContain('s4');
  });

  it('置顶段内部按 pinnedSessionIds 顺序（reconcileManualOrder 置顶语义）', () => {
    const world = mainWorld();
    const groups = derive(world, { pinnedSessionIds: ['s3', 's1'] });
    expect(groups[0].kind).toBe('pinned');
    expect(groups[0].memberIds).toEqual(['s3', 's1']);
  });

  it('归档会话即使被置顶也不进置顶段（pin 不覆盖归档，同 reconcileManualOrder）', () => {
    const world = mainWorld();
    const groups = derive(world, { pinnedSessionIds: ['s2'], archivedSessionIds: ['s2'] }, { archivedFilter: 'show' });
    expect(groups[0].kind).not.toBe('pinned');
  });

  it('无置顶会话时不产出置顶段', () => {
    const world = mainWorld();
    expect(derive(world)[0].kind).toBe('tag');
  });
});

describe('deriveTagGroups：排序（组间按组内最近活跃，组内按最近活跃）', () => {
  it('标签组之间按组内最近活跃排序（Obsidian 组最新 → 在前）', () => {
    const world = mainWorld();
    const groups = derive(world);
    expect(outline(groups)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3', 's2'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s2', 's1'] },
      { kind: 'untagged', key: logic.TAG_UNTAGGED_KEY, memberIds: ['s4'] },
    ]);
  });

  it('组内按最近活跃排序，同分用 session id 字典序升序 tie-break', () => {
    const list = makeList([
      { id: 'b', title: 'B', updatedAt: ts(2) },
      { id: 'a', title: 'A', updatedAt: ts(2) },
      { id: 'c', title: 'C', updatedAt: ts(1) },
    ]);
    const tags = { pool: ['t'], bySession: { a: ['t'], b: ['t'], c: ['t'] } };
    const groups = logic.deriveTagGroups(list, [], rowState(), noStatuses(), tags, {});
    expect(groups[0].memberIds).toEqual(['a', 'b', 'c']);
  });

  it('组间同分时用标签名做确定性 tie-break（字典序升序）', () => {
    const list = makeList([
      { id: 'a', title: 'A', updatedAt: ts(1) },
      { id: 'b', title: 'B', updatedAt: ts(1) },
    ]);
    const tags = { pool: ['乙标签', '甲标签'], bySession: { a: ['乙标签'], b: ['甲标签'] } };
    const groups = logic.deriveTagGroups(list, [], rowState(), noStatuses(), tags, {});
    expect(groups.map((group) => group.tagName)).toEqual(['乙标签', '甲标签']);
  });
});

describe('deriveTagGroups：多标签与未标签组', () => {
  it('多标签会话在每个所属组都出现（s2 同在宁兰路桥与 Obsidian 组）', () => {
    const world = mainWorld();
    const groups = derive(world);
    for (const key of ['@tag:Obsidian', '@tag:宁兰路桥']) {
      expect(groups.find((group) => group.key === key).memberIds).toContain('s2');
    }
  });

  it('未打标签会话收进末尾「未标签」组（恒排最后）', () => {
    const world = mainWorld();
    const groups = derive(world);
    const untagged = groups[groups.length - 1];
    expect(untagged.kind).toBe('untagged');
    expect(untagged.key).toBe(logic.TAG_UNTAGGED_KEY);
    expect(untagged.memberIds).toEqual(['s4']);
  });

  it('无任何标签时全部会话收进单一「未标签」组', () => {
    const world = mainWorld();
    const groups = derive({ ...world, tags: { pool: [], bySession: {} } });
    expect(outline(groups)).toEqual([
      { kind: 'untagged', key: logic.TAG_UNTAGGED_KEY, memberIds: ['s3', 's2', 's1', 's4'] },
    ]);
  });

  it('标签组只为其有可见会话的标签产出（池条目无会话不出空组）', () => {
    const world = mainWorld();
    const tags = { pool: ['宁兰路桥', 'Obsidian', '幽灵标签'], bySession: { ...world.tags.bySession } };
    const groups = derive({ ...world, tags });
    expect(groups.filter((group) => group.kind === 'tag').map((group) => group.tagName))
      .toEqual(['Obsidian', '宁兰路桥']);
  });
});

describe('deriveTagGroups：归档排除（视图排除，关联不剪）', () => {
  it('default 筛选下归档会话从所有分组消失', () => {
    const world = mainWorld();
    const groups = derive(world, { archivedSessionIds: ['s2'] });
    for (const group of groups) expect(group.memberIds).not.toContain('s2');
    expect(outline(groups)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s1'] },
      { kind: 'untagged', key: logic.TAG_UNTAGGED_KEY, memberIds: ['s4'] },
    ]);
  });

  it('取消归档后恢复原位（recency 位置回组：T3 契约——归档不剪关联）', () => {
    const world = mainWorld();
    const archived = derive(world, { archivedSessionIds: ['s2'] });
    const restored = derive(world, { archivedSessionIds: [] });
    expect(outline(archived)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s1'] },
      { kind: 'untagged', key: logic.TAG_UNTAGGED_KEY, memberIds: ['s4'] },
    ]);
    expect(outline(restored)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3', 's2'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s2', 's1'] },
      { kind: 'untagged', key: logic.TAG_UNTAGGED_KEY, memberIds: ['s4'] },
    ]);
  });

  it('show 筛选下归档会话原样显示在分组内；only 筛选只剩归档会话', () => {
    const world = mainWorld();
    const shown = derive(world, { archivedSessionIds: ['s2'], archivedFilter: 'show' });
    expect(shown.find((group) => group.key === '@tag:Obsidian').memberIds).toEqual(['s3', 's2']);
    const only = derive(world, { archivedSessionIds: ['s2'], archivedFilter: 'only' });
    expect(outline(only)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s2'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s2'] },
    ]);
  });

  it('subagent 子会话不进任何分组（沿用内置可见性）', () => {
    const list = makeList([
      { id: 's1', title: 'A', updatedAt: ts(1) },
      { id: 'sub', title: '子代理', updatedAt: ts(2), origin: 'subagent' },
    ]);
    const tags = { pool: ['t'], bySession: { s1: ['t'], sub: ['t'] } };
    const groups = logic.deriveTagGroups(list, [], rowState(), noStatuses(), tags, {});
    expect(groups[0].memberIds).toEqual(['s1']);
  });
});

describe('deriveTagGroups：行级 workspace 名标注（tags 模式限定）', () => {
  it('组内会话节点带所属 workspace 显示名', () => {
    const world = mainWorld();
    const groups = derive(world);
    const lawGroup = groups.find((group) => group.key === '@tag:宁兰路桥');
    const nodes = Object.fromEntries(lawGroup.sessions.map((node) => [node.id, node]));
    expect(nodes.s1.workspace).toBe('法律');
    expect(nodes.s2.workspace).toBe('法律');
  });

  it('跨 workspace 聚合：两个 workspace 的同标签会话在同一组相遇且标注各自来源', () => {
    const world = mainWorld();
    const groups = derive(world);
    const obsidian = groups.find((group) => group.key === '@tag:Obsidian');
    const byId = Object.fromEntries(obsidian.sessions.map((node) => [node.id, node]));
    expect(byId.s3.workspace).toBe('工程');
    expect(byId.s2.workspace).toBe('法律');
  });

  it('游离会话标注 cwd 尾段；两者皆无标注空串', () => {
    const world = mainWorld();
    const list = makeList([
      { id: 's4', title: '零散笔记', updatedAt: ts(1), cwd: '/home/me/project' },
      { id: 's5', title: '无主会话', updatedAt: ts(0) },
    ]);
    const tags = { pool: [], bySession: {} };
    const groups = logic.deriveTagGroups(list, [], rowState(), noStatuses(), tags, {});
    const byId = Object.fromEntries(groups[0].sessions.map((node) => [node.id, node]));
    expect(byId.s4.workspace).toBe('project');
    expect(byId.s5.workspace).toBe('');
  });

  it('置顶段内的会话节点同样带 workspace 标注', () => {
    const world = mainWorld();
    const groups = derive(world, { pinnedSessionIds: ['s1'] });
    expect(groups[0].sessions[0].workspace).toBe('法律');
  });
});

describe('deriveTagGroups：空态', () => {
  it('无任何会话 → 空分组树', () => {
    const world = mainWorld();
    expect(derive({ ...world, list: makeList([]) })).toEqual([]);
  });

  it('全归档 → 空分组树', () => {
    const world = mainWorld();
    const groups = derive(world, {
      archivedSessionIds: ['s1', 's2', 's3', 's4'],
    });
    expect(groups).toEqual([]);
  });

  it('全归档 + only 筛选 → 归档会话回到分组（「仅显示已归档」在标签模式同样可用）', () => {
    const world = mainWorld();
    const groups = derive(world, { archivedSessionIds: ['s1'], archivedFilter: 'only' });
    expect(outline(groups)).toEqual([{ kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s1'] }]);
  });
});

describe('deriveTagGroups：分组树结构契约', () => {
  it('分组节点形状：key/kind/tagName/color/sessionCount/expanded/containsCurrent/sessions', () => {
    const world = mainWorld();
    const groups = derive(world);
    const tagGroup = groups.find((group) => group.key === '@tag:宁兰路桥');
    expect(tagGroup.kind).toBe('tag');
    expect(tagGroup.tagName).toBe('宁兰路桥');
    expect(tagGroup.color).toBe(logic.tagColorOf('宁兰路桥'));
    expect(tagGroup.label).toBe('宁兰路桥');
    expect(tagGroup.sessionCount).toBe(2);
    expect(tagGroup.expanded).toBe(true);
    expect(tagGroup.containsCurrent).toBe(false);
    expect(tagGroup.sessions.map((node) => node.id)).toEqual(['s2', 's1']);
  });

  it('折叠组不产出会话节点但 sessionCount 保持（水位线/展开渲染契约）', () => {
    const world = mainWorld();
    const groups = derive(world, {}, { isExpanded: (key) => key !== '@tag:宁兰路桥' });
    const folded = groups.find((group) => group.key === '@tag:宁兰路桥');
    expect(folded.expanded).toBe(false);
    expect(folded.sessionCount).toBe(2);
    expect(folded.sessions).toEqual([]);
    const open = groups.find((group) => group.key === '@tag:Obsidian');
    expect(open.sessions.length).toBe(2);
  });

  it('containsCurrent：主视图会话所在的所有分组都标真（多标签会多组同真）', () => {
    const list = makeList([
      { id: 'cur', title: '当前', updatedAt: ts(2), retainedBy: { mainView: 1 } },
      { id: 'other', title: '其他', updatedAt: ts(1) },
    ]);
    const tags = { pool: ['x', 'y'], bySession: { cur: ['x', 'y'], other: [] } };
    const groups = logic.deriveTagGroups(list, [], rowState(), noStatuses(), tags, {});
    const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));
    expect(byKey['@tag:x'].containsCurrent).toBe(true);
    expect(byKey['@tag:y'].containsCurrent).toBe(true);
    expect(groups.find((group) => group.kind === 'untagged').containsCurrent).toBe(false);
  });

  it('当前选中的空白「新会话」出现在其组首（sectionMembers blank 占位语义）', () => {
    const list = makeList([
      { id: 'a', title: 'A', updatedAt: ts(1) },
      { id: 'draft', title: '草稿', updatedAt: ts(5), blank: true, retainedBy: { mainView: 1 } },
    ]);
    const tags = { pool: [], bySession: { a: ['t'] } };
    const groups = logic.deriveTagGroups(list, [], rowState(), noStatuses(), tags, {});
    const untagged = groups.find((group) => group.kind === 'untagged');
    expect(untagged.memberIds).toEqual(['draft']);
  });
});

describe('deriveTagGroups：搜索在分组结果内过滤（matchIds 通道）', () => {
  it('matchIds 过滤后只剩命中会话所在的分组与成员', () => {
    const world = mainWorld();
    const groups = derive(world, {}, { matchIds: new Set(['s3']) });
    expect(outline(groups)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3'] },
    ]);
  });

  it('过滤后组序仍按组内最近活跃重排（过滤不破坏排序语义）', () => {
    const world = mainWorld();
    const groups = derive(world, {}, { matchIds: new Set(['s1', 's3']) });
    expect(outline(groups)).toEqual([
      { kind: 'tag', key: '@tag:Obsidian', memberIds: ['s3'] },
      { kind: 'tag', key: '@tag:宁兰路桥', memberIds: ['s1'] },
    ]);
  });

  it('过滤命中为空 → 空分组树（渲染层据此显示「无匹配会话」）', () => {
    const world = mainWorld();
    expect(derive(world, {}, { matchIds: new Set() })).toEqual([]);
  });
});

describe('tagSearchMatchIds：本地过滤 + sessions.search 内容结果合并', () => {
  const world = mainWorld();

  it('查询为空 → null（不过滤）', () => {
    expect(logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, '', { items: [] })).toBeNull();
    expect(logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, '   ', { items: [] })).toBeNull();
  });

  it('本地命中：标题大小写不敏感子串', () => {
    const ids = logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, '宁兰路桥合同', { items: [] });
    expect(ids.has('s1')).toBe(true);
    expect(ids.has('s3')).toBe(false);
  });

  it('本地命中：行级 workspace 名（跨 workspace 聚合下按来源找会话）', () => {
    const ids = logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, '工程', { items: [] });
    expect(ids.has('s3')).toBe(true);
    expect(ids.has('s1')).toBe(false);
  });

  it('本地命中：标签名（按标签找会话）与会话 id 子串', () => {
    const byTag = logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, '宁兰路桥', { items: [] });
    expect(byTag.has('s1')).toBe(true);
    expect(byTag.has('s2')).toBe(true);
    expect(byTag.has('s3')).toBe(false);
    const byId = logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, 'S2', { items: [] });
    expect(byId.has('s2')).toBe(true);
  });

  it('blank 会话不参与本地匹配（对齐内置搜索）', () => {
    const list = makeList([
      { id: 'draft', title: '草稿', updatedAt: ts(1), blank: true },
      { id: 'a', title: 'A', updatedAt: ts(0) },
    ]);
    const ids = logic.tagSearchMatchIds(list, [], { pool: [], bySession: {} }, '草稿', { items: [] });
    expect(ids.has('draft')).toBe(false);
    expect(ids.has('a')).toBe(false);
  });

  it('内容搜索结果并入（后端命中进过滤集，可见性仍由 deriveTagGroups 把关）', () => {
    const ids = logic.tagSearchMatchIds(world.list, world.workspaces, world.tags, '正文片段', { items: [{ sessionId: 's4' }] });
    expect(ids.has('s4')).toBe(true);
    expect(ids.has('s3')).toBe(false);
  });
});
