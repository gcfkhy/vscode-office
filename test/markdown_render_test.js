const assert = require("assert")
const { renderMarkdownToHtml } = require("../src/service/markdown/render")

const html = renderMarkdownToHtml("# Hello\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")

assert.ok(/<h1[^>]*>Hello<\/h1>/.test(html), "应渲染 h1 标题")
assert.ok(/class=['"]hljs['"]/.test(html), "代码块应带 hljs 类")
assert.ok(/<table>/.test(html), "应渲染表格")

const fallback = renderMarkdownToHtml(null)
assert.strictEqual(typeof fallback, "string", "空输入应返回字符串而非抛错")

console.log("markdown_render_test passed")
