# Markdown 预览多主题切换(亮/暗分组)设计

- 日期：2026-06-19
- 状态：待用户复审
- 依赖：建立在已完成的"只读 Markdown 预览替换 Vditor"之上(`src/provider/markdownPreviewProvider.ts`、`resource/markdown/preview.css`)

## 1. 目标

在只读 Markdown 预览的**右下角**加一个主题切换器:亮、暗各 5–10 个内置主题,点选即时切换并全局记忆。首次默认沿用当前的 Catppuccin Mocha(暗)。

### 已确认决策
| 维度 | 选择 |
| --- | --- |
| 主题架构 | 调色板驱动:所有主题共用同一套排版,仅颜色(CSS 变量)不同 |
| 主题规模 | 暗 ~10 个、亮 ~8–10 个;保留当前 Catppuccin 作为其一 |
| 切换 UI | 右下角半透明小圆钮 → 弹出主题面板,按"亮色/暗色"分组列出,点选即切 |
| 默认 | Catppuccin Mocha(暗) |
| 记忆范围 | 全局(所有 .md 共用),存 `globalState` |
| 配色来源 | 联网抓取知名配色的权威色值(不靠猜) |

### 非目标(YAGNI)
- 不做自定义主题编辑、不导入用户 CSS。
- 主题不影响导出(导出仍走现有 `markdown-pdf.js` 样式)。
- 不为每个主题做独立排版/字体(仅颜色不同)。

## 2. 架构:调色板驱动

把现有 `preview.css` 的**结构**(排版、间距、边框宽度、代码块布局等)保留,所有**颜色**改为引用 CSS 变量。每个主题是一份 `[data-theme="<id>"]{ …变量赋值… }`。切换主题 = 改 `<html>` 的 `data-theme` 属性。

### 2.1 CSS 变量契约
文档变量(`preview.css` 引用):
```
--md-bg            页面背景
--md-fg            正文文字
--md-muted         次要文字(如引用)
--md-heading       标题色
--md-heading-border h1/h2 下划线
--md-link          链接色
--md-border        表格/分隔线边框
--md-code-fg       行内代码文字
--md-code-bg       行内代码背景
--md-pre-bg        代码块背景
--md-pre-border    代码块边框
--md-quote-fg      引用文字
--md-quote-bg      引用背景
--md-quote-border  引用左条
--md-table-head-bg 表头背景
--md-table-stripe  偶数行背景
--md-ui-bg         切换按钮/面板背景(半透明)
--md-ui-border     切换按钮/面板边框
```
代码高亮(hljs)token 变量:
```
--hl-comment --hl-keyword --hl-string --hl-number
--hl-function --hl-attr --hl-class --hl-meta --hl-regexp --hl-symbol
```
`preview.css` 把原 `catppuccin-mocha.css` 的 hljs 规则改写为引用这些 `--hl-*` 变量(随主题变色),原独立的 `catppuccin-mocha.css` 移除。

### 2.2 文件
- `resource/markdown/preview.css`:结构 + 变量引用(文档样式 + hljs token 样式 + 切换器 UI 样式)。
- `resource/markdown/themes.css`(新增):
  - `:root{…}` 给出**默认 = Catppuccin Mocha** 全套变量(作兜底,避免 FOUC)。
  - 每个主题一段 `[data-theme="<id>"]{…}` 覆盖。
- `src/provider/markdownThemes.ts`(新增):主题注册表,导出
  ```ts
  export interface MarkdownTheme { id: string; name: string; group: 'light' | 'dark'; }
  export const MARKDOWN_THEMES: MarkdownTheme[];
  export const DEFAULT_THEME_ID = 'catppuccin-mocha';
  ```
  `id` 必须与 `themes.css` 的 `[data-theme="id"]` 一一对应。

> 单一事实源:`markdownThemes.ts` 提供 id/名称/分组给 UI 与宿主;`themes.css` 提供对应色值。二者 id 必须一致(见 §6 自动校验)。

## 3. 主题清单(联网取真实色值)

暗色(~10):`catppuccin-mocha`(默认)、`catppuccin-macchiato`、`catppuccin-frappe`、`dracula`、`nord`、`one-dark`、`tokyo-night`、`gruvbox-dark`、`solarized-dark`、`rose-pine`。
亮色(~8–10):`github-light`、`catppuccin-latte`、`solarized-light`、`gruvbox-light`、`one-light`、`rose-pine-dawn`、`ayu-light`、`tokyo-night-light`。

