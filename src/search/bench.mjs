/* 站内检索 · 基准与体积报告
 *
 * 运行：node src/search/bench.mjs
 * 只读工程内文件，写临时文件也放在系统临时目录，跑完删除。
 *
 * 做四件事：
 * 1. 用 64 页中英文样例生成索引，报告各阶段耗时与字节；
 * 2. 验证重复生成、输入乱序、增量更新与全量重建的字节一致；
 * 3. 加载浏览器运行时，测建倒排与查询耗时；
 * 4. 按实测体积/耗时给出是否需要分片的判断。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  buildIndex,
  byteLength,
  inspectIndex,
  serializeIndex,
  updateIndex
} from './build-index.mjs';
import { createDemoPages, createSamplePages } from './sample-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function now() {
  return performance.now();
}

function ms(value) {
  return (Math.round(value * 100) / 100).toFixed(2) + ' ms';
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function row(label, value) {
  console.log('  ' + label.padEnd(24, ' ') + value);
}

function buildSandbox() {
  const sandbox = { console: console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'lc-search-runtime.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'lc-search-runtime.js' });
  return sandbox.LCSearch;
}

/* --demo 只打印 demo 页要内联的索引，方便更新 assets/search-demo.html。 */
if (process.argv.indexOf('--demo') >= 0) {
  const index = buildIndex(createDemoPages());
  process.stdout.write(serializeIndex(index));
  process.exit(0);
}

const pages = createSamplePages(64);
const onStatsHolder = { value: null };

console.log('\n站内检索索引基准');
console.log('================');
console.log('样例：' + pages.length + ' 页，16 个主题 × 4 个变体，中英文混合\n');

/* ---------- 1. 全量构建 ---------- */
const buildStarted = now();
const index = buildIndex(pages, {
  onStats: function (stats) { onStatsHolder.value = stats; }
});
const buildWall = now() - buildStarted;
const stats = onStatsHolder.value;

const serializeStarted = now();
const json = serializeIndex(index);
const serializeMs = now() - serializeStarted;

const jsonBytes = byteLength(json);
const inspected = inspectIndex(index);

console.log('构建（64 页）');
row('准备与归一化', ms(stats.prepareMs));
row('分词与字段加权', ms(stats.tokenizeMs));
row('词表与页面装配', ms(stats.assembleMs));
row('合计（buildIndex）', ms(stats.totalMs));
row('序列化 JSON', ms(serializeMs));
row('构建墙钟时间', ms(buildWall));
row('页面 / 词 / 词条', index.stats.pages + ' / ' + index.stats.terms + ' / ' + index.stats.entries);
console.log('');

/* ---------- 2. 体积 ---------- */
const gzipBytes = zlib.gzipSync(Buffer.from(json), { level: 9 }).length;
let brotliBytes = 0;
try {
  brotliBytes = zlib.brotliCompressSync(Buffer.from(json), {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
    }
  }).length;
} catch (error) {
  brotliBytes = 0;
}

const weightsBytes = index.docs.reduce(function (sum, doc) {
  return sum + byteLength(JSON.stringify(doc.w));
}, 0);
const metaBytes = index.docs.reduce(function (sum, doc) {
  return sum + byteLength(JSON.stringify({ p: doc.p, t: doc.t, s: doc.s, g: doc.g, h: doc.h }));
}, 0);

console.log('索引体积');
row('JSON 原始', kb(jsonBytes) + '（' + jsonBytes + ' B）');
row('gzip -9', kb(gzipBytes) + '，压缩率 ' + (gzipBytes / jsonBytes * 100).toFixed(1) + '%');
if (brotliBytes) row('brotli -11', kb(brotliBytes) + '，压缩率 ' + (brotliBytes / jsonBytes * 100).toFixed(1) + '%');
row('平均每页（原始）', kb(jsonBytes / pages.length));
row('平均每页（gzip）', kb(gzipBytes / pages.length));
console.log('');
row('正文文本', kb(inspected.bodyBytes) + '，占 ' + (inspected.bodyBytes / jsonBytes * 100).toFixed(1) + '%');
row('标题/摘要/标签/章节', kb(metaBytes) + '，占 ' + (metaBytes / jsonBytes * 100).toFixed(1) + '%');
row('词权重（w 数组）', kb(weightsBytes) + '，占 ' + (weightsBytes / jsonBytes * 100).toFixed(1) + '%');
row('词表 terms', kb(inspected.termsBytes) + '，占 ' + (inspected.termsBytes / jsonBytes * 100).toFixed(1) + '%');
console.log('');

