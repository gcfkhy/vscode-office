# Markdown 导出引擎下载源自动选择 + 自动回退 — 设计稿

日期：2026-06-25
功能：下载导出用的 `chrome-headless-shell` 时,按语言环境自动选择下载源(国内 npmmirror 镜像 /
Google 官方),并在任一源失败时**自动切到另一个源重试**。**全自动、零设置**,不暴露任何用户开关。

## 背景与现状

Markdown 主题化导出(PDF / 长图 PNG)由 puppeteer 拉起 `chrome-headless-shell` 渲染。该无头
二进制在首次使用 / 启动预热时按需下载(约 113MB,一次性缓存到 `globalStorage/browsers`),解析
逻辑在 `src/service/markdown/browserFinder.js`,三级顺序:① 用户 `chromiumPath` → ②
`chrome-headless-shell`(下载/缓存)→ ③ 系统 Edge/Chrome 自动兜底。

**痛点**:第 ② 级的下载源在 `@puppeteer/browsers` 里写死为
`https://storage.googleapis.com/chrome-for-testing-public`(Google 云存储)。该域被 GFW
封锁/不稳定,**国内普通网络(不翻墙)基本下不动**,首次导出 / 启动预热会超时失败,只能落到第 ③ 级
系统浏览器兜底(需用户彻底关闭 Edge 才可靠)。

**已确认的事实**:
- 下载 URL 由 `resolveDownloadUrl(platform, buildId, baseUrl)` 拼成
  `${baseUrl}/${buildId}/${folder}/chrome-headless-shell-${folder}.zip`,`baseUrl` 可被
  `install({ baseUrl })` 覆盖。当前 `browserFinder.js` 调 `install()` **未传 `baseUrl`**。
- npmmirror 镜像 `https://cdn.npmmirror.com/binaries/chrome-for-testing` 路径布局与官方**完全一致**;
  我们使用的固定版本 `CHROME_HEADLESS_SHELL_BUILD = "149.0.7827.22"` 在两边均存在(实测
  win64 两源均 HTTP 200、同为 113.3MB)。
- 我们用**写死的 buildId**,从不请求版本解析接口(`googlechromelabs.github.io/chrome-for-testing`),
  故只需镜像有二进制即可,无其他被墙环节。
- `@puppeteer/browsers` 的 `install()`:**传了 `baseUrl` 就只用该 provider**(不再自动回退到
  Google);不传则用其内置默认 provider(Google)。因此跨源回退必须由本设计的调用方显式实现。

## 目标

1. 让国内用户**开箱即用**:简体中文环境优先走 npmmirror 镜像,无需任何配置、无需翻墙即可下载导出引擎。
2. **抗故障**:任一下载源失败(镜像挂了 / 语言判断与真实网络环境不符)时,自动切到另一个源重试,
   尽量让下载成功,实在全失败才落到原有的系统浏览器兜底。
3. **零设置**:不新增任何 `vscode-office.*` 配置项,不加 UI。延续项目"不给用户递一条可能失败的
   路径"的取舍。

## 决策(已确认)

| # | 项 | 选择 |
|---|---|---|
| 1 | 是否加设置项 | **否**。全自动,无用户开关、无逃生口 |
| 2 | 源选择信号 | `vscode.env.language === 'zh-cn'` **或** `vscode-office.editorLanguage === 'zh_CN'` → 判定为简体中文环境 |
| 3 | 简体中文环境顺序 | `[npmmirror, 官方]` |
| 4 | 其他环境顺序 | `[官方, npmmirror]`(默认官方;官方失败仍自动回退镜像) |
| 5 | 回退触发 | 某源 `install()` 抛错 → 记一行 Output → 试下一个源;全失败才抛出 |
| 6 | 官方源表示 | `baseUrl: undefined`(交给 `@puppeteer/browsers` 用其内置默认),镜像源用 npmmirror 字符串 |
| 7 | 版本 | `package.json` bump 到 `1.0.10` |

## 模块设计

### 1. `browserFinder.js`:下载源顺序 + 逐源回退

**新增常量**
```js
const NPM_MIRROR_BASE_URL = "https://cdn.npmmirror.com/binaries/chrome-for-testing"
```

**新增纯函数(可单测)**
```js
// preferMirror=true → [NPM_MIRROR, undefined];否则 [undefined, NPM_MIRROR]
// 数组元素即传给 install({ baseUrl }) 的值;undefined 表示官方默认源
function resolveDownloadBaseUrls(preferMirror) { ... }
```

