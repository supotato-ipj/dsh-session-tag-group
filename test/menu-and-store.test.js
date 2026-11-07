/**
 * ViewOptionsMenu 纯模型 + view store spec 行为测试。
 * 菜单结构照内置（uiw client.js:3029-3108）；T4「按标签」项的插入点在此锁定。
 */
import { describe, expect, it } from 'vitest';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClientModule } from './helpers/client-artifact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'client.js');
const { module } = createClientModule(clientPath);
const logic = module.logic;

/** 词表桩：键名原样返回，带 {n} 模板时透传，保证断言可读。 */
const t = (key) => key;
const iconFor = () => null;

describe('viewOptionsMenuModel（ViewOptionsMenu 结构复刻）', () => {
  const model = logic.viewOptionsMenuModel(t, iconFor);

  it('分组组别：label「分组方式」+ workspace/workspace-tree/flat/tag 四项', () => {
    expect(model.items[0]).toEqual({ type: 'label', id: 'group-by', text: 'groupBy.label' });
    const groupIds = model.items.filter((item) => item.id && logic.viewOptionSelection(item.id)?.kind === 'group').map((item) => item.id);
    expect(groupIds).toEqual(['workspace', 'workspace-tree', 'flat', 'tag']);
    expect(model.items.find((item) => item.id === 'workspace').label).toBe('groupBy.workspace');
  });

  it('排序组与归档筛选组之间各有一个 separator，顺序与内置一致', () => {
    const ids = model.items.map((item) => item.id);
    expect(ids.indexOf('group-by')).toBeLessThan(ids.indexOf('workspace'));
    expect(ids.indexOf('flat')).toBeLessThan(ids.indexOf('order-by-separator'));
    expect(ids.indexOf('order-by-separator')).toBeLessThan(ids.indexOf('order-by'));
    expect(ids.indexOf('order-by')).toBeLessThan(ids.indexOf('archived-filter-separator'));
    expect(ids.indexOf('archived-filter-separator')).toBeLessThan(ids.indexOf('filter-by'));
    expect(ids.filter((id) => id === 'order-by-separator' || id === 'archived-filter-separator').length).toBe(2);
    const separators = model.items.filter((item) => item.type === 'separator').map((item) => item.id);
    expect(separators).toEqual(['order-by-separator', 'archived-filter-separator']);
  });

  it('排序三项与归档筛选三项的键名与内置对齐', () => {
    const labels = Object.fromEntries(model.items.filter((item) => item.label).map((item) => [item.id, item.label]));
    expect(labels.manual).toBe('orderBy.manual');
    expect(labels.updated).toBe('orderBy.updated');
    expect(labels['hide-archived']).toBe('viewOptions.hideArchived');
    expect(labels['show-archived']).toBe('viewOptions.showArchived');
    expect(labels['only-archived']).toBe('viewOptions.onlyArchived');
  });

  it('selectedIds：groupBy/orderBy/归档筛选三选中（default→hide-archived 映射）', () => {
    expect(model.selectedIds('workspace', 'updated', 'default')).toEqual(['workspace', 'updated', 'hide-archived']);
    expect(model.selectedIds('flat', 'manual', 'only')).toEqual(['flat', 'manual', 'only-archived']);
    expect(model.selectedIds('workspace-tree', 'updated', 'show')).toEqual(['workspace-tree', 'updated', 'show-archived']);
    expect(model.selectedIds('tag', 'updated', 'default')).toEqual(['tag', 'updated', 'hide-archived']);
  });

  it('dispatch：分派到分组/排序/归档三通道', () => {
    expect(logic.viewOptionSelection('workspace-tree')).toEqual({ kind: 'group', value: 'workspace-tree' });
    expect(logic.viewOptionSelection('manual')).toEqual({ kind: 'order', value: 'manual' });
    expect(logic.viewOptionSelection('show-archived')).toEqual({ kind: 'archivedFilter', value: 'show' });
    expect(logic.viewOptionSelection('only-archived')).toEqual({ kind: 'archivedFilter', value: 'only' });
    expect(logic.viewOptionSelection('hide-archived')).toEqual({ kind: 'archivedFilter', value: 'default' });
    expect(logic.viewOptionSelection('unknown')).toBeNull();
  });

  it('T4：「按标签」项在 flat 之后、order-by separator 之前（分组组别内与内置三项并列，不跨组）', () => {
    expect(logic.viewOptionSelection('tag')).toEqual({ kind: 'group', value: 'tag' });
    const ids = model.items.map((item) => item.id);
    expect(ids).toContain('tag');
    expect(ids.indexOf('tag')).toBe(ids.indexOf('flat') + 1);
    expect(ids.indexOf('tag')).toBe(ids.indexOf('order-by-separator') - 1);
    expect(model.items.find((item) => item.id === 'tag').label).toBe('groupBy.tag');
  });
});

