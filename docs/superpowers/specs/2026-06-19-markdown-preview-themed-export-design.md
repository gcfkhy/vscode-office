# Markdown 预览右下角"主题化导出"(PDF / HTML / 长图)设计

- 日期：2026-06-19
- 状态：待用户复审
- 依赖：建立在已完成的只读 Markdown 预览 + 主题切换之上(`src/provider/markdownPreviewProvider.ts`、`resource/markdown/preview.css`、`themes.css`、`src/service/markdownService.ts`、`src/service/markdown/render.js`)

## 1. 目标

在预览右下角(🎨 主题钮旁)加一个 📤 导出钮,菜单含 **PDF / HTML / 长图(PNG)**,导出外观**还原当前预览主题**(所见即所得),PDF **不分页**(单页连续、自适应宽度、保留页边距,效果与长图一致)。现有标题栏导出(PDF/HTML/DOCX,浅色)**保留不变**。

### 已确认决策
| 维度 | 选择 |
| --- | --- |
| 导出外观 | 还原当前预览主题(同 `preview.css`+`themes.css`+当前 `data-theme`) |
| 长图格式 | PNG |
| 标题栏导出 | 保留,与右下角并存 |
| 保存方式 | 写到 `.md` 同目录(`<name>.pdf/.html/.png`),完成弹提示 |
| PDF 尺寸 | 自适应 100% 宽度、保留页边距、不分页(页面 = 实测内容宽×全高,单页;边距用 `.md-body` 内边距) |

### 非目标(YAGNI)
- 不改现有标题栏导出管线(`markdown-pdf.js`/`html-export.js`)。
- 不做"另存为"对话框、不加新配置项。
- HTML 导出不追求跨机器完全自包含(math/mermaid/本地图片引用本机 `file://`)。

## 2. 架构

```
预览右下角 📤 → 菜单(PDF/HTML/长图)
   │ 点选 → postMessage({type:'exportPreview', content: 'pdf'|'html'|'png'})
   ▼
markdownPreviewProvider: handler.on('exportPreview', fmt =>
   markdownService.exportPreview(uri, fmt, 当前themeId))     ← 宿主从 globalState 取当前主题
   ▼
MarkdownService.exportPreview(uri, fmt, themeId)
   - 复用其 getChromiumPath()/getPuppeteerArgs()
   - 调 previewExport.js 完成构建 HTML + 出图/PDF/HTML
   ▼
src/service/markdown/previewExport.js
   buildExportHtml(text, themeId, mdPath, extensionPath) → 主题化 HTML(file:// 资源)
   - html: 写 <name>.html
   - pdf : puppeteer 单页 → 写 <name>.pdf
   - png : puppeteer fullPage 截图 → 写 <name>.png
```

数据单向:webview 仅发 `exportPreview` + 格式;主题由宿主提供。`previewExport.js` 独立于现有导出管线,二者互不影响。

## 3. 组件设计

### 3.1 webview UI(`markdownPreviewProvider.ts` 内联脚本)
- 新增 `#md-export-btn`(📤),`position:fixed; right:60px; bottom:16px;`(在 🎨 左侧并排),样式复用主题钮的 `--md-ui-*`(随主题)。
- 点击弹出 `#md-export-panel`(仿主题面板),列出三项:`PDF`、`HTML`、`长图 (PNG)`。点某项 → `window.__mdPost('exportPreview', fmt)`,收起菜单;点外部/再点钮收起。
- `fmt` 取值 `'pdf' | 'html' | 'png'`。
- CSS 复用 `preview.css` 既有的 `#md-theme-panel`/`.md-theme-item` 风格(新增等价的 `#md-export-panel`/`.md-export-item` 选择器,或共用类名)。

### 3.2 宿主消息处理(`markdownPreviewProvider.ts`)
在 `resolveCustomEditor` 的 handler 链加:
```ts
.on('exportPreview', (fmt: string) => {
    const themeId = this.context.globalState.get<string>('markdownPreviewTheme', DEFAULT_THEME_ID);
    new MarkdownService(this.context).exportPreview(uri, fmt, themeId);
})
```
(`MarkdownService` 已被该 provider 以外的地方使用;这里新建实例或注入皆可,实现期定。)

### 3.3 `MarkdownService.exportPreview(uri, fmt, themeId)`
- 校验 `fmt ∈ {pdf, html, png}`、`themeId` 在注册表内(否则回退默认)。
- `pdf`/`png` 需 Chromium:复用现有 `getChromiumPath()`(找不到则报错并中止)、`getPuppeteerArgs()`。`html` 无需 Chromium。
- 调 `previewExport.js` 的 `exportPreview({ markdownFilePath, format, themeId, extensionPath, executablePath, puppeteerArgs })`。
- 成功后 `showInformationMessage`;失败 `Output.log` + 错误提示。

