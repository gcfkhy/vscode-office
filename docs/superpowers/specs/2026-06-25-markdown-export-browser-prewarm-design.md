# Markdown 导出引擎预热(系统浏览器仅作自动兜底) — 设计稿

日期：2026-06-25
功能：启动后在后台预下载导出用的 `chrome-headless-shell`，消除首次导出的等待。系统浏览器
**只作为自动兜底**保留,**不暴露为用户开关**。

> **修订(2026-06-25)**:初版曾设计一个 `vscode-office.exportUseSystemBrowser` 用户开关(逃生口)。
> 评审后**砍掉**:系统浏览器这条路只有在浏览器(含后台残留进程)**彻底关闭**时才可靠——把它做成
> 用户可主动勾选的设置,等于引导用户去选一条已知会失败的路径,体验比不给更糟。结论:系统浏览器
> **仅作自动兜底**(平台不支持 / 下载失败时),用户碰不到开关;预热**始终运行**。

## 背景与现状

Markdown 导出(PDF / 长图 PNG / DOCX)由 puppeteer 拉起一个 Chromium 内核渲染。早期实现
借用**系统的 Edge/Chrome**(`MarkdownService.getChromiumPath()` 命中 `msedge.exe`)。

在 Windows 上,当用户日常的 Edge/Chrome 已在运行时,puppeteer 新 `spawn` 的 `msedge.exe`
会被 Chromium 的**进程单例(process singleton)**机制交接给已运行的实例、自身以退出码 0 立即
退出,导致 puppeteer 还没连上 DevTools 端口就失败。表现为两种报错:

- `Failed to launch the browser process: Code: 0`(puppeteer 抛:进程秒退、连不上)。
- `The browser is already running for <userDataDir>. Use a different --user-data-dir or
  stop the running browser first`(puppeteer/`@puppeteer/browsers` 抛:目标 profile 被锁)。

**已落地的修复**(本设计的前置工作,已实测通过 F5):改用专用无头二进制
`chrome-headless-shell`——它不是 `msedge.exe`,不与日常浏览器共享单例锁,故「Edge 开着也能导出」。
解析逻辑落在 `src/service/markdown/browserFinder.js` 的 `resolveExportBrowser()`,三级顺序:

1. 用户显式配置的 `vscode-office.chromiumPath`(存在才用);
2. 缓存的 / 现下载的 `chrome-headless-shell`(缓存在 `globalStorage/browsers`);
3. 系统 Edge/Chrome **自动兜底**(仅平台不支持 / 下载失败 / 下载产物缺失时)。

**遗留痛点**:第 ② 级首次使用要下载约 80MB,当前是**懒加载**——第一次导出时才下,用户得对着
进度条干等。本设计在启动后**后台预热**消除这个等待。

**兜底路径的固有限制(为什么它只能是"最后退路")**:第 ③ 级走系统浏览器时,沿用老路径,
受制于进程单例——**那个浏览器(含 Edge「启动加速」/「后台扩展」等残留进程)必须彻底关闭**才可靠;
机器上还得**装有 Chromium 系浏览器**(否则 `getChromiumPath()` 抛 `Not chromium found`)。
正因如此,系统浏览器不做成用户可选项,只在 shell 实在拿不到时自动兜底。

相关事实:扩展 `activationEvents` 为 `onStartupFinished`,`activate()` 在
`src/extension.ts` 里构造 `new MarkdownService(context)`;导出走两条入口
(`exportMarkdown` PDF/DOCX、`exportPreview` 长图),各自 `new MarkdownService(...)`,
故任何跨实例共享的状态必须是**模块级 / 静态**的。

## 目标

1. VS Code 启动后,在**后台静默**预下载 `chrome-headless-shell`(已缓存则瞬时跳过、不联网),
   使绝大多数情况下首次导出无需等待。预热**始终运行**(无开关)。
2. 系统浏览器**仅作自动兜底**(第 ③ 级),不暴露任何用户设置。

## 决策(已确认)

| # | 项 | 选择 |
|---|---|---|
| 1 | 预下载触发时机 | **VS Code 启动后**(`onStartupFinished`,即 `activate()`),后台非阻塞 |
| 2 | 预下载可见性 | **状态栏指示器**(`$(sync~spin) 下载 Markdown 导出引擎… 42%`),完成/失败即消失;错误只入 Output |
| 3 | 系统浏览器 | **仅自动兜底**,不做用户开关(见顶部修订) |
| 4 | 文案语言 | 中文(与现有导出进度文案「首次导出:正在下载渲染引擎…」一致,不加 i18n) |
| 5 | 版本 | `package.json` bump 到 `1.0.9` |

