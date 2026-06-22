# Markdown Office Viewer

[简体中文](README.md) | English | [繁體中文](README-TW.md)

A VS Code file-preview extension built around the **Markdown reading experience**. It keeps the Office / PDF / image / archive previews of the original, but completely reworks Markdown preview into a lightweight, theme-rich, one-click-export reader.

> Forked from [cweijan/vscode-office](https://github.com/cweijan/vscode-office) (Office Viewer); the Markdown experience is rebuilt on top of its file-preview capabilities.

## Differences from the original Office Viewer

This extension inherits all of the original's file-preview features. The differences are mainly in **Markdown** and overall focus:

| Aspect | Original Office Viewer | Markdown Office Viewer (this project) |
|--------|------------------------|---------------------------------------|
| Markdown engine | Vditor WYSIWYG editor (upstream no longer maintained) | markdown-it read-only preview, reading-focused; editing returns to VS Code's native editor |
| Preview themes | None | **18 built-in** light/dark palettes (Catppuccin, GitHub, Dracula, Nord, Tokyo Night, Solarized, Gruvbox, …), switch from the bottom-right, remembered globally |
| Export | Title-bar PDF / DOCX / HTML only | Adds bottom-right **WYSIWYG** export: **PDF (single page, no pagination) / HTML / long image (PNG)**, matching the current theme |
| Auto-refresh | — | Preview **auto-refreshes** when the file changes externally, plus a 🔄 manual refresh button as a fallback |
| Zoom | — | `Ctrl/⌘ + wheel` and ➕/➖ buttons zoom the content; the current % flashes center-screen, click to reset, remembered globally |
| Icon & name | Office Viewer | New Catppuccin-style icon, renamed to Markdown Office Viewer |

> All non-Markdown previews (Office / PDF / images / fonts / archives …) are inherited from the original and behave essentially the same.

## Markdown

Opening a `.md` / `.markdown` file shows a read-only preview rendered with **markdown-it** (code highlighting, KaTeX math, Mermaid diagrams, tables). To edit, use VS Code's native text editor (right-click → *Open With… → Text Editor*, or `Ctrl Alt E` / `⌘ ^ E` to toggle).

Floating buttons in the bottom-right of the preview (right to left: refresh / zoom-in / zoom-out / export / theme):

- 🔄 **Refresh** — force a re-read and re-render of the current file; a fallback for when auto-refresh doesn't fire.
- ➕ / ➖ **Zoom** — zoom the content in/out (also `Ctrl/⌘ + wheel`); the current percentage flashes in the center (e.g. `120%`), click it to reset to 100%. Remembered globally.
- 📤 **Export** — export the preview **as you see it** to **PDF / HTML / long image (PNG)**, matching the current theme. PDF and PNG need a Chromium-based browser; set its path with `vscode-office.chromiumPath` if it isn't found automatically.
- 🎨 **Theme** — switch between 18 light/dark palettes; your choice is remembered globally.

Press `Ctrl/⌘ + F` to **find** within the preview: matches highlight as you type, `Enter` / `Shift + Enter` (or `F3` / `Shift + F3`) jump between results, `Aa` toggles case sensitivity, `Esc` closes.

The preview **auto-refreshes** after the file is changed externally (based on precise file watching that covers external editors and atomic saves). You can also export PDF / HTML / DOCX from the editor title-bar button.

## Supported file types

- Excel: `.xls`, `.xlsx`, `.xlsm`, `.csv`, `.ods`
- Word: `.docx`, `.dotx`
- PowerPoint: `.pptx`, `.pptm`
- PDF & eBook: `.pdf`, `.epub`
- HEIC/TIFF: `.heic`, `.heif`, `.tiff`
- Design: `.psd`, `.xmind`, `.icns`, `.svg`
- Font: `.ttf`, `.otf`, `.woff`, `.woff2`
- Markdown: `.md`, `.markdown`
- HTML: `.html`, `.htm`
- HTTP request: `.http`, `.rest`
- Windows Registry: `.reg`
- Java: `.class` (decompiler)
- Compressed files: `.zip`, `.jar`, `.vsix`, `.rar`, `.7z`, `.tar`, `.tar.gz`, `.tgz`, `.apk`

## Other features

- **HTML**: live preview while editing; press `Ctrl+Shift+V` to open the live view
- **Git History**: browse the commit graph, view file history, compare revisions, and run common Git operations from the Source Control view or file context menu
- **YAML**: document outline and anchor navigation (Go to Definition for alias references)
- **Icon theme**: a subset of [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) icons, plus Office Material Icon Theme and One Dark Modern color themes
- **Excel**: preview and save `.xlsx`, `.xls`, `.xlsm`, `.csv`, `.ods` (saving `.xlsx` may lose formatting; `.csv` does not support GBK-encoded Chinese)
- **HTTP**: send requests from `.http` / `.rest` files (integrated from [REST Client](https://github.com/Huachao/vscode-restclient) with local-request fixes); press `Ctrl+Enter` / `⌘ Enter` to send
- **Java**: decompile and view `.class` files

## Credits

Based on [cweijan/vscode-office](https://github.com/cweijan/vscode-office) — thanks to the original author, and to these open-source projects:

- PDF rendering: [mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX rendering: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX rendering: [pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX: [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs) (parsing), [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet) (rendering)
- EPUB: [futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD: [ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind: [mind-elixir](https://github.com/ssshooter/mind-elixir-core), [@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC conversion: [heic2any](https://github.com/alexcorvi/heic2any)
- Java decompiler: [JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP: [REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown: [markdown-it](https://github.com/markdown-it/markdown-it)
- Icon theme: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
