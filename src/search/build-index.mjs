/* 站内检索 · 构建期索引
 *
 * 输入：页面数组 [{ path, title, summary, body, tags, headings }]
 * 输出：单个可序列化对象（默认压成一行 JSON），结构见 NOTES.md。
 *
 * 设计取舍：
 * - 每个页面只存一份「词 -> 权重」的扁平数组（w: [termId, weight, ...]），
 *   不在文件里再存一份倒排表。倒排由运行时启动时扫一遍建立，省掉近一半体积。
 * - 词表单独抽出来（terms），页面里只存词 id，避免中文词在每篇里重复出现。
 * - 页面按 path 排序后再编号，词表按 UTF-16 码元排序；因此同样输入重复生成字节一致，
 *   与输入数组顺序无关。
 * - 增量更新只对变更页面重新分词；词表 id 会整体重排，但只是整数重映射，不重新切词。
 */

import {
  TOKENIZER_INFO,
  compareStrings,
  mergeTokenMaps,
  normalizeText,
  roundTokenWeights,
  tokenizeInto,
  tokenizePageFields
} from './tokenize.mjs';

export const INDEX_FORMAT = 'lc-search-index';
export const INDEX_VERSION = 1;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function normalizePath(value) {
  const path = normalizeText(value);
  if (!path) throw new Error('页面缺少 path。');
  if (/\s/.test(path)) throw new Error('页面 path 不能包含空白：' + path);
  return path;
}

function normalizeTags(value) {
  if (value == null) return [];
  const list = Array.isArray(value)
    ? value
    : String(value).split(/[,，;；|]/);
  return list
    .map(function (tag) { return normalizeText(tag); })
    .filter(Boolean);
}

function normalizeHeadings(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map(function (heading, index) {
      if (typeof heading === 'string') {
        return { id: 'section-' + (index + 1), text: normalizeText(heading) };
      }
      const source = heading && typeof heading === 'object' ? heading : {};
      const text = normalizeText(source.text || source.title || source.name || '');
      let id = source.id == null ? '' : String(source.id).trim();
      if (!id) id = 'section-' + (index + 1);
      return { id: id, text: text };
    })
    .filter(function (heading) { return heading.text; });
}

/* 页面字段先归一化：去标签、压空白、补默认标题与章节 id。
   这里不做分词，方便增量更新时直接比较字段有没有变。 */
