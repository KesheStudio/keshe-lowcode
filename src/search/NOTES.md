# 站内检索模块

导出站点的独立搜索，不依赖低代码平台其它模块，也不依赖任何第三方库。

- 构建期：`src/search/` 下的 Node 纯函数，把页面数组变成 `search-index.json`
- 运行时：`assets/lc-search-runtime.js` + `assets/css/lc-search.css`，浏览器直接加载
- 演示：`assets/search-demo.html`，`file://` 双击可用

没有改 `server/`、`src/render/`、`src/theme/`、`assets/app.js`、`assets/builder.js`。

## 快速使用

```bash
# 自检（分词、索引、增量、运行时）
node src/search/verify.mjs

# 基准：体积、各阶段耗时、分片判断
node src/search/bench.mjs

# 打印 demo 页用的内联索引
node src/search/bench.mjs --demo
```

导出站点时只需要两样东西：

```html
<link rel="stylesheet" href="/assets/css/lc-search.css">
<div data-lc-search></div>
<script type="application/json" data-lc-search-index>{...}</script>
<script src="/assets/lc-search-runtime.js"></script>
```

索引也可以走 HTTP：`<div data-lc-search data-index="/search-index.json"></div>`。
`file://` 下浏览器不允许 fetch 本地 JSON，所以双击演示页要用内联 JSON。

## 输入契约

```js
buildIndex([
  {
    path: 'articles/frontend/basics/http/cache.html',
    title: 'HTTP 缓存：强缓存与协商缓存',
    summary: '一段摘要，参与检索但权重低于标题。',
    tags: ['HTTP', '缓存'],
    headings: [
      { id: 'section-1', text: '强缓存与 Cache-Control' },
      { id: 'section-2', text: '协商缓存 ETag' }
    ],
    body: '正文纯文本。也可以直接传 HTML，构建时会去标签。'
  }
]);
```

- `path` 必填且唯一；重复会直接报错。
- `headings` 的 `id` 用于跳转定位；缺省补 `section-1`、`section-2`，但最好传真实锚点。
- 字段别名：`url`、`name`、`description`、`excerpt`、`text`、`content`、`sections` 都能识别。
- `body` 只应该是文章正文，不要带导航、页脚、评论区，否则会污染检索结果。

## 索引格式

单个 JSON 对象，默认压成一行：

```json
{
  "format": "lc-search-index",
  "version": 1,
  "tokenizer": { "id": "lc-search-default", "version": 1, "...": "..." },
  "stats": { "pages": 64, "terms": 3259, "entries": 27198 },
  "docs": [
    {
      "p": "articles/.../cache.html",
      "t": "标题",
      "s": "摘要",
      "g": ["标签"],
      "h": [["section-1", "章节标题"]],
      "b": "正文纯文本",
      "w": [12, 4.2, 88, 1, 129, 0.35]
    }
  ],
  "terms": ["缓存", "cache", "..."]
}
```

`w` 是扁平数组，每两个数一组：`[词 id, 权重]`，按词 id 升序。词表单独抽出来，
页面里只存 id，避免中文词在每篇里重复出现。

没有在文件里放第二份倒排表。运行时第一次查询时扫一遍 `docs[].w` 建倒排，
省掉近一半体积；代价是首次查询多几毫秒（64 页实测 4.37ms，见下）。

## 分词

统一先做 NFKC、去 HTML 标签、解码常见实体、空白压成单个空格。

中文：

- 连续汉字串切成 **单字 + 双字**。例如「缓存策略」得到 缓 / 存 / 策 / 略 / 缓存 / 存策 / 策略。
- 单字权重 0.35，双字权重 1。没有词典，`存策` 是噪声，但双字整体比纯单字准。
- 保留单字是为了「缓」这类单字查询和未登录词；代价是召回偏宽，所以查询时又加了一道强词过滤（见下）。

英文与数字：

- 按非字母数字切分，转小写，整词入索引。
- 每个长度大于 3 的英文词额外生成 3–12 位前缀，前缀权重 0.35。`configuration` 会带出 `con`、`conf`、`config`…，输入 `conf` 能命中。
- 数字只入整词，不生成前缀，避免 `2026` 被 `202` 命中。

停用词：

- 只过滤中文单字和英文整词。
- 双字组合一律保留。原因：「可」「用」都是单字停用词，但「可用」是正经技术词，过滤双字会误杀。
- 因此「的是」这种纯虚词双字仍会作为查询词出现，只是通常命中不到内容。

标点：不进入词表，只作为切分边界；全角/半角在 NFKC 阶段统一。

