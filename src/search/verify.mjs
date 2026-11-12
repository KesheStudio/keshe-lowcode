/* 站内检索 · 自检
 *
 * 运行：node src/search/verify.mjs
 * 覆盖三块：分词规则、索引构建/增量、浏览器运行时（用 vm 加载，不依赖真实浏览器）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  buildIndex,
  byteLength,
  normalizePage,
  parseIndex,
  serializeIndex,
  updateIndex
} from './build-index.mjs';
import {
  normalizeText,
  tokenizeQuery,
  tokenizeText
} from './tokenize.mjs';
import { createDemoPages, createSamplePages } from './sample-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok   ' + name);
  } catch (error) {
    failures.push({ name: name, error: error });
    console.log('  FAIL ' + name + '：' + (error && error.message));
  }
}

function loadRuntime() {
  const sandbox = { console: console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'lc-search-runtime.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'lc-search-runtime.js' });
  return sandbox.LCSearch;
}

function tokenNames(tokens) {
  return tokens.map(function (item) { return item.token; });
}

function segmentText(segments) {
  return segments.map(function (segment) { return segment.text; }).join('');
}

function hitText(segments) {
  return segments.filter(function (segment) { return segment.hit; })
    .map(function (segment) { return segment.text; })
    .join('|');
}

const samplePages = createSamplePages(64);
const demoPages = createDemoPages();
const index = buildIndex(samplePages);
const demoIndex = buildIndex(demoPages);
const LCSearch = loadRuntime();
const engine = LCSearch.createEngine(index);
const demoEngine = LCSearch.createEngine(demoIndex);

console.log('\n分词');
test('HTML 标签与实体被清掉', function () {
  assert.equal(normalizeText('<p>缓存 &amp; 索引</p>'), '缓存 & 索引');
  assert.equal(normalizeText('<script>var a = 1;</script>正文'), '正文');
});
test('中文切出单字与双字', function () {
  const map = tokenizeText('缓存策略', 1);
  assert.equal(map.get('缓存'), 1);
  assert.equal(map.get('策略'), 1);
  assert.equal(map.get('缓存'), 1);
  assert.equal(map.get('缓'), 0.35);
  assert.equal(map.get('存策'), 1);
});
test('单字停用词过滤，双字组合保留', function () {
  const map = tokenizeText('可用', 1);
  assert.equal(map.has('可用'), true);
  assert.equal(map.has('可'), false);
  assert.equal(map.has('用'), false);
});
test('英文小写整词 + 3–12 位前缀', function () {
  const map = tokenizeText('Configuration', 1);
  assert.equal(map.get('configuration'), 1);
  assert.equal(map.get('con'), 0.35);
  assert.equal(map.get('conf'), 0.35);
  assert.equal(map.get('configuratio'), 0.35);
  assert.equal(map.has('configurationn'), false);
});
test('英文停用词不进入索引', function () {
  const map = tokenizeText('the and cache', 1);
  assert.equal(map.has('the'), false);
  assert.equal(map.has('and'), false);
  assert.equal(map.get('cache'), 1);
});
test('中文查询词保持双字与单字', function () {
  const tokens = tokenizeQuery('缓存策略');
  assert.deepEqual(tokenNames(tokens), ['存', '存策', '略', '策', '策略', '缓', '缓存']);
});
test('英文停用词查询为空，中文双字组合保留', function () {
  assert.deepEqual(tokenizeQuery('the and'), []);
  // 中文双字组合不做停用词过滤，避免误杀「可用」「上游」这类词。
  assert.deepEqual(tokenNames(tokenizeQuery('的是')), ['的是']);
});

console.log('\n索引构建');
test('64 页样例生成非空索引', function () {
  assert.equal(index.stats.pages, 64);
  assert.ok(index.stats.terms > 1000);
  assert.ok(index.stats.entries > 10000);
  assert.equal(index.docs.length, 64);
});
test('页面按 path 排序，词表按码元排序', function () {
  const paths = index.docs.map(function (doc) { return doc.p; });
  const sorted = paths.slice().sort();
  assert.deepEqual(paths, sorted);
  const terms = index.terms.slice();
  terms.sort();
  assert.deepEqual(index.terms, terms);
});
test('重复构建字节一致', function () {
  assert.equal(serializeIndex(buildIndex(samplePages)), serializeIndex(index));
});
test('输入乱序字节一致', function () {
  const reversed = samplePages.slice().reverse();
  assert.equal(serializeIndex(buildIndex(reversed)), serializeIndex(index));
});
test('重复 path 直接报错', function () {
  assert.throws(function () {
    buildIndex([
      { path: 'a.html', title: 'A', body: '内容' },
      { path: 'a.html', title: 'B', body: '内容' }
    ]);
  }, /重复/);
});
test('缺章节 id 时补 section-N', function () {
  const page = normalizePage({ path: 'a.html', title: 'A', headings: ['第一段', '第二段'] });
  assert.equal(page.headings[0].id, 'section-1');
  assert.equal(page.headings[1].id, 'section-2');
});
test('词条 id 全部合法且权重为正', function () {
  index.docs.forEach(function (doc) {
    assert.equal(doc.w.length % 2, 0);
    for (let i = 0; i < doc.w.length; i += 2) {
      const id = doc.w[i];
      assert.ok(id >= 0 && id < index.terms.length);
      assert.ok(doc.w[i + 1] > 0);
    }
  });
});
test('体积统计与序列化一致', function () {
  const json = serializeIndex(index);
  assert.equal(byteLength(json), byteLength(serializeIndex(index)));
  assert.ok(byteLength(json) > 100000);
});
test('错误格式解析失败', function () {
  assert.throws(function () { parseIndex('{"format":"other"}'); }, /不是 lc-search/);
});

console.log('\n增量更新');
test('无变更时全部复用', function () {
  let stats = null;
  const same = updateIndex(index, {}, { onStats: function (value) { stats = value; } });
  assert.equal(stats.tokenized, 0);
  assert.equal(stats.reused, 64);
  assert.equal(serializeIndex(same), serializeIndex(index));
});
test('只重算变更页，且与全量重建一致', function () {
  const changed = samplePages.slice(0, 2).map(function (page) {
    return Object.assign({}, page, { body: page.body + ' 增量内容 cache deployment。' });
  });
  let stats = null;
  const updated = updateIndex(index, { upsert: changed }, {
    onStats: function (value) { stats = value; }
  });
  assert.equal(stats.tokenized, 2);
  assert.equal(stats.reused, 62);
  const rebuilt = buildIndex(samplePages.slice(2).concat(changed));
  assert.equal(serializeIndex(updated), serializeIndex(rebuilt));
});
test('删除与新增同时生效', function () {
  const removed = samplePages.slice(0, 3).map(function (page) { return page.path; });
  const added = {
    path: 'articles/guide/new-page.html',
    title: '新增页面：缓存 testing',
    summary: '增量新增',
    tags: ['增量'],
    headings: [{ id: 'section-1', text: '新增章节' }],
    body: '新增内容，包含 cache 与 testing。'
  };
  const updated = updateIndex(index, { remove: removed, upsert: [added] });
  const rebuilt = buildIndex(samplePages.slice(3).concat([added]));
  assert.equal(serializeIndex(updated), serializeIndex(rebuilt));
  assert.equal(updated.docs.length, 62);
});

console.log('\n运行时：分词一致性');
[
  '缓存策略',
  'cache conf',
  'Caching',
  '的是 the',
  'HTTP 404 错误',
  '可用性',
  'configuration engine',
  '中文，标点！',
  '  多空格\t换行 '
].forEach(function (query) {
  test('查询分词与构建期一致：' + JSON.stringify(query), function () {
    assert.equal(
      JSON.stringify(LCSearch.tokenizeQuery(query)),
      JSON.stringify(tokenizeQuery(query))
    );
  });
});
test('归一化与构建期一致', function () {
  const samples = ['<p>缓存 &amp; 索引</p>', '  多  空格 ', 'ＡＢＣ', '<b>配置</b>'];
  samples.forEach(function (value) {
    assert.equal(LCSearch.__debug.normalizeText(value), normalizeText(value));
  });
});

console.log('\n运行时：中文检索');
test('中文查询有结果且标题命中排第一组', function () {
  const result = engine.search('缓存');
  assert.ok(result.total > 0);
  assert.equal(result.groups[0].key, 'title');
  assert.ok(result.tookMs >= 0);
});
test('中文多词查询能命中倒排索引相关文章', function () {
  const result = engine.search('倒排索引');
  assert.ok(result.total > 0);
  const paths = result.groups.reduce(function (list, group) {
    return list.concat(group.items.map(function (item) { return item.path; }));
  }, []);
  assert.ok(paths.some(function (item) { return item.indexOf('index-') >= 0; }));
});
test('标题命中片段里带高亮分段', function () {
  const result = engine.search('缓存');
  const item = result.groups[0].items[0];
  assert.ok(item.titleSegments.some(function (segment) { return segment.hit; }));
  assert.ok(item.snippet.segments.some(function (segment) { return segment.hit; }));
});
test('单字查询也能工作', function () {
  assert.ok(engine.search('缓').total > 0);
});
test('全是停用词时给出提示', function () {
  const result = engine.search('the and');
  assert.equal(result.total, 0);
  assert.ok(result.notice.indexOf('停用词') >= 0);
});

console.log('\n运行时：英文检索');
test('英文整词查询命中', function () {
  assert.ok(engine.search('deployment').total > 0);
  assert.ok(engine.search('tokenizer').total > 0);
});
test('英文前缀查询命中 deployment', function () {
  const result = engine.search('deploy');
  assert.ok(result.total > 0);
  const paths = result.groups.reduce(function (list, group) {
    return list.concat(group.items.map(function (item) { return item.path; }));
  }, []);
  assert.ok(paths.some(function (item) { return item.indexOf('deploy-') >= 0; }));
});
test('英文查询大小写不敏感', function () {
  assert.equal(engine.search('Deployment').total, engine.search('deployment').total);
});

console.log('\n运行时：分组与片段');
test('章节命中归到章节组并带锚点', function () {
  const result = demoEngine.search('ETag');
  assert.equal(result.groups[0].key, 'heading');
  const item = result.groups[0].items[0];
  assert.equal(item.heading.id, 'demo-cache-etag');
  assert.ok(item.snippet.segments.some(function (segment) { return segment.hit; }));
});
test('正文命中归到正文组', function () {
  const result = demoEngine.search('304');
  assert.equal(result.groups[0].key, 'body');
  assert.ok(hitText(result.groups[0].items[0].snippet.segments).indexOf('304') >= 0);
});
test('英文标题命中归到标题组', function () {
  const result = demoEngine.search('JWT');
  assert.equal(result.groups[0].key, 'title');
});
test('片段截取不超过约 140 字并带省略号', function () {
  const result = engine.search('cache');
  let hasEllipsis = false;
  let items = 0;
  result.groups.forEach(function (group) {
    group.items.forEach(function (item) {
      items += 1;
      assert.ok(item.snippet.text.length <= 140);
      if (item.snippet.text.indexOf('…') >= 0) hasEllipsis = true;
    });
  });
  assert.ok(items > 0);
  assert.ok(hasEllipsis);
});
test('高亮分段合并重叠且覆盖原文', function () {
  const tokens = [
    { token: '缓存', boost: 1 },
    { token: '存', boost: 0.35 }
  ];
  const segments = engine.__debug.highlightSegments('缓存与缓存策略', tokens);
  assert.equal(segmentText(segments), '缓存与缓存策略');
  assert.equal(hitText(segments), '缓存|缓存');
});
test('无结果时给相近词建议', function () {
  const result = engine.search('cahce');
  assert.equal(result.total, 0);
  assert.ok(result.suggestions.indexOf('cache') >= 0);
});
test('中文错字也能给建议', function () {
  const result = engine.search('缓成');
  assert.equal(result.total, 0);
  assert.ok(result.suggestions.indexOf('缓存') >= 0);
});
test('结果数量受 limit 限制但 total 不虚报', function () {
  const result = engine.search('缓存', { limit: 2 });
  result.groups.forEach(function (group) {
    assert.ok(group.items.length <= 2);
    assert.ok(group.count >= group.items.length);
  });
  assert.ok(result.total >= result.groups.length);
});
test('运行时统计能给出页面与词条数', function () {
  const stats = engine.stats();
  assert.equal(stats.pages, 64);
  assert.equal(stats.terms, index.terms.length);
  assert.ok(stats.entries > 0);
});

console.log('\n体积');
const json = serializeIndex(index);
console.log('  索引：' + (byteLength(json) / 1024).toFixed(1) + ' KB / ' + index.stats.pages + ' 页');
console.log('  平均：' + (byteLength(json) / index.stats.pages / 1024).toFixed(2) + ' KB / 页');

console.log('\n结果：' + passed + ' 项通过，' + failures.length + ' 项失败');
if (failures.length) {
  failures.forEach(function (item) {
    console.log('\n[' + item.name + ']');
    console.log(item.error && item.error.stack ? item.error.stack : item.error);
  });
  process.exitCode = 1;
}
