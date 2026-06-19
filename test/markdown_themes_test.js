const assert = require("assert")
const fs = require("fs")

const cssPath = "resource/markdown/themes.css"
const regPath = "src/provider/markdownThemes.ts"
const css = fs.readFileSync(cssPath, "utf8")
const reg = fs.readFileSync(regPath, "utf8")

// 注册表 id(从 ts 源解析 id: '...')
const regIds = [...reg.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1])
assert.ok(regIds.length >= 1, "注册表应至少有一个主题")

// 解析 themes.css 为 {选择器: 变量体},收集每个 data-theme id 对应的变量体
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
const bodyById = {}
for (const [, selector, body] of blocks) {
    for (const m of selector.matchAll(/\[data-theme="([^"]+)"\]/g)) {
        bodyById[m[1]] = (bodyById[m[1]] || "") + body
    }
}
const cssIds = Object.keys(bodyById)

// 双向一致:注册表与 themes.css 的 id 集合必须相等
for (const id of regIds) assert.ok(cssIds.includes(id), `themes.css 缺少主题: ${id}`)
for (const id of cssIds) assert.ok(regIds.includes(id), `注册表缺少 themes.css 中的主题: ${id}`)

// 每个主题必须定义关键变量(防止漏定义继承串色)
const required = [
  '--md-bg','--md-fg','--md-muted','--md-heading','--md-heading-border','--md-link',
  '--md-border','--md-code-fg','--md-code-bg','--md-pre-bg','--md-pre-border',
  '--md-quote-fg','--md-quote-bg','--md-quote-border','--md-table-head-bg','--md-table-stripe',
  '--md-ui-bg','--md-ui-border',
  '--hl-comment','--hl-keyword','--hl-string','--hl-number','--hl-function',
  '--hl-attr','--hl-class','--hl-meta','--hl-regexp','--hl-symbol'
]
for (const id of regIds) {
    for (const v of required) {
        assert.ok(bodyById[id].includes(v + ':'), `主题 ${id} 缺少变量 ${v}`)
    }
}

console.log(`markdown_themes_test passed (${regIds.length} themes)`)
