# Markdown 预览多主题切换 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给只读 Markdown 预览加右下角主题切换器,内置亮/暗各多个调色板主题,点选即时切换并全局记忆,默认 Catppuccin Mocha。

**Architecture:** 调色板驱动 —— `preview.css` 保留排版结构、颜色全部引用 CSS 变量(`--md-*` 文档色 + `--hl-*` 代码高亮色);`themes.css` 用 `[data-theme="<id>"]{…}` 给每个主题赋值,`:root` 兜底 Mocha;切主题 = 改 `<html data-theme>`。宿主从 `globalState` 读已选主题注入首屏(无闪烁),webview 切换时回传宿主保存。

**Tech Stack:** TypeScript/esbuild(扩展宿主)、纯 CSS 变量、VS Code Webview、`globalState`。

**关键事实(实现前必读):**
- 验证手段:`node test/markdown_render_test.js`(渲染器,既有)、`node test/markdown_themes_test.js`(本特性新增,主题同步校验)、`npx tsc -p tsconfig.json --noEmit`、F5 手动。`npm run build` 在 Git Bash 跑(`rm -rf out`)。
- 不要跑 `npm run lint:fix`(全量 `eslint --fix` 会污染整树)。用 Edit 改文件,用 Bash 跑 `git`/`node`/`npx tsc`。改 `package.json` 也用 Edit 不用包管理器。
- webview↔宿主消息格式 `{type, content}`(见 `src/common/handler.ts`)。`Handler.bind` 自动有 `fileChange`/`externalUpdate`/`dispose`。
- 当前预览文件:`src/provider/markdownPreviewProvider.ts`,`buildHtml` 里 `<link>` 现在加载 `katex/katex.min.css`、`highlight/catppuccin-mocha.css`、`preview.css`。
- 现有 `resource/markdown/preview.css` 用硬编码 Catppuccin 颜色;`resource/markdown/highlight/catppuccin-mocha.css` 是硬编码 hljs 暗色主题。

---

## 文件结构

**新增**
- `resource/markdown/themes.css` —— 所有主题调色板(`:root` 兜底 Mocha + 每主题一段 `[data-theme]`)。
- `src/provider/markdownThemes.ts` —— 主题注册表(id/名称/分组 + 默认 id),单一事实源,供宿主注入与校验。
- `test/markdown_themes_test.js` —— 注册表 ↔ themes.css 同步 + 关键变量存在性校验。

**修改**
- `resource/markdown/preview.css` —— 颜色变量化(文档 + hljs token)+ 切换器 UI 样式。
- `src/provider/markdownPreviewProvider.ts` —— `<link>` 换 `themes.css`、注入 `data-theme`、切换器 HTML/JS、`setTheme` 持久化。

**删除**
- `resource/markdown/highlight/catppuccin-mocha.css` —— token 颜色并入 Mocha 调色板 + 变量化 hljs 规则。

---

## 调色板映射配方(Task 3 据此填各主题)

每个主题需为下列变量赋十六进制色值。从该主题**权威来源**取色,按"角色"对应:

