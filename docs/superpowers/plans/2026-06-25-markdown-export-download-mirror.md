# Markdown 导出引擎下载源自动选择 + 自动回退 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 下载 `chrome-headless-shell` 时按语言环境自动选择下载源(国内 npmmirror 镜像 / Google 官方),任一源失败自动切到另一源重试;全自动、零设置。

**Architecture:** 在 `browserFinder.js` 增加一个纯函数算出下载源的有序列表,`doDownloadShell` 对列表逐个 `install({ baseUrl })`、失败即试下一个;`markdownService.ts` 按 `vscode.env.language` / `editorLanguage` 算出 `preferMirror` 布尔传入。不加任何用户设置,不动 tier ①/③ 解析。

**Tech Stack:** Node.js (CJS) `@puppeteer/browsers`(已支持 `install({ baseUrl })`)、TypeScript 扩展宿主、`node` 跑断言测试(`test/browser_finder_test.js`)。

参考 spec:`docs/superpowers/specs/2026-06-25-markdown-export-download-mirror-design.md`

---

## 文件结构

- **Modify** `src/service/markdown/browserFinder.js` —— 加常量 `NPM_MIRROR_BASE_URL`、纯函数 `resolveDownloadBaseUrls(preferMirror)`;`locateOrDownloadShell`/`doDownloadShell` 接收并使用 `preferMirror`+`onError`,逐源尝试 `install`;扩展 `module.exports`。
- **Modify** `src/service/markdownService.ts` —— 加 `private preferMirror()`;在 `resolveBrowser()` 与 `prewarmBrowser()` 的 options 里传 `preferMirror: this.preferMirror()`。
- **Modify** `test/browser_finder_test.js` —— 新增纯函数顺序用例 + 回退用例;import 增加 `resolveDownloadBaseUrls`、`NPM_MIRROR_BASE_URL`。
- **Modify** `package.json` —— `version` `1.0.9` → `1.0.10`。

测试命令贯穿全程:`node test/browser_finder_test.js`(运行全部断言)。

---

## Task 1: 下载源有序列表(纯函数 + 常量)

**Files:**
- Modify: `src/service/markdown/browserFinder.js`
- Test: `test/browser_finder_test.js`

- [ ] **Step 1: 写失败测试**

在 `test/browser_finder_test.js` 顶部 import 行改为(加 `resolveDownloadBaseUrls`、`NPM_MIRROR_BASE_URL`):

```js
const { resolveExportBrowser, prefetchExportBrowser, resolveDownloadBaseUrls, CHROME_HEADLESS_SHELL_BUILD, NPM_MIRROR_BASE_URL } = require("../src/service/markdown/browserFinder")
```

在 `run()` 函数体内、`console.log("browser_finder_test: all assertions passed")` 之前,插入:

```js
  // ⑨ 纯函数:下载源顺序。preferMirror=true → [镜像, 官方];false → [官方, 镜像]
  {
    assert.deepStrictEqual(
      resolveDownloadBaseUrls(true), [NPM_MIRROR_BASE_URL, undefined],
      "preferMirror=true should try mirror first")
    assert.deepStrictEqual(
      resolveDownloadBaseUrls(false), [undefined, NPM_MIRROR_BASE_URL],
      "preferMirror=false should try official first")
  }
```

- [ ] **Step 2: 运行,确认失败**

Run: `node test/browser_finder_test.js`
Expected: 抛错退出(`TypeError: resolveDownloadBaseUrls is not a function`,因为尚未导出)。

- [ ] **Step 3: 实现常量 + 纯函数 + 导出**

在 `src/service/markdown/browserFinder.js` 中,`CHROME_HEADLESS_SHELL_BUILD` 常量定义之后、`let inflightDownload = null` 之前,加入:

```js
// 国内镜像:npmmirror 的 chrome-for-testing 二进制镜像,路径布局与官方一致。
const NPM_MIRROR_BASE_URL = "https://cdn.npmmirror.com/binaries/chrome-for-testing"

/**
 * 计算下载源的尝试顺序。
 * preferMirror=true(简体中文环境)→ [镜像, 官方];否则 → [官方, 镜像]。
 * 数组元素即传给 install({ baseUrl }):undefined 表示官方默认源,字符串为镜像 baseUrl。
 * @param {boolean} preferMirror
 * @returns {Array<string|undefined>}
 */
function resolveDownloadBaseUrls(preferMirror) {
  return preferMirror ? [NPM_MIRROR_BASE_URL, undefined] : [undefined, NPM_MIRROR_BASE_URL]
}
```

把文件末尾的 `module.exports` 改为:

```js
module.exports = { resolveExportBrowser, prefetchExportBrowser, resolveDownloadBaseUrls, CHROME_HEADLESS_SHELL_BUILD, NPM_MIRROR_BASE_URL }
```

- [ ] **Step 4: 运行,确认通过**

Run: `node test/browser_finder_test.js`
Expected: `browser_finder_test: all assertions passed`(原有 8 条 + 新 ⑨ 全通过)。

- [ ] **Step 5: 提交**

```bash
git add src/service/markdown/browserFinder.js test/browser_finder_test.js
git commit -m "Add ordered download-source resolver for export shell"
```

---

## Task 2: 逐源尝试下载 + 自动回退

**Files:**
- Modify: `src/service/markdown/browserFinder.js`(`locateOrDownloadShell`、`doDownloadShell`)
- Test: `test/browser_finder_test.js`

- [ ] **Step 1: 写失败测试**

在 `test/browser_finder_test.js` 的 `run()` 内、`console.log(...)` 之前,插入回退用例:

```js
  // ⑩ 回退:首源(镜像)失败 → 自动切官方源成功,且按序各试一次
  {
    const present = new Set() // 安装前不存在;成功安装后存在
    const calls = { install: 0, baseUrls: [] }
    const browsers = {
      Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
      detectBrowserPlatform: () => "win64",
      computeExecutablePath: () => SHELL_EXE,
      install: async (opts) => {
        calls.install++
        calls.baseUrls.push(opts.baseUrl)
        if (opts.baseUrl === NPM_MIRROR_BASE_URL) throw new Error("mirror down")
        present.add(SHELL_EXE)
        return { executablePath: SHELL_EXE }
      },
    }
    const fs = { existsSync: (p) => present.has(p), mkdirSync: () => {} }
    const out = await resolveExportBrowser({
      cacheDir: "/cache", preferMirror: true,
      systemFallback: () => "SYSTEM", onError: () => {}, _browsers: browsers, _fs: fs,
    })
    assert.strictEqual(out, SHELL_EXE, "mirror fail should fall back to official and succeed")
    assert.deepStrictEqual(calls.baseUrls, [NPM_MIRROR_BASE_URL, undefined],
      "should try mirror first, then official")
  }
```

- [ ] **Step 2: 运行,确认失败**

Run: `node test/browser_finder_test.js`
Expected: ⑩ 断言失败 —— 当前 `install` 调用未带 `baseUrl`,`opts.baseUrl` 恒为 `undefined`,首次即成功,`calls.baseUrls` 实际为 `[undefined]`,与期望 `[NPM_MIRROR_BASE_URL, undefined]` 不符(`AssertionError`)。

- [ ] **Step 3: 改造 `locateOrDownloadShell` 透传 preferMirror/onError**

在 `src/service/markdown/browserFinder.js` 中,把 `locateOrDownloadShell` 的开头解构与 `doDownloadShell` 调用改为(加 `preferMirror`、`onError`):

```js
async function locateOrDownloadShell(options) {
  const { cacheDir, withProgress, preferMirror, onError } = options
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

  const injected = !!options._browsers
  if (!injected && inflightDownload) {
    return inflightDownload
  }
  const work = doDownloadShell({ browsers, browser, buildId, cacheDir, withProgress, exe, fsm, preferMirror, onError })
  if (!injected) {
    inflightDownload = work
    const clear = () => { if (inflightDownload === work) inflightDownload = null }
    work.then(clear, clear)
  }
  return work
}
```

- [ ] **Step 4: 改造 `doDownloadShell` 逐源尝试**

把整个 `doDownloadShell` 函数替换为:

```js
async function doDownloadShell({ browsers, browser, buildId, cacheDir, withProgress, exe, fsm, preferMirror, onError }) {
  fsm.mkdirSync(cacheDir, { recursive: true })
  const baseUrls = resolveDownloadBaseUrls(preferMirror)
  // 逐源尝试:某源失败 → 记日志 → 试下一个;全失败才抛出(交上层落系统兜底 / 预热返回 undefined)。
  const attempt = async (report) => {
    let lastErr
    for (const baseUrl of baseUrls) {
      try {
        const installed = await browsers.install({
          browser, buildId, cacheDir, baseUrl,
          downloadProgressCallback: (downloaded, total) => {
            if (report && total) report(Math.floor((downloaded / total) * 100) + "%")
          },
        })
        const out = (installed && installed.executablePath) || exe
        if (fsm.existsSync(out)) return out
        lastErr = new Error("download produced no executable")
      } catch (e) {
        lastErr = e
        if (onError) onError(e)
      }
    }
    throw lastErr || new Error("all download sources failed")
  }
  return withProgress ? await withProgress(attempt) : await attempt(null)
}
```