来源(实现时 WebFetch 抓取权威色值):Catppuccin 官方调色板、Nord、Dracula、Solarized(Ethan Schoonover)、Gruvbox、Tokyo Night、One Dark/Light(Atom)、Rosé Pine、GitHub Primer、Ayu。每个主题需自洽地定义 §2.1 全部变量(尤其 `--md-bg/--md-fg/--hl-*`)。

## 4. 切换 UI(webview 内)

- **小圆钮**:`position: fixed; right:16px; bottom:16px;` 半透明(用 `--md-ui-bg/--md-ui-border`),显示一个主题/调色图标。`z-index` 高于内容,不随滚动。
- **面板**:点钮弹出,绝对定位于钮上方/左侧;内含两个分组标题"亮色 / 暗色",各列出该组主题名(来自注入的注册表)。当前主题高亮。点某项 → 立即 `document.documentElement.setAttribute('data-theme', id)` 并 `postMessage({type:'setTheme', content:id})`;点面板外或再次点钮收起。
- 面板与钮的样式随当前主题变量,保证任意主题下可读。

## 5. 数据流与持久化

1. 宿主 `buildHtml` 读取 `globalState.get('markdownPreviewTheme', DEFAULT_THEME_ID)`,校验在注册表内(否则回退默认),写入 `<html data-theme="<id>">`,首屏即正确(无闪烁)。
2. 宿主把注册表 `MARKDOWN_THEMES`(id/name/group)与当前 id 作为 JSON 注入内联脚本,供面板渲染。
3. webview 切换 → `postMessage({type:'setTheme', content:id})`。
4. 宿主 `handler.on('setTheme', id => globalState.update('markdownPreviewTheme', id))`(全局键,与文件无关)。
5. 因为是全局记忆且即时改 `data-theme`,无需重渲染 `webview.html`;其它已打开的预览下次刷新时生效。

## 6. 校验与边界

- **id 同步校验(自动化)**:新增 `test/markdown_themes_test.js`——解析 `resource/markdown/themes.css` 的所有 `[data-theme="x"]`,与 `markdownThemes.ts` 的注册表 id 集合比对,必须完全一致;并断言每个主题块都定义了 `--md-bg`、`--md-fg`、`--hl-keyword` 等关键变量(防止漏定义导致变量继承串色)。
- 默认/兜底:`globalState` 中存了未知 id → 回退 `DEFAULT_THEME_ID`;`themes.css` 的 `:root` 提供 Mocha 兜底,任何缺失变量都不会导致透明/不可读。
- 渲染器(`render.js`)与导出(`markdown-pdf.js`)**完全不受影响**。
- 现有 `markdownPreviewProvider.ts` 行为(链接/滚动/防抖刷新/mermaid)保持不变,仅在 `buildHtml` 增加 `data-theme` 注入、UI、`setTheme` 处理。

## 7. 受影响文件清单

**新增**
- `resource/markdown/themes.css`
- `src/provider/markdownThemes.ts`
- `test/markdown_themes_test.js`

**修改**
- `resource/markdown/preview.css`(颜色变量化 + 合入 hljs token 变量 + 切换器 UI 样式)
- `src/provider/markdownPreviewProvider.ts`（注入 `data-theme` + 注册表 JSON + 面板/按钮 HTML/JS + `setTheme` 持久化;`<link>` 去掉 `highlight/catppuccin-mocha.css`、加上 `themes.css`)

**删除**
- `resource/markdown/highlight/catppuccin-mocha.css`(其 token 颜色并入 Mocha 调色板 + 变量化 hljs 规则)

## 8. 手动验证(F5)
- 右下角出现小圆钮;点开面板,亮/暗分组、约 18 个主题。
- 点不同主题 → 背景/正文/标题/链接/代码高亮/表格/引用整体变色,排版不变。
- 切到亮色主题后代码块在浅底上可读(token 颜色对)。
- 关掉再开另一个 .md → 记住上次选择;重启扩展宿主仍记住。
- 切换器在任意主题下都清晰可见、可读。
