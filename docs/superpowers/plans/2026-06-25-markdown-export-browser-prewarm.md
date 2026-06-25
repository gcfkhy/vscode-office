# Markdown 导出引擎预热(系统浏览器仅作自动兜底) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **修订(2026-06-25,执行后)**:原计划含一个 `vscode-office.exportUseSystemBrowser` 用户开关,
> 评审后**砍掉**(系统浏览器只能在彻底关闭时可靠,不宜做成用户主动选项 —— 详见 spec 顶部修订)。
> 最终实现:**无任何用户设置**;系统浏览器仅自动兜底;预热**始终运行**。因此下文 Task 1/2 中
> 一切 `useSystemBrowser` 相关的选项、短路分支与测试用例(⑥⑦)**均不在最终代码**,
> `prewarmBrowser` 也**没有**「开关跳过」检查。`noSystemFallback` / `prefetchExportBrowser` /
> 并发去重 / 状态栏预热 / 版本 1.0.9 等其余部分不变。

**Goal:** 启动后后台预下载 `chrome-headless-shell` 消除首次导出等待;系统浏览器仅作自动兜底。

**Architecture:** `browserFinder.js`(宿主侧纯逻辑,可 node 单测)作为「解析大脑」:三级解析 + 新增系统浏览器短路 + 预热入口 + 并发去重。`markdownService.ts` 注入开关、新增 `prewarmBrowser()`(状态栏 UI)。`extension.ts` 激活时 fire-and-forget 触发预热。

**Tech Stack:** TypeScript(扩展宿主,esbuild 打包)、`@puppeteer/browsers`(下载 chrome-headless-shell)、puppeteer-core、VS Code API、node 断言脚本测试。

## Global Constraints

- 提交信息:英文,≤ 70 字符(见 `.cursorrules`)。
- 包管理器优先 `yarn`。
- 文案沿用硬编码中文,不接 i18n。
- `chrome-headless-shell` 版本必须与 `puppeteer-core` 的 `PUPPETEER_REVISIONS` 一致,当前常量 `CHROME_HEADLESS_SHELL_BUILD = "149.0.7827.22"`,本计划不改它。
- 无自动化测试运行器:纯函数用 `node test/<name>.js` 跑断言。
- 本机 Node 18 + Vite 20 跑不了完整 `npm run build`/`vite`;只能靠 node 测试 + F5 开发宿主手动验证。
- `@puppeteer/browsers` 已加入 `package.json` 依赖与 `build.ts` 的 external 预打包清单,本计划不再改 `build.ts`。

---

### Task 1: browserFinder 解析逻辑(系统浏览器短路 + 预热入口 + 并发去重)

**Files:**
- Modify: `src/service/markdown/browserFinder.js`(整体重构)
- Test: `test/browser_finder_test.js`(新增 5 条断言)

**Interfaces:**
- Consumes: `@puppeteer/browsers`(`detectBrowserPlatform` / `Browser.CHROMEHEADLESSSHELL` / `computeExecutablePath` / `install`),测试中由 `_browsers` 注入。
- Produces:
  - `resolveExportBrowser(options): Promise<string|undefined>` —— 新增 `options.useSystemBrowser?: boolean`、`options.noSystemFallback?: boolean`。
  - `prefetchExportBrowser(options): Promise<string|undefined>` —— 预热入口,等价 `resolveExportBrowser({...options, noSystemFallback:true})`。
  - `CHROME_HEADLESS_SHELL_BUILD: string`(不变)。

- [ ] **Step 1: 写失败测试** —— 在 `test/browser_finder_test.js` 中:① 把第 4 行 require 改为同时导入 `prefetchExportBrowser`;② 在 `console.log("browser_finder_test: all assertions passed")` 这一行之前插入下面 5 个断言块。

把第 4 行:
```js
const { resolveExportBrowser, CHROME_HEADLESS_SHELL_BUILD } = require("../src/service/markdown/browserFinder")
```
改成:
```js
const { resolveExportBrowser, prefetchExportBrowser, CHROME_HEADLESS_SHELL_BUILD } = require("../src/service/markdown/browserFinder")
```

