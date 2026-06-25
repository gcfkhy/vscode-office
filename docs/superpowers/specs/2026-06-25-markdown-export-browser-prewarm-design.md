# Markdown 导出引擎预热 + 「使用系统浏览器」开关 — 设计稿

日期：2026-06-25
功能：启动后在后台预下载导出用的 `chrome-headless-shell`，消除首次导出的等待；并新增
`vscode-office.exportUseSystemBrowser` 开关，让用户退回系统浏览器、跳过下载。

## 背景与现状

Markdown 导出（PDF / 长图 PNG / DOCX）由 puppeteer 拉起一个 Chromium 内核渲染。早期实现
借用**系统的 Edge/Chrome**（`MarkdownService.getChromiumPath()` 命中 `msedge.exe`）。

在 Windows 上，当用户日常的 Edge/Chrome 已在运行时，puppeteer 新 `spawn` 的 `msedge.exe`
会被 Chromium 的**进程单例（process singleton）**机制交接给已运行的实例、自身以退出码 0 立即
退出，导致 puppeteer 还没连上 DevTools 端口就失败。表现为两种报错：

- `Failed to launch the browser process: Code: 0`（puppeteer 抛：进程秒退、连不上）。
- `The browser is already running for <userDataDir>. Use a different --user-data-dir or
  stop the running browser first`（puppeteer/`@puppeteer/browsers` 抛：目标 profile 被锁）。

**已落地的修复**（本设计的前置工作，已实测通过 F5）：改用专用无头二进制
`chrome-headless-shell`——它不是 `msedge.exe`，不与日常浏览器共享单例锁，故「Edge 开着也能导出」。
解析逻辑落在 `src/service/markdown/browserFinder.js` 的 `resolveExportBrowser()`，三级顺序：

1. 用户显式配置的 `vscode-office.chromiumPath`（存在才用）；
2. 缓存的 / 现下载的 `chrome-headless-shell`（缓存在 `globalStorage/browsers`）；
3. 系统 Edge/Chrome 兜底（离线 / 下载失败 / 平台不支持时）。

**遗留痛点**：第 ② 级首次使用要下载约 80MB，当前是**懒加载**——第一次导出时才下，用户得对着
进度条干等。本设计解决这个等待，并给不想要该下载的用户一个逃生口。

相关事实：扩展 `activationEvents` 为 `onStartupFinished`，`activate()` 在
`src/extension.ts` 里构造 `new MarkdownService(context)`；导出走两条入口
（`exportMarkdown` PDF/DOCX、`exportPreview` 长图），各自 `new MarkdownService(...)`，
故任何跨实例共享的状态必须是**模块级 / 静态**的。

## 目标

1. VS Code 启动后，在**后台静默**预下载 `chrome-headless-shell`（已缓存则瞬时跳过、不联网），
   使绝大多数情况下首次导出无需等待。
2. 新增 `vscode-office.exportUseSystemBrowser` 开关：开启后跳过下载、直接用系统浏览器，
   且不预热——给离线 / 不愿下载 80MB 的用户一个明确选择。

## 决策（已确认）

| # | 项 | 选择 |
|---|---|---|
| 1 | 预下载触发时机 | **VS Code 启动后**（`onStartupFinished`，即 `activate()`），后台非阻塞 |
| 2 | 预下载可见性 | **状态栏指示器**（`$(sync~spin) 下载 Markdown 导出引擎… 42%`），完成/失败即消失；错误只入 Output |
| 3 | `exportUseSystemBrowser` 默认 | `false`（默认用 `chrome-headless-shell`） |
| 4 | 文案语言 | 中文（与现有导出进度文案「首次导出：正在下载渲染引擎…」一致，不加 i18n） |
| 5 | 版本 | `package.json` bump 到 `1.0.9` |

## 模块设计

### 1. 新增设置 `vscode-office.exportUseSystemBrowser`

`package.json` 的 `contributes.configuration` 中、`chromiumPath` 旁边新增：

- `type: "boolean"`，`default: false`。
- 描述说明：开启后用系统 Chrome/Edge 导出而非下载专用无头引擎；并提示系统浏览器在
  Chrome/Edge 已运行时可能导出失败。

### 2. `browserFinder.js`：解析顺序微调 + 预热入口 + 并发去重

**解析顺序新增一处短路**（`resolveExportBrowser`）：

1. ① `configuredPath` 存在 → 返回（**不变，永远最优先**）。
2. **新增**：若 `useSystemBrowser` 为真 → 直接走系统兜底（或 `noSystemFallback` 时返回
   `undefined`），跳过下载。
