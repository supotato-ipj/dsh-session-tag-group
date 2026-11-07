/**
 * Client 半边：shadow 内置会话浏览区（`sidebar.workspaces`），默认模式基线（票 #2 / T1）。
 *
 * 形态：`window.__ModuleLoader__.load({ id, factory(require) })`，id 必须等于包名
 * （模板：@deepseek-ai/dsh-client-ui-workspace lib/client.js:1-11、@local/gtd-workbench client.js:16-18）。
 * 无构建步骤：经典脚本、无 JSX，全部用 `React.createElement`。
 *
 * shadow 机制（ADR-0001）：
 * - 目标槽 `sidebar.workspaces` 由侧栏外壳声明（single, root；dsh-client-ui-sidebar lib/client.js:757-760，
 *   渲染点 541-549 `renderSlot("sidebar.workspaces", { wide, expandSidebar })`）。
 * - 现占用者是内置 WorkspaceBrowser（dsh-client-ui-workspace lib/client.js:6050-6079，未设 priority）。
 * - single 槽按 priority 选举，「后来注册者拿更低数值」（dsh-cordis-client-runner lib/client.js:431-437,
 *   548-549 `nextPriority = 0` 起步）；内置占用者无显式 priority。本插件以显式 `SHADOW_PRIORITY` 参选，
 *   首次装载后用 Inspect `client/Slots/listSubTree root="sidebar.workspaces"` 实证选举方向。
 *
 * 复刻范围：T1（票 #2）——workspace 节列表、会话行（状态点/时间/置顶标记）、打开会话、
 * workspace 选中态、搜索（本地过滤 + sessions.search 合并）、ViewOptionsMenu（分组/排序/归档筛选）、
 * 手动排序拖拽、水位线（显示更多）。T2（票 #3）增量——workspace 添加（目录流 PickFlow）/
 * 重命名/删除对话框、添加工作区按钮、会话/workspace 悬停卡。归档/置顶/会话重命名/
 * 归档确认框/行 toast 由内置的独立 slot 注册继续供给（见「子座位保活」），本插件通过
 * 共享 store 探测（快捷键/重命名请求/工作区动作请求/toast 通道）与共享 view store
 * 句柄（归档 toast 的筛选动作、pin 本地序）与内置保持一致。**不做**（T3/T4）：标签任何内容。
 *
 * 子座位保活（07 简报 §1）：本注册原样声明内置的五个 children（directoryFlow / session.row.action /
 * session.row.leading / session.row.trailing / session.row.hover），并以相同 props renderSlot——
 * 内置插件对 row.action（archive/pin 按钮，6099-6114）、contextMenu.content session 菜单（6080-6091）、
 * shell.overlay（重命名/归档确认/行 toast，6115-6137）的注册都是**独立 inject 调用**，不随父座位选举
 * 消失，继续经本 shadow 的 renderSlot 渲染。
 *
 * 样式策略：内置插件的样式表在其 client 模块物化时注入（style[data-plugin-css]，uiw client.js:1740-1746、
 * 1957-1963）；shadow 后内置插件仍启用，样式仍在——本文件直接复用同一批编译类名（WB_/RW_ 映射表），
 * 升级 DSH 后只需刷新这两张映射表（ADR-0001 的人工回归义务）。
 *
 * 数据面：inject workspaces/sessions/uiWorkspace/contextMenus/remoteAccess 等服务
 * （签名见 05 笔记；归属以 workspace.sessionIds 为权威，owningGroupKey）。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-session-tags',
  factory(require) {
    /** 界面文案命名空间（不得与内置 "workspace" 重名：同 ns 同语言重复注册会抛错）。 */
    const NS = 'session-tags';
    /** shadow 目标槽名。 */
    const SLOT_NAME = 'sidebar.workspaces';
    /**
     * 选举优先级：single 槽低数值者胜（runner lib/client.js:548-549「later registration receives
     * a lower priority」、nextPriority=0 起步）。内置占用者无 priority。取 -10：无论 undefined
     * 归一为 0 还是 +Inf，都应落在其后；首次装载用 Inspect 实证，若方向相反则翻转此值。
     */
    const SHADOW_PRIORITY = -10;
    /** 视图状态持久化键：与内置 view store 同键（uiw client.js:1275），禁用回退时内置无缝接续。 */
    const VIEW_PERSIST_KEY = 'dsh.workspace.view.v5';
    /** 平铺模式手动序的账号键（uiw client.js:1257）。 */
    const FLAT_SESSION_ORDER_KEY = '__flat_session_order__';
    /** 默认 workspace 的存储标题（uiw client.js:1951）。 */
    const DEFAULT_WORKSPACE_DIRECTORY = 'default-workspace';

    const EXPAND_SLIDE_MS = 300;
    const SEARCH_DEBOUNCE_MS = 250;
    const SEARCH_QUERY_MAX_CODE_UNITS = 500;
    const SESSION_WATERMARK_BASE = 5;
    const SESSION_WATERMARK_AUTO_MAX = 50;
    const MIN_TITLE_REVEAL_PX = 8;
    const TITLE_MARQUEE_PX_PER_MS = 0.03;

    /**
     * 内置 WorkspaceBrowser.module.css / Rows.module.css 的编译类名映射
     * （uiw client.js:1747-1794、1964-2005）。样式本体由内置插件的 style 标签提供，
     * shadow 后仍然生效；DSH 升级后如类名漂移，只需重抽这两张表。
     */
    const WB = {
      archiveActivity: 'GAkraW_archiveActivity',
      clearButton: 'GAkraW_clearButton',
      deleteAction: 'GAkraW_deleteAction',
      deleteStatus: 'GAkraW_deleteStatus',
      empty: 'GAkraW_empty',
      emptyAction: 'GAkraW_emptyAction',
      emptyState: 'GAkraW_emptyState',
      fade: 'GAkraW_fade',
      flatList: 'GAkraW_flatList',
      groupSection: 'GAkraW_groupSection',
      headerActions: 'GAkraW_headerActions',
      headerActionsHidden: 'GAkraW_headerActionsHidden',
      iconButton: 'GAkraW_iconButton',
      list: 'GAkraW_list',
      listArea: 'GAkraW_listArea',
      listTopDropActive: 'GAkraW_listTopDropActive',
      listTopDropIndicator: 'GAkraW_listTopDropIndicator',
      rail: 'GAkraW_rail',
      renameError: 'GAkraW_renameError',
      renameInput: 'GAkraW_renameInput',
      root: 'GAkraW_root',
      search: 'GAkraW_search',
      searchButton: 'GAkraW_searchButton',
      searchExpanded: 'GAkraW_searchExpanded',
      searchInput: 'GAkraW_searchInput',
      searchSlot: 'GAkraW_searchSlot',
      searchSlotExpanded: 'GAkraW_searchSlotExpanded',
      searchSpacingMotion: 'GAkraW_searchSpacingMotion',
      searchStatus: 'GAkraW_searchStatus',
      searchTree: 'GAkraW_searchTree',
      sectionHeader: 'GAkraW_sectionHeader',
      sectionLabel: 'GAkraW_sectionLabel',
      sectionLabelHidden: 'GAkraW_sectionLabelHidden',
      sessionOverflowButton: 'GAkraW_sessionOverflowButton',
      skeletonBar: 'GAkraW_skeletonBar',
      skeletonBarWide: 'GAkraW_skeletonBarWide',
      skeletonBars: 'GAkraW_skeletonBars',
      skeletonDot: 'GAkraW_skeletonDot',
      skeletonRow: 'GAkraW_skeletonRow',
      treeBody: 'GAkraW_treeBody',
      viewOptionsMenu: 'GAkraW_viewOptionsMenu',
      wide: 'GAkraW_wide',
      workspaceDropAfter: 'GAkraW_workspaceDropAfter',
      workspaceDropBefore: 'GAkraW_workspaceDropBefore',
    };
    const RW = {
      archived: 'wnFoaW_archived',
      arrow: 'wnFoaW_arrow',
      arrowOpen: 'wnFoaW_arrowOpen',
      chevron: 'wnFoaW_chevron',
      dot: 'wnFoaW_dot',
      dragPreview: 'wnFoaW_dragPreview',
      dropAfter: 'wnFoaW_dropAfter',
      dropBefore: 'wnFoaW_dropBefore',
      folder: 'wnFoaW_folder',
      folderActive: 'wnFoaW_folderActive',
      iconButton: 'wnFoaW_iconButton',
      menuOpen: 'wnFoaW_menuOpen',
      pinIndicator: 'wnFoaW_pinIndicator',
      pinnedAction: 'wnFoaW_pinnedAction',
      projectRow: 'wnFoaW_projectRow',
      projectText: 'wnFoaW_projectText',
      rowActions: 'wnFoaW_rowActions',
      rowQuickActions: 'wnFoaW_rowQuickActions',
      rowResting: 'wnFoaW_rowResting',
      searchResultHeading: 'wnFoaW_searchResultHeading',
      searchResultMeta: 'wnFoaW_searchResultMeta',
      searchResultRow: 'wnFoaW_searchResultRow',
      searchResultSnippet: 'wnFoaW_searchResultSnippet',
      searchResultTitle: 'wnFoaW_searchResultTitle',
      searchResultWorkspace: 'wnFoaW_searchResultWorkspace',
      selected: 'wnFoaW_selected',
      sessionRow: 'wnFoaW_sessionRow',
      slot: 'wnFoaW_slot',
      time: 'wnFoaW_time',
      timestamp: 'wnFoaW_timestamp',
      title: 'wnFoaW_title',
      visuallyHidden: 'wnFoaW_visuallyHidden',
      // T2 悬停卡新增（Rows.module.css 映射 uiw client.js:1964-2005）
      hoverArchived: 'wnFoaW_hoverArchived',
      hoverContent: 'wnFoaW_hoverContent',
      hoverPath: 'wnFoaW_hoverPath',
      hoverStatus: 'wnFoaW_hoverStatus',
      hoverTime: 'wnFoaW_hoverTime',
      hoverTitle: 'wnFoaW_hoverTitle',
      meta: 'wnFoaW_meta',
    };
    /**
     * WorkspacePicker.module.css 的编译类名映射（uiw client.js:2724-2731）。
     * 样式本体由内置插件物化时注入（style[data-plugin-css]，uiw client.js:2716-2723）；
     * DSH 升级后如类名漂移，与 WB_/RW_ 一并重抽。
     */
    const WP = {
      disambiguated: 'ZOVoma_disambiguated',
      menuStatus: 'ZOVoma_menuStatus',
      modalAction: 'ZOVoma_modalAction',
      modalError: 'ZOVoma_modalError',
      pathSuffix: 'ZOVoma_pathSuffix',
      title: 'ZOVoma_title',
    };

    /** 极简 clsx（内置同款语义，uiw client.js:1720-1735）。 */
    function clsx() {
      const parts = [];
      for (const value of arguments) {
        if (!value) continue;
        if (typeof value === 'string') parts.push(value);
        else if (Array.isArray(value)) { const inner = clsx(...value); if (inner) parts.push(inner); }
        else for (const key of Object.keys(value)) if (value[key]) parts.push(key);
      }
      return parts.join(' ');
    }

    // =====================================================================
    // 纯逻辑层（02 笔记 §6 对齐；全部无 React、无 DOM，经 module.logic 暴露给
    // vitest 直测——测试 seam 已在 spec「Testing Decisions」与用户确认）。
    // =====================================================================

    function isWindowsStylePath(value) {
      return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
    }

    /** POSIX home 目录缩写为 `~`/`~/…`（uiw client.js:848-856；悬停卡 T2 才用到，逻辑一并复刻）。 */
    function abbreviateHomePath(path, home) {
      if (home === undefined || home === '') return path;
      if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path;
      const root = home.replace(/\/+$/, '');
      if (root === '' || root === '/') return path;
      if (path.replace(/\/+$/, '') === root) return '~';
      if (path.startsWith(root + '/')) return '~' + path.slice(root.length);
      return path;
    }

    /** 路径尾段（uiw client.js:863-867）。 */
    function workspaceTitleOf(path) {
      const trimmed = path.replace(/[/\\]+$/, '');
      const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
      return trimmed.slice(separator + 1);
    }

    /** 会话归属：workspace.sessionIds 权威（uiw client.js:874-876）。 */
    function owningGroupKey(workspaces, sessionId) {
      const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
      return owner ? owner.workspaceId : '';
    }

    /** 主视图会话 id（retainedBy.mainView > 0，uiw client.js:877-879）。 */
    function mainSessionId(list) {
      for (const session of Object.values(list.byId)) {
        if ((session.retainedBy.mainView ?? 0) > 0) return session.id;
      }
      return undefined;
    }

    /** 未分组桶回退显示名：cwd 尾段（uiw client.js:886-890）。 */
    function workspaceLabel(cwd) {
      if (cwd === undefined || cwd === '') return '';
      const base = workspaceTitleOf(cwd);
      return base !== '' ? base : cwd;
    }

    /**
     * 最近活跃排序：updatedAt 降序 + session id 字典序升序 tie-break
     * （uiw client.js:897-909）。无 summary 的成员暂缺。
     */
    function orderByRecency(sessionIds, summaries) {
      return sessionIds
        .flatMap((id) => {
          const summary = summaries[id];
          if (summary === undefined) return [];
          return [{ id, rank: summary.updatedAt }];
        })
        .sort((a, b) => {
          if (a.rank !== b.rank) return b.rank - a.rank;
          return a.id < b.id ? -1 : 1;
        })
        .map((member) => member.id);
    }

    /**
     * 手动序调和：置顶（非归档）在最前（按 pinnedSessionIds 顺序）→ 已存手动序 →
     * 其余按 recency → 归档在最后（uiw client.js:919-947）。
     */
    function reconcileManualOrder(memberIds, savedOrder, summaries, rowState) {
      const members = new Map(memberIds.map((id) => [id, id]));
      const included = new Set();
      const ordered = [];
      for (const key of savedOrder ?? []) {
        const id = members.get(key);
        if (id === undefined || included.has(key)) continue;
        ordered.push(id);
        included.add(key);
      }
      const archived = new Set(rowState?.archivedSessionIds);
      const pins = [];
      for (const sessionId of rowState?.pinnedSessionIds ?? []) {
        const id = members.get(sessionId);
        if (id === undefined || included.has(id) || archived.has(id) || summaries[id] === undefined) continue;
        pins.push(id);
        included.add(id);
      }
      const ordinary = [];
      const archives = [];
      for (const id of orderByRecency([...members.values()].filter((id) => !included.has(id)), summaries)) {
        if (archived.has(id)) archives.push(id);
        else ordinary.push(id);
      }
      return [...pins, ...ordered, ...ordinary, ...archives];
    }

    /** 当前选中的空白「新会话」恒排第一（uiw client.js:954-957）。 */
    function pinCurrentBlank(order, currentBlank) {
      if (currentBlank === undefined) return [...order];
      return [currentBlank, ...order.filter((id) => id !== currentBlank)];
    }

    /**
     * 可见性：subagent 子会话不显示；blank 只显示当前选中那个；归档按 filter
     * （default 隐藏 / show 全显 / only 仅归档）（uiw client.js:964-974）。
     */
    function sessionVisible(session, current, archived, archivedFilter) {
      if (session.origin === 'subagent') return false;
      if (session.blank && session.id !== current) return false;
      switch (archivedFilter) {
        case 'default': return !archived.has(session.id);
        case 'show': return true;
        case 'only': return archived.has(session.id);
        default: return false;
      }
    }

    /** blank 占位行 → pinned 行 → 其余行，各分区内部保持调用方顺序（uiw client.js:979-991）。 */
    function sectionMembers(members, pinned, archived) {
      const placeholders = [];
      const leading = [];
      const rest = [];
      for (const member of members) {
        if (member.blank) placeholders.push(member);
        else if (!archived.has(member.id) && pinned.has(member.id)) leading.push(member);
        else rest.push(member);
      }
      return [...placeholders, ...leading, ...rest];
    }

    /** 行标题：blank 为空串走本地化「新会话」（uiw client.js:998-1000）。 */
    function sessionTitle(session) {
      return session.blank ? '' : (session.title?.trim() ?? '');
    }

    function buildGroup(key, workspaceId, cwd, createdAt, label, members) {
      return { key, workspaceId, cwd, createdAt, label, sessions: [...members] };
    }

    /** 未分组桶顺序：存储手动序或 recency 兜底（uiw client.js:1013-1020）。 */
    function orderedUngrouped(members, stored, summaries) {
      const byId = new Map(members.map((session) => [session.id, session]));
      const ids = stored === undefined
        ? orderByRecency(members.map((session) => session.id), summaries)
        : reconcileManualOrder(members.map((session) => session.id), stored, summaries);
      return ids.flatMap((id) => {
        const session = byId.get(id);
        return session === undefined ? [] : [session];
      });
    }

    /** 按 workspaces 传入顺序逐个建组；组外散会话进「未分组」桶（uiw client.js:1027-1046）。 */
    function groupByWorkspace(list, workspaces, archived, archivedFilter, ungroupedOrder) {
      const current = mainSessionId(list);
      const groups = [];
      const accounted = new Set();
      for (const workspace of workspaces) {
        const members = [];
        for (const id of workspace.sessionIds) {
          const summary = list.byId[id];
          if (summary === undefined) continue;
          accounted.add(id);
          if (!sessionVisible(summary, current, archived, archivedFilter)) continue;
          members.push(summary);
        }
        if (archivedFilter === 'only' && members.length === 0) continue;
        groups.push(buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members));
      }
      const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== undefined && !accounted.has(s.id) && sessionVisible(s, current, archived, archivedFilter));
      if (stray.length > 0) groups.push(buildGroup('', undefined, undefined, undefined, '', orderedUngrouped(stray, ungroupedOrder, list.byId)));
      return groups;
    }

    function visiblePendingKind(kind) {
      if (kind === 'approval' || kind === 'plan-review' || kind === 'question') return kind;
      return undefined;
    }

    function runningChildCount(list, parentId, statuses) {
      const catalog = list.projectionsBySession[parentId]?.values.subagentCatalog;
      if (catalog === undefined) return 0;
      return catalog.reduce((count, child) => {
        const running = statuses.get(child.id)?.running ?? list.byId[child.id]?.running;
        return count + (running === true ? 1 : 0);
      }, 0);
    }

    /** 会话行派生结构（uiw client.js:1059-1075）。 */
    function sessionNode(s, list, statuses, pinned, archived) {
      const status = statuses.get(s.id);
      const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind);
      const node = {
        id: s.id,
        title: sessionTitle(s),
        blank: s.blank,
        running: status?.running ?? s.running,
        runningSubagentCount: runningChildCount(list, s.id, statuses),
        completed: status?.completionUnread === true,
        pinned: !archived.has(s.id) && pinned.has(s.id),
        archived: archived.has(s.id),
        updatedAt: s.updatedAt,
      };
      if (s.cwd !== undefined && s.cwd !== '') node.cwd = s.cwd;
      if (pendingInteraction !== undefined) node.pendingInteraction = pendingInteraction;
      return node;
    }

    /** 分组计算：expand/containsCurrent + 展开组套 sectionMembers+sessionNode（uiw client.js:1092-1114）。 */
    function deriveGroups(list, workspaces, rowState, statuses, view) {
      const archived = new Set(rowState.archivedSessionIds);
      const pinned = new Set(rowState.pinnedSessionIds);
      const expandedGroups = new Set(view.expandedGroups);
      const current = mainSessionId(list);
      const currentGroup = current === undefined ? undefined : owningGroupKey(workspaces, current);
      const groups = [];
      for (const g of groupByWorkspace(list, workspaces, archived, rowState.archivedFilter, view.ungroupedOrder)) {
        const expanded = expandedGroups.has(g.key);
        groups.push({
          key: g.key,
          workspaceId: g.workspaceId,
          cwd: g.cwd,
          createdAt: g.createdAt,
          label: g.label,
          sessionCount: g.sessions.length,
          expanded,
          containsCurrent: g.key === currentGroup,
          sessions: expanded
            ? sectionMembers(g.sessions, pinned, archived).map((session) => sessionNode(session, list, statuses, pinned, archived))
            : [],
        });
      }
      return groups;
    }

    /** 平铺成员全集：含归档（visibleSessionIds "show"）（uiw client.js:1120-1122）。 */
    function sessionMemberIds(list) {
      return visibleSessionIds(list, [], 'show');
    }

    function visibleSessionIds(list, archivedSessionIds, archivedFilter) {
      const archived = new Set(archivedSessionIds);
      const current = mainSessionId(list);
      return list.ids.filter((id) => {
        const s = list.byId[id];
        return s !== undefined && sessionVisible(s, current, archived, archivedFilter);
      });
    }

    /** 平铺派生：可见成员按调用方顺序过 sectionMembers（uiw client.js:1147-1155）。 */
    function deriveFlat(list, sessionIds, rowState, statuses) {
      const archived = new Set(rowState.archivedSessionIds);
      const pinned = new Set(rowState.pinnedSessionIds);
      const current = mainSessionId(list);
      const sessions = sectionMembers(sessionIds.flatMap((id) => {
        const session = list.byId[id];
        return session !== undefined && sessionVisible(session, current, archived, rowState.archivedFilter) ? [session] : [];
      }), pinned, archived);
      return sessions.map((session) => sessionNode(session, list, statuses, pinned, archived));
    }

    /**
     * 搜索合并：本地匹配（标题/cwd 工作区名/session id 子串，大小写不敏感，blank 排除）
     * 按 recency 排前，Host 内容结果随后，去重、limit 截断（uiw client.js:1170-1222）。
     */
    function deriveSearchResults(list, workspaces, query, archivedSessionIds, archivedFilter, statuses, content, limit) {
      const q = query.trim().toLowerCase();
      if (q === '') return { items: [], hasMore: false };
      const archived = new Set(archivedSessionIds);
      const current = mainSessionId(list);
      const workspaceBySession = new Map();
      for (const workspace of workspaces) {
        for (const sessionId of workspace.sessionIds) {
          if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title);
        }
      }
      const labelOf = (summary) => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd);
      const contentBySession = new Map();
      for (const item of content.items) if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item);
      const local = [];
      for (const id of list.ids) {
        const summary = list.byId[id];
        if (summary === undefined || summary.blank || !sessionVisible(summary, current, archived, archivedFilter)) continue;
        if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q) || summary.id.toLowerCase().includes(q)) local.push(summary);
      }
      const localById = new Map(local.map((summary) => [summary.id, summary]));
      const orderedLocal = orderByRecency(local.map((summary) => summary.id), list.byId).map((id) => localById.get(id));
      const ordered = [];
      const included = new Set();
      const include = (summary) => {
        if (included.has(summary.id)) return;
        included.add(summary.id);
        ordered.push(summary);
      };
      for (const summary of orderedLocal) include(summary);
      for (const item of content.items) {
        const summary = list.byId[item.sessionId];
        if (summary !== undefined && !summary.blank && sessionVisible(summary, current, archived, archivedFilter)) include(summary);
      }
      return {
        items: ordered.slice(0, limit).map((summary) => {
          const match = contentBySession.get(summary.id);
          const status = statuses.get(summary.id);
          const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind);
          const row = {
            id: summary.id,
            title: sessionTitle(summary),
            workspace: labelOf(summary),
            running: status?.running ?? summary.running,
            runningSubagentCount: runningChildCount(list, summary.id, statuses),
            completed: status?.completionUnread === true,
            archived: archived.has(summary.id),
          };
          if (pendingInteraction !== undefined) row.pendingInteraction = pendingInteraction;
          if (match !== undefined) row.snippet = match.snippet;
          return row;
        }),
        hasMore: content.hasMore || ordered.length > limit,
      };
    }

    /** workspace-tree 嵌套父查找：最长前缀目录匹配，排除自身（uiw client.js:1224-1246）。 */
    function folderPath(path) {
      const normalized = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\') ? path.replaceAll('\\', '/') : path;
      return normalized.replace(/\/+$/, '');
    }

    function owningParentFolder(path, parents) {
      const child = folderPath(path);
      let owner;
      let length = -1;
      for (const parent of parents) {
        const root = folderPath(parent);
        if (root.length > length && child !== root && child.startsWith(root + '/')) {
          owner = parent;
          length = root.length;
        }
      }
      return owner;
    }

    /** workspace 存储标题 → 显示标题（uiw client.js:1950-1952）。 */
    function workspaceDisplayTitle(title, localizedDefault) {
      return title === DEFAULT_WORKSPACE_DIRECTORY ? localizedDefault : title;
    }

    /**
     * 同名 workspace 的消歧路径尾段（uiw client.js:2697-2712）：标题唯一者无条目；
     * 同名者各取「最短的、无其他同名行与之相同的尾段」（slice(-(2n-1)) 个分段元素，
     * 分隔符随 split 保留在段里）。
     */
    function distinguishingPathSuffixes(workspaces) {
      const rows = workspaces.map((workspace) => ({
        ...workspace,
        parts: workspace.path.split(/([\\/])/),
      }));
      const suffix = (parts, count) => parts.slice(-(2 * count - 1)).join('');
      const suffixes = new Map();
      for (const row of rows) {
        const peers = rows.filter((other) => other !== row && other.title === row.title);
        if (peers.length === 0) continue;
        let count = 1;
        while (2 * count - 1 < row.parts.length && (suffix(row.parts, count) === '' || peers.some((peer) => suffix(peer.parts, count) === suffix(row.parts, count)))) count++;
        suffixes.set(row.id, suffix(row.parts, count));
      }
      return suffixes;
    }

    /**
     * workspace 重命名对话框的校验规则（uiw client.js:1805-1807）：trim 非空、
     * 不与存储标题相同、不与其他 workspace 标题重名（重名比较用传入列表的
     * title 字段，排除自身；提交进行中一律 blocked）。
     */
    function workspaceRenameReview(draft, request, workspaces, renaming) {
      const trimmed = draft.trim();
      const duplicate = request !== null && trimmed !== '' && workspaces.some((workspace) => workspace.workspaceId !== request.workspaceId && workspace.title === trimmed);
      const blocked = renaming || trimmed === '' || request === null || trimmed === request.storedTitle || duplicate;
      return { trimmed, duplicate, blocked };
    }

    /**
     * 悬停卡时间变体：距离值套 ago 模板、now 桶保持裸词（uiw client.js:2123-2126）。
     * relative 由组件注入（P.relativeTime），纯逻辑层不依赖 primitives。
     */
    function hoverTimeLabel(relative, updatedAt, now, t) {
      const { unit, n } = relative(updatedAt, now);
      return unit === 'now' ? t('time.now') : t('time.ago', { t: t('time.' + unit, { n }) });
    }

    /**
     * 悬停卡绝对创建时间：走词表 date.ymd 模板 + 两位补零本地时分
     * （uiw client.js:2132-2140；不用 toLocaleString——那会跟浏览器语言混排）。
     */
    function createdLabel(createdAt, t) {
      const date = new Date(createdAt);
      const pad2 = (value) => String(value).padStart(2, '0');
      return t('hover.created', { time: `${t('date.ymd', {
        y: date.getFullYear(),
        m: date.getMonth() + 1,
        d: date.getDate(),
      })} ${pad2(date.getHours())}:${pad2(date.getMinutes())}` });
    }

    /**
     * 悬停卡状态行（uiw client.js:2401-2402）：归档行剔除 done/idle 状态，
     * 活动态（warning/ongoing）保留。
     */
    function hoverStatuses(node, t) {
      return sessionStatuses(node, t).filter((status) => !(node.archived && (status.state === 'done' || status.state === 'idle')));
    }

    /**
     * 添加工作区目录流的状态机（uiw client.js:2740-2900 语义抽取）：
     * state = {flowOpen, pickingFolder, errorOpen, modalError}；reduce 返回
     * {state, effects}，effects 由组件执行（close=收外层菜单、pick=交外层采纳后续）。
     * 语义：openFlow 先收菜单再清错误开流（2815-2820）；采纳忙时流保持打开（2831-2849）；
     * 成功关流交 onPick、失败关流进错误模态（2807-2814）；占位者消失即收流（2753-2755）。
     */
    function createPickFlowMachine() {
      const initial = () => ({ flowOpen: false, pickingFolder: false, errorOpen: false, modalError: null });
      const flowBusy = (state) => state.flowOpen || state.pickingFolder;
      const reduce = (state, event) => {
        switch (event.type) {
          case 'openFlow':
          case 'selectAdd':
            return { state: { ...state, flowOpen: true, errorOpen: false, modalError: null }, effects: [{ type: 'close' }] };
          case 'pickSubmitted':
            return { state: { ...state, pickingFolder: true }, effects: [] };
          case 'adoptSucceeded':
            return { state: { ...state, flowOpen: false, pickingFolder: false }, effects: [{ type: 'pick', workspaceId: event.workspaceId }] };
          case 'adoptFailed':
            return { state: { ...state, flowOpen: false, pickingFolder: false, errorOpen: true, modalError: event.message }, effects: [] };
          case 'flowCancel':
          case 'flowUnavailable':
            return { state: { ...state, flowOpen: false }, effects: [] };
          case 'flowError':
            return { state: { ...state, flowOpen: false, errorOpen: true, modalError: event.message }, effects: [] };
          case 'errorDismiss':
            return { state: { ...state, errorOpen: false, modalError: null }, effects: [] };
          default:
            return { state, effects: [] };
        }
      };
      /** 仅当 picker 开着、add 是唯一菜单入口且不忙时自动直开目录流（uiw client.js:2821-2830）。 */
      const autoOpenShouldFire = ({ open, addIsTheOnlyEntry, flowBusy: busy }) => open === true && addIsTheOnlyEntry === true && busy !== true;
      return { initial, flowBusy, reduce, autoOpenShouldFire };
    }

    /** workspace.add 快捷键三补丁（uiw client.js:39-71 controls.add/closeAdd/directoryBusy 语义）。 */
    function shortcutPatchForAdd(snapshot) {
      return snapshot.directoryBusy ? {} : { addRequested: true };
    }

    function shortcutPatchForCloseAdd() {
      return { addRequested: false };
    }

    function shortcutPatchForDirectoryBusy(busy) {
      return { directoryBusy: busy };
    }

    /** 把补丁写入快捷键 store（内置或探测到的共享 store）；缺读取/写入面时安全跳过。 */
    function applyShortcutPatch(store, patch) {
      if (store === null || typeof store !== 'object') return false;
      if (typeof store.getSnapshot !== 'function' || typeof store.set !== 'function') return false;
      store.set({ ...store.getSnapshot(), ...patch });
      return true;
    }

    /**
     * 共享 view store 形状校验：句柄可 create 且实例带关键视图 actions
     * （内置把 handle 通过注册 options.store 传给 sidebar.workspaces，也传给
     * archived/stoppedAndArchived 两条归档 toast 的 keyed 注册，uiw client.js:4706-4747、6076）。
     */
    function isValidViewStoreHandle(handle) {
      if (handle === null || typeof handle !== 'object' || typeof handle.create !== 'function') return false;
      try {
        const instance = handle.create();
        return instance !== null && typeof instance === 'object'
          && instance.actions !== undefined
          && typeof instance.actions.setArchivedFilter === 'function'
          && typeof instance.actions.setGroupBy === 'function';
      } catch {
        return false;
      }
    }

    /**
     * 从 slot entries 里选可共享的 view store 句柄：内置在位（先于本插件注册）时返回其句柄，
     * 本插件注册与其同 store——归档 toast 的「显示已归档」、uiWorkspace.pinSession 的
     * 本地序写、本 shadow 的视图写全部落在同一实例，禁用回退/双实例漂移即消除
     * （uiw client.js:5910-5922 showArchived 写 viewInstance；1551-1558 pin 写 view）。
     * 内置未在位（本插件先注册）时返回 null → 回退本地实例（与 T1 快捷键探测同一降级语义）。
     */
    function pickSharedViewStore(entries) {
      for (const entry of entries ?? []) {
        const store = entry?.options?.store ?? entry?.store;
        if (isValidViewStoreHandle(store)) return store;
      }
      return null;
    }

    /** Show the blank row plus the first `watermark` non-blank rows（uiw client.js:2953-2964）。 */
    function watermarkRows(sessions, watermark) {
      let count = 0;
      const rows = sessions.filter((session) => {
        if (session.blank) return true;
        count += 1;
        return count <= watermark;
      });
      return { rows, hiddenCount: sessions.length - rows.length };
    }

    /** 注意力会话（running/子代理/待交互/未读完成/当前/reveal）自动抬升（uiw client.js:2969-2978）。 */
    function requiredWatermark(sessions, current, revealSessionId) {
      let index = 0;
      let required = 0;
      for (const session of sessions) {
        if (session.blank) continue;
        index += 1;
        if ((index <= SESSION_WATERMARK_AUTO_MAX && (session.running || session.runningSubagentCount > 0 || session.pendingInteraction !== undefined || session.completed || session.id === current)) || session.id === revealSessionId) required = index;
      }
      return required;
    }

    function raiseWatermarks(marks, required) {
      let raised = marks;
      for (const [key, watermark] of required) {
        if (watermark > (raised[key] ?? SESSION_WATERMARK_BASE)) raised = { ...raised, [key]: watermark };
      }
      return raised;
    }

    /** 搜索词规范化：去 NUL、500 code units 上限且不劈代理对（uiw client.js:2989-2997）。 */
    function sanitizeSearchQuery(value) {
      const withoutNul = value.replaceAll('\0', '');
      if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul;
      let end = SEARCH_QUERY_MAX_CODE_UNITS;
      const last = withoutNul.charCodeAt(end - 1);
      const next = withoutNul.charCodeAt(end);
      if (last >= 55296 && last <= 56319 && next >= 56320 && next <= 57343) end -= 1;
      return withoutNul.slice(0, end);
    }

    /** 同组同 pinned 段内的拖拽新序（uiw client.js:3133-3145）。 */
    function sessionDragOrder(order, rows, drag, over) {
      const source = rows.find((row) => row.id === drag.sessionId);
      const target = rows.find((row) => row.id === over.id);
      if (source === undefined || target === undefined || source.blank || source.pinned !== drag.pinned || target.pinned !== drag.pinned || source.id === target.id || !order.includes(source.id)) return undefined;
      const section = rows.filter((row) => row.pinned === drag.pinned);
      const sourceIndex = section.findIndex((row) => row.id === source.id);
      if (section.filter((row) => row.id !== source.id).findIndex((row) => row.id === target.id) + (over.half === 'after' ? 1 : 0) === sourceIndex) return undefined;
      const next = order.filter((id) => id !== source.id);
      const targetIndex = next.indexOf(target.id);
      if (targetIndex === -1) return undefined;
      next.splice(targetIndex + (over.half === 'after' ? 1 : 0), 0, source.id);
      return pinCurrentBlank(next, rows.find((row) => row.blank)?.id);
    }

    /**
     * 状态点优先级：pendingInteraction（warning）> running（ongoing）> 子代理运行中（ongoing）>
     * 未读完成（done）> idle；只画第一个状态的点（uiw client.js:2328-2377）。纯函数，t 注入。
     */
    function sessionStatuses(node, t) {
      const subagents = node.runningSubagentCount === 0 ? undefined : {
        state: 'ongoing',
        label: t(node.runningSubagentCount === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other', { n: node.runningSubagentCount }),
      };
      let pending;
      switch (node.pendingInteraction) {
        case 'approval':
          pending = { state: 'warning', label: t('status.waitingApproval'), trailingLabel: t('status.compact.approval') };
          break;
        case 'plan-review':
          pending = { state: 'warning', label: t('status.planReview'), trailingLabel: t('status.compact.planReview') };
          break;
        case 'question':
          pending = { state: 'warning', label: t('status.waitingAnswer'), trailingLabel: t('status.compact.answer') };
          break;
        case undefined:
          break;
        default:
          throw new Error('unknown pending interaction: ' + String(node.pendingInteraction));
      }
      if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents];
      if (node.running) {
        const primary = { state: 'ongoing', label: t('status.running') };
        return subagents === undefined ? [primary] : [primary, subagents];
      }
      if (subagents !== undefined) return [subagents];
      if (node.completed) return [{ state: 'done', label: t('status.completed') }];
      return [{ state: 'idle', label: t('status.idle') }];
    }

    /**
     * ViewOptionsMenu 的纯模型（uiw client.js:3029-3108 抽取）：items 结构、selectedIds 映射、
     * onSelect 分派。**T4 预留位**：在 GROUP_ITEMS 的 flat 项之后插「按标签」项（本票不加）。
     */
    const GROUP_ITEMS = [
      { id: 'workspace', labelKey: 'groupBy.workspace' },
      { id: 'workspace-tree', labelKey: 'groupBy.workspaceTree' },
      { id: 'flat', labelKey: 'groupBy.flat' },
      // T4（#5）：{ id: 'tag', labelKey: 'groupBy.tag' } 插在这里（分组 label 之后、排序 separator 之前）。
    ];
    const ORDER_ITEMS = [
      { id: 'manual', labelKey: 'orderBy.manual' },
      { id: 'updated', labelKey: 'orderBy.updated' },
    ];
    const ARCHIVED_ITEMS = [
      { id: 'hide-archived', labelKey: 'viewOptions.hideArchived', value: 'default' },
      { id: 'show-archived', labelKey: 'viewOptions.showArchived', value: 'show' },
      { id: 'only-archived', labelKey: 'viewOptions.onlyArchived', value: 'only' },
    ];

    function viewOptionSelection(id) {
      for (const item of GROUP_ITEMS) if (item.id === id) return { kind: 'group', value: id };
      for (const item of ORDER_ITEMS) if (item.id === id) return { kind: 'order', value: id };
      for (const item of ARCHIVED_ITEMS) if (item.id === id) return { kind: 'archivedFilter', value: item.value };
      return null;
    }

    function archivedSelectedId(archivedFilter) {
      return { default: 'hide-archived', show: 'show-archived', only: 'only-archived' }[archivedFilter];
    }

    function viewOptionsMenuModel(t, iconFor) {
      const item = (entry) => ({ id: entry.id, label: t(entry.labelKey), icon: iconFor(entry.id) });
      return {
        items: [
          { type: 'label', id: 'group-by', text: t('groupBy.label') },
          ...GROUP_ITEMS.map(item),
          { type: 'separator', id: 'order-by-separator' },
          { type: 'label', id: 'order-by', text: t('orderBy.label') },
          ...ORDER_ITEMS.map(item),
          { type: 'separator', id: 'archived-filter-separator' },
          { type: 'label', id: 'filter-by', text: t('filterBy.label') },
          ...ARCHIVED_ITEMS.map(item),
        ],
        selectedIds: (groupBy, orderBy, archivedFilter) => [groupBy, orderBy, archivedSelectedId(archivedFilter)],
        dispatch: viewOptionSelection,
      };
    }

    /** 内置 view store spec 的复刻（uiw client.js:1266-1316）；apply 用 dsh-client-store 的 defineStore 包装。 */
    function workspaceViewStoreSpec() {
      function copySessionOrders(orders) {
        return Object.fromEntries(Object.entries(orders).map(([key, order]) => [key, [...order]]));
      }
      return {
        init: () => ({
          groupBy: 'workspace',
          orderBy: 'updated',
          groupExpansion: {},
          sessionOrderByAccount: {},
          archivedFilter: 'default',
        }),
        persist: VIEW_PERSIST_KEY,
        actions: {
          setGroupBy: (d, mode) => { d.groupBy = mode; },
          setOrderBy: (d, mode, initialOrders) => {
            if (mode === d.orderBy) return;
            d.sessionOrderByAccount = mode === 'manual' ? copySessionOrders(initialOrders) : {};
            d.orderBy = mode;
          },
          setGroupExpanded: (d, key, expanded) => { d.groupExpansion[key] = expanded; },
          retainAccountKeys: (d, workspaceKeys) => {
            const retained = new Set(workspaceKeys);
            d.groupExpansion = Object.fromEntries(Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)));
            d.sessionOrderByAccount = Object.fromEntries(Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)));
            delete d.sessionUpdatedAtByAccount;
          },
          syncSessionOrders: (d, orders) => {
            if (d.orderBy !== 'manual') return;
            Object.assign(d.sessionOrderByAccount, copySessionOrders(orders));
          },
          setSessionOrder: (d, accountKey, order, initialOrders) => {
            if (d.orderBy === 'updated') d.sessionOrderByAccount = copySessionOrders(initialOrders);
            else Object.assign(d.sessionOrderByAccount, copySessionOrders(initialOrders));
            d.orderBy = 'manual';
            d.sessionOrderByAccount[accountKey] = [...order];
          },
          pinSessionOrder: (d, sessionId, accountKeys, source) => {
            const selected = new Set(accountKeys);
            d.sessionOrderByAccount = Object.fromEntries(Object.entries(source.members).map(([key, members]) => {
              const order = reconcileManualOrder(members, d.sessionOrderByAccount[key], source.summaries, source.rowState);
              return [key, selected.has(key) ? [sessionId, ...order.filter((id) => id !== sessionId)] : order];
            }));
          },
          setArchivedFilter: (d, filter) => { d.archivedFilter = filter; },
        },
      };
    }

    /** 拖拽预览与拖拽排序共享的侧栏布局变量（uiw client.js:2021-2025）。 */
    const DRAG_PREVIEW_PROPERTIES = ['--dsh-sidebar-row-padding', '--dsh-sidebar-label-gap', '--dsh-sidebar-paint-inset'];

    /** 行显示标题：blank 行显示本地化「新会话」（uiw client.js:2027-2029）。 */
    function displayTitle(node, t) {
      return node.blank ? t('session.new') : (node.title || t('session.untitled'));
    }

    // =====================================================================
    // 组件层（浏览器侧；React/primitives 由 apply() 解析进模块级变量）。
    // =====================================================================

    let React = null;
    let P = null; // @deepseek-ai/dsh-client-ui-primitives
    let storeLib = null; // @deepseek-ai/dsh-client-store

    function placeTitle(title, left, range) {
      if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' });
      else title.scrollLeft = left;
      if (left > 0) title.dataset.scrolled = '';
      else delete title.dataset.scrolled;
      if (left < range) title.dataset.clipped = '';
      else delete title.dataset.clipped;
    }

    function restTitle(title) {
      if (typeof title.scrollTo === 'function') title.scrollTo({ left: 0, behavior: 'instant' });
      else title.scrollLeft = 0;
      delete title.dataset.scrolled;
      delete title.dataset.clipped;
    }

    /** 标题跑马灯（uiw client.js:2077-2116，原样复刻）。 */
    function useTitleMarquee(title) {
      const frame = React.useRef(0);
      const revealing = React.useRef(false);
      React.useEffect(() => () => { cancelAnimationFrame(frame.current); }, []);
      return React.useMemo(() => ({
        enter: (event) => {
          if (event?.pointerType === 'touch') return;
          if (title.current === null) return;
          if (revealing.current) return;
          revealing.current = true;
          const element = title.current;
          const range = element.scrollWidth - element.clientWidth;
          if (range <= MIN_TITLE_REVEAL_PX) return;
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            placeTitle(element, range, range);
            return;
          }
          cancelAnimationFrame(frame.current);
          let previous;
          let position = 0;
          const step = (now) => {
            position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
            previous = now;
            placeTitle(element, Math.min(position, range), range);
            if (position < range) frame.current = requestAnimationFrame(step);
          };
          frame.current = requestAnimationFrame(step);
        },
        leave: () => {
          revealing.current = false;
          cancelAnimationFrame(frame.current);
          if (title.current === null) return;
          restTitle(title.current);
        },
      }), [title]);
    }

    /** 行内相对时间（primitives.relativeTime + time.* 键，uiw client.js:2118-2121）。 */
    function timeLabel(updatedAt, now, t) {
      const { unit, n } = P.relativeTime(updatedAt, now);
      return unit === 'now' ? t('time.now') : t('time.' + unit, { n });
    }

    function rowHalf(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    }

    /** 拖拽期间 document 级接受 native drag（uiw client.js:3003-3020）。 */
    function useNativeDragAcceptance(active) {
      React.useEffect(() => {
        if (!active) return undefined;
        const acceptDrag = (event) => {
          event.preventDefault();
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
        };
        const acceptDrop = (event) => { event.preventDefault(); };
        document.addEventListener('dragover', acceptDrag);
        document.addEventListener('drop', acceptDrop);
        return () => {
          document.removeEventListener('dragover', acceptDrag);
          document.removeEventListener('drop', acceptDrop);
        };
      }, [active]);
    }

    /** 主状态点 + 全部状态的读屏文案（uiw client.js:2379-2384）。 */
    function SessionStatusDots({ statuses }) {
      const children = [React.createElement(P.StateDot, { key: 'dot', state: statuses[0].state })];
      for (const status of statuses) {
        children.push(React.createElement('span', { key: status.label, className: RW.visuallyHidden }, status.label));
      }
      return React.createElement(React.Fragment, null, children);
    }

    /** 置顶标记：只表示置顶，排序由派生层保证（uiw client.js:2386-2395）。 */
    function PinnedIndicator({ t }) {
      const label = t('row.pinned');
      return React.createElement('span', {
        className: RW.pinIndicator,
        role: 'img',
        'aria-label': label,
        title: label,
      }, React.createElement(P.IconPinFillRegular, { size: 14 }));
    }

    /** workspace 悬停卡内容：标题、缩略目录路径、绝对创建时间（uiw client.js:2142-2160）。 */
    function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
      return React.createElement('div', { className: RW.hoverContent },
        React.createElement('div', { className: RW.hoverTitle }, label),
        React.createElement('div', { className: RW.hoverPath }, cwd),
        React.createElement('div', { className: RW.hoverTime }, createdLabel(createdAt, t)),
      );
    }

    /**
     * 会话悬停卡内容（uiw client.js:2401-2429）：全标题、cwd 缩略、相对时间
     * （ago 模板，blank 行没有时间行）、`sidebar.session.row.hover` 扩展段、
     * 每状态一行（StateDot+文案；归档行剔除 done/idle 状态）、归档行加归档图标行。
     */
    function SessionHoverContent({ node, cwd, now, renderSlot, t }) {
      const statuses = hoverStatuses(node, t);
      const children = [
        React.createElement('div', { key: 'title', className: RW.hoverTitle }, displayTitle(node, t)),
      ];
      if (cwd !== undefined) children.push(React.createElement('div', { key: 'cwd', className: RW.hoverPath }, cwd));
      if (!node.blank) children.push(React.createElement('div', { key: 'time', className: RW.hoverTime }, hoverTimeLabel(P.relativeTime, node.updatedAt, now, t)));
      children.push(React.createElement(React.Fragment, { key: 'hover-slot' }, renderSlot('sidebar.session.row.hover', { sessionId: node.id })));
      for (const status of statuses) {
        children.push(React.createElement('div', { key: status.label, className: RW.hoverStatus },
          React.createElement(P.StateDot, { state: status.state }),
          React.createElement('span', null, status.label)));
      }
      if (node.archived) {
        children.push(React.createElement('div', { key: 'archived', className: clsx(RW.hoverStatus, RW.hoverArchived) },
          React.createElement(P.IconArchiveOutlineRegular, { size: 14 }),
          React.createElement('span', null, t('row.archived'))));
      }
      return React.createElement('div', { className: RW.hoverContent }, children);
    }

    /** 空态占位（uiw client.js:3152-3168）。 */
    function EmptySessions({ rowState, onLeaveArchivedOnly, t }) {
      const archivedOnly = rowState.archivedFilter === 'only';
      return React.createElement('div', {
        className: WB.emptyState,
        'data-row-key': 'empty',
      },
        archivedOnly
          ? React.createElement(P.IconArchiveOutlineRegular, { size: 24 })
          : React.createElement(P.IconQueueOutlineRegular, { size: 24 }),
        React.createElement('div', null, archivedOnly ? t('empty.noneArchived') : t('empty.none')),
        archivedOnly && React.createElement('button', {
          type: 'button',
          className: WB.emptyAction,
          onClick: onLeaveArchivedOnly,
        }, t('empty.viewOthers')),
      );
    }

    /** ViewOptionsMenu：结构经纯模型 viewOptionsMenuModel；T4 在 GROUP_ITEMS 插「按标签」。 */
    function ViewOptionsMenu({ groupBy, orderBy, archivedFilter, onGroupPick, onOrderPick, onArchivedFilterPick, t }) {
      const [open, setOpen] = React.useState(false);
      const model = viewOptionsMenuModel(t, (id) => {
        switch (id) {
          case 'workspace': return React.createElement(P.IconFolderCloseRegular, null);
          case 'workspace-tree': return React.createElement(P.IconWorkspaceTreeOutlineRegular, null);
          case 'flat': return React.createElement(P.IconFlatListOutlineRegular, null);
          case 'manual': return React.createElement(P.IconChevronsUpDownOutlineRegular, null);
          case 'updated': return React.createElement(P.IconClockOutlineRegular, null);
          case 'hide-archived': return React.createElement(P.IconArchiveOffOutlineRegular, null);
          case 'show-archived': return React.createElement(P.IconQueueOutlineRegular, null);
          case 'only-archived': return React.createElement(P.IconArchiveCheckOutlineRegular, null);
          default: return undefined;
        }
      });
      const selection = viewOptionSelection;
      return React.createElement(P.Menu, {
        open,
        onClose: () => { setOpen(false); },
        items: model.items,
        selectedIds: [groupBy, orderBy, archivedSelectedId(archivedFilter)],
        onSelect: (id) => {
          const picked = selection(id);
          if (picked === null) return;
          if (picked.kind === 'group') onGroupPick(picked.value);
          else if (picked.kind === 'order') onOrderPick(picked.value);
          else onArchivedFilterPick(picked.value);
          setOpen(false);
        },
        align: 'end',
        dense: true,
        listClassName: WB.viewOptionsMenu,
        portal: true,
        anchor: React.createElement(P.Tooltip, {
          label: t('viewOptions.label'),
          side: 'bottom',
          delayMs: 500,
          portal: true,
        }, React.createElement('button', {
          type: 'button',
          className: clsx(WB.iconButton, WB.wide),
          'aria-label': t('viewOptions.label'),
          onClick: () => { setOpen((v) => !v); },
        }, React.createElement(P.IconSlidersTwoOutlineRegular, null))),
      });
    }

    /** workspace 头行（uiw client.js:2182-2319；悬停卡留 T2，故直接渲染锚点行）。 */
    function ProjectRowItem(props) {
      const workspaceId = props.group.workspaceId;
      if (workspaceId === undefined) return React.createElement(UngroupedProjectRow, props);
      return React.createElement(WorkspaceProjectRow, { ...props, workspaceId });
    }

    function UngroupedProjectRow(props) {
      const create = props.useRemoteAccess('session/create');
      return React.createElement(ProjectRow, { ...props, access: { create, reorder: false } });
    }

    function WorkspaceProjectRow({ workspaceId, ...props }) {
      const { useWorkspaceAccess } = props;
      const access = {
        create: useWorkspaceAccess(workspaceId, 'session/create'),
        reorder: useWorkspaceAccess(workspaceId, 'workspace/insertBefore'),
      };
      return React.createElement(ProjectRow, { ...props, access });
    }

    function ProjectRow({ group, containsCurrentDescendant = false, onToggle, onCreate, drag: offeredDrag, home, newShortcut, t, access, openWorkspaceMenu, useContextMenuTarget, useContextMenu }) {
      const { getTriggerProps } = useContextMenu();
      const drag = access.reorder ? offeredDrag : undefined;
      const row = group;
      const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label;
      const active = containsCurrentDescendant || (group.expanded && group.containsCurrent);
      const menuOpen = useContextMenuTarget((target) => target?.kind === 'workspace' && target.value.workspaceId === row.workspaceId);
      const dragPreview = P.useRowDragPreview(RW.dragPreview, DRAG_PREVIEW_PROPERTIES);
      const workspaceMenuTarget = row.workspaceId !== undefined && row.cwd !== undefined
        ? { workspaceId: row.workspaceId, path: row.cwd }
        : undefined;
      const ownRow = React.createElement('div', {
        className: clsx(RW.projectRow, menuOpen && RW.menuOpen),
        'data-row-key': 'workspace:' + group.key,
        role: 'treeitem',
        'aria-expanded': row.expanded,
        onClick: onToggle,
        ...(workspaceMenuTarget === undefined ? {} : getTriggerProps({
          kind: 'workspace',
          value: { ...workspaceMenuTarget, displayTitle: label },
        })),
        draggable: drag !== undefined,
        onDragStart: drag === undefined ? undefined : (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', row.key);
          drag.start();
          dragPreview.start(e);
        },
        onDragEnd: () => { if (dragPreview.clear()) drag?.end(); },
      },
        React.createElement('span', {
          className: clsx(RW.slot, RW.folder, active && RW.folderActive),
        }, row.expanded
          ? React.createElement(P.IconFolderOpenRegular, null)
          : React.createElement(P.IconFolderCloseRegular, null)),
        React.createElement('span', {
          className: clsx(RW.slot, RW.chevron),
        }, React.createElement(P.IconTriangleRightFillRegular, { className: clsx(RW.arrow, row.expanded && RW.arrowOpen) })),
        React.createElement('span', { className: RW.projectText },
          React.createElement('span', { className: RW.title }, label)),
        React.createElement('span', { className: RW.rowActions },
          workspaceMenuTarget !== undefined && React.createElement('button', {
            type: 'button',
            className: RW.iconButton,
            'data-context-menu-trigger': true,
            'aria-label': t('actions.workspace.aria', { name: label }),
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen,
            onClick: (event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openWorkspaceMenu(workspaceMenuTarget.workspaceId, workspaceMenuTarget.path, label, { x: rect.left, y: rect.bottom }, 'toggle');
            },
          }, React.createElement(P.IconEllipsisOutlineRegular, null)),
          access.create && React.createElement(P.Tooltip, {
            label: t('actions.newSession'),
            shortcutKeys: newShortcut?.keys,
            side: 'bottom',
            align: 'end',
            delayMs: 500,
            portal: true,
          }, React.createElement('button', {
            type: 'button',
            className: RW.iconButton,
            'aria-keyshortcuts': newShortcut?.aria,
            'aria-label': t('actions.newSession.aria', { name: label }),
            onClick: (e) => { e.stopPropagation(); onCreate(); },
          }, React.createElement(P.IconNewChatOutlineRegular, { size: 14 }))),
        ),
      );
      // 真 workspace 才有悬停卡（未分组桶无 createdAt，uiw client.js:2303-2319）。
      if (row.createdAt === undefined) return ownRow;
      return React.createElement(P.HoverCard, {
        anchor: ownRow,
        content: React.createElement(WorkspaceHoverContent, {
          label: row.label,
          cwd: row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home),
          createdAt: row.createdAt,
          t,
        }),
        openDelayMs: 800,
        grouped: true,
        disabled: menuOpen,
        copyText: row.cwd,
        copyLabel: t('copy'),
        copiedLabel: t('hover.copied'),
      });
    }

    /**
     * 会话行（uiw client.js:2528-2685）。
     * T1 差异：不包 HoverCard（悬停卡 = T2）；行首/行尾装饰位与「...」菜单、快捷动作列表
     * （renderSlot('sidebar.workspaces.session.row.action')）原样保留。
     */
    function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, openSessionMenu, useContextMenuTarget, useContextMenu, onReveal, drag, home, useSessionAccess, t }) {
      const { getTriggerProps } = useContextMenu();
      const row = node;
      const title = displayTitle(node, t);
      const selected = node.id === currentId;
      const statuses = sessionStatuses(node, t);
      const primaryStatus = statuses[0];
      const showStatus = primaryStatus.state !== 'idle';
      const renamable = useSessionAccess(node.id, 'session/rename');
      const reorderable = useSessionAccess(node.id, 'workspace/insertSessionBefore');
      const draggable = drag !== undefined && reorderable && !row.blank && !row.archived;
      const menuOpen = useContextMenuTarget((target) => target?.kind === 'session' && target.value.sessionId === node.id);
      const dragPreview = P.useRowDragPreview(RW.dragPreview, DRAG_PREVIEW_PROPERTIES);
      const rowRef = React.useRef(null);
      const titleRef = React.useRef(null);
      const renameArmed = React.useRef(false);
      const disarmRename = React.useRef(() => { renameArmed.current = false; }).current;
      const marquee = useTitleMarquee(titleRef);
      React.useEffect(() => {
        if (menuOpen || rowRef.current?.matches(':hover')) marquee.enter();
        else marquee.leave();
      }, [menuOpen, marquee]);
      React.useEffect(() => {
        if (onReveal === undefined) return;
        rowRef.current?.scrollIntoView({ block: 'nearest' });
        onReveal();
      }, [onReveal]);
      const anchor = React.createElement('div', {
        ref: rowRef,
        'data-row-key': 'session:' + node.id,
        className: clsx(RW.sessionRow, selected && RW.selected, menuOpen && RW.menuOpen, row.archived && RW.archived, drag?.marker === 'before' && RW.dropBefore, drag?.marker === 'after' && RW.dropAfter),
        role: 'treeitem',
        'aria-selected': selected,
        'aria-description': row.archived ? t('toast.archivedNotOpenable') : undefined,
        tabIndex: 0,
        onClick: () => { onOpen(node.id); },
        ...(row.blank ? {} : getTriggerProps({
          kind: 'session',
          value: { sessionId: node.id, displayTitle: row.title },
        }, {
          onKeyDown: (event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            onOpen(node.id);
          },
        })),
        onPointerEnter: marquee.enter,
        onPointerLeave: () => { if (!menuOpen) marquee.leave(); },
        draggable,
        onDragStart: !draggable ? undefined : (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.id);
          drag.start();
          dragPreview.start(e);
        },
        onDragEnd: () => { if (dragPreview.clear()) drag?.end(); },
        onDragOver: drag === undefined ? undefined : (e) => {
          if (!drag.active) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          drag.hover(rowHalf(e));
        },
        onDrop: drag === undefined ? undefined : (e) => {
          if (!drag.active) return;
          e.preventDefault();
          drag.drop(rowHalf(e));
        },
      },
        React.createElement('span', { className: RW.slot },
          !row.archived && !row.blank && (showStatus
            ? React.createElement(SessionStatusDots, { statuses })
            : renderSlot('sidebar.session.row.leading', { sessionId: node.id }))),
        React.createElement('span', {
          ref: titleRef,
          className: RW.title,
          onMouseDown: (e) => {
            if (e.detail !== 1) return;
            renameArmed.current = true;
            window.addEventListener('blur', disarmRename, { once: true });
          },
          onDoubleClick: row.blank || !renamable ? undefined : (e) => {
            e.stopPropagation();
            if (!renameArmed.current) return;
            renameArmed.current = false;
            onRenameRequest(node.id, row.title);
          },
        }, title),
        !row.blank && React.createElement('span', { className: RW.rowResting },
          React.createElement('span', {
            className: clsx(RW.time, primaryStatus.trailingLabel === undefined && RW.timestamp),
            'aria-hidden': primaryStatus.trailingLabel === undefined ? undefined : true,
          }, primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)),
          renderSlot('sidebar.session.row.trailing', { sessionId: node.id }),
          row.pinned && !row.archived && React.createElement(PinnedIndicator, { t })),
        !row.blank && React.createElement('span', {
          className: RW.rowActions,
          onClick: (e) => { e.stopPropagation(); },
        },
          React.createElement('button', {
            type: 'button',
            className: RW.iconButton,
            'aria-label': t('actions.session.aria', { name: title }),
            onPointerDown: (event) => { event.stopPropagation(); },
            'data-context-menu-trigger': '',
            onClick: (event) => {
              event.currentTarget.focus({ preventScroll: true });
              const rect = event.currentTarget.getBoundingClientRect();
              openSessionMenu(node.id, row.title, { x: rect.left, y: rect.bottom }, 'toggle');
            },
          }, React.createElement(P.IconEllipsisOutlineRegular, null)),
          React.createElement('span', { className: RW.rowQuickActions },
            renderSlot('sidebar.workspaces.session.row.action', { sessionId: node.id, displayTitle: row.title }))),
      );
      // 整行作悬停卡锚点：菜单/拖拽开启时禁用；copy 文本 = 标题（blank/空标题不给，uiw client.js:2557-2684）。
      return React.createElement(P.HoverCard, {
        anchor,
        content: React.createElement(SessionHoverContent, {
          node,
          cwd: row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home),
          now,
          renderSlot,
          t,
        }),
        openDelayMs: 800,
        grouped: true,
        disabled: menuOpen || drag?.active === true,
        copyText: row.blank || row.title === '' ? undefined : row.title,
        copyLabel: t('copy'),
        copiedLabel: t('hover.copied'),
      });
    }

    /** 分组树（uiw client.js:3170-3500，原样复刻含水位线与拖拽）。 */
    function SessionTree({ list, useSessionStatus, startSession, open, workspaces, ungroupedSessionIds, rowState, onLeaveArchivedOnly, workspaceReady, animationResetKey, usePanelInfo, useRemoteAccess, useSessionAccess, useWorkspaceAccess, onSessionRenameRequest, renderSlot, openSessionMenu, openWorkspaceMenu, useContextMenuTarget, useContextMenu, insertWorkspaceBefore, nestWorkspaces, groupExpansion, setGroupExpanded, setSessionOrder, home, t, revealSessionId, onSessionRevealed, shortcuts }) {
      const panelActive = usePanelInfo((info) => info.activePanelId !== null);
      const statuses = useSessionStatus((s) => s);
      const current = panelActive ? undefined : mainSessionId(list);
      const revealGroup = revealSessionId === undefined || !workspaceReady ? undefined : owningGroupKey(workspaces, revealSessionId);
      const [storedWatermarks, setStoredWatermarks] = React.useState({});
      const [watermarkMotionKey, setWatermarkMotionKey] = React.useState(0);
      const [drag, setDrag] = React.useState(null);
      const sessionDropCommitted = React.useRef(false);
      const [workspaceDrag, setWorkspaceDrag] = React.useState(null);
      const workspaceDropCommitted = React.useRef(false);
      const nativeDragActive = drag !== null || workspaceDrag !== null;
      useNativeDragAcceptance(nativeDragActive);
      const currentGroup = current === undefined || !workspaceReady ? undefined : owningGroupKey(workspaces, current);
      React.useEffect(() => {
        if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return;
        setGroupExpanded(currentGroup, true);
      }, [current, currentGroup, setGroupExpanded, groupExpansion]);
      const parents = React.useMemo(() => {
        if (!nestWorkspaces) return new Map();
        const keysByPath = new Map(workspaces.map((workspace) => [workspace.path, workspace.workspaceId]));
        const paths = [...keysByPath.keys()];
        return new Map(workspaces.map((workspace) => {
          const path = owningParentFolder(workspace.path, paths);
          return [workspace.workspaceId, path === undefined ? undefined : keysByPath.get(path)];
        }));
      }, [nestWorkspaces, workspaces]);
      const currentAncestors = React.useMemo(() => {
        const keys = new Set();
        for (let key = currentGroup === undefined ? undefined : parents.get(currentGroup); key !== undefined; key = parents.get(key)) keys.add(key);
        return keys;
      }, [currentGroup, parents]);
      const expandedGroups = React.useMemo(() => {
        const ancestorKeys = new Set(parents.values());
        return [...workspaces.map((workspace) => workspace.workspaceId), ''].filter((key) => groupExpansion[key] ?? ancestorKeys.has(key));
      }, [groupExpansion, parents, workspaces]);
      const groups = React.useMemo(() => deriveGroups(list, workspaces, rowState, statuses, {
        expandedGroups,
        ungroupedOrder: ungroupedSessionIds,
      }), [list, workspaces, rowState, statuses, expandedGroups, ungroupedSessionIds]);
      React.useEffect(() => {
        for (let key = revealGroup; key !== undefined; key = parents.get(key)) {
          if (groupExpansion[key] === false || (key === revealGroup && groupExpansion[key] !== true)) setGroupExpanded(key, true);
        }
      }, [groupExpansion, parents, revealGroup, setGroupExpanded]);
      const baselines = new Map(groups.map((group) => [group.key, Math.max(SESSION_WATERMARK_BASE, requiredWatermark(group.sessions, current, group.key === revealGroup ? revealSessionId : undefined))]));
      const foldedKeys = new Set(groups.filter((group) => !group.expanded).map((group) => group.key));
      const underFoldedAncestor = (key) => {
        for (let owner = parents.get(key); owner !== undefined; owner = parents.get(owner)) if (foldedKeys.has(owner)) return true;
        return false;
      };
      const requiredWatermarks = new Map([...baselines].filter(([key]) => !underFoldedAncestor(key)));
      const sessionWatermarks = raiseWatermarks(storedWatermarks, requiredWatermarks);
      if (sessionWatermarks !== storedWatermarks) setStoredWatermarks((marks) => raiseWatermarks(marks, requiredWatermarks));
      const dropWatermarks = (drop) => {
        if (!Object.keys(storedWatermarks).some(drop)) return;
        setStoredWatermarks((marks) => Object.fromEntries(Object.entries(marks).filter(([key]) => !drop(key))));
        setWatermarkMotionKey((key) => key + 1);
      };
      const withinGroup = (key, root) => {
        for (let owner = key; owner !== undefined; owner = parents.get(owner)) if (owner === root) return true;
        return false;
      };
      const now = Date.now();
      const commitSessionDrag = (activeDrag, over) => {
        if (sessionDropCommitted.current) return;
        sessionDropCommitted.current = true;
        setDrag(null);
        const group = groups.find((candidate) => candidate.key === activeDrag.accountKey);
        if (group === undefined) return;
        if (over.id === activeDrag.sessionId) return;
        const accountSessionIds = activeDrag.accountKey === ''
          ? ungroupedSessionIds
          : workspaces.find((workspace) => workspace.workspaceId === activeDrag.accountKey)?.sessionIds;
        if (accountSessionIds === undefined) return;
        const renderedSessions = watermarkRows(group.sessions, sessionWatermarks[group.key] ?? SESSION_WATERMARK_BASE).rows;
        const nextOrder = sessionDragOrder(accountSessionIds, renderedSessions, activeDrag, over);
        if (nextOrder !== undefined) setSessionOrder(activeDrag.accountKey, nextOrder);
      };
      const commitWorkspaceDrag = (activeDrag, over) => {
        if (workspaceDropCommitted.current) return;
        workspaceDropCommitted.current = true;
        setWorkspaceDrag(null);
        const owner = parents.get(activeDrag.workspaceId);
        const siblings = workspaces.filter((workspace) => parents.get(workspace.workspaceId) === owner);
        const rowIndex = siblings.findIndex((workspace) => workspace.workspaceId === over.id);
        if (rowIndex === -1) return;
        const anchor = over.half === 'before' ? over.id : siblings[rowIndex + 1]?.workspaceId;
        if (anchor === activeDrag.workspaceId) return;
        const sourceIndex = siblings.findIndex((workspace) => workspace.workspaceId === activeDrag.workspaceId);
        const anchorIndex = anchor === undefined ? siblings.length : siblings.findIndex((workspace) => workspace.workspaceId === anchor);
        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
        insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason) => {
          console.warn('session-tags: workspace reorder rejected:', reason);
        });
      };
      const childrenByParent = React.useMemo(() => {
        const rendered = new Set(groups.map((group) => group.key));
        const children = new Map();
        for (const group of groups) {
          let parent = parents.get(group.key);
          while (parent !== undefined && !rendered.has(parent)) parent = parents.get(parent);
          const siblings = children.get(parent);
          if (siblings === undefined) children.set(parent, [group]);
          else siblings.push(group);
        }
        return children;
      }, [groups, parents]);
      const rootGroups = childrenByParent.get(undefined) ?? [];
      const workspaceDropAtListStart = rootGroups[0]?.workspaceId !== undefined && workspaceDrag?.over?.id === rootGroups[0].workspaceId && workspaceDrag.over.half === 'before';
      const rowKeys = groups.length === 0 ? ['empty'] : [];
      const renderGroup = (group, depth) => {
        const workspaceId = group.workspaceId;
        const children = childrenByParent.get(group.key) ?? [];
        const compatibleDrag = workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key);
        const watermark = sessionWatermarks[group.key] ?? SESSION_WATERMARK_BASE;
        const collapsed = watermarkRows(group.sessions, baselines.get(group.key) ?? SESSION_WATERMARK_BASE);
        const visible = watermarkRows(group.sessions, watermark);
        const sessionsExpanded = visible.hiddenCount === 0;
        rowKeys.push('workspace:' + group.key);
        const childRows = group.expanded ? children.map((child) => renderGroup(child, depth + 1)) : [];
        const sessions = visible.rows;
        for (const node of sessions) rowKeys.push('session:' + node.id);
        if (collapsed.hiddenCount > 0) rowKeys.push('overflow:' + group.key);
        const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId ? workspaceDrag.over.half : null;
        const workspaceDragProps = workspaceId === undefined ? undefined : {
          start: () => {
            workspaceDropCommitted.current = false;
            setWorkspaceDrag({ workspaceId, over: null });
          },
          end: () => {
            if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) commitWorkspaceDrag(workspaceDrag, workspaceDrag.over);
            else setWorkspaceDrag(null);
            workspaceDropCommitted.current = false;
          },
        };
        const hoverWorkspace = workspaceId === undefined || !compatibleDrag ? undefined : (half) => {
          setWorkspaceDrag((active) => active === null ? active : { ...active, over: { id: workspaceId, half } });
        };
        const dropWorkspace = workspaceId === undefined || !compatibleDrag ? undefined : (half) => {
          commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half });
        };
        const groupChildren = [
          React.createElement(ProjectRowItem, {
            key: 'header',
            newShortcut: shortcuts.find((row) => row.id === 'session.new'),
            group,
            home,
            openWorkspaceMenu,
            useContextMenu,
            useContextMenuTarget,
            useRemoteAccess,
            useWorkspaceAccess,
            containsCurrentDescendant: currentAncestors.has(group.key),
            t,
            onToggle: () => {
              if (group.expanded) dropWatermarks((key) => withinGroup(key, group.key));
              setGroupExpanded(group.key, !group.expanded);
            },
            onCreate: () => {
              if (group.workspaceId !== undefined) {
                setGroupExpanded(group.key, true);
                startSession(group.workspaceId);
              }
            },
            drag: workspaceDragProps,
          }),
        ];
        if (childRows.length > 0) {
          groupChildren.push(React.createElement('div', { key: 'children', role: 'group' }, childRows));
        }
        for (const node of sessions) {
          const sameGroupDrag = drag !== null && drag.accountKey === group.key;
          const compatibleTarget = sameGroupDrag && drag.pinned === node.pinned;
          const normalizeHalf = (half) => node.blank ? 'after' : half;
          const dragProps = {
            start: () => {
              sessionDropCommitted.current = false;
              setDrag({ accountKey: group.key, sessionId: node.id, pinned: node.pinned, over: null });
            },
            active: compatibleTarget,
            marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
            hover: (half) => {
              setDrag((d) => d === null ? d : { ...d, over: { id: node.id, half: normalizeHalf(half) } });
            },
            drop: (half) => {
              if (drag === null) return;
              commitSessionDrag(drag, { id: node.id, half: normalizeHalf(half) });
            },
            end: () => {
              if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over);
              else setDrag(null);
              sessionDropCommitted.current = false;
            },
          };
          groupChildren.push(React.createElement(SessionNodeItem, {
            key: node.id,
            node,
            currentId: current,
            now,
            home,
            onOpen: open,
            onRenameRequest: onSessionRenameRequest,
            renderSlot,
            openSessionMenu,
            useContextMenu,
            useContextMenuTarget,
            onReveal: node.id === revealSessionId && group.key === revealGroup ? () => { onSessionRevealed(node.id); } : undefined,
            drag: dragProps,
            useSessionAccess,
            t,
          }));
        }
        if (collapsed.hiddenCount > 0) {
          groupChildren.push(React.createElement('button', {
            key: 'overflow',
            type: 'button',
            className: WB.sessionOverflowButton,
            'data-row-key': 'overflow:' + group.key,
            'aria-expanded': sessionsExpanded,
            onClick: () => {
              if (sessionsExpanded) {
                dropWatermarks((key) => key === group.key);
                return;
              }
              setStoredWatermarks((marks) => ({
                ...marks,
                [group.key]: visible.hiddenCount <= SESSION_WATERMARK_BASE ? Infinity : watermark + SESSION_WATERMARK_BASE,
              }));
              setWatermarkMotionKey((key) => key + 1);
            },
          }, sessionsExpanded ? t('sessions.collapse') : t('sessions.expand', { n: visible.hiddenCount })));
        }
        return React.createElement('div', {
          key: group.key,
          style: { '--dsh-workspace-indent': depth * 12 + 'px' },
          className: clsx(WB.groupSection, workspaceMarker === 'before' && WB.workspaceDropBefore, workspaceMarker === 'after' && WB.workspaceDropAfter),
          onDragOver: workspaceDrag === null ? undefined : (e) => {
            e.preventDefault();
            if (hoverWorkspace === undefined && parents.get(group.key) !== undefined) return;
            e.stopPropagation();
            if (hoverWorkspace === undefined) {
              e.dataTransfer.dropEffect = 'none';
              if (workspaceDrag.over !== null) setWorkspaceDrag({ ...workspaceDrag, over: null });
            } else {
              e.dataTransfer.dropEffect = 'move';
              hoverWorkspace(rowHalf(e));
            }
          },
          onDrop: workspaceDrag === null ? undefined : (e) => {
            e.preventDefault();
            if (dropWorkspace === undefined && parents.get(group.key) !== undefined) return;
            e.stopPropagation();
            if (dropWorkspace === undefined) {
              workspaceDropCommitted.current = true;
              setWorkspaceDrag(null);
            } else dropWorkspace(rowHalf(e));
          },
        }, groupChildren);
      };
      const groupRows = rootGroups.map((group) => renderGroup(group, 0));
      return React.createElement(P.HoverCardGroup, {
        className: clsx(WB.treeBody, WB.wide),
      },
        workspaceDropAtListStart && React.createElement('span', {
          key: 'topDrop',
          className: WB.listTopDropIndicator,
          'aria-hidden': 'true',
        }),
        React.createElement(P.AnimatedRows, {
          key: 'rows',
          className: clsx(WB.list, workspaceDropAtListStart && WB.listTopDropActive),
          role: 'tree',
          label: t('section.sessions'),
          rowKeys,
          ready: list.phase === 'ready' && workspaceReady && !nativeDragActive,
          resetKey: JSON.stringify([animationResetKey, watermarkMotionKey]),
        },
          groups.length === 0 && React.createElement(EmptySessions, { rowState, onLeaveArchivedOnly, t }),
          groupRows),
        React.createElement('span', { key: 'fade', className: WB.fade }),
      );
    }

    /** 平铺列表（uiw client.js:3502-3592）。 */
    function FlatList({ list, sessionIds, rowState, onLeaveArchivedOnly, useSessionStatus, useSessionAccess, open, onSessionRenameRequest, usePanelInfo, setSessionOrder, workspaceReady, animationResetKey, revealSessionId, onSessionRevealed, renderSlot, openSessionMenu, useContextMenuTarget, useContextMenu, home, t }) {
      const panelActive = usePanelInfo((info) => info.activePanelId !== null);
      const statuses = useSessionStatus((s) => s);
      const rows = React.useMemo(() => deriveFlat(list, sessionIds, rowState, statuses), [list, sessionIds, rowState, statuses]);
      const [drag, setDrag] = React.useState(null);
      const dropCommitted = React.useRef(false);
      useNativeDragAcceptance(drag !== null);
      const currentId = panelActive ? undefined : mainSessionId(list);
      const commitDrag = (activeDrag, over) => {
        if (dropCommitted.current) return;
        dropCommitted.current = true;
        setDrag(null);
        const nextOrder = sessionDragOrder(sessionIds, rows, activeDrag, over);
        if (nextOrder !== undefined) setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder);
      };
      const now = Date.now();
      const rowChildren = [];
      if (rows.length === 0) rowChildren.push(React.createElement(EmptySessions, { key: 'empty', rowState, onLeaveArchivedOnly, t }));
      for (const node of rows) {
        const active = drag !== null && drag.pinned === node.pinned;
        const normalizeHalf = (half) => node.blank ? 'after' : half;
        rowChildren.push(React.createElement(SessionNodeItem, {
          key: node.id,
          node,
          currentId,
          now,
          home,
          onOpen: open,
          onRenameRequest: onSessionRenameRequest,
          renderSlot,
          openSessionMenu,
          useContextMenu,
          useContextMenuTarget,
          onReveal: node.id === revealSessionId ? () => { onSessionRevealed(node.id); } : undefined,
          useSessionAccess,
          drag: {
            start: () => {
              dropCommitted.current = false;
              setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, pinned: node.pinned, over: null });
            },
            active,
            marker: active && drag.over?.id === node.id ? drag.over.half : null,
            hover: (half) => {
              setDrag((current) => current === null ? current : { ...current, over: { id: node.id, half: normalizeHalf(half) } });
            },
            drop: (half) => {
              if (drag !== null) commitDrag(drag, { id: node.id, half: normalizeHalf(half) });
            },
            end: () => {
              if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over);
              else setDrag(null);
              dropCommitted.current = false;
            },
          },
          t,
        }));
      }
      return React.createElement(P.HoverCardGroup, {
        className: clsx(WB.treeBody, WB.wide),
      },
        React.createElement(P.AnimatedRows, {
          key: 'rows',
          className: clsx(WB.list, WB.flatList),
          role: 'tree',
          label: t('section.sessions'),
          rowKeys: rows.length === 0 ? ['empty'] : rows.map((row) => 'session:' + row.id),
          ready: list.phase === 'ready' && workspaceReady && drag === null,
          resetKey: animationResetKey,
        }, rowChildren),
        React.createElement('span', { key: 'fade', className: WB.fade }),
      );
    }

    /** 搜索结果（uiw client.js:3594-3657；行组件 2444-2500）。 */
    function SearchResultItem({ result, currentId, onOpen, onUnarchive, useSessionAccess, t }) {
      const selected = result.id === currentId;
      const canUnarchive = useSessionAccess(result.id, 'workspace/unarchiveSession');
      const statuses = sessionStatuses(result, t);
      const primaryStatus = statuses[0];
      const headingChildren = [
        React.createElement('span', { key: 'slot', className: RW.slot },
          !result.archived && primaryStatus.state !== 'idle' && React.createElement(SessionStatusDots, { statuses })),
        React.createElement('span', { key: 'title', className: RW.searchResultTitle }, result.title || t('session.untitled')),
      ];
      if (result.archived && canUnarchive) {
        headingChildren.push(React.createElement('span', { key: 'actions', className: RW.rowActions },
          React.createElement(P.Tooltip, {
            label: t('actions.unarchive'),
            side: 'bottom',
            align: 'end',
            delayMs: 500,
            portal: true,
          }, React.createElement('button', {
            type: 'button',
            className: RW.iconButton,
            'aria-label': t('menu.unarchiveSession'),
            onClick: (e) => { e.stopPropagation(); onUnarchive(result.id); },
          }, React.createElement(P.IconUnarchiveOutlineRegular, { size: 14 })))));
      }
      return React.createElement('div', {
        className: clsx(RW.searchResultRow, selected && RW.selected, result.archived && RW.archived),
        role: 'treeitem',
        'aria-selected': selected,
        'aria-description': result.archived ? t('toast.archivedNotOpenable') : undefined,
        onClick: () => { onOpen(result.id); },
      },
        React.createElement('span', { className: RW.searchResultHeading }, headingChildren),
        React.createElement('span', { className: RW.searchResultMeta },
          React.createElement('span', { className: RW.searchResultWorkspace }, result.workspace || t('group.ungrouped')),
          result.snippet !== undefined && React.createElement('span', { className: RW.searchResultSnippet }, result.snippet)),
      );
    }

    function SearchResults({ useSessions, useSessionStatus, open, onUnarchive, workspaces, archivedSessionIds, archivedFilter, query, remote, resultLimit, usePanelInfo, useSessionAccess, t }) {
      const panelActive = usePanelInfo((info) => info.activePanelId !== null);
      const list = useSessions((s) => s);
      const statuses = useSessionStatus((s) => s);
      const currentRemote = remote.query === query ? remote : { query, status: 'loading', items: [], hasMore: false };
      const results = React.useMemo(() => deriveSearchResults(list, workspaces, query, archivedSessionIds, archivedFilter, statuses, currentRemote, resultLimit), [list, workspaces, query, archivedSessionIds, archivedFilter, statuses, currentRemote, resultLimit]);
      const pending = currentRemote.status === 'loading';
      const currentId = panelActive ? undefined : mainSessionId(list);
      const skeletonCounts = results.items.length === 0 ? [0, 1] : [0];
      return React.createElement('div', {
        className: clsx(WB.treeBody, WB.wide),
      },
        React.createElement('div', { key: 'list', className: WB.list },
          React.createElement('div', {
            className: WB.searchTree,
            role: 'tree',
            'aria-label': t('search.results.aria'),
          }, results.items.map((result) => React.createElement(SearchResultItem, {
            key: result.id,
            result,
            currentId,
            onOpen: open,
            onUnarchive,
            useSessionAccess,
            t,
          }))),
          pending && React.createElement('div', { key: 'pending', role: 'status', 'aria-label': t('search.pending') },
            skeletonCounts.map((i) => React.createElement('div', { key: i, className: WB.skeletonRow, 'aria-hidden': 'true' },
              React.createElement('span', { className: WB.skeletonDot }),
              React.createElement('span', { className: WB.skeletonBars },
                React.createElement('span', { className: WB.skeletonBar }),
                React.createElement('span', { className: clsx(WB.skeletonBar, WB.skeletonBarWide) }))))),
          !pending && results.items.length === 0 && React.createElement('div', { key: 'none', className: WB.empty }, t('search.noMatches')),
          results.hasMore && React.createElement('div', { key: 'more', className: WB.searchStatus }, t('search.hasMore', { n: resultLimit })),
        ),
        React.createElement('span', { key: 'fade', className: WB.fade }),
      );
    }

    /**
     * workspace 重命名/删除对话框（uiw client.js:1799-1939 复刻）。按请求键控挂载
     * （`${action}/${workspaceId}`，uiw client.js:4152-4159），重名校验走
     * workspaceRenameReview 纯函数；输入框 IME 防误触 Enter（1887-1898）；
     * 删除提交后等列表里该 workspace 消失才 settle（1829-1838）。
     */
    function WorkspaceDialogs({ request, workspaces, renameWorkspace, deleteWorkspace, settleWorkspaceAction, t }) {
      const composingRef = React.useRef(false);
      const renameTarget = request.action === 'rename' ? request : null;
      const [renameDraft, setRenameDraft] = React.useState(request.displayTitle);
      const [renaming, setRenaming] = React.useState(false);
      const [renameError, setRenameError] = React.useState(null);
      const review = workspaceRenameReview(renameDraft, renameTarget, workspaces, renaming);
      const closeRename = () => {
        if (renaming) return;
        settleWorkspaceAction();
        setRenameError(null);
      };
      const confirmRename = () => {
        if (review.blocked) return;
        setRenaming(true);
        setRenameError(null);
        renameWorkspace(renameTarget.workspaceId, review.trimmed).then(() => {
          setRenaming(false);
          settleWorkspaceAction();
        }).catch((reason) => {
          setRenaming(false);
          setRenameError(reason instanceof Error ? reason.message : String(reason));
        });
      };
      const deleteTarget = request.action === 'delete' ? request : null;
      const [deleting, setDeleting] = React.useState(false);
      const [deleteCommittedId, setDeleteCommittedId] = React.useState(null);
      const [deleteError, setDeleteError] = React.useState(null);
      React.useEffect(() => {
        if (deleteCommittedId === null || workspaces.some((workspace) => workspace.workspaceId === deleteCommittedId)) return;
        setDeleting(false);
        setDeleteCommittedId(null);
        settleWorkspaceAction();
      }, [deleteCommittedId, workspaces, settleWorkspaceAction]);
      const closeDelete = () => {
        if (deleting) return;
        settleWorkspaceAction();
        setDeleteError(null);
      };
      const confirmDelete = () => {
        if (deleting || deleteTarget === null) return;
        setDeleting(true);
        setDeleteCommittedId(null);
        setDeleteError(null);
        deleteWorkspace(deleteTarget.workspaceId).then(() => {
          setDeleteCommittedId(deleteTarget.workspaceId);
        }).catch((reason) => {
          setDeleting(false);
          setDeleteError(reason instanceof Error ? reason.message : String(reason));
        });
      };
      return React.createElement(React.Fragment, null,
        React.createElement(P.Modal, {
          open: renameTarget !== null,
          onClose: closeRename,
          closeLabel: t('close'),
          title: t('rename.workspace.title'),
          footer: React.createElement(React.Fragment, null,
            React.createElement(P.Button, { variant: 'outline', disabled: renaming, onClick: closeRename }, t('cancel')),
            React.createElement(P.Button, { variant: 'primary', disabled: review.blocked, onClick: confirmRename }, t('rename'))),
          children: [
            React.createElement('input', {
              key: 'input',
              className: WB.renameInput,
              value: renameDraft,
              'aria-label': t('field.workspaceName'),
              'data-modal-autofocus': true,
              disabled: renaming,
              onFocus: (e) => { e.target.select(); },
              onChange: (e) => { setRenameDraft(e.target.value); setRenameError(null); },
              onCompositionStart: () => { composingRef.current = true; },
              onCompositionEnd: () => { composingRef.current = false; },
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !composingRef.current) {
                  e.preventDefault();
                  confirmRename();
                }
              },
            }),
            review.duplicate && React.createElement('div', { key: 'duplicate', className: WB.renameError, role: 'alert' }, t('conflict.named', { name: review.trimmed })),
            renameError !== null && React.createElement('div', { key: 'error', className: WB.renameError, role: 'alert' }, renameError),
          ],
        }),
        React.createElement(P.Modal, {
          open: deleteTarget !== null,
          onClose: closeDelete,
          closeLabel: t('close'),
          title: t('delete.workspace'),
          ...(deleteTarget === null ? {} : { description: t('delete.desc', { name: deleteTarget.displayTitle }) }),
          footer: React.createElement(React.Fragment, null,
            React.createElement(P.Button, { variant: 'outline', disabled: deleting, onClick: closeDelete }, t('cancel')),
            React.createElement(P.Button, { variant: 'outline', className: WB.deleteAction, disabled: deleting, onClick: confirmDelete }, t('delete.workspace'))),
          children: [
            deleting && React.createElement('div', { key: 'pending', className: WB.deleteStatus, role: 'status' }, t('delete.pending')),
            deleteError !== null && React.createElement('div', { key: 'error', className: WB.renameError, role: 'alert' }, deleteError),
          ],
        }),
      );
    }

    /** 添加工作区菜单的伪 id（uiw client.js:2734）。 */
    const ADD_WORKSPACE = '::add-workspace';

    /**
     * 添加工作区的 PickFlow：工作区菜单（同名消歧后缀）+「添加工作区…」入口 +
     * 目录流洞（`sidebar.workspaces.directoryFlow` 的 owner share）+ 采纳失败错误模态
     * （uiw client.js:2740-2900 复刻）。状态机 = createPickFlowMachine（可测纯逻辑）。
     */
    function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, useDirectoryFlow, renderDirectoryFlow, onPick, onClose, addOnly = false, onBusyChange, side = 'bottom', selectedId }) {
      const workspaceSnapshot = useWorkspaces((state) => state);
      const workspaces = workspaceSnapshot.items;
      const getAnchorRect = React.useCallback(() => anchorRef?.current?.getBoundingClientRect() ?? null, [anchorRef]);
      const machine = createPickFlowMachine();
      const [flow, setFlow] = React.useState(machine.initial);
      const flowRef = React.useRef(flow);
      flowRef.current = flow;
      const dispatch = (event) => {
        const next = machine.reduce(flowRef.current, event);
        flowRef.current = next.state;
        setFlow(next.state);
        for (const effect of next.effects) {
          if (effect.type === 'close') onClose();
          else if (effect.type === 'pick') onPick(effect.workspaceId);
        }
      };
      const flowBusy = machine.flowBusy(flow);
      React.useEffect(() => { onBusyChange?.(flowBusy); }, [flowBusy, onBusyChange]);
      const flowAvailable = useDirectoryFlow((occupied) => occupied);
      React.useEffect(() => {
        if (flow.flowOpen && !flowAvailable) dispatch({ type: 'flowUnavailable' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [flow.flowOpen, flowAvailable]);
      const adopt = (path) => {
        createWorkspace({ path }).then((workspace) => {
          dispatch({ type: 'adoptSucceeded', workspaceId: workspace.workspaceId });
        }).catch((reason) => {
          dispatch({ type: 'adoptFailed', message: reason instanceof Error ? reason.message : String(reason) });
        });
      };
      const addEntries = flowAvailable ? [{
        id: ADD_WORKSPACE,
        label: t('menu.addWorkspace'),
        icon: React.createElement(P.IconPlusOutlineRegular, { size: 16 }),
        disabled: flowBusy,
      }] : [];
      const pinAdd = !addOnly && workspaces.length > 0;
      const defaultWorkspaceName = t('workspace.defaultName');
      const listed = React.useMemo(() => {
        if (!pinAdd) return [];
        const rows = workspaces.map((workspace) => ({
          id: workspace.workspaceId,
          title: workspaceDisplayTitle(workspace.title, defaultWorkspaceName),
          path: workspace.path,
        }));
        const suffixes = distinguishingPathSuffixes(rows);
        return rows.map((row) => ({ ...row, suffix: suffixes.get(row.id) }));
      }, [pinAdd, workspaces, defaultWorkspaceName]);
      const items = pinAdd ? listed.map(({ id, title, path, suffix }) => ({
        id,
        label: suffix === undefined ? title : React.createElement('span', {
          className: WP.disambiguated,
          title: path,
        }, React.createElement('span', { className: WP.title }, title), ' ', React.createElement('span', { className: WP.pathSuffix }, suffix)),
        icon: React.createElement(P.IconFolderCloseRegular, { size: 16 }),
        disabled: flowBusy,
      })) : addEntries;
      const menuIsEmpty = items.length === 0;
      const listSettled = addOnly || workspaceSnapshot.phase === 'ready';
      const addIsTheOnlyEntry = !pinAdd && listSettled && addEntries.length === 1;
      React.useEffect(() => {
        if (machine.autoOpenShouldFire({ open, addIsTheOnlyEntry, flowBusy })) dispatch({ type: 'openFlow' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [open, addIsTheOnlyEntry, flowBusy]);
      const handleSelect = (id) => {
        if (id === ADD_WORKSPACE) {
          dispatch({ type: 'selectAdd' });
          return;
        }
        onPick(id);
      };
      return React.createElement(React.Fragment, null,
        React.createElement(P.Menu, {
          open: open && !addIsTheOnlyEntry && !menuIsEmpty,
          anchor: null,
          items,
          ...(pinAdd ? { footer: addEntries } : {}),
          selectedId,
          onSelect: handleSelect,
          onClose,
          side,
          portal: true,
          getAnchorRect,
        }),
        open && !addIsTheOnlyEntry && !menuIsEmpty && workspaceSnapshot.phase === 'pending' && React.createElement('div', {
          className: WP.menuStatus,
          role: 'status',
        }, t('picker.loading')),
        renderDirectoryFlow({
          open: flow.flowOpen,
          busy: flow.pickingFolder,
          onPicked: (path) => {
            dispatch({ type: 'pickSubmitted' });
            adopt(path);
          },
          onCancel: () => { dispatch({ type: 'flowCancel' }); },
          onError: (message) => { dispatch({ type: 'flowError', message }); },
        }),
        React.createElement(P.Modal, {
          open: flow.errorOpen,
          onClose: () => { dispatch({ type: 'errorDismiss' }); },
          closeLabel: t('close'),
          title: t('folderError.title'),
          footer: React.createElement(React.Fragment, null,
            React.createElement(P.Button, { variant: 'outline', className: WP.modalAction, onClick: () => { dispatch({ type: 'errorDismiss' }); } }, t('cancel')),
            React.createElement(P.Button, { variant: 'primary', className: WP.modalAction, disabled: !flowAvailable, onClick: () => { dispatch({ type: 'openFlow' }); } }, t('folderError.retry'))),
          children: React.createElement('div', { className: WP.modalError, role: 'alert' }, flow.modalError),
        }),
      );
    }

    /**
     * 浏览区本体（uiw client.js:3663-4162 的 shadow 复刻）。
     * T2 增量：添加工作区按钮 + WorkspacePickFlow（4043-4061）、WorkspaceDialogs 挂载
     * （4152-4159）、目录流可用性经 useDirectoryFlow（hooks.directoryFlow）。
     * 搜索快捷键信号读共享的 workspaceShortcuts store（对内置 controls 的探测，见 apply）。
     */
    function WorkspaceBrowserShadow({ wide, usePanelInfo, expandSidebar, useSessions, useSessionStatus, useRemoteAccess, useSessionAccess, useWorkspaceAccess, useWorkspaces, useStore, actions, startSession, open, requestSessionRename, notifyArchivedNotOpenable, renameWorkspace, useWorkspaceActionRequest, settleWorkspaceAction, deleteWorkspace, insertWorkspaceBefore, unarchiveSession, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostInfo, useShortcuts, useWorkspaceShortcuts, requestSearch, requestAddWorkspace, closeAddWorkspace, setDirectoryBusy, renderSlot, openSessionMenu, openWorkspaceMenu, useContextMenuTarget, useContextMenu, t }) {
      const home = useHostInfo((info) => info.home);
      const shortcuts = useShortcuts((rows) => rows);
      const searchShortcut = shortcuts.find((row) => row.id === 'session.search');
      const addShortcut = shortcuts.find((row) => row.id === 'workspace.add');
      const shortcutState = useWorkspaceShortcuts((state) => state);
      const list = useSessions((state) => state);
      const storedWorkspaces = useWorkspaces((state) => state.items);
      const defaultWorkspaceName = t('workspace.defaultName');
      const workspaces = React.useMemo(() => storedWorkspaces.map((workspace) => ({
        ...workspace,
        title: workspaceDisplayTitle(workspace.title, defaultWorkspaceName),
      })), [storedWorkspaces, defaultWorkspaceName]);
      const workspacePhase = useWorkspaces((state) => state.phase);
      const workspaceStreamState = useWorkspaces((state) => state.state);
      const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
      const pinnedSessionIds = useWorkspaces((state) => state.pinnedSessionIds);
      const directoryFlowAvailable = useDirectoryFlow((occupied) => occupied);
      const groupBy = useStore((s) => s.groupBy);
      const orderBy = useStore((s) => s.orderBy);
      const archivedFilter = useStore((s) => s.archivedFilter ?? 'default');
      const groupExpansion = useStore((s) => s.groupExpansion);
      const sessionOrderByAccount = useStore((s) => s.sessionOrderByAccount);
      const guardedOpen = (sessionId) => {
        if (archivedSessionIds.includes(sessionId)) {
          notifyArchivedNotOpenable();
          return;
        }
        open(sessionId);
      };
      const leaveArchivedOnly = () => {
        actions.setArchivedFilter('default');
      };
      const workspaceReady = workspacePhase === 'ready' && workspaceStreamState !== 'loading';
      const mainViewSessionId = mainSessionId(list);
      const currentBlank = mainViewSessionId !== undefined && list.byId[mainViewSessionId]?.blank === true ? mainViewSessionId : undefined;
      const ungroupedMemberIds = React.useMemo(() => {
        const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
        return list.ids.filter((id) => list.byId[id] !== undefined && !accounted.has(id));
      }, [list, workspaces]);
      const orderState = React.useMemo(() => ({
        pinnedSessionIds,
        archivedSessionIds,
      }), [archivedSessionIds, pinnedSessionIds]);
      const rowState = React.useMemo(() => ({
        ...orderState,
        archivedFilter,
      }), [orderState, archivedFilter]);
      const flatMemberIds = React.useMemo(() => sessionMemberIds(list), [list]);
      const orderedWorkspaces = React.useMemo(() => workspaces.map((workspace) => {
        const memberIds = workspace.sessionIds;
        const baseOrder = orderBy === 'updated'
          ? orderByRecency(memberIds, list.byId)
          : reconcileManualOrder(memberIds, sessionOrderByAccount[workspace.workspaceId], list.byId, orderState);
        return {
          ...workspace,
          sessionIds: pinCurrentBlank(baseOrder, currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined),
        };
      }), [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, workspaces]);
      const orderedUngroupedSessionIds = React.useMemo(() => {
        return pinCurrentBlank(
          orderBy === 'updated'
            ? orderByRecency(ungroupedMemberIds, list.byId)
            : reconcileManualOrder(ungroupedMemberIds, sessionOrderByAccount[''], list.byId, orderState),
          currentBlank !== undefined && ungroupedMemberIds.includes(currentBlank) ? currentBlank : undefined,
        );
      }, [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, ungroupedMemberIds]);
      const orderedFlatSessionIds = React.useMemo(() => {
        return pinCurrentBlank(
          orderBy === 'updated'
            ? orderByRecency(flatMemberIds, list.byId)
            : reconcileManualOrder(flatMemberIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY], list.byId, orderState),
          currentBlank !== undefined && flatMemberIds.includes(currentBlank) ? currentBlank : undefined,
        );
      }, [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, flatMemberIds]);
      const activeSessionOrders = React.useMemo(() => Object.fromEntries([
        ...orderedWorkspaces.map((workspace) => [workspace.workspaceId, workspace.sessionIds]),
        ['', orderedUngroupedSessionIds],
        [FLAT_SESSION_ORDER_KEY, orderedFlatSessionIds],
      ]), [orderedFlatSessionIds, orderedUngroupedSessionIds, orderedWorkspaces]);
      React.useEffect(() => {
        if (workspacePhase !== 'ready') return;
        actions.retainAccountKeys(['', FLAT_SESSION_ORDER_KEY, ...workspaces.map((workspace) => workspace.workspaceId)]);
      }, [actions.retainAccountKeys, workspacePhase, workspaces]);
      React.useEffect(() => {
        if (list.phase !== 'ready' || workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return;
        const changed = {};
        for (const [key, ids] of Object.entries(activeSessionOrders)) {
          if (key !== FLAT_SESSION_ORDER_KEY && workspacePhase !== 'ready') continue;
          const saved = sessionOrderByAccount[key] ?? [];
          if (ids[0] !== currentBlank || saved[0] === currentBlank) continue;
          changed[key] = [currentBlank, ...saved.filter((id) => id !== currentBlank)];
        }
        if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed);
      }, [actions.syncSessionOrders, activeSessionOrders, currentBlank, list.phase, orderBy, sessionOrderByAccount, workspacePhase, workspaceReady]);
      React.useEffect(() => {
        if (list.phase !== 'ready' || !workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return;
        if (Object.entries(activeSessionOrders).some(([key, ids]) => ids[0] === currentBlank && sessionOrderByAccount[key]?.[0] !== currentBlank)) actions.syncSessionOrders(activeSessionOrders);
      }, [actions.syncSessionOrders, activeSessionOrders, currentBlank, list.phase, orderBy, sessionOrderByAccount, workspaceReady]);
      const saveSessionOrder = (accountKey, order) => {
        actions.setSessionOrder(accountKey, order, activeSessionOrders);
      };
      const [query, setQuery] = React.useState('');
      const [searchExpanded, setSearchExpanded] = React.useState(false);
      const [searchSpacingMotionEnabled, setSearchSpacingMotionEnabled] = React.useState(false);
      const [searchOnExpand, setSearchOnExpand] = React.useState(false);
      const [lastSearchRequest, setLastSearchRequest] = React.useState(0);
      if (lastSearchRequest !== shortcutState.searchRequest) {
        setLastSearchRequest(shortcutState.searchRequest);
        if (shortcutState.searchRequest !== 0) {
          setSearchExpanded(true);
          setSearchSpacingMotionEnabled(wide);
          if (!wide) setSearchOnExpand(true);
        }
      }
      if (!wide && searchSpacingMotionEnabled) setSearchSpacingMotionEnabled(false);
      const changeSearchExpanded = (expanded) => {
        setSearchSpacingMotionEnabled(wide);
        setSearchExpanded(expanded);
      };
      const [revealSessionId, setRevealSessionId] = React.useState(undefined);
      const normalizedQuery = sanitizeSearchQuery(query).trim();
      const [remoteSearch, setRemoteSearch] = React.useState({ query: '', status: 'idle', items: [], hasMore: false });
      const searchRoot = React.useRef(null);
      const searchInput = React.useRef(null);
      const wsPickerOpen = shortcutState.addRequested;
      const wsPlusRef = React.useRef(null);
      const workspaceActionRequest = useWorkspaceActionRequest((value) => value);
      const openSearchResult = (sessionId) => {
        if (archivedSessionIds.includes(sessionId)) {
          notifyArchivedNotOpenable();
          return;
        }
        setRevealSessionId(sessionId);
        setQuery('');
        changeSearchExpanded(false);
        open(sessionId);
      };
      const acknowledgeSessionReveal = (sessionId) => {
        setRevealSessionId((current) => current === sessionId ? undefined : current);
      };
      React.useEffect(() => {
        if (normalizedQuery !== '') setRevealSessionId(undefined);
      }, [normalizedQuery]);
      React.useEffect(() => {
        if (wide && searchOnExpand) {
          const timer = window.setTimeout(() => {
            searchInput.current?.focus({ preventScroll: true });
            setSearchOnExpand(false);
          }, EXPAND_SLIDE_MS);
          return () => { window.clearTimeout(timer); };
        }
        return undefined;
      }, [wide, searchOnExpand]);
      React.useEffect(() => {
        if (shortcutState.searchRequest === 0) return;
        closeAddWorkspace();
        if (!wide || searchInput.current?.closest('[inert]')) {
          setSearchOnExpand(true);
          expandSidebar();
        } else searchInput.current?.focus({ preventScroll: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [shortcutState.searchRequest]);
      React.useEffect(() => {
        if (!wide || searchExpanded || searchOnExpand) return;
        searchInput.current?.focus({ preventScroll: true });
      }, [wide, searchExpanded, searchOnExpand]);
      React.useEffect(() => {
        if (!wide || !searchExpanded || searchOnExpand) return undefined;
        const onClick = (event) => {
          if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return;
          searchInput.current?.blur();
          if (normalizedQuery !== '') return;
          changeSearchExpanded(false);
        };
        document.addEventListener('click', onClick);
        return () => { document.removeEventListener('click', onClick); };
      }, [normalizedQuery, wide, searchExpanded, searchOnExpand]);
      React.useEffect(() => {
        if (normalizedQuery === '') {
          setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false });
          return undefined;
        }
        const controller = new AbortController();
        setRemoteSearch({ query: normalizedQuery, status: 'loading', items: [], hasMore: false });
        const timer = window.setTimeout(() => {
          searchSessions(normalizedQuery, controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            setRemoteSearch({ query: normalizedQuery, status: 'ready', items: result.items, hasMore: result.hasMore });
          }).catch(() => {
            if (controller.signal.aborted) return;
            setRemoteSearch({ query: normalizedQuery, status: 'error', items: [], hasMore: false });
          });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
          window.clearTimeout(timer);
          controller.abort();
        };
      }, [normalizedQuery, searchSessions]);
      const onSessionUnarchive = (sessionId) => {
        unarchiveSession(sessionId).catch((reason) => {
          console.warn('session-tags: session unarchive rejected:', reason);
        });
      };
      const headerChildren = [];
      if (wide) {
        headerChildren.push(React.createElement('span', {
          key: 'label',
          className: clsx(WB.sectionLabel, WB.wide, searchExpanded && WB.sectionLabelHidden),
        }, groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')));
        headerChildren.push(React.createElement('div', {
          key: 'searchSlot',
          className: clsx(WB.searchSlot, searchExpanded && WB.searchSlotExpanded),
        }, React.createElement('div', {
          ref: searchRoot,
          className: clsx(WB.search, searchExpanded && WB.searchExpanded),
          onClick: () => {
            closeAddWorkspace();
            changeSearchExpanded(true);
            searchInput.current?.focus();
          },
        },
          React.createElement(P.Tooltip, {
            key: 'icon',
            label: t('search.sessions.aria'),
            shortcutKeys: searchShortcut?.keys,
            side: 'bottom',
            delayMs: 500,
            disabled: searchExpanded,
            portal: true,
          }, React.createElement('button', {
            type: 'button',
            className: WB.searchButton,
            'aria-label': t('search.sessions.aria'),
            'aria-keyshortcuts': searchShortcut?.aria,
            'aria-expanded': searchExpanded,
            onClick: () => { requestSearch(); },
          }, React.createElement(P.IconSearchOutlineRegular, { size: searchExpanded ? 11 : 14 }))),
          React.createElement('input', {
            key: 'input',
            ref: searchInput,
            className: WB.searchInput,
            type: 'text',
            placeholder: t('search.placeholder'),
            maxLength: SEARCH_QUERY_MAX_CODE_UNITS,
            value: query,
            tabIndex: searchExpanded ? 0 : -1,
            onChange: (e) => { setQuery(sanitizeSearchQuery(e.target.value)); },
            onKeyDown: (e) => {
              if (e.key !== 'Escape') return;
              setQuery('');
              changeSearchExpanded(false);
            },
          }),
          searchExpanded && React.createElement('button', {
            key: 'clear',
            type: 'button',
            className: WB.clearButton,
            'aria-label': t('search.clear'),
            onClick: (e) => {
              e.stopPropagation();
              setQuery('');
              changeSearchExpanded(false);
            },
          }, React.createElement(P.IconCloseFillRegular, null)))));
      }
      headerChildren.push(React.createElement('div', {
        key: 'actions',
        className: clsx(WB.headerActions, wide && searchExpanded && WB.headerActionsHidden),
      },
        wide && React.createElement(ViewOptionsMenu, {
          groupBy,
          orderBy,
          archivedFilter,
          onGroupPick: actions.setGroupBy,
          onOrderPick: (mode) => { actions.setOrderBy(mode, activeSessionOrders); },
          onArchivedFilterPick: actions.setArchivedFilter,
          t,
        }),
        // 添加工作区按钮：仅目录流占位在位时渲染（uiw client.js:4024-4041；rail 态也显示，尺寸 18）。
        directoryFlowAvailable && React.createElement(P.Tooltip, {
          label: t('workspace.add'),
          shortcutKeys: addShortcut?.keys,
          side: 'bottom',
          delayMs: 500,
          portal: true,
        }, React.createElement('button', {
          ref: wsPlusRef,
          type: 'button',
          className: WB.iconButton,
          'aria-label': t('workspace.add'),
          'aria-keyshortcuts': addShortcut?.aria,
          onClick: () => { requestAddWorkspace(); },
        }, React.createElement(P.IconProjectAddOutlineRegular, { size: wide ? 16 : 18 })))));
      // 添加工作区 PickFlow：锚在 + 按钮上，目录流经子座位洞透传 owner share
      // （uiw client.js:4043-4061；采纳成功后 startSession 接管新 workspace 的首会话）。
      headerChildren.push(React.createElement(WorkspacePickFlow, {
        key: 'pickFlow',
        t,
        open: wsPickerOpen,
        anchorRef: wsPlusRef,
        useWorkspaces,
        createWorkspace,
        useDirectoryFlow,
        renderDirectoryFlow: (owner) => renderSlot('sidebar.workspaces.directoryFlow', owner),
        addOnly: true,
        onBusyChange: setDirectoryBusy,
        side: 'right',
        onPick: (workspaceId) => {
          closeAddWorkspace();
          startSession(workspaceId, { clearPreviousDraft: false });
        },
        onClose: () => {
          closeAddWorkspace();
        },
      }));
      const listChildren = [];
      if (wide) {
        if (normalizedQuery !== '') {
          listChildren.push(React.createElement(SearchResults, {
            key: 'search',
            usePanelInfo,
            useSessionAccess,
            useSessions,
            useSessionStatus,
            open: openSearchResult,
            onUnarchive: onSessionUnarchive,
            workspaces,
            archivedSessionIds,
            archivedFilter,
            query: normalizedQuery,
            remote: remoteSearch,
            resultLimit: searchResultLimit,
            t,
          }));
        } else if (groupBy === 'flat') {
          listChildren.push(React.createElement(FlatList, {
            key: 'flat',
            useSessionAccess,
            usePanelInfo,
            list,
            home,
            sessionIds: orderedFlatSessionIds,
            rowState,
            onLeaveArchivedOnly: leaveArchivedOnly,
            workspaceReady,
            animationResetKey: groupBy + '/' + orderBy + '/' + archivedFilter,
            useSessionStatus,
            open: guardedOpen,
            onSessionRenameRequest: requestSessionRename,
            renderSlot,
            openSessionMenu,
            useContextMenu,
            useContextMenuTarget,
            setSessionOrder: saveSessionOrder,
            revealSessionId,
            onSessionRevealed: acknowledgeSessionReveal,
            t,
          }));
        } else {
          listChildren.push(React.createElement(SessionTree, {
            key: 'tree',
            useRemoteAccess,
            useSessionAccess,
            useWorkspaceAccess,
            usePanelInfo,
            list,
            home,
            shortcuts,
            useSessionStatus,
            onSessionRenameRequest: requestSessionRename,
            renderSlot,
            openSessionMenu,
            useContextMenu,
            openWorkspaceMenu,
            useContextMenuTarget,
            workspaces: orderedWorkspaces,
            ungroupedSessionIds: orderedUngroupedSessionIds,
            workspaceReady,
            nestWorkspaces: groupBy === 'workspace-tree',
            animationResetKey: groupBy + '/' + orderBy + '/' + archivedFilter,
            groupExpansion,
            setGroupExpanded: actions.setGroupExpanded,
            setSessionOrder: saveSessionOrder,
            rowState,
            onLeaveArchivedOnly: leaveArchivedOnly,
            startSession,
            open: guardedOpen,
            insertWorkspaceBefore,
            revealSessionId,
            onSessionRevealed: acknowledgeSessionReveal,
            t,
          }));
        }
      }
      const rootChildren = [
        React.createElement('div', {
          key: 'header',
          className: clsx(WB.sectionHeader, wide && searchSpacingMotionEnabled && WB.searchSpacingMotion),
        }, headerChildren),
        !wide && React.createElement('div', { key: 'railSearch', className: WB.search },
          React.createElement(P.Tooltip, {
            label: t('search.sessions.aria'),
            shortcutKeys: searchShortcut?.keys,
            portal: true,
          }, React.createElement('button', {
            type: 'button',
            className: WB.searchButton,
            'aria-label': t('search.sessions.aria'),
            'aria-keyshortcuts': searchShortcut?.aria,
            onClick: () => { requestSearch(); },
          }, React.createElement(P.IconSearchOutlineRegular, { size: 18 })))),
        React.createElement('div', { key: 'listArea', className: WB.listArea }, listChildren),
        // workspace 重命名/删除对话框：按请求键控挂载，请求来自共享的 workspaceActionRequest
        // store（内置 workspace 菜单项置入，本组件经探测读同一 store，uiw client.js:4152-4159）。
        workspaceActionRequest !== null && React.createElement(WorkspaceDialogs, {
          key: workspaceActionRequest.action + '/' + workspaceActionRequest.workspaceId,
          request: workspaceActionRequest,
          workspaces,
          renameWorkspace,
          deleteWorkspace,
          settleWorkspaceAction,
          t,
        }),
      ];
      return React.createElement('div', { className: clsx(WB.root, !wide && WB.rail) }, rootChildren);
    }

    // =====================================================================
    // apply：解析依赖、注册词表、装配 store 与 inject 面板、shadow 注册。
    // =====================================================================

    /**
     * 对内置 browserInjected / rowToastInjected 的运行时探测：
     * 内置插件对 sidebar.workspaces 的注册（落选方）仍持有 inject 工厂，调用它即可拿到
     * 内置私有的快捷键控件 store、重命名请求入口与行 toast store——shadow 后与内置
     * 快捷键（Cmd+K 搜索聚焦等）继续共用同一信号源。探测失败一律回退到本地 inert 实现。
     */
    function probeBuiltinSharedState(ctx, notifyFallback) {
      const shared = {};
      const readInject = (entry) => {
        const factory = entry?.options?.inject ?? entry?.inject;
        if (typeof factory !== 'function') return null;
        try { return factory(); } catch { return null; }
      };
      try {
        for (const entry of ctx.slots.entries(SLOT_NAME)) {
          const payload = readInject(entry);
          if (payload === null || typeof payload !== 'object') continue;
          if (shared.workspaceShortcuts === undefined && payload.hooks?.workspaceShortcuts?.getSnapshot !== undefined) {
            shared.workspaceShortcuts = payload.hooks.workspaceShortcuts;
          }
          if (shared.requestSessionRename === undefined && typeof payload.requestSessionRename === 'function') {
            shared.requestSessionRename = payload.requestSessionRename;
          }
          if (shared.workspaceActionRequest === undefined && payload.hooks?.workspaceActionRequest?.getSnapshot !== undefined) {
            shared.workspaceActionRequest = payload.hooks.workspaceActionRequest;
          }
          if (shared.settleWorkspaceAction === undefined && typeof payload.settleWorkspaceAction === 'function') {
            shared.settleWorkspaceAction = payload.settleWorkspaceAction;
          }
        }
      } catch (error) {
        console.warn('session-tags: builtin browser inject probe failed:', error);
      }
      try {
        for (const entry of ctx.slots.entries('shell.overlay')) {
          const payload = readInject(entry);
          const toast = payload?.hooks?.toast;
          if (toast !== null && toast !== undefined && typeof toast.set === 'function') {
            let seq = 0;
            shared.notify = (toastBody) => { toast.set({ ...toastBody, seq: (seq += 1) }); };
            break;
          }
        }
      } catch (error) {
        console.warn('session-tags: builtin row toast probe failed:', error);
      }
      if (shared.notify === undefined) shared.notify = notifyFallback;
      return shared;
    }

    /** 内置 browserInjected 的对应物（uiw client.js:5983-6044）。 */
    function createBrowserInjected(ctx, deps, shared) {
      const { sessions, workspaces, uiWorkspace, myWorkspaceActionRequest, inertShortcutState } = deps;
      const searchSessions = async (query, signal) => {
        const result = await sessions.search(query, signal);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const flowSource = (hole) => ({
        getSnapshot: () => ctx.slots.entries(hole).length > 0,
        subscribe: (listener) => ctx.slots.subscribe(hole, listener),
      });
      const openSession = (sessionId) => { uiWorkspace.openSession(sessionId); };
      const bumpSearchRequest = () => {
        const state = shared.workspaceShortcuts;
        if (state?.getSnapshot === undefined || state?.set === undefined) return;
        const snapshot = state.getSnapshot();
        state.set({ ...snapshot, searchRequest: snapshot.searchRequest + 1 });
      };
      // workspace.add 请求通道：优先写共享（内置 controls）store，探测失败写本地 inert store
      // （补丁语义 = uiw client.js:54-71；directoryBusy 时 add 是 no-op）。
      const shortcutStore = () => shared.workspaceShortcuts ?? inertShortcutState;
      const patchShortcuts = (makePatch) => { applyShortcutPatch(shortcutStore(), makePatch(shortcutStore().getSnapshot())); };
      return () => ({
        openWorkspaceMenu: (workspaceId, path, displayTitle, point, mode) => {
          const target = ctx.contextMenus.active.getSnapshot();
          if (mode === 'toggle' && target?.kind === 'workspace' && target.value.workspaceId === workspaceId) ctx.contextMenus.close();
          else ctx.contextMenus.open({ kind: 'workspace', value: { workspaceId, path, displayTitle } }, point);
        },
        settleWorkspaceAction: shared.settleWorkspaceAction ?? (() => { myWorkspaceActionRequest.set(null); }),
        openSessionMenu: (sessionId, displayTitle, point, mode) => {
          const target = ctx.contextMenus.active.getSnapshot();
          if (mode === 'toggle' && target?.kind === 'session' && target.value.sessionId === sessionId) ctx.contextMenus.close();
          else ctx.contextMenus.open({ kind: 'session', value: { sessionId, displayTitle } }, point);
        },
        startSession: (workspaceId, options) => { uiWorkspace.startSession(workspaceId, options); },
        open: openSession,
        searchSessions,
        searchResultLimit: sessions.searchResultLimit,
        requestSessionRename: shared.requestSessionRename ?? (() => {}),
        notifyArchivedNotOpenable: () => { shared.notify({ kind: 'archivedNotOpenable' }); },
        renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title); },
        deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId); },
        insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => { await workspaces.insertBefore(workspaceId, beforeWorkspaceId); },
        unarchiveSession: async (sessionId) => { await uiWorkspace.unarchiveSession(sessionId); },
        createWorkspace: (input) => workspaces.create(input),
        requestSearch: bumpSearchRequest,
        requestAddWorkspace: () => { patchShortcuts((snapshot) => shortcutPatchForAdd(snapshot)); },
        closeAddWorkspace: () => { patchShortcuts(() => shortcutPatchForCloseAdd()); },
        setDirectoryBusy: (busy) => { patchShortcuts(() => shortcutPatchForDirectoryBusy(busy)); },
        hooks: {
          workspaceActionRequest: shared.workspaceActionRequest ?? myWorkspaceActionRequest,
          contextMenuTarget: ctx.contextMenus.active,
          directoryFlow: flowSource('sidebar.workspaces.directoryFlow'),
          hostInfo: {
            getSnapshot: () => ctx.remote.$host,
            subscribe: (listener) => ctx.on('connection/reset', listener),
          },
          workspaceShortcuts: shared.workspaceShortcuts ?? inertShortcutState,
          shortcuts: ctx.shortcuts.catalog,
        },
      });
    }

    /** zh 词表：内置 workspace ns 的复刻（uiw client.js:4758-4878），键集逐字对齐。 */
    const zh = {
      'group.ungrouped': '未分组',
      'session.new': '新会话',
      'session.untitled': '未命名',
      'section.workspaces': '工作区',
      'section.sessions': '会话',
      'viewOptions.label': '视图选项',
      'groupBy.label': '分组方式',
      'groupBy.workspace': '按工作区',
      'groupBy.workspaceTree': '按工作区树',
      'groupBy.flat': '单列表',
      'orderBy.label': '排序方式',
      'orderBy.manual': '手动排序',
      'orderBy.updated': '最近更新',
      'filterBy.label': '筛选会话',
      'viewOptions.hideArchived': '隐藏已归档',
      'viewOptions.showArchived': '全部对话（显示已归档）',
      'viewOptions.onlyArchived': '仅显示已归档',
      'sessions.expand': '展开其余 {n} 个会话',
      'sessions.collapse': '收起',
      'empty.none': '暂无会话',
      'empty.noneArchived': '暂无已归档会话',
      'empty.viewOthers': '查看其他会话',
      'search.sessions.aria': '搜索会话',
      'search.placeholder': '搜索会话名称',
      'search.clear': '清除搜索',
      'search.results.aria': '搜索结果',
      'search.pending': '正在搜索会话历史…',
      'search.noMatches': '无匹配会话',
      'search.hasMore': '仅显示前 {n} 条结果，请缩小搜索范围。',
      'row.archived': '已归档',
      'row.pinned': '已置顶',
      'toast.archivedNotOpenable': '已归档对话暂时无法查看，请取消归档后查看',
      'menu.unarchiveSession': '取消归档',
      'actions.unarchive': '取消归档',
      'workspace.add': '添加工作区',
      'menu.addWorkspace': '添加工作区…',
      'picker.loading': '正在加载工作区…',
      'folderError.title': '无法打开文件夹',
      'folderError.retry': '重新选择',
      'rename': '重命名',
      'rename.workspace.title': '重命名工作区',
      'field.workspaceName': '工作区名称',
      'conflict.named': '已存在名为“{name}”的工作区。',
      'delete.workspace': '删除工作区',
      'delete.desc': '将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。',
      'delete.pending': '正在删除工作区…',
      'close': '关闭',
      'cancel': '取消',
      'actions.workspace.aria': '工作区“{name}”的操作',
      'actions.session.aria': '会话“{name}”的操作',
      'actions.newSession': '新会话',
      'actions.newSession.aria': '在“{name}”中新建会话',
      'status.running': '进行中',
      'status.subagentsRunning.one': '{n} 个子智能体运行中',
      'status.subagentsRunning.other': '{n} 个子智能体运行中',
      'status.idle': '空闲',
      'status.waitingApproval': '等待审批',
      'status.planReview': '计划待审',
      'status.waitingAnswer': '等待回答',
      'status.compact.approval': '待审批',
      'status.compact.planReview': '计划待审',
      'status.compact.answer': '待回答',
      'status.completed': '已完成',
      'copy': '复制',
      'date.ymd': '{y}年{m}月{d}日',
      'time.now': '刚刚',
      'time.minutes': '{n}分钟',
      'time.hours': '{n}小时',
      'time.days': '{n}天',
      'time.months': '{n}个月',
      'time.years': '{n}年',
      'time.ago': '{t}前',
      'hover.created': '创建于 {time}',
    };

    /** en 词表：与 zh 键集一致（uiw client.js:4880-5000）。 */
    const en = {
      'group.ungrouped': 'Ungrouped',
      'session.new': 'New Session',
      'session.untitled': 'Untitled',
      'section.workspaces': 'Workspaces',
      'section.sessions': 'Sessions',
      'viewOptions.label': 'View options',
      'groupBy.label': 'Group by',
      'groupBy.workspace': 'WorkSpace',
      'groupBy.workspaceTree': 'Workspace Tree',
      'groupBy.flat': 'In one list',
      'orderBy.label': 'Order by',
      'orderBy.manual': 'Manual',
      'orderBy.updated': 'Last updated',
      'filterBy.label': 'Filter sessions',
      'viewOptions.hideArchived': 'Hide archived',
      'viewOptions.showArchived': 'All conversations (show archived)',
      'viewOptions.onlyArchived': 'Archived only',
      'sessions.expand': 'Show {n} more sessions',
      'sessions.collapse': 'Show less',
      'empty.none': 'No sessions yet',
      'empty.noneArchived': 'No archived sessions yet',
      'empty.viewOthers': 'View other sessions',
      'search.sessions.aria': 'Search sessions',
      'search.placeholder': 'Search session names',
      'search.clear': 'Clear search',
      'search.results.aria': 'Search results',
      'search.pending': 'Searching session history…',
      'search.noMatches': 'No matching sessions',
      'search.hasMore': 'Showing the first {n} results. Narrow your search.',
      'row.archived': 'Archived',
      'row.pinned': 'Pinned',
      'toast.archivedNotOpenable': 'Archived sessions cannot be opened. Unarchive it to view.',
      'menu.unarchiveSession': 'Unarchive session',
      'actions.unarchive': 'Unarchive',
      'workspace.add': 'Add workspace',
      'menu.addWorkspace': 'Add workspace…',
      'picker.loading': 'Loading workspaces…',
      'folderError.title': 'Couldn’t open folder',
      'folderError.retry': 'Choose again',
      'rename': 'Rename',
      'rename.workspace.title': 'Rename workspace',
      'field.workspaceName': 'Workspace name',
      'conflict.named': 'A workspace named “{name}” already exists.',
      'delete.workspace': 'Delete workspace',
      'delete.desc': 'This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.',
      'delete.pending': 'Deleting workspace…',
      'close': 'Close',
      'cancel': 'Cancel',
      'actions.workspace.aria': 'Workspace actions for {name}',
      'actions.session.aria': 'Session actions for {name}',
      'actions.newSession': 'New session',
      'actions.newSession.aria': 'New session in {name}',
      'status.running': 'Running',
      'status.subagentsRunning.one': '{n} subagent running',
      'status.subagentsRunning.other': '{n} subagents running',
      'status.idle': 'Idle',
      'status.waitingApproval': 'Waiting for approval',
      'status.planReview': 'Plan awaiting review',
      'status.waitingAnswer': 'Waiting for answer',
      'status.compact.approval': 'Approval',
      'status.compact.planReview': 'Plan review',
      'status.compact.answer': 'Answer',
      'status.completed': 'Completed',
      'copy': 'Copy',
      'date.ymd': '{y}-{m}-{d}',
      'time.now': 'now',
      'time.minutes': '{n}min',
      'time.hours': '{n}h',
      'time.days': '{n}d',
      'time.months': '{n}mo',
      'time.years': '{n}y',
      'time.ago': '{t} ago',
      'hover.created': 'Created {time}',
    };

    return {
      inject: ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'contextMenus', 'remote', 'remoteAccess', 'shortcuts'],
      apply(ctx) {
        React = require('react');
        P = require('@deepseek-ai/dsh-client-ui-primitives');
        storeLib = require('@deepseek-ai/dsh-client-store');

        const sessions = ctx.get('sessions');
        const workspaces = ctx.get('workspaces');
        const uiWorkspace = ctx.get('uiWorkspace');

        // 视图状态：与内置同 persist 键（禁用回退时内置无缝接续同一份分组/排序/展开/手动序）。
        // T2：内置在位（先注册）时直接共享其 view store 句柄——归档 toast 的「显示已归档」
        // （uiw client.js:5912-5914 写内置 viewInstance）、uiWorkspace.pinSession 的本地序
        // （1551-1558）与本 shadow 的全部视图写落在同一实例，消除双实例漂移；
        // 内置未在位时回退本地实例（T1 同一降级语义）。
        const localViewHandle = storeLib.defineStore(workspaceViewStoreSpec());
        const localViewInstance = localViewHandle.create();
        let sharedViewStore = null;
        try {
          sharedViewStore = pickSharedViewStore(ctx.slots.entries(SLOT_NAME));
        } catch (error) {
          console.warn('session-tags: shared view store probe failed:', error);
        }
        const viewStore = sharedViewStore ?? { ...localViewHandle, create: () => localViewInstance };
        if (sharedViewStore === null) console.warn('session-tags: builtin view store not present; using local view store instance (toast archive-filter actions land after reload)');

        const inertShortcutState = storeLib.createSnapshotStore({ searchRequest: 0, addRequested: false, directoryBusy: false, renameTarget: null });
        const myWorkspaceActionRequest = storeLib.createSnapshotStore(null);
        const shared = probeBuiltinSharedState(ctx, (toast) => {
          console.warn('session-tags: toast unavailable (builtin row-toast probe failed):', toast?.kind);
        });

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-tags: dictionaries');

        const browserInjected = createBrowserInjected(ctx, { sessions, workspaces, uiWorkspace, myWorkspaceActionRequest, inertShortcutState }, shared);

        // shadow 注册：children 原样声明内置五座位（uiw client.js:6052-6075），
        // 行动作按钮/右键菜单/shell.overlay 对话框由内置的独立注册继续供给。
        ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
          name: SLOT_NAME,
          priority: SHADOW_PRIORITY,
          children: {
            'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
            'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
            'sidebar.session.row.leading': { kind: 'list', scope: 'root', inline: true },
            'sidebar.session.row.trailing': { kind: 'list', scope: 'root', inline: true },
            'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
          },
          store: viewStore,
          inject: browserInjected,
          locale: NS,
        }, WorkspaceBrowserShadow));
      },
      /**
       * 纯逻辑层测试 seam（spec「Testing Decisions」：只测外部行为；UI 渲染层不自动化测试）。
       * vitest 在 vm 沙箱里 factory(require) 后取 `logic` 直测，不经 React、不经 DOM。
       */
      logic: {
        SLOT_NAME,
        SHADOW_PRIORITY,
        VIEW_PERSIST_KEY,
        FLAT_SESSION_ORDER_KEY,
        DEFAULT_WORKSPACE_DIRECTORY,
        abbreviateHomePath,
        workspaceTitleOf,
        owningGroupKey,
        mainSessionId,
        workspaceLabel,
        workspaceDisplayTitle,
        distinguishingPathSuffixes,
        workspaceRenameReview,
        hoverTimeLabel,
        createdLabel,
        hoverStatuses,
        createPickFlowMachine,
        shortcutPatchForAdd,
        shortcutPatchForCloseAdd,
        shortcutPatchForDirectoryBusy,
        applyShortcutPatch,
        isValidViewStoreHandle,
        pickSharedViewStore,
        orderByRecency,
        reconcileManualOrder,
        pinCurrentBlank,
        sessionVisible,
        sectionMembers,
        sessionTitle,
        groupByWorkspace,
        orderedUngrouped,
        deriveGroups,
        sessionMemberIds,
        visibleSessionIds,
        deriveFlat,
        deriveSearchResults,
        owningParentFolder,
        folderPath,
        watermarkRows,
        requiredWatermark,
        raiseWatermarks,
        sanitizeSearchQuery,
        sessionDragOrder,
        sessionStatuses,
        viewOptionSelection,
        archivedSelectedId,
        viewOptionsMenuModel,
        workspaceViewStoreSpec,
        displayTitle,
      },
    };
  },
});
