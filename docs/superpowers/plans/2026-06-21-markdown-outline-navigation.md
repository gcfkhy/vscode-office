# Markdown 预览大纲导航 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在只读 Markdown 预览中加入类似 Word 的左侧大纲导航，支持「推送/浮层」两种可切换模式、滚动高亮、折叠、拖拽调宽，状态可记忆。

**Architecture:** 沿用现有「`buildHtml` 注入原生 JS + `preview.css` CSS 变量」的预览套路（不引入 React、不动渲染管线）。大纲行为抽成独立资源脚本 `resource/markdown/outline.js`，浏览器侧扫描已渲染 `h1–h6`（`markdown-it-anchor` 已为标题加了 `id`）构建嵌套树并渲染面板；初始状态（开关/模式/宽度）由宿主侧从 `globalState` 读出，写进 `<html>` 属性与 `--md-outline-w` CSS 变量，交互后经 `postMessage` 回存。推送模式把 `padding-left` 加在**未缩放的 `<body>`** 上，保证与 `zoom` 后的正文边界对齐。

**Tech Stack:** TypeScript（扩展宿主）、原生浏览器 JS（webview，UMD 包裹以便 Node 单测纯函数）、CSS 变量、markdown-it（已有）、VS Code `globalState`。

**Testing approach:** 本项目无自动化测试框架。唯一的纯逻辑 `buildOutlineTree`（标题列表→嵌套树，含跳级处理）用独立 Node 脚本做 TDD（`node test/outline_tree_test.js`，与现有 `test/` 脚本风格一致）。DOM/视觉/持久化部分以 `npm run build`、`npm run lint:fix`、Extension Development Host（F5）手动核对为验证手段。

---

## 文件结构

- **Create** `resource/markdown/outline.js` — 大纲全部行为。UMD 包裹：导出纯函数 `buildOutlineTree`（供 Node 测试），浏览器侧自动执行 `__boot()`（扫描标题、渲染面板/把手/📑、开关与模式切换、点击平滑滚动、折叠、拖拽调宽、`IntersectionObserver` 滚动高亮）。
- **Create** `test/outline_tree_test.js` — `buildOutlineTree` 的 Node 断言脚本。
- **Create** `test/fixtures/outline-demo.md` — 手动验证用的多级/跳级标题样例。
- **Modify** `resource/markdown/preview.css` — 追加大纲相关样式（面板/把手/头部/列表项/高亮/折叠箭头/拖拽条/📑 按钮/两种模式与过渡）。
- **Modify** `src/provider/markdownPreviewProvider.ts` — `buildHtml` 读 `globalState` 注入初始状态与 `<script src outline.js>`；新增 3 个 handler（`setOutlineOpen`/`setOutlineMode`/`setOutlineWidth`）。

---

## Task 1: 纯函数 `buildOutlineTree` + Node 测试（TDD）

**Files:**
- Create: `test/outline_tree_test.js`
- Create: `resource/markdown/outline.js`

- [ ] **Step 1: 写失败测试**

创建 `test/outline_tree_test.js`：

```js
// 纯函数 buildOutlineTree 的断言:由扁平标题列表构建嵌套大纲树。
// 运行: node test/outline_tree_test.js
const assert = require('assert');
const { buildOutlineTree } = require('../resource/markdown/outline.js');

// 1) 基础嵌套: h1 下两个 h2,再一个 h1
let tree = buildOutlineTree([
  { level: 1, text: 'A', id: 'a' },
  { level: 2, text: 'A1', id: 'a1' },
  { level: 2, text: 'A2', id: 'a2' },
  { level: 1, text: 'B', id: 'b' },
]);
assert.strictEqual(tree.length, 2, '应有两个顶层节点');
assert.strictEqual(tree[0].children.length, 2, 'A 应有两个子节点');
assert.strictEqual(tree[0].children[0].text, 'A1');
assert.strictEqual(tree[1].children.length, 0, 'B 无子节点');

// 2) 跳级: h1 直接到 h3,h3 仍应作为 h1 的子节点
tree = buildOutlineTree([
  { level: 1, text: 'A', id: 'a' },
  { level: 3, text: 'A.x', id: 'ax' },
]);
assert.strictEqual(tree.length, 1);
assert.strictEqual(tree[0].children.length, 1);
assert.strictEqual(tree[0].children[0].text, 'A.x');

// 3) 开头无 h1(深层级起步): 同级 h2 各自成顶层,其下 h3 嵌套
tree = buildOutlineTree([
  { level: 2, text: 'X', id: 'x' },
  { level: 3, text: 'X1', id: 'x1' },
  { level: 2, text: 'Y', id: 'y' },
]);
assert.strictEqual(tree.length, 2, 'X、Y 为两个顶层');
assert.strictEqual(tree[0].children.length, 1, 'X 含 X1');
assert.strictEqual(tree[1].children.length, 0, 'Y 无子');

// 4) 连续同级
tree = buildOutlineTree([
  { level: 1, text: 'A', id: 'a' },
  { level: 1, text: 'B', id: 'b' },
  { level: 1, text: 'C', id: 'c' },
]);
assert.strictEqual(tree.length, 3);

// 5) 空输入
assert.deepStrictEqual(buildOutlineTree([]), []);

console.log('outline_tree_test: all assertions passed');
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node test/outline_tree_test.js`
Expected: FAIL —— `Cannot find module '../resource/markdown/outline.js'`（文件尚未创建）。