describe('workspaceViewStoreSpec（视图状态 store 行为）', () => {
  const spec = logic.workspaceViewStoreSpec();

  it('persist 键与内置同键（禁用回退时状态无缝接续）', () => {
    expect(spec.persist).toBe('dsh.workspace.view.v5');
  });

  it('init：workspace/updated/空展开/空手动序/default 归档筛选', () => {
    expect(spec.init()).toEqual({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      archivedFilter: 'default',
    });
  });

  it('setOrderBy：切 manual 时以当前活跃序为初始手动序；切回 updated 清空', () => {
    const d = spec.init();
    spec.actions.setOrderBy(d, 'manual', { w1: ['a', 'b'] });
    expect(d.orderBy).toBe('manual');
    expect(d.sessionOrderByAccount).toEqual({ w1: ['a', 'b'] });
    spec.actions.setOrderBy(d, 'updated', { w1: ['b', 'a'] });
    expect(d.orderBy).toBe('updated');
    expect(d.sessionOrderByAccount).toEqual({});
  });

  it('setOrderBy 同模式 no-op（不覆盖已有手动序）', () => {
    const d = spec.init();
    spec.actions.setOrderBy(d, 'manual', { w1: ['a'] });
    spec.actions.setOrderBy(d, 'manual', { w1: ['c'] });
    expect(d.sessionOrderByAccount).toEqual({ w1: ['a'] });
  });

  it('setSessionOrder：拖拽提交即切 manual 并写入该账号新序，其余账号取活跃序', () => {
    const d = spec.init();
    spec.actions.setSessionOrder(d, 'w1', ['b', 'a'], { w1: ['b', 'a'], w2: ['x'] });
    expect(d.orderBy).toBe('manual');
    expect(d.sessionOrderByAccount.w1).toEqual(['b', 'a']);
    expect(d.sessionOrderByAccount.w2).toEqual(['x']);
  });

  it('syncSessionOrders 仅在 manual 模式生效', () => {
    const d = spec.init();
    spec.actions.syncSessionOrders(d, { w1: ['a'] });
    expect(d.sessionOrderByAccount).toEqual({});
    d.orderBy = 'manual';
    spec.actions.syncSessionOrders(d, { w1: ['a', 'b'] });
    expect(d.sessionOrderByAccount.w1).toEqual(['a', 'b']);
  });

  it('pinSessionOrder：被置顶会话在其账号（组+flat）手动序前插，其他账号仅调和', () => {
    const d = spec.init();
    d.orderBy = 'manual';
    d.sessionOrderByAccount = { w1: ['m1', 'p1'], [logic.FLAT_SESSION_ORDER_KEY]: ['m1', 'p1'] };
    const summaries = { m1: { updatedAt: 2 }, p1: { updatedAt: 1 } };
    const source = {
      members: { w1: ['p1', 'm1'], [logic.FLAT_SESSION_ORDER_KEY]: ['p1', 'm1'], w2: ['p1'] },
      summaries,
      rowState: { pinnedSessionIds: [], archivedSessionIds: [] },
    };
    spec.actions.pinSessionOrder(d, 'p1', ['w1', logic.FLAT_SESSION_ORDER_KEY], source);
    expect(d.sessionOrderByAccount.w1).toEqual(['p1', 'm1']);
    expect(d.sessionOrderByAccount[logic.FLAT_SESSION_ORDER_KEY]).toEqual(['p1', 'm1']);
    expect(d.sessionOrderByAccount.w2[0]).toBe('p1');
  });

  it('retainAccountKeys：消失的 workspace 键被清理（展开态与手动序同步收缩）', () => {
    const d = spec.init();
    d.groupExpansion = { w1: true, gone: true };
    d.sessionOrderByAccount = { w1: ['a'], gone: ['b'] };
    spec.actions.retainAccountKeys(d, ['w1', '', logic.FLAT_SESSION_ORDER_KEY]);
    expect(d.groupExpansion).toEqual({ w1: true });
    expect(d.sessionOrderByAccount).toEqual({ w1: ['a'] });
  });

  it('setArchivedFilter / setGroupExpanded 直写', () => {
    const d = spec.init();
    spec.actions.setArchivedFilter(d, 'only');
    spec.actions.setGroupExpanded(d, 'w1', true);
    expect(d.archivedFilter).toBe('only');
    expect(d.groupExpansion.w1).toBe(true);
  });
});

describe('displayTitle / workspaceDisplayTitle', () => {
  const t = (key) => (key === 'session.new' ? '新会话' : '未命名');

  it('blank 行显示本地化「新会话」，空标题（含全空白）显示「未命名」（title 已由 sessionTitle trim）', () => {
    expect(logic.displayTitle({ blank: true }, t)).toBe('新会话');
    expect(logic.displayTitle({ blank: false, title: '' }, t)).toBe('未命名');
    expect(logic.sessionTitle({ blank: false, title: '  ' })).toBe('');
    expect(logic.sessionTitle({ blank: true, title: '草稿' })).toBe('');
  });

  it('默认 workspace 存储标题映射为本地化默认名', () => {
    expect(logic.workspaceDisplayTitle(logic.DEFAULT_WORKSPACE_DIRECTORY, '默认工作区')).toBe('默认工作区');
    expect(logic.workspaceDisplayTitle('my-ws', '默认工作区')).toBe('my-ws');
  });
});