在 `console.log(...)` 前插入:
```js
  // ⑥ useSystemBrowser:跳过下载,直接系统兜底(即使 shell 未缓存)
  {
    const browsers = fakeBrowsers()
    const out = await resolveExportBrowser({
      cacheDir: "/cache", useSystemBrowser: true, systemFallback: () => "SYSTEM",
      _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, "SYSTEM", "useSystemBrowser should skip download → system")
    assert.strictEqual(browsers.calls.install, 0, "useSystemBrowser → no install")
  }

  // ⑦ useSystemBrowser 为真,但 configuredPath 存在 → ① 仍优先
  {
    const browsers = fakeBrowsers()
    const out = await resolveExportBrowser({
      cacheDir: "/cache", useSystemBrowser: true, configuredPath: "/my/chrome.exe",
      systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs(["/my/chrome.exe"]),
    })
    assert.strictEqual(out, "/my/chrome.exe", "configured path wins over useSystemBrowser")
  }

  // ⑧ prefetch:平台不支持 → undefined(不回退系统)
  {
    const browsers = fakeBrowsers({ platform: null })
    const out = await prefetchExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, undefined, "prefetch unsupported platform → undefined")
  }

  // ⑨ prefetch:下载失败 → undefined(不回退系统)
  {
    const browsers = fakeBrowsers({ installThrows: true })
    const out = await prefetchExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, undefined, "prefetch download failure → undefined")
  }

  // ⑩ prefetch:已缓存 → 返回 shell
  {
    const browsers = fakeBrowsers()
    const out = await prefetchExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([SHELL_EXE]),
    })
    assert.strictEqual(out, SHELL_EXE, "prefetch cached → shell")
  }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/browser_finder_test.js`
Expected: 抛错 —— `prefetchExportBrowser is not a function`(或 ⑥ 处 `useSystemBrowser` 被忽略导致断言失败)。

- [ ] **Step 3: 重构 browserFinder.js** —— 用下面的完整内容覆盖 `src/service/markdown/browserFinder.js`(顶部 1–32 行的文件注释与常量保持原样,这里只给从 `let inflightDownload` 起到文件尾的实现体;若整体替换,把原 `async function resolveExportBrowser(...)` 到 `module.exports` 全部替换为下面这段):