3. ② `chrome-headless-shell`（缓存 / 下载）。
4. ③ 系统浏览器兜底（或 `noSystemFallback` 时 `undefined`）。

**新增选项**：

- `useSystemBrowser?: boolean`——导出时由 `exportUseSystemBrowser` 设置驱动。
- `noSystemFallback?: boolean`——预热专用：解析不到 shell 时返回 `undefined` 而非系统浏览器
  （预热只负责「把缓存焐热」，不该 resolve 到任何东西）。

**新增导出函数 `prefetchExportBrowser(options)`**：预热入口，等价于
`resolveExportBrowser({ ...options, noSystemFallback: true })`，复用同一套 tiering 与下载逻辑。

**并发去重（in-flight）**：预热（启动）与「用户在下载完成前就点导出」可能并发触发下载。用一个
**模块级 in-flight Promise** 去重，保证同一时刻只下一份；先发起者的进度 UI 生效（通常是预热的
状态栏），后到者**复用同一下载**、下完即用。

- 去重**仅在真实路径生效**：以 `!options._browsers`（未注入 fake 依赖）为判定，注入依赖的单测
  自动绕过去重 → 保持现有测试隔离不被模块级状态污染。
- in-flight 在下载 settle 后清空：成功则后续调用走 `existsSync` 命中、瞬时返回；失败则后续导出
  可再试。

### 3. `markdownService.ts`：传入开关 + 预热方法

- `resolveBrowser()` 解析时多传 `useSystemBrowser: Global.getConfig<boolean>('exportUseSystemBrowser')`。
- 新增 `public async prewarmBrowser()`：
  - 若 `exportUseSystemBrowser` 为真 → 直接返回（不下载）。
  - 否则调 `prefetchExportBrowser`，`withProgress` 用**状态栏**实现：
    `vscode.window.createStatusBarItem` 显示 `$(sync~spin) 下载 Markdown 导出引擎… <pct>`，
    `finally` 中 `dispose()`。
  - 整体 try/catch：失败只 `Output.log`，不弹窗、不抛出（fire-and-forget 安全）。

### 4. `extension.ts`：激活时触发预热

在 `const markdownService = new MarkdownService(context)` 之后加一行 **不 await** 的调用：

```ts
markdownService.prewarmBrowser(); // 后台预取 chrome-headless-shell，失败自吞
```

不阻塞 `activate()`；`prewarmBrowser` 内部已处理「开关跳过 / 状态栏 / 错误日志」。

### 5. 测试（`test/browser_finder_test.js`）

在现有 6 条断言基础上新增（仍用注入 fake 依赖、无网络）：

- `useSystemBrowser: true` 且 shell 未缓存 → 返回系统兜底、`install` 调用 0 次。
- `useSystemBrowser: true` 且 `configuredPath` 存在 → 仍返回 `configuredPath`（① 优先于开关）。
- `prefetchExportBrowser`（即 `noSystemFallback`）：平台不支持 → 返回 `undefined`（非 "SYSTEM"）。
- `prefetchExportBrowser`：下载失败 → 返回 `undefined`（非系统兜底）。
- `prefetchExportBrowser`：已缓存 → 返回 shell 路径。

并发去重路径在注入依赖下被绕过，不做单测，靠代码评审目检（逻辑约 5 行）。

## 边界与非目标

- 不改 `getChromiumPath()` 的系统浏览器探测清单与 puppeteer 启动参数。
- 不接 i18n；文案沿用现有硬编码中文。
- 不为导出加任何新的 UI（除状态栏预热指示器外）。
- 不持久化下载状态以外的新 globalState。
- `build.ts` 已将 `@puppeteer/browsers` 列入 external 预打包，无需再改。

## 验证要点

- `node test/browser_finder_test.js` 全部断言通过（含新增用例）。
- 冷启动（缓存为空）：启动后状态栏出现下载指示并走进度，完成后消失；随后导出 PDF/长图无等待。
- 热启动（已缓存）：启动无下载、无状态栏；导出正常。
- `exportUseSystemBrowser: true`：启动不预热；导出走系统浏览器（Edge 关闭时成功）。
- 启动离线：状态栏短暂出现后消失，Output 有错误；联网后首次导出能再次触发下载或落系统兜底。
- 抢跑：启动预热进行中立即触发导出 → 不出现第二个下载 / 第二个进度条，导出复用同一下载。