**没有做**：繁简转换、拼音、同义词、英文词干还原（stemming）、词典分词、领域词典。
需要这些能力时应该换专门的搜索引擎，不要在这个模块上叠。

## 权重与排序

字段权重：标题 6、标签 4、章节标题 3、摘要 2、正文 1。同一个词在多个字段出现会累加。
中文单字、英文前缀再乘 0.35。

运行时打分：

```
score = Σ idf(词) × sqrt(docWeight) × 查询词权重
idf   = ln(1 + (N - df + 0.5) / (df + 0.5))
```

`sqrt` 用来压住长文里词频的线性和；idf 让稀有词更有区分度。没有做完整的 BM25
长度归一，因为正文长度已经通过权重累加间接体现，且索引里不存文档长度。

结果分组固定为 **标题命中 → 章节命中 → 正文命中**，组内按分数降序，同分按 path 排序。
一个文档只进一个组，按最好的字段归类。

查询里有双字或英文整词时，候选文档还必须至少命中一个强词（长度 ≥ 2 的查询词），
否则丢掉。例如搜「排错」，单字「排」会召回一堆「排列」「排列」，强词过滤后只剩真正含「排错」的文章。
单字查询没有强词，就退回单字召回。

## 增量与确定性

- 页面按 `path` 排序后再编号，词表按 UTF-16 码元排序，所以同样输入重复生成字节一致，与输入数组顺序无关。
- `updateIndex(previous, changes)` 支持 `{ upsert: [...], remove: [...] }`。
- 只对新增/内容变化的页面重新分词；未变页面直接复用上次的词表。
- 词表 id 会整体重排，但只是整数重映射，不重新切词。
- 索引里不写时间戳、不含随机数，否则字节无法稳定。
- 序列化只有 `JSON.stringify`；`pretty: true` 仅供人工排查，上线用默认的一行 JSON。

## 运行时

```js
var engine = LCSearch.createEngine(index);       // 纯数据，不碰 DOM
engine.search('缓存', { limit: 8 });
engine.suggest('cahce');

LCSearch.mount('#search', {
  index: window.LC_SEARCH_INDEX,                  // 或 indexText / indexSelector
  basePath: '/',
  limit: 8,
  debounce: 120,
  placeholder: '搜索文章、章节或关键词',
  onNavigate: function (item) { /* 返回 false 可拦截默认跳转 */ }
});
```

自动初始化读取：

- `data-index`：索引 URL，`file://` 下会失败并给出提示
- 内联 `script[type="application/json"][data-lc-search-index]`，优先于 URL
- `data-index-selector`：自定义内联索引节点选择器
- `data-base-path`、`data-placeholder`、`data-limit`、`data-debounce`、`data-label`

交互：

- 输入即搜，防抖 120ms；中文输入法组合期间不触发，组合结束后再搜。
- 上/下方向键在全部结果间移动，回车跳转，Esc 关闭（已关闭时清空输入），Tab 收起面板。
- 点击结果跳转到 `path`；章节命中会在 URL 后补 `#section-...`，同页 hash 路径会替换成章节锚点。
- 无结果时给相近词建议（英文按编辑距离与前缀，中文按双字编辑距离），并提供「试试更短的关键词」。
- 结果项有 `role="option"`，输入框是 `role="combobox"`，结果条数通过 `aria-live` 播报。
- 高亮只替换文本节点，不用 `innerHTML`，不会把文章内容当 HTML 注入。
- 高亮颜色使用 `--lc-color-accent-soft` 与 `--lc-color-accent-line`，亮暗主题都沿用现有令牌。

### file:// 注意事项

- 双击打开时不能用 `fetch` 读本地 JSON，必须内联索引。
- 跳转用相对路径（`articles/...`）或同页 hash（`#demo-cache`）都可以。
- 演示页把索引写在 `<script type="application/json">` 里，所以双击即可搜索。

## 实测数据

环境：Windows，Node 当前版本，64 页样例（16 主题 × 4 变体，中英文混合，正文平均 367 字）。

| 项目 | 结果 |
| --- | --- |
| 索引原始 | 324.0 KB（331,740 B） |
| gzip -9 | 60.2 KB（压缩率 18.6%） |
| brotli -11 | 43.1 KB（压缩率 13.3%） |
| 构建总耗时 | 22.73 ms |
| 其中准备与归一化 | 2.32 ms |
| 其中分词与加权 | 11.05 ms |
| 其中词表与装配 | 9.36 ms |
| 序列化 | 1.44 ms |
| 增量更新（改 3、增 2、删 2） | 6.90 ms，重新分词 5 页，复用 59 页 |
| 运行时 JS | 38.4 KB（39,330 B），gzip 11.2 KB |
| 样式 CSS | 7.6 KB（7,791 B），gzip 2.0 KB |
| createEngine | 0.36 ms |
| 首次查询（含建倒排） | 4.37 ms |
| 后续查询平均 | 0.67 ms（最慢 3.59 ms） |
| JSON.parse | 0.78 ms |
| demo 内联索引 | 12 页 / 1,328 词 / 1,694 词条 / 31,697 B（gzip 12,734 B） |