- [ ] **Step 3: 创建 `resource/markdown/outline.js`(仅纯函数 + UMD 壳 + __boot 占位)**

```js
// Markdown 预览大纲导航。
// UMD 包裹:浏览器侧(webview)自动执行 __boot();Node 侧仅导出纯函数 buildOutlineTree 供测试。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node: 仅取纯函数
  if (typeof document !== 'undefined') api.__boot();                          // 浏览器: DOM 引导
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 把扁平标题列表按层级构建成嵌套树(纯函数,无 DOM 依赖)。
   * 用栈维护祖先链:弹出所有 level >= 当前的栈顶,余下栈顶即为父;空栈则作顶层。
   * 这样跳级(h1->h3)时 h3 仍挂到最近的更浅标题下。
   * @param {{level:number,text:string,id:string}[]} items
   * @returns {{level:number,text:string,id:string,children:any[]}[]}
   */
  function buildOutlineTree(items) {
    const roots = [];
    const stack = [];
    (items || []).forEach(function (raw) {
      const node = { level: raw.level, text: raw.text, id: raw.id, children: [] };
      while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
    });
    return roots;
  }

  function __boot() { /* Task 2 填充 */ }

  return { buildOutlineTree: buildOutlineTree, __boot: __boot };
});
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node test/outline_tree_test.js`
Expected: PASS —— 输出 `outline_tree_test: all assertions passed`。

- [ ] **Step 5: 提交**

```bash
git add resource/markdown/outline.js test/outline_tree_test.js
git commit -m "Add outline tree builder with node test"
```

---

## Task 2: 大纲面板 DOM 与交互（`__boot`）

**Files:**
- Modify: `resource/markdown/outline.js`（替换 `__boot` 占位实现）

- [ ] **Step 1: 实现 `__boot`**

将 `resource/markdown/outline.js` 中的 `function __boot() { /* Task 2 填充 */ }` 整体替换为：

