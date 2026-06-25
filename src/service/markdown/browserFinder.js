const fs = require("fs")

// 跟随 puppeteer-core 的 PUPPETEER_REVISIONS['chrome-headless-shell']
// (见 node_modules/puppeteer-core/lib/puppeteer/revisions.js)。
// 升级 puppeteer-core 时务必同步此版本,保证下载到的无头二进制与 CDP 协议匹配。
const CHROME_HEADLESS_SHELL_BUILD = "149.0.7827.22"

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

// 并发去重:预热(启动)与导出可能同时触发下载。仅在真实路径(未注入 fake 依赖)生效,
// 注入依赖的单测自动绕过,避免模块级状态污染测试隔离。
let inflightDownload = null

/**
 * 解析"导出用浏览器",返回一个可交给 puppeteer 的可执行文件路径。
 *
 * 为什么不直接用系统 Edge/Chrome:在 Windows 上,当系统浏览器已经在运行时,
 * puppeteer 拉起的 msedge.exe/chrome.exe 会被 Chromium 的进程单例(process
 * singleton)交接顶掉、以退出码 0 立即退出,导致 puppeteer 还没连上 DevTools 就失败,
 * 表现为 "Failed to launch the browser process: Code: 0" 或
 * "The browser is already running for <userDataDir>"。chrome-headless-shell 是
 * 独立的无头二进制,不与用户日常浏览器抢同一个单例,所以 Edge/Chrome 开着也能导出。
 *
 * 解析顺序:
 *   ① 用户在设置里显式配置的 chromiumPath(可指向一个当前未运行的浏览器);
 *   ② 缓存的、或现下载的 chrome-headless-shell(推荐路径);
 *   ③ 系统 Edge/Chrome 兜底(旧行为,离线/下载失败时仍可用)。
 *
 * @param {Object} options
 * @param {string} options.cacheDir         chrome-headless-shell 的缓存目录
 * @param {string} [options.configuredPath] 用户配置的 vscode-office.chromiumPath
 * @param {boolean} [options.noSystemFallback] 解析不到 shell 时返回 undefined 而非系统浏览器(预热用)
 * @param {Function} options.systemFallback () => string,返回系统浏览器路径(可抛错)
 * @param {Function} [options.withProgress] (task) => Promise,把下载任务包进进度 UI;
 *                                          task 形如 (report:(pct:string)=>void) => Promise
 * @param {Function} [options.onError]      (err) => void,下载/解析失败时的日志回调
 * @param {Object}   [options._browsers]    仅测试注入:替代 require('@puppeteer/browsers')
 * @param {Object}   [options._fs]          仅测试注入:替代 fs
 * @returns {Promise<string|undefined>}
 */
async function resolveExportBrowser(options) {
  const { configuredPath, noSystemFallback, systemFallback, onError } = options
  const fsm = options._fs || fs

  // ① 用户显式配置优先
  if (configuredPath && fsm.existsSync(configuredPath)) {
    return configuredPath
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

module.exports = { resolveExportBrowser, prefetchExportBrowser, resolveDownloadBaseUrls, CHROME_HEADLESS_SHELL_BUILD, NPM_MIRROR_BASE_URL }
