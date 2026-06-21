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

  function __boot() {
    if (typeof document === 'undefined') return;
    // 脚本在 body 末尾加载,正常情况 DOM 已就绪;仍做就绪兜底,防止将来调整加载位置时取不到节点。
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runOutline, { once: true });
    else runOutline();
  }

  function runOutline() {
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

  return { buildOutlineTree: buildOutlineTree, __boot: __boot };
});
