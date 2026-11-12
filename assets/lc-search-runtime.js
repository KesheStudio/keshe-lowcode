/* 站内检索 · 浏览器运行时
 *
 * 零依赖、单文件、经典脚本：<script src="lc-search-runtime.js"></script> 即可。
 * 不需要打包器，file:// 双击也能跑（索引用内联 JSON，不走 fetch）。
 *
 * 用法一（自动初始化）：
 *   <div data-lc-search></div>
 *   <script type="application/json" data-lc-search-index>{...}</script>
 *   <script src="lc-search-runtime.js"></script>
 *
 * 用法二（手动挂载）：
 *   var ctl = LCSearch.mount('#search', { index: window.LC_SEARCH_INDEX });
 *
 * 用法三（HTTP 环境下取索引）：
 *   <div data-lc-search data-index="search-index.json"></div>
 *   <script src="lc-search-runtime.js"></script>
 *
 * 索引结构见 src/search/NOTES.md；分词规则必须与 src/search/tokenize.mjs 一致，
 * 改一边要改另一边，并跑 src/search/verify.mjs 的对照用例。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LCSearch = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var FORMAT = 'lc-search-index';
  var INDEX_VERSION = 1;

  var CJK_CLASS = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF';
  var CJK_RUN_RE = new RegExp('[' + CJK_CLASS + ']+', 'g');
  var CJK_TEST_RE = new RegExp('[' + CJK_CLASS + ']');
  var LATIN_RUN_RE = /[a-z0-9]+/g;
  var LATIN_CHAR_RE = /[a-z0-9]/;

  var CJK_UNIGRAM_FACTOR = 0.35;
  var PREFIX_MIN = 3;
  var PREFIX_MAX = 12;

  var ZH_STOPWORDS = makeSet(
    '的 了 是 在 和 与 及 或 而 就 都 也 还 又 很 更 最 这 那 此 其 之 为 以 于 对 从 到 ' +
    '把 被 让 给 向 由 因 则 但 并 且 若 如 虽 已 将 着 过 呢 吗 吧 啊 呀 哦 嗯 我 你 他 ' +
    '她 它 们 个 些 有 无 不 可 能 会 要 应 需 用 做 说 看 想 去 来 上 下 中 内 外 前 后 ' +
    '时 里 间 一 二 三 四 五 六 七 八 九 十 零 两 多 少 大 小 好 坏 等 常 正 总 共 只 未 ' +
    '曾'
  );
  var EN_STOPWORDS = makeSet(
    'the a an and or but if then than of to in on at by for with from as is are was were be been ' +
    'being it its this that these those i you he she we they me him her us them my your our their ' +
    'not no yes do does did done have has had can could should would will shall may might must ' +
    'about into over under again more most some such only own same so too very just also'
  );

  var GROUPS = [
    { key: 'title', label: '标题命中' },
    { key: 'heading', label: '章节命中' },
    { key: 'body', label: '正文命中' }
  ];
  var GROUP_ORDER = { title: 0, heading: 1, body: 2 };

  var DEFAULTS = {
    limit: 8,
    debounce: 120,
    placeholder: '搜索文章、章节或关键词',
    label: '站内搜索',
    emptyHint: '试试更短的关键词，或者换一个说法。'
  };

  /* ---------------- 分词（与构建期同规则） ---------------- */

  function makeSet(source) {
    var set = new Set();
    source.split(/\s+/).forEach(function (word) {
      if (word) set.add(word);
    });
    return set;
  }

  function stripHtml(input) {
    var text = String(input == null ? '' : input);
    text = text.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<[^>]*>/g, ' ');
    text = text.replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/gi, function (match) {
      var map = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
      return map[match.toLowerCase()] || match;
    });
    return text;
  }

  function normalizeText(input) {
    return stripHtml(input).normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function compareStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function isCjkToken(token) {
    return CJK_TEST_RE.test(token);
  }

  function addToken(map, token, weight) {
    if (!token) return;
    map.set(token, (map.get(token) || 0) + weight);
  }

  function tokenizeQuery(query) {
    var map = new Map();
    var value = normalizeText(query).toLowerCase();
    if (!value) return [];
    var match;

    LATIN_RUN_RE.lastIndex = 0;
    match = LATIN_RUN_RE.exec(value);
    while (match) {
      if (!EN_STOPWORDS.has(match[0])) addToken(map, match[0], 1);
      match = LATIN_RUN_RE.exec(value);
    }

    CJK_RUN_RE.lastIndex = 0;
    match = CJK_RUN_RE.exec(value);
    while (match) {
      var run = match[0];
      if (run.length === 1) {
        if (!ZH_STOPWORDS.has(run)) addToken(map, run, CJK_UNIGRAM_FACTOR);
      } else {
        for (var i = 0; i < run.length; i += 1) {
          var char = run.charAt(i);
          if (!ZH_STOPWORDS.has(char)) addToken(map, char, CJK_UNIGRAM_FACTOR);
        }
        for (var j = 0; j < run.length - 1; j += 1) {
          addToken(map, run.slice(j, j + 2), 1);
        }
      }
      match = CJK_RUN_RE.exec(value);
    }

    return Array.from(map.entries())
      .map(function (pair) {
        return { token: pair[0], boost: Math.round(pair[1] * 100) / 100 };
      })
      .sort(function (a, b) { return compareStrings(a.token, b.token); });
  }

  function strongTokens(tokens) {
    var strong = tokens.filter(function (item) { return item.token.length >= 2; });
    return strong.length ? strong : tokens;
  }

  /* ---------------- 检索核心（纯数据，不碰 DOM） ---------------- */

  function assertIndex(index) {
    if (!index || typeof index !== 'object') throw new Error('搜索索引不是对象。');
    if (index.format !== FORMAT) throw new Error('不是 lc-search 索引文件。');
    if (index.version !== INDEX_VERSION) {
      throw new Error('索引版本不兼容：期望 ' + INDEX_VERSION + '，实际 ' + index.version + '。');
    }
    if (!Array.isArray(index.docs) || !Array.isArray(index.terms)) {
      throw new Error('索引缺少 docs 或 terms。');
    }
  }

  function createEngine(index, options) {
    assertIndex(index);
    var opts = options || {};
    var docs = index.docs;
    var terms = index.terms;
    var termIds = new Map();
    terms.forEach(function (term, id) { termIds.set(term, id); });

    var postings = null;
    var idfValues = null;
    var sortedTerms = null;
    var entryCount = 0;
    var initStarted = now();
    var stats = {
      pages: docs.length,
      terms: terms.length,
      entries: 0,
      initMs: 0,
      queries: 0,
      lastMs: 0
    };

    function ensurePostings() {
      if (postings) return postings;
      postings = new Array(terms.length);
      for (var docId = 0; docId < docs.length; docId += 1) {
        var weights = docs[docId].w || [];
        for (var i = 0; i < weights.length; i += 2) {
          var termId = weights[i];
          var weight = weights[i + 1];
          if (!postings[termId]) postings[termId] = [];
          postings[termId].push(docId, weight);
          entryCount += 1;
        }
      }
      stats.entries = entryCount;
      return postings;
    }

    function ensureIdf() {
      if (idfValues) return idfValues;
      ensurePostings();
      idfValues = new Array(terms.length);
      var total = docs.length || 1;
      for (var i = 0; i < terms.length; i += 1) {
        var df = postings[i] ? postings[i].length / 2 : 0;
        idfValues[i] = df ? Math.log(1 + (total - df + 0.5) / (df + 0.5)) : 0;
      }
      return idfValues;
    }

    function ensureSortedTerms() {
      if (sortedTerms) return sortedTerms;
      sortedTerms = terms.map(function (term, id) { return { term: term, id: id }; });
      sortedTerms.sort(function (a, b) {
        return compareStrings(a.term, b.term) || a.id - b.id;
      });
      return sortedTerms;
    }

    /* 查询词在词表里没有精确条目时，用前缀范围兜底。
       例如输入 configuratio，能补到 configuration；最多取 48 个，避免爆量。 */
    function prefixIds(prefix) {
      var list = ensureSortedTerms();
      var low = 0;
      var high = list.length;
      while (low < high) {
        var mid = (low + high) >> 1;
        if (list[mid].term < prefix) low = mid + 1;
        else high = mid;
      }
      var ids = [];
      for (var i = low; i < list.length && ids.length < 48; i += 1) {
        if (list[i].term.indexOf(prefix) !== 0) break;
        ids.push(list[i].id);
      }
      return ids;
    }

    function findTokenIndex(text, token) {
      if (!text || !token) return -1;
      var lower = text.toLowerCase();
      var needle = token.toLowerCase();
      if (isCjkToken(needle)) return lower.indexOf(needle);
      var from = 0;
      while (from <= lower.length - needle.length) {
        var found = lower.indexOf(needle, from);
        if (found < 0) return -1;
        var before = found > 0 ? lower.charAt(found - 1) : '';
        if (!LATIN_CHAR_RE.test(before)) return found;
        from = found + 1;
      }
      return -1;
    }

    function matchesAny(text, tokens) {
      for (var i = 0; i < tokens.length; i += 1) {
        if (findTokenIndex(text, tokens[i].token) >= 0) return true;
      }
      return false;
    }

    function classify(doc, tokens) {
      if (matchesAny(doc.t || '', tokens)) return { group: 'title', heading: null };
      var headings = doc.h || [];
      for (var i = 0; i < headings.length; i += 1) {
        if (matchesAny(headings[i][1] || '', tokens)) {
          return { group: 'heading', heading: { id: headings[i][0], text: headings[i][1] } };
        }
      }
      return { group: 'body', heading: null };
    }

    /* 查询里有双字 / 英文整词时，结果必须至少命中一个强词。
       单字也会进索引，但只靠单字召回太宽（例如「排错」里的「排」会召回
       大量含「排列」的文章），这里用强词做一次精确过滤，宁少勿滥。 */
    function hasStrongMatch(doc, tokens) {
      if (matchesAny(doc.t || '', tokens)) return true;
      var headings = doc.h || [];
      for (var i = 0; i < headings.length; i += 1) {
        if (matchesAny(headings[i][1] || '', tokens)) return true;
      }
      if (matchesAny(doc.s || '', tokens)) return true;
      return matchesAny(doc.b || '', tokens);
    }

    function findBestSpan(text, tokens) {
      var best = null;
      for (var i = 0; i < tokens.length; i += 1) {
        var token = tokens[i].token;
        var index = findTokenIndex(text, token);
        if (index < 0) continue;
        if (!best || index < best.start || (index === best.start && token.length > best.length)) {
          best = { start: index, end: index + token.length, length: token.length };
        }
      }
      return best;
    }

    function highlightSegments(text, tokens) {
      var value = String(text == null ? '' : text);
      if (!value) return [];
      var lower = value.toLowerCase();
      var spans = [];

      tokens.forEach(function (item) {
        var needle = item.token.toLowerCase();
        if (!needle) return;
        var cjk = isCjkToken(needle);
        var from = 0;
        var guard = 0;
        while (guard < 24) {
          var found = -1;
          if (cjk) {
            found = lower.indexOf(needle, from);
          } else {
            var probe = from;
            while (probe <= lower.length - needle.length) {
              var candidate = lower.indexOf(needle, probe);
              if (candidate < 0) break;
              var before = candidate > 0 ? lower.charAt(candidate - 1) : '';
              if (!LATIN_CHAR_RE.test(before)) { found = candidate; break; }
              probe = candidate + 1;
            }
          }
          if (found < 0) break;
          spans.push([found, found + needle.length]);
          from = found + needle.length;
          guard += 1;
        }
      });

      if (!spans.length) return [{ text: value, hit: false }];
      spans.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
      var merged = [];
      spans.forEach(function (span) {
        var last = merged[merged.length - 1];
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else merged.push([span[0], span[1]]);
      });

      var segments = [];
      var cursor = 0;
      merged.forEach(function (span) {
        if (span[0] > cursor) segments.push({ text: value.slice(cursor, span[0]), hit: false });
        segments.push({ text: value.slice(span[0], span[1]), hit: true });
        cursor = span[1];
      });
      if (cursor < value.length) segments.push({ text: value.slice(cursor), hit: false });
      return segments;
    }

    function makeSnippet(text, span, tokens) {
      var CONTEXT_BEFORE = 26;
      var CONTEXT_AFTER = 72;
      var start = Math.max(0, span.start - CONTEXT_BEFORE);
      var end = Math.min(text.length, span.end + CONTEXT_AFTER);

      if (start > 0) {
        var head = text.slice(start, span.start);
        var breakAt = head.search(/[\s，。；：、,.!?！？]/);
        if (breakAt >= 0) {
          start += breakAt + 1;
        } else if (LATIN_CHAR_RE.test(text.charAt(start - 1) || '')) {
          var nextSpace = text.indexOf(' ', start);
          if (nextSpace >= 0 && nextSpace < span.start) start = nextSpace + 1;
        }
      }
      if (end < text.length && LATIN_CHAR_RE.test(text.charAt(end) || '')) {
        var prevSpace = text.lastIndexOf(' ', end);
        if (prevSpace > span.end) end = prevSpace;
      }

      var core = text.slice(start, end);
      var segments = highlightSegments(core, tokens);
      if (start > 0) segments.unshift({ text: '…', hit: false });
      if (end < text.length) segments.push({ text: '…', hit: false });
      return {
        text: (start > 0 ? '…' : '') + core + (end < text.length ? '…' : ''),
        segments: segments
      };
    }

    function snippetFor(doc, tokens, group, heading) {
      var sources = [];
      if (group === 'heading' && heading) sources.push(heading.text);
      sources.push(doc.b || '');
      sources.push((doc.h || []).map(function (item) { return item[1]; }).join(' '));
      sources.push(doc.s || '');
      sources.push(doc.t || '');

      for (var i = 0; i < sources.length; i += 1) {
        var text = sources[i];
        if (!text) continue;
        var span = findBestSpan(text, tokens);
        if (span) return makeSnippet(text, span, tokens);
      }
      var fallback = String(doc.b || doc.s || doc.t || '').slice(0, 120);
      return { text: fallback, segments: [{ text: fallback, hit: false }] };
    }

    function makeItem(docId, entry, tokens) {
      var doc = docs[docId];
      return {
        path: doc.p || '',
        title: doc.t || '',
        tags: doc.g || [],
        group: entry.group,
        score: Math.round(entry.score * 1000) / 1000,
        heading: entry.heading,
        titleSegments: highlightSegments(doc.t || '', tokens),
        snippet: snippetFor(doc, tokens, entry.group, entry.heading)
      };
    }

    function finish(result, started) {
      result.tookMs = Math.round((now() - started) * 100) / 100;
      stats.queries += 1;
      stats.lastMs = result.tookMs;
      return result;
    }

    function emptyResult(query, started) {
      return finish({
        query: query,
        tokens: [],
        total: 0,
        groups: [],
        suggestions: [],
        notice: '',
        tookMs: 0
      }, started);
    }

    function search(query, searchOptions) {
      var settings = searchOptions || {};
      var started = now();
      var normalized = normalizeText(query);
      var tokens = tokenizeQuery(normalized);
      if (!normalized) return emptyResult('', started);

      var result = {
        query: normalized,
        tokens: tokens.map(function (item) { return item.token; }),
        total: 0,
        groups: [],
        suggestions: [],
        notice: '',
        tookMs: 0
      };
      if (!tokens.length) {
        result.notice = '这些词都是停用词，换一个更具体的关键词试试。';
        return finish(result, started);
      }

      ensurePostings();
      ensureIdf();
      var scores = new Map();

      tokens.forEach(function (item) {
        var exact = termIds.has(item.token);
        var ids = exact ? [termIds.get(item.token)] : prefixIds(item.token);
        var damp = exact ? 1 : 0.55;
        ids.forEach(function (termId) {
          var list = postings[termId];
          if (!list) return;
          var idf = idfValues[termId] || 0;
          for (var i = 0; i < list.length; i += 2) {
            var docId = list[i];
            var weight = list[i + 1];
            scores.set(docId, (scores.get(docId) || 0) + idf * Math.sqrt(weight) * item.boost * damp);
          }
        });
      });

      if (!scores.size) {
        result.suggestions = suggest(normalized);
        if (!result.suggestions.length) result.notice = DEFAULTS.emptyHint;
        return finish(result, started);
      }

      var strong = strongTokens(tokens);
      var ranked = [];
      scores.forEach(function (score, docId) {
        var doc = docs[docId];
        if (!hasStrongMatch(doc, strong)) return;
        var classified = classify(doc, strong);
        ranked.push({
          docId: docId,
          score: score,
          group: classified.group,
          heading: classified.heading
        });
      });

      if (!ranked.length) {
        result.suggestions = suggest(normalized);
        if (!result.suggestions.length) result.notice = DEFAULTS.emptyHint;
        return finish(result, started);
      }

      ranked.sort(function (a, b) {
        return (GROUP_ORDER[a.group] - GROUP_ORDER[b.group]) ||
          (b.score - a.score) ||
          compareStrings(docs[a.docId].p || '', docs[b.docId].p || '') ||
          (a.docId - b.docId);
      });

      var limit = Math.max(1, Number(settings.limit || opts.limit || DEFAULTS.limit));
      var shown = { title: 0, heading: 0, body: 0 };
      var counts = { title: 0, heading: 0, body: 0 };
      var items = { title: [], heading: [], body: [] };

      ranked.forEach(function (entry) {
        counts[entry.group] += 1;
        if (shown[entry.group] >= limit) return;
        shown[entry.group] += 1;
        items[entry.group].push(makeItem(entry.docId, entry, strong));
      });

      result.total = ranked.length;
      result.groups = GROUPS.filter(function (group) {
        return counts[group.key] > 0;
      }).map(function (group) {
        return {
          key: group.key,
          label: group.label,
          count: counts[group.key],
          truncated: counts[group.key] - items[group.key].length,
          items: items[group.key]
        };
      });
      return finish(result, started);
    }

    function editDistance(a, b, max) {
      if (a === b) return 0;
      if (Math.abs(a.length - b.length) > max) return max + 1;
      var previous = new Array(b.length + 1);
      var current = new Array(b.length + 1);
      for (var j = 0; j <= b.length; j += 1) previous[j] = j;
      for (var i = 1; i <= a.length; i += 1) {
        current[0] = i;
        var rowMin = current[0];
        for (var k = 1; k <= b.length; k += 1) {
          var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
          current[k] = Math.min(previous[k] + 1, current[k - 1] + 1, previous[k - 1] + cost);
          if (current[k] < rowMin) rowMin = current[k];
        }
        if (rowMin > max) return max + 1;
        var swap = previous;
        previous = current;
        current = swap;
      }
      return previous[b.length];
    }

    function suggest(query) {
      ensurePostings();
      var normalized = normalizeText(query);
      var tokens = tokenizeQuery(normalized);
      if (!tokens.length) return [];
      var bases = tokens.filter(function (item) { return item.token.length >= 2; })
        .map(function (item) { return item.token; });
      if (!bases.length) bases = tokens.map(function (item) { return item.token; });
      var wantCjk = CJK_TEST_RE.test(normalized);
      var candidates = [];

      for (var i = 0; i < terms.length; i += 1) {
        var term = terms[i];
        if (term.length < 2 || term.length > 16) continue;
        if (CJK_TEST_RE.test(term) !== wantCjk) continue;
        var best = 0;
        for (var j = 0; j < bases.length; j += 1) {
          var base = bases[j];
          if (term.indexOf(base) === 0) {
            best = Math.max(best, 3);
          } else if (base.length >= 2) {
            var max = base.length <= 3 ? 1 : 2;
            var distance = editDistance(term, base, max);
            if (distance <= max) best = Math.max(best, 2.4 - distance * 0.4);
          }
        }
        if (best > 0) {
          candidates.push({
            term: term,
            score: best,
            df: postings[i] ? postings[i].length / 2 : 0
          });
        }
      }

      candidates.sort(function (a, b) {
        return (b.score - a.score) || (b.df - a.df) || compareStrings(a.term, b.term);
      });

      var seen = new Set();
      var out = [];
      for (var k = 0; k < candidates.length && out.length < 6; k += 1) {
        var candidate = candidates[k];
        if (seen.has(candidate.term)) continue;
        seen.add(candidate.term);
        out.push(candidate.term);
      }
      return out;
    }

    stats.initMs = Math.round((now() - initStarted) * 100) / 100;

    return {
      version: VERSION,
      index: index,
      search: search,
      suggest: suggest,
      stats: function () {
        ensurePostings();
        return {
          pages: stats.pages,
          terms: stats.terms,
          entries: stats.entries,
          initMs: stats.initMs,
          queries: stats.queries,
          lastMs: stats.lastMs
        };
      },
      __debug: {
        tokenizeQuery: tokenizeQuery,
        highlightSegments: highlightSegments,
        findTokenIndex: findTokenIndex,
        editDistance: editDistance,
        strongTokens: strongTokens
      }
    };
  }

  /* ---------------- DOM 部分 ---------------- */

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function svgIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'lc-search-icon');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '5.5');
    var line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '13.2');
    line.setAttribute('y1', '13.2');
    line.setAttribute('x2', '17');
    line.setAttribute('y2', '17');
    svg.appendChild(circle);
    svg.appendChild(line);
    return svg;
  }

  function appendSegments(host, segments) {
    (segments || []).forEach(function (segment) {
      if (!segment.text) return;
      if (segment.hit) {
        var mark = document.createElement('mark');
        mark.className = 'lc-search-hit';
        mark.textContent = segment.text;
        host.appendChild(mark);
      } else {
        host.appendChild(document.createTextNode(segment.text));
      }
    });
  }

  function resolveIndex(options) {
    if (options.index && typeof options.index === 'object') return options.index;
    if (typeof options.indexText === 'string') return JSON.parse(options.indexText);
    if (typeof options.indexSelector === 'string') {
      var node = document.querySelector(options.indexSelector);
      if (!node) throw new Error('找不到索引节点：' + options.indexSelector);
      return JSON.parse(node.textContent || '');
    }
    if (typeof window !== 'undefined' && window.LC_SEARCH_INDEX) return window.LC_SEARCH_INDEX;
    throw new Error('没有提供搜索索引。');
  }

  function normalizeBasePath(value) {
    var base = String(value == null ? '' : value).trim();
    if (!base) return '';
    return base.charAt(base.length - 1) === '/' ? base : base + '/';
  }

  function mount(target, options) {
    var opts = options || {};
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) throw new Error('找不到搜索容器。');
    if (root.__lcSearch) return root.__lcSearch;

    var engine = createEngine(resolveIndex(opts), opts);
    var config = {
      basePath: normalizeBasePath(opts.basePath),
      limit: Math.max(1, Number(opts.limit || DEFAULTS.limit)),
      debounce: Math.max(0, Number(opts.debounce == null ? DEFAULTS.debounce : opts.debounce)),
      placeholder: opts.placeholder || DEFAULTS.placeholder,
      label: opts.label || DEFAULTS.label,
      onNavigate: typeof opts.onNavigate === 'function' ? opts.onNavigate : null
    };

    var notice = root.querySelector('.lc-search-notice');
    if (notice && notice.parentNode) notice.parentNode.removeChild(notice);
    root.classList.add('lc-search');
    if (opts.className) root.classList.add(opts.className);

    var idBase = 'lc-search-' + Math.random().toString(36).slice(2, 8);
    var listId = idBase + '-list';

    var field = el('div', 'lc-search-field');
    var input = el('input', 'lc-search-input');
    input.type = 'text';
    input.placeholder = config.placeholder;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-label', config.label);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'search');

    var panel = el('div', 'lc-search-panel');
    panel.hidden = true;
    var summary = el('div', 'lc-search-summary');
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    var list = el('div', 'lc-search-results');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '搜索结果');

    field.appendChild(svgIcon());
    field.appendChild(input);
    panel.appendChild(summary);
    panel.appendChild(list);
    root.appendChild(field);
    root.appendChild(panel);

    var state = {
      result: null,
      items: [],
      active: -1,
      open: false,
      composing: false,
      timer: null
    };

    function setSummary(text) {
      summary.textContent = text || '';
    }

    function clearList() {
      while (list.firstChild) list.removeChild(list.firstChild);
    }

    function setActive(index, scroll) {
      if (!state.items.length) {
        state.active = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      var next = index < 0 ? -1 : Math.min(index, state.items.length - 1);
      state.items.forEach(function (entry, position) {
        var active = position === next;
        entry.el.classList.toggle('is-active', active);
        entry.el.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      state.active = next;
      if (next >= 0) {
        input.setAttribute('aria-activedescendant', state.items[next].el.id);
        if (scroll && state.items[next].el.scrollIntoView) {
          state.items[next].el.scrollIntoView({ block: 'nearest' });
        }
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function moveActive(delta) {
      if (!state.items.length) return;
      var base = state.active < 0 ? (delta > 0 ? -1 : state.items.length) : state.active;
      setActive(base + delta, true);
    }

    function openPanel() {
      if (state.open) return;
      state.open = true;
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      root.classList.add('is-open');
    }

    function closePanel() {
      if (!state.open) return;
      state.open = false;
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      root.classList.remove('is-open');
      setActive(-1, false);
    }

    function navigate(item) {
      if (!item) return;
      closePanel();
      if (config.onNavigate) {
        var handled = config.onNavigate(item);
        if (handled === false) return;
      }
      var targetUrl = String(item.path || '');
      if (!targetUrl) return;
      if (config.basePath && targetUrl.charAt(0) !== '#' && !/^(?:[a-z]+:|\/)/i.test(targetUrl)) {
        targetUrl = config.basePath + targetUrl;
      }
      if (item.heading && item.heading.id) {
        var hashAt = targetUrl.indexOf('#');
        if (hashAt === -1) targetUrl += '#' + item.heading.id;
        else targetUrl = targetUrl.slice(0, hashAt) + '#' + item.heading.id;
      }
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = targetUrl;
      }
    }

    function createItem(item, index) {
      var node = el('div', 'lc-search-item');
      node.setAttribute('role', 'option');
      node.id = listId + '-opt-' + index;
      node.setAttribute('aria-selected', 'false');

      var title = el('div', 'lc-search-item-title');
      appendSegments(title, item.titleSegments);
      node.appendChild(title);

      var meta = el('div', 'lc-search-item-meta');
      var path = el('span', 'lc-search-item-path');
      path.textContent = item.path || '';
      meta.appendChild(path);
      if (item.heading && item.heading.text) {
        var crumb = el('span', 'lc-search-item-crumb');
        crumb.textContent = item.heading.text;
        meta.appendChild(crumb);
      }
      node.appendChild(meta);

      var snippet = el('div', 'lc-search-item-snippet');
      appendSegments(snippet, item.snippet.segments);
      node.appendChild(snippet);

      node.addEventListener('mousemove', function () {
        if (state.active !== index) setActive(index, false);
      });
      node.addEventListener('click', function () { navigate(item); });
      return node;
    }

    function renderEmpty(result) {
      var box = el('div', 'lc-search-empty');
      var title = el('p', 'lc-search-empty-title');
      title.textContent = '没有找到「' + result.query + '」';
      box.appendChild(title);

      var hint = el('p', 'lc-search-empty-hint');
      hint.textContent = result.notice || DEFAULTS.emptyHint;
      box.appendChild(hint);

      if (result.suggestions && result.suggestions.length) {
        var suggestBox = el('div', 'lc-search-suggest');
        var label = el('span', 'lc-search-suggest-label');
        label.textContent = '你是不是想找：';
        suggestBox.appendChild(label);
        result.suggestions.forEach(function (term) {
          var chip = el('button', 'lc-search-chip');
          chip.type = 'button';
          chip.textContent = term;
          chip.addEventListener('click', function () {
            input.value = term;
            runSearch(term, true);
            input.focus();
          });
          suggestBox.appendChild(chip);
        });
        box.appendChild(suggestBox);
      }
      list.appendChild(box);
    }

    function render(result) {
      clearList();
      state.items = [];
      state.active = -1;
      input.removeAttribute('aria-activedescendant');

      if (result.notice && !result.total) {
        setSummary(result.notice);
      } else if (!result.total) {
        setSummary('没有找到结果。');
      } else {
        setSummary('找到 ' + result.total + ' 条结果：' + result.groups.map(function (group) {
          return group.label + ' ' + group.count + ' 条';
        }).join('，') + '。');
      }

      if (!result.total) {
        renderEmpty(result);
        return;
      }

      var flat = 0;
      result.groups.forEach(function (group) {
        var box = el('div', 'lc-search-group');
        var head = el('div', 'lc-search-group-title');
        var name = document.createElement('span');
        name.textContent = group.label;
        var count = el('span', 'lc-search-group-count');
        count.textContent = String(group.count);
        head.appendChild(name);
        head.appendChild(count);
        box.appendChild(head);

        group.items.forEach(function (item) {
          var node = createItem(item, flat);
          box.appendChild(node);
          state.items.push({ el: node, item: item });
          flat += 1;
        });

        if (group.truncated > 0) {
          var more = el('div', 'lc-search-more');
          more.textContent = '还有 ' + group.truncated + ' 条未显示，输入更具体的关键词可以缩小范围。';
          box.appendChild(more);
        }
        list.appendChild(box);
      });
    }

    function runSearch(value, immediate) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      var query = String(value == null ? '' : value).trim();
      if (!query) {
        state.result = null;
        state.items = [];
        clearList();
        setSummary('');
        closePanel();
        return;
      }
      var result = engine.search(query, { limit: config.limit });
      state.result = result;
      render(result);
      openPanel();
      if (immediate) setActive(0, false);
    }

    function schedule(value) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(function () {
        state.timer = null;
        runSearch(value);
      }, config.debounce);
    }

    input.addEventListener('input', function () {
      if (state.composing) return;
      schedule(input.value);
    });
    input.addEventListener('compositionstart', function () { state.composing = true; });
    input.addEventListener('compositionend', function () {
      state.composing = false;
      schedule(input.value);
    });
    input.addEventListener('focus', function () {
      if (state.result && input.value.trim() && state.items.length) openPanel();
    });
    input.addEventListener('keydown', function (event) {
      if (event.isComposing || state.composing) return;
      var key = event.key;
      if (key === 'ArrowDown') {
        event.preventDefault();
        if (!state.open && input.value.trim()) runSearch(input.value, true);
        else moveActive(1);
      } else if (key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
      } else if (key === 'Enter') {
        if (state.items.length) {
          event.preventDefault();
          navigate(state.items[state.active >= 0 ? state.active : 0].item);
        }
      } else if (key === 'Escape') {
        if (state.open) {
          event.preventDefault();
          closePanel();
        } else if (input.value) {
          input.value = '';
          runSearch('');
        }
      } else if (key === 'Tab') {
        closePanel();
      }
    });

    function onDocumentClick(event) {
      if (!root.contains(event.target)) closePanel();
    }
    document.addEventListener('click', onDocumentClick);

    var controller = {
      root: root,
      input: input,
      engine: engine,
      search: function (value) { runSearch(value, true); return state.result; },
      focus: function () { input.focus(); },
      close: closePanel,
      destroy: function () {
        document.removeEventListener('click', onDocumentClick);
        if (state.timer) clearTimeout(state.timer);
        while (root.firstChild) root.removeChild(root.firstChild);
        root.classList.remove('lc-search', 'is-open');
        root.removeAttribute('data-lc-search-ready');
        root.__lcSearch = null;
      }
    };
    root.__lcSearch = controller;
    root.setAttribute('data-lc-search-ready', '');
    return controller;
  }

  function load(url) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('当前环境没有 fetch，请改用内联索引。'));
    }
    return fetch(url, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      assertIndex(data);
      return data;
    });
  }

  function showNotice(root, message, kind) {
    var node = el('div', 'lc-search-notice' + (kind ? ' is-' + kind : ''));
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.textContent = message;
    root.appendChild(node);
    return node;
  }

  function initOne(root) {
    if (root.__lcSearch) return root.__lcSearch;
    var options = {
      basePath: root.getAttribute('data-base-path') || '',
      placeholder: root.getAttribute('data-placeholder') || undefined,
      label: root.getAttribute('data-label') || undefined,
      className: root.getAttribute('data-class') || undefined,
      limit: root.getAttribute('data-limit') || undefined,
      debounce: root.getAttribute('data-debounce') || undefined
    };
    if (typeof window !== 'undefined' && typeof window.LCSearchNavigate === 'function') {
      options.onNavigate = window.LCSearchNavigate;
    }

    var selector = root.getAttribute('data-index-selector') || 'script[data-lc-search-index]';
    var inline = null;
    try { inline = document.querySelector(selector); } catch (error) { inline = null; }
    if (inline) {
      options.indexText = inline.textContent || '';
      return mount(root, options);
    }
    if (typeof window !== 'undefined' && window.LC_SEARCH_INDEX) {
      options.index = window.LC_SEARCH_INDEX;
      return mount(root, options);
    }
    var url = root.getAttribute('data-index');
    if (url) {
      showNotice(root, '正在加载搜索索引…', 'loading');
      load(url).then(function (index) {
        options.index = index;
        return mount(root, options);
      }).catch(function (error) {
        showNotice(root, '搜索索引加载失败：' + error.message, 'error');
      });
      return null;
    }
    showNotice(root, '没有找到搜索索引，请检查 data-index 或内联 JSON。', 'error');
    return null;
  }

  function autoInit(scope) {
    if (typeof document === 'undefined') return [];
    var host = scope && scope.querySelectorAll ? scope : document;
    var nodes = Array.prototype.slice.call(host.querySelectorAll('[data-lc-search]'));
    if (host !== document && host.getAttribute && host.getAttribute('data-lc-search') != null && nodes.indexOf(host) === -1) {
      nodes.unshift(host);
    }
    return nodes.map(initOne).filter(function (item) { return item; });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { autoInit(); });
    } else {
      setTimeout(function () { autoInit(); }, 0);
    }
  }

  return {
    version: VERSION,
    format: FORMAT,
    createEngine: createEngine,
    mount: mount,
    load: load,
    autoInit: autoInit,
    tokenizeQuery: tokenizeQuery,
    __debug: {
      normalizeText: normalizeText
    }
  };
}));