```js
  function __boot() {
    const docEl = document.documentElement;
    const body = document.body;
    const mdBody = document.querySelector('.md-body');
    if (!mdBody) return;

    // 1) 扫描标题 -> 扁平列表
    const hs = Array.prototype.slice.call(mdBody.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const items = hs.map(function (h) {
      return { level: parseInt(h.tagName.charAt(1), 10), text: (h.textContent || '').trim(), id: h.id, el: h };
    }).filter(function (it) { return it.text; });
    if (!items.length) return; // 无标题:不渲染面板/把手/按钮

    const tree = buildOutlineTree(items);
    const linkById = {}; // id -> 大纲链接元素,供高亮

    // 2) 面板
    const panel = document.createElement('div'); panel.id = 'md-outline';
    const header = document.createElement('div'); header.id = 'md-outline-header';
    const title = document.createElement('span'); title.id = 'md-outline-title'; title.textContent = '大纲';
    const modeBtn = document.createElement('div'); modeBtn.className = 'md-outline-hbtn'; modeBtn.textContent = '⇆'; modeBtn.title = '切换 推送/浮层';
    const closeBtn = document.createElement('div'); closeBtn.className = 'md-outline-hbtn'; closeBtn.textContent = '✕'; closeBtn.title = '关闭大纲';
    header.appendChild(title); header.appendChild(modeBtn); header.appendChild(closeBtn);
    const list = document.createElement('div'); list.id = 'md-outline-list';

    function renderNodes(nodes, container) {
      nodes.forEach(function (node) {
        const item = document.createElement('div'); item.className = 'md-outline-item';
        const row = document.createElement('div'); row.className = 'md-outline-row';
        row.style.paddingLeft = (4 + (node.level - 1) * 14) + 'px';
        const caret = document.createElement('span'); caret.className = 'md-outline-caret';
        const link = document.createElement('a'); link.className = 'md-outline-link';
        link.textContent = node.text; link.href = '#' + (node.id || '');
        if (node.id) linkById[node.id] = link;
        let childWrap = null;
        if (node.children.length) {
          caret.textContent = '▾';
          childWrap = document.createElement('div'); childWrap.className = 'md-outline-children';
          caret.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            const collapsed = item.classList.toggle('collapsed');
            caret.textContent = collapsed ? '▸' : '▾';
          });
        }
        link.addEventListener('click', function (e) {
          e.preventDefault();
          const target = node.id ? document.getElementById(node.id) : null;
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        row.appendChild(caret); row.appendChild(link); item.appendChild(row);
        if (childWrap) { renderNodes(node.children, childWrap); item.appendChild(childWrap); }
        container.appendChild(item);
      });
    }
    renderNodes(tree, list);

    const grip = document.createElement('div'); grip.id = 'md-outline-grip'; grip.title = '拖拽调整宽度';
    panel.appendChild(header); panel.appendChild(list); panel.appendChild(grip);

    // 左缘把手 + 右下角 📑 按钮
    const handle = document.createElement('div'); handle.id = 'md-outline-handle'; handle.textContent = '☰'; handle.title = '大纲导航';
    const navBtn = document.createElement('div'); navBtn.id = 'md-outline-btn'; navBtn.textContent = '📑'; navBtn.title = '大纲导航';

    body.appendChild(panel); body.appendChild(handle); body.appendChild(navBtn);

    // 3) 开关 / 模式(状态读自 <html> 属性,改动经 __mdPost 回存)
    function isOpen() { return docEl.getAttribute('data-outline-open') === '1'; }
    function setOpen(open) {
      docEl.setAttribute('data-outline-open', open ? '1' : '0');
      if (window.__mdPost) window.__mdPost('setOutlineOpen', open);
    }
    function toggleOpen() { setOpen(!isOpen()); }
    function setMode(mode) {
      docEl.setAttribute('data-outline-mode', mode);
      if (window.__mdPost) window.__mdPost('setOutlineMode', mode);
    }
    function toggleMode() { setMode(docEl.getAttribute('data-outline-mode') === 'overlay' ? 'push' : 'overlay'); }

    handle.addEventListener('click', toggleOpen);
    navBtn.addEventListener('click', toggleOpen);
    closeBtn.addEventListener('click', toggleOpen);
    modeBtn.addEventListener('click', toggleMode);

    // 4) 拖拽调宽
    const MINW = 180, MAXW = 480;
    let dragging = false;
    function readWidth() {
      const v = parseInt(getComputedStyle(docEl).getPropertyValue('--md-outline-w'), 10);
      return isNaN(v) ? 260 : v;
    }
    grip.addEventListener('mousedown', function (e) {
      e.preventDefault(); dragging = true; body.classList.add('md-outline-resizing');
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const w = Math.min(MAXW, Math.max(MINW, e.clientX));
      docEl.style.setProperty('--md-outline-w', w + 'px');
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false; body.classList.remove('md-outline-resizing');
      if (window.__mdPost) window.__mdPost('setOutlineWidth', readWidth());
    });

    // 5) 滚动高亮
    let activeId = null;
    function setActive(id) {
      if (id === activeId) return;
      if (activeId && linkById[activeId]) linkById[activeId].classList.remove('active');
      activeId = id;
      if (activeId && linkById[activeId]) {
        const a = linkById[activeId];
        a.classList.add('active');
        const r = a.getBoundingClientRect(), lr = list.getBoundingClientRect();
        if (r.top < lr.top || r.bottom > lr.bottom) a.scrollIntoView({ block: 'nearest' });
      }
    }
    const visible = new Set();
    function pickActive() {
      if (visible.size) {
        let best = null;
        items.forEach(function (it) { if (visible.has(it.el) && !best) best = it; });
        if (best) { setActive(best.id); return; }
      }
      let cur = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].el.getBoundingClientRect().top <= 80) cur = items[i]; else break;
      }
      if (cur) setActive(cur.id);
    }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) visible.add(en.target); else visible.delete(en.target);
      });
      pickActive();
    }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });
    items.forEach(function (it) { if (it.id) io.observe(it.el); });
    pickActive();
    window.addEventListener('scroll', pickActive, { passive: true });
  }
```

