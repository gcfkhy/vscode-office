# Markdown 只读预览替换 Vditor — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把基于 Vditor 的所见即所得 Markdown 编辑器替换为一个轻量、只读、Catppuccin 暗色皮肤的预览,渲染复用仓库现有的 markdown-it 管线;编辑改走 VS Code 原生编辑器;保留 PDF/DOCX/HTML 导出;彻底移除 Vditor。

**Architecture:** 扩展宿主(Node)用共享的 markdown-it 渲染器把 Markdown 渲染成 HTML 片段,`MarkdownPreviewProvider`(`CustomReadonlyEditorProvider`)把片段组装成完整 HTML 文档(Catppuccin 变量 + `.md-body` 样式 + 暗色 highlight.js 主题 + KaTeX CSS + `<base href>` + 极小内联脚本)直接赋给 `webview.html`。数据单向流动;webview 仅回传 `openLink`/`scroll` 两类轻事件;文件变更时宿主重渲染。

**Tech Stack:** TypeScript / esbuild(扩展宿主)、markdown-it + 插件(checkbox/anchor/toc/katex/plantuml/mermaid)、highlight.js、KaTeX、VS Code Custom Editor API。

**关键事实(实现前必读):**
- 仓库无自动化测试框架。验证手段 = `npx tsc -p tsconfig.json --noEmit`(宿主类型检查,tsconfig 已 exclude `src/react`)+ `npm run lint:fix` + 一个独立 node 渲染器脚本 + 在扩展开发宿主(F5)手动验证。
- `npm run build` 脚本以 `rm -rf out` 开头(Unix 命令);Windows 下请用 Git Bash 跑 build,或用 `npm run dev`(esbuild watch)+ F5。
- webview ↔ 宿主消息线格式固定为 `{ type, content }`(见 `src/common/handler.ts`)。
- `Handler.bind(panel, uri)` 自动提供 `fileChange`、`externalUpdate`、`dispose` 事件。
- KaTeX 资源源头在 `vditor/src/js/katex/`(`katex.min.css` + `fonts/`)。
- Catppuccin Mocha 调色板(取自 `SimpleTerminal/frontend/src/style.css`,subtext1 按官方补 `#bac2de`):
  base `#1e1e2e` / mantle `#181825` / crust `#11111b` / surface0 `#313244` / surface1 `#45475a` / text `#cdd6f4` / subtext1 `#bac2de` / subtext0 `#a6adc8` / overlay0 `#6c7086` / blue `#89b4fa` / lavender `#b4befe` / red `#f38ba8`。

---

## 文件结构

**新增**
- `src/service/markdown/render.js` — 共享 markdown-it 渲染器(`createMarkdownIt`、`renderMarkdownToHtml`)。纯 Node、不依赖 `vscode`,可独立测试。
- `src/provider/markdownPreviewProvider.ts` — 只读预览 provider + HTML 组装。
- `resource/markdown/preview.css` — Catppuccin 变量 + `.md-body` 样式(移植自 SimpleTerminal,去掉 Vue `:deep()`)。
- `resource/markdown/highlight/catppuccin-mocha.css` — 暗色 highlight.js 主题。
- `resource/markdown/katex/` — 从 `vditor/src/js/katex/` 迁移的 `katex.min.css` + `fonts/`。
- `test/markdown_render_test.js` — 渲染器独立验证脚本。

**修改**
- `src/service/markdown/markdown-pdf.js` — 改用 `createMarkdownIt`;KaTeX 路径改向 `resource/markdown/katex`。
- `src/service/markdownService.ts` — 新增 `exportPick(uri?)`。
- `src/extension.ts` — provider 注册换成 `MarkdownPreviewProvider`;注册 `office.markdown.export`。
- `package.json` — `scripts`(去 vditor:build)、`customEditors` displayName、新增 export 命令与 `editor/title` 菜单。
- `CLAUDE.md` — Markdown 一节改写。

**删除**
- `vditor/`、`resource/vditor/`、`src/provider/markdownEditorProvider.ts`。

---

## Task 0: 基线与前置

**Files:** 无改动(仅环境)

