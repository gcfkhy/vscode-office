const markdownIt = require("markdown-it")
const markdownItCheckbox = require("markdown-it-checkbox")
const markdownItKatex = require("./ext/markdown-it-katex")
const markdownItMermaid = require("./ext/markdown-it-mermaid").default
const markdownItPlantuml = require("markdown-it-plantuml")
const markdownItToc = require("markdown-it-toc-done-right")
const markdownItAnchor = require("markdown-it-anchor")

/**
 * 创建共享的 markdown-it 实例(预览与导出共用同一插件配置)。
 * @param {{ breaks?: boolean }} options
 */
function createMarkdownIt(options = {}) {
  const hljs = require("highlight.js")
  let md
  md = markdownIt({
    html: true,
    breaks: options.breaks === true,
    highlight: function (str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          str = hljs.highlight(lang, str, true).value
        } catch (error) {
          str = md.utils.escapeHtml(str)
        }
      } else {
        str = md.utils.escapeHtml(str)
      }
      return "<pre class='hljs'><code><div>" + str + "</div></code></pre>"
    }
  })
  md.use(markdownItCheckbox)
    .use(markdownItAnchor)
    .use(markdownItToc)
    .use(markdownItKatex)
    .use(markdownItPlantuml)
    .use(markdownItMermaid)
  return md
}

/**
 * 预览用:把 Markdown 文本渲染为 HTML 片段(相对图片交给 <base href> 解析,不重写 src)。
 * 渲染出错时退化为转义后的 <pre>,避免预览空白。
 * @param {string} text
 * @param {{ breaks?: boolean }} options
 * @returns {string}
 */
function renderMarkdownToHtml(text, options = {}) {
  try {
    const md = createMarkdownIt(options)
    return md.render(text || "")
  } catch (error) {
    console.error("renderMarkdownToHtml failed:", error)
    const escaped = String(text || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    return '<pre class="md-render-error">' + escaped + '</pre>'
  }
}

module.exports = { createMarkdownIt, renderMarkdownToHtml }