/* ---------- 3. 稳定性 ---------- */
const jsonAgain = serializeIndex(buildIndex(pages));
const shuffled = pages.slice().reverse();
const jsonShuffled = serializeIndex(buildIndex(shuffled));

const diskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-search-bench-'));
const diskFile = path.join(diskDir, 'search-index.json');
const writeStarted = now();
fs.writeFileSync(diskFile, json);
const writeMs = now() - writeStarted;
const readStarted = now();
const diskJson = fs.readFileSync(diskFile, 'utf8');
const readMs = now() - readStarted;
fs.rmSync(diskDir, { recursive: true, force: true });

console.log('稳定性');
row('重复构建字节一致', json === jsonAgain ? '是' : '否（有问题）');
row('输入乱序字节一致', json === jsonShuffled ? '是' : '否（有问题）');
row('写盘 / 读回', ms(writeMs) + ' / ' + ms(readMs) + '，读回一致：' + (diskJson === json ? '是' : '否'));
console.log('');

/* ---------- 4. 增量更新 ---------- */
const changed = pages.slice(0, 3).map(function (page) {
  return {
    path: page.path,
    title: page.title,
    summary: page.summary,
    tags: page.tags,
    headings: page.headings,
    body: page.body + ' 增量追加：cache 失效与 deployment 回滚的补充说明。'
  };
});
const additions = [
  {
    path: 'articles/guide/extra-1.html',
    title: '增量新增：缓存与倒排索引',
    summary: '用于验证增量更新只重算变更页面。',
    tags: ['增量', '缓存'],
    headings: [{ id: 'section-1', text: '增量更新流程' }],
    body: '新增页面会触发分词，旧页面直接复用词表。缓存、倒排索引、deployment 都会进入新索引。'
  },
  {
    path: 'articles/guide/extra-2.html',
    title: '增量新增：搜索排序与 testing',
    summary: '第二个新增页面，覆盖 testing 与 ranking。',
    tags: ['增量', '排序'],
    headings: [{ id: 'section-1', text: '排序稳定性' }],
    body: '同分时按路径排序，testing 与 ranking 的用例要覆盖稳定顺序。'
  }
];
const removed = pages.slice(3, 5).map(function (page) { return page.path; });
const incrementalStats = { value: null };
const updateStarted = now();
const updated = updateIndex(index, {
  upsert: changed.concat(additions),
  remove: removed
}, {
  onStats: function (value) { incrementalStats.value = value; }
});
const updateMs = now() - updateStarted;

const finalPages = pages.slice(5).concat(changed).concat(additions);
const rebuilt = buildIndex(finalPages);
const incrementalJson = serializeIndex(updated);
const rebuiltJson = serializeIndex(rebuilt);

console.log('增量更新');
row('变更 / 新增 / 删除', '3 / 2 / 2');
row('总耗时', ms(updateMs));
row('重新分词页面', String(incrementalStats.value.tokenized));
row('复用词表页面', String(incrementalStats.value.reused));
row('与全量重建一致', incrementalJson === rebuiltJson ? '是' : '否（有问题）');
console.log('');

