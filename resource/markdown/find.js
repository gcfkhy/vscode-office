// Markdown 预览查找 (Ctrl/⌘ + F)。
// 自定义编辑器其实可以经 registerCustomEditorProvider 的 webviewOptions.enableFindWidget 启用 VS Code
// 原生查找框。但本扩展为 Markdown 预览特意把它关掉(见 extension.ts 的 markdownViewOption),改用这个
// webview 内查找条 —— 原生组件与自建条只能留一个,否则 Ctrl+F 会被宿主侧的原生查找抢走、按键不再下发
// 到 iframe,自建条收不到。关掉原生后,Ctrl+F 在 webview 获得焦点时即下发到这里处理。
//
// 高亮优先用 CSS Custom Highlight API(Chromium ≥ 105):它在 Range 上着色而不改 DOM,天然
// 兼容代码高亮(hljs span)、KaTeX、表格等复杂结构,刷新/重渲染也不会残留脏节点。旧版 VS Code
// (本扩展 engines 低至 1.64 / Chromium 91)降级为给"当前匹配项"铺一个绝对定位的浮层方块,
// 同样不改 DOM —— 仅当前项可见,够用且零副作用。
//
// UMD 包裹:浏览器侧(webview)自动执行 __boot();Node 侧仅导出纯函数 findMatches / locateOffset
// 供测试(见 test/find_index_test.js)。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node: 仅取纯函数
  if (typeof document !== 'undefined') api.__boot();                          // 浏览器: DOM 引导
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 单次搜索的匹配数上限:极端大文档防止卡死。命中达到此数时调用方应提示"已截断"(见 updateCount 的 +)。
  const MAX_MATCHES = 5000;

  /**
   * 在长文本中找出 query 的全部不重叠匹配,返回全局偏移区间 [{start,end}](end 不含)。
   * 纯函数,无 DOM 依赖。
   * 大小写不敏感时优先走"快路径":整串 toLowerCase 后长度不变(绝大多数文本),偏移与原串 1:1 对应。
   * 极少数 Unicode 折叠会改变长度(如 'İ'.toLowerCase() 变两字符),此时走"慢路径":逐字符折叠并建立
   * "折叠位→原串位"映射,把命中区间映射回原串偏移 —— 既保持大小写不敏感,又不破坏高亮定位
   * (老实现是整篇退回大小写敏感,会让全文搜索被一个无关的 'İ' 静默变成区分大小写)。
   * @param {string} full
   * @param {string} query
   * @param {boolean} caseSensitive
   * @returns {{start:number,end:number}[]}
   */
  function findMatches(full, query, caseSensitive) {
    const out = [];
    if (!full || !query) return out;

    if (caseSensitive) {
      const step = query.length;
      let from = 0, at;
      while ((at = full.indexOf(query, from)) !== -1) {
        out.push({ start: at, end: at + step });
        from = at + step;
        if (out.length >= MAX_MATCHES) break;
      }
      return out;
    }

    const needle = query.toLowerCase();
    const step = needle.length;
    if (!step) return out;

    const lowFull = full.toLowerCase();
    if (lowFull.length === full.length) {           // 快路径
      let from = 0, at;
      while ((at = lowFull.indexOf(needle, from)) !== -1) {
        out.push({ start: at, end: at + step });
        from = at + step;
        if (out.length >= MAX_MATCHES) break;
      }
      return out;
    }

    // 慢路径:逐字符折叠 + 反查映射(back[k] = 折叠串第 k 个字符来自原串的下标)。
    let folded = ''; const back = [];
    for (let i = 0; i < full.length; i++) {
      const lc = full[i].toLowerCase();
      for (let k = 0; k < lc.length; k++) back.push(i);
      folded += lc;
    }
    let from = 0, at;
    while ((at = folded.indexOf(needle, from)) !== -1) {
      const start = back[at];
      const end = (at + needle.length < back.length) ? back[at + needle.length] : full.length;
      out.push({ start: start, end: end });
      from = at + needle.length;
      if (out.length >= MAX_MATCHES) break;
    }
    return out;
  }

  /**
   * 把全局偏移 pos 映射回某个文本节点内的 (node, offset)。
   * segs 为升序的文本段:[{ node, start }],start 是该节点首字符在拼接长串中的全局偏移。
   * atEnd 控制边界归属:
   *   - 起点(atEnd=false)落在边界时归右侧节点开头 —— 让区间从真正有字处开始;
   *   - 终点(atEnd=true) 落在边界时归左侧节点末尾 —— 避免区间末端跨进无关的后续块,
   *     否则 getBoundingClientRect 会把两个块的矩形并起来,导致滚动/浮层乱跳。
   * @returns {{node:Node, offset:number}|null}
   */
  function locateOffset(segs, pos, atEnd) {
    if (!segs || !segs.length) return null;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const len = seg.node.nodeValue.length;
      const segEnd = seg.start + len;
      const hit = atEnd ? (pos <= segEnd) : (pos < segEnd);
      if (hit || i === segs.length - 1) {
        return { node: seg.node, offset: clamp(pos - seg.start, 0, len) };
      }
    }
    const last = segs[segs.length - 1];
    return { node: last.node, offset: last.node.nodeValue.length };
  }

  function __boot() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }

  function run() {
    const mdBody = document.querySelector('.md-body');
    if (!mdBody) return;

    // CSS Custom Highlight API 是否可用(决定高亮走"全部着色"还是"当前项浮层降级")
    const supportsHighlight =
      typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
    const hlAll = supportsHighlight ? new Highlight() : null;
    const hlCur = supportsHighlight ? new Highlight() : null;
    if (supportsHighlight) {
      hlCur.priority = 1; // 当前项盖在"全部匹配"之上
      CSS.highlights.set('md-find', hlAll);
      CSS.highlights.set('md-find-current', hlCur);
    }

    // ---------- UI ----------
    function mkBtn(id, label, title) {
      const b = document.createElement('div');
      b.id = id; b.className = 'md-find-btn'; b.textContent = label; b.title = title;
      return b;
    }
    const bar = document.createElement('div'); bar.id = 'md-find';
    const input = document.createElement('input');
    input.id = 'md-find-input'; input.type = 'text'; input.placeholder = '查找'; input.spellcheck = false;
    input.setAttribute('aria-label', '查找');
    const count = document.createElement('span'); count.id = 'md-find-count';
    const caseBtn = mkBtn('md-find-case', 'Aa', '区分大小写');
    const prevBtn = mkBtn('md-find-prev', '↑', '上一个 (Shift+Enter)');
    const nextBtn = mkBtn('md-find-next', '↓', '下一个 (Enter)');
    const closeBtn = mkBtn('md-find-close', '✕', '关闭 (Esc)');
    bar.appendChild(input); bar.appendChild(count);
    bar.appendChild(caseBtn); bar.appendChild(prevBtn); bar.appendChild(nextBtn); bar.appendChild(closeBtn);
    document.body.appendChild(bar);

    // 旧版降级浮层:只覆盖"当前匹配"(不改 DOM)
    let overlay = null;
    if (!supportsHighlight) {
      overlay = document.createElement('div'); overlay.id = 'md-find-overlay';
      document.body.appendChild(overlay);
    }

    // ---------- 状态 ----------
    let ranges = [];        // 当前全部匹配对应的 Range
    let cur = -1;           // 当前项下标
    let caseSensitive = false;
    let truncated = false;  // 命中数达 MAX_MATCHES 上限被截断(计数显示 +)
    let debounceTimer;

    function isOpen() { return bar.classList.contains('open'); }

    // 收集 .md-body 内的文本节点 —— 只在正文里搜,天然排除查找条/大纲/悬浮按钮(它们挂在 body 上)。
    // 跳过 KaTeX 隐藏的 MathML 源码副本(.katex-mathml),否则公式会出现"看不见的重复匹配"。
    function collectTextNodes() {
      const walker = document.createTreeWalker(mdBody, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('.katex-mathml')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = []; let n;
      while ((n = walker.nextNode())) nodes.push(n);
      return nodes;
    }

    // 把文本节点拼成一个长串 + 段映射,以支持跨节点(跨内联标签)匹配。
    function buildIndex() {
      const nodes = collectTextNodes();
      let full = ''; const segs = [];
      for (let i = 0; i < nodes.length; i++) {
        segs.push({ node: nodes[i], start: full.length });
        full += nodes[i].nodeValue;
      }
      return { full: full, segs: segs };
    }

    function clearHighlights() {
      if (hlAll) hlAll.clear();
      if (hlCur) hlCur.clear();
      if (overlay) overlay.style.display = 'none';
    }

    function runSearch(scrollToFirst) {
      clearHighlights();
      ranges = []; cur = -1; truncated = false;
      const q = input.value;
      if (q) {
        const idx = buildIndex();
        const hits = findMatches(idx.full, q, caseSensitive);
        truncated = hits.length >= MAX_MATCHES;
        for (let i = 0; i < hits.length; i++) {
          const s = locateOffset(idx.segs, hits[i].start, false);
          const e = locateOffset(idx.segs, hits[i].end, true);
          if (!s || !e) continue;
          const r = document.createRange();
          try { r.setStart(s.node, s.offset); r.setEnd(e.node, e.offset); }
          catch (_) { continue; } // 极端边界:跳过该匹配,不影响其余
          ranges.push(r);
          if (hlAll) hlAll.add(r);
        }
        if (ranges.length) cur = 0;
      }
      renderCurrent(scrollToFirst);
      updateCount();
    }

    function renderCurrent(doScroll) {
      if (hlCur) hlCur.clear();
      if (cur >= 0 && cur < ranges.length) {
        const r = ranges[cur];
        if (hlCur) hlCur.add(r);
        positionOverlay(r);
        if (doScroll) scrollRangeIntoView(r);
      } else if (overlay) {
        overlay.style.display = 'none';
      }
    }

    // 浮层是 position:fixed,直接用视口坐标 —— getBoundingClientRect 与 fixed 同坐标系,
    // 不受 .md-body 的 CSS zoom 影响(早期用 absolute+滚动量会和 zoom 后的 rect 串台,缩放下错位)。
    // 代价是 fixed 不随内容滚动,需在 scroll 时重定位(见下方监听)。仅降级模式生效。
    function positionOverlay(r) {
      if (!overlay) return;
      const rect = r.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { overlay.style.display = 'none'; return; }
      overlay.style.display = 'block';
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    }

    function scrollRangeIntoView(r) {
      const rect = r.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // 可见性判断只用视口坐标(rect 与 innerHeight 同坐标系),zoom 安全;已在舒适区就不滚。
      if (rect.top >= 60 && rect.bottom <= vh - 60) return;
      // 把命中所在元素滚到中部,交给浏览器处理 —— scrollIntoView 自身正确处理 CSS zoom,
      // 避免手算 rect.top + scrollY 在缩放(尤其旧引擎)下落点偏移。
      const el = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function updateCount() {
      if (!input.value) { count.textContent = ''; count.classList.remove('none'); }
      else if (!ranges.length) { count.textContent = '无结果'; count.classList.add('none'); }
      // 截断时加 + 提示"还有更多"(N / 5000+),避免把截断数当成真实总数。
      else { count.textContent = (cur + 1) + ' / ' + ranges.length + (truncated ? '+' : ''); count.classList.remove('none'); }
      const has = ranges.length > 0;
      prevBtn.classList.toggle('disabled', !has);
      nextBtn.classList.toggle('disabled', !has);
    }

    function go(dir) {
      if (!ranges.length) return;
      cur = (cur + dir + ranges.length) % ranges.length; // 环绕
      renderCurrent(true);
      updateCount();
    }

    function openFind(prefill) {
      bar.classList.add('open');
      if (typeof prefill === 'string' && prefill) input.value = prefill;
      input.focus(); input.select();
      if (input.value) runSearch(true); else updateCount();
    }

    function closeFind() {
      if (!isOpen()) return;
      bar.classList.remove('open');
      clearHighlights();
      ranges = []; cur = -1;
      input.blur(); // 焦点交还文档,关闭后键盘仍可滚动正文
    }

    // ---------- 事件 ----------
    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { runSearch(true); }, 120); // 防抖:大文档下逐键搜索不卡
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    caseBtn.addEventListener('click', function () {
      caseSensitive = !caseSensitive;
      caseBtn.classList.toggle('active', caseSensitive);
      runSearch(true); input.focus();
    });
    prevBtn.addEventListener('click', function () { go(-1); input.focus(); });
    nextBtn.addEventListener('click', function () { go(1); input.focus(); });
    closeBtn.addEventListener('click', closeFind);

    // 全局快捷键(capture:尽量先于其它监听拿到):
    // Ctrl/⌘+F 打开(用当前选区预填);F3 / Shift+F3 跳转;Esc 关闭。
    window.addEventListener('keydown', function (e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault(); e.stopPropagation();
        let sel = '';
        try { const s = window.getSelection(); if (s && !s.isCollapsed) sel = String(s).trim(); } catch (_) { /* noop */ }
        openFind(sel || undefined);
      } else if (e.key === 'F3') {
        if (isOpen() && ranges.length) { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      } else if (e.key === 'Escape' && isOpen()) {
        e.preventDefault(); closeFind();
      }
    }, true);

    // 降级浮层是 fixed,需在滚动/缩放时跟随当前项重定位。
    if (overlay) {
      const repos = function () { if (isOpen() && cur >= 0 && ranges[cur]) positionOverlay(ranges[cur]); };
      window.addEventListener('scroll', repos, { passive: true });
      window.addEventListener('resize', repos);
    }

    // 图片 / KaTeX / Mermaid 等内容在 load 后(Mermaid 为异步渲染)才最终稳定;若届时查找条开着且有词,
    // 重跑一次把晚到的内容(如 Mermaid 渲染出的 SVG 文本)纳入索引。不滚动,避免 load 时突然跳动。
    // 注:开框→输入→出结果若恰好落在 Mermaid 渲染完成前的极短窗口,会先索引到图表源码,下一次按键即自愈。
    window.addEventListener('load', function () { if (isOpen() && input.value) runSearch(false); });

    // 已知小限:预览在外部改动 / 刷新时会整体重建 webview.html,查找条状态(词、当前项)随之重置 ——
    // 这是只读预览可接受的行为,未持久化以避免跨重建的额外状态管线。
  }

  return { findMatches: findMatches, locateOffset: locateOffset, __boot: __boot };
});