**`locateOrDownloadShell` / `doDownloadShell` 改造**
- 新增内部选项 `preferMirror?: boolean`(由调用方传入;默认 `false`,即非中文环境顺序)。
- `doDownloadShell` 内对 `resolveDownloadBaseUrls(preferMirror)` 的每个 `baseUrl` **依次尝试**
  `browsers.install({ browser, buildId, cacheDir, baseUrl, downloadProgressCallback })`:
  - 成功(产物存在)→ 返回路径,结束。
  - 抛错 → `onError(e)`(若提供)记日志,继续下一个 `baseUrl`。
  - 全部失败 → 抛出最后一个错误(交由上层:导出落系统兜底 / 预热返回 undefined)。
- `withProgress` 包裹整个"有序尝试"(进度文案沿用现有"下载 Markdown 导出引擎… <pct>");回退到
  下一源时进度回调继续生效。

**并发去重(in-flight)不变**:整个有序尝试是**单个 Promise**,挂在模块级 in-flight 上;预热与抢跑
导出仍复用同一下载、不出现第二个下载/第二个进度条。去重仍仅在真实路径(`!options._browsers`)生效。

**`resolveExportBrowser` / `prefetchExportBrowser`**:透传 `preferMirror` 选项到
`locateOrDownloadShell`,其余三级解析顺序与签名不变。

### 2. `markdownService.ts`:计算 locale 信号并传入

- `browserFinder.js` 保持**无 `vscode` 依赖**:由 `markdownService` 计算 `preferMirror` 布尔后传入。
- 新增私有方法(或内联工具):
  ```ts
  private preferMirror(): boolean {
    const lang = (vscode.env.language || "").toLowerCase();
    const editorLang = Global.getConfig<string>("editorLanguage");
    return lang === "zh-cn" || editorLang === "zh_CN";
  }
  ```
- `resolveBrowser()`(导出路径)与 `prewarmBrowser()`(启动预热)调用
  `resolveExportBrowser` / `prefetchExportBrowser` 时,在 options 里带上 `preferMirror: this.preferMirror()`。

### 3. 测试(`test/browser_finder_test.js`)

沿用现有"注入 fake 依赖、无网络"风格,新增:
- `resolveDownloadBaseUrls(true)` → `[NPM_MIRROR, undefined]`;`resolveDownloadBaseUrls(false)`
  → `[undefined, NPM_MIRROR]`。
- 回退:注入 `_browsers.install`,使其对**第一个 baseUrl 抛错、第二个成功** → 最终解析到 shell 路径,
  且 `install` 被以两个不同 `baseUrl` 各调一次(顺序正确)。
- 全失败:`install` 对所有 baseUrl 均抛错 → `prefetchExportBrowser` 抛出(预热侧)/
  `resolveExportBrowser` 落系统兜底(导出侧),与现有"下载失败"用例一致。

## 边界与非目标

- **不新增任何用户设置**;源选择与回退全自动。
- 不改第 ① 级 `chromiumPath` 与第 ③ 级系统浏览器探测/启动参数。
- 不改 `CHROME_HEADLESS_SHELL_BUILD` 版本号。
- 不接 i18n;Output/进度文案沿用现有硬编码中文。
- 不引入新依赖(`@puppeteer/browsers` 已支持 `baseUrl`,已在 `build.ts` external 预打包)。
- 不触碰 CHANGELOG(fork 的发布说明走 GitHub Release,不维护 1.0.x CHANGELOG 条目)。

## 验证要点

- `node test/browser_finder_test.js` 全部断言通过(含新增顺序 / 回退 / 全失败用例)。
- 简体中文 VS Code、缓存为空、断开 Google 仅留 npmmirror(或反之):启动后状态栏出现下载进度,
  自动选中可达源完成下载;随后导出 PDF/长图无等待。
- 英文 VS Code 但处于国内网络:先试 Google 失败 → 自动回退 npmmirror 成功(Output 有一行回退记录)。
- 热启动(已缓存):启动无下载、无状态栏;导出正常(`existsSync` 命中,不进入逐源尝试)。
- 抢跑:启动预热进行中立即触发导出 → 不出现第二个下载/进度条,复用同一有序尝试。
- 两源皆不可达:状态栏短暂出现后消失,Output 有错误;导出落系统浏览器兜底(需关闭 Edge)。
