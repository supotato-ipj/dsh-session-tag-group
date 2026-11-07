/**
 * Host 标签数据层（票 #4 / T3）：标签池 + 会话关联，落 storage domain 全局 JSON。
 *
 * 与 I/O 的分离：`createTagService({ domain, sessionExists })` 只依赖两个 seam——
 * - `domain`：storage domain 句柄（真实环境来自 `ctx.storageDomain.open(TAG_DOMAIN_SPEC)`；
 *   测试注入内存 backend，只需实现 `global.get()/set()`）。
 * - `sessionExists(sessionId)`：会话存在性谓词（真实环境由 index.js 组合
 *   workspaceRegistry 槽位 + sessionPersistence 持久检查；测试注入集合谓词）。
 *
 * 数据形状（全局 JSON，v2）：
 *   { v: 2, tags: string[], bySession: Record<sessionId, string[]>, mode: string }
 * - `tags`：全局标签池（不按 workspace 隔离），随打随建，按创建顺序稳定；
 *   一期不做池条目回收（无引用的标签保留，供再次勾选）。
 * - `bySession`：会话 → 标签名数组（与池同序约束之外保持设置顺序）。
 * - `mode`：会话浏览区视图模式（VIEW_MODES 之一），票 #5 起与标签数据同域持久化
 *   （Client 经 /session-tags 的 getViewMode/setViewMode 读写）。
 * - 颜色不入库：一期色点为固定映射，由 Client 纯逻辑按标签名派生（可测、可改）。
 *
 * 清理语义（spec 17/18 条 + 票 #4）：
 * - 删除会话：事件清理（index.js 挂 `api-session/removed` → forgetSession，先经
 *   存在性谓词核实，误报保守不剪）+ 惰性清理（每次读关联时剪除不存在会话），
 *   两路并存兜住插件停用期间的删除。
 * - 归档会话：仍在 workspace 槽位（workspaceRegistry.sessionIds 保留），存在性
 *   谓词判真 → 关联永不剪除，取消归档后原样回组。
 *
 * 并发：服务把所有读改写串在一条链上（真实域自身的写链只串行化落盘，
 * 不覆盖「读-改-写」之间的交错）。
 */

/** 全局文档版本。改形状时 +1 并在 normalizeLegacyGlobal（tagGlobalSchema.parse）里补迁移分支。 */
const TAG_GLOBAL_VERSION = 2;

/**
 * 会话浏览区视图模式全集（票 #5）：内置三模式 + 标签模式。
 * mode 字段取值限定于此；domain 版本升级须在 TAG_DOMAIN_SPEC.compatibleVersions
 * 声明旧版本（storage json backend 对落盘 unit 版本戳做校验，缺声明 →
 * version-mismatch → 插件激活失败）。
 */
export const VIEW_MODES = ['workspace', 'workspace-tree', 'flat', 'tag'];

/** 视图模式默认值（内置默认分组）。 */
export const DEFAULT_VIEW_MODE = 'workspace';

/** 会话/标签名的去重键：小写化（首见写法保留）。 */
function tagKey(name) {
  return name.toLowerCase();
}

/** 规整一个标签名：trim + 压缩内部空白。空串视为无效。 */
export function normalizeTagName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** 空的全局文档（首次写入与损坏兜底同形）。 */
export function EMPTY_TAG_GLOBAL() {
  return { v: TAG_GLOBAL_VERSION, tags: [], bySession: {}, mode: DEFAULT_VIEW_MODE };
}

/**
 * 全局文档 schema（duck-typed：storage domain 只要求 `safeParse`/`parse`
 * 两个方法；不引 zod 依赖，校验逻辑留在本可测模块）。
 * 宽进严出：接受旧版本/带多余字段的文档并规整到当前形状，让已落盘的数据
 * 在升级后仍可读（UI 层损坏不丢数据）；完全不像文档的输入才抛错。
 */
export const tagGlobalSchema = {
  safeParse(value) {
    try {
      return { success: true, data: tagGlobalSchema.parse(value) };
    } catch (error) {
      return { success: false, error };
    }
  },
  parse(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('tag global: not an object');
    }
    const tags = normalizePool(value.tags);
    const bySession = normalizeBySession(value.bySession, tags);
    // 迁移分支：v1 文档无 mode → 补默认；非法 mode 同样规整回默认（宽进，open 永不炸）。
    const mode = VIEW_MODES.includes(value.mode) ? value.mode : DEFAULT_VIEW_MODE;
    return { v: TAG_GLOBAL_VERSION, tags, bySession, mode };
  },
};

