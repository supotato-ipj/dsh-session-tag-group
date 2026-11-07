# DSH 会话标签分组（dsh-session-tag-group）

给 DSH 的会话打标签，并在会话浏览区的分组选项中新增「按标签」的浏览器插件项目。

## Language

**会话标签 / Tag**:
用户贴在单个会话上的命名标记；一个会话可同时挂多个。
_Avoid_: 分类、类别、label

**标签池 / Tag Pool**:
所有 workspace 共用的标签全集，随打随建，不预建、不按 workspace 隔离。
_Avoid_: 标签库、预置标签

**标签模式 / Tag Mode**:
会话浏览区的分组模式之一：跨 workspace 按标签聚合显示会话，与默认模式互斥切换。
_Avoid_: 标签视图、标签页

**默认模式 / Default Mode**:
DSH 内置的原有分组/平铺行为，即未启用标签模式时的状态。
_Avoid_: 普通模式、原生模式

**未标签组 / Untagged Group**:
标签模式下排在末尾、收容未挂任何标签会话的分组。
_Avoid_: 其他组、杂项组

**Workspace**:
DSH 中会话的宿主目录实体；标签打在会话上，workspace 本身不带标签。
_Avoid_: 项目（指 workspace 时）、目录

**置顶 / Pin**:
DSH 内置的会话置顶功能；标签模式下所有置顶会话仍聚合在列表最上方。
_Avoid_: 顶置、自研置顶（本项目不新做置顶）
