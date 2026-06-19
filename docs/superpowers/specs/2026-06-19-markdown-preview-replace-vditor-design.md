# 用 markdown-it 渲染 + Catppuccin 皮肤的只读 Markdown 预览替换 Vditor

- 日期：2026-06-19
- 状态：待用户复审
- 范围：vscode-office(Office Viewer)扩展的 Markdown 能力

## 1. 目标与背景

当前 `.md`/`.markdown` 由基于 **Vditor** 的所见即所得编辑器(`src/provider/markdownEditorProvider.ts`,加载 `resource/vditor/index.html`)打开。Vditor 上游已不再积极维护,体验欠佳。

本设计将其替换为一个**轻量、只读的 Markdown 预览**:打开 `.md` 直接看到渲染结果;编辑改走 VS Code 原生文本编辑器。视觉风格照搬 `SimpleTerminal` 项目 `frontend/src/components/FilePreview.vue` 里的 Catppuccin 暗色皮肤。

### 已确认的决策(来自需求澄清)

| 维度 | 选择 |
| --- | --- |
| 核心行为 | 纯只读预览;编辑走原生编辑器 |
| 渲染引擎 | 复用仓库现有的 markdown-it 管线(代码高亮 / KaTeX / mermaid / TOC) |
| 样式主题 | 照搬 SimpleTerminal 的 Catppuccin Mocha 暗色(固定暗色,不随 VS Code 主题变) |
| 导出 PDF/DOCX/HTML | 保留(命令 / 标题栏触发) |
| `.md` 默认打开 | 新预览(直接替换 Vditor 占据的默认位) |
| 集成方式 | 宿主侧渲染 HTML + 直接 `webview.html`(与现有 PDF/HTML 特例同一套路) |
| Vditor 移除程度 | 彻底移除,先迁移 KaTeX 资源 |

### 非目标(YAGNI)

- 不在预览内做任何编辑 / 所见即所得。
- 不做"源码 + 预览"双栏。
- 不做随 VS Code 明暗主题切换(固定 Catppuccin 暗色)。
- 不重写导出管线;导出逻辑保持不变(仅迁移它依赖的 KaTeX 资源路径)。

## 2. 架构总览

```
.md 打开
  │
  ▼
MarkdownPreviewProvider (CustomReadonlyEditorProvider)   ← 扩展宿主 (Node)
  │  读取文件文本
  ▼
renderMarkdownToHtml(text, filePath)                      ← 复用现有 markdown-it 管线
  │  返回 HTML 片段(代码高亮 / KaTeX / TOC / mermaid 占位 div)
  ▼
buildPreviewHtml(片段, webview, folderUri, scrollTop)     ← 组装完整 HTML 文档
  │  Catppuccin 变量 + .md-body 样式 + 暗色 hljs 主题 + KaTeX CSS
  │  + <base href> 指向文件目录的 webview URI
  │  + 极小内联脚本(链接拦截 / 滚动记忆)
  │  + 按需 mermaid 脚本
  ▼
webview.html = 完整文档                                    ← webview (浏览器, 只读)
```

数据是单向的:宿主渲染 → webview 展示。webview 通过 `Handler` 仅回传两类轻量事件:`openLink`、`scroll`。文件变更时宿主重新渲染并重置 `webview.html`。

## 3. 组件设计

### 3.1 渲染器复用：抽出 `renderMarkdownToHtml`

现有 `src/service/markdown/markdown-pdf.js` 的 `convertMarkdownToHtml(filename, type, text, config)` 已经是完整的 markdown-it 管线:

- `markdown-it({ html: true, highlight: hljs })`
- 插件:`markdown-it-checkbox`、`markdown-it-anchor`、`markdown-it-toc-done-right`、本地 `ext/markdown-it-katex`、`markdown-it-plantuml`、本地 `ext/markdown-it-mermaid`

**改动**:把"文本 → HTML 片段"这一段抽成一个可复用的导出函数(放在 `markdown-pdf.js` 或新建 `src/service/markdown/render.ts`):

```
renderMarkdownToHtml(text: string, filePath: string, opts?: { forExport?: boolean }): string
```

- 预览调用时 `forExport=false`:**不重写图片 `src`**(相对路径交给 webview 的 `<base href>` 解析),`type` 视作非 pdf(不自动插入 `[toc]`)。
- 导出继续走原 `convertMarkdownToHtml`(`forExport=true`,保留 `file://` 图片重写、PDF 的 `[toc]` 注入)。

