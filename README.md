# Markdown Office Viewer

简体中文 | [English](README-EN.md) | [繁體中文](README-TW.md)

一个以 **Markdown 阅读体验** 为核心的 VS Code 文件预览扩展。在保留 Office / PDF / 图片 / 压缩包等多种文件预览能力的同时，把 Markdown 预览彻底重做成了一个轻量、主题丰富、可一键导出的阅读器。

> 本项目 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（Office Viewer），在其文件预览能力之上重做了 Markdown 体验。

## 与原版 Office Viewer 的区别

本扩展继承了原版的全部文件预览能力，差异主要集中在 **Markdown** 和整体定位上：

| 方面 | 原版 Office Viewer | Markdown Office Viewer（本项目） |
|------|-------------------|-------------------------------|
| Markdown 引擎 | Vditor 所见即所得编辑器（上游已停止维护） | markdown-it 只读预览，专注阅读；编辑交回 VS Code 原生编辑器 |
| 预览主题 | 无 | 内置 **18 套**亮/暗主题（Catppuccin、GitHub、Dracula、Nord、Tokyo Night、Solarized、Gruvbox……），右下角一键切换、全局记忆 |
| 导出 | 仅标题栏 PDF / DOCX / HTML | 额外提供右下角**所见即所得**导出：**PDF（单页不分页）/ HTML / 长图（PNG）**，外观还原当前主题 |
| 自动刷新 | — | 文件被外部修改时预览**自动刷新**，并提供 🔄 手动刷新按钮兜底 |
| 缩放 | — | `Ctrl/⌘ + 滚轮` 与 ➕/➖ 按钮缩放正文，中央显示比例、点击还原，全局记忆 |
| 图标与名称 | Office Viewer | 全新 Catppuccin 风格图标，更名为 Markdown Office Viewer |

> 除 Markdown 外的 Office / PDF / 图片 / 字体 / 压缩包等预览功能均继承自原版，行为基本一致。

## Markdown

打开 `.md` / `.markdown` 会显示由 **markdown-it** 渲染的只读预览，支持代码高亮、KaTeX 数学公式、Mermaid 图表、表格等。需要编辑时，请用 VS Code 原生文本编辑器（右键 → *Open With… → Text Editor*，或 `Ctrl Alt E` / `⌘ ^ E` 切换）。

预览右下角的悬浮按钮（从右到左：刷新 / 放大 / 缩小 / 导出 / 主题）：

- 🔄 **刷新** —— 强制重新读取并渲染当前文件，作为自动刷新失效时的兜底。
- ➕ / ➖ **缩放** —— 放大 / 缩小正文，也可用 `Ctrl/⌘ + 滚轮`；缩放时正文中央显示当前比例（如 `120%`），点击它可一键还原 100%，比例全局记忆。
- 📤 **导出** —— 把预览**所见即所得**导出为 **PDF / HTML / 长图（PNG）**，外观与当前主题一致。PDF 与长图需要 Chromium 内核浏览器，若未自动找到可用 `vscode-office.chromiumPath` 指定路径。
- 🎨 **主题** —— 在 18 套亮/暗主题间切换，选择会被全局记住。

文件在外部被修改后预览会**自动刷新**（基于精确的文件监听，覆盖外部编辑器与原子保存）。此外也可通过编辑器标题栏按钮导出 PDF / HTML / DOCX。

## 支持的文件类型

以下文件均可直接在 VS Code 中预览：

- Excel: `.xls`、`.xlsx`、`.xlsm`、`.csv`、`.ods`
- Word: `.docx`、`.dotx`
- PowerPoint: `.pptx`、`.pptm`
- PDF 与电子书: `.pdf`、`.epub`
- HEIC/TIFF: `.heic`、`.heif`、`.tiff`
- 设计文件: `.psd`、`.xmind`、`.icns`、`.svg`
- 字体: `.ttf`、`.otf`、`.woff`、`.woff2`
- Markdown: `.md`、`.markdown`
- HTML: `.html`、`.htm`
- HTTP 请求: `.http`、`.rest`
- Windows 注册表: `.reg`
- Java: `.class`（反编译）
- 压缩文件: `.zip`、`.jar`、`.vsix`、`.rar`、`.7z`、`.tar`、`.tar.gz`、`.tgz`、`.apk`

## 其他功能

- **HTML**：编辑时按 `Ctrl+Shift+V` 实时预览
- **Git 历史**：在源代码管理视图或文件右键菜单中浏览提交图、查看文件历史、对比修订并执行常用 Git 操作
- **YAML**：文档大纲与锚点导航（别名引用可跳转到定义）
- **图标主题**：内置 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 部分图标，并提供 Office Material Icon Theme 与 One Dark Modern 配色主题
- **Excel**：预览并保存 `.xlsx`、`.xls`、`.xlsm`、`.csv`、`.ods`（保存 `.xlsx` 可能丢失格式；`.csv` 不支持 GBK 编码中文）
- **HTTP**：在 `.http` / `.rest` 文件中发送请求（集成自 [REST Client](https://github.com/Huachao/vscode-restclient) 并修复了本地请求问题），按 `Ctrl+Enter` / `⌘ Enter` 发送
- **Java**：反编译并查看 `.class` 文件

## Credits

本项目基于 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)，感谢原作者；同时感谢以下开源项目：

- PDF 渲染：[mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX 渲染：[VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX 渲染：[pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX：[SheetJS/sheetjs](https://github.com/SheetJS/sheetjs)（解析）、[myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet)（渲染）
- EPUB：[futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD：[ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind：[mind-elixir](https://github.com/ssshooter/mind-elixir-core)、[@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC 转换：[heic2any](https://github.com/alexcorvi/heic2any)
- Java 反编译：[JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP：[REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown：[markdown-it](https://github.com/markdown-it/markdown-it)
- 图标主题：[PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
