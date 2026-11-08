/**
 * Host 标签数据层单测（票 #4 / T3）。
 *
 * seam（spec「Testing Decisions」已确认）：Host 标签服务的公开方法，注入内存
 * storage backend 与存在性谓词；只断言输入→输出，不触实现细节。
 *
 * 覆盖票面验收：
 * - 打标/移除、标签池列出、删除清理关联、归档保留关联；
 * - 随打随建、多标签、串行写链（并发不丢写）。
 */
import { describe, expect, it } from 'vitest';

import { createTagService, EMPTY_TAG_GLOBAL, TAG_DOMAIN_SPEC, tagGlobalSchema } from '../tag-store.js';

/** 内存 storage backend：只实现服务用到的 `global.get/set` 语义。 */
function makeMemoryDomain(initial) {
  let globalValue = initial ?? null;
  const writes = [];
  return {
    global: {
      get: () => globalValue,
      set: async (value) => {
        // 模拟真实域的写序：后端先落盘（一个微任务），内存后变。
        await Promise.resolve();
        globalValue = value;
        writes.push(value);
      },
    },
    writes,
  };
}

/** 全部会话视为存在（默认谓词）。 */
const everythingExists = async () => true;

/** 造一个会话存在性由集合决定的后端世界。 */
function makeWorld({ live = [], persistence = [] } = {}) {
  const liveSet = new Set(live);
  const persistSet = new Set(persistence);
  const sessionExists = async (sessionId) => liveSet.has(sessionId) || persistSet.has(sessionId);
  return { sessionExists, liveSet, persistSet };
}

async function serviceOver(domain, world = {}) {
  const { sessionExists = everythingExists } = world;
  return createTagService({ domain, sessionExists });
}

describe('删除会话 → 关联清理', () => {
  it('惰性清理：读写时剪除不再存在的会话关联（插件停用期间的删除由下次读写兜住）', async () => {
    const world = makeWorld({ live: ['s1', 's2'], persistence: ['s1', 's2'] });
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain, world);
    await service.setSessionTags({ sessionId: 's1', tags: ['a'] });
    await service.setSessionTags({ sessionId: 's2', tags: ['a', 'b'] });
    // s1 被删除：不在 live registry，也没有持久文件。
    world.liveSet.delete('s1');
    world.persistSet.delete('s1');
    const all = await service.listAll();
    expect(all.bySession).toEqual({ s2: ['a', 'b'] });
    expect(all.pool).toEqual(['a', 'b']);
  });

  it('事件清理：forgetSession 在会话确认消失后剪除其关联', async () => {
    const world = makeWorld({ live: ['s1', 's2'], persistence: ['s1', 's2'] });
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain, world);
    await service.setSessionTags({ sessionId: 's1', tags: ['a'] });
    await service.setSessionTags({ sessionId: 's2', tags: ['a'] });
    world.liveSet.delete('s1');
    world.persistSet.delete('s1');
    const result = await service.forgetSession({ sessionId: 's1' });
    expect(result).toEqual({ pruned: true });
    expect((await service.listAll()).bySession).toEqual({ s2: ['a'] });
  });

  it('不确定是否删除时不剪（保守）：liveness 事件误报不丢用户数据', async () => {
    const world = makeWorld({ live: [], persistence: ['s1'] });
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain, world);
    await service.setSessionTags({ sessionId: 's1', tags: ['a'] });
    world.persistSet.delete('s1');
    // 谓词抛错 = 无法核实；事件路径与惰性读路径都保守保留。
    const uncertain = createTagService({ domain, sessionExists: async () => { throw new Error('stat unavailable'); } });
    const result = await uncertain.forgetSession({ sessionId: 's1' });
    expect(result).toEqual({ pruned: false });
    expect((await uncertain.listAll()).bySession).toEqual({ s1: ['a'] });
  });

  it('剪除不存在的会话不产生多余写盘（无关联可剪时不动全局）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['a'] });
    const writesBefore = domain.writes.length;
    await service.forgetSession({ sessionId: 'ghost' });
    expect(domain.writes.length).toBe(writesBefore);
  });
});