/**
 * 标签名序列的统一规整核（D2 内部去重）：trim + 压缩空白、丢空、tagKey 小写键
 * 去重（首见写法保留）、保序。`allowedKeys` 传入时仅保留白名单内的键
 * （bySession 挂载只认池内标签）；缺省不设白名单（池与目标集路径）。
 * 跨文件不共享：client.js 的 normalizeTagName 双实现是经典脚本限制 + parity
 * 测试锁定的既定取舍，不动。
 */
function normalizeTagNames(rawTags, allowedKeys) {
  const names = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawTags) ? rawTags : []) {
    const name = normalizeTagName(raw);
    if (name === '') continue;
    const key = tagKey(name);
    if (seen.has(key)) continue;
    if (allowedKeys !== undefined && !allowedKeys.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function normalizePool(rawTags) {
  return normalizeTagNames(rawTags);
}

function normalizeBySession(rawBySession, pool) {
  if (rawBySession === null || typeof rawBySession !== 'object' || Array.isArray(rawBySession)) return {};
  const poolKeys = new Set(pool.map(tagKey));
  const bySession = {};
  for (const [sessionId, rawTags] of Object.entries(rawBySession)) {
    if (typeof sessionId !== 'string' || sessionId === '') continue;
    const tags = normalizeTagNames(rawTags, poolKeys);
    if (tags.length > 0) bySession[sessionId] = tags;
  }
  return bySession;
}

/** 从「任何输入」规整出当前全局形状（读路径统一入口）。 */
function readGlobal(domain) {
  const raw = domain.global.get();
  if (raw === null || raw === undefined) return EMPTY_TAG_GLOBAL();
  try {
    return tagGlobalSchema.parse(raw);
  } catch {
    // 完全损坏的文档：回空态继续服务（数据仍在盘上，不被本服务覆写掉——
    // 只有下一次真实写才会以空态覆盖；这是 storage domain 全局单文档约束下
    // 的取舍：比整插件拒活更符合「UI 损坏不丢使用」）。
    return EMPTY_TAG_GLOBAL();
  }
}

/**
 * 创建标签服务。所有方法异步、可并发调用；读改写经内部链串行。
 * @param {object} deps
 * @param {object} deps.domain - storage domain 句柄（global.get/set）。
 * @param {(sessionId: string) => Promise<boolean>} deps.sessionExists - 存在性谓词；
 *   抛错或返回 false 之外的一切不确定性都按「存在」处理（保守不剪）。
 */
export function createTagService({ domain, sessionExists }) {
  if (typeof domain?.global?.get !== 'function' || typeof domain?.global?.set !== 'function') {
    throw new Error('createTagService: domain.global.get/set 缺失');
  }
  if (typeof sessionExists !== 'function') {
    throw new Error('createTagService: sessionExists 谓词缺失');
  }

  /** 存在性判定的保守语义：谓词抛错 = 不确定 = 视为存在（不剪）。 */
  async function existsOrUnknown(sessionId) {
    try {
      return await sessionExists(sessionId);
    } catch {
      return true;
    }
  }

  /** 剪除不存在会话的关联；返回是否发生了剪除。 */
  async function pruneDead(globalDoc) {
    const dead = [];
    for (const sessionId of Object.keys(globalDoc.bySession)) {
      if (!(await existsOrUnknown(sessionId))) dead.push(sessionId);
    }
    if (dead.length === 0) return false;
    for (const sessionId of dead) delete globalDoc.bySession[sessionId];
    return true;
  }

  /** 把未知标签补进池（随打随建），返回池副本。 */
  function ensureInPool(globalDoc, names) {
    const poolKeys = new Set(globalDoc.tags.map(tagKey));
    for (const name of names) {
      const key = tagKey(name);
      if (!poolKeys.has(key)) {
        globalDoc.tags.push(name);
        poolKeys.add(key);
      }
    }
  }

  let chain = Promise.resolve();
  /** 串行执行一次读改写（并发调用按提交顺序排队）。 */
  function enqueue(operation) {
    const run = chain.then(operation, operation);
    chain = run.then(() => {}, () => {});
    return run;
  }

  async function persist(globalDoc) {
    await domain.global.set(globalDoc);
  }

  return {
    /** 列出全局标签池（创建顺序）。 */
    listPool() {
      return enqueue(async () => {
        const doc = readGlobal(domain);
        return { pool: [...doc.tags] };
      });
    },

    /** 列出某会话的标签（读路径，先惰性剪除不存在会话）。 */
    listSessionTags({ sessionId }) {
      return enqueue(async () => {
        const doc = readGlobal(domain);
        if (await pruneDead(doc)) await persist(doc);
        return { tags: [...(doc.bySession[sessionId] ?? [])] };
      });
    },

    /** 全量快照：池 + 全部会话关联（Client 首屏与刷新用）。 */
    listAll() {
      return enqueue(async () => {
        const doc = readGlobal(domain);
        if (await pruneDead(doc)) await persist(doc);
        const bySession = {};
        for (const [sessionId, tags] of Object.entries(doc.bySession)) {
          bySession[sessionId] = [...tags];
        }
        return { pool: [...doc.tags], bySession };
      });
    },

    /**
     * 视图模式读取（票 #5：模式选择跨重启记忆，与标签数据同域）。
     */
    getViewMode() {
      return enqueue(async () => {
        const doc = readGlobal(domain);
        return { mode: doc.mode };
      });
    },

    /**
     * 视图模式写入：只改 mode 字段，不动标签数据；非法取值拒绝。
     */
    setViewMode({ mode }) {
      return enqueue(async () => {
        if (!VIEW_MODES.includes(mode)) {
          throw invalidArgs('setViewMode 需要 mode ∈ ' + VIEW_MODES.join('/'));
        }
        const doc = readGlobal(domain);
        doc.mode = mode;
        await persist(doc);
        return { mode: doc.mode };
      });
    },

    /**
     * 设置会话标签集（勾选即增、取消即移除的原子入口）。
     * 未知标签随打随建；会话不存在时拒绝（拒绝对死会话写入）。
     */
    setSessionTags({ sessionId, tags }) {
      return enqueue(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          throw invalidArgs('setSessionTags 需要 sessionId');
        }
        const doc = readGlobal(domain);
        if (await pruneDead(doc)) await persist(doc);
        if (!(await existsOrUnknown(sessionId))) {
          throw new TagServiceError('session-missing', `会话不存在：${sessionId}`);
        }
        // 规整目标标签集：trim/丢空/大小写去重，保序（normalizeTagNames 共享核，D2）。
        const names = normalizeTagNames(tags);
        ensureInPool(doc, names);
        if (names.length > 0) doc.bySession[sessionId] = names;
        else delete doc.bySession[sessionId];
        await persist(doc);
        return { tags: names, pool: [...doc.tags] };
      });
    },

    /** 按名新建并挂载（弹层输入框回车路径）。 */
    createAndAttach({ sessionId, name }) {
      return enqueue(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          throw invalidArgs('createAndAttach 需要 sessionId');
        }
        const normalized = normalizeTagName(name);
        if (normalized === '') throw invalidArgs('createAndAttach 需要非空标签名');
        const doc = readGlobal(domain);
        if (await pruneDead(doc)) await persist(doc);
        if (!(await existsOrUnknown(sessionId))) {
          throw new TagServiceError('session-missing', `会话不存在：${sessionId}`);
        }
        ensureInPool(doc, [normalized]);
        const current = doc.bySession[sessionId] ?? [];
        const key = tagKey(normalized);
        const next = current.some((existing) => tagKey(existing) === key)
          ? current
          : [...current, normalized];
        doc.bySession[sessionId] = next;
        await persist(doc);
        return { tag: normalized, tags: [...next], pool: [...doc.tags] };
      });
    },

    /**
     * 事件清理入口（`api-session/removed`）：会话被核实已消失才剪除关联。
     * @returns {{ pruned: boolean }}
     */
    forgetSession({ sessionId }) {
      return enqueue(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          throw invalidArgs('forgetSession 需要 sessionId');
        }
        const doc = readGlobal(domain);
        if (!(await existsOrUnknown(sessionId))) {
          if (doc.bySession[sessionId] === undefined) return { pruned: false };
          delete doc.bySession[sessionId];
          await persist(doc);
          return { pruned: true };
        }
        return { pruned: false };
      });
    },
  };
}