| 变量 | 角色 | 取色建议 |
| --- | --- | --- |
| `--md-bg` | 页面背景 | 主背景(base) |
| `--md-fg` | 正文 | 主前景(text) |
| `--md-muted` | 次要文字 | 次前景(subtext/comment) |
| `--md-heading` | 标题 | 强调色(accent/lavender/blue 等) |
| `--md-heading-border` | h1/h2 下划线 | 浅边框(surface) |
| `--md-link` | 链接 | 链接/蓝色 |
| `--md-border` | 表格/分隔线 | 边框(surface) |
| `--md-code-fg` | 行内代码字 | 醒目强调(红/粉) |
| `--md-code-bg` | 行内代码底 | 次背景(surface) |
| `--md-pre-bg` | 代码块底 | 比页面略深/浅一档(mantle) |
| `--md-pre-border` | 代码块边框 | 边框(surface) |
| `--md-quote-fg` | 引用字 | 次前景 |
| `--md-quote-bg` | 引用底 | mantle |
| `--md-quote-border` | 引用左条 | overlay/comment |
| `--md-table-head-bg` | 表头底 | surface |
| `--md-table-stripe` | 偶数行底 | mantle |
| `--md-ui-bg` | 按钮/面板底 | surface 的 0.92 透明(`rgba(...,0.92)`) |
| `--md-ui-border` | 按钮/面板边框 | surface1 |
| `--hl-comment` | 注释 | comment/灰 |
| `--hl-keyword` | 关键字 | mauve/紫/红 |
| `--hl-string` | 字符串 | green |
| `--hl-number` | 数字/字面量 | peach/橙 |
| `--hl-function` | 函数名 | blue |
| `--hl-attr` | 属性/变量 | yellow |
| `--hl-class` | 类型/内建 | teal/青 |
| `--hl-meta` | 元信息 | peach/橙 |
| `--hl-regexp` | 正则 | pink |
| `--hl-symbol` | 符号 | peach/橙 |

**亮色主题注意**:`--md-bg` 必须浅、`--md-fg` 必须深,代码块 token 颜色要在浅底上可读(用深一些的同色相)。

---

## Task 1: preview.css 变量化 + Mocha 基线

**Files:**
- Modify: `resource/markdown/preview.css`(整文件重写)
- Create: `resource/markdown/themes.css`
- Modify: `src/provider/markdownPreviewProvider.ts`(`buildHtml` 的 `<link>` 段)
- Delete: `resource/markdown/highlight/catppuccin-mocha.css`

- [ ] **Step 1: 重写 `resource/markdown/preview.css`(结构不变,颜色全变量)**