- [ ] **Step 1: 确认在特性分支**

Run: `git branch --show-current`
Expected: `feature/markdown-preview-replace-vditor`

- [ ] **Step 2: 安装依赖**

Run: `yarn install`
Expected: 成功,生成 `node_modules`。

- [ ] **Step 3: 基线类型检查(记录现状)**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 通过(或记录既有报错,作为基线,避免误判为本次引入)。

---

## Task 1: 抽出共享 markdown-it 渲染器

**Files:**
- Create: `src/service/markdown/render.js`
- Create: `test/markdown_render_test.js`
- Modify: `src/service/markdown/markdown-pdf.js`(`convertMarkdownToHtml` 内的 md 构建)

- [ ] **Step 1: 写失败测试**

Create `test/markdown_render_test.js`:

```js
const assert = require("assert")
const { renderMarkdownToHtml } = require("../src/service/markdown/render")

const html = renderMarkdownToHtml("# Hello\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")

assert.ok(/<h1[^>]*>Hello<\/h1>/.test(html), "应渲染 h1 标题")
assert.ok(/class=['"]hljs['"]/.test(html), "代码块应带 hljs 类")
assert.ok(/<table>/.test(html), "应渲染表格")

// 渲染出错时退化为转义后的 <pre>
const fallback = renderMarkdownToHtml(null)
assert.strictEqual(typeof fallback, "string", "空输入应返回字符串而非抛错")

console.log("markdown_render_test passed")
```

- [ ] **Step 2: 运行,确认失败**

Run: `node test/markdown_render_test.js`
Expected: FAIL（`Cannot find module '../src/service/markdown/render'`)。

- [ ] **Step 3: 实现 `render.js`**

Create `src/service/markdown/render.js`:

```js
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `node test/markdown_render_test.js`
Expected: PASS（输出 `markdown_render_test passed`)。

- [ ] **Step 5: 重构 `markdown-pdf.js` 复用共享渲染器(DRY)**

在 `src/service/markdown/markdown-pdf.js` 顶部,删除这些重复的插件 require(它们已移入 render.js):

```js
const markdownIt = require("markdown-it")
const markdownItCheckbox = require("markdown-it-checkbox")
const markdownItKatex = require("./ext/markdown-it-katex")
const markdownItMermaid = require("./ext/markdown-it-mermaid").default;
const markdownItPlantuml = require("markdown-it-plantuml")
const markdownItToc = require("markdown-it-toc-done-right")
const markdownItAnchor = require("markdown-it-anchor")
```

替换为:

```js
const { createMarkdownIt } = require("./render")
```

然后在 `convertMarkdownToHtml` 内,把这段:

```js
      const breaks = config["breaks"]
      md = markdownIt({
        html: true,
        breaks,
        highlight: function (str, lang) {
          if (lang && hljs.getLanguage(lang)) {
            try {
              str = hljs.highlight(lang, str, true).value
            } catch (error) {
              str = md.utils.escapeHtml(str)

              showErrorMessage("markdown-it:highlight", error)
            }
          } else {
            str = md.utils.escapeHtml(str)
          }
          return "<pre class='hljs'><code><div>" + str + "</div></code></pre>"
        }
      })
```

替换为:

```js
      md = createMarkdownIt({ breaks: config["breaks"] })
```

并删除该 `try` 块里现在未使用的 `const hljs = require("highlight.js")` 一行。**保留**其后的 `md.renderer.rules.image` / `md.renderer.rules.html_block` 图片重写逻辑,以及结尾这段(删掉重复的 `.use(...)`,因为插件已在 `createMarkdownIt` 注册):

把:

```js
    md.use(markdownItCheckbox)
      .use(markdownItAnchor)
      .use(markdownItToc)
      .use(markdownItKatex)
      .use(markdownItPlantuml)
      .use(markdownItMermaid)

    return md.render(text)
```

替换为:

```js
    return md.render(text)
```

- [ ] **Step 6: 类型检查 + lint**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 与 Task 0 基线一致(无新增报错)。
Run: `npm run lint:fix`
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
git add src/service/markdown/render.js src/service/markdown/markdown-pdf.js test/markdown_render_test.js
git commit -m "Extract shared markdown-it renderer for reuse"
```