- [ ] **Step 2: 回归——确认纯函数测试仍通过**

Run: `node test/outline_tree_test.js`
Expected: PASS —— `outline_tree_test: all assertions passed`（`__boot` 改动不应影响纯函数）。

- [ ] **Step 3: 提交**

```bash
git add resource/markdown/outline.js
git commit -m "Implement outline panel rendering and interactions"
```

---

## Task 3: 大纲样式（`preview.css`）

**Files:**
- Modify: `resource/markdown/preview.css`（在文件末尾追加）

- [ ] **Step 1: 追加大纲样式**

在 `resource/markdown/preview.css` 末尾追加：

```css
/* ===== 大纲导航 ===== */
:root { --md-outline-w: 260px; }

/* 左缘常驻把手:仅关闭时可见 */
#md-outline-handle {
  position: fixed; left:0; top:50%; transform:translateY(-50%);
  width:18px; height:64px; display:flex; align-items:center; justify-content:center;
  background: var(--md-ui-bg); border:1px solid var(--md-ui-border); border-left:none;
  border-radius:0 8px 8px 0; color: var(--md-fg); font-size:13px; cursor:pointer;
  z-index:99998; opacity:0.7; user-select:none;
  -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
}
#md-outline-handle:hover { opacity:1; }
html[data-outline-open="1"] #md-outline-handle { display:none; }

/* 面板:固定左侧,默认移出屏幕外 */
#md-outline {
  position: fixed; left:0; top:0; bottom:0; width: var(--md-outline-w);
  display:flex; flex-direction:column; box-sizing:border-box;
  background: var(--md-ui-bg); border-right:1px solid var(--md-ui-border); color: var(--md-fg);
  z-index:99997; transform: translateX(-100%); transition: transform 0.2s ease;
  -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  box-shadow: 2px 0 16px rgba(0,0,0,0.18);
}
html[data-outline-open="1"] #md-outline { transform: translateX(0); }

/* 推送模式:打开时把正文整体右推(padding 加在未缩放的 body 上,缩放下不错位)*/
body { transition: padding-left 0.2s ease; }
html[data-outline-open="1"][data-outline-mode="push"] body { padding-left: var(--md-outline-w); }

/* 头部 */
#md-outline-header {
  display:flex; align-items:center; gap:6px; padding:8px 10px;
  border-bottom:1px solid var(--md-ui-border); flex:0 0 auto;
}
#md-outline-title { font-size:13px; font-weight:600; flex:1 1 auto; }
.md-outline-hbtn {
  width:22px; height:22px; display:flex; align-items:center; justify-content:center;
  border-radius:4px; cursor:pointer; font-size:13px; color: var(--md-muted);
}
.md-outline-hbtn:hover { background: var(--md-pre-bg); color: var(--md-fg); }

/* 列表 */
#md-outline-list { flex:1 1 auto; overflow:auto; padding:6px 4px 12px; }
.md-outline-item.collapsed > .md-outline-children { display:none; }
.md-outline-row { display:flex; align-items:flex-start; gap:2px; border-radius:4px; }
.md-outline-row:hover { background: var(--md-pre-bg); }
.md-outline-caret {
  flex:0 0 auto; width:14px; text-align:center; font-size:10px; line-height:1.9;
  color: var(--md-muted); cursor:pointer; user-select:none;
}
.md-outline-link {
  flex:1 1 auto; padding:3px 4px; font-size:13px; line-height:1.4; color: var(--md-fg);
  text-decoration:none; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.md-outline-link:hover { color: var(--md-link); }
.md-outline-link.active { color: var(--md-link); font-weight:600; }

/* 右边缘拖拽条 */
#md-outline-grip { position:absolute; top:0; right:-3px; width:6px; height:100%; cursor:col-resize; z-index:1; }
#md-outline-grip:hover { background: var(--md-link); opacity:0.4; }
body.md-outline-resizing { cursor:col-resize; user-select:none; }
body.md-outline-resizing #md-outline { transition:none; }

/* 右下角 📑(在主题钮 192 左侧 -> 236)*/
#md-outline-btn {
  position: fixed; right:236px; bottom:16px; width:36px; height:36px; border-radius:50%;
  background: var(--md-ui-bg); border:1px solid var(--md-ui-border); color: var(--md-fg);
  display:flex; align-items:center; justify-content:center; font-size:16px; cursor:pointer;
  z-index:99999; opacity:0.8; user-select:none; -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);
}
#md-outline-btn:hover { opacity:1; }
```