/** 服务业务错误（RPC 层转 { ok:false, error } 信封）。 */
export class TagServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TagServiceError';
    this.code = code;
  }
}

function invalidArgs(message) {
  return new TagServiceError('invalid-args', message);
}

/**
 * storage domain 声明（defineDomain 的裸形状 + 本模块自校验）。
 *
 * 特意不 import `@deepseek-ai/dsh-storage-domain`：`defineDomain` 只是调用方
 * 侧的校验恒等函数（源码已核），`open()` 只消费纯 spec 对象；不引 peer 依赖
 * 就没有 link 安装下的解析风险。名字须匹配 UNIT_NAME_RE（^[a-z][a-z0-9_]*$），
 * global schema 不得接受 null（null 是「从未写入」哨兵）——`tagGlobalSchema.parse(null)`
 * 抛错，满足该约束。
 */
export const TAG_DOMAIN_SPEC = {
  name: 'session_tags',
  version: TAG_GLOBAL_VERSION,
  // storage json backend 按 unit 版本戳校验（v1 的旧落盘必须能开，否则
  // version-mismatch 直接炸插件激活）；首次写盘后 unit 自动升到 v2 戳。
  compatibleVersions: [1],
  tables: {},
  global: {
    schema: tagGlobalSchema,
    initial: EMPTY_TAG_GLOBAL(),
  },
};