导出与预览共用同一 markdown-it 配置,保证两者渲染一致。

> 注:markdown-it 实例创建成本低,每次渲染新建即可;无需缓存优化。

### 3.2 `MarkdownPreviewProvider`(新增,替代 Vditor provider)

`src/provider/markdownPreviewProvider.ts`,实现 `vscode.CustomReadonlyEditorProvider`:

- `openCustomDocument`:返回 `{ uri, dispose(){} }`(同 `OfficeViewerProvider`)。
- `resolveCustomEditor(document, panel)`:
  1. `webview.options = { enableScripts: true, localResourceRoots: [扩展根, 文件所在目录] }`。
  2. `Handler.bind(panel, uri)`,注册 `openLink`、`scroll`、`developerTool` 事件。
  3. 首次渲染:读文件 → `renderMarkdownToHtml` → `buildPreviewHtml` → `webview.html = ...`。
  4. 文件监听(复用 `Util.listen` / `Handler` 的 `externalUpdate`):内容变化时重渲染并重置 `webview.html`。
  5. 遥测:`TelemetryService.get()?.trackViewOpen('markdown', ...)`(沿用现有埋点)。

注册到两个既有 viewType(`extension.ts` 内):`cweijan.markdownViewer`(默认)、`cweijan.markdownPreview`(Open With 可选)。**`package.json` 的 `customEditors` 选择器和 viewType id 不变**,因此用户的 `workbench.editorAssociations` 与默认关联不受破坏;只是底层 provider 从 TextEditor 换成 Readonly。

### 3.3 `buildPreviewHtml`(HTML 模板组装)

产出一个完整 HTML 文档,包含:

1. `<base href="{folderWebviewUri}/">` —— 让相对路径图片正确解析(参考 `markdownEditorProvider` 现有 `baseUrl` 计算:`webview.asWebviewUri(folder)` 后把 `https://git` 替换为 `https://file`)。
2. `<style>`:
   - Catppuccin Mocha 变量(见 §4)。
   - 照搬 SimpleTerminal `FilePreview.vue` 的 `.md-body` 规则(标题 / 段落 / 列表 / 链接 / 行内代码 / 代码块 / 引用 / 表格 / 图片 / 分隔线)。
   - 暗色 highlight.js 主题(见 §4.2),让 `<pre class="hljs">` 内的 token 着色。
   - KaTeX CSS,通过 webview URI 引 `resource/markdown/katex/katex.min.css`。
3. `<div class="md-body">{渲染片段}</div>`。
4. 极小内联脚本:
   - 拦截 `a[href]` 点击 → `vscode.postMessage({type:'openLink', content:href})`。
   - 监听 `scroll`(节流)→ `postMessage({type:'scroll', content:{scrollTop}})`。
   - 启动时 `window.scrollTo(0, {savedScrollTop})`。
5. 若片段含 `.mermaid` → 追加 mermaid 脚本并 `mermaid.initialize({startOnLoad:true})`(见 §4.3)。

`webview.html` 设置前用 `Util.buildPath` 兜底改写资源路径(与现有用法一致)。

### 3.4 宿主侧事件处理

- `openLink`:外链用 `vscode.env.openExternal`;内部 `https://file...` 资源链接转 `vscode.open`(沿用 `markdownEditorProvider` 现有逻辑)。
- `scroll`:存到 `context.globalState` 的 `scrollTop_<fsPath>`(沿用现有键名,保留滚动记忆)。
- `developerTool`:`workbench.action.toggleDevTools`。

## 4. 样式与资源

### 4.1 Catppuccin Mocha 变量

在预览 HTML 的 `:root` 定义(取自 `SimpleTerminal/frontend/src/style.css`,缺失项按 Catppuccin Mocha 官方值补全):

```
--ctp-base:#1e1e2e; --ctp-mantle:#181825; --ctp-crust:#11111b;
--ctp-surface0:#313244; --ctp-surface1:#45475a;
--ctp-text:#cdd6f4; --ctp-subtext1:#bac2de; --ctp-subtext0:#a6adc8;
--ctp-overlay0:#6c7086; --ctp-blue:#89b4fa; --ctp-lavender:#b4befe;
```

行内代码与错误色沿用 FilePreview 的 `#f38ba8`(Catppuccin red)。

