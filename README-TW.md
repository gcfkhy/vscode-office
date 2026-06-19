# Markdown Office Viewer

[English](README.md) | [简体中文](README-CN.md) | 繁體中文

## 介紹

本擴充功能支援在 VS Code 中預覽以下常見的辦公檔案格式：

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

## Markdown

開啟 `.md` / `.markdown` 檔案會顯示唯讀**預覽**（由 markdown-it 渲染：程式碼高亮、KaTeX 數學公式、Mermaid 圖、表格）。需要修改內容時請用 VS Code 原生文字編輯器（按右鍵 → *Open With… → 文字編輯器*，或 `Ctrl Alt E` / `⌘ ^ E` 切換）。

預覽右下角：

- 🎨 **主題** —— 在 18 套內建亮/暗主題間切換（Catppuccin、GitHub、Dracula、Nord、Tokyo Night、Solarized、Gruvbox……），選擇會被全域記住。
- 📤 **匯出** —— 把預覽**所見即所得**匯出為 **PDF**、**HTML** 或**長圖（PNG）**。PDF 與長圖需要 Chromium 核心瀏覽器，若未自動找到可透過 `vscode-office.chromiumPath` 設定路徑。

也可透過編輯器標題列的匯出按鈕（PDF / HTML / DOCX）。

## 其他功能

- HTML: 編輯時按下 `Ctrl+Shift+V` 可即時預覽
- Git 歷史: 在原始碼控制檢視或檔案右鍵選單中瀏覽提交圖、查看檔案歷史、對比修訂並執行常用 Git 操作
- YAML: 支援文件大綱與錨點導覽（別名引用可跳轉到定義）
- 圖示主題: 內建 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 部分圖示，並提供 **Office Material Icon Theme** 與 **One Dark Modern** 配色主題
- Excel: 支援預覽與儲存 `.xlsx`、`.xls`、`.xlsm`、`.csv`、`.ods` 等檔案（注意儲存 `.xlsx` 可能遺失格式；`.csv` 不支援 GBK 編碼的中文）
- HTTP: 在 `.http`、`.rest` 檔案中傳送請求（整合自 [REST Client](https://github.com/Huachao/vscode-restclient)，並修正了本地請求的已知問題）；按 `Ctrl+Enter` / `⌘ Enter` 傳送
- Java: 開啟 `.class` 檔案可反編譯並查看原始碼

## Sponsor

[![Database Client](https://database-client.com/text_logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

適用於 Visual Studio Code 的資料庫用戶端，支援 **MySQL/MariaDB、PostgreSQL、SQLite、Redis** 以及 **ElasticSearch** 等資料庫的管理，且可作為 SSH 用戶端，極大地提升您的生產力！[立刻安裝](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)。

## 使用資料（Usage Data）

Markdown Office Viewer 會收集**匿名使用資料**，用於了解各預覽功能的使用情況，以便改進擴充功能。資料透過官方模組 [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry) 傳送至 [Azure Application Insights](https://learn.microsoft.com/zh-tw/azure/azure-monitor/app/app-insights-overview)。

### 收集內容

| 事件 | 觸發時機 | 屬性 |
|------|---------|------|
| `view.open` | 開啟自訂預覽/編輯器 | `viewType`（如 `excel`、`markdown`、`pdf`）、`fileType`（僅副檔名，如 `xlsx`、`md`） |
| `gitHistory.view` | 開啟 Git 歷史檢視 | `mode`：`repo`（儲存庫歷史）或 `file`（單一檔案歷史） |

**不會**收集檔案路徑、檔名、URL、儲存庫名稱、請求內容或其他可識別個人身份的資訊。

### 如何關閉

僅在以下**兩項均允許**時才會上報：

1. VS Code 全域遙測已開啟（`telemetry.telemetryLevel` 不為 `off`，或舊版中 `telemetry.enableTelemetry` 為 `true`）。
2. 擴充功能遙測已開啟：在設定中將 `vscode-office.enableTelemetry` 設為 `false` 可單獨關閉本擴充功能的上報。

也可在 **設定 → 應用程式 → 遙測** 中關閉 VS Code 的全部遙測。

### 維護者設定

若自行建置並發佈本擴充功能，請參閱 [docs/telemetry.md](docs/telemetry.md) 設定 Azure Application Insights 及範例查詢。

## Credits

- PDF rendering: [mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX rendering: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX rendering: [pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX rendering:
  - [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs): XLSX parsing
  - [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet): XLSX rendering
- EPUB: [futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD: [ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind: [mind-elixir](https://github.com/ssshooter/mind-elixir-core), [@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC conversion: [heic2any](https://github.com/alexcorvi/heic2any)
- Java decompiler: [JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP: [REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
- Material Icon theme: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