---

## Task 2: 迁移 KaTeX 资源,解锁删 Vditor

**Files:**
- Create: `resource/markdown/katex/katex.min.css` + `resource/markdown/katex/fonts/*`(从 `vditor/src/js/katex/` 复制)
- Modify: `src/service/markdown/markdown-pdf.js`(`readStyles` 的 `katexPath`)

- [ ] **Step 1: 复制 KaTeX CSS 与字体**

Run（Git Bash / WSL):
```bash
mkdir -p resource/markdown/katex/fonts
cp vditor/src/js/katex/katex.min.css resource/markdown/katex/katex.min.css
cp -r vditor/src/js/katex/fonts/. resource/markdown/katex/fonts/
```
PowerShell 等价:
```powershell
New-Item -ItemType Directory -Force resource/markdown/katex/fonts | Out-Null
Copy-Item vditor/src/js/katex/katex.min.css resource/markdown/katex/katex.min.css
Copy-Item vditor/src/js/katex/fonts/* resource/markdown/katex/fonts/ -Recurse
```
Expected: `resource/markdown/katex/katex.min.css` 存在,`resource/markdown/katex/fonts/` 下有 `KaTeX_*.woff2` 等。

- [ ] **Step 2: 校验 katex.min.css 内字体路径为相对 `fonts/`**

Run: `node -e "const c=require('fs').readFileSync('resource/markdown/katex/katex.min.css','utf8'); console.log(/url\(fonts\//.test(c))"`
Expected: `true`（字体以相对 `fonts/` 引用,迁移后布局保持一致,无需改 CSS）。

- [ ] **Step 3: 改 `markdown-pdf.js` 的 KaTeX 路径**

在 `readStyles()` 中,把:

```js
    const katexPath = path.resolve(__dirname, '..', "resource", 'vditor', 'dist', 'js', 'katex', 'katex.min.css');
```

替换为:

```js
    const katexPath = path.resolve(__dirname, '..', "resource", 'markdown', 'katex', 'katex.min.css');
```

- [ ] **Step 4: 提交**

```bash
git add resource/markdown/katex src/service/markdown/markdown-pdf.js
git commit -m "Relocate KaTeX assets out of vditor for markdown"
```

---

## Task 3: 预览样式资源(Catppuccin + 暗色高亮)

**Files:**
- Create: `resource/markdown/preview.css`
- Create: `resource/markdown/highlight/catppuccin-mocha.css`

- [ ] **Step 1: 写 `preview.css`(移植 SimpleTerminal `.md-body`,去掉 `:deep()`)**

Create `resource/markdown/preview.css`:

