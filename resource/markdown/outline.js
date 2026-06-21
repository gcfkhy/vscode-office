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