```js
// 并发去重:预热(启动)与导出可能同时触发下载。仅在真实路径(未注入 fake 依赖)生效,
// 注入依赖的单测自动绕过,避免模块级状态污染测试隔离。
let inflightDownload = null

/**
 * 解析"导出用浏览器"。顺序:① configuredPath → (useSystemBrowser 短路) → ② chrome-headless-shell → ③ 系统兜底。
 *
 * @param {Object} options
 * @param {string} options.cacheDir
 * @param {string} [options.configuredPath]
 * @param {boolean} [options.useSystemBrowser] 跳过下载,直接用系统浏览器
 * @param {boolean} [options.noSystemFallback] 解析不到 shell 时返回 undefined 而非系统浏览器(预热用)
 * @param {Function} options.systemFallback () => string
 * @param {Function} [options.withProgress] (task) => Promise
 * @param {Function} [options.onError] (err) => void
 * @param {Object}   [options._browsers] 仅测试注入
 * @param {Object}   [options._fs] 仅测试注入
 * @returns {Promise<string|undefined>}
 */
async function resolveExportBrowser(options) {
  const { configuredPath, useSystemBrowser, noSystemFallback, systemFallback, onError } = options
  const fsm = options._fs || fs

  // ① 用户显式配置优先
  if (configuredPath && fsm.existsSync(configuredPath)) {
    return configuredPath
  }

  // 逃生口:用户选择系统浏览器 → 跳过下载
  if (useSystemBrowser) {
    return noSystemFallback ? undefined : systemFallback()
  }

  // ② 专用 chrome-headless-shell
  try {
    const exe = await locateOrDownloadShell(options)
    if (exe) {
      return exe
    }
  } catch (e) {
    // 离线、代理、磁盘等原因下载失败 → 退回系统浏览器
    if (onError) onError(e)
  }

  // ③ 兜底:系统 Edge/Chrome(预热时返回 undefined)
  return noSystemFallback ? undefined : systemFallback()
}

/**
 * 预热入口:确保 chrome-headless-shell 已下载/缓存,解析不到时返回 undefined(不回退系统浏览器)。
 */
async function prefetchExportBrowser(options) {
  return resolveExportBrowser({ ...options, noSystemFallback: true })
}

/**
 * 仅第 ② 级:定位或下载 chrome-headless-shell。已缓存→返回;未缓存→下载;平台不支持→undefined。
 * 真实路径(未注入依赖)做并发去重,保证同一时刻只下一份。
 */
async function locateOrDownloadShell(options) {
  const { cacheDir, withProgress } = options
  const fsm = options._fs || fs
  const browsers = options._browsers || require("@puppeteer/browsers")

  const platform = browsers.detectBrowserPlatform()
  if (!platform) {
    return undefined
  }
  const browser = browsers.Browser.CHROMEHEADLESSSHELL
  const buildId = CHROME_HEADLESS_SHELL_BUILD
  const exe = browsers.computeExecutablePath({ browser, buildId, cacheDir })
  if (fsm.existsSync(exe)) {
    return exe
  }

  // 未缓存 → 下载(首次,约 80MB,一次性)。真实路径并发去重。
  const injected = !!options._browsers
  if (!injected && inflightDownload) {
    return inflightDownload
  }
  const work = doDownloadShell({ browsers, browser, buildId, cacheDir, withProgress, exe, fsm })
  if (!injected) {
    inflightDownload = work
    const clear = () => { if (inflightDownload === work) inflightDownload = null }
    work.then(clear, clear)
  }
  return work
}

async function doDownloadShell({ browsers, browser, buildId, cacheDir, withProgress, exe, fsm }) {
  fsm.mkdirSync(cacheDir, { recursive: true })
  const doInstall = (report) => browsers.install({
    browser, buildId, cacheDir,
    downloadProgressCallback: (downloaded, total) => {
      if (report && total) report(Math.floor((downloaded / total) * 100) + "%")
    },
  })
  const installed = withProgress ? await withProgress(doInstall) : await doInstall(null)
  const out = (installed && installed.executablePath) || exe
  return fsm.existsSync(out) ? out : undefined
}

module.exports = { resolveExportBrowser, prefetchExportBrowser, CHROME_HEADLESS_SHELL_BUILD }
```

- [ ] **Step 4: 跑测试确认全过**

Run: `node test/browser_finder_test.js`
Expected: `browser_finder_test: all assertions passed`(原 6 条 + 新 5 条全部通过)。

- [ ] **Step 5: 提交**

```bash
git add src/service/markdown/browserFinder.js test/browser_finder_test.js
git commit -m "Add system-browser opt-out and prefetch to export"
```

---

### Task 2: 接线 —— 设置项 + 预热方法 + 激活触发 + 版本

**Files:**
- Modify: `package.json`(新增设置项;`version` 1.0.8 → 1.0.9)
- Modify: `src/service/markdownService.ts`(`resolveBrowser` 传开关;新增 `prewarmBrowser`)
- Modify: `src/extension.ts`(激活时调 `prewarmBrowser`)

**Interfaces:**
- Consumes: `prefetchExportBrowser`(Task 1)、`Global.getConfig<boolean>('exportUseSystemBrowser')`、`vscode.window.createStatusBarItem`。
- Produces: `MarkdownService.prewarmBrowser(): Promise<void>`(供 `extension.ts` 调用)。

- [ ] **Step 1: 加设置项** —— `package.json` 中 `vscode-office.chromiumPath` 块(约 671–674 行)之后插入:

```json
					"vscode-office.exportUseSystemBrowser": {
						"type": "boolean",
						"default": false,
						"description": "Use the system-installed Chrome/Edge for Markdown export instead of downloading a dedicated chrome-headless-shell. Note: the system browser may fail to export while Chrome/Edge is already running."
					},
```

注意:插入处前一行 `chromiumPath` 块结尾的 `}` 后必须有逗号,保证 JSON 合法。

- [ ] **Step 2: 升版本** —— `package.json` 第 5 行:

把
```json
	"version": "1.0.8",
```
改成
```json
	"version": "1.0.9",
```

