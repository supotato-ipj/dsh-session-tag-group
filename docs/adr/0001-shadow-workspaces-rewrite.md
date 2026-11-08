# 0001 — 标签分组以纯插件 shadow 整区重写实现

DSH 的会话浏览区（内置插件 dsh-client-ui-sidebar 的 `sidebar.workspaces` 区域）是一个整体组件，运行时 slot 实查确认其不存在"分组模式"扩展点（single、replaceRisk=shadows-shipped-ui）。要让分组选项新增「按标签」，我们决定用纯插件 shadow 该区域整区重写，而不是 fork DSH 源码做内置改动，也不是另做独立标签面板。shadow 路线贴合"分组选项里多一项"的原始需求，且不产生 fork 维护负担；代价是搜索、置顶、归档、会话行、菜单、workspace 对话框等内置行为须在插件内复刻，DSH 升级后需回归测试。插件可随时禁用，回退到内置 UI。

## Considered Options

- **fork DSH 源码内置**：体验最正统、复用最多，但每次升级 DSH 都要 rebase fork 并重建 Desktop 安装包，长期维护最重——弃。
- **独立标签面板（不动内置列表）**：最快最稳，但不是"分组选项里多一项"，需求贴合度不足——弃。
- **shadow 整区重写（选定）**：需求贴合，升级风险收敛在插件内部。

## Consequences

- DSH 版本升级后，shadow 区的 UI 与行为需人工回归；内置新增功能不会自动出现。
- 标签数据存 Host 侧 storage domain（全局 JSON），与 shadow UI 解耦；UI 损坏不丢数据。

## 增补（2026-11-08，冷启动修复）

**slot 所有权约束**：`ctx.slots.register({ children })` 对每个 child 座位名查重——内置 WorkspaceBrowser 已声明
`sidebar.workspaces.directoryFlow` / `sidebar.workspaces.session.row.action` / `sidebar.session.row.{leading,trailing,hover}`，
重复声明抛 `slot "..." is already declared`；且 `renderSlot` 按条目绑定（`boundRenderSlot` 只允许渲染
`entry.children` 里的座位），影子条目渲染内置座位抛 `SlotOwnershipError`。两者的后果都是 client 入口激活/渲染失败，
桌面端冷启动整页失败。ADR 结论的落法：影子声明**自己的**私有座位（`session-tags.*`，kind/scope/inline 与内置逐项对齐），
并把原由内置子座位承载的功能复刻给自己——标签色点/悬停标签名照旧由本插件供给，archive/pin 行按钮复刻但
**动作面优先复用内置注册的 inject**（归档确认框 `shell.overlay` 与行 toast `workspace.row-toast` 仍是内置独立注册，
复用动作面才能继续生效），添加工作区目录流改为私有座位 + `uiWorkspace.pickDirectory()`。全局座位
（`contextMenu.content` / `contextMenu.icon` / `shell.overlay`）不受影响。

**Host domain 生命周期**：Cordis 的 `ctx.effect(setup, label)` 立即执行 setup、把返回值当 disposer；
`ctx.effect(() => domain.close(), ...)` 会在 apply 时立刻关闭刚打开的 storage domain，导致 `/session-tags` 全部读写
返回 `domain 'session_tags' is closed`。正确写法是 `ctx.effect(() => () => domain.close(), ...)`。

