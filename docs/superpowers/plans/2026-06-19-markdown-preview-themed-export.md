# Markdown 预览主题化导出(PDF/HTML/长图)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Markdown 预览右下角加一个 📤 导出钮(PDF/HTML/长图 PNG),导出外观还原当前预览主题;PDF 单页不分页(尺寸=实测内容宽×全高),长图为整页 PNG 截图;保存到 .md 同目录。现有标题栏导出不变。

**Architecture:** webview 的 📤 菜单点选后发 `exportPreview` 消息(格式)给宿主;宿主从 `globalState` 取当前主题,调 `MarkdownService.exportPreview(uri, fmt, themeId)`,后者复用现有 Chromium/puppeteer 逻辑并委托给新模块 `src/service/markdown/previewExport.js`。该模块用 `render.js` 渲染正文 + 内联 `preview.css`/`themes.css` + `file://` 资源构建一份"主题化 HTML",再用 puppeteer 出单页 PDF / 整页 PNG,或直接写 HTML。

**Tech Stack:** TypeScript/esbuild、puppeteer-core(外部预打包)、markdown-it(`render.js`)、VS Code Webview。

**关键事实(实现前必读):**
- 无 lint:fix(全量 `eslint --fix` 污染整树)。用 Write/Edit 改文件;Bash 跑 `git`/`node`/`npx tsc`。`npm run build` 在 Git Bash。
- webview↔宿主消息 `{type, content}`(`src/common/handler.ts`)。webview 已有 `window.__mdPost(type, content)`(主脚本里设)。
- `puppeteer-core` 在 `build.ts` 的 external `dependencies[]` 里,预打包到 `out/node_modules`;`markdown-pdf.js` 已 `require("puppeteer-core")`,新模块同样 `require` 即可。
- `previewExport.js` 写成 **CJS(`module.exports`)**,使其 `buildExportHtml` 可被 plain node 测试,且 TS 侧用 `require()` 引入(避免 tsc 对 .js 缺声明报错,与 `markdownPreviewProvider.ts` 引 `render.js` 同法)。
- `MarkdownService`(`src/service/markdownService.ts`)已有 `private getChromiumPath()`、`private getPuppeteerArgs()`、`constructor(private context)`、`import { Output } from "@/common/Output"`。
- 预览 provider 当前的内联脚本里:主脚本设了 `window.__mdPost`;之后有一段主题切换器 `<script>`(创建 🎨 钮 + 面板)。

---

## 文件结构

**新增**
- `src/service/markdown/previewExport.js` — `buildExportHtml`(纯函数,可测)+ `exportPreview`(puppeteer 出 PDF/PNG/HTML)。
- `test/markdown_export_test.js` — 测 `buildExportHtml`。

**修改**
- `src/service/markdownService.ts` — 新增 `exportPreview(uri, format, themeId)`。
- `resource/markdown/preview.css` — `#md-export-btn`/`#md-export-panel` 样式。
- `src/provider/markdownPreviewProvider.ts` — 导入 `MarkdownService`、加 `exportPreview` 消息处理、把主题切换器脚本换成"主题+导出"合并脚本。

**不动:** `markdown-pdf.js`、`html-export.js`、标题栏 `office.markdown.export`、`render.js`、`themes.css`、注册表。

---

## Task 1: previewExport.js + buildExportHtml 测试

**Files:**
- Create: `src/service/markdown/previewExport.js`
- Create: `test/markdown_export_test.js`

- [ ] **Step 1: 写失败测试 `test/markdown_export_test.js`**

```js
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
```

- [ ] **Step 2: 运行,确认失败(模块不存在)**

Run: `node test/markdown_export_test.js`
Expected: FAIL（`Cannot find module '../src/service/markdown/previewExport'`)。

- [ ] **Step 3: 实现 `src/service/markdown/previewExport.js`**