- [ ] **Step 3: `resolveBrowser` 传入开关** —— `src/service/markdownService.ts` 的 `resolveBrowser()` 里,给 `resolveExportBrowser({...})` 调用新增一行 `useSystemBrowser`。把:

```ts
        return resolveExportBrowser({
            cacheDir,
            configuredPath: Global.getConfig<string>('chromiumPath') || undefined,
            systemFallback: () => this.getChromiumPath(),
```
改成:
```ts
        return resolveExportBrowser({
            cacheDir,
            configuredPath: Global.getConfig<string>('chromiumPath') || undefined,
            useSystemBrowser: Global.getConfig<boolean>('exportUseSystemBrowser'),
            systemFallback: () => this.getChromiumPath(),
```

- [ ] **Step 4: 新增 `prewarmBrowser`** —— 在 `markdownService.ts` 的 `resolveBrowser()` 方法**之后**(其结尾 `}` 的下一行)插入:

```ts

    /**
     * 启动后台预热:确保导出用的 chrome-headless-shell 已下载缓存,使首次导出无需等待。
     * fire-and-forget,失败只记日志。exportUseSystemBrowser 开启时跳过(用户选择系统浏览器,不下载)。
     */
    public async prewarmBrowser(): Promise<void> {
        if (Global.getConfig<boolean>('exportUseSystemBrowser')) {
            return;
        }
        const { prefetchExportBrowser } = require('./markdown/browserFinder');
        const cacheDir = join(this.context.globalStorageUri.fsPath, 'browsers');
        const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        try {
            await prefetchExportBrowser({
                cacheDir,
                configuredPath: Global.getConfig<string>('chromiumPath') || undefined,
                onError: (e: any) => Output.log(e && e.stack ? e.stack : e),
                withProgress: (task: (report: (pct: string) => void) => Promise<any>) => {
                    status.text = '$(sync~spin) 下载 Markdown 导出引擎…';
                    status.show();
                    return task((pct) => { status.text = `$(sync~spin) 下载 Markdown 导出引擎… ${pct}`; });
                },
            });
        } catch (e: any) {
            Output.log(e && e.stack ? e.stack : e);
        } finally {
            status.dispose();
        }
    }
```

- [ ] **Step 5: 激活时触发预热** —— `src/extension.ts` 中,把:

```ts
	const markdownService = new MarkdownService(context);
```
改成(在其后加一行 fire-and-forget 调用):
```ts
	const markdownService = new MarkdownService(context);
	markdownService.prewarmBrowser(); // 后台预取 chrome-headless-shell,失败自吞
```

- [ ] **Step 6: 类型检查(尽力)** —— 验证宿主侧 TS 改动能编译:

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 不引入与本次三个文件相关的新报错(若 `tsc` 报告与本改动无关的既有错误,可忽略;重点确认 `markdownService.ts` / `extension.ts` 无新错)。

- [ ] **Step 7: 手动验证(F5 开发宿主)** —— 按 spec 验证要点逐条过:
  - 冷启动(先删 `globalStorage/.../browsers` 缓存):启动后左下状态栏出现 `$(sync~spin) 下载 Markdown 导出引擎… N%`,完成后消失;随后导出 PDF / 长图**无等待**。
  - 热启动(已缓存):启动无状态栏、无下载;导出正常。
  - 设 `vscode-office.exportUseSystemBrowser: true`:重载后启动**不预热**;关掉 Edge 导出走系统浏览器成功。
  - 抢跑:冷启动预热下载中立即点导出 → 不出现第二个进度条,导出复用同一下载、下完即出结果。

- [ ] **Step 8: 提交**

```bash
git add package.json src/service/markdownService.ts src/extension.ts
git commit -m "Prewarm export engine on startup, add opt-out setting"
```

---

## 备注:与既有未提交改动的关系

仓库当前已有未提交的「换用 chrome-headless-shell」基础改动(`build.ts`、`package.json` 的依赖、`markdownService.ts` 的 `resolveBrowser`、`browserFinder.js`、`browser_finder_test.js`),已实测 F5 导出可用。本计划在其之上叠加。Task 1/2 的 `git add` 只暂存本任务真正改到的文件;`build.ts` 的既有改动与 `package.json` 的依赖行会随 Task 2 的 `package.json` 暂存一并带入(同一文件),属预期。