字节构成：正文 19.4%，标题/摘要/标签/章节 8.6%，词权重 63.5%，词表 8.2%。
权重数组是大头，gzip 把它压得很狠，所以 gzip 后体积几乎等于正文原始字节。

demo 页（`assets/search-demo.html`，内联 31,697 B 索引）浏览器实测：

| 场景 | 结果 |
| --- | --- |
| 中文「缓存」 | 出现结果分组，标题与摘要里的「缓存」高亮 |
| 中文「索引」 | 同时出现「标题命中」「正文命中」两个分组 |
| 英文「etag」 | 命中章节「ETag 与 Last-Modified」，点击跳到 `#demo-cache-etag` |
| 无结果「cahce」 | 显示「试试更短的关键词」并给出 cac / cach / cache 建议 |
| 键盘 | ArrowDown 选中项 `aria-selected` 为真；Esc 关闭面板；Enter 跳到 `#demo-index` |
| 控制台 | 无本次交互产生的 JS 报错 |

## 什么时候需要分片

先看 gzip 后的索引，不看原始 JSON。

- 样例 367 字正文：每页 gzip 0.9 KB，400KB 预算约 424 页。
- 折算到 4000 字长文：每页 gzip 约 10.2 KB（线性外推，偏保守），400KB 预算约 39 页。
- 首次查询建倒排：样例 27k 词条 4.37 ms；按 4000 字长文折算，约 134 页接近 100 ms。

实践判断：

1. **50 页以内的短文档**：单文件完全够用，gzip 通常几十到一两百 KB。
2. **100–300 页、正文 3000–4500 字**：单文件 gzip 大约 1–3 MB。首屏就加载会明显拖慢，应按方向拆片。
3. **超过 300 页**：即使按方向分片，单片也可能到几百页，建议再按系列拆分，或者把倒排表预生成进索引换取首次查询速度。
4. 如果搜索框不是首屏必需，改成用户聚焦搜索框时再加载索引，预算可以从 400KB 放宽到 1MB 左右，分片页数大约翻倍。
5. 分片键优先用 `articles/<方向>/`，其次用系列；每片仍是一个完整索引，运行时按当前栏目加载对应片，或并发加载后合并。

这个模块**没有内置分片加载**。它只负责单文件索引和单文件运行时；分片属于导出管线的事，
需要多索引时在每个页面按栏目注入不同的 `data-index`，或者由外层脚本合并。

## 边界与代价

- 索引保存正文纯文本用于生成命中片段。如果站点有权限内容，索引本身也会泄漏内容，不能公开。
- 中文双字切分会产生「存策」这类噪声词，词表比词典分词大，但不需要维护词典。
- 英文前缀会让词表膨胀约 2–3 倍；换来 `conf` 能命中 `configuration`。不适合把前缀长度放到 20 以上。
- 没有繁简转换，简体和繁体互不命中；没有拼音，输入拼音搜不到中文；没有同义词，「缓存」搜不到只写「cache」的文章。
- 编辑距离建议只做 1–2 的近似匹配，长尾错字、整句改写的建议质量有限。
- 单字召回宽，靠强词过滤收窄；如果用户只输入一个汉字，结果会很多，需要 limit 和分组兜底。
- 运行时全量建倒排，索引特别大时首次查询会有可感知停顿；分片或预生成倒排是下一步。
- 没有搜索历史、热词、结果去重、同义词扩展、搜索结果埋点。

## 文件

- `src/search/tokenize.mjs`：归一化、分词、查询分词、字段权重
- `src/search/build-index.mjs`：全量构建、增量更新、序列化、解析、体积统计
- `src/search/sample-data.mjs`：64 页样例 + demo 页数据
- `src/search/bench.mjs`：基准与分片判断
- `src/search/verify.mjs`：自检
- `assets/lc-search-runtime.js`：浏览器运行时（与 `tokenize.mjs` 规则同步）
- `assets/css/lc-search.css`：样式，只用 `--lc-*` 变量
- `assets/search-demo.html`：演示页与内联索引
