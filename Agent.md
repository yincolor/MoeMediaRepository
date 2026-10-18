# AGENTS.md

> AI 代理的操作手册。

## 1. 项目概述

基于 Electron 的 PC 桌面在线影视剧播放器。

- **项目名称**：MoeMediaRepository
- **项目中文名称**：萌萌影视仓库
- **语言**：Javascript CSS HTML
- **框架**：Electron 42.11.3
- **构建**：electron-builder
- **风格约束**：优先使用 ECMAScript 2026 规范API


## 2. 图片资源

- 目录：`.agent_tmp/img/`
- `icon.svg`: 应用图标
- `default.svg`: 默认/占位图标；找不到合适图标时使用它
- `default_media.svg`: 默认影视剧海报图片；还没有正常请求到海报时将它设置为海报
- 使用时**复制到项目 `resources/icons/` 下**，不要直接引用 `.agent_tmp` 路径（避免打包遗漏）
- .agent_tmp/ 属代理临时区，禁止修改、禁止提交到 git。

## 3. 禁止事项
- 禁止使用typescript,vue,react,webpack等涉及前端打包的工具
- 禁止修改 .agent_tmp/ 下任何文件
- 禁止将 .agent_tmp/ 提交到 git
- 禁止再次联网拉取文件
- 禁止硬编码颜色/字号，禁止页面创建单独CSS，统一使用 Theme.css 规范组件和页面布局的样式
