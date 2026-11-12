/* 站内检索 · 构建期分词
 *
 * 这是一份纯函数模块：不读文件、不联网、不依赖低代码平台其它模块。
 * 浏览器运行时 assets/lc-search-runtime.js 里有一份等价实现（构建产物不打包 node），
 * 两边规则必须一致；改动这里时同步改过去，并跑 src/search/verify.mjs 的对照用例。
 *
 * 规则（刻意做小，够用就行）：
 * - 统一 NFKC，去 HTML 标签、解码常见实体，空白压成单个空格。
 * - 中文：连续汉字串切成「单字 + 双字」，单字权重 0.35，双字权重 1。
 *   没有用词典，所以「缓存策略」会切出 缓存 / 存策 / 策略，其中 存策 是噪声，
 *   但双字组合比纯单字准，且不需要维护词典。
 * - 英文与数字：按小写整词入索引，另外补 3–12 位前缀（前缀权重 0.35）。
 *   例如 configuration 会多出 con / conf / confi … configuratio，输入 conf 能命中。
 * - 停用词只过滤「中文单字」和「英文整词」，双字组合一律保留。
 *   原因：可 / 用 都是单字停用词，但「可用」是正经技术词，过滤双字会误杀。
 * - 没有做繁简转换、拼音、同义词、词干还原（stemming）。这些写进 NOTES.md。
 */

export const TOKENIZER_INFO = Object.freeze({
  id: 'lc-search-default',
  version: 1,
  cjk: 'unigram+bigram',
  latin: 'lowercase+prefix(3-12)',
  fields: Object.freeze({ title: 6, tags: 4, headings: 3, summary: 2, body: 1 }),
  stopwords: 'zh-common+en-core'
});

export const FIELD_WEIGHTS = TOKENIZER_INFO.fields;
export const CJK_UNIGRAM_FACTOR = 0.35;
export const PREFIX_FACTOR = 0.35;
export const PREFIX_MIN = 3;
export const PREFIX_MAX = 12;

const CJK_CLASS = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF';
const CJK_RUN_RE = new RegExp('[' + CJK_CLASS + ']+', 'g');
const CJK_TEST_RE = new RegExp('[' + CJK_CLASS + ']');
const LATIN_RUN_RE = /[a-z0-9]+/g;

export const ZH_STOPWORDS = new Set(
  ('的 了 是 在 和 与 及 或 而 就 都 也 还 又 很 更 最 这 那 此 其 之 为 以 于 对 从 到 ' +
    '把 被 让 给 向 由 因 则 但 并 且 若 如 虽 已 将 着 过 呢 吗 吧 啊 呀 哦 嗯 我 你 他 ' +
    '她 它 们 个 些 有 无 不 可 能 会 要 应 需 用 做 说 看 想 去 来 上 下 中 内 外 前 后 ' +
    '时 里 间 一 二 三 四 五 六 七 八 九 十 零 两 多 少 大 小 好 坏 等 常 正 总 共 只 未 ' +
    '曾').split(/\s+/)
);

export const EN_STOPWORDS = new Set(
  ('the a an and or but if then than of to in on at by for with from as is are was were be been ' +
    'being it its this that these those i you he she we they me him her us them my your our their ' +
    'not no yes do does did done have has had can could should would will shall may might must ' +
    'about into over under again more most some such only own same so too very just also').split(/\s+/)
);

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'"
};

const COLLAPSE_RE = /\s+/g;

/* 去掉标签与实体。正文如果本来就是纯文本，这一步基本不变；
   如果上游直接喂 HTML，也不会把 <div class="x"> 当成词。 */
export function stripHtml(input) {
  let text = String(input == null ? '' : input);
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text.replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/gi, function (match) {
    return ENTITIES[match.toLowerCase()] || match;
  });
  return text;
}

export function normalizeText(input) {
  return stripHtml(input)
    .normalize('NFKC')
    .replace(COLLAPSE_RE, ' ')
    .trim();
}

export function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isCjkText(value) {
  return CJK_TEST_RE.test(String(value == null ? '' : value));
}

function addToken(map, token, weight) {
  if (!token) return;
  const current = map.get(token) || 0;
  map.set(token, current + weight);
}