/* ---------- 5. 运行时 ---------- */
const runtimeSource = fs.readFileSync(path.join(ROOT, 'assets', 'lc-search-runtime.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'lc-search.css'), 'utf8');
const LCSearch = buildSandbox();

const initStarted = now();
const engine = LCSearch.createEngine(index);
const engineInitMs = now() - initStarted;

const firstStarted = now();
const coldResult = engine.search('缓存');
const coldMs = now() - firstStarted;

const queries = [
  '缓存', '倒排索引', '分词与停用词', '搜索排序',
  'deployment', 'conf', 'tokenizer', 'testing', 'etag', '性能优化',
  '排错', '安全令牌', 'storage', 'zzzznotfound'
];
let queryTotal = 0;
let queryMax = 0;
let lastResult = null;
for (let i = 0; i < queries.length; i += 1) {
  const started = now();
  lastResult = engine.search(queries[i]);
  const took = now() - started;
  queryTotal += took;
  if (took > queryMax) queryMax = took;
}
const engineStats = engine.stats();

const parseTime = (function () {
  const runs = 5;
  const started = now();
  for (let i = 0; i < runs; i += 1) JSON.parse(json);
  return (now() - started) / runs;
}());

console.log('浏览器运行时');
row('运行时 JS', kb(byteLength(runtimeSource)) + '（' + byteLength(runtimeSource) + ' B）');
row('运行时 JS gzip', kb(zlib.gzipSync(Buffer.from(runtimeSource), { level: 9 }).length));
row('样式 CSS', kb(byteLength(cssSource)) + '（' + byteLength(cssSource) + ' B）');
row('样式 CSS gzip', kb(zlib.gzipSync(Buffer.from(cssSource), { level: 9 }).length));
row('createEngine', ms(engineInitMs) + '（未建倒排）');
row('首次查询（建倒排）', ms(coldMs) + '，命中 ' + coldResult.total + ' 条');
row('后续 14 次查询', '总计 ' + ms(queryTotal) + '，平均 ' + ms(queryTotal / queries.length) + '，最慢 ' + ms(queryMax));
row('建倒排词条数', String(engineStats.entries));
row('JSON.parse 平均', ms(parseTime));
row('最后一次查询', '「' + queries[queries.length - 1] + '」命中 ' + lastResult.total + ' 条，建议 ' + (lastResult.suggestions.join(' / ') || '无'));
console.log('');

/* ---------- 6. 分片判断 ---------- */
const gzipPerPage = gzipBytes / pages.length;
const coldPerPage = coldMs / pages.length;
const buildPerPage = stats.totalMs / pages.length;
const gzipBudget = 400 * 1024;
const shardPagesByGzip = Math.floor(gzipBudget / gzipPerPage);
const avgBodyChars = index.docs.reduce(function (sum, doc) { return sum + doc.b.length; }, 0) / pages.length;
const realChars = 4000;
const scale = realChars / avgBodyChars;
const entriesPerPage = engineStats.entries / pages.length;
const realEntriesPerPage = entriesPerPage * scale;
const initPerEntry = coldMs / engineStats.entries;
const pagesFor100ms = Math.floor(100 / (initPerEntry * realEntriesPerPage));

console.log('分片判断');
row('样例平均正文', Math.round(avgBodyChars) + ' 字/页');
row('每页 gzip', kb(gzipPerPage));
row('每页构建耗时', ms(buildPerPage));
row('每页首次查询成本', ms(coldPerPage));
row('按 gzip ≤ 400KB 估算', '约 ' + shardPagesByGzip + ' 页/片（当前样例长度）');
row('折算 4000 字长文', kb(gzipPerPage * scale) + ' gzip/页，约 ' + Math.floor(gzipBudget / (gzipPerPage * scale)) + ' 页/片');
row('首次查询接近 100ms', '约 ' + pagesFor100ms + ' 页（按 4000 字长文估算）');
row('当前 64 页结论', gzipBytes < gzipBudget ? '不需要分片' : '建议分片');
console.log('');
console.log('依据：');
console.log('  1. 单文件索引先用 gzip 后体积衡量，不用原始 JSON。样例里 gzip 后是 ' + kb(gzipBytes) + '，');
console.log('     和正文原始字节（' + kb(inspected.bodyBytes) + '）几乎一样，因为权重数组压得很狠，正文才是大头；');
console.log('  2. 正文越长，每页索引越接近线性增长。样例正文平均 ' + Math.round(avgBodyChars) + ' 字，');
console.log('     折算到 4000 字长文时，每页 gzip 约 ' + kb(gzipPerPage * scale) + '（线性外推，偏保守）；');
console.log('  3. 400KB 是弱网首屏预算的经验值：3G 有效带宽约 400–800Kbps，下载 400KB 约 4–8 秒，');
console.log('     已经明显拖慢首屏。按 4000 字长文算，大约 ' + Math.floor(gzipBudget / (gzipPerPage * scale)) + ' 页就该分片；');
console.log('  4. 运行时首次查询会扫一遍全量词条建倒排，样例 ' + engineStats.entries + ' 词条约 ' + coldMs.toFixed(2) + ' ms；');
console.log('     按 4000 字长文折算，约 ' + pagesFor100ms + ' 页时首次查询接近 100ms，也应分片，');
console.log('     或者把倒排表预生成进索引（体积会变大，见 NOTES.md）；');
console.log('  5. 分片键优先用方向（articles/<方向>/），其次用系列；片内仍是一个完整索引，');
console.log('     运行时可以并发加载多片后合并，或者按当前栏目只加载对应片。');
console.log('');