```js
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `node test/markdown_export_test.js`
Expected: PASS（`markdown_export_test passed`)。

- [ ] **Step 5: 提交**

```bash
git add src/service/markdown/previewExport.js test/markdown_export_test.js
git commit -m "Add themed preview export module (pdf/html/png)"
```

---

## Task 2: MarkdownService.exportPreview

**Files:**
- Modify: `src/service/markdownService.ts`

- [ ] **Step 1: 在文件顶部 require 新模块**

在 `src/service/markdownService.ts` 顶部 import 段之后(`import` 行下面)加:
```ts
// 主题化导出(CJS,require 避免 tsc 对 .js 缺声明报错)
const { exportPreview: exportPreviewImpl } = require('./markdown/previewExport');
```

- [ ] **Step 2: 在 `MarkdownService` 类内新增方法(放在 `exportPick` 附近)**

```ts
    /** 右下角主题化导出:format = 'pdf' | 'html' | 'png',themeId = 当前预览主题。 */
    public async exportPreview(uri: vscode.Uri, format: string, themeId: string) {
        if (!['pdf', 'html', 'png'].includes(format)) return;
        try {
            if (format !== 'html') {
                vscode.window.showInformationMessage(`Starting export preview to ${format}.`);
            }
            const out = await exportPreviewImpl({
                markdownFilePath: uri.fsPath,
                format,
                themeId,
                extensionPath: this.context.extensionPath,
                executablePath: format === 'html' ? undefined : this.getChromiumPath(),
                puppeteerArgs: this.getPuppeteerArgs(),
            });
            vscode.window.showInformationMessage(`Export preview to ${format} success: ${out}`);
        } catch (error) {
            Output.log(error);
            vscode.window.showErrorMessage(`Export preview failed: ${error.message || error}`);
        }
    }
```
（`getChromiumPath`/`getPuppeteerArgs` 是同类私有方法,可直接调;`getChromiumPath` 找不到浏览器时自身会弹错并 throw,被此处 catch。)

- [ ] **Step 3: 校验**

Run: `npx tsc -p tsconfig.json --noEmit` → 无新增错误命名 `markdownService.ts`(忽略既有基线,如该文件第 5 行 file-type 的预存错误)。
Run: `node test/markdown_export_test.js` → 仍 `markdown_export_test passed`。

- [ ] **Step 4: 提交**

```bash
git add src/service/markdownService.ts
git commit -m "Add MarkdownService.exportPreview wiring"
```

---

## Task 3: 导出按钮/面板样式

**Files:**
- Modify: `resource/markdown/preview.css`

- [ ] **Step 1: 在 `preview.css` 末尾(主题切换器样式之后)追加导出钮/面板样式**

```css
/* 右下角导出按钮(在主题钮左侧并排)*/
#md-export-btn {
  position: fixed; right:60px; bottom:16px; width:36px; height:36px; border-radius:50%;
  background: var(--md-ui-bg); border:1px solid var(--md-ui-border); color: var(--md-fg);
  display:flex; align-items:center; justify-content:center; font-size:16px; cursor:pointer;
  z-index:99999; opacity:0.8; user-select:none; -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);
}
#md-export-btn:hover { opacity:1; }
#md-export-panel {
  position: fixed; right:60px; bottom:60px; display:none;
  background: var(--md-ui-bg); border:1px solid var(--md-ui-border); border-radius:8px; padding:6px;
  z-index:99999; min-width:140px; box-shadow:0 6px 24px rgba(0,0,0,0.35);
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
}
#md-export-panel.open { display:block; }
```
（导出菜单项复用既有的 `.md-theme-item` 样式,无需新增。)

- [ ] **Step 2: 提交**

```bash
git add resource/markdown/preview.css
git commit -m "Add export button styles to markdown preview"
```

---

## Task 4: provider — 导出菜单 + 消息处理

**Files:**
- Modify: `src/provider/markdownPreviewProvider.ts`(整文件覆盖)

- [ ] **Step 1: 用以下完整内容覆盖 `src/provider/markdownPreviewProvider.ts`**

```ts
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { Global } from '@/common/global';
import { getWorkspacePath } from '@/common/fileUtil';
import { TelemetryService } from '@/service/telemetryService';
import { fileTypeFromPath } from '@/service/officeViewType';
import { MarkdownService } from '@/service/markdownService';
import { MARKDOWN_THEMES, DEFAULT_THEME_ID } from './markdownThemes';
// 共享渲染器(CJS),require 形式避免 tsc 对 .js 缺类型声明报错
const { renderMarkdownToHtml } = require('../service/markdown/render');