### 4.2 代码高亮主题(与纯 SimpleTerminal 的唯一样式增量)

SimpleTerminal 的 markdown 用 `marked`,代码块不带 `hljs` 类;而本设计复用的 markdown-it **带 highlight.js 着色**(`<pre class="hljs"><code>…<span class="hljs-keyword">…`)。因此需引一个**暗色 hljs 主题**让 token 着色。

- 新增静态文件 `resource/markdown/highlight/catppuccin-mocha.css`(Catppuccin 官方 highlight.js 主题,或退而用 `atom-one-dark`),提交入库,离线可用。
- 仅用于预览;导出(`template/styles/arduino-light.css`)保持不变,避免扩大范围。

### 4.3 KaTeX 资源迁移(解锁 Vditor 删除)

- 将 `vditor/src/js/katex/katex.min.css` 与 `vditor/src/js/katex/fonts/`(整套 woff2/woff/ttf)拷到 **`resource/markdown/katex/`**(`katex.min.css` + `fonts/`)。
- 修改 `markdown-pdf.js` 的 `readStyles()`:`katexPath` 从 `…/resource/vditor/dist/js/katex/katex.min.css` 改为 `path.resolve(__dirname, '..', 'resource', 'markdown', 'katex', 'katex.min.css')`。
- 预览通过 webview URI 引同一份 `resource/markdown/katex/katex.min.css`。
- KaTeX 渲染发生在 markdown-it(宿主)阶段,产物是 HTML+CSS,无需在 webview 跑 JS;只要 CSS 与字体可达即可。

### 4.4 mermaid

- markdown-it-mermaid 产出 `<div class="mermaid">…源码…</div>`,需要 mermaid JS 在 webview 渲染。
- 实现策略(best-effort,与现有导出行为对齐):检测到 `.mermaid` 时注入 mermaid 脚本。
  - 优先离线:构建时把一份 UMD 版 mermaid 拷到 `resource/markdown/`(`build.ts` 增加一条 `copy`),webview URI 引用。
  - 退路:若离线版集成困难,沿用导出现用的 CDN(`cdn.jsdelivr.net/npm/mermaid`)并在文档注明需要网络。
- mermaid 属增强项,缺失不应阻塞核心预览;无 `.mermaid` 的文档完全离线。

### 4.5 图片

- 相对路径图片靠 `<base href>` 解析,渲染器不重写 `src`。
- 绝对本地路径图片受现有设置 `vscode-office.viewAbsoluteLocal` / `workspacePathAsImageBasePath` 影响的部分:本期保持现状语义,不新增能力(YAGNI)。

## 5. 导出与命令

导出(`MarkdownService.exportMarkdown` → `convertMd`)与 Vditor 无关,**保留**。原先导出由 Vditor 工具栏经 `handler.on('export')` 触发;预览是 webview 无文本编辑器右键上下文,改为:

- 新增命令 `office.markdown.export`:对当前预览 / 当前 `.md` 的 uri 弹 QuickPick 选择 `PDF / HTML / DOCX` 后导出。
- 在 `package.json` 给 Markdown 预览的 `editor/title` 加一个导出图标(`when: resourceExtname == .md`)。
- 命令面板也可直接调用。

其余命令处理:

- `office.markdown.switch`:保留,语义变为"预览 ↔ 原生文本编辑器"切换(其 `switchEditor` 已基于 `cweijan.markdownViewer` / `default`,无需大改)。
- `office.markdown.paste`(原生编辑器内 Ctrl+V 增强粘贴图片):与 Vditor 无关,保留。
- 键位:Vditor 内部快捷键(列表上/下移、Ctrl+Alt+E 等)随 Vditor 移除而消失;`office.markdown.switch` 的 `ctrl+alt+e` 键位保留。

## 6. 移除 Vditor(彻底)

迁移 §4.3 KaTeX 后执行:

**删除**
- `vditor/`(子项目源码)。
- `resource/vditor/`(构建产物 / 已入库的编辑器资源)。
- `src/provider/markdownEditorProvider.ts`(被 `markdownPreviewProvider.ts` 取代)。