## 模块设计

### 1. `browserFinder.js`:预热入口 + 并发去重

**不新增任何用户设置。** `resolveExportBrowser` 解析顺序保持 ①→②→③ 不变,仅新增一个
**内部**选项支撑预热:

- `noSystemFallback?: boolean`——预热专用:解析不到 shell 时返回 `undefined` 而非系统浏览器
  (预热只负责「把缓存焐热」,不该 resolve 到任何东西、更不该在启动时静默拉起系统浏览器)。

**新增导出函数 `prefetchExportBrowser(options)`**:预热入口,等价于
`resolveExportBrowser({ ...options, noSystemFallback: true })`,复用同一套 tiering 与下载逻辑。

**并发去重(in-flight)**:预热(启动)与「用户在下载完成前就点导出」可能并发触发下载。用一个
**模块级 in-flight Promise** 去重(在 `locateOrDownloadShell` 内),保证同一时刻只下一份;先发起者
的进度 UI 生效(通常是预热的状态栏),后到者**复用同一下载**、下完即用。

- 去重**仅在真实路径生效**:以 `!options._browsers`(未注入 fake 依赖)为判定,注入依赖的单测
  自动绕过 → 保持现有测试隔离不被模块级状态污染。
- in-flight 在下载 settle 后清空:成功则后续调用走 `existsSync` 命中、瞬时返回;失败则后续导出
  可再试。

### 2. `markdownService.ts`:预热方法

- `resolveBrowser()`(导出路径)保持不变:`configuredPath`(①)+ `systemFallback`(③)+ 下载(②)。
- 新增 `public async prewarmBrowser()`:
  - **始终执行**(无开关跳过)。调 `prefetchExportBrowser`,`withProgress` 用**状态栏**实现:
    `vscode.window.createStatusBarItem` 显示 `$(sync~spin) 下载 Markdown 导出引擎… <pct>`,
    `finally` 中 `dispose()`。
  - 仍传 `configuredPath`:用户若已配置可用的 `chromiumPath`,预热直接命中 ①、不触发下载。
  - 整体 try/catch:失败只 `Output.log`,不弹窗、不抛出(fire-and-forget 安全;导出时会再试)。

### 3. `extension.ts`:激活时触发预热

在 `const markdownService = new MarkdownService(context)` 之后加一行 **不 await** 的调用:

```ts
markdownService.prewarmBrowser(); // 后台预取 chrome-headless-shell,失败自吞
```

不阻塞 `activate()`;`prewarmBrowser` 内部已处理「状态栏 / 错误日志」。

### 4. 测试(`test/browser_finder_test.js`)

在原有 6 条断言基础上新增(仍用注入 fake 依赖、无网络):

- `prefetchExportBrowser`(即 `noSystemFallback`):平台不支持 → 返回 `undefined`(非 "SYSTEM")。
- `prefetchExportBrowser`:下载失败 → 返回 `undefined`(非系统兜底)。
- `prefetchExportBrowser`:已缓存 → 返回 shell 路径。

并发去重路径在注入依赖下被绕过,不做单测,靠代码评审目检(逻辑约 5 行)。

## 边界与非目标

- **不新增任何用户设置**;系统浏览器仅自动兜底。
- 不改 `getChromiumPath()` 的系统浏览器探测清单与 puppeteer 启动参数。
- 不接 i18n;文案沿用现有硬编码中文。
- 不为导出加任何新的 UI(除状态栏预热指示器外)。
- `build.ts` 已将 `@puppeteer/browsers` 列入 external 预打包,无需再改。

## 验证要点

- `node test/browser_finder_test.js` 全部断言通过(含新增 prefetch 用例)。
- 冷启动(缓存为空):启动后状态栏出现下载指示并走进度,完成后消失;随后导出 PDF/长图无等待。
- 热启动(已缓存):启动无下载、无状态栏;导出正常。
- 启动离线:状态栏短暂出现后消失,Output 有错误;联网后首次导出能再次触发下载,仍不行才落
  系统浏览器兜底(此时需用户关闭 Edge 才可靠)。
- 抢跑:启动预热进行中立即触发导出 → 不出现第二个下载 / 第二个进度条,导出复用同一下载。
