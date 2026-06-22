# Markdown Office Viewer

[简体中文](README.md) | [English](README-EN.md) | 繁體中文

一個以 **Markdown 閱讀體驗** 為核心的 VS Code 檔案預覽擴充功能。在保留 Office / PDF / 圖片 / 壓縮檔等多種檔案預覽能力的同時，把 Markdown 預覽徹底重做成一個輕量、主題豐富、可一鍵匯出的閱讀器。

> 本專案 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（Office Viewer），在其檔案預覽能力之上重做了 Markdown 體驗。

## 與原版 Office Viewer 的差異

本擴充功能繼承了原版的全部檔案預覽能力，差異主要集中在 **Markdown** 與整體定位上：

| 方面 | 原版 Office Viewer | Markdown Office Viewer（本專案） |
|------|-------------------|-------------------------------|
| Markdown 引擎 | Vditor 所見即所得編輯器（上游已停止維護） | markdown-it 唯讀預覽，專注閱讀；編輯交回 VS Code 原生編輯器 |
| 預覽主題 | 無 | 內建 **18 套**亮/暗主題（Catppuccin、GitHub、Dracula、Nord、Tokyo Night、Solarized、Gruvbox……），右下角一鍵切換、全域記憶 |
| 匯出 | 僅標題列 PDF / DOCX / HTML | 額外提供右下角**所見即所得**匯出：**PDF（單頁不分頁）/ HTML / 長圖（PNG）**，外觀還原目前主題 |
| 自動刷新 | — | 檔案被外部修改時預覽**自動刷新**，並提供 🔄 手動刷新按鈕兜底 |
| 縮放 | — | `Ctrl/⌘ + 滾輪` 與 ➕/➖ 按鈕縮放正文，中央顯示比例、點擊還原，全域記憶 |
| 圖示與名稱 | Office Viewer | 全新 Catppuccin 風格圖示，更名為 Markdown Office Viewer |

> 除 Markdown 外的 Office / PDF / 圖片 / 字型 / 壓縮檔等預覽功能均繼承自原版，行為基本一致。

## Markdown

開啟 `.md` / `.markdown` 會顯示由 **markdown-it** 渲染的唯讀預覽，支援程式碼高亮、KaTeX 數學公式、Mermaid 圖表、表格等。需要編輯時，請用 VS Code 原生文字編輯器（按右鍵 → *Open With… → Text Editor*，或 `Ctrl Alt E` / `⌘ ^ E` 切換）。

預覽右下角的懸浮按鈕（從右到左：刷新 / 放大 / 縮小 / 匯出 / 主題）：

- 🔄 **刷新** —— 強制重新讀取並渲染目前檔案，作為自動刷新失效時的兜底。
- ➕ / ➖ **縮放** —— 放大 / 縮小正文，也可用 `Ctrl/⌘ + 滾輪`；縮放時正文中央顯示目前比例（如 `120%`），點擊它可一鍵還原 100%，比例全域記憶。
- 📤 **匯出** —— 把預覽**所見即所得**匯出為 **PDF / HTML / 長圖（PNG）**，外觀與目前主題一致。PDF 與長圖需要 Chromium 核心瀏覽器，若未自動找到可用 `vscode-office.chromiumPath` 指定路徑。
- 🎨 **主題** —— 在 18 套亮/暗主題間切換，選擇會被全域記住。

按 `Ctrl/⌘ + F` 可在預覽內**查找**：輸入即時高亮全部匹配，`Enter` / `Shift + Enter`（或 `F3` / `Shift + F3`）在結果間跳轉，`Aa` 切換大小寫，`Esc` 關閉。

檔案在外部被修改後預覽會**自動刷新**（基於精確的檔案監聽，涵蓋外部編輯器與原子儲存）。此外也可透過編輯器標題列按鈕匯出 PDF / HTML / DOCX。

## 支援的檔案類型

以下檔案均可直接在 VS Code 中預覽：

- Excel: `.xls`、`.xlsx`、`.xlsm`、`.csv`、`.ods`
- Word: `.docx`、`.dotx`
- PowerPoint: `.pptx`、`.pptm`
- PDF 與電子書: `.pdf`、`.epub`
- HEIC/TIFF: `.heic`、`.heif`、`.tiff`
- 設計檔案: `.psd`、`.xmind`、`.icns`、`.svg`
- 字型: `.ttf`、`.otf`、`.woff`、`.woff2`
- Markdown: `.md`、`.markdown`
- HTML: `.html`、`.htm`
- HTTP 請求: `.http`、`.rest`
- Windows 登錄檔: `.reg`
- Java: `.class`（反編譯）
- 壓縮檔案: `.zip`、`.jar`、`.vsix`、`.rar`、`.7z`、`.tar`、`.tar.gz`、`.tgz`、`.apk`

## 其他功能

- **HTML**：編輯時按 `Ctrl+Shift+V` 即時預覽
- **Git 歷史**：在原始碼控制檢視或檔案右鍵選單中瀏覽提交圖、檢視檔案歷史、比較修訂並執行常用 Git 操作
- **YAML**：文件大綱與錨點導覽（別名引用可跳至定義）
- **圖示主題**：內建 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 部分圖示，並提供 Office Material Icon Theme 與 One Dark Modern 配色主題
- **Excel**：預覽並儲存 `.xlsx`、`.xls`、`.xlsm`、`.csv`、`.ods`（儲存 `.xlsx` 可能遺失格式；`.csv` 不支援 GBK 編碼中文）
- **HTTP**：在 `.http` / `.rest` 檔案中傳送請求（整合自 [REST Client](https://github.com/Huachao/vscode-restclient) 並修復了本機請求問題），按 `Ctrl+Enter` / `⌘ Enter` 傳送
- **Java**：反編譯並檢視 `.class` 檔案

## Credits

本專案基於 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)，感謝原作者；同時感謝以下開源專案：

- PDF 渲染：[mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX 渲染：[VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX 渲染：[pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX：[SheetJS/sheetjs](https://github.com/SheetJS/sheetjs)（解析）、[myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet)（渲染）
- EPUB：[futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD：[ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind：[mind-elixir](https://github.com/ssshooter/mind-elixir-core)、[@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC 轉換：[heic2any](https://github.com/alexcorvi/heic2any)
- Java 反編譯：[JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP：[REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown：[markdown-it](https://github.com/markdown-it/markdown-it)
- 圖示主題：[PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