- [ ] **Step 2: 提交**

```bash
git add resource/markdown/preview.css
git commit -m "Add outline navigation styles"
```

---

## Task 4: 接入 `buildHtml` 与持久化 handler（TS）

**Files:**
- Modify: `src/provider/markdownPreviewProvider.ts`

- [ ] **Step 1: 注入大纲初始状态读取**

在 `buildHtml` 中,找到（约 122 行）：

```ts
        const themesJson = JSON.stringify(MARKDOWN_THEMES);
```

在其后新增：

```ts

        const outlineOpen = this.context.globalState.get<boolean>('markdownOutlineOpen', false);
        const savedOutlineMode = this.context.globalState.get<string>('markdownOutlineMode', 'push');
        const outlineMode = savedOutlineMode === 'overlay' ? 'overlay' : 'push';
        const savedOutlineWidth = this.context.globalState.get<number>('markdownOutlineWidth', 260);
        const outlineWidth = Math.min(480, Math.max(180, Number(savedOutlineWidth) || 260));
```

- [ ] **Step 2: 把初始状态写进 `<html>`**

找到：

```ts
        return `<!DOCTYPE html>
<html data-theme="${themeId}">
```

替换为：

```ts
        return `<!DOCTYPE html>
<html data-theme="${themeId}" data-outline-open="${outlineOpen ? '1' : '0'}" data-outline-mode="${outlineMode}" style="--md-outline-w:${outlineWidth}px">
```

- [ ] **Step 3: 加载 `outline.js`**

找到 HTML 模板末尾的：

```ts
${mermaidScript}
</body>
</html>`;
```

替换为：

```ts
<script src="${asset('outline.js')}"></script>
${mermaidScript}
</body>
</html>`;
```

（`outline.js` 在已有内联脚本之后加载,故 `window.__mdPost` 已就绪;`asset()` 已指向 `resource/markdown/`，`localResourceRoots` 已含 `extensionPath`。）

- [ ] **Step 4: 新增 3 个持久化 handler**

找到 handler 链中的（约 97 行）：

```ts
            .on('setZoom', (z: number) => { this.context.globalState.update('markdownPreviewZoom', typeof z === 'number' ? z : 1); })
```

在其后插入：

```ts
            .on('setOutlineOpen', (v: boolean) => { this.context.globalState.update('markdownOutlineOpen', !!v); })
            .on('setOutlineMode', (m: string) => { if (m === 'push' || m === 'overlay') this.context.globalState.update('markdownOutlineMode', m); })
            .on('setOutlineWidth', (w: number) => { const n = Math.min(480, Math.max(180, Number(w) || 260)); this.context.globalState.update('markdownOutlineWidth', n); })
```

- [ ] **Step 5: 构建,确认通过**

Run: `npm run build`
Expected: 构建成功,无 TS 报错,生成 `out/extension.js`。

- [ ] **Step 6: Lint,确认无新增报错**

Run: `npm run lint:fix`
Expected: 无 error（`src/**/*.ts` 通过;`resource/` 下的 JS 不在 lint 范围）。

- [ ] **Step 7: 提交**

```bash
git add src/provider/markdownPreviewProvider.ts
git commit -m "Wire outline panel into markdown preview"
```

---