```css
:root {
  --ctp-base:#1e1e2e; --ctp-mantle:#181825; --ctp-crust:#11111b;
  --ctp-surface0:#313244; --ctp-surface1:#45475a;
  --ctp-text:#cdd6f4; --ctp-subtext1:#bac2de; --ctp-subtext0:#a6adc8;
  --ctp-overlay0:#6c7086; --ctp-blue:#89b4fa; --ctp-lavender:#b4befe;
  --ctp-red:#f38ba8;
}
html, body { margin:0; padding:0; background: var(--ctp-base); }
.md-body {
  padding: 16px 24px;
  font-family: 'MiSans','Segoe UI',sans-serif;
  font-size: 14px; line-height: 1.7; color: var(--ctp-text);
}
.md-render-error { color: var(--ctp-red); white-space: pre-wrap; }
.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6 {
  color: var(--ctp-lavender); margin: 1.2em 0 0.4em; font-weight: 600; line-height: 1.3;
}
.md-body h1 { font-size:1.6em; border-bottom:1px solid var(--ctp-surface0); padding-bottom:0.3em; }
.md-body h2 { font-size:1.3em; border-bottom:1px solid var(--ctp-surface0); padding-bottom:0.2em; }
.md-body h3 { font-size:1.1em; }
.md-body p { margin: 0.6em 0; }
.md-body ul,.md-body ol { padding-left:1.5em; margin:0.5em 0; }
.md-body li { margin:0.2em 0; }
.md-body a { color: var(--ctp-blue); text-decoration:none; }
.md-body a:hover { text-decoration:underline; }
.md-body code {
  font-family:'SF Mono',Consolas,'MiSans',monospace; font-size:0.88em; font-weight:500;
  background: var(--ctp-surface0); color: var(--ctp-red); padding:0.1em 0.4em; border-radius:4px;
}
.md-body pre {
  background: var(--ctp-mantle); border:1px solid var(--ctp-surface0); border-radius:6px;
  padding:12px; overflow-x:auto; margin:0.8em 0;
}
.md-body pre code {
  background:transparent; padding:0; font-size:13px; font-weight:500; color: var(--ctp-text);
  font-family:'SF Mono',Consolas,'MiSans',monospace;
}
.md-body blockquote {
  border-left:3px solid var(--ctp-overlay0); margin:0.8em 0; padding:0.3em 1em;
  color: var(--ctp-subtext0); background: var(--ctp-mantle); border-radius:0 4px 4px 0;
}
.md-body hr { border:none; border-top:1px solid var(--ctp-surface0); margin:1em 0; }
.md-body table { border-collapse:collapse; width:100%; margin:0.8em 0; font-size:13px; }
.md-body th,.md-body td { border:1px solid var(--ctp-surface0); padding:6px 10px; text-align:left; }
.md-body th { background: var(--ctp-surface0); color: var(--ctp-lavender); }
.md-body tr:nth-child(even) { background: var(--ctp-mantle); }
.md-body img { max-width:100%; border-radius:4px; }
```

- [ ] **Step 2: 写暗色 highlight.js 主题 `catppuccin-mocha.css`**

Create `resource/markdown/highlight/catppuccin-mocha.css`:

```css
/* highlight.js — Catppuccin Mocha (compact) */
.hljs { color:#cdd6f4; background:transparent; }
.hljs-comment,.hljs-quote { color:#6c7086; font-style:italic; }
.hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-name,.hljs-tag { color:#cba6f7; }
.hljs-string,.hljs-title.class_,.hljs-section,.hljs-attribute,.hljs-literal,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-addition { color:#a6e3a1; }
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-deletion { color:#fab387; }
.hljs-title,.hljs-title.function_,.hljs-function .hljs-title { color:#89b4fa; }
.hljs-attr,.hljs-variable,.hljs-params,.hljs-property { color:#f9e2af; }
.hljs-selector-id,.hljs-selector-class,.hljs-selector-attr,.hljs-selector-pseudo { color:#89dceb; }
.hljs-regexp { color:#f5c2e7; }
.hljs-doctag,.hljs-strong { font-weight:bold; }
.hljs-emphasis { font-style:italic; }
```

- [ ] **Step 3: 提交**

```bash
git add resource/markdown/preview.css resource/markdown/highlight
git commit -m "Add Catppuccin preview and dark highlight styles"
```

---

## Task 4: MarkdownPreviewProvider 与 HTML 组装

**Files:**
- Create: `src/provider/markdownPreviewProvider.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: 写 provider**

Create `src/provider/markdownPreviewProvider.ts`:

```ts
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { Util } from '../common/util';
import { Global } from '@/common/global';
import { getWorkspacePath } from '@/common/fileUtil';
import { TelemetryService } from '@/service/telemetryService';
import { fileTypeFromPath } from '@/service/officeViewType';
// 共享渲染器(CJS),不依赖 vscode
const { renderMarkdownToHtml } = require('@/service/markdown/render');

/**
 * 只读 Markdown 预览:宿主侧用 markdown-it 渲染,Catppuccin 暗色皮肤展示。
 */
export class MarkdownPreviewProvider implements vscode.CustomReadonlyEditorProvider {

    private extensionPath: string;

    constructor(private context: vscode.ExtensionContext) {
        this.extensionPath = context.extensionPath;
    }

