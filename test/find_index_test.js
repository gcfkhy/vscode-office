// 纯函数断言:查找的字符串匹配 findMatches 与偏移映射 locateOffset。
// 运行: node test/find_index_test.js
const assert = require('assert');
const { findMatches, locateOffset } = require('../resource/markdown/find.js');

// ---- findMatches ----
// 1) 基础:多个不重叠匹配
let m = findMatches('foo bar foo', 'foo', false);
assert.deepStrictEqual(m, [{ start: 0, end: 3 }, { start: 8, end: 11 }], '应找到两处 foo');

// 2) 大小写不敏感(默认)
m = findMatches('Foo FOO foo', 'foo', false);
assert.strictEqual(m.length, 3, '不敏感应匹配三处');

// 3) 大小写敏感
m = findMatches('Foo FOO foo', 'foo', true);
assert.deepStrictEqual(m, [{ start: 8, end: 11 }], '敏感只匹配小写 foo');

// 4) 不重叠:'aaaa' 找 'aa' 得 0-2、2-4
m = findMatches('aaaa', 'aa', false);
assert.deepStrictEqual(m, [{ start: 0, end: 2 }, { start: 2, end: 4 }], 'aa 不重叠两处');

// 5) 空输入
assert.deepStrictEqual(findMatches('', 'x', false), [], '空文本无匹配');
assert.deepStrictEqual(findMatches('abc', '', false), [], '空查询无匹配');

// 6) 中文
m = findMatches('查找查找', '查找', false);
assert.strictEqual(m.length, 2, '中文两处');

// 7) 慢路径:文档含小写后长度变化的字符('İ'.toLowerCase() 为两字符)时,
//    大小写不敏感搜索仍应找全,且偏移映射回原串正确(老实现会整篇退回区分大小写,漏掉 'The')。
if ('İ'.toLowerCase().length === 2) {           // 'İ' 折叠成两字符的环境(V8 等)才有意义
  m = findMatches('The İ the', 'the', false);
  assert.deepStrictEqual(m, [{ start: 0, end: 3 }, { start: 6, end: 9 }], '慢路径应找全 The 与 the 且偏移正确');
}

// 8) 截断上限:命中数不超过 MAX_MATCHES(5000)
m = findMatches('a'.repeat(20000), 'a', false);
assert.strictEqual(m.length, 5000, '命中数应被 MAX_MATCHES 截断');

// ---- locateOffset ----
// 构造三段文本节点:'abc'(0..3) 'def'(3..6) 'ghi'(6..9)
const segs = [
  { node: { nodeValue: 'abc' }, start: 0 },
  { node: { nodeValue: 'def' }, start: 3 },
  { node: { nodeValue: 'ghi' }, start: 6 },
];

// 段内定位
let p = locateOffset(segs, 1, false);
assert.strictEqual(p.node.nodeValue, 'abc'); assert.strictEqual(p.offset, 1);

// 起点落在边界(3):归右侧节点开头 -> def@0
p = locateOffset(segs, 3, false);
assert.strictEqual(p.node.nodeValue, 'def'); assert.strictEqual(p.offset, 0);

// 终点落在边界(3):归左侧节点末尾 -> abc@3
p = locateOffset(segs, 3, true);
assert.strictEqual(p.node.nodeValue, 'abc'); assert.strictEqual(p.offset, 3);

// 终点在末尾(9):最后一段末尾
p = locateOffset(segs, 9, true);
assert.strictEqual(p.node.nodeValue, 'ghi'); assert.strictEqual(p.offset, 3);

// 越界保护
assert.strictEqual(locateOffset([], 0, false), null, '空段返回 null');

console.log('find_index_test: all assertions passed');