/**
 * 只读 Markdown 预览:宿主侧用 markdown-it 渲染,可切换的调色板皮肤展示,支持主题化导出。
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

        let lastText: string | undefined;
        let renderTimer: ReturnType<typeof setTimeout> | undefined;
        const render = () => {
            const text = this.readText(uri);
            if (text === lastText) return;          // 内容未变则跳过,避免无谓重载
            lastText = text;
            webview.html = this.buildHtml(webview, uri, folderPath, text);
        };
        const scheduleRender = () => {
            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(render, 250);  // 编辑联动:防抖,避免逐键全量重载
        };
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
        }).on('setTheme', (id: string) => {
            if (MARKDOWN_THEMES.some(t => t.id === id)) {
                this.context.globalState.update('markdownPreviewTheme', id);
            }
        }).on('exportPreview', (fmt: string) => {
            const themeId = this.context.globalState.get<string>('markdownPreviewTheme', DEFAULT_THEME_ID);
            new MarkdownService(this.context).exportPreview(uri, fmt, themeId);
        }).on('externalUpdate', () => scheduleRender())
            .on('fileChange', () => scheduleRender())
            .on('dispose', () => { if (renderTimer) clearTimeout(renderTimer); });
    }

    /** 优先读已打开的文本文档(反映原生编辑器未保存的改动),否则读磁盘。 */
    private readText(uri: vscode.Uri): string {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
        if (doc) return doc.getText();
        return readFileSync(uri.fsPath, 'utf8');
    }

    private buildHtml(webview: vscode.Webview, uri: vscode.Uri, folderPath: vscode.Uri, text: string): string {
        const body: string = renderMarkdownToHtml(text);
        const scrollTop = this.context.globalState.get(`scrollTop_${uri.fsPath}`, 0);

        const savedTheme = this.context.globalState.get<string>('markdownPreviewTheme', DEFAULT_THEME_ID);
        const themeId = MARKDOWN_THEMES.some(t => t.id === savedTheme) ? savedTheme : DEFAULT_THEME_ID;
        const themesJson = JSON.stringify(MARKDOWN_THEMES);

        const asset = (p: string) =>
            webview.asWebviewUri(vscode.Uri.file(`${this.extensionPath}/resource/markdown/${p}`)).toString();

        const basePath = Global.getConfig('workspacePathAsImageBasePath')
            ? vscode.Uri.file(getWorkspacePath(folderPath)) : folderPath;
        const baseUrl = webview.asWebviewUri(basePath).toString()
            .replace(/\?.+$/, '').replace('https://git', 'https://file');

        const hasMermaid = /class=["']mermaid["']/.test(body);
        const mermaidScript = hasMermaid
            ? `<script src="${asset('mermaid.min.js')}"></script><script>mermaid.initialize({startOnLoad:false});mermaid.run();</script>`
            : '';

        return `<!DOCTYPE html>
<html data-theme="${themeId}">
<head>
<meta charset="utf-8">
<base href="${baseUrl}/">
<link rel="stylesheet" href="${asset('katex/katex.min.css')}">
<link rel="stylesheet" href="${asset('themes.css')}">
<link rel="stylesheet" href="${asset('preview.css')}">
</head>
<body>
<div class="md-body">${body}</div>
<script>
(function(){
  const vscode = acquireVsCodeApi();
  window.__mdPost = function(type, content){ vscode.postMessage({type:type, content:content}); };
  document.addEventListener('click', function(e){
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.charAt(0) === '#') return;   // 同文档锚点/TOC,交给浏览器原生滚动
    e.preventDefault();
    vscode.postMessage({type:'openLink', content:a.href});
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
  var ST = ${Number(scrollTop) || 0};
  function restore(){ window.scrollTo(0, ST); }
  restore();
  window.addEventListener('load', restore);   // 图片/KaTeX 加载后再次校正
})();
</script>
<script>
(function(){
  const THEMES = ${themesJson};
  const CURRENT = ${JSON.stringify(themeId)};

  // 主题切换
  const themeBtn = document.createElement('div');
  themeBtn.id = 'md-theme-btn'; themeBtn.textContent = '🎨'; themeBtn.title = '切换主题';
  const themePanel = document.createElement('div'); themePanel.id = 'md-theme-panel';
  function markActive(id){
    themePanel.querySelectorAll('.md-theme-item').forEach(function(el){
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
  }
  [['light','亮色'],['dark','暗色']].forEach(function(g){
    const title = document.createElement('div');
    title.className = 'md-theme-group-title'; title.textContent = g[1]; themePanel.appendChild(title);
    THEMES.filter(function(t){ return t.group === g[0]; }).forEach(function(t){
      const item = document.createElement('div');
      item.className = 'md-theme-item'; item.textContent = t.name; item.setAttribute('data-id', t.id);
      item.addEventListener('click', function(){
        document.documentElement.setAttribute('data-theme', t.id);
        markActive(t.id);
        window.__mdPost && window.__mdPost('setTheme', t.id);
        themePanel.classList.remove('open');
      });
      themePanel.appendChild(item);
    });
  });

  // 导出菜单
  const exportBtn = document.createElement('div');
  exportBtn.id = 'md-export-btn'; exportBtn.textContent = '📤'; exportBtn.title = '导出';
  const exportPanel = document.createElement('div'); exportPanel.id = 'md-export-panel';
  [['pdf','PDF'],['html','HTML'],['png','长图 (PNG)']].forEach(function(f){
    const item = document.createElement('div');
    item.className = 'md-theme-item'; item.textContent = f[1];
    item.addEventListener('click', function(){
      window.__mdPost && window.__mdPost('exportPreview', f[0]);
      exportPanel.classList.remove('open');
    });
    exportPanel.appendChild(item);
  });

  themeBtn.addEventListener('click', function(e){ e.stopPropagation(); exportPanel.classList.remove('open'); themePanel.classList.toggle('open'); });
  exportBtn.addEventListener('click', function(e){ e.stopPropagation(); themePanel.classList.remove('open'); exportPanel.classList.toggle('open'); });
  themePanel.addEventListener('click', function(e){ e.stopPropagation(); });
  exportPanel.addEventListener('click', function(e){ e.stopPropagation(); });
  document.addEventListener('click', function(){ themePanel.classList.remove('open'); exportPanel.classList.remove('open'); });

  document.body.appendChild(themeBtn); document.body.appendChild(themePanel);
  document.body.appendChild(exportBtn); document.body.appendChild(exportPanel);
  markActive(CURRENT);
})();
</script>
${mermaidScript}
</body>
</html>`;
    }
}
```

- [ ] **Step 2: 校验**

Run: `npx tsc -p tsconfig.json --noEmit` → 无新增错误命名 `markdownPreviewProvider.ts`(忽略基线)。
Run: `node test/markdown_render_test.js` → `markdown_render_test passed`。
Run: `node test/markdown_themes_test.js` → `markdown_themes_test passed (18 themes)`。
Run: `node test/markdown_export_test.js` → `markdown_export_test passed`。
Run: `git status --short` → 仅 `M src/provider/markdownPreviewProvider.ts` + 预存未跟踪文件(`.claude/`、`CLAUDE.md`)。若有其它改动报告之。

- [ ] **Step 3: 提交**

```bash
git add src/provider/markdownPreviewProvider.ts
git commit -m "Add export menu to markdown preview"
```

---

## Task 5: 收尾验证 + 构建 + 审查

**Files:** 无

- [ ] **Step 1: 全量自动化检查**

Run: `node test/markdown_render_test.js` → 通过。
Run: `node test/markdown_themes_test.js` → `passed (18 themes)`。
Run: `node test/markdown_export_test.js` → `markdown_export_test passed`。
Run: `npx tsc -p tsconfig.json --noEmit` → 无新增错误。

- [ ] **Step 2: 真实构建(Git Bash)**

Run: `npm run build`
Expected: esbuild `build success` + Vite `built`,无错误。

- [ ] **Step 3: F5 手动回归**

- [ ] 右下角出现 📤(在 🎨 左侧);点开菜单:PDF / HTML / 长图 (PNG)。
- [ ] 切到某暗色主题 → 导出 PDF:单页不分页、暗色、边距合适、文本清晰;文件在 .md 同目录。
- [ ] 导出长图 PNG:一张长图,暗色,完整内容。
- [ ] 导出 HTML:本机打开样式与预览一致。
- [ ] 含代码/表格/数学/mermaid 的文档导出均正确。
- [ ] 主题切换、链接、滚动等既有行为不受影响;标题栏导出仍正常。
- [ ] 两个菜单互斥(开一个会关另一个),点空白处都收起。

- [ ] **Step 4: 最终代码审查 + 收尾**

派发最终代码审查(范围 = 本特性提交),然后用 finishing-a-development-branch 收尾。

---

## 自检结论(写计划时已核对 spec)

- **Spec 覆盖**:📤 钮+菜单(T3 样式 + T4 脚本)、`exportPreview` 消息(T4 handler)、主题化 HTML 构建(T1 buildExportHtml)、PDF 单页不分页(T1 exportPreview pdf 分支)、长图 PNG(T1 png 分支)、HTML 写出(T1 html 分支)、复用 Chromium/puppeteer(T2 调 getChromiumPath/getPuppeteerArgs)、保存到 .md 同目录 + 提示(T1 outPath + T2 message)、标题栏导出不动(未触碰)、超长文档已知限制(spec 标注)——均有对应任务。
- **占位符**:无 TODO/TBD;每个改代码步骤含完整代码。
- **类型/命名一致**:`buildExportHtml`/`exportPreview`(T1)在 T2 经 `exportPreviewImpl` 引用一致;`MarkdownService.exportPreview(uri, format, themeId)`(T2)在 T4 handler 调用一致;消息 `exportPreview` + 格式 `'pdf'|'html'|'png'`、`window.__mdPost` 在 T4 各处一致;CSS `#md-export-btn`/`#md-export-panel`(T3)与脚本里创建的元素 id(T4)一致,菜单项复用 `.md-theme-item`。
- **已知取舍**:`buildExportHtml` 可单测;puppeteer 出图路径靠 F5 手动验证(与现有 `markdown-pdf.js` 无单测一致)。