### 3.4 `src/service/markdown/previewExport.js`(新增,CJS,仿 `markdown-pdf.js` 风格)

**`buildExportHtml(text, themeId, mdPath, extensionPath)` → string**
- `renderMarkdownToHtml(text)`(复用 `render.js`)得正文。
- **内联** `preview.css` + `themes.css`(两者仅用 CSS 变量、无 `url()`,内联即自包含)。
- KaTeX 用 `<link href="file://<ext>/resource/markdown/katex/katex.min.css">`(其 `url(fonts/..)` 相对自身解析,字体正常)。
- `<html data-theme="<themeId>">`;`<base href="file://<mdDir>/">` 让相对图片以 `file://` 解析。
- 含 `class="mermaid"` 时注入 `<script src="file://<ext>/resource/markdown/mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:false});mermaid.run();</script>`。

**导出分支:**
- **html**:把上面 HTML 写入 `<mdDir>/<name>.html`。
- **pdf / png**:把 HTML 写临时文件到 `<mdDir>/<name>_export_tmp.html`(同目录便于相对资源解析),`puppeteer-core` 启动(`args:["--allow-file-access-from-files", ...puppeteerArgs]`,`executablePath`),`page.setViewport({width: 980, height: 1200, deviceScaleFactor: 2})`,`page.goto('file://tmp', {waitUntil:'networkidle0', timeout:60000})`。
  - 若有 mermaid:`await page.waitForSelector('.mermaid svg', {timeout:5000}).catch(()=>{})`(渲染完成或超时继续)。
  - **png**:`await page.screenshot({ path: <name>.png, fullPage: true, type:'png' })`。
  - **pdf(不分页)**:测量
    ```js
    const { w, h } = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight
    }));
    await page.pdf({ path: <name>.pdf, printBackground: true,
      width: `${w}px`, height: `${h}px`, pageRanges: '1',
      margin: { top:'0', right:'0', bottom:'0', left:'0' } });
    ```
    页面尺寸 = 实测内容宽×全高 → 单页连续、不分页;页边距由 `.md-body` 自带内边距充当(自适应 100% 宽、保留边距、与长图一致)。
  - 关浏览器,删临时文件。

> `deviceScaleFactor:2` 让 PNG/PDF 文本清晰。`width:980` 为渲染视口宽(内容 100% 填充,无窄栏);实测 `scrollWidth` 即此宽度,故 PDF 宽=长图宽。

## 4. 错误处理与边界
- `pdf`/`png` 找不到 Chromium → 复用现有错误提示并中止;`html` 不受影响。
- `page.goto`/`pdf`/`screenshot` 异常 → `Output.log` + `showErrorMessage`,删除临时文件。
- **超长文档**:Chromium 单页 PDF 高度与 PNG 画布高度有上限(约 1.6 万–3 万像素),极长文档可能被截断/失败 → 文档标注为已知限制,不阻塞常规使用。
- KaTeX 在 `render.js` 阶段已生成 HTML,仅需 CSS+字体;mermaid 需等待客户端渲染(已加等待)。

## 5. 受影响文件清单
**新增**
- `src/service/markdown/previewExport.js`

**修改**
- `src/provider/markdownPreviewProvider.ts`:📤 按钮+菜单(内联脚本)、`exportPreview` 消息处理。
- `src/service/markdownService.ts`:新增 `exportPreview(uri, fmt, themeId)`。
- `resource/markdown/preview.css`:新增 `#md-export-btn`/`#md-export-panel`/`.md-export-item` 样式(与主题钮同风格)。

**不动**
- `markdown-pdf.js`、`html-export.js`、标题栏 `office.markdown.export`、`render.js`、`themes.css`、注册表。

## 6. 验证
- 自动化:无新单测(纯导出+UI);`node test/markdown_render_test.js`、`node test/markdown_themes_test.js` 仍通过;`npx tsc --noEmit` 无新错;`npm run build` 通过。
- 手动(F5):
  - 右下角出现 📤,菜单 PDF/HTML/长图。
  - 切到某暗色主题 → 导出 PDF:单页、不分页、暗色、边距合适、文本清晰。
  - 导出长图 PNG:一张长图,暗色,完整内容。
  - 导出 HTML:本机打开样式与预览一致。
  - 含代码/表格/数学/mermaid 的文档导出均正确(math 显示、mermaid 出图)。
  - 标题栏导出仍照常工作(浅色 PDF/HTML/DOCX)。