export function normalizePage(page) {
  if (!page || typeof page !== 'object') throw new TypeError('页面必须是对象。');
  const path = normalizePath(page.path || page.url);
  const title = normalizeText(page.title || page.name) ||
    path.split('/').pop().replace(/\.html?$/i, '');
  return {
    path: path,
    title: title,
    summary: normalizeText(page.summary || page.description || page.excerpt),
    tags: normalizeTags(page.tags),
    headings: normalizeHeadings(page.headings || page.sections),
    body: normalizeText(page.body || page.text || page.content || '')
  };
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function samePage(a, b) {
  return a.title === b.title &&
    a.summary === b.summary &&
    a.body === b.body &&
    sameList(a.tags, b.tags) &&
    a.headings.length === b.headings.length &&
    a.headings.every(function (heading, index) {
      return heading.id === b.headings[index].id && heading.text === b.headings[index].text;
    });
}

function tokenizePage(page) {
  const map = new Map();
  tokenizeInto(map, page.title, TOKENIZER_INFO.fields.title);
  tokenizeInto(map, page.tags.join(' '), TOKENIZER_INFO.fields.tags);
  tokenizeInto(map, page.headings.map(function (h) { return h.text; }).join(' '), TOKENIZER_INFO.fields.headings);
  tokenizeInto(map, page.summary, TOKENIZER_INFO.fields.summary);
  tokenizeInto(map, page.body, TOKENIZER_INFO.fields.body);
  return roundTokenWeights(map);
}

/* 从「页面 + 词表」装配最终索引。词表按码元排序，页面按 path 排序。 */
function assemble(entries, counters) {
  const paths = Array.from(entries.keys()).sort(compareStrings);
  const termSet = new Set();
  paths.forEach(function (path) {
    entries.get(path).tokens.forEach(function (weight, token) { termSet.add(token); });
  });
  const terms = Array.from(termSet).sort(compareStrings);
  const termIds = new Map();
  terms.forEach(function (term, index) { termIds.set(term, index); });

  let entryCount = 0;
  const docs = paths.map(function (path) {
    const item = entries.get(path);
    const pairs = [];
    item.tokens.forEach(function (weight, token) {
      pairs.push([termIds.get(token), Math.round(weight * 100) / 100]);
    });
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    const flat = [];
    pairs.forEach(function (pair) {
      flat.push(pair[0]);
      flat.push(pair[1]);
    });
    entryCount += pairs.length;
    return {
      p: item.page.path,
      t: item.page.title,
      s: item.page.summary,
      g: item.page.tags,
      h: item.page.headings.map(function (h) { return [h.id, h.text]; }),
      b: item.page.body,
      w: flat
    };
  });

  const index = {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    tokenizer: TOKENIZER_INFO,
    stats: {
      pages: docs.length,
      terms: terms.length,
      entries: entryCount
    },
    docs: docs,
    terms: terms
  };
  return { index: index, counters: counters };
}

/* 全量构建。options.onStats 收一份各阶段耗时，不写进索引，保证字节稳定。 */
export function buildIndex(pages, options) {
  const opts = options || {};
  const started = now();
  const list = Array.isArray(pages) ? pages : [];
  const normalized = list.map(normalizePage);
  const seen = new Set();
  normalized.forEach(function (page) {
    if (seen.has(page.path)) throw new Error('页面 path 重复：' + page.path);
    seen.add(page.path);
  });
  const prepareMs = now() - started;

  const tokenStart = now();
  const entries = new Map();
  normalized.forEach(function (page) {
    entries.set(page.path, { page: page, tokens: tokenizePage(page) });
  });
  const tokenizeMs = now() - tokenStart;

  const assembled = assemble(entries, {
    tokenized: normalized.length,
    reused: 0,
    removed: 0
  });
  const totalMs = now() - started;

  if (typeof opts.onStats === 'function') {
    opts.onStats({
      pages: assembled.index.stats.pages,
      terms: assembled.index.stats.terms,
      entries: assembled.index.stats.entries,
      tokenized: normalized.length,
      reused: 0,
      removed: 0,
      prepareMs: prepareMs,
      tokenizeMs: tokenizeMs,
      assembleMs: totalMs - prepareMs - tokenizeMs,
      totalMs: totalMs
    });
  }
  return assembled.index;
}

function indexToEntries(index) {
  const entries = new Map();
  index.docs.forEach(function (doc) {
    const tokens = new Map();
    for (let i = 0; i < doc.w.length; i += 2) {
      tokens.set(index.terms[doc.w[i]], doc.w[i + 1]);
    }
    entries.set(doc.p, {
      page: {
        path: doc.p,
        title: doc.t,
        summary: doc.s,
        tags: doc.g.slice(),
        headings: doc.h.map(function (h) { return { id: h[0], text: h[1] }; }),
        body: doc.b
      },
      tokens: tokens
    });
  });
  return entries;
}

/* 增量更新。
 * changes = { upsert: [页面...], remove: [path 或 {path}...] }
 * 未出现在 upsert 里的页面原样保留；内容没变的页面直接复用上次的词表。
 * onStats 会给出 tokenized / reused / removed，便于确认「只重算了变更页」。
 */
export function updateIndex(previous, changes, options) {
  const opts = options || {};
  const index = parseIndex(previous);
  const started = now();
  const entries = indexToEntries(index);
  const beforeSize = entries.size;

  const removedPaths = new Set();
  const remove = (changes && changes.remove) || [];
  (Array.isArray(remove) ? remove : [remove]).forEach(function (item) {
    const path = normalizeText(item && typeof item === 'object' ? item.path : item);
    if (path) removedPaths.add(path);
  });
  let removed = 0;
  removedPaths.forEach(function (path) {
    if (entries.delete(path)) removed += 1;
  });

  const upserts = (changes && (changes.upsert || changes.pages)) || [];
  const list = (Array.isArray(upserts) ? upserts : [upserts]).map(normalizePage);
  const seen = new Set();
  let tokenized = 0;
  /* 未出现在 upsert 里的页面也算复用；内容没变的 upsert 不重复计数。 */
  let reused = entries.size;
  list.forEach(function (page) {
    if (seen.has(page.path)) throw new Error('增量更新里 path 重复：' + page.path);
    seen.add(page.path);
    const existing = entries.get(page.path);
    if (existing && samePage(existing.page, page)) {
      existing.page = page;
      return;
    }
    if (existing) reused -= 1;
    entries.set(page.path, { page: page, tokens: tokenizePage(page) });
    tokenized += 1;
  });

  const assembled = assemble(entries, {
    tokenized: tokenized,
    reused: reused,
    removed: removed
  });
  const totalMs = now() - started;
  if (typeof opts.onStats === 'function') {
    opts.onStats({
      pages: assembled.index.stats.pages,
      terms: assembled.index.stats.terms,
      entries: assembled.index.stats.entries,
      beforePages: beforeSize,
      tokenized: tokenized,
      reused: reused,
      removed: removed,
      totalMs: totalMs
    });
  }
  return assembled.index;
}

/* 解析与校验。索引是运行时唯一的数据来源，坏文件要在构建期就报清楚。 */
export function parseIndex(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object') throw new Error('索引不是对象。');
  if (data.format !== INDEX_FORMAT) throw new Error('不是 lc-search 索引文件。');
  if (data.version !== INDEX_VERSION) {
    throw new Error('索引版本不兼容：期望 ' + INDEX_VERSION + '，实际 ' + data.version + '。');
  }
  if (!Array.isArray(data.docs) || !Array.isArray(data.terms)) {
    throw new Error('索引结构不完整：缺少 docs 或 terms。');
  }
  return data;
}

/* 默认压成一行，体积优先；pretty 仅供人工排查。 */
export function serializeIndex(index, options) {
  const opts = options || {};
  return JSON.stringify(index, null, opts.pretty ? 2 : 0);
}

export function byteLength(text) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
  return new TextEncoder().encode(text).length;
}

/* 汇总体积构成，基准脚本和自检共用。 */
export function inspectIndex(index) {
  const json = serializeIndex(index);
  const docsBytes = index.docs.reduce(function (sum, doc) {
    return sum + byteLength(JSON.stringify(doc));
  }, 0);
  const termsBytes = byteLength(JSON.stringify(index.terms));
  return {
    pages: index.docs.length,
    terms: index.terms.length,
    entries: index.docs.reduce(function (sum, doc) { return sum + doc.w.length / 2; }, 0),
    bytes: byteLength(json),
    docsBytes: docsBytes,
    termsBytes: termsBytes,
    bodyBytes: index.docs.reduce(function (sum, doc) {
      return sum + byteLength(doc.b);
    }, 0)
  };
}

/* 保留给想直接用字段规则的外部脚本。 */
export { tokenizePageFields };
