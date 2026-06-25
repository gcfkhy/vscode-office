// 断言测试:resolveExportBrowser 的解析顺序(无网络,注入 fake 依赖)。
// 运行:node test/browser_finder_test.js
const assert = require("assert")
const { resolveExportBrowser, prefetchExportBrowser, CHROME_HEADLESS_SHELL_BUILD } = require("../src/service/markdown/browserFinder")

const SHELL_EXE = "/cache/chrome-headless-shell/win64-" + CHROME_HEADLESS_SHELL_BUILD + "/chrome-headless-shell.exe"

// 构造一个 fake @puppeteer/browsers
function fakeBrowsers(opts = {}) {
  const calls = { install: 0 }
  return {
    calls,
    Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
    detectBrowserPlatform: () => (opts.platform === undefined ? "win64" : opts.platform),
    computeExecutablePath: () => SHELL_EXE,
    install: async () => {
      calls.install++
      if (opts.installThrows) throw new Error("download failed")
      return { executablePath: SHELL_EXE }
    },
  }
}

// fake fs:present 是"存在"的路径集合
function fakeFs(present) {
  const set = new Set(present)
  return { existsSync: (p) => set.has(p), mkdirSync: () => {} }
}

async function run() {
  // ① 用户配置优先:配置路径存在 → 直接返回,不碰 browsers
  {
    const browsers = fakeBrowsers()
    const out = await resolveExportBrowser({
      cacheDir: "/cache", configuredPath: "/my/chrome.exe",
      systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs(["/my/chrome.exe"]),
    })
    assert.strictEqual(out, "/my/chrome.exe", "configured path should win")
    assert.strictEqual(browsers.calls.install, 0, "must not install when configured path exists")
  }

  // ①b 配置了但路径不存在 → 跳过,落到 chrome-headless-shell
  {
    const browsers = fakeBrowsers()
    const out = await resolveExportBrowser({
      cacheDir: "/cache", configuredPath: "/missing.exe",
      systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([SHELL_EXE]),
    })
    assert.strictEqual(out, SHELL_EXE, "missing configured path should fall through to shell")
  }

  // ② 已缓存 chrome-headless-shell → 返回它,且不触发下载
  {
    const browsers = fakeBrowsers()
    const out = await resolveExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM",
      _browsers: browsers, _fs: fakeFs([SHELL_EXE]),
    })
    assert.strictEqual(out, SHELL_EXE, "cached shell should be returned")
    assert.strictEqual(browsers.calls.install, 0, "cached → no install")
  }

  // ③ 未缓存 → 触发 install,返回安装结果
  {
    const browsers = fakeBrowsers()
    const present = new Set() // 安装前不存在;安装后存在
    const fs = { existsSync: (p) => present.has(p), mkdirSync: () => {} }
    const origInstall = browsers.install
    browsers.install = async (a) => { const r = await origInstall(a); present.add(SHELL_EXE); return r }
    const out = await resolveExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fs,
    })
    assert.strictEqual(out, SHELL_EXE, "should install then return shell")
    assert.strictEqual(browsers.calls.install, 1, "should install exactly once")
  }

  // ④ 下载失败 → onError 触发,退回系统浏览器
  {
    const browsers = fakeBrowsers({ installThrows: true })
    let errored = false
    const out = await resolveExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM",
      onError: () => { errored = true }, _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, "SYSTEM", "install failure should fall back to system")
    assert.strictEqual(errored, true, "onError should be called on failure")
  }

  // ⑤ 平台不支持(detectBrowserPlatform 返回 null)→ 退回系统浏览器
  {
    const browsers = fakeBrowsers({ platform: null })
    const out = await resolveExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, "SYSTEM", "unsupported platform should fall back to system")
    assert.strictEqual(browsers.calls.install, 0, "no install on unsupported platform")
  }

  // ⑥ prefetch:平台不支持 → undefined(不回退系统)
  {
    const browsers = fakeBrowsers({ platform: null })
    const out = await prefetchExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, undefined, "prefetch unsupported platform → undefined")
  }

  // ⑦ prefetch:下载失败 → undefined(不回退系统)
  {
    const browsers = fakeBrowsers({ installThrows: true })
    const out = await prefetchExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([]),
    })
    assert.strictEqual(out, undefined, "prefetch download failure → undefined")
  }

  // ⑧ prefetch:已缓存 → 返回 shell
  {
    const browsers = fakeBrowsers()
    const out = await prefetchExportBrowser({
      cacheDir: "/cache", systemFallback: () => "SYSTEM", _browsers: browsers, _fs: fakeFs([SHELL_EXE]),
    })
    assert.strictEqual(out, SHELL_EXE, "prefetch cached → shell")
  }

  console.log("browser_finder_test: all assertions passed")
}

run().catch((e) => { console.error(e); process.exit(1) })