describe('归档 → 关联保留', () => {
  it('归档会话仍在 workspace 槽位与归档集中，剪除必须跳过它（取消归档后原样回组）', async () => {
    const world = makeWorld({ live: ['s1', 'archived-1'], persistence: ['s1', 'archived-1'] });
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain, world);
    await service.setSessionTags({ sessionId: 'archived-1', tags: ['a'] });
    await service.setSessionTags({ sessionId: 's1', tags: [] });
    // 归档语义：world 谓词仍判 archived-1 存在（workspace 槽位保留）——触发剪除也不动它。
    const result = await service.forgetSession({ sessionId: 'archived-1' });
    expect(result).toEqual({ pruned: false });
    expect((await service.listSessionTags({ sessionId: 'archived-1' })).tags).toEqual(['a']);
    // 惰性路径同样保留。
    expect((await service.listAll()).bySession).toEqual({ 'archived-1': ['a'] });
  });
});

describe('写链串行（并发 RPC 不丢写）', () => {
  it('并发 setSessionTags/createAndAttach 全部生效（服务内串行化读改写）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await Promise.all([
      service.setSessionTags({ sessionId: 's1', tags: ['a'] }),
      service.createAndAttach({ sessionId: 's2', name: 'b' }),
      service.setSessionTags({ sessionId: 's3', tags: ['c'] }),
      service.createAndAttach({ sessionId: 's4', name: 'd' }),
    ]);
    const all = await service.listAll();
    expect(all.bySession).toEqual({ s1: ['a'], s2: ['b'], s3: ['c'], s4: ['d'] });
    expect(all.pool).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('打标与移除（勾选即增、取消即移除）', () => {
  it('设置会话标签集：写入的标签即会话标签', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    const result = await service.setSessionTags({ sessionId: 's1', tags: ['宁兰路桥'] });
    expect(result.tags).toEqual(['宁兰路桥']);
    expect(await service.listSessionTags({ sessionId: 's1' })).toEqual({ tags: ['宁兰路桥'] });
    expect(await service.listSessionTags({ sessionId: 's2' })).toEqual({ tags: [] });
  });

  it('多标签：一个会话可同时挂多个，顺序与设置一致', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    const result = await service.setSessionTags({ sessionId: 's1', tags: ['宁兰路桥', 'Obsidian', 'GTD'] });
    expect(result.tags).toEqual(['宁兰路桥', 'Obsidian', 'GTD']);
  });

  it('取消勾选即移除：重设为去掉该标签的集合即从会话移除', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['a', 'b'] });
    const result = await service.setSessionTags({ sessionId: 's1', tags: ['b'] });
    expect(result.tags).toEqual(['b']);
  });

  it('随打随建：设置时出现的未知标签自动进池，池按创建顺序稳定', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['b', 'a'] });
    await service.createAndAttach({ sessionId: 's2', name: 'c' });
    const pool = await service.listPool();
    expect(pool).toEqual({ pool: ['b', 'a', 'c'] });
  });

  it('移除会话的全部标签不删池条目（池条目一期不回收）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['a'] });
    await service.setSessionTags({ sessionId: 's1', tags: [] });
    expect(await service.listPool()).toEqual({ pool: ['a'] });
    expect(await service.listAll()).toEqual({ pool: ['a'], bySession: {} });
  });

  it('同一标签可挂多个会话（全局池不按 workspace 隔离）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['宁兰路桥'] });
    await service.setSessionTags({ sessionId: 's2', tags: ['宁兰路桥'] });
    const all = await service.listAll();
    expect(all.bySession).toEqual({ s1: ['宁兰路桥'], s2: ['宁兰路桥'] });
  });
});

describe('名称规整', () => {
  it('trim + 压缩空白；空名被丢弃；大小写不敏感去重（保留首见写法）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    const result = await service.setSessionTags({ sessionId: 's1', tags: ['  Obsidian  ', 'obsidian', '  ', 'GTD'] });
    expect(result.tags).toEqual(['Obsidian', 'GTD']);
    expect(await service.listPool()).toEqual({ pool: ['Obsidian', 'GTD'] });
  });
});

describe('全局 JSON 形状（落盘文档）', () => {
  it('写入的全局文档是规整的 v2 形状（含 mode），可被 schema 原样接受', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['a', 'b'] });
    expect(domain.writes[0]).toEqual({ v: 2, tags: ['a', 'b'], bySession: { s1: ['a', 'b'] }, mode: 'workspace' });
    expect(tagGlobalSchema.safeParse(domain.writes[0]).success).toBe(true);
  });
});

