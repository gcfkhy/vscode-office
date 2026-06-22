# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

`vscode-office`(Marketplace 名称 "Markdown Office Viewer Pro",id `markdown-office-viewer.markdown-office-viewer-pro`)是一个 VS Code 扩展,用自定义编辑器预览/编辑大量文件类型:Excel/Word/PowerPoint、PDF/EPUB、图片(含 HEIC/TIFF/PSD/ICNS/SVG)、字体、压缩包(zip/rar/7z/tar)、Java `.class`(反编译)、Markdown(只读预览,Catppuccin 风格,经 markdown-it 渲染)、HTML 预览、HTTP/REST 客户端、YAML 导航,以及 Git 历史查看器。

本项目 fork 自上游 `cweijan/vscode-office`,差异主要集中在 **Markdown 体验**(上游用 Vditor 所见即所得编辑器,本项目改为 markdown-it 只读预览 + 主题化导出)与整体定位上;其余预览能力基本继承自上游。

## 命令

包管理器:**优先用 yarn**(见 `.cursorrules`)。

- `npm run dev` —— 完整开发循环。同时启动 Vite 开发服务器(webview,端口 **5739**)**和** esbuild 监视模式(扩展宿主)。然后在 VS Code 里按 **F5**("Extension" 启动项,会触发 `dev` 任务)打开扩展开发宿主窗口。
- `npm run build` —— 生产构建:先用跨平台的 Node `fs.rmSync` 清空 `out`,再 `vite build --mode=production`(同时一次性触发扩展的 esbuild)。
- `npm run lint:fix` —— 对 `src/**/*.ts` 跑 ESLint 自动修复。
- `npm run package` —— 产出 `.vsix`(`vsce package --no-dependencies`)。
- `npm run publish` —— 发布到 VS Code Marketplace + Open VSX。

**没有配置自动化测试运行器。** `test/` 目录是独立的 Node 脚本,直接 `node test/<name>.js` 运行单个即可。纯函数有断言测试(如 `node test/find_index_test.js`、`test/outline_tree_test.js`、`test/markdown_render_test.js`、`test/markdown_themes_test.js`),另有性能脚本(如 `test/xlsx_performance_test.js`)。给 `resource/markdown/*.js` 这类带纯函数的资源新增逻辑时,优先按 UMD 方式导出纯函数并补一个对应的 `test/*.js` 断言脚本(参考 `outline.js` + `outline_tree_test.js`)。

提交信息约定(见 `.cursorrules`):**英文,≤ 70 字符**。

## 架构:两套独立打包

理解本仓库最关键的一点:代码分成**两个相互独立打包的世界**,模块系统、构建工具、导入约定都不同。

1. **扩展宿主(Node.js)** —— `src/` 下除 `src/react` 外的全部。由 **esbuild** 经 `build.ts` 打包成 `out/extension.js`(CJS)。入口 `src/extension.ts`。使用 **`@/*` 路径别名 → `src/*`**(由 `tsconfig.json` paths 解析;`tsconfig.json` **排除** `src/react`)。`build.ts` 的 `dependencies[]` 里列出的重型原生/Node 依赖保持 external,并被单独预打包到 `out/node_modules`(让 puppeteer、pdf-lib、7z-wasm 等运行时再加载)。

2. **Webview UI(浏览器,React 19)** —— `src/react`。由 **Vite**(`vite.config.ts`)打包到 `out/webview`。入口 `src/react/main.tsx`。**只用相对导入**(这里没有 `@/` 别名)。用 Ant Design + 按视图懒加载的组件。

`vite.config.ts` 把两者串起来:当带 `--mode` 标志调用时它 `require('./build')`,所以单条 `vite`/`vite build` 命令也会驱动 esbuild 扩展构建(dev 下监视,生产下一次性)。

Vditor 已移除。Markdown 现在复用宿主侧的 markdown-it 流水线(与导出/PDF 服务、预览 provider 共享),不再有第三个打包产物。

## 自定义编辑器如何渲染

针对 `package.json` 里声明的 `customEditors`,有两种 provider 模式:

- `src/provider/officeViewerProvider.ts`(`CustomReadonlyEditorProvider`)处理**所有只读查看器** —— 它给全部 8 个只读 `viewType` 注册自身(见 `bindCustomEditors`)。`resolveCustomEditor` 检查文件后缀,选一个字符串 `route`(如 `excel`、`word`、`ppt`、`zip`、`image`、`svg`、`epub`、`psd`、`xmind`、`font`),接上数据处理器,再调 `ReactApp.view(webview, { route })`。PDF 与 HTML 是特例(直接从 `resource/pdf/viewer.html` / 文件本身设置 `webview.html`,而非走 React 应用)。Java `.class` 也特殊:`handleClass` 调用**外部 `java` 运行时**(须在 `PATH` 上)跑内置 `resource/java-decompiler.jar`(Fernflower),再经 `decompile_java` `TextDocumentContentProvider`(在 `extension.ts` 注册)打开结果 —— 不走 React 应用。

- `src/provider/markdownPreviewProvider.ts`(`CustomReadonlyEditorProvider`)是 **Markdown 预览** provider。它调用共享的宿主侧渲染器 `src/service/markdown/render.js`(markdown-it)渲染出只读 HTML,并**直接设置 `webview.html`** —— 与 PDF/HTML 同样的特例模式。详见下一节。

