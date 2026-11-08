# 会话标签（DSH Session Tags）

给 DeepSeek Harness 的会话打标签，并在侧边栏「分组方式」里新增「按标签」视图——跨 workspace 把同一项目/主题的会话聚合到一起。

> 插件包名：`@local/dsh-session-tags` · 显示名：会话标签 · 平台：Web（Desktop 内置）· 需要 DSH `>=0.2.2-rc.1 <0.3.0`

## 功能

- **打标签**：会话右键「编辑标签」→ 从已有标签勾选，或输入新标签名回车即建即挂；取消勾选即移除。
- **全局标签池**：标签不按 workspace 隔离，跨 workspace 复用同一套标签；随打随建，无需预建。
- **按标签分组**：搜索框旁选项菜单「分组方式」新增「按标签」——跨 workspace 聚合，多标签会话出现在每个所属标签组；未标签会话收进末尾「未标签」组；组内/组间按最近活跃排序；置顶会话聚合在列表最上方；行上标注所属 workspace。
- **搜索**：标签模式下搜索框继续在分组结果内过滤。
- **持久化**：标签数据与视图模式存 Host 侧 storage（独立于 UI 存活），重启不丢；归档会话不显示但保留标签关联，删除会话自动清理关联。

## 安装

### 从 GitHub 安装（推荐）

```bash
dsh plugin --profile desktop add github:supotato-ipj/dsh-session-tag-group
```

安装后重启 DeepSeek Harness Desktop（Client 半在页面启动时加载，需要重载窗口；当前版本 Ctrl+R 未绑定，直接退出重开应用即可）。

### 从本地目录安装

```bash
dsh plugin --profile desktop add /path/to/dsh-session-tag-group
```

### 启用 / 禁用 / 卸载

```bash
dsh plugin --profile desktop rm @local/dsh-session-tags   # 卸载
```

禁用插件即完整回退内置浏览区，标签数据保留在 profile storage 中，重新启用后原样接续。

## 兼容性

- 需要 DSH `>=0.2.2-rc.1 <0.3.0`（`engines.dsh` 已声明）。
- 本插件以 shadow 方式接管内置浏览区（`sidebar.workspaces`）整区渲染，**DSH 升级后需要人工回归**（内置编译类名与交互可能漂移）。插件可随时禁用回退。
- 已知限制：本插件接管浏览区期间，其他第三方插件注册在那五个内置子座位上的行内装饰不会显示（slot 所有权限制）；本插件自身功能不受影响。

## 开发

```bash
pnpm install
pnpm test        # 182 个用例（纯逻辑层：标签服务、分组计算、RPC 契约、UI 逻辑）
```

目录：

| 文件 | 说明 |
|---|---|
| `index.js` | Host 半：标签数据服务 + `/session-tags` RPC 路由 |
| `tag-store.js` | 标签数据层（storage domain 全局 JSON、池与关联、清理语义） |
| `tag-rpc.js` | RPC 信封与分派 |
| `client.js` | Client 半：浏览区 shadow 复刻 + 标签 UI（视图/弹层/色点/分组） |
| `test/` | 纯逻辑层单测（vitest） |

架构决策见 [`docs/adr/0001-shadow-workspaces-rewrite.md`](docs/adr/0001-shadow-workspaces-rewrite.md)；术语见 [`GLOSSARY.md`](GLOSSARY.md)。

## License

未声明（如需开源许可，可补 MIT）。