    public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose: () => { } };
    }

    public resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
        const uri = document.uri;
        const webview = panel.webview;
        const folderPath = vscode.Uri.joinPath(uri, '..');
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(this.extensionPath), folderPath],
        };

        const handler = Handler.bind(panel, uri);
        TelemetryService.get()?.trackViewOpen('markdown', fileTypeFromPath(uri.fsPath));

        const render = () => { webview.html = this.buildHtml(webview, uri, folderPath); };
        render();

        handler.on('openLink', (link: string) => {
            const resReg = /https:\/\/file.*\.net/i;
            if (link && link.match(resReg)) {
                const localPath = link.replace(resReg, '');
                vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(localPath));
            } else if (link) {
                vscode.env.openExternal(vscode.Uri.parse(link));
            }
        }).on('scroll', ({ scrollTop }: { scrollTop: number }) => {
            this.context.globalState.update(`scrollTop_${uri.fsPath}`, scrollTop);
        }).on('developerTool', () => {
            vscode.commands.executeCommand('workbench.action.toggleDevTools');
        }).on('externalUpdate', () => render())
            .on('fileChange', () => render());
    }

    /** 优先读已打开的文本文档(反映原生编辑器未保存的改动),否则读磁盘。 */
    private readText(uri: vscode.Uri): string {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
        if (doc) return doc.getText();
        return readFileSync(uri.fsPath, 'utf8');
    }

    private buildHtml(webview: vscode.Webview, uri: vscode.Uri, folderPath: vscode.Uri): string {
        const body: string = renderMarkdownToHtml(this.readText(uri));
        const scrollTop = this.context.globalState.get(`scrollTop_${uri.fsPath}`, 0);

        const asset = (p: string) =>
            webview.asWebviewUri(vscode.Uri.file(`${this.extensionPath}/resource/markdown/${p}`)).toString();

        const basePath = Global.getConfig('workspacePathAsImageBasePath')
            ? vscode.Uri.file(getWorkspacePath(folderPath)) : folderPath;
        const baseUrl = webview.asWebviewUri(basePath).toString()
            .replace(/\?.+$/, '').replace('https://git', 'https://file');

        const hasMermaid = /class=["']mermaid["']/.test(body);
        const mermaidScript = hasMermaid
            ? `<script src="${asset('mermaid.min.js')}"></script><script>mermaid.initialize({startOnLoad:true});</script>`
            : '';

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="${baseUrl}/">
<link rel="stylesheet" href="${asset('katex/katex.min.css')}">
<link rel="stylesheet" href="${asset('highlight/catppuccin-mocha.css')}">
<link rel="stylesheet" href="${asset('preview.css')}">
</head>
<body>
<div class="md-body">${body}</div>
<script>
(function(){
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', function(e){
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && a.getAttribute('href')) { e.preventDefault(); vscode.postMessage({type:'openLink', content:a.href}); }
  });
  let t;
  window.addEventListener('scroll', function(){
    clearTimeout(t);
    t = setTimeout(function(){
      const top = (document.scrollingElement || document.documentElement).scrollTop;
      vscode.postMessage({type:'scroll', content:{scrollTop: top}});
    }, 200);
  });
  window.addEventListener('keydown', function(e){ if (e.key === 'F12') vscode.postMessage({type:'developerTool'}); });
  window.scrollTo(0, ${Number(scrollTop) || 0});
})();
</script>
${mermaidScript}
</body>
</html>`;
        return Util.buildPath(html, webview, `${this.extensionPath}/resource/markdown`);
    }
}
```

- [ ] **Step 2: 在 `extension.ts` 用新 provider 替换 Vditor provider**

在 `src/extension.ts` 中,把:

```ts
import { MarkdownEditorProvider } from './provider/markdownEditorProvider';
```

替换为:

```ts
import { MarkdownPreviewProvider } from './provider/markdownPreviewProvider';
```

把:

```ts
	const markdownEditorProvider = new MarkdownEditorProvider(context)
```

替换为:

```ts
	const markdownPreviewProvider = new MarkdownPreviewProvider(context)
```

把:

```ts
		vscode.window.registerCustomEditorProvider("cweijan.markdownViewer", markdownEditorProvider, viewOption),
		vscode.window.registerCustomEditorProvider("cweijan.markdownPreview", markdownEditorProvider, viewOption),
```

替换为:

```ts
		vscode.window.registerCustomEditorProvider("cweijan.markdownViewer", markdownPreviewProvider, viewOption),
		vscode.window.registerCustomEditorProvider("cweijan.markdownPreview", markdownPreviewProvider, viewOption),
```

- [ ] **Step 3: 类型检查 + lint**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无新增报错。
Run: `npm run lint:fix`
Expected: 无错误。

- [ ] **Step 4: 手动验证(F5)**

启动:`npm run dev`(另开终端),在 VS Code 按 F5 开扩展开发宿主。打开任意 `.md`。
Expected:
- 直接显示 Catppuccin 暗色渲染(非 Vditor)。
- 标题/列表/表格/引用/行内代码正常。
- 围栏代码块带颜色高亮(暗色)。
- `$x^2$` / `$$...$$` 数学公式正常显示(KaTeX 字体加载)。
- 相对路径图片显示正常。

- [ ] **Step 5: 提交**

```bash
git add src/provider/markdownPreviewProvider.ts src/extension.ts
git commit -m "Add read-only markdown preview provider"
```

---

## Task 5: 链接、滚动记忆与外部刷新(验证)

> 代码已在 Task 4 写入(`openLink`/`scroll`/`externalUpdate`/`fileChange` 处理)。本任务专做手动验证与回归。

**Files:** 无新增(仅验证;若发现缺陷在此修)

- [ ] **Step 1: 验证外链**

在预览里点一个 `http(s)` 外链。
Expected: 用系统浏览器打开,webview 不跳转。

- [ ] **Step 2: 验证滚动记忆**

滚到中部 → 切到别的标签 → 切回。
Expected: 滚动位置恢复。

- [ ] **Step 3: 验证原生编辑器联动刷新**

用 `Open With → 文本编辑器` 在一侧打开同一 `.md`,改几行。
Expected: 预览随 `externalUpdate` 实时刷新(读的是未保存的文档文本)。保存后仍正确。

- [ ] **Step 4: 提交(若有修复)**

```bash
git add -A
git commit -m "Verify markdown preview link and scroll behavior"
```
（若无改动可跳过提交。）

---

## Task 6: 保留导出(命令 + 标题栏)

**Files:**
- Modify: `src/service/markdownService.ts`(新增 `exportPick`)
- Modify: `src/extension.ts`(注册命令)
- Modify: `package.json`(命令 + `editor/title` 菜单)

- [ ] **Step 1: 给 `MarkdownService` 加 `exportPick`**

在 `src/service/markdownService.ts` 的 `MarkdownService` 类内(`exportMarkdown` 附近)新增:

```ts
    /** 从预览标题栏/命令面板触发:选择类型后导出当前 Markdown。 */
    public async exportPick(uri?: vscode.Uri) {
        if (!uri) uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
            vscode.window.showErrorMessage('No markdown file to export.');
            return;
        }
        const pick = await vscode.window.showQuickPick(['pdf', 'html', 'docx'], {
            placeHolder: 'Export markdown as',
        });
        if (!pick) return;
        await this.exportMarkdown(uri, { type: pick as ExportType });
    }
```

（`ExportType` 已在该文件顶部定义并导出,无需再引入。)

- [ ] **Step 2: 在 `extension.ts` 注册命令**

在 `src/extension.ts` 的 `context.subscriptions.push(` 列表里(与其他 `registerCommand` 并列)加入:

```ts
		vscode.commands.registerCommand('office.markdown.export', (uri) => { markdownService.exportPick(uri) }),
```

（`markdownService` 已在上方 `const markdownService = new MarkdownService(context);` 存在。)

- [ ] **Step 3: 在 `package.json` 加命令与菜单**

`contributes.commands` 数组追加:

```json
				{
					"command": "office.markdown.export",
					"title": "Export Markdown",
					"icon": "$(export)"
				}
```

`contributes.menus.editor/title` 数组追加(与已有 `office.markdown.switch` 同级):

