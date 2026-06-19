# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`vscode-office` (Marketplace name "Office Viewer") is a VS Code extension that previews and edits many file types in custom editors: Excel/Word/PowerPoint, PDF/EPUB, images (incl. HEIC/TIFF/PSD/ICNS/SVG), fonts, archives (zip/rar/7z/tar), Java `.class` (decompiler), Markdown (read-only preview, Catppuccin-themed, rendered via markdown-it), HTML preview, an HTTP/REST client, YAML navigation, and a Git History viewer.

## Commands

Package manager: **yarn is preferred** (per `.cursorrules`).

- `npm run dev` — Full dev loop. Runs the Vite dev server (webview, port **5739**) **and** esbuild in watch mode for the extension host. Then press **F5** in VS Code ("Extension" launch config, which runs the `dev` task) to open the Extension Development Host.
- `npm run build` — Production build: `rm -rf out`, `vite build --mode=production` (which also triggers a one-shot esbuild of the extension).
- `npm run lint:fix` — ESLint with autofix over `src/**/*.ts`.
- `npm run package` — Produce a `.vsix` (`vsce package --no-dependencies`).
- `npm run publish` — Publish to VS Code Marketplace + Open VSX.

> **Windows note:** the `build` script begins with `rm -rf out`, a Unix command. On Windows run it from a Unix-style shell (e.g. Git Bash) or it fails at the cleanup step.

There is **no automated test runner** configured. The `test/` directory holds standalone Node performance scripts (e.g. `node test/xlsx_performance_test.js`), not a unit-test suite.

Commit-message conventions (from `.cursorrules`): English, ≤ 70 characters.

## Architecture: two separate bundles

The single biggest thing to understand is that the code splits into **two independently-bundled worlds** with different module systems, build tools, and import conventions:

1. **Extension host (Node.js)** — everything in `src/` *except* `src/react`. Bundled by **esbuild** via `build.ts` into `out/extension.js` (CJS). Entry: `src/extension.ts`. Uses the **`@/*` path alias → `src/*`** (resolved from `tsconfig.json` paths; `tsconfig.json` *excludes* `src/react`). Heavy native/Node deps listed in `build.ts` `dependencies[]` are kept external and pre-bundled separately into `out/node_modules` (so puppeteer, pdf-lib, 7z-wasm, etc. load at runtime).

2. **Webview UI (browser, React 19)** — `src/react`. Bundled by **Vite** (`vite.config.ts`) into `out/webview`. Entry: `src/react/main.tsx`. Uses **relative imports only** (no `@/` alias here). Uses Ant Design + lazy-loaded per-viewer components.

`vite.config.ts` ties them together: when invoked with a `--mode` flag it `require('./build')`, so a single `vite`/`vite build` command also drives the esbuild extension build (watch in dev, one-shot in prod).

Vditor has been removed. Markdown now reuses the host-side markdown-it pipeline (shared by the export/PDF service and the preview provider) — there is no longer a separate third bundle.

## How a custom editor renders

Two provider patterns register against the `customEditors` declared in `package.json`:

- `src/provider/officeViewerProvider.ts` (`CustomReadonlyEditorProvider`) handles **all read-only viewers** — it registers itself for *all 8* read-only `viewType`s (see `bindCustomEditors`). `resolveCustomEditor` inspects the file suffix, picks a string `route` (e.g. `excel`, `word`, `ppt`, `zip`, `image`, `svg`, `epub`, `psd`, `xmind`, `font`), wires up data handlers, then calls `ReactApp.view(webview, { route })`. PDF and HTML are special-cased (they set `webview.html` directly from `resource/pdf/viewer.html` / the file itself rather than the React app). Java `.class` is also special: `handleClass` shells out to an **external `java` runtime** (must be on `PATH`) running the bundled `resource/java-decompiler.jar` (Fernflower), then opens the result through the `decompile_java` `TextDocumentContentProvider` (registered in `extension.ts`) — not the React app.
- `src/provider/markdownPreviewProvider.ts` (`CustomReadonlyEditorProvider`) is the **Markdown preview** provider. It renders a read-only preview by calling the shared host-side renderer `src/service/markdown/render.js` (markdown-it) and sets `webview.html` directly — the same special-case pattern used by PDF and HTML. Styles come from `resource/markdown/` (Catppuccin dark skin + KaTeX assets under `resource/markdown/katex/`).

`src/common/reactApp.ts` (`ReactApp.view`) is the bridge to the React UI: it loads `out/webview/index.html` (or proxies `http://127.0.0.1:5739` in dev), rewrites the `<base href>` to a webview URI, and injects a `{{configs}}` JSON blob (route, icon/sponsor base URLs, language, and the `vscode-office` config). `src/react/main.tsx` reads `configs.route` and switches to the matching lazy-loaded view component under `src/react/view/<name>/`.

## Extension ⇄ webview messaging

All communication uses a small event-bus abstraction on both sides:

- Host side: `src/common/handler.ts` — `Handler.bind(panel, uri)` wraps `webview.postMessage` / `onDidReceiveMessage` as `.on(event, cb)` / `.emit(event, content)`, and also auto-wires file-system watching (`fileChange`, `externalUpdate`, `dispose`).
- Webview side: `src/react/util/vscode.ts` exports a matching `handler` with the same `.on`/`.emit` API over `window.postMessage` / `acquireVsCodeApi`.

So a viewer is implemented as: provider calls a `handle<Type>(uri, handler)` function (see `src/provider/handlers/` and `src/provider/compress/`) that responds to events like `init` with file data; the React view emits `init` on mount and renders what comes back.

## Major feature areas (mostly self-contained)

- `src/provider/http/` — HTTP/REST client, integrated and adapted from vscode-restclient. Activated via `activateHttp`; registers language providers, code lenses, and request execution for `.http`/`.rest`.
- `src/gitHistory/` — Git History viewer, a full vertical slice: `service/` (git executor, repo discovery, commit/action services), `provider/` (webview panel + message router), with the React UI in `src/react/view/gitHistory/`. Activated via `activateGitHistory`; degrades gracefully if git isn't found.
- `src/provider/yaml/` — YAML outline + anchor/alias Go-to-Definition. Activated via `activateYaml`.
- `src/service/` — host-side services: `markdownService.ts` (export Markdown → PDF via puppeteer-core/Chromium, DOCX, HTML), `telemetryService.ts` (`@vscode/extension-telemetry`; gated by `vscode-office.enableTelemetry` + global telemetry), compress/archive helpers, icon resolution.

`src/extension.ts` `activate()` is the wiring map: it initializes telemetry, calls the `activate*` feature entrypoints, and registers the office viewer + markdown editor providers and the `office.*` commands.

## Settings & i18n

User settings live under the `vscode-office.*` namespace (defined in `package.json` `contributes.configuration`); read them via `Global.getConfig` / `vscode.workspace.getConfiguration('vscode-office')`. The Markdown editor and several viewers are localized; `vscode-office.editorLanguage` and `vscode.env.language` drive locale.