## Task 5: Extension Dev Host 手动验证

**Files:**
- Create: `test/fixtures/outline-demo.md`

- [ ] **Step 1: 创建验证样例**

创建 `test/fixtures/outline-demo.md`：

```markdown
# 第一章 概述

正文内容。正文内容。正文内容。

## 1.1 背景

正文内容。

### 1.1.1 细节

正文内容。

## 1.2 目标

正文内容。

# 第二章 设计

正文内容。

#### 跳级标题（h1 后直接 h4）

正文内容。

## 2.1 模块

正文内容。

# 第三章 结语

正文内容。正文内容。
```

为制造足够滚动高度,在文件末尾多粘贴若干段落（任意），确保每个标题都能滚动到视口顶部附近。

- [ ] **Step 2: 启动调试宿主**

在 VS Code 中按 **F5**（"Extension" 启动配置,会先跑 `dev` 任务）。在 Extension Development Host 窗口打开 `test/fixtures/outline-demo.md`（用本扩展的 Markdown 预览打开）。

- [ ] **Step 3: 逐项手动核对**

- [ ] 左缘出现常驻把手 `☰`；右下角按钮组末尾出现 `📑`（在 🎨 左侧）。
- [ ] 点把手或 `📑` → 面板从左滑出，展示「第一章/1.1/1.1.1/1.2/第二章/跳级标题/2.1/第三章」层级缩进正确；跳级的 h4 挂在「第二章」下。
- [ ] 默认「推送」模式：面板与正文并列，正文整体右移、不被遮挡。
- [ ] 点头部 `⇆` → 切到「浮层」模式：面板半透明+模糊悬浮在正文上，正文不再右移。再点 `⇆` 切回推送。
- [ ] 点任一大纲项 → 正文平滑滚动到对应标题。
- [ ] 滚动正文 → 当前所在标题在大纲中高亮（`--md-link` 色 + 加粗），且面板自动滚动使高亮项可见。
- [ ] 含子项节点的 `▾` 可折叠/展开（变 `▸`），不影响跳转。
- [ ] 拖拽面板右边缘 → 宽度在 180–480px 间变化；推送模式下正文边界随之移动。
- [ ] `Ctrl/⌘ + 滚轮` 缩放正文（如放到 2×）后，面板与正文左边界仍对齐、不重叠（验证 zoom 不影响推送对齐）。
- [ ] 用 🎨 切几套主题（亮/暗各试）→ 面板配色随主题自适应。
- [ ] 关闭预览再重开（或关 Dev Host 再 F5）→ 面板的开关状态、模式、宽度被记住。
- [ ] 打开一个**无标题**的 .md → 不出现面板、把手、`📑`。
- [ ] 导出（📤 → PDF/HTML/PNG）→ 导出文件中**不含**大纲面板与浮动按钮。

- [ ] **Step 4: 提交样例（如有手动验证中发现的修复，一并提交）**

```bash
git add test/fixtures/outline-demo.md
git commit -m "Add outline demo fixture for manual verification"
```

若 Step 3 发现问题，回到对应 Task 修复后重新验证，再提交修复。

---

## 自查（计划完成后）

- **Spec 覆盖**：呈现方式（推送+浮层，Task 2/3）✓；入口（左缘把手+📑，Task 2/3）✓；点击平滑滚动（Task 2）✓；滚动高亮+面板自动滚动（Task 2）✓；折叠（Task 2/3）✓；拖拽调宽（Task 2/3）✓；状态持久化（Task 4）✓；无标题隐藏（Task 2）✓；缩放对齐（Task 3 CSS + Task 5 验证）✓；18 主题自适应（Task 3 用变量 + Task 5 验证）✓；不入导出（Task 5 验证，无需改动导出链）✓。
- **占位符**：无 TBD/TODO；每个改动步骤都给出完整代码。
- **类型/命名一致**：`buildOutlineTree`、`__boot`、事件名 `setOutlineOpen`/`setOutlineMode`/`setOutlineWidth`、属性 `data-outline-open`/`data-outline-mode`、变量 `--md-outline-w`、元素 id（`md-outline`/`md-outline-handle`/`md-outline-btn`/`md-outline-list`/`md-outline-grip` 等）在 JS/CSS/TS 各处一致。
```