function addLatin(map, word, boost) {
  if (EN_STOPWORDS.has(word)) return;
  addToken(map, word, boost);
  if (word.length <= PREFIX_MIN || !/[a-z]/.test(word)) return;
  const max = Math.min(word.length - 1, PREFIX_MAX);
  for (let length = PREFIX_MIN; length <= max; length += 1) {
    addToken(map, word.slice(0, length), boost * PREFIX_FACTOR);
  }
}

function addCjkRun(map, run, boost) {
  if (run.length === 1) {
    if (!ZH_STOPWORDS.has(run)) addToken(map, run, boost * CJK_UNIGRAM_FACTOR);
    return;
  }
  for (let i = 0; i < run.length; i += 1) {
    const char = run.charAt(i);
    if (!ZH_STOPWORDS.has(char)) addToken(map, char, boost * CJK_UNIGRAM_FACTOR);
  }
  for (let i = 0; i < run.length - 1; i += 1) {
    addToken(map, run.slice(i, i + 2), boost);
  }
}

/* 把一段文本按同一套规则塞进 map。boost 是字段权重。 */
export function tokenizeInto(map, text, boost) {
  const value = String(text == null ? '' : text).toLowerCase();
  if (!value) return map;

  LATIN_RUN_RE.lastIndex = 0;
  let match = LATIN_RUN_RE.exec(value);
  while (match) {
    addLatin(map, match[0], boost);
    match = LATIN_RUN_RE.exec(value);
  }

  CJK_RUN_RE.lastIndex = 0;
  match = CJK_RUN_RE.exec(value);
  while (match) {
    addCjkRun(map, match[0], boost);
    match = CJK_RUN_RE.exec(value);
  }

  return map;
}

export function tokenizeText(text, boost) {
  return tokenizeInto(new Map(), normalizeText(text), boost == null ? 1 : boost);
}

export function mergeTokenMaps(target, source) {
  source.forEach(function (weight, token) {
    target.set(token, (target.get(token) || 0) + weight);
  });
  return target;
}

export function roundTokenWeights(map) {
  const out = new Map();
  map.forEach(function (weight, token) {
    const rounded = Math.round(weight * 100) / 100;
    if (rounded > 0) out.set(token, rounded);
  });
  return out;
}

/* 查询分词不生成英文前缀：前缀只存在于索引侧，查询输入 conf 会去命中
   configuration 的前缀条目；反过来不需要把查询词再拆一遍。 */
export function tokenizeQuery(query) {
  const map = new Map();
  const value = normalizeText(query).toLowerCase();
  if (!value) return [];

  LATIN_RUN_RE.lastIndex = 0;
  let match = LATIN_RUN_RE.exec(value);
  while (match) {
    if (!EN_STOPWORDS.has(match[0])) addToken(map, match[0], 1);
    match = LATIN_RUN_RE.exec(value);
  }

  CJK_RUN_RE.lastIndex = 0;
  match = CJK_RUN_RE.exec(value);
  while (match) {
    const run = match[0];
    if (run.length === 1) {
      if (!ZH_STOPWORDS.has(run)) addToken(map, run, CJK_UNIGRAM_FACTOR);
    } else {
      for (let i = 0; i < run.length; i += 1) {
        const char = run.charAt(i);
        if (!ZH_STOPWORDS.has(char)) addToken(map, char, CJK_UNIGRAM_FACTOR);
      }
      for (let i = 0; i < run.length - 1; i += 1) {
        addToken(map, run.slice(i, i + 2), 1);
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

/* 给基准脚本用：不重复实现字段拼接规则。 */
export function tokenizePageFields(page) {
  const map = new Map();
  tokenizeInto(map, page.title, FIELD_WEIGHTS.title);
  tokenizeInto(map, (page.tags || []).join(' '), FIELD_WEIGHTS.tags);
  tokenizeInto(map, (page.headings || []).map(function (h) { return h.text; }).join(' '), FIELD_WEIGHTS.headings);
  tokenizeInto(map, page.summary, FIELD_WEIGHTS.summary);
  tokenizeInto(map, page.body, FIELD_WEIGHTS.body);
  return roundTokenWeights(map);
}