```css
:root { color-scheme: light dark; }
html, body { margin:0; padding:0; background: var(--md-bg); }
.md-body {
  padding: 16px 24px;
  font-family: 'MiSans','Segoe UI',sans-serif;
  font-size: 14px; line-height: 1.7; color: var(--md-fg);
}
.md-render-error { color: var(--md-code-fg); white-space: pre-wrap; }
.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6 {
  color: var(--md-heading); margin: 1.2em 0 0.4em; font-weight: 600; line-height: 1.3;
}
.md-body h1 { font-size:1.6em; border-bottom:1px solid var(--md-heading-border); padding-bottom:0.3em; }
.md-body h2 { font-size:1.3em; border-bottom:1px solid var(--md-heading-border); padding-bottom:0.2em; }
.md-body h3 { font-size:1.1em; }
.md-body p { margin: 0.6em 0; }
.md-body ul,.md-body ol { padding-left:1.5em; margin:0.5em 0; }
.md-body li { margin:0.2em 0; }
.md-body a { color: var(--md-link); text-decoration:none; }
.md-body a:hover { text-decoration:underline; }
.md-body code {
  font-family:'SF Mono',Consolas,'MiSans',monospace; font-size:0.88em; font-weight:500;
  background: var(--md-code-bg); color: var(--md-code-fg); padding:0.1em 0.4em; border-radius:4px;
}
.md-body pre {
  background: var(--md-pre-bg); border:1px solid var(--md-pre-border); border-radius:6px;
  padding:12px; overflow-x:auto; margin:0.8em 0;
}
.md-body pre code {
  background:transparent; padding:0; font-size:13px; font-weight:500; color: var(--md-fg);
  font-family:'SF Mono',Consolas,'MiSans',monospace;
}
.md-body blockquote {
  border-left:3px solid var(--md-quote-border); margin:0.8em 0; padding:0.3em 1em;
  color: var(--md-quote-fg); background: var(--md-quote-bg); border-radius:0 4px 4px 0;
}
.md-body hr { border:none; border-top:1px solid var(--md-border); margin:1em 0; }
.md-body table { border-collapse:collapse; width:100%; margin:0.8em 0; font-size:13px; }
.md-body th,.md-body td { border:1px solid var(--md-border); padding:6px 10px; text-align:left; }
.md-body th { background: var(--md-table-head-bg); color: var(--md-heading); }
.md-body tr:nth-child(even) { background: var(--md-table-stripe); }
.md-body img { max-width:100%; border-radius:4px; }

/* highlight.js token —— 变量驱动,随主题变色 */
.hljs { color: var(--md-fg); background: transparent; }
.hljs-comment,.hljs-quote { color: var(--hl-comment); font-style: italic; }
.hljs-keyword,.hljs-selector-tag,.hljs-name,.hljs-tag { color: var(--hl-keyword); }
.hljs-string,.hljs-section,.hljs-addition { color: var(--hl-string); }
.hljs-number,.hljs-literal,.hljs-bullet,.hljs-link,.hljs-deletion { color: var(--hl-number); }
.hljs-title,.hljs-title.function_,.hljs-function .hljs-title { color: var(--hl-function); }
.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-params,.hljs-property { color: var(--hl-attr); }
.hljs-built_in,.hljs-type,.hljs-title.class_,.hljs-class .hljs-title { color: var(--hl-class); }
.hljs-meta { color: var(--hl-meta); }
.hljs-symbol { color: var(--hl-symbol); }
.hljs-regexp { color: var(--hl-regexp); }
.hljs-selector-id,.hljs-selector-class,.hljs-selector-attr,.hljs-selector-pseudo { color: var(--hl-class); }
.hljs-doctag,.hljs-strong { font-weight:bold; }
.hljs-emphasis { font-style:italic; }

/* 右下角主题切换器 */
#md-theme-btn {
  position: fixed; right:16px; bottom:16px; width:36px; height:36px; border-radius:50%;
  background: var(--md-ui-bg); border:1px solid var(--md-ui-border); color: var(--md-fg);
  display:flex; align-items:center; justify-content:center; font-size:17px; cursor:pointer;
  z-index:99999; opacity:0.8; user-select:none; -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);
}
#md-theme-btn:hover { opacity:1; }
#md-theme-panel {
  position: fixed; right:16px; bottom:60px; max-height:60vh; overflow:auto; display:none;
  background: var(--md-ui-bg); border:1px solid var(--md-ui-border); border-radius:8px; padding:6px;
  z-index:99999; min-width:170px; box-shadow:0 6px 24px rgba(0,0,0,0.35);
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
}
#md-theme-panel.open { display:block; }
.md-theme-group-title { font-size:11px; color: var(--md-muted); margin:6px 6px 2px; }
.md-theme-item { padding:4px 8px; border-radius:4px; cursor:pointer; font-size:13px; color: var(--md-fg); white-space:nowrap; }
.md-theme-item:hover { background: var(--md-pre-bg); }
.md-theme-item.active { background: var(--md-pre-bg); font-weight:600; }
.md-theme-item.active::after { content:" ✓"; color: var(--md-link); }
```

- [ ] **Step 2: 创建 `resource/markdown/themes.css`,先放 Mocha(`:root` 兜底 + `[data-theme]`)**

```css
/* 默认兜底 = Catppuccin Mocha;每个主题一段 [data-theme] */
:root,
[data-theme="catppuccin-mocha"] {
  --md-bg:#1e1e2e; --md-fg:#cdd6f4; --md-muted:#a6adc8;
  --md-heading:#b4befe; --md-heading-border:#313244; --md-link:#89b4fa;
  --md-border:#313244; --md-code-fg:#f38ba8; --md-code-bg:#313244;
  --md-pre-bg:#181825; --md-pre-border:#313244;
  --md-quote-fg:#a6adc8; --md-quote-bg:#181825; --md-quote-border:#6c7086;
  --md-table-head-bg:#313244; --md-table-stripe:#181825;
  --md-ui-bg:rgba(49,50,68,0.92); --md-ui-border:#45475a;
  --hl-comment:#6c7086; --hl-keyword:#cba6f7; --hl-string:#a6e3a1; --hl-number:#fab387;
  --hl-function:#89b4fa; --hl-attr:#f9e2af; --hl-class:#94e2d5; --hl-meta:#fab387;
  --hl-regexp:#f5c2e7; --hl-symbol:#fab387;
}
```