describe('标签服务：空池与空关联', () => {
  it('未写过全局时，标签池为空、会话标签为空（null 是「从未写入」哨兵）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    expect(await service.listPool()).toEqual({ pool: [] });
    expect(await service.listSessionTags({ sessionId: 's1' })).toEqual({ tags: [] });
    expect(await service.listAll()).toEqual({ pool: [], bySession: {} });
  });

  it('损坏的全局文档不会炸开服务：规整回空态（UI 层损坏不丢数据由 Host 侧把关）', async () => {
    const domain = makeMemoryDomain({ v: 99, nonsense: true });
    const service = await serviceOver(domain);
    expect(await service.listPool()).toEqual({ pool: [] });
  });

  it('全局 schema 拒绝 null（storage domain 的「从未写入」哨兵不得被当数据）', () => {
    expect(tagGlobalSchema.safeParse(null).success).toBe(false);
    expect(tagGlobalSchema.safeParse(EMPTY_TAG_GLOBAL()).success).toBe(true);
  });
});

describe('视图模式持久化（票 #5 / T4：domain v1→v2 加 mode 字段）', () => {
  it('EMPTY_TAG_GLOBAL 是 v2 形状且 mode 默认 workspace', () => {
    expect(EMPTY_TAG_GLOBAL()).toEqual({ v: 2, tags: [], bySession: {}, mode: 'workspace' });
  });

  it('parse 迁移：v1 文档（无 mode）读出为 v2 形状并补默认 mode（旧落盘数据升级后可读）', () => {
    const migrated = tagGlobalSchema.parse({ v: 1, tags: ['a'], bySession: { s1: ['a'] } });
    expect(migrated).toEqual({ v: 2, tags: ['a'], bySession: { s1: ['a'] }, mode: 'workspace' });
  });

  it('parse：合法 mode 原样保留；非法/缺失 mode 规整回默认（宽进，open 永不炸）', () => {
    expect(tagGlobalSchema.parse({ v: 2, tags: [], bySession: {}, mode: 'tag' }).mode).toBe('tag');
    expect(tagGlobalSchema.parse({ v: 2, tags: [], bySession: {}, mode: 'workspace-tree' }).mode).toBe('workspace-tree');
    expect(tagGlobalSchema.parse({ v: 2, tags: [], bySession: {}, mode: 'nonsense' }).mode).toBe('workspace');
    expect(tagGlobalSchema.parse({ v: 2, tags: [], bySession: {}, mode: 42 }).mode).toBe('workspace');
    expect(tagGlobalSchema.parse({ v: 1, tags: [], bySession: {} }).mode).toBe('workspace');
  });

  it('getViewMode → 默认 workspace；setViewMode 写入并可回读，落盘文档是 v2 形状', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    expect(await service.getViewMode()).toEqual({ mode: 'workspace' });
    expect(await service.setViewMode({ mode: 'tag' })).toEqual({ mode: 'tag' });
    expect(await service.getViewMode()).toEqual({ mode: 'tag' });
    expect(domain.writes.at(-1)).toEqual({ v: 2, tags: [], bySession: {}, mode: 'tag' });
  });

  it('setViewMode 不动标签数据（只写 mode）', async () => {
    const domain = makeMemoryDomain();
    const service = await serviceOver(domain);
    await service.setSessionTags({ sessionId: 's1', tags: ['a'] });
    await service.setViewMode({ mode: 'flat' });
    expect(await service.listAll()).toEqual({ pool: ['a'], bySession: { s1: ['a'] } });
    expect(domain.writes.at(-1)).toEqual({ v: 2, tags: ['a'], bySession: { s1: ['a'] }, mode: 'flat' });
  });

  it('setViewMode 拒绝非法 mode（invalid-args）', async () => {
    const service = await serviceOver(makeMemoryDomain());
    await expect(service.setViewMode({ mode: 'bogus' })).rejects.toMatchObject({ code: 'invalid-args' });
    await expect(service.setViewMode({})).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it('domain spec 升 v2 且 compatibleVersions 含 1（storage json backend 对 unit 版本戳做校验，缺了会 version-mismatch → 插件激活失败）', () => {
    expect(TAG_DOMAIN_SPEC.version).toBe(2);
    expect(TAG_DOMAIN_SPEC.compatibleVersions).toContain(1);
  });
});