```json
					{
						"command": "office.markdown.export",
						"when": "resourceExtname == '.md' || resourceExtname == '.markdown'",
						"group": "navigation@-1"
					}
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无新增报错。
Run: `npm run lint:fix`
Expected: 无错误。

- [ ] **Step 5: 手动验证(F5)**

打开 `.md` 预览 → 点标题栏 “Export Markdown” 图标 → 选 `html`。
Expected: 同目录生成 `<name>.html`,视觉与预览基本一致。再试 `pdf`(需 Chromium)。

- [ ] **Step 6: 提交**

```bash
git add src/service/markdownService.ts src/extension.ts package.json
git commit -m "Add markdown export command and title-bar action"
```

---

## Task 7: mermaid 离线渲染(增强,可独立验证)

**Files:**
- Modify: `build.ts`(复制 mermaid UMD 到 `resource/markdown/`)
- 产物: `resource/markdown/mermaid.min.js`(构建期生成,git 忽略大文件可不入库;或入库)

> Task 4 的 `buildHtml` 已在检测到 `.mermaid` 时引用 `resource/markdown/mermaid.min.js`。本任务确保该文件存在。离线方案避免 webview CSP 阻断 CDN 脚本。

- [ ] **Step 1: 确认 mermaid 的可用 UMD 产物**

Run: `node -e "const p=require('path'); for (const f of ['mermaid.min.js','mermaid.js']) { try { require.resolve('mermaid/dist/'+f); console.log('FOUND', f) } catch(e){ console.log('missing', f) } }"`
Expected: 打印某个 `FOUND <file>`。
- 若找到 UMD(`mermaid.min.js`)→ 用 Step 2a。
- 若仅有 ESM(无 UMD 命中)→ 用 Step 2b。

- [ ] **Step 2a: build.ts 复制 UMD(若 Step 1 找到 mermaid.min.js)**

在 `build.ts` 的 `plugins` 数组里追加一条 copy(与现有 7z-wasm/unrar copy 同样式):

```js
            copy({
                resolveFrom: 'out',
                assets: {
                    from: ['./node_modules/mermaid/dist/mermaid.min.js'],
                    to: ['../resource/markdown'],
                    keepStructure: false
                },
            }),
```

构建后 `resource/markdown/mermaid.min.js` 即就位。预览的 `<script src=".../mermaid.min.js">` + `mermaid.initialize` 生效。

- [ ] **Step 2b: 若仅 ESM(无 UMD)**

改 Task 4 `buildHtml` 的 `mermaidScript` 为 module 形式,并把 copy 源换成 ESM 文件名(`mermaid.esm.min.mjs` 等,以 Step 1 实际命中为准):

```ts
        const mermaidScript = hasMermaid
            ? `<script type="module">import mermaid from '${asset('mermaid.esm.min.mjs')}'; mermaid.initialize({startOnLoad:true});</script>`
            : '';
```

并在 `build.ts` copy 该 `.mjs`(及其可能的分包)到 `resource/markdown/`。

- [ ] **Step 3: 手动验证(F5)**

打开含 ```` ```mermaid ```` 围栏的 `.md`。
Expected: 图表正常渲染;不含 mermaid 的文档完全离线、无网络请求。

- [ ] **Step 4: 提交**

```bash
git add build.ts resource/markdown
git commit -m "Render mermaid diagrams offline in markdown preview"
```

> 若离线集成受阻,记录为已知限制并跳过本任务:不含 mermaid 的预览不受影响。

---

## Task 8: 彻底移除 Vditor

**Files:**
- Delete: `vditor/`、`resource/vditor/`、`src/provider/markdownEditorProvider.ts`
- Modify: `package.json`(scripts、customEditors displayName)
- Modify: `CLAUDE.md`

- [ ] **Step 1: 删除文件/目录**

```bash
git rm -r vditor resource/vditor src/provider/markdownEditorProvider.ts
```
Expected: 三者从索引移除。

- [ ] **Step 2: 清理 `package.json` scripts**

把:

