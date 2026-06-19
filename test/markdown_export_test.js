const assert = require("assert")
const path = require("path")
const { buildExportHtml } = require("../src/service/markdown/previewExport")

const ext = path.join(__dirname, "..")               // 仓库根 = extensionPath(含 resource/markdown)
const mdPath = path.join(ext, "sample.md")
const html = buildExportHtml("# Hi\n\n```js\nconst a = 1\n```\n", "dracula", mdPath, ext)

assert.ok(/data-theme="dracula"/.test(html), "应注入 data-theme")
assert.ok(/\[data-theme="dracula"\]/.test(html), "应内联 themes.css(含 dracula 块)")
assert.ok(/<base href="file:\/\//.test(html), "应有 file:// base href")
assert.ok(/katex\.min\.css/.test(html), "应链接 katex")
assert.ok(/class=['"]hljs['"]/.test(html), "应渲染高亮代码")

console.log("markdown_export_test passed")