- [ ] **Step 3: 删除旧 hljs 文件**

Run: `git rm resource/markdown/highlight/catppuccin-mocha.css`

- [ ] **Step 4: provider 改 `<link>`(去 catppuccin-mocha.css,加 themes.css)**

在 `src/provider/markdownPreviewProvider.ts` 的 `buildHtml` 中,把:
```ts
<link rel="stylesheet" href="${asset('katex/katex.min.css')}">
<link rel="stylesheet" href="${asset('highlight/catppuccin-mocha.css')}">
<link rel="stylesheet" href="${asset('preview.css')}">
```
替换为:
```ts
<link rel="stylesheet" href="${asset('katex/katex.min.css')}">
<link rel="stylesheet" href="${asset('themes.css')}">
<link rel="stylesheet" href="${asset('preview.css')}">
```

- [ ] **Step 5: 校验**

Run: `node test/markdown_render_test.js` → `markdown_render_test passed`。
Run: `npx tsc -p tsconfig.json --noEmit` → 无新增错误(忽略既有基线)。
（F5 手动:预览外观应与之前 Mocha **完全一致**,只是底层改成了变量。）

- [ ] **Step 6: 提交**

```bash
git add resource/markdown/preview.css resource/markdown/themes.css src/provider/markdownPreviewProvider.ts
git rm resource/markdown/highlight/catppuccin-mocha.css
git commit -m "Refactor markdown preview styles to CSS variables"
```

---

## Task 2: 主题注册表 + 同步校验测试(先失败)

**Files:**
- Create: `src/provider/markdownThemes.ts`
- Create: `test/markdown_themes_test.js`

- [ ] **Step 1: 创建注册表 `src/provider/markdownThemes.ts`**

```ts
export interface MarkdownTheme {
    id: string;
    name: string;
    group: 'light' | 'dark';
}

export const DEFAULT_THEME_ID = 'catppuccin-mocha';

export const MARKDOWN_THEMES: MarkdownTheme[] = [
    // dark
    { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', group: 'dark' },
    { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', group: 'dark' },
    { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', group: 'dark' },
    { id: 'dracula', name: 'Dracula', group: 'dark' },
    { id: 'nord', name: 'Nord', group: 'dark' },
    { id: 'one-dark', name: 'One Dark', group: 'dark' },
    { id: 'tokyo-night', name: 'Tokyo Night', group: 'dark' },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark', group: 'dark' },
    { id: 'solarized-dark', name: 'Solarized Dark', group: 'dark' },
    { id: 'rose-pine', name: 'Rosé Pine', group: 'dark' },
    // light
    { id: 'github-light', name: 'GitHub Light', group: 'light' },
    { id: 'catppuccin-latte', name: 'Catppuccin Latte', group: 'light' },
    { id: 'solarized-light', name: 'Solarized Light', group: 'light' },
    { id: 'gruvbox-light', name: 'Gruvbox Light', group: 'light' },
    { id: 'one-light', name: 'One Light', group: 'light' },
    { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', group: 'light' },
    { id: 'ayu-light', name: 'Ayu Light', group: 'light' },
    { id: 'tokyo-night-light', name: 'Tokyo Night Light', group: 'light' },
];
```

- [ ] **Step 2: 创建同步校验测试 `test/markdown_themes_test.js`**

```js
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
const required = ['--md-bg','--md-fg','--md-heading','--md-link','--md-pre-bg',
                  '--md-ui-bg','--hl-comment','--hl-keyword','--hl-string','--hl-function']
for (const id of regIds) {
    for (const v of required) {
        assert.ok(bodyById[id].includes(v + ':'), `主题 ${id} 缺少变量 ${v}`)
    }
}

console.log(`markdown_themes_test passed (${regIds.length} themes)`)
```

