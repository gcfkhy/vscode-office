const fs = require("fs")
const path = require("path")
const { pathToFileURL } = require("url")
const { renderMarkdownToHtml } = require("./render")

/** 构建与预览同款的主题化导出 HTML(资源用 file://,样式内联,可被 puppeteer 加载) */
function buildExportHtml(text, themeId, mdPath, extensionPath) {
  const body = renderMarkdownToHtml(text || "")
  const resDir = path.join(extensionPath, "resource", "markdown")
  const previewCss = fs.readFileSync(path.join(resDir, "preview.css"), "utf8")
  const themesCss = fs.readFileSync(path.join(resDir, "themes.css"), "utf8")
  const katexHref = pathToFileURL(path.join(resDir, "katex", "katex.min.css")).href
  const mermaidSrc = pathToFileURL(path.join(resDir, "mermaid.min.js")).href
  const baseHref = pathToFileURL(path.dirname(mdPath) + path.sep).href
  const hasMermaid = /class=["']mermaid["']/.test(body)
  const mermaidScript = hasMermaid
    ? `<script src="${mermaidSrc}"></script><script>mermaid.initialize({startOnLoad:false});mermaid.run();</script>`
    : ""
  return `<!DOCTYPE html>
<html data-theme="${themeId}">
<head>
<meta charset="utf-8">
<base href="${baseHref}">
<link rel="stylesheet" href="${katexHref}">
<style>
${themesCss}
${previewCss}
</style>
</head>
<body>
<div class="md-body">${body}</div>
${mermaidScript}
</body>
</html>`
}

/**
 * 主题化导出。format: 'pdf' | 'html' | 'png'。返回输出文件路径。
 * options: { markdownFilePath, format, themeId, extensionPath, executablePath, puppeteerArgs }
 */
async function exportPreview(options) {
  const { markdownFilePath, format, themeId, extensionPath, executablePath, puppeteerArgs } = options
  const text = fs.readFileSync(markdownFilePath, "utf8")
  const html = buildExportHtml(text, themeId, markdownFilePath, extensionPath)
  const origin = path.parse(markdownFilePath)
  const outPath = path.join(origin.dir, origin.name + "." + format)

  if (format === "html") {
    fs.writeFileSync(outPath, html, "utf-8")
    return outPath
  }

  // pdf / png 需要 Chromium
  const tmpFile = path.join(origin.dir, origin.name + "_export_tmp.html")
  fs.writeFileSync(tmpFile, html, "utf-8")
  const puppeteer = require("puppeteer-core")
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: ["--allow-file-access-from-files", ...(puppeteerArgs || [])]
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 980, height: 1200, deviceScaleFactor: 2 })
    await page.goto(pathToFileURL(tmpFile).href, { waitUntil: "networkidle0", timeout: 60000 })
    if (/class=["']mermaid["']/.test(html)) {
      await page.waitForSelector(".mermaid svg", { timeout: 5000 }).catch(() => {})
    }
    if (format === "png") {
      await page.screenshot({ path: outPath, fullPage: true, type: "png" })
    } else { // pdf:单页不分页,尺寸=实测内容宽×全高
      const dims = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight
      }))
      await page.pdf({
        path: outPath,
        printBackground: true,
        width: `${dims.w}px`,
        height: `${dims.h}px`,
        pageRanges: "1",
        margin: { top: "0", right: "0", bottom: "0", left: "0" }
      })
    }
  } finally {
    await browser.close()
    try { fs.unlinkSync(tmpFile) } catch (e) { /* ignore */ }
  }
  return outPath
}

module.exports = { buildExportHtml, exportPreview }