**修改**
- `package.json` `scripts`:删除 `vditor:build`;`dev` 去掉 `npm run vditor:build &&`;`build` 去掉末尾 `&& npm run vditor:build`。
- `extension.ts`:把两个 markdown viewType 的注册从 `MarkdownEditorProvider` 换成 `MarkdownPreviewProvider`;注册 `office.markdown.export` 命令。
- `package.json` `customEditors`:`cweijan.markdownViewer` 的 `displayName` "Markdown Editor" → "Markdown Preview"(viewType id、selector 不变)。
- `markdown-pdf.js`:KaTeX 路径改向 `resource/markdown/katex`。
- `CLAUDE.md`:更新 Markdown 一节(不再是 Vditor 第三世界;改为只读预览 + 宿主 markdown-it 渲染)。

**配置项(低优先,本期可不动)**
以下设置原本服务 Vditor 编辑器,移除后失效:`editorTheme`、`hideToolbar`、`preventMacOptionKey`、`previewCode`、`previewCodeHighlight.*`、`openOutline`、`editorLanguage`。本期**保留不删**(留着无害,删配置对老用户是破坏性变更),仅在文档标注已废弃;后续可单独清理。导出相关设置(`chromiumPath`、`puppeteerArgs`、`pdfMarginTop`)与图片设置(`viewAbsoluteLocal`、`workspacePathAsImageBasePath`、`pasterImgPath`)保留生效。

## 7. 错误处理与边界

- 文件读取失败 / 渲染抛错:`renderMarkdownToHtml` 用 try/catch 包裹,失败时退化为在 `.md-body` 内以 `<pre>` 展示原始文本 + 顶部错误提示条(Catppuccin red),不让 webview 空白。
- 超大文件:markdown-it 同步渲染;本期不设硬上限,但渲染放在 `resolveCustomEditor` 异步链中,避免阻塞激活。(若实测卡顿,后续再加可配置上限,参考 SimpleTerminal 的 500KB。)
- 离线:无 `.mermaid` 的文档完全离线渲染;KaTeX / hljs / Catppuccin 资源均本地。
- 外链安全:链接不直接在 webview 跳转,统一回传宿主由 `openExternal` 处理。

## 8. 受影响文件清单

**新增**
- `src/provider/markdownPreviewProvider.ts`
- `resource/markdown/katex/`(katex.min.css + fonts,迁移自 vditor)
- `resource/markdown/highlight/catppuccin-mocha.css`
- (可选)`resource/markdown/mermaid.min.js`(或构建期拷贝)

**修改**
- `src/extension.ts`(provider 注册、导出命令)
- `src/service/markdown/markdown-pdf.js`(抽出 `renderMarkdownToHtml`、KaTeX 路径)
- `package.json`(scripts、customEditors displayName、新增 export 命令与菜单)
- `build.ts`(若采用离线 mermaid:新增 copy)
- `CLAUDE.md`(Markdown 一节)

**删除**
- `vditor/`、`resource/vditor/`、`src/provider/markdownEditorProvider.ts`

## 9. 实现阶段划分

1. **渲染抽取**:从 `markdown-pdf.js` 抽出 `renderMarkdownToHtml`,导出回归(确保 PDF/HTML/DOCX 仍正常)。
2. **KaTeX 迁移**:拷资源到 `resource/markdown/katex`,改 `readStyles` 路径,验证数学导出。
3. **预览 provider**:`markdownPreviewProvider.ts` + `buildPreviewHtml` + Catppuccin/hljs 样式;接入 `extension.ts`,验证基本预览、代码高亮、KaTeX、相对图片、链接、滚动记忆。
4. **导出命令**:`office.markdown.export` + 标题栏图标。
5. **mermaid**:离线或 CDN 注入。
6. **移除 Vditor**:删子项目/资源/旧 provider,清理脚本,更新 `CLAUDE.md`。

> 前置:当前 `node_modules` 未安装,实现前需 `yarn install`;每阶段后用扩展开发宿主(F5)手动验证(本仓库无自动化测试)。

## 10. 验证方式(手动)

- 打开含标题/列表/表格/引用/行内与围栏代码的 `.md` → Catppuccin 暗色、代码着色正确。
- 含 `$...$` / `$$...$$` 数学 → KaTeX 正常显示(字体加载)。
- 含相对路径图片 → 正常显示。
- 含 mermaid 围栏 → 图渲染(或按退路说明)。
- 外链点击 → 浏览器打开;切走再切回 → 滚动位置保留。
- 右键/标题栏导出 PDF/HTML/DOCX → 与预览视觉一致、成功产出。
- 原生编辑器编辑保存 → 预览自动刷新。
