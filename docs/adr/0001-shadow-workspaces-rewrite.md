# 0001 — 标签分组以纯插件 shadow 整区重写实现

DSH 的会话浏览区（内置插件 dsh-client-ui-sidebar 的 `sidebar.workspaces` 区域）是一个整体组件，运行时 slot 实查确认其不存在"分组模式"扩展点（single、replaceRisk=shadows-shipped-ui）。要让分组选项新增「按标签」，我们决定用纯插件 shadow 该区域整区重写，而不是 fork DSH 源码做内置改动，也不是另做独立标签面板。shadow 路线贴合"分组选项里多一项"的原始需求，且不产生 fork 维护负担；代价是搜索、置顶、归档、会话行、菜单、workspace 对话框等内置行为须在插件内复刻，DSH 升级后需回归测试。插件可随时禁用，回退到内置 UI。

## Considered Options

- **fork DSH 源码内置**：体验最正统、复用最多，但每次升级 DSH 都要 rebase fork 并重建 Desktop 安装包，长期维护最重——弃。
- **独立标签面板（不动内置列表）**：最快最稳，但不是"分组选项里多一项"，需求贴合度不足——弃。
- **shadow 整区重写（选定）**：需求贴合，升级风险收敛在插件内部。

## Consequences

- DSH 版本升级后，shadow 区的 UI 与行为需人工回归；内置新增功能不会自动出现。
- 标签数据存 Host 侧 storage domain（全局 JSON），与 shadow UI 解耦；UI 损坏不丢数据。