- [ ] **Step 3: 运行,确认失败(themes.css 只有 mocha,缺其余 17 个)**

Run: `node test/markdown_themes_test.js`
Expected: FAIL（`themes.css 缺少主题: catppuccin-macchiato`)。

- [ ] **Step 4: 提交**

```bash
git add src/provider/markdownThemes.ts test/markdown_themes_test.js
git commit -m "Add markdown theme registry and sync test"
```

---

## Task 3: 填充全部调色板(WebFetch 权威色值)

**Files:**
- Modify: `resource/markdown/themes.css`(追加 17 个 `[data-theme]` 块)

> 用 WebFetch 抓各主题官方/权威色值,按上方"调色板映射配方"为每个变量赋值。每个块必须定义配方表中**全部**变量。下面给出 **GitHub Light** 作为亮色完整样板;其余按同法填。

- [ ] **Step 1: 追加 GitHub Light(亮色完整样板,可直接用)**

在 `themes.css` 末尾追加:

```css
[data-theme="github-light"] {
  --md-bg:#ffffff; --md-fg:#1f2328; --md-muted:#59636e;
  --md-heading:#1f2328; --md-heading-border:#d1d9e0; --md-link:#0969da;
  --md-border:#d1d9e0; --md-code-fg:#1f2328; --md-code-bg:#eff1f3;
  --md-pre-bg:#f6f8fa; --md-pre-border:#d1d9e0;
  --md-quote-fg:#59636e; --md-quote-bg:#f6f8fa; --md-quote-border:#d1d9e0;
  --md-table-head-bg:#f6f8fa; --md-table-stripe:#f6f8fa;
  --md-ui-bg:rgba(246,248,250,0.92); --md-ui-border:#d1d9e0;
  --hl-comment:#6e7781; --hl-keyword:#cf222e; --hl-string:#0a3069; --hl-number:#0550ae;
  --hl-function:#8250df; --hl-attr:#953800; --hl-class:#953800; --hl-meta:#0550ae;
  --hl-regexp:#0a3069; --hl-symbol:#0550ae;
}
```

- [ ] **Step 2: 追加其余暗色主题**