```json
		"vditor:build": "cd vditor && npm run build",
		"dev": "npm run vditor:build && vite --mode=development",
		"lint:fix": "eslint src/**/*.ts --fix",
		"build": "rm -rf out && vite build --mode=production && npm run vditor:build",
```

替换为:

```json
		"dev": "vite --mode=development",
		"lint:fix": "eslint src/**/*.ts --fix",
		"build": "rm -rf out && vite build --mode=production",
```

- [ ] **Step 3: 更新 customEditors displayName**

把 `cweijan.markdownViewer` 的:

```json
					"displayName": "Markdown Editor",
```

改为:

```json
					"displayName": "Markdown Preview",
```

- [ ] **Step 4: 全局检索残留引用**

Run: `git grep -n -i "vditor" -- . ":(exclude)docs" ":(exclude)*.md"`
Expected: 仅剩无关紧要的引用;`src/` 下不应再有对 `markdownEditorProvider` 或 `resource/vditor` 的 import/读取。若有,清理之。

- [ ] **Step 5: 更新 `CLAUDE.md` 的 Markdown 段**

把 “How a custom editor renders” 中关于 markdown 的描述与 “Architecture: two separate bundles” 里 Vditor “第三世界” 的段落改写为:Markdown 现由 `markdownPreviewProvider.ts`(只读)处理,宿主侧用 `src/service/markdown/render.js` 的 markdown-it 渲染,套 Catppuccin 皮肤;Vditor 已移除。删除 `npm run vditor:build` 相关命令说明。

- [ ] **Step 6: 类型检查 + lint + 构建**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无报错。
Run: `npm run lint:fix`
Expected: 无错误。
Run（Git Bash):`npm run build`
Expected: 成功产出 `out/`,无 vditor 步骤。

- [ ] **Step 7: 手动冒烟(F5)**

Expected: `.md` 默认打开新预览;导出可用;其它查看器(excel/word/pdf 等)不受影响。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "Remove Vditor markdown editor"
```

---

## Task 9: 收尾验证

**Files:** 无

- [ ] **Step 1: 渲染器测试**

Run: `node test/markdown_render_test.js`
Expected: PASS。

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc -p tsconfig.json --noEmit` → 无报错。
Run: `npm run lint:fix` → 无错误。

- [ ] **Step 3: 打包冒烟(可选)**

Run（Git Bash):`npm run package`
Expected: 生成 `.vsix`,无 vditor 相关报错。

- [ ] **Step 4: 回归清单(F5 手动)**

- [ ] `.md` 默认 = Catppuccin 只读预览
- [ ] 代码高亮、KaTeX、相对图片、表格、引用 正常
- [ ] mermaid(若 Task 7 完成)正常
- [ ] 外链浏览器打开;滚动记忆;原生编辑联动刷新
- [ ] 标题栏/命令导出 PDF/HTML/DOCX 成功
- [ ] `office.markdown.switch` 预览↔原生切换正常
- [ ] 其它文件类型查看器无回归

- [ ] **Step 5: 最终提交(若有收尾改动)**

```bash
git add -A
git commit -m "Finalize markdown preview replacement"
```

---

## 自检结论(写计划时已核对 spec)

- **Spec 覆盖**:只读预览(T4)、markdown-it 复用(T1)、Catppuccin 样式(T3/T4)、KaTeX 迁移(T2)、导出保留(T6)、默认打开(T4 沿用 viewType)、彻底删 Vditor(T8)、mermaid(T7)、错误退化(T1 renderMarkdownToHtml)、链接/滚动(T4/T5)——均有对应任务。
- **占位符**:无 TODO/TBD;每个改代码的步骤均给出完整代码或精确替换。
- **类型/命名一致**:`createMarkdownIt`/`renderMarkdownToHtml`(T1)在 T4/markdown-pdf 一致引用;`exportPick`(T6)、`buildHtml`/`readText`(T4)命名前后一致;消息 `{type,content}` 与 `Handler` 协议一致。
- **已知取舍**:mermaid 离线产物名依安装版本而定(T7 Step1 先探测再二选一);Windows 下 `npm run build` 需 Git Bash。