- [ ] **Step 5: 运行,确认全部通过**

Run: `node test/browser_finder_test.js`
Expected: `browser_finder_test: all assertions passed`。重点确认:
- ⑩ 回退用例通过;
- ③ 成功用例仍 `install===1`(默认顺序首源 `undefined` 即成功);
- ④⑦ 失败用例仍分别落 `SYSTEM` / `undefined`(逐源各试一次后抛出,被上层处理)。

- [ ] **Step 6: 提交**

```bash
git add src/service/markdown/browserFinder.js test/browser_finder_test.js
git commit -m "Try each download source with auto-fallback"
```

---

## Task 3: markdownService 注入 locale 信号

**Files:**
- Modify: `src/service/markdownService.ts`(`resolveBrowser`、`prewarmBrowser`,新增 `preferMirror`)

> 该任务依赖 `vscode` 运行时,无独立单测;靠 `node test/browser_finder_test.js` 仍全绿 + TypeScript 编译通过 + F5 手测验证。

- [ ] **Step 1: 新增 `preferMirror()` 方法**

在 `src/service/markdownService.ts` 的 `MarkdownService` 类内,`resolveBrowser()` 方法定义之前,加入:

```ts
    /** 简体中文环境(VS Code 界面语言或编辑器语言为简中)优先走国内镜像下载导出引擎。 */
    private preferMirror(): boolean {
        const lang = (vscode.env.language || "").toLowerCase();
        const editorLang = Global.getConfig<string>("editorLanguage");
        return lang === "zh-cn" || editorLang === "zh_CN";
    }
```

- [ ] **Step 2: 在 `resolveBrowser()` 传入 preferMirror**

在 `resolveBrowser()` 里 `return resolveExportBrowser({ ... })` 的 options 对象中,`cacheDir,` 之后加一行:

```ts
            preferMirror: this.preferMirror(),
```

(即与 `configuredPath`、`systemFallback`、`onError`、`withProgress` 并列。)

- [ ] **Step 3: 在 `prewarmBrowser()` 传入 preferMirror**

在 `prewarmBrowser()` 里 `await prefetchExportBrowser({ ... })` 的 options 对象中,`cacheDir,` 之后加一行:

```ts
                preferMirror: this.preferMirror(),
```

(即与 `configuredPath`、`onError`、`withProgress` 并列。)

- [ ] **Step 4: 编译校验 + 回归测试**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无类型错误(`preferMirror` 为内部 options,`browserFinder.js` 是 JS 经 `require` 调用,不参与 tsc 类型检查;此步主要确保 `markdownService.ts` 改动本身类型正确)。

Run: `node test/browser_finder_test.js`
Expected: `browser_finder_test: all assertions passed`(未触及测试,确认未回归)。

- [ ] **Step 5: 提交**

```bash
git add src/service/markdownService.ts
git commit -m "Prefer China mirror for export download in zh-CN"
```

---

## Task 4: 版本号 bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 改 version**

在 `package.json` 中把:

```json
	"version": "1.0.9",
```

改为:

```json
	"version": "1.0.10",
```

- [ ] **Step 2: 提交**

```bash
git add package.json
git commit -m "Bump version to 1.0.10"
```

---

## Self-Review

**1. Spec coverage**
- 镜像源 + 路径一致(NPM_MIRROR_BASE_URL)→ Task 1。 ✓
- 按语言环境定顺序(`resolveDownloadBaseUrls` + `preferMirror()`)→ Task 1 + Task 3。 ✓
- 逐源 `install({ baseUrl })` + 失败回退 + 全失败抛出 → Task 2。 ✓
- 官方源 = `baseUrl: undefined` → Task 1 纯函数返回值 + Task 2 install 透传。 ✓
- in-flight 去重不变(整个有序尝试是单 Promise)→ Task 2 Step 3 保留原 inflight 逻辑。 ✓
- 不加设置项 / 不动 tier ①③ / 不改 buildId / 不引新依赖 → 计划未触碰这些。 ✓
- 版本 1.0.10 → Task 4。 ✓
- 测试:顺序 + 回退 + 全失败 → Task 1(⑨)+ Task 2(⑩)+ 复用既有 ④⑦。 ✓

**2. Placeholder scan**:无 TBD/TODO;每个代码步骤均含完整代码与确切命令。 ✓

**3. Type/命名一致性**:`preferMirror`(布尔 option)、`resolveDownloadBaseUrls`、`NPM_MIRROR_BASE_URL`、`onError` 在各任务间命名一致;`install` 选项键 `baseUrl` 与 `@puppeteer/browsers` 签名一致;`module.exports` 新增项与测试 import 一致。 ✓