`src/common/reactApp.ts`(`ReactApp.view`)是通往 React UI 的桥:加载 `out/webview/index.html`(dev 下代理 `http://127.0.0.1:5739`),把 `<base href>` 改写为 webview URI,并注入一段 `{{configs}}` JSON(route、图标/赞助 base URL、语言,以及 `vscode-office` 配置)。`src/react/main.tsx` 读 `configs.route` 切到 `src/react/view/<name>/` 下对应的懒加载视图组件。

## 扩展 ⇄ webview 通信

两侧都用一个小型事件总线抽象:

- 宿主侧:`src/common/handler.ts` —— `Handler.bind(panel, uri)` 把 `webview.postMessage` / `onDidReceiveMessage` 封装为 `.on(event, cb)` / `.emit(event, content)`,并自动接上文件系统监听(`fileChange`、`externalUpdate`、`dispose`)。
- Webview 侧:`src/react/util/vscode.ts` 导出同样 `.on`/`.emit` API 的 `handler`,基于 `window.postMessage` / `acquireVsCodeApi`。

于是一个查看器的实现是:provider 调一个 `handle<Type>(uri, handler)` 函数(见 `src/provider/handlers/` 与 `src/provider/compress/`)响应 `init` 等事件返回文件数据;React 视图挂载时 `emit('init')` 并渲染收到的内容。

## Markdown 预览的 webview 资源(易踩坑)

Markdown 预览**不走 React/Vite**,而是宿主侧直接拼 HTML(`buildHtml`)。其前端资源放在 `resource/markdown/`(`themes.css` 调色板 + `preview.css` + `outline.js` 大纲 + `find.js` 查找 + `katex/` + `mermaid.min.js`),通过 `webview.asWebviewUri(extensionPath/resource/markdown/...)` **从扩展目录直接加载**:

- 它们**既不被 Vite 打包、也不被 build.ts 复制到 `out`**(`build.ts` 的 `copy()` 只处理 `template/`、unrar.wasm、7zz.wasm)。因此改这些文件**无需重新构建扩展宿主**,在开发宿主里重载 webview 即可生效。
- 预览右下角有一组悬浮 UI:🎨 主题切换(18 套调色板,见 `markdownThemes.ts`,存 `globalState`)、📤 主题化导出(PDF/HTML/长图 PNG,经 `previewExport.js` + puppeteer)、🔄 手动刷新、➕/➖ 与 Ctrl-滚轮缩放(持久化);左缘有 📑 大纲面板(`outline.js`);**Ctrl/⌘+F 查找条**(`find.js`)。外部改动时经各自的 `RelativePattern` watcher 自动刷新(共享的 `Handler.fileChange` 用 `fsPath`-glob,对工作区外/Windows 路径不可靠)。
- 每次渲染都整体重设 `webview.html`,因此 webview 内的瞬时状态(查找词、当前匹配等)会随刷新重置 —— 这是只读预览可接受的取舍,未做跨重建持久化(滚动位置/缩放/主题则经 `globalState` 持久化并在 `buildHtml` 注入)。

**关于查找(`enableFindWidget`)的关键事实**:自定义编辑器**可以**经 `registerCustomEditorProvider` 的 `webviewOptions.enableFindWidget` 启用 VS Code 原生查找框(常见误解是不行)。`extension.ts` 里共享的 `viewOption` 把它设为 `true`(office 查看器用),但 Markdown 预览**特意用单独的 `markdownViewOption` 把 `enableFindWidget` 设为 `false`**,这样 Ctrl+F 不会被宿主侧原生查找抢走,而是下发到 iframe 由 `find.js` 处理。原生组件与 `find.js` 只能留一个。`find.js` 的高亮优先用 CSS Custom Highlight API(`engines.vscode` 低至 `^1.64` / Chromium 91,低于该 API 的 105 时降级为浮层方块)。

## 主要功能区(大多自成一体)

- `src/provider/http/` —— HTTP/REST 客户端,改编自 vscode-restclient。经 `activateHttp` 激活;为 `.http`/`.rest` 注册语言能力、code lens 与请求执行。
- `src/gitHistory/` —— Git 历史查看器,完整纵切:`service/`(git 执行器、仓库发现、commit/action 服务)、`provider/`(webview 面板 + 消息路由),React UI 在 `src/react/view/gitHistory/`。经 `activateGitHistory` 激活;找不到 git 时优雅降级。
- `src/provider/yaml/` —— YAML 大纲 + 锚点/别名 跳转定义。经 `activateYaml` 激活。
- `src/service/` —— 宿主侧服务:`markdownService.ts`(导出 Markdown → PDF via puppeteer-core/Chromium、DOCX、HTML)、`telemetryService.ts`(`@vscode/extension-telemetry`,受 `vscode-office.enableTelemetry` + 全局遥测开关控制)、压缩/归档辅助、图标解析。

`src/extension.ts` 的 `activate()` 是接线总图:初始化遥测,调用各 `activate*` 功能入口,注册 office 查看器 + Markdown 预览 provider 以及 `office.*` 命令。

## 设置与 i18n

用户设置都在 `vscode-office.*` 命名空间下(定义于 `package.json` 的 `contributes.configuration`);经 `Global.getConfig` / `vscode.workspace.getConfiguration('vscode-office')` 读取。Markdown 预览与若干查看器已本地化;`vscode-office.editorLanguage` 与 `vscode.env.language` 决定语言环境。