用 WebFetch 抓官方调色板,按配方为每个填全部变量,追加到 `themes.css`:
- `catppuccin-macchiato`、`catppuccin-frappe` —— 来源:Catppuccin 官方 palette(https://catppuccin.com/palette)。Macchiato base `#24273a` text `#cad3f5`;Frappé base `#303446` text `#c6d0f5`(其余按 Mocha 同角色取对应 flavor 色)。
- `dracula` —— https://draculatheme.com/contribute(bg `#282a36`、fg `#f8f8f2`、comment `#6272a4`、purple `#bd93f9`、green `#50fa7b`、cyan `#8be9fd`、orange `#ffb86c`、pink `#ff79c6`、red `#ff5555`、yellow `#f1fa8c`)。
- `nord` —— https://www.nordtheme.com/docs/colors-and-palettes(polar night `#2e3440/#3b4252/#434c5e`、snow `#d8dee9/#e5e9f0`、frost `#8fbcbb/#88c0d0/#81a1c1/#5e81ac`、aurora `#bf616a/#d08770/#ebcb8b/#a3be8c/#b48ead`)。
- `one-dark` —— Atom One Dark(bg `#282c34`、fg `#abb2bf`、comment `#5c6370`、red `#e06c75`、green `#98c379`、yellow `#e5c07b`、blue `#61afef`、purple `#c678dd`、cyan `#56b6c2`)。
- `tokyo-night` —— https://github.com/enkia/tokyo-night-vscode-theme(bg `#1a1b26`、fg `#a9b1d6`、comment `#565f89`、blue `#7aa2f7`、cyan `#7dcfff`、green `#9ece6a`、orange `#ff9e64`、magenta `#bb9af7`、red `#f7768e`、yellow `#e0af68`)。
- `gruvbox-dark` —— https://github.com/morhetz/gruvbox(bg `#282828`、fg `#ebdbb2`、gray `#928374`、red `#fb4934`、green `#b8bb26`、yellow `#fabd2f`、blue `#83a598`、purple `#d3869b`、aqua `#8ec07c`、orange `#fe8019`)。
- `solarized-dark` —— Ethan Schoonover Solarized(base03 `#002b36`、base02 `#073642`、base01 `#586e75`、base0 `#839496`、base1 `#93a1a1`、yellow `#b58900`、orange `#cb4b16`、red `#dc322f`、magenta `#d33682`、violet `#6c71c4`、blue `#268bd2`、cyan `#2aa198`、green `#859900`)。bg=base03,fg=base0。
- `rose-pine` —— https://rosepinetheme.com/palette(base `#191724`、surface `#1f1d2e`、text `#e0def4`、muted `#6e6a86`、love `#eb6f92`、gold `#f6c177`、rose `#ebbcba`、pine `#31748f`、foam `#9ccfd8`、iris `#c4a7e7`)。

- [ ] **Step 3: 追加其余亮色主题**

- `catppuccin-latte` —— Catppuccin Latte(base `#eff1f5`、text `#4c4f69`、subtext0 `#6c6f85`、surface0 `#ccd0da`、overlay0 `#9ca0b0`、blue `#1e66f5`、lavender `#7287fd`、mauve `#8839ef`、green `#40a02b`、peach `#fe640b`、yellow `#df8e1d`、red `#d20f39`、teal `#179299`、pink `#ea76cb`)。
- `solarized-light` —— Solarized(bg=base3 `#fdf6e3`,fg=base00 `#657b83`,边框 base2 `#eee8d5`,其余 accent 同 solarized-dark 的 yellow/orange/red/blue/cyan/green/violet/magenta)。
- `gruvbox-light` —— Gruvbox light(bg `#fbf1c7`、fg `#3c3836`、gray `#7c6f64`、red `#9d0006`、green `#79740e`、yellow `#b57614`、blue `#076678`、purple `#8f3f71`、aqua `#427b58`、orange `#af3a03`)。
- `one-light` —— Atom One Light(bg `#fafafa`、fg `#383a42`、comment `#a0a1a7`、red `#e45649`、green `#50a14f`、yellow `#c18401`、blue `#4078f2`、purple `#a626a4`、cyan `#0184bc`)。
- `rose-pine-dawn` —— Rosé Pine Dawn(base `#faf4ed`、surface `#fffaf3`、text `#575279`、muted `#9893a5`、love `#b4637a`、gold `#ea9d34`、rose `#d7827e`、pine `#286983`、foam `#56949f`、iris `#907aa9`)。
- `ayu-light` —— Ayu Light(bg `#fafafa`、fg `#5c6166`、comment `#787b8099`→`#8a9199`、accent/orange `#fa8d3e`、tag/blue `#55b4d4`、keyword `#fa8d3e`、string/green `#86b300`、func `#f2ae49`、entity `#399ee6`、red `#f07171`、purple `#a37acc`)。映射:keyword→orange `#fa8d3e`,function→`#399ee6`,string→`#86b300`,number→`#a37acc`,class→`#55b4d4`。
- `tokyo-night-light` —— Tokyo Night Day/Light(bg `#e1e2e7`、fg `#3760bf`→正文用 `#343b58`、comment `#848cb5`、blue `#2e7de9`、cyan `#007197`、green `#587539`、orange `#b15c00`、magenta `#9854f1`、red `#f52a65`、yellow `#8c6c3e`)。fg=`#343b58`。

> 每个块都必须含配方表全部变量(同步测试会逐一检查 `--md-bg/--md-fg/--md-heading/--md-link/--md-pre-bg/--md-ui-bg/--hl-comment/--hl-keyword/--hl-string/--hl-function`)。亮色主题的 `--md-ui-bg` 用浅底 0.92 透明、`--md-ui-border` 用浅边框。

- [ ] **Step 4: 校验同步测试通过**

Run: `node test/markdown_themes_test.js`
Expected: `markdown_themes_test passed (18 themes)`。
若报某主题缺变量,补齐该变量。

- [ ] **Step 5: 提交**

```bash
git add resource/markdown/themes.css
git commit -m "Add light and dark palette themes for markdown preview"
```

---

## Task 4: 切换器 UI + 持久化(provider)

**Files:**
- Modify: `src/provider/markdownPreviewProvider.ts`

- [ ] **Step 1: 引入注册表**

在文件顶部 import 段(其它 import 之后)加:
```ts
import { MARKDOWN_THEMES, DEFAULT_THEME_ID } from './markdownThemes';
```

- [ ] **Step 2: 在 `resolveCustomEditor` 注册 `setTheme` 持久化**

在现有 `.on('developerTool', ...)` 之后(`.on('externalUpdate'...)` 之前)插入一条链式 `.on`:
```ts
        }).on('setTheme', (id: string) => {
            if (MARKDOWN_THEMES.some(t => t.id === id)) {
                this.context.globalState.update('markdownPreviewTheme', id);
            }
```
即把原来的:
```ts
        }).on('developerTool', () => {
            vscode.commands.executeCommand('workbench.action.toggleDevTools');
        }).on('externalUpdate', () => scheduleRender())
```
改为:
```ts
        }).on('developerTool', () => {
            vscode.commands.executeCommand('workbench.action.toggleDevTools');
        }).on('setTheme', (id: string) => {
            if (MARKDOWN_THEMES.some(t => t.id === id)) {
                this.context.globalState.update('markdownPreviewTheme', id);
            }
        }).on('externalUpdate', () => scheduleRender())
```

- [ ] **Step 3: 在 `buildHtml` 注入 `data-theme` 与切换器**

在 `buildHtml` 内、`const asset = ...` 附近加上主题解析:
```ts
        const savedTheme = this.context.globalState.get<string>('markdownPreviewTheme', DEFAULT_THEME_ID);
        const themeId = MARKDOWN_THEMES.some(t => t.id === savedTheme) ? savedTheme : DEFAULT_THEME_ID;
        const themesJson = JSON.stringify(MARKDOWN_THEMES);
```
把 `<html>` 起始标签从:
```ts
<html>
```
改为:
```ts
<html data-theme="${themeId}">
```
然后在返回模板里、现有 `</script>` 与 `${mermaidScript}` 之间,插入主题切换器脚本:
```ts
<script>
(function(){
  const THEMES = ${themesJson};
  const CURRENT = ${JSON.stringify(themeId)};
  const btn = document.createElement('div');
  btn.id = 'md-theme-btn'; btn.textContent = '🎨'; btn.title = '切换主题';
  const panel = document.createElement('div'); panel.id = 'md-theme-panel';
  const groups = [['light','亮色'],['dark','暗色']];
  function markActive(id){
    panel.querySelectorAll('.md-theme-item').forEach(function(el){
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
  }
  groups.forEach(function(g){
    const title = document.createElement('div');
    title.className = 'md-theme-group-title'; title.textContent = g[1]; panel.appendChild(title);
    THEMES.filter(function(t){ return t.group === g[0]; }).forEach(function(t){
      const item = document.createElement('div');
      item.className = 'md-theme-item'; item.textContent = t.name; item.setAttribute('data-id', t.id);
      item.addEventListener('click', function(){
        document.documentElement.setAttribute('data-theme', t.id);
        markActive(t.id);
        window.__mdPost && window.__mdPost('setTheme', t.id);
        panel.classList.remove('open');
      });
      panel.appendChild(item);
    });
  });
  btn.addEventListener('click', function(e){ e.stopPropagation(); panel.classList.toggle('open'); });
  panel.addEventListener('click', function(e){ e.stopPropagation(); });
  document.addEventListener('click', function(){ panel.classList.remove('open'); });
  document.body.appendChild(btn); document.body.appendChild(panel);
  markActive(CURRENT);
})();
</script>
```

- [ ] **Step 4: 让主脚本暴露 `__mdPost`(供切换器复用同一 vscode 句柄)**

`acquireVsCodeApi()` 每个 webview 只能调一次。在 `buildHtml` 现有的主内联脚本(开头 `const vscode = acquireVsCodeApi();`)里,该行之后加一行:
```js
  window.__mdPost = function(type, content){ vscode.postMessage({type:type, content:content}); };
```
（这样主题切换器脚本通过 `window.__mdPost('setTheme', id)` 发消息,不再二次调用 `acquireVsCodeApi`——一个 webview 只能调一次。）

- [ ] **Step 5: 校验**

Run: `npx tsc -p tsconfig.json --noEmit` → 无新增错误(涉及 `markdownPreviewProvider.ts`/`markdownThemes.ts`)。
Run: `node test/markdown_themes_test.js` → 通过。
Run: `node test/markdown_render_test.js` → 通过。

- [ ] **Step 6: 提交**

```bash
git add src/provider/markdownPreviewProvider.ts
git commit -m "Add theme switcher UI and persistence to markdown preview"
```

---

## Task 5: 收尾验证 + 构建 + 最终审查

**Files:** 无

- [ ] **Step 1: 全量自动化检查**

Run: `node test/markdown_render_test.js` → 通过。
Run: `node test/markdown_themes_test.js` → `markdown_themes_test passed (18 themes)`。
Run: `npx tsc -p tsconfig.json --noEmit` → 无新增错误。

- [ ] **Step 2: 真实构建(Git Bash)**

Run: `npm run build`
Expected: esbuild `build success` + Vite `built`,无错误。

- [ ] **Step 3: F5 手动回归**

- [ ] 右下角出现 🎨 圆钮;点开面板,亮/暗分组、18 个主题。
- [ ] 逐一点几个亮、几个暗主题 → 背景/正文/标题/链接/代码高亮/表格/引用整体变色,排版不变。
- [ ] 亮色主题下代码块 token 在浅底可读。
- [ ] 关掉再开另一个 `.md` → 记住上次主题;重启扩展宿主仍记住。
- [ ] 切换器在任意主题下都清晰可见。
- [ ] 导出 PDF/HTML 仍正常(不受主题影响)。

- [ ] **Step 4: 最终代码审查 + 收尾**

按 subagent-driven-development 末尾:派发最终代码审查(范围 = 本特性提交),然后用 finishing-a-development-branch 收尾。

---

## 自检结论(写计划时已核对 spec)

- **Spec 覆盖**:变量化(T1)、`:root` 兜底 Mocha(T1)、删 catppuccin-mocha.css(T1)、注册表单一事实源(T2)、同步+变量存在校验(T2 测试)、~18 主题含 Catppuccin 保留(T3)、右下角小圆钮+分组面板(T4)、`data-theme` 首屏注入无闪烁(T4 Step3)、全局 `globalState` 记忆(T4 Step2/3)、渲染器与导出不受影响(未触碰)——均有对应任务。
- **占位符**:无 TODO/TBD。配方表 + GitHub Light/Mocha 两套完整样板 + 各主题权威来源与基准色 + 同步测试,构成可执行的具体内容(色值由实现期 WebFetch 落实,测试兜底完整性)。
- **类型/命名一致**:`MARKDOWN_THEMES`/`DEFAULT_THEME_ID`/`MarkdownTheme`(T2)在 T4 一致引用;消息 `setTheme`、globalState 键 `markdownPreviewTheme`、`window.__mdPost`、`data-theme` 属性在 T4 各步一致;CSS 变量名在 preview.css(T1)、themes.css(T1/T3)、测试 required 列表(T2)三处一致。
- **已知取舍**:亮色主题色值需保证浅底可读(配方与样板已强调);mermaid/链接/滚动等既有行为不动。
