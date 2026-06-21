# Markdown 预览大纲导航 — 设计稿

日期：2026-06-21
功能：在只读 Markdown 预览中加入「大纲导航面板」，类似 Word 左侧导航窗格。

## 背景与现状

Markdown 预览由 `src/provider/markdownPreviewProvider.ts` 的 `buildHtml` 在宿主侧用
`markdown-it`（`src/service/markdown/render.js`）渲染为 HTML 片段，直接写入 `webview.html`。
现有 UI（主题切换 🎨 / 导出 📤 / 刷新 🔄 / 缩放 ➕➖）都是 `buildHtml` 注入的**原生 JS 浮动按钮**，
集中在右下角，**不走 React**，样式全部由 `resource/markdown/preview.css` + `themes.css` 的 CSS 变量驱动。

关键既有能力：

- 渲染管线已启用 `markdown-it-anchor`，**每个标题渲染后都自带 `id` 锚点**，可直接用于跳转与滚动高亮。
- 缩放 `zoom` 只作用于 `.md-body`；右下角按钮挂在 `document.body` 上，不受缩放影响。
- 状态持久化已有先例：主题 `markdownPreviewTheme`、缩放 `markdownPreviewZoom`、
  滚动位置 `scrollTop_<fsPath>` 均存于 `context.globalState`，并在 `buildHtml` 中注入初始值。

## 目标

为预览加入大纲导航面板，支持两种呈现方式并可一键切换，状态可记忆。

## 实现路径

**方案 A（采用）：webview 内扫描已渲染 `h1–h6` 构建大纲。**
渲染后读取 `.md-body :is(h1,h2,h3,h4,h5,h6)`，按 `tagName` 取层级、`textContent` 取标题、
`id` 取锚点，构建嵌套树。滚动高亮用 `IntersectionObserver`。**不改动渲染管线**，全部逻辑落在
`buildHtml` 注入脚本里，与现有主题/导出按钮同一套路。

方案 B（不采用）：宿主侧用 `markdown-it-toc-done-right` 生成 TOC HTML 再注入。该插件面向正文
`[[toc]]` 占位符，挪到侧栏需绕其回调 API，且滚动高亮仍须 webview JS，徒增环节。

## 模块设计

### 1. 大纲数据构建（webview JS）

- 扫描 `.md-body` 下的 `h1–h6`，逐个生成节点 `{ level, text, id, el }`。
- 按层级构建嵌套树（处理跳级：以相对层级缩进，不强制连续）。
- 无标题文档：不渲染面板、隐藏左缘把手与右下角 📑（或置灰）。
- 大纲在每次 `buildHtml`（首渲染 / 刷新 / 外部变更重载）后重建。

### 2. 面板呈现与两种模式

- **浮层模式**：`position:fixed; left:0; top:0; bottom:0`，半透明 + `backdrop-filter:blur`
  （复用 `--md-ui-bg` / `--md-ui-border`），带阴影，悬浮在正文之上，正文不变窄。
- **推送模式**：同为 `fixed` 面板，但给 `<body>` 设 `padding-left = 面板宽`，将正文整体右推
  （正文变窄、不被遮挡）。
- **缩放对齐要点**：`zoom` 仅作用于 `.md-body`；推送偏移加在**未缩放的 `<body>`** 上，
  故面板与正文边界在任意缩放倍数下都对齐，不会错位。
- 两种模式切换 = 切换 `<html>` 上的 class（如 `data-outline-mode="push|overlay"`），带 CSS 过渡动画。

### 3. 入口与交互

- 左缘常驻**竖条把手**（`fixed; left:0`），点击滑出/收起面板；无标题时隐藏。
- 右下角按钮组末尾加 **📑** 图标，与 🎨📤🔄➕➖ 风格一致，同样开关面板。
- 面板头部：模式切换钮（推送 ⇄ 浮层）+ 关闭钮。
- 大纲项点击 → `scrollIntoView({behavior:'smooth'})` 平滑滚动到对应标题。
- **滚动高亮**：`IntersectionObserver` 跟踪当前可视标题，高亮对应大纲项（`--md-link`），
  并自动把面板滚动到该项可见。
- 含子项的节点带 ▾/▸ **折叠**钮，默认全展开；折叠状态不持久化。
- 面板**右边缘可拖拽**调宽。

### 4. 状态持久化（globalState）

新增宿主侧 handler，与现有 `setZoom` / `setTheme` 同机制：

- `setOutlineOpen` → `markdownOutlineOpen`（bool）
- `setOutlineMode` → `markdownOutlineMode`（`'push' | 'overlay'`）
- `setOutlineWidth` → `markdownOutlineWidth`（number）

初始值在 `buildHtml` 中像 `savedZoom` / `themeId` 一样注入进 HTML。折叠状态不持久化。

### 5. 改动文件

- `src/provider/markdownPreviewProvider.ts`：`buildHtml` 注入面板 HTML/JS 与初始状态；
  新增 3 个 handler（`setOutlineOpen` / `setOutlineMode` / `setOutlineWidth`）。
- `resource/markdown/preview.css`：面板、把手、把手动画、滚动高亮、拖拽条样式（全走 CSS 变量，
  自动适配 18 套主题）。
- 导出路径（`previewExport.js` / puppeteer）是另一条渲染链，不含注入脚本，
  **大纲不会进导出文件**，无需改动。

## 默认值（已确认）

| # | 项 | 默认 |
|---|---|---|
| 1 | 标题层级 | 全部 h1–h6，按层级缩进 |
| 2 | 首次打开时面板状态 | 关闭（把手可见引导），之后记住上次 |
| 3 | 默认模式 | 推送 |
| 4 | 大纲项编号 | 不自动编号，只显示标题原文 |
| 5 | 默认面板宽度 / 拖拽范围 | 260px / 180–480px |
| 6 | 文案语言 | 中文（与现有预览 UI 硬编码中文一致，不加 i18n） |

## 边界与非目标

- 不改动 `render.js` 渲染管线。
- 不为导出（PDF/HTML/PNG）加入大纲。
- 不引入 React 或新打包产物；沿用注入式原生 JS。
- 不持久化每个分支的折叠状态。

## 验证要点

- 多级标题（含跳级、重复标题文字）大纲层级与跳转正确。
- 推送/浮层切换、缩放（0.5–3×）下面板与正文边界对齐。
- 滚动时高亮跟随、面板自动滚动到当前项。
- 18 套主题下面板配色随主题自适应。
- 无标题文档不显示面板/把手。
- 开关状态、模式、宽度跨重开记忆生效。
