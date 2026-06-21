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
