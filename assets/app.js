/* 低代码建站器 · 主逻辑
   纯浏览器端：IndexedDB 存数据，JSZip 打包导出，无构建步骤。 */
(function () {
  'use strict';

  var DB_NAME = 'lowcode-docs';
  var DB_VERSION = 1;
  var STORE_CONFIG = 'config';
  var STORE_ARTICLES = 'articles';
  var STORE_BUILDS = 'builds';
  var CONFIG_KEY = 'site';

  var SERIES = [
    { id: 'basics', name: '基础', order: 1 },
    { id: 'advanced', name: '进阶', order: 2 },
    { id: 'deep', name: '深入', order: 3 }
  ];

  /* 颜色方案：只存 7 个主色，其余变量按主色算出来，避免让用户填一堆色值。 */
  var PALETTE_KEYS = ['accent', 'bg', 'surface', 'ink', 'muted', 'line', 'codeBg'];

  var PALETTE_LABELS = {
    accent: '主题色',
    bg: '页面背景',
    surface: '卡片背景',
    ink: '正文文字',
    muted: '次要文字',
    line: '分隔线',
    codeBg: '代码底色'
  };

  var BUILTIN_PALETTES = [
    {
      id: 'ink-green',
      name: '纸墨 · 松绿',
      note: '主站默认配色，米色纸面配墨绿。',
      light: { accent: '#3e6a56', bg: '#f4f0e6', surface: '#fffcf5', ink: '#20242a', muted: '#6b7076', line: '#ded6c5', codeBg: '#efeade' },
      dark: { accent: '#8fb9a1', bg: '#141a1f', surface: '#1a2229', ink: '#e6e2d8', muted: '#98a0a6', line: '#2a343c', codeBg: '#151d23' }
    },
    {
      id: 'ink-navy',
      name: '纸墨 · 藏青',
      note: '偏冷静，适合技术文档和运维手册。',
      light: { accent: '#35577f', bg: '#f2f1ec', surface: '#fdfcf7', ink: '#1f252c', muted: '#667077', line: '#d9d7cc', codeBg: '#eae9e0' },
      dark: { accent: '#93b3d6', bg: '#121820', surface: '#19222c', ink: '#e3e5e8', muted: '#97a2ad', line: '#28343f', codeBg: '#131c24' }
    },
    {
      id: 'ink-ochre',
      name: '纸墨 · 赭石',
      note: '暖一点，适合教程、随笔和产品说明。',
      light: { accent: '#9a5b34', bg: '#f5efe3', surface: '#fffdf7', ink: '#2a231d', muted: '#776a5e', line: '#e0d3bd', codeBg: '#efe2cf' },
      dark: { accent: '#d6a177', bg: '#1a1512', surface: '#241d18', ink: '#eee4d8', muted: '#a99a89', line: '#3a2f26', codeBg: '#1d1713' }
    },
    {
      id: 'ink-graphite',
      name: '纸墨 · 石墨',
      note: '低饱和，正文和界面几乎只剩黑白灰。',
      light: { accent: '#4a555c', bg: '#f3f3f0', surface: '#fcfcf9', ink: '#1f2224', muted: '#6a6f73', line: '#d8d8d1', codeBg: '#eaeae4' },
      dark: { accent: '#a6b0b8', bg: '#151719', surface: '#1c2023', ink: '#e4e5e3', muted: '#9a9f9f', line: '#2c3134', codeBg: '#171b1e' }
    }
  ];

  var DEFAULT_COMPONENTS = [
    {
      id: 'comp-note',
      name: '提示框',
      description: '补充一个容易忽略的细节，避免读者踩坑。',
      template: '<div class="note note-info"><strong>{{title}}</strong><p>{{body}}</p></div>',
      fields: ['title', 'body']
    },
    {
      id: 'comp-compare',
      name: '对比卡',
      description: '左右两栏对比两种做法，各自写优缺点。',
      template: '<div class="compare"><div class="compare-card"><h3>{{leftTitle}}</h3><p>{{leftBody}}</p></div><div class="compare-card"><h3>{{rightTitle}}</h3><p>{{rightBody}}</p></div></div>',
      fields: ['leftTitle', 'leftBody', 'rightTitle', 'rightBody']
    },
    {
      id: 'comp-cards',
      name: '三卡入口',
      description: '三张并排卡片，适合放入口、要点或推荐阅读。',
      template: '<div class="card-grid"><a class="article-card" href="{{link1}}"><p class="card-title">{{title1}}</p><p>{{body1}}</p></a><a class="article-card" href="{{link2}}"><p class="card-title">{{title2}}</p><p>{{body2}}</p></a><a class="article-card" href="{{link3}}"><p class="card-title">{{title3}}</p><p>{{body3}}</p></a></div>',
      fields: ['link1', 'title1', 'body1', 'link2', 'title2', 'body2', 'link3', 'title3', 'body3']
    },
    {
      id: 'comp-stat',
      name: '数据卡片',
      description: '三格关键数字，适合放阅读量、篇数、更新时间这类概览。',
      template: '<div class="stat-grid">' +
        '<div class="stat-card"><b>{{value1}}</b><span>{{label1}}</span></div>' +
        '<div class="stat-card"><b>{{value2}}</b><span>{{label2}}</span></div>' +
        '<div class="stat-card"><b>{{value3}}</b><span>{{label3}}</span></div>' +
        '</div>',
      fields: ['value1', 'label1', 'value2', 'label2', 'value3', 'label3']
    },
    {
      id: 'comp-steps',
      name: '步骤条',
      description: '按顺序讲三步操作，每步带一句解释。',
      template: '<ol class="step-list">' +
        '<li class="step-item"><span class="step-index">1</span><div><strong>{{title1}}</strong><p>{{body1}}</p></div></li>' +
        '<li class="step-item"><span class="step-index">2</span><div><strong>{{title2}}</strong><p>{{body2}}</p></div></li>' +
        '<li class="step-item"><span class="step-index">3</span><div><strong>{{title3}}</strong><p>{{body3}}</p></div></li>' +
        '</ol>',
      fields: ['title1', 'body1', 'title2', 'body2', 'title3', 'body3']
    },
    {
      id: 'comp-tags',
      name: '标签组',
      description: '一排标签，适合标出技术栈、适用场景或关键词。',
      template: '<div class="tag-row"><span class="tag">{{tag1}}</span><span class="tag">{{tag2}}</span><span class="tag">{{tag3}}</span><span class="tag">{{tag4}}</span></div>',
      fields: ['tag1', 'tag2', 'tag3', 'tag4']
    },
    {
      id: 'comp-split',
      name: '图文分栏',
      description: '左图右文（或右图左文），适合产品截图配说明。',
      template: '<div class="split"><div class="split-media"><img src="{{src}}" alt="{{alt}}"></div><div class="split-body"><h3>{{title}}</h3><p>{{body}}</p></div></div>',
      fields: ['src', 'alt', 'title', 'body']
    },
    {
      id: 'comp-table',
      name: '对照表格',
      description: '两列三行的对照表，适合参数、方案或前后对比。',
      template: '<table class="compare-table"><thead><tr><th>{{head1}}</th><th>{{head2}}</th></tr></thead><tbody>' +
        '<tr><td>{{row1a}}</td><td>{{row1b}}</td></tr>' +
        '<tr><td>{{row2a}}</td><td>{{row2b}}</td></tr>' +
        '<tr><td>{{row3a}}</td><td>{{row3b}}</td></tr>' +
        '</tbody></table>',
      fields: ['head1', 'head2', 'row1a', 'row1b', 'row2a', 'row2b', 'row3a', 'row3b']
    },
    {
      id: 'comp-quote',
      name: '引用块',
      description: '引用一段话并标注出处，正文里用来强调判断或原话。',
      template: '<blockquote class="quote-block"><p>{{quote}}</p><cite>{{author}}</cite></blockquote>',
      fields: ['quote', 'author']
    },
    {
      id: 'comp-buttons',
      name: '按钮组',
      description: '主按钮加次按钮，适合放在页尾做下一步引导。',
      template: '<div class="btn-row"><a class="btn btn-primary" href="{{primaryHref}}">{{primaryLabel}}</a><a class="btn btn-ghost" href="{{ghostHref}}">{{ghostLabel}}</a></div>',
      fields: ['primaryHref', 'primaryLabel', 'ghostHref', 'ghostLabel']
    },
    {
      id: 'comp-footer',
      name: '页脚块',
      description: '一段版权说明加两个链接，适合放在落地页或自定义页末尾。',
      template: '<div class="footer-block"><p class="footer-title">{{title}}</p><p>{{body}}</p>' +
        '<p class="footer-links"><a href="{{link1Href}}">{{link1}}</a><span>·</span><a href="{{link2Href}}">{{link2}}</a></p></div>',
      fields: ['title', 'body', 'link1Href', 'link1', 'link2Href', 'link2']
    }
  ];

  var PRESET_PAGES = [
    {
      id: 'home',
      name: '首页',
      path: 'index.html',
      nav: false,
      description: '由标题、说明、入口卡片、按钮和自动文章列表组成。导出的 index.html 会用它覆盖自动生成版，区块都能改。',
      blocks: function () {
        return [
          { type: 'heading', text: '先弄明白原理，再记用法', level: 2 },
          { type: 'paragraph', md: '这里放站点主张和读者能得到什么。首页是读者第一眼看到的地方，别堆术语，先说清楚这个站解决什么问题。' },
          { type: 'cards', columns: 3, cards: [
            { title: '从问题出发', body: '每篇文章先说清它解决什么问题，再讲怎么做。', href: 'articles/index.html' },
            { title: '按路线学', body: '方向 → 系列 → 主题，按顺序读不会跳步。', href: 'learning.html' },
            { title: '随时搜索', body: '记不清在哪看过，用关键词搜一下。', href: 'search.html' }
          ] },
          { type: 'button', label: '浏览全部文章', href: 'articles/index.html', variant: 'primary', align: 'center' },
          { type: 'articleList', limit: 6 }
        ];
      }
    },
    {
      id: 'article-list',
      name: '文章列表页',
      path: 'articles/index.html',
      nav: false,
      description: '标题 + 说明 + 自动文章列表。导出后覆盖 articles/index.html，列表仍由文章数据生成。',
      blocks: function () {
        return [
          { type: 'heading', text: '全部文章', level: 2 },
          { type: 'paragraph', md: '按顺序列出站点里的文章。想加筛选或说明，就在这一页继续加区块。' },
          { type: 'articleList', limit: 0 }
        ];
      }
    },
    {
      id: 'about',
      name: '关于页',
      path: 'about.html',
      nav: true,
      description: '关于这个站：定位、更新方式、联系方式。会进页头导航、页脚和 sitemap。',
      blocks: function () {
        return [
          { type: 'heading', text: '关于这个站', level: 2 },
          { type: 'paragraph', md: '用一两段说清楚：这个站是谁在维护、面向谁、内容怎么组织、多久更新一次。' },
          { type: 'note', variant: 'info', title: '内容原则', md: '宁可写慢一点，也把前提、步骤和取舍写清楚。引用别人的结论时，给出处。' },
          { type: 'cards', columns: 2, cards: [
            { title: '联系', body: '把邮箱或社交账号填在这里。', href: 'mailto:hello@example.com' },
            { title: '反馈', body: '发现错误欢迎指出，说明哪一段、为什么错。', href: '' }
          ] }
        ];
      }
    },
    {
      id: 'not-found',
      name: '404 页',
      path: '404.html',
      nav: false,
      description: '找不到页面时的提示。导出后覆盖默认 404，由区块拼成。',
      blocks: function () {
        return [
          { type: 'heading', text: '这个页面不存在', level: 2 },
          { type: 'paragraph', md: '链接可能改过，或者拼错了。可以回首页，或者用搜索找关键词。' },
          { type: 'button', label: '回首页', href: 'index.html', variant: 'primary', align: 'left' },
          { type: 'button', label: '去搜索', href: 'search.html', variant: 'plain', align: 'left' }
        ];
      }
    }
  ];

  var SEED_TOPIC_ID = 'seed-start';
  var SEED_ARTICLE_ID = 'seed-welcome';

  var SEED_BODY = [
    '<p>这是一篇示例文章，用来证明链路是通的：左边目录树里有它，点开能改标题和正文，右边预览和导出的页面就是你现在看到的样子。不需要它的时候，直接删掉。</p>',
    '<h2 id="section-1">这套东西怎么工作</h2>',
    '<p>文章数据存在浏览器的 IndexedDB 里。IndexedDB 是浏览器自带的一个本地数据库，容量比 localStorage 大得多，刷新、关浏览器都不会丢。导出时把当前数据拼成静态 HTML，再打成一个 zip。</p>',
    '<div class="figure">',
    '  <div class="figure-title">从写到发的一条链路</div>',
    '  <div class="flow">',
    '    <div class="flow-step">写正文</div>',
    '    <div class="flow-step">存本机</div>',
    '    <div class="flow-step">导出 zip</div>',
    '    <div class="flow-step">丢进 nginx</div>',
    '  </div>',
    '</div>',
    '<h2 id="section-2">正文里能用的组件</h2>',
    '<p>工具栏上的按钮会插入主站现成的 CSS 组件。图表不要用字符拼，用这些块：流程、分层、对比、提示、警告。</p>',
    '<div class="note note-info">提示块适合补充一个容易忽略的细节，比如“slug 改了，旧链接就会失效”。</div>',
    '<div class="note note-warn">警告块只写真的会出问题的地方，别拿它当装饰。</div>',
    '<h2 id="section-3">导出的页面长什么样</h2>',
    '<p>文章页和主站共用同一套 CSS、同一个站点脚本：明暗切换、右侧段落目录、阅读进度、上下篇导航都在。链接改成了相对路径，部署到任意静态服务后都能直接访问。</p>',
    '<table>',
    '  <thead><tr><th>文件</th><th>作用</th></tr></thead>',
    '  <tbody>',
    '    <tr><td>index.html</td><td>首页，按方向分区</td></tr>',
    '    <tr><td>articles/index.html</td><td>全部文章，可筛选</td></tr>',
    '    <tr><td>search.html</td><td>本地搜索</td></tr>',
    '  </tbody>',
    '</table>',
    '<h2 id="section-4">小结</h2>',
    '<p>先建方向、建主题，再写文章。写完去「导出」生成一个版本，构建记录里会留一份快照，随时能回滚。</p>'
  ].join('\n');

  var DEFAULT_CONFIG = {
    key: CONFIG_KEY,
    siteName: '我的文档站',
    tagline: '先弄明白原理，再记用法。',
    description: '一个用低代码建站器生成的纯静态中文文档站。每一篇尽量从问题讲起，把概念、步骤和取舍说清楚。',
    siteUrl: 'https://example.com',
    copyright: '© 2026 我的文档站',
    directions: [
      {
        id: 'guide',
        name: '入门指南',
        intro: '先弄清楚这个站怎么用、文章放在哪、导出包怎么部署。',
        order: 1
      }
    ],
    series: SERIES.slice(),
    topics: [
      {
        id: SEED_TOPIC_ID,
        directionId: 'guide',
        seriesId: 'basics',
        slug: 'start',
        name: '开始使用',
        intro: '建站器的基本用法和导出链路。',
        order: 1
      }
    ],
    theme: {
      activePaletteId: 'ink-green',
      palettes: clone(BUILTIN_PALETTES)
    },
    components: clone(DEFAULT_COMPONENTS),
    componentsVersion: 2,
    pages: []
  };

  var state = {
    db: null,
    config: null,
    articles: [],
    builds: [],
    currentId: null,
    currentPageId: null,
    doc: null,
    blocks: [],
    selectedBlockId: null,
    dirty: false,
    saveTimer: 0,
    previewTimer: 0,
    historyTimer: 0,
    editSession: false,
    treeQuery: '',
    selectedBuilds: new Set(),
    storage: null,
    exporting: false,
    importing: false,
    importPending: null,
    zipLoading: null,
    zipErrors: [],
    view: 'articles',
    inspectorTab: 'props',
    paletteDraft: null,
    paletteEditingId: null,
    history: { past: [], future: [] },
    dragBlockId: null,
    dropTarget: null
  };

  /* ---------------- 通用工具 ---------------- */

  function qs(sel, scope) {
    return (scope || document).querySelector(sel);
  }

  function qsa(sel, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(sel));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    var rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + rand;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  function fmtBytes(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var value = n / 1024;
    var i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2) + ' ' + units[i];
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function debounce(fn, delay) {
    var timer = 0;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, delay);
    };
  }

  var toastTimer = 0;
  function toast(message, isError) {
    var box = qs('[data-toast]');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('is-error', !!isError);
    box.hidden = false;
    window.clearTimeout(toastTimer);
    window.requestAnimationFrame(function () { box.classList.add('is-show'); });
    toastTimer = window.setTimeout(function () {
      box.classList.remove('is-show');
      window.setTimeout(function () { box.hidden = true; }, 220);
    }, 3800);
  }

  /* 根元素只放实际值；light / dark / auto 的偏好存在 data-lc-mode-pref，
     auto 由外壳解析系统偏好，渲染和预览只读实际值。 */
  function themeNow() {
    return document.documentElement.getAttribute('data-lc-mode') === 'dark' ? 'dark' : 'light';
  }

  function systemMode() {
    /* auto 只回退到默认主题的亮色，不按系统偏好猜暗色。 */
    return 'light';
  }

  function modePref() {
    var pref = document.documentElement.getAttribute('data-lc-mode-pref');
    return pref === 'light' || pref === 'dark' ? pref : 'auto';
  }

  function setModePref(pref) {
    var root = document.documentElement;
    var next = pref === 'light' || pref === 'dark' ? pref : 'auto';
    root.setAttribute('data-lc-mode-pref', next);
    root.setAttribute('data-lc-mode', next === 'auto' ? systemMode() : next);
    try {
      localStorage.setItem('lowcode-mode', next);
      localStorage.removeItem('lowcode-theme');
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 颜色方案工具 ---------------- */

  function normHex(value, fallback) {
    var v = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
    return fallback;
  }

  function hexToRgb(hex) {
    var v = normHex(hex, '#000000').slice(1);
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
  }

  function rgbToHex(rgb) {
    function p(n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }
    return '#' + p(rgb.r) + p(rgb.g) + p(rgb.b);
  }

  /* t 是 b 的占比：t=0 得到 a，t=1 得到 b */
  function mixColor(a, b, t) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    return rgbToHex({
      r: ca.r + (cb.r - ca.r) * t,
      g: ca.g + (cb.g - ca.g) * t,
      b: ca.b + (cb.b - ca.b) * t
    });
  }

  function paletteById(id) {
    var theme = state.config && state.config.theme;
    var palettes = (theme && theme.palettes) || [];
    return palettes.filter(function (p) { return p.id === id; })[0] || palettes[0] || null;
  }

  function activePalette() {
    var theme = state.config && state.config.theme;
    return paletteById(theme && theme.activePaletteId);
  }

  function derivePalette(colors, mode) {
    var c = colors || {};
    var dark = mode === 'dark';
    var bg = normHex(c.bg, dark ? '#141a1f' : '#f4f0e6');
    var surface = normHex(c.surface, dark ? '#1a2229' : '#fffcf5');
    var ink = normHex(c.ink, dark ? '#e6e2d8' : '#20242a');
    var muted = normHex(c.muted, dark ? '#98a0a6' : '#6b7076');
    var line = normHex(c.line, dark ? '#2a343c' : '#ded6c5');
    var accent = normHex(c.accent, dark ? '#8fb9a1' : '#3e6a56');
    var codeBg = normHex(c.codeBg, dark ? '#151d23' : '#efeade');
    var towardsInk = dark ? '#ffffff' : '#000000';
    return {
      '--bg': bg,
      '--bg-deep': mixColor(bg, ink, dark ? 0.12 : 0.06),
      '--surface': surface,
      '--surface-2': mixColor(surface, bg, 0.55),
      '--surface-3': mixColor(surface, bg, 0.3),
      '--ink': ink,
      '--ink-2': mixColor(ink, bg, 0.16),
      '--muted': mixColor(muted, ink, 0.12),
      '--muted-2': mixColor(muted, bg, 0.28),
      '--line': line,
      '--line-strong': mixColor(line, ink, dark ? 0.5 : 0.45),
      '--accent': accent,
      '--accent-ink': mixColor(accent, towardsInk, dark ? 0.35 : 0.28),
      '--accent-soft': mixColor(accent, bg, 0.86),
      '--accent-line': mixColor(accent, line, 0.5),
      '--code-bg': codeBg,
      /* 填充按钮用的正式令牌：底色与文字成对派生，换色板时按钮跟着走。
         亮色用接近纸白的文字，暗色用接近底色的深字；实测 4 套色板亮暗均 ≥ 5.27:1。 */
      '--lc-color-accent-fill': accent,
      '--lc-color-accent-fill-hover': mixColor(accent, towardsInk, dark ? 0.35 : 0.28),
      '--lc-color-on-accent': dark ? mixColor(bg, ink, 0.12) : mixColor(bg, '#ffffff', 0.9)
    };
  }

  function applyWorkbenchPalette(palOverride) {
    var pal = palOverride || activePalette();
    if (!pal) return;
    var vars = derivePalette(pal[themeNow()], themeNow());
    Object.keys(vars).forEach(function (key) {
      document.documentElement.style.setProperty(key, vars[key]);
    });
  }

  function paletteCss(pal) {
    if (!pal) return '';
    var lines = [];
    ['light', 'dark'].forEach(function (mode) {
      var vars = derivePalette(pal[mode], mode);
      var body = Object.keys(vars).map(function (key) { return '  ' + key + ': ' + vars[key] + ';'; }).join('\n');
      lines.push((mode === 'dark' ? '[data-theme="dark"]' : ':root') + ' {\n' + body + '\n}');
    });
    return lines.join('\n') + '\n' +
      '/* 区块补充样式：图片、按钮、卡片组在导出站里也能正常排 */\n' +
      '.article-body figure { margin: 1.6em 0; }\n' +
      '.article-body figure img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; display: block; }\n' +
      '.article-body figcaption { margin-top: 8px; font-size: 0.84em; color: var(--muted); text-align: center; }\n' +
      '.article-body .lc-img-empty { display: none; }\n' +
      '.article-body .block-button-wrap { margin: 1.4em 0; }\n' +
      '.article-body .block-button-wrap.is-center { text-align: center; }\n' +
      '.article-body .block-button-wrap.is-right { text-align: right; }\n' +
      '.article-body .card-grid .article-card { text-decoration: none; }\n' +
      '/* 预设组件：数据卡片、步骤条、标签组、图文分栏、引用、按钮组、页脚块 */\n' +
      '.article-body .stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 1.4em 0; }\n' +
      '.article-body .stat-card { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 16px 18px; text-align: center; }\n' +
      '.article-body .stat-card b { display: block; font-family: var(--lc-font-serif); font-size: var(--lc-text-2xl); line-height: 1.2; color: var(--accent); }\n' +
      '.article-body .stat-card span { display: block; margin-top: 6px; font-size: 12px; color: var(--muted); }\n' +
      '.article-body .step-list { list-style: none; padding: 0; margin: 1.4em 0; display: grid; gap: 10px; }\n' +
      '.article-body .step-item { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 12px 14px; }\n' +
      '.article-body .step-index { flex: 0 0 26px; width: 26px; height: 26px; line-height: 26px; text-align: center; border-radius: 50%; background: var(--lc-color-accent-fill); color: var(--lc-color-on-accent); font-size: 13px; }\n' +
      '.article-body .step-item strong { display: block; font-size: 14px; color: var(--ink); }\n' +
      '.article-body .step-item p { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }\n' +
      '.article-body .tag-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 1.2em 0; }\n' +
      '.article-body .split { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; align-items: center; margin: 1.5em 0; }\n' +
      '.article-body .split-media img { width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; }\n' +
      '.article-body .split-body h3 { margin-top: 0; }\n' +
      '.article-body .quote-block { border-left: 3px solid var(--accent); background: var(--surface-2); border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 1.4em 0; }\n' +
      '.article-body .quote-block p { margin: 0 0 6px; }\n' +
      '.article-body .quote-block cite { font-style: normal; font-size: 12px; color: var(--muted); }\n' +
      '.article-body .btn-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 1.3em 0; }\n' +
      '.article-body .footer-block { border-top: 1px solid var(--line); padding-top: 16px; margin-top: 2em; color: var(--muted); font-size: 13px; }\n' +
      '.article-body .footer-title { font-weight: 600; color: var(--ink); margin: 0 0 6px; }\n' +
      '.article-body .footer-links { margin: 8px 0 0; }\n' +
      '.article-body .footer-links span { margin: 0 6px; }\n' +
      '/* 容器、嵌套、图片对齐 */\n' +
      '.article-body .lc-container { margin: 1.4em 0; }\n' +
      '.article-body .lc-container-card { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 14px 16px; }\n' +
      '.article-body .lc-container-title { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; margin: 0 0 10px; padding-bottom: 7px; border-bottom: 1px solid var(--line); }\n' +
      '.article-body .lc-container-inner { display: flex; flex-direction: column; gap: 10px; }\n' +
      '.article-body .lc-container-columns .lc-container-inner { display: grid; grid-template-columns: repeat(var(--lc-cols, 2), minmax(0, 1fr)); gap: 14px; }\n' +
      '.article-body .lc-container-accordion { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 4px 14px; }\n' +
      '.article-body .lc-container-accordion summary { cursor: pointer; font-weight: 600; padding: 9px 0; color: var(--ink); }\n' +
      '.article-body .lc-container-accordion .lc-container-inner { padding: 0 0 10px; }\n' +
      '.article-body .lc-figure { margin: 1.2em 0; }\n' +
      '.article-body .lc-figure.is-center { text-align: center; }\n' +
      '.article-body .lc-figure.is-left { text-align: left; }\n' +
      '.article-body .lc-figure.is-right { text-align: right; }\n' +
      '.article-body .lc-figure img { display: inline-block; max-width: 100%; height: auto; }\n';
  }

  /* ---------------- 弹窗 ---------------- */

  function hideModal() {
    var modal = qs('[data-modal]');
    if (!modal) return;
    modal.hidden = true;
    qs('[data-modal-body]').innerHTML = '';
    qs('[data-modal-actions]').innerHTML = '';
  }

  function showModal(options) {
    var modal = qs('[data-modal]');
    qs('[data-modal-title]').textContent = options.title || '确认';
    qs('[data-modal-body]').innerHTML = options.body || '';
    var actions = qs('[data-modal-actions]');
    actions.innerHTML = '';
    (options.actions || []).forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lc-btn ' + (action.kind || '');
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        action.onClick(hideModal);
      });
      actions.appendChild(btn);
    });
    modal.hidden = false;
    var focusable = qs('input, select, textarea, button', qs('[data-modal-body]'));
    if (focusable) focusable.focus();
  }

  function confirmDialog(options) {
    showModal({
      title: options.title || '确认',
      body: '<p>' + options.message + '</p>',
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: options.confirmLabel || '删除',
          kind: options.danger === false ? 'lc-btn-primary' : 'lc-btn-danger',
          onClick: function (close) {
            Promise.resolve(options.onConfirm()).then(function () { close(); });
          }
        }
      ]
    });
  }

  /* ---------------- IndexedDB ---------------- */

  function reqPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB 操作失败')); };
    });
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_CONFIG)) db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_ARTICLES)) db.createObjectStore(STORE_ARTICLES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_BUILDS)) db.createObjectStore(STORE_BUILDS, { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('打不开 IndexedDB')); };
    });
  }

  function dbGetAll(store) {
    var tx = state.db.transaction(store, 'readonly');
    return reqPromise(tx.objectStore(store).getAll());
  }

  function dbGet(store, key) {
    var tx = state.db.transaction(store, 'readonly');
    return reqPromise(tx.objectStore(store).get(key));
  }

  function dbPut(store, value) {
    return new Promise(function (resolve, reject) {
      var tx = state.db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('写入失败')); };
      tx.onabort = function () { reject(tx.error || new Error('写入被中止')); };
    });
  }

  function dbAdd(store, value) {
    return new Promise(function (resolve, reject) {
      var tx = state.db.transaction(store, 'readwrite');
      var request = tx.objectStore(store).add(value);
      var key = null;
      request.onsuccess = function () { key = request.result; };
      tx.oncomplete = function () { resolve(key); };
      tx.onerror = function () { reject(tx.error || new Error('写入失败')); };
      tx.onabort = function () { reject(tx.error || new Error('写入被中止')); };
    });
  }

  function dbDelete(store, key) {
    return new Promise(function (resolve, reject) {
      var tx = state.db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('删除失败')); };
      tx.onabort = function () { reject(tx.error || new Error('删除被中止')); };
    });
  }

  function dbClear(store) {
    return new Promise(function (resolve, reject) {
      var tx = state.db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('清空失败')); };
      tx.onabort = function () { reject(tx.error || new Error('清空被中止')); };
    });
  }

  function writeError(err) {
    if (err && err.name === 'QuotaExceededError') {
      return '浏览器存储配额不够了。先删几个旧构建版本，或者把当前数据导出成 zip 备份，再继续写。';
    }
    return '写入本机数据库失败：' + (err && err.message ? err.message : '未知错误');
  }

  /* ---------------- 数据查询与排序 ---------------- */

  function directionById(id) {
    return (state.config.directions || []).filter(function (d) { return d.id === id; })[0] || null;
  }

  function seriesById(id) {
    return (state.config.series || []).filter(function (s) { return s.id === id; })[0] || null;
  }

  function topicById(id) {
    return (state.config.topics || []).filter(function (t) { return t.id === id; })[0] || null;
  }

  function topicsFor(directionId, seriesId) {
    return (state.config.topics || []).filter(function (t) {
      return t.directionId === directionId && (!seriesId || t.seriesId === seriesId);
    }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function pathFor(article) {
    var d = directionById(article.directionId);
    var s = seriesById(article.seriesId);
    var t = topicById(article.topicId);
    if (!d || !s || !t) return '';
    return 'articles/' + d.id + '/' + s.id + '/' + t.slug + '/' + article.slug + '.html';
  }

  function articleOrder(a, b) {
    var da = (directionById(a.directionId) || {}).order || 0;
    var db = (directionById(b.directionId) || {}).order || 0;
    if (da !== db) return da - db;
    var sa = (seriesById(a.seriesId) || {}).order || 0;
    var sb = (seriesById(b.seriesId) || {}).order || 0;
    if (sa !== sb) return sa - sb;
    var ta = (topicById(a.topicId) || {}).order || 0;
    var tb = (topicById(b.topicId) || {}).order || 0;
    if (ta !== tb) return ta - tb;
    if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  }

  function sortedArticles() {
    return state.articles.slice().sort(articleOrder);
  }

  function currentArticle() {
    return state.articles.filter(function (a) { return a.id === state.currentId; })[0] || null;
  }

  function articlesInTopic(topicId) {
    return sortedArticles().filter(function (a) { return a.topicId === topicId; });
  }

  function minutesOf(prepared) {
    var len = (prepared.text || '').replace(/\s+/g, '').length;
    return Math.max(3, Math.round(len / 380));
  }

  function articleBodyHtml(article, prefix) {
    if (article && Array.isArray(article.blocks) && article.blocks.length) {
      return renderBlocksWithPrefix(article.blocks, prefix || '');
    }
    return (article && article.body) || '';
  }

  function prepareArticle(article, prefix) {
    var wrap = document.createElement('div');
    wrap.innerHTML = articleBodyHtml(article, prefix);
    var headings = Array.prototype.slice.call(wrap.querySelectorAll('h2, h3')).filter(function (el) {
      return el.closest('.article-body') === wrap || wrap.contains(el);
    });
    var index = 0;
    headings.forEach(function (h) {
      if (!h.id) {
        index += 1;
        h.id = 'section-' + index;
      }
    });
    var sections = [];
    headings.forEach(function (h, i) {
      var next = headings[i + 1] || null;
      var text = '';
      var node = h.nextSibling;
      while (node && node !== next) {
        text += ' ' + (node.textContent || '');
        node = node.nextSibling;
      }
      sections.push({
        id: h.id,
        title: (h.textContent || '').replace(/\s+/g, ' ').trim(),
        text: text.replace(/\s+/g, ' ').trim()
      });
    });
    return {
      bodyHtml: wrap.innerHTML,
      text: (wrap.textContent || '').replace(/\s+/g, ' ').trim(),
      sections: sections
    };
  }

  /* ============================================================
     区块模型与 Markdown 渲染
     正文不再是一个大 textarea，而是一串可拖拽的区块。
     文本类区块里写 Markdown，导出时转成主站同款 HTML。
     ============================================================ */

  var BLOCK_DEFS = [
    {
      type: 'heading', name: '标题', hint: '二级或三级标题，导出时自动带 section-N 锚点。',
      defaults: function () { return { text: '新的一节', level: 2 }; }
    },
    {
      type: 'paragraph', name: '正文段落', hint: '支持 Markdown：加粗、链接、列表、表格、代码块。',
      defaults: function () {
        return { md: '在这里写一段正文。术语第一次出现时，就地把它的意思讲清楚。支持 **加粗**、[链接](https://example.com)、列表和表格。' };
      }
    },
    {
      type: 'cards', name: '卡片组', hint: '2–3 张并排卡片，适合放入口、要点或推荐阅读。',
      defaults: function () {
        return {
          columns: 3,
          cards: [
            { title: '要点一', body: '一句话说明它是什么、解决什么问题。', href: '' },
            { title: '要点二', body: '一句话说明它是什么、解决什么问题。', href: '' },
            { title: '要点三', body: '一句话说明它是什么、解决什么问题。', href: '' }
          ]
        };
      }
    },
    {
      type: 'image', name: '图片', hint: '可以本地选图（存成 data URL），也可以填图片地址；导出后不依赖原图路径。',
      defaults: function () { return { src: '', alt: '', caption: '', width: '', height: '', align: 'center' }; }
    },
    {
      type: 'divider', name: '分隔线', hint: '把两种不同性质的内容隔开。',
      defaults: function () { return {}; }
    },
    {
      type: 'button', name: '按钮', hint: '指向站内页面或外部链接。',
      defaults: function () { return { label: '了解更多', href: '#', variant: 'primary', align: 'left' }; }
    },
    {
      type: 'code', name: '代码块', hint: '代码按原文转义输出，不会当成 HTML 执行。',
      defaults: function () { return { lang: 'javascript', code: 'const list = [1, 2, 3];\nconsole.log(list.map((n) => n * 2));' }; }
    },
    {
      type: 'note', name: '提示 / 警告', hint: '补充容易忽略的细节，或者标出真的会出问题的地方。',
      defaults: function () { return { variant: 'info', title: '提示', md: '这里补充一个容易被忽略的细节。' }; }
    },
    {
      type: 'markdown', name: 'Markdown 长文', hint: '一整段 Markdown，适合从旧稿迁移。',
      defaults: function () { return { md: '## 小节标题\n\n正文可以分多段写，也支持列表：\n\n- 第一条\n- 第二条\n\n| 场景 | 做法 |\n| --- | --- |\n| 数据量小 | 直接渲染 |\n' }; }
    },
    {
      type: 'html', name: '原始 HTML', hint: '直接写 HTML，导出时不转义。适合放主站已有的复杂组件。',
      defaults: function () { return { html: '<div class="note note-info">这里可以直接写主站现成的 HTML 组件。</div>' }; }
    },
    {
      type: 'articleList', name: '文章列表（自动）', hint: '按当前文章数据生成列表，导出时展开成真实链接。',
      defaults: function () { return { limit: 0 }; }
    },
    {
      type: 'container', name: '容器', hint: '装别的区块：卡片容器、分栏或折叠面板，可以无限嵌套。拖动时对准容器中间是“放进去”，靠近上下边缘是“放在前后”。',
      defaults: function () { return { variant: 'card', title: '容器标题', columns: 2, blocks: [] }; }
    }
  ];

  function blockDef(type) {
    return BLOCK_DEFS.filter(function (d) { return d.type === type; })[0] || null;
  }

  function componentById(id) {
    return ((state.config && state.config.components) || []).filter(function (c) { return c.id === id; })[0] || null;
  }

  function fieldsFromTemplate(template) {
    var keys = [];
    var re = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
    var m;
    while ((m = re.exec(template || ''))) {
      if (keys.indexOf(m[1]) === -1) keys.push(m[1]);
    }
    return keys;
  }

  function newBlock(type, extra) {
    var def = blockDef(type);
    var block = { id: uid('b'), type: type };
    if (def) block = Object.assign(block, def.defaults());
    if (type === 'component') {
      block.componentId = (extra && extra.componentId) || ((state.config.components || [])[0] || {}).id || '';
      var comp = componentById(block.componentId);
      block.fields = {};
      fieldsFromTemplate(comp ? comp.template : '').forEach(function (key) {
        block.fields[key] = (extra && extra.fields && extra.fields[key]) || '';
      });
    }
    return Object.assign(block, extra || {});
  }

  function isContainerBlock(block) {
    return !!block && block.type === 'container';
  }

  function walkBlockTree(blocks, visitor, depth, parentBlock, ancestors) {
    (blocks || []).forEach(function (block, index) {
      var info = {
        block: block,
        list: blocks,
        index: index,
        depth: depth || 0,
        parent: parentBlock || null,
        ancestors: (ancestors || []).slice()
      };
      visitor(info);
      if (isContainerBlock(block)) {
        walkBlockTree(block.blocks || [], visitor, (depth || 0) + 1, block, info.ancestors.concat([block]));
      }
    });
  }

  function findBlockContext(id) {
    var found = null;
    if (!id) return null;
    walkBlockTree(state.blocks, function (info) {
      if (!found && info.block.id === id) found = info;
    });
    return found;
  }

  function countBlockTree(blocks) {
    var total = 0;
    walkBlockTree(blocks, function () { total += 1; });
    return total;
  }

  function blockContainsBlock(containerBlock, id) {
    var hit = false;
    walkBlockTree((containerBlock && containerBlock.blocks) || [], function (info) {
      if (info.block.id === id) hit = true;
    });
    return hit;
  }

  function cloneBlockTree(block) {
    var copy = clone(block);
    function reid(node) {
      node.id = uid('b');
      if (isContainerBlock(node)) (node.blocks || []).forEach(reid);
    }
    reid(copy);
    return copy;
  }

  function mdInline(value) {
    var out = esc(value);
    var codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, code) {
      codes.push(code);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+|#[^)\s]*|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return '<code>' + codes[Number(i)] + '</code>';
    });
    return out;
  }

  function isBlockStart(line) {
    var t = line.trim();
    return !t || /^```/.test(t) || /^#{1,4}\s/.test(t) || /^>\s?/.test(t) ||
      /^([-*+]|\d+\.)\s+/.test(t) || /^\|.*\|\s*$/.test(t);
  }

  function mdToHtml(markdown) {
    var lines = String(markdown == null ? '' : markdown).replace(/\r\n/g, '\n').split('\n');
    var html = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) { i += 1; continue; }

      /* 代码块 */
      if (/^```/.test(trimmed)) {
        var lang = trimmed.slice(3).trim();
        i += 1;
        var codeLines = [];
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        /* mermaid / mmd 交给外部渲染器适配层，渲染层本身不依赖 mermaid 包 */
        if (window.LC && window.LC.Mermaid && window.LC.Mermaid.isFenceLang(lang)) {
          html.push(window.LC.Mermaid.renderCode(codeLines.join('\n')));
        } else {
          html.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(codeLines.join('\n')) + '</code></pre>');
        }
        continue;
      }

      /* 标题 */
      var h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
      if (h) {
        var level = h[1].length;
        if (level < 2) level = 2;
        if (level > 4) level = 4;
        html.push('<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>');
        i += 1;
        continue;
      }

      /* 引用 */
      if (/^>\s?/.test(trimmed)) {
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i += 1;
        }
        html.push('<blockquote><p>' + mdInline(quoteLines.join(' ')) + '</p></blockquote>');
        continue;
      }

      /* 表格 */
      if (/^\|.*\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1].trim())) {
        var cells = function (row) {
          return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var head = cells(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i].trim())) {
          rows.push(cells(lines[i]));
          i += 1;
        }
        html.push('<table>\n<thead><tr>' + head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') + '</tr></thead>\n' +
          '<tbody>' + rows.map(function (row) {
            return '<tr>' + row.map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody>\n</table>');
        continue;
      }

      /* 列表 */
      var listMatch = /^([-*+]|\d+\.)\s+/.exec(trimmed);
      if (listMatch) {
        var ordered = /\d+\./.test(listMatch[1]);
        var items = [];
        while (i < lines.length && /^([-*+]|\d+\.)\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^([-*+]|\d+\.)\s+/, ''));
          i += 1;
        }
        var tag = ordered ? 'ol' : 'ul';
        html.push('<' + tag + '>' + items.map(function (item) { return '<li>' + mdInline(item) + '</li>'; }).join('') + '</' + tag + '>');
        continue;
      }

      /* 普通段落：收集到空行或下一个块开始 */
      var para = [trimmed];
      i += 1;
      while (i < lines.length && !isBlockStart(lines[i])) {
        para.push(lines[i].trim());
        i += 1;
      }
      html.push('<p>' + mdInline(para.join(' ')) + '</p>');
    }

    return html.join('\n');
  }

  function blockTitle(block) {
    if (!block) return '区块';
    if (block.type === 'component') {
      var comp = componentById(block.componentId);
      return '自定义：' + (comp ? comp.name : '已删除的组件');
    }
    if (block.type === 'container') {
      var variantName = { card: '卡片容器', columns: '分栏容器', accordion: '折叠面板' }[block.variant] || '容器';
      return variantName + (block.title ? ' · ' + block.title : '');
    }
    var def = blockDef(block.type);
    return def ? def.name : block.type;
  }

  function cssSize(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/^\d+(\.\d+)?$/.test(raw)) return raw + 'px';
    if (/^\d+(\.\d+)?(px|%|em|rem|vw|vh)$/.test(raw)) return raw;
    return '';
  }

  function renderComponentBlock(block) {
    var comp = componentById(block.componentId);
    if (!comp) {
      return '<div class="note note-warn">这个自定义组件已经被删除，区块内容暂时为空。到「组件库」重新建一个，或者删掉这个区块。</div>';
    }
    var html = comp.template || '';
    var fields = block.fields || {};
    (comp.fields || fieldsFromTemplate(comp.template)).forEach(function (key) {
      html = html.split('{{' + key + '}}').join(esc(fields[key] == null ? '' : fields[key]));
    });
    return '<div class="lc-comp-scope" data-comp-scope="' + esc(comp.id) + '" data-comp-instance="' + esc(block.id) + '">' +
      html + '</div>';
  }

  function scopeComponentCss(css, compId) {
    var text = String(css || '').trim();
    if (!text) return '';
    var scope = '[data-comp-scope="' + compId + '"]';
    var sheet;
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
    } catch (e) {
      return text;
    }
    function scopeSelector(sel) {
      sel = String(sel || '').trim();
      if (!sel) return scope;
      if (sel === ':root' || sel === 'html' || sel === 'body') return scope;
      return scope + ' ' + sel;
    }
    function walk(rules) {
      return Array.prototype.map.call(rules, function (rule) {
        if (rule.selectorText) {
          return rule.selectorText.split(',').map(scopeSelector).join(', ') + ' {' + rule.style.cssText + '}';
        }
        if (rule.media) {
          return '@media ' + rule.media.mediaText + ' {\n' + walk(rule.cssRules) + '\n}';
        }
        if (rule.conditionText) {
          return '@supports ' + rule.conditionText + ' {\n' + walk(rule.cssRules) + '\n}';
        }
        return rule.cssText;
      }).join('\n');
    }
    return walk(sheet.cssRules);
  }

  function componentCssAll() {
    return ((state.config && state.config.components) || []).map(function (comp) {
      return scopeComponentCss(comp.css, comp.id);
    }).filter(Boolean).join('\n\n');
  }

  function siteThemeCss() {
    return paletteCss(activePalette()) + '\n' + componentCssAll();
  }

  function usedComponentScripts(blocks) {
    var list = [];
    walkBlockTree(blocks || [], function (info) {
      if (info.block.type !== 'component') return;
      var comp = componentById(info.block.componentId);
      if (comp && String(comp.js || '').trim()) list.push({ block: info.block, comp: comp });
    });
    return list;
  }

  function componentScriptsHtml(blocks) {
    var items = usedComponentScripts(blocks);
    if (!items.length) return '';
    return items.map(function (item) {
      var js = String(item.comp.js || '').replace(/<\/script/gi, '<\\/script');
      return '<script>(function(){var root=document.querySelector(\'[data-comp-instance="' + item.block.id + '"]\');' +
        'if(!root)return;try{\n' + js + '\n}catch(e){console.error("组件 ' + item.comp.id + ' 脚本出错",e);}})();<\/script>\n';
    }).join('');
  }

  function renderBlockHtml(block, options) {
    var opts = options || {};
    if (!block) return '';
    switch (block.type) {
      case 'heading':
        var level = block.level === 3 ? 3 : 2;
        return '<h' + level + '>' + mdInline(block.text || '（无标题）') + '</h' + level + '>';
      case 'paragraph':
      case 'markdown':
        return mdToHtml(block.md || '');
      case 'cards':
        var cards = block.cards || [];
        return '<div class="card-grid">' + cards.map(function (card) {
          var href = String(card.href || '').trim();
          var inner = '<p class="card-title">' + mdInline(card.title || '未命名卡片') + '</p>' +
            '<p>' + mdInline(card.body || '') + '</p>';
          return href ? '<a class="article-card" href="' + esc(href) + '">' + inner + '</a>' : '<div class="article-card">' + inner + '</div>';
        }).join('') + '</div>';
      case 'image':
        if (!block.src) {
          return opts.canvas ? '<div class="lc-img-empty">图片区块：在右侧选择本地图片，或填图片地址</div>' : '';
        }
        var width = cssSize(block.width);
        var height = cssSize(block.height);
        var alignName = block.align === 'left' ? 'left' : (block.align === 'right' ? 'right' : 'center');
        var style = (width ? 'width:' + width + ';' : '') + (height ? 'height:' + height + ';' : '') +
          (width || height ? 'max-width:100%;' : '') + (height ? 'object-fit:cover;' : '');
        return '<figure class="lc-figure is-' + alignName + '"><img src="' + esc(block.src) + '" alt="' + esc(block.alt || '') + '"' +
          (style ? ' style="' + esc(style) + '"' : '') + '>' +
          (block.caption ? '<figcaption>' + esc(block.caption) + '</figcaption>' : '') + '</figure>';
      case 'divider':
        return '<hr>';
      case 'button':
        var align = block.align === 'center' ? ' is-center' : (block.align === 'right' ? ' is-right' : '');
        var cls = block.variant === 'plain' ? 'btn' : 'btn btn-primary';
        return '<div class="block-button-wrap' + align + '"><a class="' + cls + '" href="' + esc(block.href || '#') + '">' +
          esc(block.label || '按钮') + '</a></div>';
      case 'code':
        return '<pre><code' + (block.lang ? ' class="language-' + esc(block.lang) + '"' : '') + '>' + esc(block.code || '') + '</code></pre>';
      case 'note':
        var warn = block.variant === 'warn';
        return '<div class="note ' + (warn ? 'note-warn' : 'note-info') + '">' +
          (block.title ? '<strong>' + esc(block.title) + '</strong>' : '') + mdToHtml(block.md || '') + '</div>';
      case 'html':
        return block.html || '';
      case 'articleList':
        var list = state.articles.slice().sort(function (a, b) {
          return (a.order || 0) - (b.order || 0);
        });
        if (Number(block.limit) > 0) list = list.slice(0, Number(block.limit));
        var prefix = opts.prefix || '';
        if (!list.length) return '<div class="note note-info"><p>站点里还没有文章。</p></div>';
        return '<div class="lc-article-list">' + list.map(function (a) {
          var topic = topicById(a.topicId);
          var dir = directionById(a.directionId);
          return '<a class="article-card" href="' + prefix + pathFor(a) + '">' +
            '<span class="lc-art-kicker">' + esc(dir ? dir.name : '未分类') + (topic ? ' · ' + esc(topic.name) : '') + '</span>' +
            '<strong class="card-title">' + esc(a.title || '未命名文章') + '</strong>' +
            '<span class="lc-art-summary">' + esc(a.summary || '') + '</span>' +
            '</a>';
        }).join('') + '</div>';
      case 'component':
        return renderComponentBlock(block);
      case 'container':
        var children = renderBlocksWithPrefix(block.blocks || [], opts.prefix || '');
        var titleHtml = block.title ? '<div class="lc-container-title">' + esc(block.title) + '</div>' : '';
        if (block.variant === 'accordion') {
          return '<details class="lc-container lc-container-accordion"' + (block.open === false ? '' : ' open') + '>' +
            '<summary>' + esc(block.title || '折叠面板') + '</summary>' +
            '<div class="lc-container-inner">' + children + '</div></details>';
        }
        if (block.variant === 'columns') {
          var cols = Math.max(1, Math.min(4, Number(block.columns) || 2));
          return '<section class="lc-container lc-container-columns" style="--lc-cols:' + cols + '">' + titleHtml +
            '<div class="lc-container-inner">' + children + '</div></section>';
        }
        return '<section class="lc-container lc-container-card">' + titleHtml +
          '<div class="lc-container-inner">' + children + '</div></section>';
      default:
        return '';
    }
  }

  function renderBlocks(blocks) {
    return renderBlocksWithPrefix(blocks, '');
  }

  function renderBlocksWithPrefix(blocks, prefix) {
    return (blocks || []).map(function (block) { return renderBlockHtml(block, { canvas: false, prefix: prefix }); })
      .filter(function (html) { return html && html.trim(); }).join('\n');
  }

  function htmlToBlocks(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html || '';
    var blocks = [];
    Array.prototype.slice.call(wrap.children).forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'h2' || tag === 'h3') {
        var text = (el.textContent || '').trim();
        if (text) blocks.push({ id: uid('b'), type: 'heading', text: text, level: tag === 'h3' ? 3 : 2 });
        return;
      }
      if (tag === 'p') {
        var pt = (el.textContent || '').trim();
        if (pt) blocks.push({ id: uid('b'), type: 'paragraph', md: pt });
        return;
      }
      if (!el.outerHTML || !el.outerHTML.trim()) return;
      blocks.push({ id: uid('b'), type: 'html', html: el.outerHTML });
    });
    return blocks;
  }

  /* ---------------- 自定义页面 ---------------- */

  function pagePath(page) {
    if (!page) return '';
    var path = String(page.path || '').trim();
    if (path) return path.replace(/^\/+/, '');
    return (String(page.slug || 'page').trim() || 'page') + '.html';
  }

  function pageDepth(page) {
    return Math.max(0, pagePath(page).split('/').length - 1);
  }

  function pagesSorted() {
    return ((state.config && state.config.pages) || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
  }

  function navPages() {
    return pagesSorted().filter(function (p) { return p.nav !== false; });
  }

  function pagesForExport() {
    return pagesSorted().filter(function (p) { return pagePath(p); });
  }

  function buildCatalog() {
    return sortedArticles().map(function (a) {
      var d = directionById(a.directionId);
      var s = seriesById(a.seriesId);
      var t = topicById(a.topicId);
      var prepared = prepareArticle(a);
      return {
        slug: a.slug,
        title: a.title,
        url: pathFor(a),
        summary: a.summary || '',
        direction: a.directionId,
        directionName: d ? d.name : a.directionId,
        series: a.seriesId,
        seriesName: s ? s.name : a.seriesId,
        topic: t ? t.slug : '',
        topicName: t ? t.name : '',
        group: t ? t.slug : '',
        groupName: t ? t.name : '',
        difficulty: a.difficulty || '入门',
        tags: a.tags || [],
        order: a.order || 0,
        minutes: minutesOf(prepared)
      };
    }).filter(function (item) { return item.url; });
  }

  function buildDirections(catalog) {
    return (state.config.directions || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    }).map(function (d) {
      var count = catalog.filter(function (a) { return a.direction === d.id; }).length;
      return { id: d.id, name: d.name, intro: d.intro || '', order: d.order || 0, live: count > 0, count: count };
    });
  }

  function buildRoutes(catalog) {
    var routes = [];
    (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (d) {
      SERIES.forEach(function (s) {
        var items = catalog.filter(function (a) { return a.direction === d.id && a.series === s.id; });
        if (!items.length) return;
        routes.push({
          id: d.id + '-' + s.id,
          name: d.name + ' · ' + s.name,
          direction: d.id,
          intro: '按主题和排序读完 ' + d.name + '的' + s.name + '篇目，共 ' + items.length + ' 篇。难度只标在具体文章上，路线本身不分级。',
          steps: items.map(function (a) {
            return { slug: a.slug, title: a.title, meta: a.difficulty + ' · 约 ' + a.minutes + ' 分钟', pending: false };
          })
        });
      });
    });
    return routes;
  }

  function buildSearchIndex(catalog) {
    return catalog.map(function (item) {
      var article = state.articles.filter(function (a) { return a.slug === item.slug; })[0];
      var prepared = article ? prepareArticle(article) : { text: '', sections: [] };
      return {
        slug: item.slug,
        title: item.title,
        url: item.url,
        summary: item.summary,
        direction: item.direction,
        directionName: item.directionName,
        series: item.series,
        seriesName: item.seriesName,
        topic: item.topic,
        topicName: item.topicName,
        group: item.group,
        groupName: item.groupName,
        difficulty: item.difficulty,
        tags: item.tags,
        minutes: item.minutes,
        sections: prepared.sections,
        text: prepared.text
      };
    });
  }

  function nextVersion() {
    var last = state.builds[0];
    if (!last || !last.version) return 'v1.0.0';
    var m = String(last.version).match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return last.version;
    return 'v' + m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);
  }

  function nextSlug(base) {
    var used = {};
    state.articles.forEach(function (a) { used[a.slug] = true; });
    var root = base || 'article';
    var n = 1;
    while (used[root + '-' + n]) n += 1;
    return root + '-' + n;
  }

  function nextOrder(topicId) {
    var max = 0;
    articlesInTopic(topicId).forEach(function (a) { max = Math.max(max, a.order || 0); });
    return max + 1;
  }

  /* ---------------- 导入 / 初始化 ---------------- */

  function seedIfNeeded() {
    return dbGet(STORE_CONFIG, CONFIG_KEY).then(function (config) {
      if (config) return false;
      return dbPut(STORE_CONFIG, clone(DEFAULT_CONFIG)).then(function () {
        return dbPut(STORE_ARTICLES, {
          id: SEED_ARTICLE_ID,
          slug: 'welcome',
          title: '欢迎使用这个建站器',
          directionId: 'guide',
          seriesId: 'basics',
          topicId: SEED_TOPIC_ID,
          difficulty: '入门',
          tags: ['开始', '说明'],
          summary: '这篇示例文章说明数据存在哪、正文能写什么、导出包长什么样。不需要就删掉。',
          body: SEED_BODY,
          order: 1,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }).then(function () { return true; });
    });
  }

  function loadAll() {
    return Promise.all([
      dbGet(STORE_CONFIG, CONFIG_KEY),
      dbGetAll(STORE_ARTICLES),
      dbGetAll(STORE_BUILDS)
    ]).then(function (result) {
      state.config = result[0];
      state.articles = result[1] || [];
      state.builds = (result[2] || []).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      normalizeConfig();
    });
  }

  function normalizeConfig() {
    var config = state.config;
    if (!config) return;
    if (!config.series || !config.series.length) config.series = SERIES.slice();
    if (!config.directions) config.directions = [];
    if (!config.topics) config.topics = [];
    if (!Array.isArray(config.pages)) config.pages = [];
    if (!Array.isArray(config.components) || !config.components.length) config.components = clone(DEFAULT_COMPONENTS);
    if ((config.componentsVersion || 1) < 2) {
      DEFAULT_COMPONENTS.forEach(function (def) {
        if (!config.components.some(function (c) { return c.id === def.id; })) config.components.push(clone(def));
      });
      config.componentsVersion = 2;
    }
    if (!config.theme || !Array.isArray(config.theme.palettes) || !config.theme.palettes.length) {
      config.theme = { activePaletteId: 'ink-green', palettes: clone(BUILTIN_PALETTES) };
    } else {
      BUILTIN_PALETTES.forEach(function (builtin) {
        if (!config.theme.palettes.some(function (p) { return p.id === builtin.id; })) {
          config.theme.palettes.push(clone(builtin));
        }
      });
      if (!paletteById(config.theme.activePaletteId)) config.theme.activePaletteId = config.theme.palettes[0].id;
    }
    state.config.pages.forEach(function (page) {
      if (!Array.isArray(page.blocks)) page.blocks = htmlToBlocks(page.body || '');
      if (page.nav == null) page.nav = true;
    });
  }

  function init() {
    bindShell();
    bindSettings();
    bindBuilds();
    bindExport();
    bindComponents();
    bindPalette();

    openDb().then(function (db) {
      state.db = db;
      return seedIfNeeded();
    }).then(function () {
      return loadAll();
    }).then(function () {
      applyWorkbenchPalette();
      renderAll();
      ensureZipLib();
      updateStorage();
      window.setInterval(updateStorage, 15000);
    }).catch(function (err) {
      console.error(err);
      toast('初始化失败：' + (err && err.message ? err.message : '浏览器可能不支持 IndexedDB'), true);
      showFatal(err);
    });
  }

  function showFatal(err) {
    var empty = qs('[data-editor-empty]');
    if (empty) {
      empty.innerHTML = '<h2>本机数据库打不开</h2><p>' + esc(err && err.message ? err.message : '浏览器不支持 IndexedDB') +
        '</p><p>换一个现代浏览器，或确认没有处于无痕模式（部分浏览器的无痕模式会禁用本地数据库）。</p>';
    }
  }

  function renderPages() {
    var host = qs('[data-page-list]');
    if (!host) return;
    var pages = pagesSorted();
    var total = qs('[data-page-total]');
    if (total) total.textContent = String(pages.length);
    if (!pages.length) {
      host.innerHTML = '<p class="lc-tree-empty">还没有自定义页面。新建后可以配 slug 和导出路径，并放进导航。</p>';
      return;
    }
    host.innerHTML = pages.map(function (page) {
      var active = state.doc && state.doc.kind === 'page' && state.doc.id === page.id;
      return '<button class="lc-page-item' + (active ? ' is-active' : '') + '" type="button" data-open-page="' + esc(page.id) + '">' +
        '<span>' + esc(page.title || '未命名页面') + '</span><em>' + esc(pagePath(page)) + '</em></button>';
    }).join('');
    renderExportSummary();
  }

  function renderAll() {
    renderTree();
    renderPages();
    renderSettings();
    renderBuilds();
    renderExportSummary();
    renderComponents();
    renderPaletteList();
    renderQuickLib();
    if (state.doc) {
      setDocHeader();
      renderCanvas();
      renderInspector();
    } else {
      renderInspector();
    }
    updateOutline();
    renderPreviewSoon();
  }

  /* ---------------- 顶栏 / 主题 / 视图 ---------------- */

  function bindShell() {
    qsa('.lc-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchView(tab.getAttribute('data-view'));
      });
    });

    qs('[data-theme-toggle]').addEventListener('click', function () {
      var pref = modePref();
      setModePref(pref === 'light' ? 'dark' : (pref === 'dark' ? 'auto' : 'light'));
      applyWorkbenchPalette();
      paintThemeLabel();
      renderPreviewSoon();
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onSystemMode = function () {
        if (modePref() !== 'auto') return;
        document.documentElement.setAttribute('data-lc-mode', systemMode());
        applyWorkbenchPalette();
        paintThemeLabel();
        renderPreviewSoon();
      };
      if (mq.addEventListener) mq.addEventListener('change', onSystemMode);
      else if (mq.addListener) mq.addListener(onSystemMode);
    }

    applyWorkbenchPalette();
    paintThemeLabel();

    qs('[data-storage-chip]').addEventListener('click', function () {
      switchView('builds');
      var panel = qs('.lc-storage-panel');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    qsa('[data-new-article]').forEach(function (btn) {
      btn.addEventListener('click', function () { createArticle(); });
    });
    qsa('[data-new-page]').forEach(function (btn) {
      btn.addEventListener('click', function () { createPage(); });
    });
    var goSettings = qs('[data-go-settings]');
    if (goSettings) goSettings.addEventListener('click', function () { switchView('settings'); });
    var goComponents = qs('[data-go-components]');
    if (goComponents) goComponents.addEventListener('click', function () { switchView('components'); });

    qs('[data-page-list]').addEventListener('click', function (e) {
      var open = e.target.closest('[data-open-page]');
      if (open) openPage(open.getAttribute('data-open-page'));
    });

    qs('[data-tree-search]').addEventListener('input', function (e) {
      state.treeQuery = e.target.value.trim().toLowerCase();
      renderTree();
    });

    qs('[data-tree]').addEventListener('click', function (e) {
      var addTopic = e.target.closest('[data-add-topic-for]');
      if (addTopic) {
        var dId = addTopic.getAttribute('data-direction');
        var sId = addTopic.getAttribute('data-series');
        openTopicModal(dId, sId);
        return;
      }
      var addArticle = e.target.closest('[data-new-article-in]');
      if (addArticle) {
        createArticle(addArticle.getAttribute('data-direction'), addArticle.getAttribute('data-series'), addArticle.getAttribute('data-topic'));
        return;
      }
      var open = e.target.closest('[data-open-article]');
      if (open) openArticle(open.getAttribute('data-open-article'));
    });

    qs('[data-modal]').addEventListener('click', function (e) {
      if (e.target.closest('[data-modal-close]')) hideModal();
    });
    document.addEventListener('keydown', function (e) {
      var modal = qs('[data-modal]');
      if (e.key === 'Escape') {
        if (modal && !modal.hidden) { hideModal(); return; }
        if (state.doc) { state.selectedBlockId = null; renderCanvas(); renderInspector(); }
      }
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        if (state.doc) {
          e.preventDefault();
          saveCurrentDoc(false);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (!state.doc) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (!state.doc) return;
        e.preventDefault();
        redo();
        return;
      }
      var typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
      if (typing || !state.doc || !state.selectedBlockId) return;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        nudgeBlock(state.selectedBlockId, e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteBlock(state.selectedBlockId);
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function paintThemeLabel() {
    var label = qs('[data-theme-label]');
    if (!label) return;
    var pref = modePref();
    label.textContent = pref === 'auto' ? '跟随系统' : (themeNow() === 'dark' ? '暗色' : '亮色');
    var toggle = qs('[data-theme-toggle]');
    if (toggle) toggle.setAttribute('title', '切换明暗模式（当前：' + label.textContent + '）');
  }

  function switchView(view) {
    if (!view) return;
    state.view = view;
    qsa('.lc-tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-view') === view);
    });
    qsa('.lc-view').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.id === 'view-' + view);
    });
    if (view === 'settings') renderSettings();
    if (view === 'components') renderComponents();
    if (view === 'theme') renderPaletteList();
    if (view === 'builds') { renderBuilds(); updateStorage(); }
    if (view === 'export') {
      renderExportSummary();
      checkZipAvailability();
      var input = qs('[data-export-version]');
      if (input && !input.value) input.value = nextVersion();
    }
  }

  /* ---------------- 目录树 ---------------- */

  function renderTree() {
    var host = qs('[data-tree]');
    if (!host) return;
    var catalog = buildCatalog();
    var bySlug = {};
    catalog.forEach(function (c) { bySlug[c.slug] = c; });
    var q = state.treeQuery;

    function match(a) {
      if (!q) return true;
      var t = topicById(a.topicId);
      var d = directionById(a.directionId);
      var hay = [a.title, a.slug, (a.tags || []).join(' '), t ? t.name : '', d ? d.name : ''].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    }

    var html = '';
    var dirs = (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var totalVisible = 0;

    dirs.forEach(function (d) {
      var topics = topicsFor(d.id);
      var articles = state.articles.filter(function (a) { return a.directionId === d.id && match(a); });
      var allCount = state.articles.filter(function (a) { return a.directionId === d.id; }).length;
      if (q && !articles.length) return;
      totalVisible += articles.length;
      html += '<div class="lc-tree-dir">';
      html += '<div class="lc-tree-dir-head"><span>' + esc(d.name) + '</span><span class="lc-tree-count">' + allCount + ' 篇</span></div>';
      SERIES.forEach(function (s) {
        var sTopics = topics.filter(function (t) { return t.seriesId === s.id; });
        if (!sTopics.length) return;
        var sArticles = articles.filter(function (a) { return a.seriesId === s.id; });
        if (q && !sArticles.length) return;
        html += '<div class="lc-tree-series"><div class="lc-tree-series-head"><span>' + esc(s.name) + '</span></div>';
        sTopics.forEach(function (t) {
          var list = sArticles.filter(function (a) { return a.topicId === t.id; });
          var visible = q ? list : state.articles.filter(function (a) { return a.topicId === t.id; });
          if (q && !list.length) return;
          html += '<div class="lc-tree-topic"><div class="lc-tree-topic-head"><span>' + esc(t.name) + '</span><em>' + visible.length + '</em></div>';
          visible.forEach(function (a) {
            html += '<button class="lc-tree-article' + (a.id === state.currentId ? ' is-active' : '') + '" type="button" data-open-article="' + esc(a.id) + '">' +
              '<span>' + esc(a.title) + '</span><em>' + esc(a.difficulty || '') + '</em></button>';
          });
          html += '<button class="lc-tree-add" type="button" data-new-article-in data-direction="' + esc(d.id) + '" data-series="' + esc(s.id) + '" data-topic="' + esc(t.id) + '">＋ 文章</button>';
          html += '</div>';
        });
        html += '</div>';
      });
      html += '<button class="lc-tree-add" type="button" data-add-topic-for data-direction="' + esc(d.id) + '" data-series="basics">＋ 主题</button>';
      html += '</div>';
    });

    if (!html) {
      html = '<p class="lc-tree-empty">' + (q ? '没有匹配「' + esc(state.treeQuery) + '」的文章。' : '还没有文章。点上面的「新建文章」开始。') + '</p>';
    }
    host.innerHTML = html;
    var totalEl = qs('[data-article-total]');
    if (totalEl) totalEl.textContent = String(q ? totalVisible : state.articles.length);
    if (q && totalVisible === 0 && dirs.length) {
      host.innerHTML = '<p class="lc-tree-empty">没有匹配「' + esc(state.treeQuery) + '」的文章。</p>';
    }
  }

  /* ---------------- 编辑器 ---------------- */

  function __legacyOpenArticle(id) {
    if (id === state.currentId) return;
    flushSave(true).then(function (ok) {
      if (!ok) return;
      var article = state.articles.filter(function (a) { return a.id === id; })[0];
      if (!article) return;
      state.currentId = id;
      fillEditor(article, true);
      renderTree();
      updateOutline();
      renderPreview();
      window.setTimeout(function () {
        var pane = qs('.lc-workspace');
        if (pane) pane.scrollTop = 0;
      }, 20);
    });
  }

  function __legacyFillEditor(article, resetPreview) {
    var panel = qs('[data-editor-panel]');
    var empty = qs('[data-editor-empty]');
    panel.hidden = false;
    empty.hidden = true;
    qs('[data-article-heading]').textContent = article.title || '未命名文章';
    qs('[data-article-path]').textContent = '/' + (pathFor(article) || '路径不完整');
    qs('[data-field="title"]').value = article.title || '';
    qs('[data-field="slug"]').value = article.slug || '';
    qs('[data-field="difficulty"]').value = article.difficulty || '入门';
    qs('[data-field="order"]').value = article.order || '';
    qs('[data-field="tags"]').value = (article.tags || []).join(',');
    qs('[data-field="summary"]').value = article.summary || '';
    qs('[data-body]').value = article.body || '';

    var dirSel = qs('[data-field="directionId"]');
    dirSel.innerHTML = (state.config.directions || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    }).map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
    }).join('');
    dirSel.value = article.directionId || '';

    var serSel = qs('[data-field="seriesId"]');
    serSel.innerHTML = (state.config.series || []).map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join('');
    serSel.value = article.seriesId || '';

    refreshTopicSelect(article.topicId);
    setSaveState('已保存', false);
    if (resetPreview) renderPreviewSoon();
  }

  function __legacyRefreshTopicSelect(preferred) {
    var dir = qs('[data-field="directionId"]').value;
    var ser = qs('[data-field="seriesId"]').value;
    var sel = qs('[data-field="topicId"]');
    var topics = topicsFor(dir, ser);
    if (!topics.length) {
      sel.innerHTML = '<option value="">（这个方向 / 系列还没有主题）</option>';
      sel.value = '';
      return;
    }
    sel.innerHTML = topics.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + '（' + esc(t.slug) + '）</option>';
    }).join('');
    var pick = preferred || sel.value;
    if (!topics.some(function (t) { return t.id === pick; })) pick = topics[0].id;
    sel.value = pick;
  }

  function setSaveState(text, dirty) {
    var el = qs('[data-save-state]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-dirty', !!dirty);
  }

  function __legacyMarkDirty() {
    state.dirty = true;
    setSaveState('有改动，准备保存…', true);
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(function () {
      saveCurrentArticle(true);
    }, 1000);
  }

  function __legacyReadForm() {
    var tagsRaw = qs('[data-field="tags"]').value || '';
    var tags = tagsRaw.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    var order = Number(qs('[data-field="order"]').value);
    return {
      title: (qs('[data-field="title"]').value || '').trim(),
      slug: (qs('[data-field="slug"]').value || '').trim().toLowerCase(),
      directionId: qs('[data-field="directionId"]').value,
      seriesId: qs('[data-field="seriesId"]').value,
      topicId: qs('[data-field="topicId"]').value,
      difficulty: qs('[data-field="difficulty"]').value,
      tags: tags,
      summary: (qs('[data-field="summary"]').value || '').trim(),
      order: isFinite(order) && order > 0 ? order : 1,
      body: qs('[data-body]').value
    };
  }

  function validateForm(form, articleId) {
    if (!form.title) return '标题不能为空。';
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(form.slug)) {
      return 'slug 只能用小写字母、数字和连字符，且以字母或数字开头，最长 64 个字符。';
    }
    if (!directionById(form.directionId)) return '方向不存在，先在站点设置里建一个。';
    if (!seriesById(form.seriesId)) return '系列不存在。';
    var topic = topicById(form.topicId);
    if (!topic) return '主题不存在，先建主题再写文章。';
    if (topic.directionId !== form.directionId || topic.seriesId !== form.seriesId) {
      return '主题和方向 / 系列对不上，重新选一下主题。';
    }
    var dup = state.articles.filter(function (a) {
      return a.slug === form.slug && a.id !== articleId;
    })[0];
    if (dup) return 'slug「' + form.slug + '」已经被《' + dup.title + '》用了。站点脚本按 slug 识别文章，所以 slug 必须全站唯一。';
    return '';
  }

  function __legacySaveArticle(silent) {
    var article = currentArticle();
    if (!article) return Promise.resolve(true);
    var form = __legacyReadForm();
    var error = validateForm(form, article.id);
    if (error) {
      setSaveState('未保存：' + error, true);
      if (!silent) toast(error, true);
      return Promise.resolve(false);
    }
    var next = Object.assign({}, article, form, { updatedAt: Date.now() });
    return dbPut(STORE_ARTICLES, next).then(function () {
      var idx = state.articles.findIndex(function (a) { return a.id === article.id; });
      if (idx !== -1) state.articles[idx] = next;
      state.dirty = false;
      setSaveState('已保存 · ' + fmtDate(next.updatedAt).slice(11), false);
      qs('[data-article-heading]').textContent = next.title;
      qs('[data-article-path]').textContent = '/' + (pathFor(next) || '路径不完整');
      renderTree();
      renderExportSummary();
      renderPreviewSoon();
      if (!silent) toast('已保存');
      updateStorageSoon();
      return true;
    }).catch(function (err) {
      var message = writeError(err);
      setSaveState('保存失败：' + message, true);
      if (!silent) toast(message, true);
      return false;
    });
  }

  function flushSave(quiet) {
    if (!state.dirty) return Promise.resolve(true);
    window.clearTimeout(state.saveTimer);
    return saveCurrentArticle(quiet !== false);
  }

  function updateStorageSoon() {
    window.setTimeout(updateStorage, 300);
  }

  function createArticle(directionId, seriesId, topicId) {
    flushSave(true).then(function (ok) {
      if (!ok) return;
      var dir = directionId || null;
      var ser = seriesId || null;
      var topic = topicId ? topicById(topicId) : null;
      if (!topic) {
        var found = null;
        (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).some(function (d) {
          var t = topicsFor(d.id)[0];
          if (t) { found = t; dir = d.id; ser = t.seriesId; return true; }
          return false;
        });
        topic = found;
      }
      if (!topic) {
        toast('还没有主题。先去「站点设置」建一个方向和一个主题，再回来写文章。', true);
        switchView('settings');
        return;
      }
      if (!dir) dir = topic.directionId;
      if (!ser) ser = topic.seriesId;
      var article = {
        id: uid('a'),
        slug: nextSlug('article'),
        title: '未命名文章',
        directionId: dir,
        seriesId: ser,
        topicId: topic.id,
        difficulty: '入门',
        tags: [],
        summary: '',
        blocks: [
          { id: uid('b'), type: 'heading', text: '第一节', level: 2 },
          { id: uid('b'), type: 'paragraph', md: '从这儿开始写。段落支持 Markdown，也支持从左侧拖入更多区块。' }
        ],
        body: '<h2 id="section-1">第一节</h2>\n<p>从这儿开始写。</p>',
        order: nextOrder(topic.id),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      dbPut(STORE_ARTICLES, article).then(function () {
        state.articles.push(article);
        state.currentId = article.id;
        state.currentPageId = null;
        state.dirty = false;
        openArticle(article.id);
        renderTree();
        updateOutline();
        renderExportSummary();
        toast('已新建文章，改完标题和 slug 记得保存');
        updateStorageSoon();
        window.setTimeout(function () {
          var titleInput = qs('[data-doc-field="title"]');
          if (titleInput) titleInput.focus();
        }, 40);
      }).catch(function (err) {
        toast(writeError(err), true);
      });
    });
  }

  function deleteCurrentArticle() {
    var article = currentArticle();
    if (!article) return;
    confirmDialog({
      title: '删除文章',
      message: '确定删除《' + esc(article.title) + '》？删除后本机数据里就没了，导出包里也会少这一篇。这个动作不会动已有的构建快照。',
      confirmLabel: '删除这篇文章',
      onConfirm: function () {
        return dbDelete(STORE_ARTICLES, article.id).then(function () {
          state.articles = state.articles.filter(function (a) { return a.id !== article.id; });
          state.currentId = null;
          state.dirty = false;
          resetEditor();
          renderTree();
          renderExportSummary();
          updateStorageSoon();
          toast('文章已删除');
        }).catch(function (err) {
          toast(writeError(err), true);
        });
      }
    });
  }

  function resetEditor() {
    qs('[data-canvas-wrap]').hidden = true;
    qs('[data-editor-empty]').hidden = false;
    var title = qs('[data-doc-title]');
    if (title) title.textContent = '未选择内容';
    var path = qs('[data-doc-path]');
    if (path) path.textContent = '—';
    state.doc = null;
    state.blocks = [];
    state.selectedBlockId = null;
    state.dirty = false;
    setSaveState('已保存', false);
    renderInspector();
    updateOutline();
    updateUndoButtons();
  }

  /* ============================================================
     可视化区块编辑器
     ============================================================ */

  function currentPage() {
    if (!state.currentPageId) return null;
    return ((state.config && state.config.pages) || []).filter(function (p) { return p.id === state.currentPageId; })[0] || null;
  }

  function currentDoc() {
    if (!state.doc) return null;
    if (state.doc.kind === 'article') {
      return state.articles.filter(function (a) { return a.id === state.doc.id; })[0] || null;
    }
    return currentPage();
  }

  function selectedBlock() {
    var ctx = findBlockContext(state.selectedBlockId);
    return ctx ? ctx.block : null;
  }

  function openArticle(id) {
    return openDoc('article', id);
  }

  function openPage(id) {
    return openDoc('page', id);
  }

  function openDoc(kind, id) {
    if (state.doc && state.doc.kind === kind && state.doc.id === id) {
      renderInspector();
      return Promise.resolve(true);
    }
    return Promise.resolve(flushSave(true)).then(function (ok) {
      if (!ok) return false;
      var doc = null;
      if (kind === 'article') {
        doc = state.articles.filter(function (a) { return a.id === id; })[0];
        state.currentId = id;
        state.currentPageId = null;
      } else {
        doc = ((state.config.pages || []).filter(function (p) { return p.id === id; })[0]);
        state.currentPageId = id;
        state.currentId = null;
      }
      if (!doc) return false;
      state.doc = { kind: kind, id: id };
      state.blocks = clone(doc.blocks && doc.blocks.length ? doc.blocks : htmlToBlocks(doc.body || ''));
      state.selectedBlockId = state.blocks[0] ? state.blocks[0].id : null;
      state.history = { past: [], future: [] };
      state.historyTimer = 0;
      state.editSession = false;
      state.dirty = false;
      setSaveState('已保存', false);
      qs('[data-editor-empty]').hidden = true;
      qs('[data-canvas-wrap]').hidden = false;
      if (state.inspectorTab === 'preview') switchInspectorTab('preview');
      setDocHeader();
      renderCanvas();
      renderInspector();
      renderTree();
      renderPages();
      updateUndoButtons();
      updateOutline();
      renderPreviewSoon();
      var scroll = qs('[data-canvas-scroll]');
      if (scroll) scroll.scrollTop = 0;
      return true;
    });
  }

  function docPathLabel(doc) {
    if (!doc) return '—';
    if (state.doc && state.doc.kind === 'page') return '/' + pagePath(doc);
    return '/' + (pathFor(doc) || '（先补全方向和主题）');
  }

  function setDocHeader() {
    var doc = currentDoc();
    if (!doc) return;
    var kind = qs('[data-doc-kind]');
    if (kind) kind.textContent = state.doc.kind === 'page' ? '页面' : '文章';
    var title = qs('[data-doc-title]');
    if (title) title.textContent = doc.title || '未命名';
    var path = qs('[data-doc-path]');
    if (path) path.textContent = docPathLabel(doc);
  }

  function renderCanvas() {
    var canvas = qs('[data-canvas]');
    if (!canvas) return;
    if (!state.doc) {
      canvas.innerHTML = '';
      return;
    }
    var total = countBlockTree(state.blocks);
    var count = qs('[data-block-count]');
    if (count) count.textContent = total + ' 个区块' + (total !== state.blocks.length ? '（含嵌套）' : '');

    if (!state.blocks.length) {
      canvas.className = 'lc-canvas is-empty';
      canvas.innerHTML = '<div><p class="lc-canvas-empty-title">画布还是空的</p>' +
        '<p class="lc-canvas-empty-hint">把左侧「区块库」里的区块拖到这里，或点下面的添加按钮。</p></div>';
      renderAddbar();
      return;
    }

    canvas.className = 'lc-canvas';
    canvas.innerHTML = state.blocks.map(function (block) {
      return renderCanvasBlock(block, 0);
    }).join('');
    renderAddbar();
  }

  function renderCanvasBlock(block, depth) {
    var selected = block.id === state.selectedBlockId;
    var children = (block.blocks || []).map(function (child) { return renderCanvasBlock(child, depth + 1); }).join('');
    var body;
    if (isContainerBlock(block)) {
      var variant = block.variant === 'columns' ? 'columns' : (block.variant === 'accordion' ? 'accordion' : 'card');
      var cols = Math.max(1, Math.min(4, Number(block.columns) || 2));
      var head = variant === 'accordion'
        ? '<div class="lc-container-summary">' + esc(block.title || '折叠面板') + '<span>点击展开 / 收起</span></div>'
        : (block.title ? '<div class="lc-container-title">' + esc(block.title) + '</div>' : '');
      body = '<div class="lc-canvas-container lc-container lc-container-' + variant + '"' +
        (variant === 'columns' ? ' style="--lc-cols:' + cols + '"' : '') +
        ' data-container-drop="' + esc(block.id) + '">' + head +
        '<div class="lc-container-inner">' +
        (children || '<div class="lc-container-empty">拖动区块到这里，放进容器</div>') +
        '</div></div>';
    } else {
      body = '<div class="lc-blk-body">' + renderBlockHtml(block, { canvas: true }) + '</div>';
    }
    return '<section class="lc-blk lc-depth-' + depth + (selected ? ' is-selected' : '') + (isContainerBlock(block) ? ' is-container' : '') +
      '" data-block-id="' + esc(block.id) + '" data-depth="' + depth + '" draggable="true" tabindex="0" aria-label="' + esc(blockTitle(block)) + '">' +
      '<div class="lc-blk-bar">' +
        '<div class="lc-blk-type"><span class="lc-blk-handle" title="拖动排序" aria-hidden="true">⠿</span>' + esc(blockTitle(block)) +
          (depth ? '<span class="lc-depth-tag">第 ' + (depth + 1) + ' 层</span>' : '') + '</div>' +
        '<div class="lc-blk-tools">' +
          '<button class="lc-blk-tool" type="button" data-blk-action="up" title="上移">↑</button>' +
          '<button class="lc-blk-tool" type="button" data-blk-action="down" title="下移">↓</button>' +
          '<button class="lc-blk-tool" type="button" data-blk-action="dup" title="复制">复制</button>' +
          '<button class="lc-blk-tool is-danger" type="button" data-blk-action="del" title="删除">删除</button>' +
        '</div>' +
      '</div>' + body +
    '</section>';
  }

  function renderAddbar() {
    var host = qs('[data-addbar]');
    if (!host) return;
    host.innerHTML = '<span class="lc-addbar-label">添加区块</span>' + BLOCK_DEFS.map(function (def) {
      return '<button class="lc-add-chip" type="button" data-add-type="' + def.type + '">' + esc(def.name) + '</button>';
    }).join('') + '<button class="lc-add-chip" type="button" data-add-type="component">自定义组件</button>';
  }

  function renderQuickLib() {
    var hosts = qsa('[data-quick-lib]');
    if (!hosts.length) return;
    var html = BLOCK_DEFS.map(function (def) {
      return '<button class="lc-quick-chip" type="button" draggable="true" data-lib-type="' + def.type + '">' + esc(def.name) + '</button>';
    }).join('');
    ((state.config && state.config.components) || []).forEach(function (comp) {
      html += '<button class="lc-quick-chip is-component" type="button" draggable="true" data-lib-component="' + esc(comp.id) + '">' + esc(comp.name) + '</button>';
    });
    hosts.forEach(function (host) { host.innerHTML = html; });
  }

  /* ---------------- 属性面板 ---------------- */

  function fieldText(label, prop, value, rows, hint) {
    var attrs = 'class="lc-input" data-prop="' + esc(prop) + '"';
    var inner = rows ? '<textarea ' + attrs + ' rows="' + rows + '">' + esc(value == null ? '' : value) + '</textarea>'
      : '<input ' + attrs + ' type="text" value="' + esc(value == null ? '' : value) + '" autocomplete="off">';
    return '<label class="lc-field"><span>' + esc(label) + '</span>' + inner + (hint ? '<small class="lc-hint">' + esc(hint) + '</small>' : '') + '</label>';
  }

  function fieldSelect(label, prop, value, options) {
    return '<label class="lc-field"><span>' + esc(label) + '</span><select class="lc-input" data-prop="' + esc(prop) + '">' +
      options.map(function (opt) {
        return '<option value="' + esc(opt.value) + '"' + (String(value) === String(opt.value) ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
      }).join('') + '</select></label>';
  }

  function blockPropsHtml(block) {
    if (!block) {
      return '<p class="lc-inspector-empty">点画布里的区块，这里会显示它的属性。区块里的文本都支持 Markdown。</p>';
    }
    var ctx = findBlockContext(block.id);
    var pathText = ctx && ctx.ancestors.length
      ? ctx.ancestors.map(function (a) { return blockTitle(a); }).join(' / ') + ' / '
      : '';
    var depthText = ctx ? '（第 ' + (ctx.depth + 1) + ' 层）' : '';
    var html = '<p class="lc-inspector-block-title">正在编辑：<b>' + esc(pathText + blockTitle(block)) + '</b>' + depthText + '</p>';

    if (block.type === 'heading') {
      html += fieldText('标题文字', 'text', block.text, 0);
      html += fieldSelect('级别', 'level', block.level || 2, [{ value: 2, label: 'H2（一级小节）' }, { value: 3, label: 'H3（二级小节）' }]);
      html += '<p class="lc-hint">导出时按顺序自动加 id="section-1" 这样的锚点，右侧目录和站内跳转靠它。</p>';
    } else if (block.type === 'paragraph' || block.type === 'markdown') {
      html += fieldText('内容（Markdown）', 'md', block.md, 12, '支持 # 标题、**加粗**、[链接](地址)、- 列表、| 表格 |、```代码块```。');
    } else if (block.type === 'cards') {
      html += fieldSelect('每行列数', 'columns', block.columns || 3, [{ value: 2, label: '2 列' }, { value: 3, label: '3 列' }]);
      (block.cards || []).forEach(function (card, index) {
        html += '<div class="lc-card-sub" data-card-index="' + index + '">' +
          '<div class="lc-card-sub-head"><span>卡片 ' + (index + 1) + '</span>' +
            '<button class="lc-blk-tool is-danger" type="button" data-remove-card="' + index + '">移除</button></div>' +
          '<label class="lc-field"><span>标题</span><input class="lc-input" type="text" data-card-field="title" value="' + esc(card.title || '') + '" autocomplete="off"></label>' +
          '<label class="lc-field"><span>说明</span><textarea class="lc-input" rows="2" data-card-field="body">' + esc(card.body || '') + '</textarea></label>' +
          '<label class="lc-field"><span>链接（可空）</span><input class="lc-input" type="text" data-card-field="href" value="' + esc(card.href || '') + '" placeholder="articles/...html 或 https://..." autocomplete="off"></label>' +
        '</div>';
      });
      html += '<button class="lc-btn lc-btn-sm" type="button" data-add-card>添加一张卡片</button>';
    } else if (block.type === 'image') {
      html += '<div class="lc-image-pick">' +
        '<label class="lc-btn lc-btn-sm lc-image-file">选择本地图片<input type="file" accept="image/*" data-image-file hidden></label>' +
        '<span class="lc-hint">本地图片读成 data URL，存进 IndexedDB 并直接写进导出 HTML，原图挪走也不影响。</span></div>';
      html += fieldText('图片地址（也可粘贴 URL）', 'src', block.src, 0, '本地选图后这里会变成 data URL；也可以填 https 地址或相对路径。');
      html += fieldText('替代文字（alt）', 'alt', block.alt, 0, '图加载失败或读屏时显示。');
      html += fieldText('图片说明', 'caption', block.caption, 0);
      html += '<div class="lc-field-row">' + fieldText('宽度', 'width', block.width, 0, '可以写 100%、320px，留空自适应。') +
        fieldText('高度', 'height', block.height, 0, '留空按原图比例。') + '</div>';
      html += fieldSelect('对齐', 'align', block.align || 'center', [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]);
      if (block.src) {
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-clear-image>移除图片</button>';
      }
    } else if (block.type === 'container') {
      html += fieldSelect('容器样式', 'variant', block.variant || 'card', [{ value: 'card', label: '卡片容器' }, { value: 'columns', label: '分栏容器' }, { value: 'accordion', label: '折叠面板' }]);
      html += fieldText('容器标题', 'title', block.title, 0);
      if ((block.variant || 'card') === 'columns') {
        html += fieldSelect('分几栏', 'columns', block.columns || 2, [{ value: 2, label: '2 栏' }, { value: 3, label: '3 栏' }, { value: 4, label: '4 栏' }]);
      }
      html += '<p class="lc-hint">容器里已经有 ' + countBlockTree(block.blocks || []) + ' 个区块。从左侧区块库或画布其他位置拖进来即可；拖动时对准容器中间是放进容器，靠近上下边缘是放在容器前后。</p>';
    } else if (block.type === 'divider') {
      html += '<p class="lc-inspector-empty">分隔线没有可改的属性，用来把两类内容隔开。</p>';
    } else if (block.type === 'button') {
      html += fieldText('按钮文字', 'label', block.label, 0);
      html += fieldText('链接地址', 'href', block.href, 0, '站内链接用相对路径，比如 articles/guide/basics/start/intro.html。');
      html += fieldSelect('样式', 'variant', block.variant || 'primary', [{ value: 'primary', label: '主按钮（实心）' }, { value: 'plain', label: '次按钮（描边）' }]);
      html += fieldSelect('对齐', 'align', block.align || 'left', [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]);
    } else if (block.type === 'code') {
      html += fieldText('语言', 'lang', block.lang, 0, '只用于标记，比如 javascript、css、bash。');
      html += fieldText('代码', 'code', block.code, 10);
    } else if (block.type === 'note') {
      html += fieldSelect('类型', 'variant', block.variant || 'info', [{ value: 'info', label: '提示（补充细节）' }, { value: 'warn', label: '警告（真的会出问题）' }]);
      html += fieldText('标题', 'title', block.title, 0);
      html += fieldText('内容（Markdown）', 'md', block.md, 6);
    } else if (block.type === 'html') {
      html += fieldText('HTML 源码', 'html', block.html, 14, '原样输出，不会被转义。只放你信任的内容。');
    } else if (block.type === 'articleList') {
      html += fieldText('最多显示几篇（0 表示全部）', 'limit', block.limit == null ? 0 : block.limit, 0);
      html += '<p class="lc-hint">列表按排序值从小到大，自动读取当前站点里的全部文章。导出时会变成真实链接。</p>';
    } else if (block.type === 'component') {
      var comps = (state.config.components || []);
      html += fieldSelect('使用哪个组件', '__componentId', block.componentId, comps.map(function (c) {
        return { value: c.id, label: c.name };
      }));
      var comp = componentById(block.componentId);
      if (comp) {
        (comp.fields || fieldsFromTemplate(comp.template)).forEach(function (key) {
          var value = (block.fields || {})[key] || '';
          var long = /body|content|text|desc|说明/i.test(key) || value.length > 48;
          html += '<label class="lc-field"><span>' + esc(key) + '</span>' +
            (long ? '<textarea class="lc-input" rows="3" data-comp-field="' + esc(key) + '">' + esc(value) + '</textarea>'
              : '<input class="lc-input" type="text" data-comp-field="' + esc(key) + '" value="' + esc(value) + '" autocomplete="off">') +
            '</label>';
        });
      } else {
        html += '<p class="lc-inspector-empty">这个组件已被删除。到「组件库」重新建一个，或删掉这个区块。</p>';
      }
    }

    html += '<div class="lc-prop-actions">' +
      '<button class="lc-btn lc-btn-sm" type="button" data-blk-action="up">上移</button>' +
      '<button class="lc-btn lc-btn-sm" type="button" data-blk-action="down">下移</button>' +
      '<button class="lc-btn lc-btn-sm" type="button" data-blk-action="dup">复制</button>' +
      '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-blk-action="del">删除区块</button>' +
      '</div>';
    return html;
  }

  function docFieldsHtml() {
    var doc = currentDoc();
    if (!doc) return '';
    if (state.doc.kind === 'article') {
      var dirs = (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var series = (state.config.series || []).slice();
      var topics = topicsFor(doc.directionId, doc.seriesId);
      var html = '<div class="lc-prop-actions" style="margin:0 0 10px"></div>' +
        '<div class="lc-field"><span>标题</span><input class="lc-input" type="text" data-doc-field="title" value="' + esc(doc.title) + '" autocomplete="off"></div>' +
        '<div class="lc-field"><span>slug（网址里的短名）</span><input class="lc-input" type="text" data-doc-field="slug" value="' + esc(doc.slug) + '" autocomplete="off" spellcheck="false"></div>' +
        '<div class="lc-field"><span>方向</span><select class="lc-input" data-doc-field="directionId">' + dirs.map(function (d) {
          return '<option value="' + esc(d.id) + '"' + (d.id === doc.directionId ? ' selected' : '') + '>' + esc(d.name) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="lc-field"><span>系列</span><select class="lc-input" data-doc-field="seriesId">' + series.map(function (s) {
          return '<option value="' + esc(s.id) + '"' + (s.id === doc.seriesId ? ' selected' : '') + '>' + esc(s.name) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="lc-field"><span>主题</span><select class="lc-input" data-doc-field="topicId">' + topics.map(function (t) {
          return '<option value="' + esc(t.id) + '"' + (t.id === doc.topicId ? ' selected' : '') + '>' + esc(t.name) + '</option>';
        }).join('') + (topics.length ? '' : '<option value="">（这个方向 / 系列还没有主题）</option>') + '</select></div>' +
        '<div class="lc-field"><span>难度</span><select class="lc-input" data-doc-field="difficulty">' + ['入门', '基础', '进阶', '深入'].map(function (d) {
          return '<option value="' + d + '"' + (d === doc.difficulty ? ' selected' : '') + '>' + d + '</option>';
        }).join('') + '</select></div>' +
        '<div class="lc-field"><span>排序</span><input class="lc-input" type="number" min="1" step="1" data-doc-field="order" value="' + (doc.order || 1) + '"></div>' +
        '<div class="lc-field"><span>标签（英文逗号分隔）</span><input class="lc-input" type="text" data-doc-field="tags" value="' + esc((doc.tags || []).join(',')) + '" autocomplete="off"></div>' +
        '<div class="lc-field"><span>简介</span><textarea class="lc-input" rows="3" data-doc-field="summary">' + esc(doc.summary || '') + '</textarea></div>';
      return html;
    }
    return '<div class="lc-field"><span>页面标题</span><input class="lc-input" type="text" data-doc-field="title" value="' + esc(doc.title) + '" autocomplete="off"></div>' +
      '<div class="lc-field"><span>slug（短名）</span><input class="lc-input" type="text" data-doc-field="slug" value="' + esc(doc.slug) + '" autocomplete="off" spellcheck="false"></div>' +
      '<div class="lc-field"><span>导出路径</span><input class="lc-input" type="text" data-doc-field="path" value="' + esc(doc.path || '') + '" placeholder="about.html 或 pages/contact/index.html" autocomplete="off" spellcheck="false"><small class="lc-hint">相对站点根目录，必须带 .html。留空会用 slug 生成。</small></div>' +
      '<div class="lc-field"><span>排序</span><input class="lc-input" type="number" min="1" step="1" data-doc-field="order" value="' + (doc.order || 1) + '"></div>' +
      '<label class="lc-check"><input type="checkbox" data-doc-field="nav"' + (doc.nav !== false ? ' checked' : '') + '><span>放进站点导航（首页页头、页脚和 sitemap）</span></label>' +
      '<div class="lc-field"><span>简介</span><textarea class="lc-input" rows="2" data-doc-field="summary">' + esc(doc.summary || '') + '</textarea></div>' +
      '<div class="lc-prop-actions"><button class="lc-btn lc-btn-sm" type="button" data-dup-page>复制这个页面</button></div>';
  }

  function blockTreeHtml(blocks, depth) {
    if (!blocks || !blocks.length) {
      return depth ? '<p class="lc-tree-empty">容器里还没有区块</p>'
        : '<p class="lc-inspector-empty">画布还没有区块。拖一个进来，这里会显示层级。</p>';
    }
    return '<ul class="lc-structure-tree' + (depth ? ' is-nested' : '') + '">' + blocks.map(function (block) {
      var active = block.id === state.selectedBlockId ? ' is-selected' : '';
      var children = isContainerBlock(block)
        ? blockTreeHtml(block.blocks || [], depth + 1)
        : '';
      return '<li class="lc-tree-node">' +
        '<button class="lc-tree-item' + active + '" type="button" data-tree-select="' + esc(block.id) + '">' +
          '<span class="lc-tree-dot' + (isContainerBlock(block) ? ' is-container' : '') + '"></span>' +
          '<span class="lc-tree-text">' + esc(blockTitle(block)) + '</span>' +
          '<span class="lc-tree-layer">' + (depth + 1) + ' 层</span>' +
        '</button>' + children + '</li>';
    }).join('') + '</ul>';
  }

  function renderInspector() {
    var host = qs('[data-inspector]');
    if (!host) return;
    if (!state.doc) {
      host.innerHTML = '<p class="lc-inspector-empty">左边选一篇内容，或新建文章 / 页面。选中后这里是区块属性和文档设置。</p>';
      return;
    }
    var doc = currentDoc();
    if (!doc) return;
    var block = selectedBlock();
    host.innerHTML =
      '<div class="lc-prop-group"><h3>结构树</h3>' + blockTreeHtml(state.blocks, 0) + '</div>' +
      '<div class="lc-prop-group"><h3>区块属性</h3>' + blockPropsHtml(block) + '</div>' +
      '<div class="lc-prop-group"><h3>文档设置</h3>' + docFieldsHtml() + '</div>' +
      '<div class="lc-prop-group"><h3>本文目录</h3><ol class="lc-outline-list" data-outline-mini></ol>' +
      '<p class="lc-inspector-empty" data-outline-empty>正文里加 H2 / H3 区块，这里会列出小节。</p></div>';
    updateOutline();
  }

  function updateOutline() {
    var hosts = qsa('[data-outline-mini]');
    if (!hosts.length) return;
    var prepared = prepareArticle({ blocks: state.blocks });
    var html = prepared.sections.map(function (s) {
      return '<li>' + esc(s.title || '（无标题）') + '</li>';
    }).join('');
    hosts.forEach(function (host) { host.innerHTML = html; });
    var empty = qs('[data-outline-empty]');
    if (empty) empty.hidden = prepared.sections.length > 0;
  }

  /* ---------------- 读取 / 保存 ---------------- */

  function readDocForm() {
    var doc = currentDoc();
    if (!doc) return null;
    function val(name) {
      var el = qs('[data-doc-field="' + name + '"]');
      return el ? el.value : '';
    }
    if (state.doc.kind === 'article') {
      return {
        title: (val('title') || '').trim(),
        slug: (val('slug') || '').trim().toLowerCase(),
        directionId: val('directionId'),
        seriesId: val('seriesId'),
        topicId: val('topicId'),
        difficulty: val('difficulty') || '入门',
        tags: (val('tags') || '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
        summary: (val('summary') || '').trim(),
        order: Math.max(1, Number(val('order')) || 1)
      };
    }
    return {
      title: (val('title') || '').trim(),
      slug: (val('slug') || '').trim().toLowerCase(),
      path: (val('path') || '').trim(),
      summary: (val('summary') || '').trim(),
      order: Math.max(1, Number(val('order')) || 1),
      nav: (function () {
        var el = qs('[data-doc-field="nav"]');
        return el ? !!el.checked : true;
      })()
    };
  }

  function syncDocFormToState() {
    var doc = currentDoc();
    var form = readDocForm();
    if (!doc || !form) return;
    Object.assign(doc, form);
  }

  function saveCurrentDoc(silent) {
    var doc = currentDoc();
    if (!doc || !state.doc) return Promise.resolve(true);
    var form = readDocForm();
    if (!form) return Promise.resolve(true);
    var now = Date.now();
    Object.assign(doc, form, { updatedAt: now, blocks: clone(state.blocks) });
    if (state.doc.kind === 'article') {
      doc.body = renderBlocks(state.blocks);
      doc.slug = doc.slug || nextSlug('article');
      var store = dbPut(STORE_ARTICLES, doc);
      return store.then(function () {
        var idx = state.articles.findIndex(function (a) { return a.id === doc.id; });
        if (idx !== -1) state.articles[idx] = doc;
        state.dirty = false;
        setSaveState('已保存 · ' + fmtDate(now).slice(11), false);
        setDocHeader();
        renderTree();
        renderPages();
        renderExportSummary();
        renderPreviewSoon();
        updateStorageSoon();
        if (!silent) toast('已保存');
        return true;
      }).catch(function (err) {
        var message = writeError(err);
        setSaveState('保存失败：' + message, true);
        if (!silent) toast(message, true);
        return false;
      });
    }

    var pages = (state.config.pages || []);
    var idxPage = pages.findIndex(function (p) { return p.id === doc.id; });
    if (idxPage === -1) return Promise.resolve(true);
    pages[idxPage] = doc;
    return dbPut(STORE_CONFIG, state.config).then(function () {
      state.dirty = false;
      setSaveState('已保存 · ' + fmtDate(now).slice(11), false);
      setDocHeader();
      renderPages();
      renderTree();
      renderExportSummary();
      renderPreviewSoon();
      updateStorageSoon();
      if (!silent) toast('已保存');
      return true;
    }).catch(function (err) {
      var message = writeError(err);
      setSaveState('保存失败：' + message, true);
      if (!silent) toast(message, true);
      return false;
    });
  }

  function saveCurrentArticle(silent) {
    return saveCurrentDoc(silent);
  }

  function markDirty() {
    state.dirty = true;
    setSaveState('有改动，稍后自动保存', true);
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(function () {
      saveCurrentDoc(true);
    }, 900);
  }

  /* ---------------- 撤销 / 重做 ---------------- */

  function snapshotBlocks() {
    return JSON.stringify(state.blocks);
  }

  function updateUndoButtons() {
    var undoBtn = qs('[data-undo]');
    var redoBtn = qs('[data-redo]');
    if (undoBtn) undoBtn.disabled = state.history.past.length === 0;
    if (redoBtn) redoBtn.disabled = state.history.future.length === 0;
  }

  function pushHistory() {
    if (!state.doc) return;
    state.history.past.push(snapshotBlocks());
    if (state.history.past.length > 60) state.history.past.shift();
    state.history.future = [];
    updateUndoButtons();
  }

  function applyHistorySnapshot(json) {
    state.blocks = JSON.parse(json);
    if (!state.blocks.some(function (b) { return b.id === state.selectedBlockId; })) {
      state.selectedBlockId = state.blocks[0] ? state.blocks[0].id : null;
    }
    renderCanvas();
    renderInspector();
    updateOutline();
    renderPreviewSoon();
    markDirty();
  }

  function undo() {
    if (!state.history.past.length) return;
    state.history.future.push(snapshotBlocks());
    applyHistorySnapshot(state.history.past.pop());
    updateUndoButtons();
  }

  function redo() {
    if (!state.history.future.length) return;
    state.history.past.push(snapshotBlocks());
    applyHistorySnapshot(state.history.future.pop());
    updateUndoButtons();
  }

  /* ---------------- 区块操作 ---------------- */

  function selectBlock(id) {
    if (state.selectedBlockId === id) return;
    state.selectedBlockId = id;
    qsa('[data-block-id]').forEach(function (el) {
      el.classList.toggle('is-selected', el.getAttribute('data-block-id') === id);
    });
    renderInspector();
    var canvas = qs('[data-canvas]');
    var target = canvas && canvas.querySelector('[data-block-id="' + id + '"]');
    if (target && target.focus) target.focus({ preventScroll: true });
  }

  function refreshBlockVisual(blockId) {
    var ctx = findBlockContext(blockId);
    if (!ctx) return;
    if (isContainerBlock(ctx.block)) {
      renderCanvas();
      return;
    }
    var host = qs('[data-canvas] [data-block-id="' + blockId + '"] .lc-blk-body');
    if (host) host.innerHTML = renderBlockHtml(ctx.block, { canvas: true });
  }

  function clearDropMarks() {
    qsa('.lc-blk').forEach(function (el) {
      el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside', 'is-dragging');
    });
    qsa('[data-container-drop]').forEach(function (el) { el.classList.remove('is-drop-inside'); });
    var badge = qs('[data-drop-badge]');
    if (badge) badge.hidden = true;
  }

  function insertBlockAt(type, index, compId, parentId) {
    var parentCtx = parentId ? findBlockContext(parentId) : null;
    if (parentId && (!parentCtx || !isContainerBlock(parentCtx.block))) return;
    var list = parentCtx ? parentCtx.block.blocks : state.blocks;
    if (!Array.isArray(list)) list = parentCtx.block.blocks = [];
    pushHistory();
    var block = newBlock(type, compId ? { componentId: compId } : null);
    var at = Math.max(0, Math.min(index == null ? list.length : index, list.length));
    list.splice(at, 0, block);
    state.selectedBlockId = block.id;
    renderCanvas();
    renderInspector();
    updateOutline();
    renderPreviewSoon();
    markDirty();
  }

  function moveBlockTo(id, insertIndex, parentId) {
    var source = findBlockContext(id);
    if (!source) return false;
    if (parentId) {
      var parentCtx = findBlockContext(parentId);
      if (!parentCtx || !isContainerBlock(parentCtx.block)) return false;
      if (parentId === id || blockContainsBlock(source.block, parentId)) {
        toast('不能把容器拖进它自己的内部', true);
        return false;
      }
    }
    var targetList = parentId ? findBlockContext(parentId).block.blocks : state.blocks;
    if (!Array.isArray(targetList)) {
      targetList = [];
      findBlockContext(parentId).block.blocks = targetList;
    }
    var to = insertIndex == null ? targetList.length : insertIndex;
    var sameList = source.list === targetList;
    if (sameList) {
      if (to > source.index) to -= 1;
      if (to === source.index) return false;
    }
    pushHistory();
    source.list.splice(source.index, 1);
    targetList.splice(Math.max(0, Math.min(to, targetList.length)), 0, source.block);
    state.selectedBlockId = source.block.id;
    renderCanvas();
    renderInspector();
    updateOutline();
    renderPreviewSoon();
    markDirty();
    return true;
  }

  function deleteBlock(id) {
    var ctx = findBlockContext(id);
    if (!ctx) return;
    pushHistory();
    ctx.list.splice(ctx.index, 1);
    var next = ctx.list[Math.min(ctx.index, ctx.list.length - 1)];
    state.selectedBlockId = next ? next.id : (ctx.parent ? ctx.parent.id : null);
    renderCanvas();
    renderInspector();
    updateOutline();
    renderPreviewSoon();
    markDirty();
  }

  function duplicateBlock(id) {
    var ctx = findBlockContext(id);
    if (!ctx) return;
    pushHistory();
    var copy = cloneBlockTree(ctx.block);
    ctx.list.splice(ctx.index + 1, 0, copy);
    state.selectedBlockId = copy.id;
    renderCanvas();
    renderInspector();
    updateOutline();
    renderPreviewSoon();
    markDirty();
  }

  function nudgeBlock(id, delta) {
    var ctx = findBlockContext(id);
    if (!ctx) return;
    var next = ctx.index + delta;
    if (next < 0 || next >= ctx.list.length) return;
    pushHistory();
    var block = ctx.list.splice(ctx.index, 1)[0];
    ctx.list.splice(next, 0, block);
    state.selectedBlockId = id;
    renderCanvas();
    renderInspector();
    updateOutline();
    renderPreviewSoon();
    markDirty();
  }

  function blockAction(action, id) {
    if (!id) return;
    if (action === 'up') nudgeBlock(id, -1);
    else if (action === 'down') nudgeBlock(id, 1);
    else if (action === 'dup') duplicateBlock(id);
    else if (action === 'del') deleteBlock(id);
  }

  /* ---------------- 文档级操作 ---------------- */

  function deleteCurrentDoc() {
    var doc = currentDoc();
    if (!doc || !state.doc) return;
    var isPage = state.doc.kind === 'page';
    confirmDialog({
      title: isPage ? '删除页面' : '删除文章',
      message: '确定删除《' + esc(doc.title || '未命名') + '》？本机数据里会删掉，导出包里也会少这一项。已有构建快照不受影响。',
      confirmLabel: '删除',
      onConfirm: function () {
        if (!isPage) {
          return dbDelete(STORE_ARTICLES, doc.id).then(function () {
            state.articles = state.articles.filter(function (a) { return a.id !== doc.id; });
            state.currentId = null;
            state.doc = null;
            resetEditor();
            renderTree();
            renderPages();
            renderExportSummary();
            updateStorageSoon();
            toast('文章已删除');
          }).catch(function (err) { toast(writeError(err), true); });
        }
        state.config.pages = (state.config.pages || []).filter(function (p) { return p.id !== doc.id; });
        return dbPut(STORE_CONFIG, state.config).then(function () {
          state.currentPageId = null;
          state.doc = null;
          resetEditor();
          renderPages();
          renderTree();
          renderExportSummary();
          updateStorageSoon();
          toast('页面已删除');
        }).catch(function (err) { toast(writeError(err), true); });
      }
    });
  }

  function createPage() {
    return Promise.resolve(flushSave(true)).then(function (ok) {
      if (!ok) return;
      var pages = state.config.pages || [];
      var base = 'page';
      var n = pages.length + 1;
      var slug = 'page-' + n;
      while (pages.some(function (p) { return p.slug === slug; })) { n += 1; slug = 'page-' + n; }
      var page = {
        id: uid('p'),
        title: '新页面',
        slug: slug,
        path: slug + '.html',
        nav: true,
        summary: '',
        order: pages.length + 1,
        blocks: [
          { id: uid('b'), type: 'heading', text: '新页面标题', level: 2 },
          { id: uid('b'), type: 'paragraph', md: '这里开始写页面内容。和文章一样，区块可以拖拽排序，文本支持 Markdown。' }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      state.config.pages = pages.concat([page]);
      return dbPut(STORE_CONFIG, state.config).then(function () {
        renderPages();
        renderExportSummary();
        openPage(page.id);
        toast('已新建页面，记得改标题和导出路径');
        updateStorageSoon();
      }).catch(function (err) { toast(writeError(err), true); });
    });
  }

  function createPresetPage(presetId) {
    var preset = PRESET_PAGES.filter(function (p) { return p.id === presetId; })[0];
    if (!preset) return;
    return Promise.resolve(flushSave(true)).then(function (ok) {
      if (!ok) return;
      var pages = state.config.pages || [];
      var existing = pages.filter(function (p) { return pagePath(p) === preset.path; })[0];
      if (existing) {
        toast('已经有同路径页面了，直接打开它改');
        openPage(existing.id);
        return;
      }
      var blocks = preset.blocks().map(function (block) {
        var copy = clone(block);
        copy.id = uid('b');
        if (copy.cards) copy.cards = copy.cards.map(function (card) { return clone(card); });
        return copy;
      });
      var page = {
        id: uid('p'),
        presetId: preset.id,
        title: preset.name,
        slug: preset.path.replace(/\.html$/, '').replace(/[\/]/g, '-'),
        path: preset.path,
        nav: preset.nav,
        summary: preset.description,
        order: pages.length + 1,
        blocks: blocks,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      state.config.pages = pages.concat([page]);
      return dbPut(STORE_CONFIG, state.config).then(function () {
        renderPages();
        renderExportSummary();
        switchView('articles');
        openPage(page.id);
        toast('预设页已建好，区块都在画布里，直接改就行');
        updateStorageSoon();
      }).catch(function (err) { toast(writeError(err), true); });
    });
  }

  function duplicatePage() {
    var page = currentPage();
    if (!page) return;
    pushHistory();
    var copy = clone(page);
    copy.id = uid('p');
    copy.title = page.title + '（副本）';
    copy.slug = page.slug + '-copy';
    copy.path = (page.path || page.slug + '.html').replace(/\.html$/, '-copy.html');
    copy.blockIds = null;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    state.config.pages = (state.config.pages || []).concat([copy]);
    return dbPut(STORE_CONFIG, state.config).then(function () {
      renderPages();
      renderExportSummary();
      openPage(copy.id);
      toast('页面已复制');
      updateStorageSoon();
    }).catch(function (err) { toast(writeError(err), true); });
  }

  function normalizeImportedBlocks(blocks, where) {
    if (!Array.isArray(blocks)) throw new Error(where + '的 blocks 不是数组，无法导入。');
    blocks.forEach(function (block, i) {
      var label = where + '第 ' + (i + 1) + ' 个区块';
      if (!block || typeof block !== 'object') throw new Error(label + '不是对象。');
      if (typeof block.type !== 'string' || !block.type) throw new Error(label + '缺少 type。');
      var known = block.type === 'component' || BLOCK_DEFS.some(function (def) { return def.type === block.type; });
      if (!known) throw new Error(label + '的类型「' + block.type + '」当前工作台不支持。');
      if (!block.id) block.id = uid('b');
      if (block.type === 'container' && block.blocks !== undefined) {
        normalizeImportedBlocks(block.blocks, label + '的容器内');
      }
    });
    return blocks;
  }

  function normalizeImportedPage(data) {
    if (!data || data.format !== 'lowcode-page') {
      throw new Error('这个文件不是低代码页面的导出文件（缺少 format: lowcode-page）。');
    }
    if (data.schemaVersion === undefined || data.schemaVersion === null) {
      throw new Error('页面文件缺少 schemaVersion，无法确认版本。');
    }
    if (Number(data.schemaVersion) > 1) {
      throw new Error('页面文件版本是 ' + data.schemaVersion + '，当前工作台只支持 schemaVersion 1，请先升级工作台。');
    }
    if (Number(data.schemaVersion) !== 1) {
      throw new Error('页面文件 schemaVersion 是 ' + data.schemaVersion + '，只接受 1。');
    }
    var p = data.page;
    if (!p || typeof p !== 'object') throw new Error('页面文件里缺少 page 对象。');
    if (typeof p.title !== 'string' || !p.title.trim()) throw new Error('页面缺少标题，无法导入。');
    if (!Array.isArray(p.blocks)) throw new Error('页面缺少 blocks 区块数组，无法导入。');
    var path = String(p.path || '').trim().replace(/^\/+/, '');
    if (path && !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.html$/.test(path)) {
      throw new Error('页面导出路径「' + path + '」不合法，必须相对站点根目录、以 .html 结尾。');
    }
    return {
      id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : uid('p'),
      title: p.title.trim(),
      slug: String(p.slug || '').trim().toLowerCase() || (path ? path.replace(/\.html$/, '').split('/').pop() : 'page'),
      path: path || (String(p.slug || 'page').trim() + '.html'),
      summary: String(p.summary || ''),
      nav: p.nav !== false,
      order: Math.max(1, Number(p.order) || 1),
      blocks: normalizeImportedBlocks(clone(p.blocks), '页面')
    };
  }

  function uniquePagePath(base, exceptId) {
    var pages = state.config.pages || [];
    var raw = String(base || 'page.html').replace(/\.html$/i, '');
    var candidate = raw + '.html';
    var n = 2;
    while (pages.some(function (p) { return p.id !== exceptId && pagePath(p) === candidate; })) {
      candidate = raw + '-' + n + '.html';
      n += 1;
    }
    return candidate;
  }

  function uniquePageSlug(base, exceptId) {
    var pages = state.config.pages || [];
    var raw = String(base || 'page');
    var candidate = raw;
    var n = 2;
    while (pages.some(function (p) { return p.id !== exceptId && String(p.slug || '') === candidate; })) {
      candidate = raw + '-' + n;
      n += 1;
    }
    return candidate;
  }

  function handlePageImport(file) {
    if (!file) return;
    var stateEl = qs('[data-page-import-state]');
    function setState(text, isError) {
      if (!stateEl) return;
      stateEl.textContent = text || '';
      stateEl.style.color = isError ? 'var(--danger)' : '';
    }
    readFileText(file).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) {
        throw new Error('文件不是合法 JSON，可能已损坏或选错了文件。');
      }
      var page = normalizeImportedPage(data);
      var pages = state.config.pages || [];
      var conflict = pages.filter(function (p) {
        return p.id === page.id || pagePath(p) === page.path || (p.slug && p.slug === page.slug);
      })[0];
      if (!conflict) {
        if (pages.some(function (p) { return pagePath(p) === page.path; })) {
          throw new Error('页面路径「' + page.path + '」已经被其他页面占用。');
        }
        page.id = uid('p');
        page.slug = uniquePageSlug(page.slug);
        page.path = uniquePagePath(page.path);
        pages.push(page);
        state.config.pages = pages;
        dbPut(STORE_CONFIG, state.config).then(function () {
          renderPages();
          renderSettings();
          renderExportSummary();
          switchView('articles');
          openPage(page.id);
          setState('已导入页面「' + page.title + '」', false);
          toast('页面已导入：/' + page.path);
          updateStorageSoon();
        }).catch(function (err) { setState(writeError(err), true); });
        return;
      }
      showModal({
        title: '页面路径冲突',
        body: '<p>当前站点里已经有页面 <b>' + esc(conflict.title) + '</b>（路径：<code>' + esc(pagePath(conflict)) + '</code>），和导入文件冲突。</p>' +
          '<p class="lc-hint">替换会用导入文件覆盖同名页面的全部区块和设置；另存会生成一个新页面，并自动改掉重复的 path 和 slug。</p>',
        actions: [
          { label: '取消', onClick: function (close) { close(); setState('已取消导入', false); } },
          {
            label: '另存为新页面',
            onClick: function (close) {
              close();
              var list = state.config.pages || [];
              page.id = uid('p');
              page.title = page.title + ' · 导入副本';
              page.slug = uniquePageSlug(page.slug);
              page.path = uniquePagePath(page.path);
              list.push(page);
              state.config.pages = list;
              dbPut(STORE_CONFIG, state.config).then(function () {
                renderPages();
                renderSettings();
                renderExportSummary();
                switchView('articles');
                openPage(page.id);
                setState('已另存为「' + page.title + '」', false);
                toast('页面已另存为：/' + page.path);
                updateStorageSoon();
              }).catch(function (err) { setState(writeError(err), true); });
            }
          },
          {
            label: '替换同名页面',
            kind: 'lc-btn-primary',
            onClick: function (close) {
              close();
              var list = state.config.pages || [];
              var pathClash = list.filter(function (p) {
                return p.id !== conflict.id && pagePath(p) === page.path;
              })[0];
              if (pathClash) {
                setState('替换失败：路径「' + page.path + '」已被「' + pathClash.title + '」占用，请改用另存。', true);
                return;
              }
              var idx = list.findIndex(function (p) { return p.id === conflict.id; });
              page.id = conflict.id;
              list[idx] = page;
              state.config.pages = list;
              dbPut(STORE_CONFIG, state.config).then(function () {
                renderPages();
                renderSettings();
                renderExportSummary();
                switchView('articles');
                openPage(page.id);
                setState('已替换页面「' + page.title + '」', false);
                toast('页面已替换：/' + page.path);
                updateStorageSoon();
              }).catch(function (err) { setState(writeError(err), true); });
            }
          }
        ]
      });
    }).catch(function (err) {
      setState('导入页面失败：' + (err && err.message ? err.message : '未知错误'), true);
      toast('导入页面失败：' + (err && err.message ? err.message : '未知错误'), true);
    });
  }

  /* ---------------- 预览 ---------------- */

  function renderPreview() {
    var frame = qs('[data-preview]');
    var doc = currentDoc();
    if (!frame || !doc) return;
    var snapshot = Object.assign({}, doc, readDocForm() || {});
    snapshot.blocks = state.blocks;
    var html;
    if (state.doc.kind === 'article') {
      if (!snapshot.slug) snapshot.slug = 'preview';
      html = articlePage(snapshot, { preview: true });
    } else {
      html = customPageHtml(Object.assign({}, snapshot, { path: pagePath(snapshot) }), { preview: true });
    }
    frame.srcdoc = html;
    var el = qs('[data-preview-state]');
    if (el) el.textContent = '已更新 · ' + fmtDate(Date.now()).slice(11);
  }

  function switchInspectorTab(tab) {
    state.inspectorTab = tab;
    qsa('[data-inspector-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-inspector-tab') === tab);
    });
    var body = qs('[data-inspector]');
    var preview = qs('[data-inspector-preview]');
    if (body) body.hidden = tab === 'preview';
    if (preview) preview.hidden = tab !== 'preview';
    if (tab === 'preview') renderPreview();
  }

  /* ---------------- 编辑器事件绑定 ---------------- */

  function bindEditor() {
    var canvas = qs('[data-canvas]');
    var inspector = qs('[data-inspector]');

    qsa('[data-inspector-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchInspectorTab(btn.getAttribute('data-inspector-tab'));
      });
    });

    qs('[data-save-now]').addEventListener('click', function () { saveCurrentDoc(false); });
    qs('[data-delete-doc]').addEventListener('click', deleteCurrentDoc);
    qs('[data-undo]').addEventListener('click', undo);
    qs('[data-redo]').addEventListener('click', redo);
    qs('[data-toggle-preview]').addEventListener('click', function () {
      switchInspectorTab(state.inspectorTab === 'preview' ? 'props' : 'preview');
    });
    qs('[data-refresh-preview]').addEventListener('click', renderPreview);
    qs('[data-clear-blocks]').addEventListener('click', function () {
      if (!state.blocks.length) return;
      confirmDialog({
        title: '清空画布',
        message: '会把当前文档的区块全部删掉，只删区块，不删文档本身。可以用撤销恢复。',
        confirmLabel: '清空',
        onConfirm: function () {
          pushHistory();
          state.blocks = [];
          state.selectedBlockId = null;
          renderCanvas();
          renderInspector();
          updateOutline();
          renderPreviewSoon();
          markDirty();
        }
      });
    });

    canvas.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-blk-action]');
      if (actionBtn) {
        var blk = e.target.closest('[data-block-id]');
        blockAction(actionBtn.getAttribute('data-blk-action'), blk && blk.getAttribute('data-block-id'));
        return;
      }
      var target = e.target.closest('[data-block-id]');
      if (target) selectBlock(target.getAttribute('data-block-id'));
    });

    qs('[data-addbar]').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-add-type]');
      if (!chip) return;
      var type = chip.getAttribute('data-add-type');
      if (type === 'component') {
        if (!(state.config.components || []).length) {
          toast('还没有自定义组件，先去「组件库」建一个', true);
          return;
        }
        insertBlockAt('component', state.blocks.length);
      } else {
        insertBlockAt(type, state.blocks.length);
      }
    });

    /* 从左侧区块库拖入 */
    var sidebar = qs('.lc-sidebar');
    if (sidebar) {
      sidebar.addEventListener('dragstart', function (e) {
        var chip = e.target.closest('[data-lib-type],[data-lib-component]');
        if (!chip) return;
        var payload = chip.hasAttribute('data-lib-component')
          ? 'libcomp:' + chip.getAttribute('data-lib-component')
          : 'lib:' + chip.getAttribute('data-lib-type');
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'copy';
      });
      sidebar.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-lib-type],[data-lib-component]');
        if (!chip || !state.doc) return;
        if (chip.hasAttribute('data-lib-component')) insertBlockAt('component', state.blocks.length, chip.getAttribute('data-lib-component'));
        else insertBlockAt(chip.getAttribute('data-lib-type'), state.blocks.length);
      });
    }

    /* 画布内拖拽排序 */
    canvas.addEventListener('dragstart', function (e) {
      var blk = e.target.closest('[data-block-id]');
      if (!blk) return;
      state.dragBlockId = blk.getAttribute('data-block-id');
      blk.classList.add('is-dragging');
      e.dataTransfer.setData('text/plain', 'block:' + state.dragBlockId);
      e.dataTransfer.effectAllowed = 'move';
    });

    canvas.addEventListener('dragend', function () {
      state.dragBlockId = null;
      state.dropTarget = null;
      clearDropMarks();
    });

    canvas.addEventListener('dragover', function (e) {
      if (!state.doc) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = state.dragBlockId ? 'move' : 'copy';
      clearDropMarks();
      var targetEl = e.target.closest('[data-block-id]');
      var containerEl = e.target.closest('[data-container-drop]');
      var containerId = containerEl ? containerEl.getAttribute('data-container-drop') : null;
      var targetId = targetEl ? targetEl.getAttribute('data-block-id') : null;
      var targetCtx = targetId ? findBlockContext(targetId) : null;
      var parentId = targetCtx && targetCtx.parent ? targetCtx.parent.id : null;
      var index = targetCtx ? targetCtx.index : state.blocks.length;
      var mode = 'before';
      var badge = qs('[data-drop-badge]');

      if (containerId && (!targetId || targetId === containerId)) {
        var box = containerEl.getBoundingClientRect();
        var nearEdge = (e.clientY - box.top) < 18 || (box.bottom - e.clientY) < 18;
        if (!nearEdge) {
          mode = 'inside';
          parentId = containerId;
          var cctx = findBlockContext(containerId);
          if (!cctx) return;
          index = (cctx.block.blocks || []).length;
          containerEl.classList.add('is-drop-inside');
        }
      }
      if (mode !== 'inside' && targetCtx) {
        var rect = (containerId && targetId === containerId ? containerEl : targetEl).getBoundingClientRect();
        var after = (e.clientY - rect.top) > rect.height / 2;
        index = targetCtx.index + (after ? 1 : 0);
        mode = after ? 'after' : 'before';
        targetEl.classList.add(after ? 'is-drop-after' : 'is-drop-before');
      }
      state.dropTarget = { parentId: mode === 'inside' ? parentId : (targetCtx ? parentId : null), index: index };
      if (badge) {
        badge.hidden = false;
        badge.textContent = mode === 'inside' ? '放进容器' : (mode === 'after' ? '放到后面' : '放到前面');
        badge.style.left = Math.max(12, e.clientX + 14) + 'px';
        badge.style.top = Math.max(12, e.clientY - 14) + 'px';
        badge.classList.toggle('is-inside', mode === 'inside');
      }
    });

    canvas.addEventListener('dragleave', function (e) {
      if (!canvas.contains(e.relatedTarget)) clearDropMarks();
    });

    canvas.addEventListener('drop', function (e) {
      if (!state.doc) return;
      e.preventDefault();
      var payload = e.dataTransfer.getData('text/plain') || '';
      var target = state.dropTarget || { parentId: null, index: state.blocks.length };
      var index = target.index == null ? state.blocks.length : target.index;
      var parentId = target.parentId || null;
      clearDropMarks();
      if (payload.indexOf('lib:') === 0) {
        insertBlockAt(payload.slice(4), index, null, parentId);
      } else if (payload.indexOf('libcomp:') === 0) {
        insertBlockAt('component', index, payload.slice(8), parentId);
      } else if (payload.indexOf('block:') === 0) {
        moveBlockTo(payload.slice(6), index, parentId);
      }
      state.dragBlockId = null;
      state.dropTarget = null;
    });

    /* 属性面板：输入、选择、按钮 */
    inspector.addEventListener('focusin', function () { state.editSession = false; });
    inspector.addEventListener('focusout', function () { state.editSession = false; });

    inspector.addEventListener('input', function (e) {
      var target = e.target;
      var docField = target.getAttribute('data-doc-field');
      if (docField) {
        syncDocFormToState();
        if (docField === 'title') setDocHeader();
        markDirty();
        renderPreviewSoon();
        return;
      }
      var prop = target.getAttribute('data-prop');
      var blockId = state.selectedBlockId;
      if (prop && blockId) {
        if (!state.editSession) { pushHistory(); state.editSession = true; }
        var blockCtx = findBlockContext(blockId);
        var block = blockCtx ? blockCtx.block : null;
        if (block) {
          block[prop] = target.value;
          if (prop === '__componentId') return;
          refreshBlockVisual(blockId);
          markDirty();
          updateOutline();
          renderPreviewSoon();
        }
        return;
      }
      var cardField = target.getAttribute('data-card-field');
      if (cardField && blockId) {
        if (!state.editSession) { pushHistory(); state.editSession = true; }
        var cardIndex = Number(target.closest('[data-card-index]').getAttribute('data-card-index'));
        var cardCtx = findBlockContext(blockId);
        var cardBlock = cardCtx ? cardCtx.block : null;
        if (cardBlock && cardBlock.cards && cardBlock.cards[cardIndex]) {
          cardBlock.cards[cardIndex][cardField] = target.value;
          refreshBlockVisual(blockId);
          markDirty();
          renderPreviewSoon();
        }
        return;
      }
      var compField = target.getAttribute('data-comp-field');
      if (compField && blockId) {
        if (!state.editSession) { pushHistory(); state.editSession = true; }
        var compCtx = findBlockContext(blockId);
        var compBlock = compCtx ? compCtx.block : null;
        if (compBlock) {
          compBlock.fields = compBlock.fields || {};
          compBlock.fields[compField] = target.value;
          refreshBlockVisual(blockId);
          markDirty();
          renderPreviewSoon();
        }
      }
    });

    inspector.addEventListener('change', function (e) {
      var target = e.target;
      if (target.hasAttribute('data-image-file')) {
        var file = target.files && target.files[0];
        if (!file) return;
        var imgBlock = selectedBlock();
        if (!imgBlock || imgBlock.type !== 'image') return;
        if (!/^image\//i.test(file.type)) { toast('请选择图片文件', true); return; }
        if (file.size > 8 * 1024 * 1024) { toast('图片超过 8MB，建议先压缩再选，否则本机数据库和导出包都会变大', true); return; }
        readFileAsDataUrl(file).then(function (dataUrl) {
          pushHistory();
          imgBlock.src = dataUrl;
          imgBlock.alt = imgBlock.alt || file.name;
          renderInspector();
          refreshBlockVisual(imgBlock.id);
          markDirty();
          renderPreviewSoon();
          toast('图片已读入并保存到本机，导出时会直接写进 HTML');
        }).catch(function (err) {
          toast((err && err.message) || '读取图片失败', true);
        });
        return;
      }
      var docField = target.getAttribute('data-doc-field');
      if (docField) {
        syncDocFormToState();
        if (docField === 'directionId' || docField === 'seriesId') {
          var doc = currentDoc();
          var firstTopic = topicsFor(doc.directionId, doc.seriesId)[0];
          if (firstTopic) doc.topicId = firstTopic.id;
          renderInspector();
        }
        markDirty();
        renderPreviewSoon();
        setDocHeader();
        return;
      }
      var prop = target.getAttribute('data-prop');
      if (!prop) return;
      if (target.hasAttribute('data-comp-field')) return;
      var block = selectedBlock();
      if (!block) return;
      pushHistory();
      if (prop === '__componentId') {
        block.componentId = target.value;
        var comp = componentById(target.value);
        block.fields = {};
        fieldsFromTemplate(comp ? comp.template : '').forEach(function (key) { block.fields[key] = ''; });
        renderInspector();
      } else {
        block[prop] = target.value;
        refreshBlockVisual(block.id);
      }
      markDirty();
      updateOutline();
      renderPreviewSoon();
    });

    inspector.addEventListener('click', function (e) {
      var treeBtn = e.target.closest('[data-tree-select]');
      if (treeBtn) {
        selectBlock(treeBtn.getAttribute('data-tree-select'));
        return;
      }
      if (e.target.closest('[data-clear-image]')) {
        var imgBlock = selectedBlock();
        if (!imgBlock) return;
        pushHistory();
        imgBlock.src = '';
        renderInspector();
        refreshBlockVisual(imgBlock.id);
        markDirty();
        renderPreviewSoon();
        return;
      }
      var addCard = e.target.closest('[data-add-card]');
      if (addCard) {
        var block = selectedBlock();
        if (!block) return;
        pushHistory();
        block.cards = block.cards || [];
        block.cards.push({ title: '新卡片', body: '', href: '' });
        renderInspector();
        refreshBlockVisual(block.id);
        markDirty();
        renderPreviewSoon();
        return;
      }
      var removeCard = e.target.closest('[data-remove-card]');
      if (removeCard) {
        var cardBlock = selectedBlock();
        if (!cardBlock) return;
        pushHistory();
        cardBlock.cards.splice(Number(removeCard.getAttribute('data-remove-card')), 1);
        renderInspector();
        refreshBlockVisual(cardBlock.id);
        markDirty();
        renderPreviewSoon();
        return;
      }
      if (e.target.closest('[data-dup-page]')) duplicatePage();
    });
  }

  /* ---------------- 预览与目录 ---------------- */

  function renderPreviewSoon() {
    window.clearTimeout(state.previewTimer);
    state.previewTimer = window.setTimeout(renderPreview, 400);
  }

  function __legacyPreview() {
    var article = currentArticle();
    var frame = qs('[data-preview]');
    if (!article || !frame) return;
    if (!pathFor(article)) return;
    var html = articlePage(article, { preview: true });
    frame.srcdoc = html;
    var stateEl = qs('[data-preview-state]');
    if (stateEl) stateEl.textContent = '已更新 · ' + fmtDate(Date.now()).slice(11);
  }

  function __legacyOutline() {
    var host = qs('[data-outline]');
    var count = qs('[data-outline-count]');
    var empty = qs('[data-outline-empty]');
    if (!host) return;
    var body = qs('[data-body]') ? qs('[data-body]').value : '';
    var wrap = document.createElement('div');
    wrap.innerHTML = body;
    var headings = Array.prototype.slice.call(wrap.children).filter(function (el) {
      return el.tagName === 'H2' || el.tagName === 'H3';
    });
    host.innerHTML = headings.map(function (h, i) {
      var title = (h.textContent || '').replace(/\s+/g, ' ').trim() || '（无标题）';
      return '<li class="lc-outline-item ' + (h.tagName === 'H3' ? 'lc-h3' : '') + '"><a href="#" data-outline-jump="' + i + '">' + esc(title) + '</a></li>';
    }).join('');
    if (count) count.textContent = headings.length + ' 节';
    if (empty) empty.hidden = headings.length > 0;
  }

  function __legacyBindEditor() {
    qsa('[data-field]').forEach(function (field) {
      field.addEventListener('input', function () {
        if (field.getAttribute('data-field') === 'directionId' || field.getAttribute('data-field') === 'seriesId') return;
        markDirty();
        if (field.getAttribute('data-field') === 'title') {
          qs('[data-article-heading]').textContent = field.value || '未命名文章';
        }
      });
      field.addEventListener('change', function () {
        var name = field.getAttribute('data-field');
        if (name === 'directionId' || name === 'seriesId') {
          refreshTopicSelect(null);
          markDirty();
        }
      });
    });

    qs('[data-body]').addEventListener('input', function () {
      markDirty();
      updateOutline();
      renderPreviewSoon();
    });

    qs('[data-body]').addEventListener('blur', function () {
      if (state.dirty) saveCurrentArticle(true);
    });

    qs('[data-save-now]').addEventListener('click', function () {
      window.clearTimeout(state.saveTimer);
      saveCurrentArticle(false);
    });

    qs('[data-delete-article]').addEventListener('click', deleteCurrentArticle);

    qs('[data-refresh-preview]').addEventListener('click', function () {
      renderPreview();
      toast('预览已刷新');
    });

    qs('[data-outline]').addEventListener('click', function (e) {
      var jump = e.target.closest('[data-outline-jump]');
      if (!jump) return;
      e.preventDefault();
      var frame = qs('[data-preview]');
      var idx = Number(jump.getAttribute('data-outline-jump'));
      try {
        var doc = frame.contentWindow.document;
        var headings = Array.prototype.slice.call(doc.querySelectorAll('.article-body > h2, .article-body > h3'));
        if (headings[idx]) headings[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { /* 忽略 */ }
    });

    qsa('[data-snippet]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        insertSnippet(btn.getAttribute('data-snippet'));
      });
    });

    qs('[data-body]').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertAtCursor('  ');
      }
    });
  }

  var SNIPPETS = {
    h2: '<h2 id="section-1">小节标题</h2>\n<p>这一节讲什么。</p>\n',
    h3: '<h3 id="section-2">小标题</h3>\n<p>展开一句。</p>\n',
    p: '<p>写一段正文。术语第一次出现时，就地把它的意思讲清楚。</p>\n',
    figure: '<div class="figure">\n  <div class="figure-title">整体流程</div>\n  <div class="flow">\n    <div class="flow-step">读取输入</div>\n    <div class="flow-step">处理规则</div>\n    <div class="flow-step">输出结果</div>\n  </div>\n</div>\n',
    layers: '<div class="layers">\n  <div class="layer">上层：使用者直接接触的部分</div>\n  <div class="layer">中层：负责转换和调度的部分</div>\n  <div class="layer">底层：真正干活的机制</div>\n</div>\n',
    compare: '<div class="compare">\n  <div class="compare-card">\n    <h3 id="section-3">做法 A</h3>\n    <p>写起来直接，但扩展性一般。</p>\n  </div>\n  <div class="compare-card">\n    <h3 id="section-4">做法 B</h3>\n    <p>前期多花一点时间，后面改动更省事。</p>\n  </div>\n</div>\n',
    note: '<div class="note note-info">提示块用来补充容易被忽略的细节。</div>\n',
    warn: '<div class="note note-warn">警告块只写真的会出问题的地方。</div>\n',
    table: '<table>\n  <thead>\n    <tr><th>场景</th><th>推荐做法</th><th>原因</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>数据量小</td><td>直接渲染</td><td>实现简单，排查方便</td></tr>\n  </tbody>\n</table>\n',
    code: '<pre><code>// 注意把 &lt; 和 &amp; 转义\nconst list = [1, 2, 3];\nconsole.log(list.map((n) =&gt; n * 2));\n</code></pre>\n'
  };

  function insertAtCursor(text) {
    var box = qs('[data-body]');
    var start = box.selectionStart;
    var end = box.selectionEnd;
    box.value = box.value.slice(0, start) + text + box.value.slice(end);
    box.selectionStart = box.selectionEnd = start + text.length;
    box.focus();
    markDirty();
    updateOutline();
    renderPreviewSoon();
  }

  function insertSnippet(kind) {
    if (!SNIPPETS[kind]) return;
    var box = qs('[data-body]');
    var text = SNIPPETS[kind];
    var before = box.value.slice(0, box.selectionStart);
    if (before && !/\n\n$/.test(before)) text = '\n' + text;
    insertAtCursor(text);
  }

  /* ============================================================
     导出页面生成
     所有页面都是手写字符串模板，导出后不依赖任何构建工具。
     ============================================================ */

  function baseUrl() {
    return String(state.config.siteUrl || '').replace(/\/+$/, '');
  }

  function absUrl(path) {
    var base = baseUrl();
    if (!base) return '';
    return base + '/' + String(path == null ? '' : path).replace(/^\/+/, '');
  }

  function prefixFor(depth) {
    return new Array(depth + 1).join('../');
  }

  function pageHead(options) {
    var cfg = state.config;
    var siteName = cfg.siteName || '我的文档站';
    var title = options.title ? options.title + ' · ' + siteName : siteName + ' · 中文技术文档';
    var description = options.description || cfg.description || '';
    var depth = options.depth || 0;
    var prefix = prefixFor(depth);
    var cssHref = options.cssHref || (prefix + 'assets/css/site.css');
    var themeTag = '';
    if (options.preview) {
      themeTag = '<style id="site-theme">\n' + siteThemeCss() + '</style>\n';
    } else {
      themeTag = '<link rel="stylesheet" href="' + esc(options.themeCssHref || (prefix + 'assets/css/theme.css')) + '">\n';
    }
    var canonical = options.path != null ? absUrl(options.path) : '';
    var htmlAttrs = options.preview
      ? ' data-theme="' + themeNow() + '"'
      : ' data-theme="light"';
    var themeScript = options.preview ? '' :
      '<script>(function(){try{var t=localStorage.getItem("czgrzx-docs-theme");' +
      'if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}' +
      '}catch(e){}})();</script>\n';
    var ld = '';
    if (options.ld) {
      ld = '<script type="application/ld+json">' + safeJson(options.ld) + '</script>\n';
    }
    var links = '';
    if (canonical) {
      links += '<link rel="canonical" href="' + esc(canonical) + '">\n';
      links += '<meta property="og:url" content="' + esc(canonical) + '">\n';
    }
    return '<!DOCTYPE html>\n<html lang="zh-CN"' + htmlAttrs + '>\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + esc(title) + '</title>\n' +
      '<meta name="description" content="' + esc(description) + '">\n' +
      '<meta name="robots" content="' + esc(options.robots || 'index,follow') + '">\n' +
      '<meta name="color-scheme" content="light dark">\n' +
      '<meta name="theme-color" content="#f4f0e6">\n' +
      links +
      '<meta property="og:type" content="' + (options.ogType || 'website') + '">\n' +
      '<meta property="og:title" content="' + esc(options.ogTitle || title) + '">\n' +
      '<meta property="og:description" content="' + esc(description) + '">\n' +
      '<link rel="icon" href="' + prefix + 'assets/favicon.svg" type="image/svg+xml">\n' +
      '<link rel="stylesheet" href="' + esc(cssHref) + '">\n' +
      themeTag + themeScript + ld +
      '</head>\n';
  }

  function headerHtml(prefix, preview) {
    var home = preview ? '#' : prefix + 'index.html';
    var articles = preview ? '#' : prefix + 'articles/index.html';
    var learning = preview ? '#' : prefix + 'learning.html';
    var search = preview ? '#' : prefix + 'search.html';
    var pageLinks = navPages().map(function (page) {
      return '<a href="' + (preview ? '#' : prefix + pagePath(page)) + '">' + esc(page.title || '页面') + '</a>\n';
    }).join('');
    return '<header class="site-header">\n' +
      '  <a class="brand" href="' + home + '">' + esc(state.config.siteName || '我的文档站') + '</a>\n' +
      '  <nav class="site-nav" aria-label="主导航">\n' +
      '    <a href="' + articles + '">文章</a>\n' +
      '    <a href="' + learning + '">学习路线</a>\n' +
      '    <a href="' + search + '">搜索</a>\n' +
      pageLinks +
      '  </nav>\n' +
      '  <button class="theme-toggle" type="button" data-theme-toggle aria-label="切换明暗主题">切换主题</button>\n' +
      '</header>\n';
  }

  function footerHtml(prefix, preview) {
    var links = preview ? '#' : null;
    var pageLinks = navPages().map(function (page) {
      return '<a href="' + (links || prefix + pagePath(page)) + '">' + esc(page.title || '页面') + '</a>\n';
    }).join('');
    return '<footer class="site-footer">\n' +
      '  <div class="footer-row">\n' +
      '    <p>' + esc(state.config.copyright || '© ' + new Date().getFullYear() + ' ' + (state.config.siteName || '我的文档站')) + '</p>\n' +
      '    <nav aria-label="页脚导航">\n' +
      '      <a href="' + (links || prefix + 'index.html') + '">首页</a>\n' +
      '      <a href="' + (links || prefix + 'articles/index.html') + '">文章</a>\n' +
      '      <a href="' + (links || prefix + 'learning.html') + '">学习路线</a>\n' +
      '      <a href="' + (links || prefix + 'search.html') + '">搜索</a>\n' +
      pageLinks +
      '    </nav>\n' +
      '  </div>\n' +
      '</footer>\n';
  }

  function articleCardHtml(item, prefix) {
    var tags = (item.tags || []).map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('');
    if (!tags) tags = '<span class="tag">' + esc(item.topicName || '未分类') + '</span>';
    return '<a class="article-card" href="' + prefix + esc(item.url) + '" data-slug="' + esc(item.slug) + '" data-article-card' +
      ' data-direction="' + esc(item.direction) + '" data-series="' + esc(item.series) + '" data-topic="' + esc(item.topic) + '"' +
      ' data-difficulty="' + esc(item.difficulty) + '" data-tags="' + esc((item.tags || []).join(',')) + '">\n' +
      '  <div class="card-top"><span class="badge badge-level" data-level="' + esc(item.difficulty) + '">' + esc(item.difficulty) + '</span>' +
      '<span class="card-time">约 ' + item.minutes + ' 分钟</span><span class="availability" data-availability hidden>待更新</span></div>\n' +
      '  <p class="card-title">' + esc(item.title) + '</p>\n' +
      '  <p>' + esc(item.summary) + '</p>\n' +
      '  <div class="card-tags">' + tags + '</div>\n' +
      '  <div class="card-direction">方向：<b>' + esc(item.directionName) + '</b></div>\n' +
      '</a>\n';
  }

  function homePage(catalog, directions) {
    var total = catalog.length;
    var liveDirections = directions.filter(function (d) { return d.count > 0; }).length;
    var intro = catalog.slice(0, 6);
    var aside = intro.map(function (item) {
      return '<li><a href="' + esc(item.url) + '">' + esc(item.title) + '</a></li>';
    }).join('\n');

    var sections = '';
    var directionIndex = 0;
    (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (d) {
      var items = catalog.filter(function (a) { return a.direction === d.id; });
      if (!items.length) return;
      directionIndex += 1;
      var num = String(directionIndex).padStart(2, '0');
      var seriesHtml = '';
      SERIES.forEach(function (s) {
        var sItems = items.filter(function (a) { return a.series === s.id; });
        if (!sItems.length) return;
        var topicsHtml = '';
        topicsFor(d.id, s.id).forEach(function (t) {
          var tItems = sItems.filter(function (a) { return a.topic === t.slug; });
          if (!tItems.length) return;
          topicsHtml += '<section class="group-section" id="group-' + esc(d.id) + '-' + esc(s.id) + '-' + esc(t.slug) + '">\n' +
            '  <div class="group-head"><div><span class="group-index">' + esc(s.name) + ' / ' + esc(t.name) + '</span>' +
            '<h3>' + esc(t.name) + '</h3>' + (t.intro ? '<p>' + esc(t.intro) + '</p>' : '') + '</div>' +
            '<span class="group-count">' + tItems.length + ' 篇</span></div>\n' +
            '  <div class="card-grid">\n' + tItems.map(function (a) { return articleCardHtml(a, ''); }).join('') + '  </div>\n' +
            '</section>\n';
        });
        seriesHtml += '<div class="series-block" id="series-' + esc(d.id) + '-' + esc(s.id) + '">\n' +
          '  <p class="series-label"><span>' + esc(s.name) + '</span><span>' + sItems.length + ' 篇</span></p>\n' +
          topicsHtml + '</div>\n';
      });
      sections += '<section class="direction-section" id="direction-' + esc(d.id) + '">\n' +
        '  <div class="direction-head"><div><span class="eyebrow">方向 ' + num + '</span><h2>' + esc(d.name) + '</h2>' +
        (d.intro ? '<p>' + esc(d.intro) + '</p>' : '') + '</div><span class="group-count">' + items.length + ' 篇</span></div>\n' +
        seriesHtml + '</section>\n';
    });

    if (!sections) {
      sections = '<section class="direction-section"><div class="direction-head"><div><span class="eyebrow">还没有内容</span>' +
        '<h2>先去建文章</h2><p>打开建站器左侧的「新建文章」，或者到站点设置里添加方向和主题。</p></div></div></section>\n';
    }

    return pageHead({ title: '', description: state.config.description || '', path: '', depth: 0 }) +
      '<body class="page-home">\n' +
      '<a class="skip-link" href="#main">跳到正文</a>\n' + headerHtml('', false) +
      '<main id="main" class="shell">\n' +
      '  <section class="hero">\n' +
      '    <div class="hero-copy">\n' +
      '      <span class="eyebrow">中文技术文档</span>\n' +
      '      <h1>' + esc(state.config.tagline || '先弄明白原理，再记用法。') + '</h1>\n' +
      '      <p class="hero-lede">' + esc(state.config.description || '') + '</p>\n' +
      '      <form class="hero-search" action="search.html" method="get" role="search">\n' +
      '        <input type="search" name="q" placeholder="搜一篇文章，比如：事件循环、盒模型" aria-label="搜索文章" autocomplete="off">\n' +
      '        <button class="btn btn-primary" type="submit">搜索</button>\n' +
      '      </form>\n' +
      '      <div class="hero-actions"><a class="btn btn-primary" href="learning.html">按路线学习</a>' +
      '<a class="btn" href="articles/index.html">浏览全部文章</a></div>\n' +
      '      <div class="hero-facts"><span>' + total + ' 篇已上线 · ' + liveDirections + ' 个方向</span>' +
      '<span>' + state.config.series.length + ' 个系列</span><span>纯静态，无服务端</span></div>\n' +
      '    </div>\n' +
      '    <aside class="hero-aside">\n' +
      '      <h2>第一次来，从这几篇开始</h2>\n' +
      '      <p>不要求一次读完，但跨过去读容易卡住。</p>\n' +
      '      <ol class="order-list">\n' + aside + '\n      </ol>\n' +
      '    </aside>\n' +
      '  </section>\n' +
      '  <div class="home-notes">\n' +
      '    <div class="home-note"><h2>这里讲什么</h2><p>每篇尽量从真实问题讲起：现象是什么、原因在哪、第一步该查什么。术语第一次出现时会当场解释。</p></div>\n' +
      '    <div class="home-note"><h2>怎么读</h2><p>想系统学，按学习路线走；只想解决眼前的问题，直接用搜索，命中段落会带你到具体小节。</p></div>\n' +
      '    <div class="home-note"><h2>怎么更新</h2><p>整套站是纯静态文件。改完文章重新导出、解压覆盖，就能上线。</p></div>\n' +
      '  </div>\n' +
      sections +
      '</main>\n' + footerHtml('', false) +
      '<script src="data/articles.js" defer></script>\n' +
      '<script src="data/routes.js" defer></script>\n' +
      '<script src="assets/js/site.js" defer></script>\n' +
      '</body>\n</html>';
  }

  function listPage(catalog, directions) {
    var prefix = '../';
    var chips = directions.filter(function (d) { return d.count > 0; }).map(function (d) {
      var items = catalog.filter(function (a) { return a.direction === d.id; });
      var levels = { '入门': 0, '基础': 0, '进阶': 0, '深入': 0 };
      items.forEach(function (a) { if (levels[a.difficulty] != null) levels[a.difficulty] += 1; });
      var dist = Object.keys(levels).map(function (key) {
        var pct = items.length ? Math.max(8, Math.round(levels[key] / items.length * 100)) : 25;
        return '<b data-level="' + key + '" style="flex:' + pct + '"></b>';
      }).join('');
      return '<li><a class="series-chip" href="?direction=' + encodeURIComponent(d.id) + '" data-series-chip' +
        ' data-series-detail="' + esc(d.name + '：' + items.length + ' 篇，' + topicsFor(d.id).length + ' 个主题') + '">\n' +
        '  <span class="series-chip-name">' + esc(d.name) + '</span>' +
        '<span class="series-chip-meta"><span class="series-chip-count">' + items.length + '</span>' +
        '<i class="series-dist" aria-hidden="true">' + dist + '</i></span>\n' +
        '</a></li>';
    }).join('');

    var groups = '';
    (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (d) {
      SERIES.forEach(function (s) {
        var items = catalog.filter(function (a) { return a.direction === d.id && a.series === s.id; });
        if (!items.length) return;
        var topicBlocks = '';
        topicsFor(d.id, s.id).forEach(function (t) {
          var list = items.filter(function (a) { return a.topic === t.slug; });
          if (!list.length) return;
          var rows = list.map(function (a) {
            var tagHtml = (a.tags || []).map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('');
            return '<a class="article-row" href="' + prefix + esc(a.url) + '" data-slug="' + esc(a.slug) + '"' +
              ' data-direction="' + esc(d.id) + '" data-series="' + esc(s.id) + '" data-topic="' + esc(t.slug) + '"' +
              ' data-group="' + esc(t.slug) + '" data-difficulty="' + esc(a.difficulty) + '" data-level="' + esc(a.difficulty) + '"' +
              ' data-tags="' + esc((a.tags || []).join(',')) + '">\n' +
              '  <div><h4 class="row-title">' + esc(a.title) + '</h4><p>' + esc(a.summary) + '</p>' +
              (tagHtml ? '<div class="row-tags">' + tagHtml + '</div>' : '') + '</div>\n' +
              '  <div class="row-meta"><div class="row-badges"><span class="badge badge-level" data-level="' + esc(a.difficulty) + '">' +
              esc(a.difficulty) + '</span><span class="availability" data-availability hidden>待更新</span></div>' +
              '<span>' + esc(d.name) + ' · ' + esc(s.name) + ' · ' + esc(t.name) + ' · 约 ' + a.minutes + ' 分钟</span></div>\n' +
              '</a>\n';
          }).join('');
          topicBlocks += '<div class="list-topic" data-topic-group="' + esc(d.id) + '-' + esc(s.id) + '-' + esc(t.slug) + '">\n' +
            '  <h3>' + esc(t.name) + ' <span>' + list.length + ' 篇</span></h3>\n' + rows + '</div>\n';
        });
        groups += '<section class="list-series" data-series-group="' + esc(d.id) + '-' + esc(s.id) + '">\n' +
          '  <div class="list-series-head"><div><span class="eyebrow">' + esc(d.name) + ' · ' + esc(s.name) + '</span>' +
          '<h2>' + esc(s.name) + '</h2></div><span class="group-count">' + items.length + ' 篇</span></div>\n' +
          topicBlocks + '</section>\n';
      });
    });

    if (!groups) groups = '<div class="empty-state"><p>还没有文章。</p></div>';

    return pageHead({ title: '全部文章', description: '按方向、系列、主题和标签筛选全部文章。', path: 'articles/', depth: 1 }) +
      '<body class="page-articles" data-site-depth="1">\n' +
      '<a class="skip-link" href="#main">跳到正文</a>\n' + headerHtml(prefix, false) +
      '<main id="main" class="shell">\n' +
      '  <div class="page-intro"><span class="eyebrow">全部文章</span><h1>按主题翻，或者按标签找</h1>' +
      '<p>共 ' + catalog.length + ' 篇，分布在 ' + directions.filter(function (d) { return d.count > 0; }).length + ' 个方向。筛选条件会写在网址里，可以直接分享。</p></div>\n' +
      '  <section class="series-overview" aria-label="按方向看">\n' +
      '    <div class="section-head"><div><h2>方向</h2><p>点一个方向，下面的列表就只留它。</p></div></div>\n' +
      '    <ul class="series-chips">\n' + chips + '\n    </ul>\n' +
      '  </section>\n' +
      '  <div class="filter-bar" data-filters>\n' +
      '    <div class="filter-row" data-filter="direction"><span class="filter-label">方向</span><div class="filter-options" data-options="direction"></div></div>\n' +
      '    <div class="filter-row" data-filter="series"><span class="filter-label">系列</span><div class="filter-options" data-options="series"></div></div>\n' +
      '    <div class="filter-row" data-filter="topic"><span class="filter-label">主题</span><div class="filter-options" data-options="topic"></div></div>\n' +
      '    <div class="filter-row" data-filter="tag"><span class="filter-label">标签</span><div class="tag-filter" data-tag-filter>\n' +
      '      <div class="tag-selected" data-tag-selected></div>\n' +
      '      <div class="tag-input-wrap"><input class="tag-search" type="search" data-tag-search placeholder="搜标签，可多选" aria-label="搜索并选择标签" autocomplete="off" role="combobox" aria-expanded="false"><button class="tag-clear" type="button" data-tag-clear aria-label="清空已选标签" hidden>清空</button></div>\n' +
      '      <ul class="tag-suggest" data-tag-suggest role="listbox" aria-label="标签建议" hidden></ul>\n' +
      '      <p class="tag-mode-hint">选多个标签时，命中任意一个就会显示。</p>\n' +
      '    </div></div>\n' +
      '    <div class="filter-row filter-row-foot"><span class="filter-label">操作</span><div class="filter-options"><button class="filter-clear" type="button" data-filter-clear>清空筛选</button></div></div>\n' +
      '  </div>\n' +
      '  <p class="filter-summary" data-filter-summary>共 ' + catalog.length + ' 篇</p>\n' +
      '  <div class="article-list" data-article-list>\n' + groups + '</div>\n' +
      '</main>\n' + footerHtml(prefix, false) +
      '<script src="../data/articles.js" defer></script>\n' +
      '<script src="../data/routes.js" defer></script>\n' +
      '<script src="../assets/js/site.js" defer></script>\n' +
      '</body>\n</html>';
  }

  function learningPage(catalog, directions, routes) {
    var totalSteps = routes.reduce(function (sum, r) { return sum + r.steps.length; }, 0);
    var groups = '';
    var routeNo = 0;
    (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (d) {
      var items = catalog.filter(function (a) { return a.direction === d.id; });
      if (!items.length) return;
      var cards = routes.filter(function (r) { return r.direction === d.id; }).map(function (route) {
        routeNo += 1;
        var steps = route.steps.map(function (step, i) {
          var item = catalog.filter(function (a) { return a.slug === step.slug; })[0];
          var url = item ? item.url : '';
          return '<li class="route-step" data-slug="' + esc(step.slug) + '">\n' +
            '  <span class="step-no">' + String(i + 1).padStart(2, '0') + '</span>\n' +
            '  <div class="step-main"><a href="' + esc(url) + '">' + esc(step.title) + '</a>' +
            '<span class="step-meta">' + esc(step.meta) + '</span></div>\n' +
            '  <button class="step-state" type="button" data-step-state data-slug="' + esc(step.slug) + '">未读</button>\n' +
            '</li>\n';
        }).join('');
        return '<article class="route-card" data-route="' + esc(route.id) + '">\n' +
          '  <header class="route-head"><div><span class="route-no">路线 ' + String(routeNo).padStart(2, '0') + '</span>' +
          '<h3>' + esc(route.name) + '</h3></div>' +
          '<div class="route-progress"><span data-route-progress>0 / ' + route.steps.length + ' 已读</span>' +
          '<i class="bar"><b data-route-bar style="width:0%"></b></i></div></header>\n' +
          '  <p class="route-desc">' + esc(route.intro) + '</p>\n' +
          '  <ol class="route-steps">\n' + steps + '  </ol>\n' +
          '</article>\n';
      }).join('');
      groups += '<section class="route-group" id="routes-' + esc(d.id) + '" data-route-group="' + esc(d.id) + '">\n' +
        '  <div class="route-group-head"><div><span class="eyebrow">' + esc(d.name) + '</span>' +
        '<h2>' + esc(d.name) + '的学习顺序</h2><p>' + esc(d.intro || '') + '</p></div><span class="group-count">' +
        items.length + ' 篇</span></div>\n' + cards + '</section>\n';
    });

    if (!groups) groups = '<div class="empty-state"><p>还没有路线。先写文章，导出时会按方向和系列自动生成。</p></div>';

    return pageHead({ title: '学习路线', description: '按方向和系列排好的学习顺序，勾选文章记录读到哪了。', path: 'learning.html', depth: 0 }) +
      '<body class="page-learning" data-site-depth="0">\n' +
      '<a class="skip-link" href="#main">跳到正文</a>\n' + headerHtml('', false) +
      '<main id="main" class="shell">\n' +
      '  <div class="page-intro"><span class="eyebrow">学习路线</span><h1>按顺序读，少走回头路</h1>' +
      '<p>路线按方向和系列自动生成，共 ' + routes.length + ' 条、' + totalSteps + ' 个步骤。勾选状态只存在这台设备的浏览器里。</p></div>\n' +
      '  <section class="custom-route" data-custom-route>\n' +
      '    <div class="custom-route-head"><div><h2>自定义路线</h2><p>挑几条你想连起来读的文章，生成一条只属于你的顺序。</p></div>' +
      '<button class="btn" type="button" data-route-create>新建自定义路线</button></div>\n' +
      '    <div class="custom-route-form" data-route-form hidden>\n' +
      '      <input class="route-name" type="text" data-route-name maxlength="40" placeholder="给路线起个名字，比如：两周补基础">\n' +
      '      <div class="route-picker" data-route-picker></div>\n' +
      '      <div class="custom-route-actions"><button class="btn btn-primary" type="button" data-route-save>保存路线</button>' +
      '<button class="btn" type="button" data-route-cancel>取消</button></div>\n' +
      '    </div>\n' +
      '    <div class="custom-route-list" data-custom-routes></div>\n' +
      '  </section>\n' +
      '  <section class="progress-panel" data-progress>\n' +
      '    <div class="progress-copy"><span class="eyebrow">本机进度</span><h2>你已经读了 <b data-progress-count>0</b> / ' + catalog.length + ' 篇</h2>' +
      '<p>记录存在 localStorage，换浏览器或清缓存就没了。它只影响这里的勾选，不影响文章内容。</p></div>\n' +
      '    <div class="progress-ring" data-progress-ring style="--p:0"><span data-progress-percent>0%</span></div>\n' +
      '    <div class="progress-actions"><button class="btn" type="button" data-progress-reset>清空本机进度</button></div>\n' +
      '  </section>\n' +
      groups +
      '</main>\n' + footerHtml('', false) +
      '<script src="data/articles.js" defer></script>\n' +
      '<script src="data/routes.js" defer></script>\n' +
      '<script src="assets/js/site.js" defer></script>\n' +
      '</body>\n</html>';
  }

  function searchPage(catalog) {
    return pageHead({ title: '搜索', description: '站内搜索：按关键词、方向、系列、主题和标签找文章。', path: 'search.html', depth: 0 }) +
      '<body class="page-search" data-site-depth="0">\n' +
      '<a class="skip-link" href="#main">跳到正文</a>\n' + headerHtml('', false) +
      '<main id="main" class="shell">\n' +
      '  <div class="page-intro"><span class="eyebrow">搜索</span><h1>直接搜你卡住的那个词</h1>' +
      '<p>输入即筛，命中段落会标记出来。共索引 ' + catalog.length + ' 篇文章。</p></div>\n' +
      '  <form class="search-panel" data-search-panel role="search" action="search.html" method="get">\n' +
      '    <div class="search-main"><label class="search-input-wrap"><span class="search-icon" aria-hidden="true"></span>' +
      '<input class="search-input" type="search" name="q" data-search-input placeholder="搜标题、段落或标签，比如：缓存、索引、锁" autocomplete="off" aria-label="搜索关键词"></label>' +
      '<button class="btn btn-primary" type="submit">搜索</button></div>\n' +
      '    <div class="search-filters" data-search-filters>\n' +
      '      <div class="filter-row" data-filter="direction"><span class="filter-label">方向</span><div class="filter-options" data-options="direction"></div></div>\n' +
      '      <div class="filter-row" data-filter="series"><span class="filter-label">系列</span><div class="filter-options" data-options="series"></div></div>\n' +
      '      <div class="filter-row" data-filter="topic"><span class="filter-label">主题</span><div class="filter-options" data-options="topic"></div></div>\n' +
      '    </div>\n' +
      '  </form>\n' +
      '  <p class="search-status" data-search-status>输入关键词开始搜索。</p>\n' +
      '  <div class="search-results" data-search-results></div>\n' +
      '  <div class="empty-state" data-search-empty hidden><p data-search-empty-reason>没有匹配的文章。</p>' +
      '<button class="btn" type="button" data-search-clear>清除搜索词和筛选</button>' +
      '<p class="empty-hint">也可以去<a href="articles/index.html">文章列表</a>翻一翻。</p></div>\n' +
      '  <section class="search-help"><h2>怎么搜更快</h2><ul>' +
      '<li>输入即筛，不用按回车；按 <kbd>↓</kbd> / <kbd>↑</kbd> 在结果间移动，按 <kbd>Enter</kbd> 打开。</li>' +
      '<li>按 <kbd>Esc</kbd> 清空当前关键词。</li>' +
      '<li>命中段落的结果会带上“命中段落”，点进去会直接定位到那一节。</li>' +
      '<li>搜不到时先换更短的词，比如把“浏览器缓存怎么配”拆成“缓存”。</li></ul></section>\n' +
      '</main>\n' + footerHtml('', false) +
      '<script src="data/search-index.js" defer></script>\n' +
      '<script src="data/directions.js" defer></script>\n' +
      '<script src="assets/js/site.js" defer></script>\n' +
      '</body>\n</html>';
  }

  function noticePage(catalog) {
    return pageHead({ title: '站点须知', description: '站点内容来源、数据存储、转载和免责说明。', path: 'notice.html', depth: 0 }) +
      '<body class="page-notice" data-site-depth="0">\n' +
      '<a class="skip-link" href="#main">跳到正文</a>\n' + headerHtml('', false) +
      '<main id="main" class="shell">\n' +
      '  <div class="page-intro"><span class="eyebrow">站点须知</span><h1>关于这个站</h1>' +
      '<p>这是一套纯静态文档站，共 ' + catalog.length + ' 篇文章。页面、搜索和阅读进度都在你的浏览器里完成，没有后端。</p></div>\n' +
      '  <section class="notice-section"><h2>内容怎么来的</h2>' +
      '<p>文章由站点维护者用浏览器里的低代码建站器编写，导出成静态 HTML 后发布。内容以发布时的版本为准，旧的导出包不会自动更新。</p></section>\n' +
      '  <section class="notice-section"><h2>你的数据存在哪</h2>' +
      '<p>阅读进度和主题偏好存在浏览器的 localStorage；文章数据只存在写作者的浏览器 IndexedDB 里，不会上传到服务器。换设备或清空浏览器数据都会丢失。</p></section>\n' +
      '  <section class="notice-section"><h2>转载与免责</h2>' +
      '<p>站内文章用于学习和排查问题，不构成任何形式的保证。照着操作前先备份数据；因误操作造成的损失，站点维护者不承担责任。</p></section>\n' +
      '  <section class="notice-section"><h2>联系</h2><p>发现错误或想补充内容，请通过站点页脚或仓库里的联系方式反馈。</p></section>\n' +
      '</main>\n' + footerHtml('', false) +
      '<script src="assets/js/site.js" defer></script>\n' +
      '</body>\n</html>';
  }

  function notFoundPage() {
    return pageHead({ title: '页面走丢了', description: '这个地址没有对应的页面。', path: '404.html', depth: 0, robots: 'noindex,follow' }) +
      '<body class="page-404" data-site-depth="0">\n' +
      '<a class="skip-link" href="#main">跳到正文</a>\n' + headerHtml('', false) +
      '<main id="main" class="shell">\n' +
      '  <section class="not-found">\n' +
      '    <span class="eyebrow">404</span>\n' +
      '    <h1>这个地址没有页面</h1>\n' +
      '    <p>可能是链接拼错了，也可能是文章改了 slug。旧链接不会自动跳转，因为这是一套纯静态站。</p>\n' +
      '    <div class="hero-actions"><a class="btn btn-primary" href="index.html">回首页</a>' +
      '<a class="btn" href="articles/index.html">看全部文章</a><a class="btn" href="search.html">去搜索</a></div>\n' +
      '  </section>\n' +
      '</main>\n' + footerHtml('', false) +
      '<script src="assets/js/site.js" defer></script>\n' +
      '</body>\n</html>';
  }

  function articlePage(article, options) {
    var opts = options || {};
    var d = directionById(article.directionId);
    var s = seriesById(article.seriesId);
    var t = topicById(article.topicId);
    if (!d || !s || !t) return '';
    var prefix = opts.preview ? '' : '../../../../';
    var prepared = prepareArticle(article, prefix);
    var cssHref = opts.preview ? new URL('vendor/site.css', location.href).href : prefix + 'assets/css/site.css';
    var minutes = minutesOf(prepared);
    var path = pathFor(article);
    var canonical = absUrl(path);

    var siblings = articlesInTopic(t.id);
    var idx = siblings.findIndex(function (a) { return a.id === article.id; });
    var prev = idx > 0 ? siblings[idx - 1] : null;
    var next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
    var foot = '<footer class="article-foot">\n';
    if (prev) foot += '<a class="prev" href="' + (opts.preview ? '#' : prefix + pathFor(prev)) + '">上一篇：' + esc(prev.title) + '</a>\n';
    if (next) foot += '<a class="next" href="' + (opts.preview ? '#' : prefix + pathFor(next)) + '">下一篇：' + esc(next.title) + '</a>\n';
    foot += '</footer>\n';

    var tags = (article.tags || []).map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('');
    var ld = canonical ? {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.summary || '',
      inLanguage: 'zh-CN',
      url: canonical,
      mainEntityOfPage: canonical,
      articleSection: t.name,
      keywords: (article.tags || []).join(','),
      author: { '@type': 'Organization', name: state.config.siteName || '我的文档站' },
      publisher: { '@type': 'Organization', name: state.config.siteName || '我的文档站' }
    } : null;

    var scripts = '';
    if (opts.preview) {
      var catalog = buildCatalog();
      var routes = buildRoutes(catalog);
      scripts = '<script>window.CZ_ARTICLES = ' + safeJson({ articles: catalog }) + ';' +
        'window.CZ_ROUTES = ' + safeJson({ routes: routes }) + ';' +
        'window.CZ_DIRECTIONS = ' + safeJson({ directions: buildDirections(catalog) }) + ';</script>\n' +
        '<script src="' + new URL('vendor/site.js', location.href).href + '" defer></script>\n';
    } else {
      scripts = '<script src="../../../../data/articles.js" defer></script>\n' +
        '<script src="../../../../data/routes.js" defer></script>\n' +
        '<script src="../../../../assets/js/site.js" defer></script>\n';
    }

    var blockScript = opts.preview ? '<script>document.addEventListener("click",function(e){' +
      'var a=e.target.closest("a");if(!a)return;var h=a.getAttribute("href")||"";' +
      'if(h.charAt(0)!=="#")e.preventDefault();},true);</script>\n' : '';
    var mermaidTags = mermaidScripts(prefix, !!opts.preview, prepared.bodyHtml);

    return pageHead({
      title: article.title,
      description: article.summary || prepared.text.slice(0, 120),
      path: opts.preview ? null : path,
      depth: opts.preview ? 0 : 4,
      cssHref: cssHref,
      ogType: 'article',
      ld: ld,
      preview: !!opts.preview
    }) +
      '<body class="page-article" data-site-depth="' + (opts.preview ? 0 : 4) + '">\n' +
      '<a class="skip-link" href="#article-body">跳到正文</a>\n' + blockScript + headerHtml(prefix, !!opts.preview) +
      '<main class="article-layout">\n' +
      '  <article class="article">\n' +
      '    <nav class="breadcrumb" aria-label="面包屑">\n' +
      '      <a href="' + (opts.preview ? '#' : prefix + 'index.html') + '">首页</a> <span class="sep">/</span> ' +
      '<a href="' + (opts.preview ? '#' : prefix + 'articles/index.html') + '">文章</a> <span class="sep">/</span> ' +
      '<a href="' + (opts.preview ? '#' : prefix + 'articles/index.html?direction=' + encodeURIComponent(d.id)) + '">' + esc(d.name) + '</a> <span class="sep">/</span> ' +
      '<span>' + esc(t.name) + '</span> <span class="sep">/</span> <span aria-current="page">' + esc(article.title) + '</span>\n' +
      '    </nav>\n' +
      '    <header class="article-head">\n' +
      '      <h1>' + esc(article.title) + '</h1>\n' +
      '      <p class="article-summary">' + esc(article.summary) + '</p>\n' +
      '      <div class="article-meta" data-group="' + esc(t.slug) + '" data-order="' + (article.order || 1) + '"' +
      ' data-difficulty="' + esc(article.difficulty) + '" data-tags="' + esc((article.tags || []).join(',')) + '"' +
      ' data-direction="' + esc(d.name) + '">\n' +
      '        <span class="badge badge-level">' + esc(article.difficulty) + '</span>\n' +
      '        <span class="badge">' + esc(t.name) + '</span>\n' +
      '        <span>约 ' + minutes + ' 分钟</span>\n' +
      '        ' + tags + '\n' +
      '      </div>\n' +
      '    </header>\n' +
      '    <div class="article-body" id="article-body">\n' + prepared.bodyHtml + '\n    </div>\n' +
      foot +
      '  </article>\n' +
      '  <aside class="article-toc" data-toc aria-label="本页目录"></aside>\n' +
      '</main>\n' + footerHtml(prefix, !!opts.preview) + scripts + mermaidTags +
      componentScriptsHtml(article.blocks) +
      '</body>\n</html>';
  }

  function customPageHtml(page, options) {
    var opts = options || {};
    var path = pagePath(page);
    var depth = opts.preview ? 0 : Math.max(0, path.split('/').length - 1);
    var prefix = opts.preview ? '' : prefixFor(depth);
    var prepared = prepareArticle({ blocks: page.blocks || [], body: page.body || '' }, prefix);
    var cssHref = opts.preview ? new URL('vendor/site.css', location.href).href : prefix + 'assets/css/site.css';
    var scripts;
    if (opts.preview) {
      var catalog = buildCatalog();
      scripts = '<script>window.CZ_ARTICLES = ' + safeJson({ articles: catalog }) + ';' +
        'window.CZ_ROUTES = ' + safeJson({ routes: buildRoutes(catalog) }) + ';' +
        'window.CZ_DIRECTIONS = ' + safeJson({ directions: buildDirections(catalog) }) + ';</script>\n' +
        '<script src="' + new URL('vendor/site.js', location.href).href + '" defer></script>\n';
    } else {
      scripts = '<script src="' + prefix + 'data/articles.js" defer></script>\n' +
        '<script src="' + prefix + 'data/routes.js" defer></script>\n' +
        '<script src="' + prefix + 'assets/js/site.js" defer></script>\n';
    }
    var blockScript = opts.preview ? '<script>document.addEventListener("click",function(e){' +
      'var a=e.target.closest("a");if(!a)return;var h=a.getAttribute("href")||"";' +
      'if(h.charAt(0)!=="#")e.preventDefault();},true);</script>\n' : '';
    var mermaidTags = mermaidScripts(prefix, !!opts.preview, prepared.bodyHtml);

    return pageHead({
      title: page.title,
      description: page.summary || prepared.text.slice(0, 120),
      path: opts.preview ? null : path,
      depth: depth,
      cssHref: cssHref,
      preview: !!opts.preview
    }) +
      '<body class="page-custom" data-site-depth="' + depth + '">\n' +
      '<a class="skip-link" href="#page-body">跳到正文</a>\n' + blockScript +
      headerHtml(prefix, !!opts.preview) +
      '<main class="article-layout">\n' +
      '  <article class="article">\n' +
      '    <nav class="breadcrumb" aria-label="面包屑"><a href="' + (opts.preview ? '#' : prefix + 'index.html') + '">首页</a> <span class="sep">/</span> <span aria-current="page">' + esc(page.title) + '</span></nav>\n' +
      '    <header class="article-head">\n' +
      '      <h1>' + esc(page.title) + '</h1>\n' +
      (page.summary ? '      <p class="article-summary">' + esc(page.summary) + '</p>\n' : '') +
      '    </header>\n' +
      '    <div class="article-body" id="page-body">\n' + prepared.bodyHtml + '\n    </div>\n' +
      '  </article>\n' +
      '</main>\n' +
      footerHtml(prefix, !!opts.preview) + scripts + mermaidTags +
      componentScriptsHtml(page.blocks) +
      '</body>\n</html>';
  }

  /* 第三方站点运行时清单唯一来源：shared/export-assets.js（F3 第②步）。
     浏览器导出与服务端导出共用同一张表、同一套选择/拷贝逻辑。 */
  function conditionalAssetTable() {
    var tool = window.LC && window.LC.ExportAssets;
    if (!tool) throw new Error('导出资源模块未加载：shared/export-assets.js');
    return tool.CONDITIONAL_ASSETS;
  }

  /* 单个产物额外背的第三方运行时超过这条线就提示，不阻断导出 */
  var EXPORT_WARN_BYTES = 4 * 1024 * 1024;

  function mermaidScripts(prefix, preview, bodyHtml) {
    if (!(window.LC && window.LC.Mermaid) || !window.LC.Mermaid.hasMermaidMarkup(bodyHtml)) return '';
    var src = preview ? new URL('vendor/mermaid.min.js', location.href).href : prefix + 'assets/js/mermaid.min.js';
    return '<script src="' + src + '"></script>\n' + window.LC.Mermaid.bootstrap() + '\n';
  }

  function buildExportFiles() {
    var catalog = buildCatalog();
    var directions = buildDirections(catalog);
    var routes = buildRoutes(catalog);
    var search = buildSearchIndex(catalog);
    var articles = state.articles.filter(function (a) { return pathFor(a); });
    var files = {
      'index.html': homePage(catalog, directions),
      'articles/index.html': listPage(catalog, directions),
      'learning.html': learningPage(catalog, directions, routes),
      'search.html': searchPage(catalog),
      'notice.html': noticePage(catalog),
      '404.html': notFoundPage(),
      'sitemap.xml': sitemapXml(catalog),
      'robots.txt': robotsTxt(),
      'data/articles.js': 'window.CZ_ARTICLES = ' + safeJson({
        generatedAt: new Date().toISOString(),
        count: catalog.length,
        directions: directions,
        articles: catalog
      }) + ';\n',
      'data/directions.js': 'window.CZ_DIRECTIONS = ' + safeJson({
        updatedAt: new Date().toISOString().slice(0, 10),
        directions: directions
      }) + ';\n',
      'data/routes.js': 'window.CZ_ROUTES = ' + safeJson({ routes: routes }) + ';\n',
      'data/search-index.js': 'window.CZ_SEARCH_INDEX = ' + safeJson({
        generatedAt: new Date().toISOString(),
        count: search.length,
        articles: search
      }) + ';\n',
      'assets/css/theme.css': siteThemeCss()
    };
    articles.forEach(function (a) {
      files[pathFor(a)] = articlePage(a, { preview: false });
    });
    pagesForExport().forEach(function (page) {
      files[pagePath(page)] = customPageHtml(page, { preview: false });
    });
    var pages = pagesForExport();
    files['manifest.json'] = JSON.stringify({
      format: 'lowcode-site',
      formatVersion: 1,
      version: '',
      exportedAt: new Date().toISOString(),
      siteName: state.config.siteName || '',
      articleCount: articles.length,
      pageCount: pages.length,
      routes: ['index.html', 'articles/index.html', 'learning.html', 'search.html', 'notice.html', '404.html']
        .concat(articles.map(pathFor))
        .concat(pages.map(pagePath)),
      config: clone(state.config),
      articles: clone(articles),
      pages: pages.map(function (page) {
        return { id: page.id, title: page.title, path: pagePath(page), slug: page.slug, nav: page.nav !== false, blocks: clone(page.blocks || []) };
      })
    }, null, 2);
    return { files: files, catalog: catalog, routes: routes, articles: articles, pages: pages };
  }

  function sitemapXml(catalog) {
    var base = baseUrl() || 'https://example.com';
    var urls = ['', 'articles/', 'learning.html', 'search.html', 'notice.html']
      .concat(catalog.map(function (a) { return a.url; }))
      .concat(pagesForExport().map(pagePath));
    var today = new Date().toISOString().slice(0, 10);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(function (path) {
        return '  <url><loc>' + escXml(base + '/' + path) + '</loc><lastmod>' + today + '</lastmod></url>\n';
      }).join('') +
      '</urlset>\n';
  }

  function robotsTxt() {
    var base = baseUrl() || 'https://example.com';
    return 'User-agent: *\nAllow: /\n\nSitemap: ' + base + '/sitemap.xml\n';
  }

  function escXml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch];
    });
  }

  /* ---------------- 设置页 ---------------- */

  /* ---------------- 组件库 ---------------- */

  function componentTemplateHint() {
    return '模板是一段 HTML，用 <code>{{字段名}}</code> 占位。比如 ' +
      '<code>&lt;div class="note note-info"&gt;&lt;strong&gt;{{title}}&lt;/strong&gt;&lt;p&gt;{{body}}&lt;/p&gt;&lt;/div&gt;</code>。' +
      '占位符会自动变成右侧属性面板里的输入框。';
  }

  function downloadTextFile(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1500);
  }

  function safeFilePart(text, fallback) {
    var name = String(text || '').trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
    return name || fallback;
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      if (file && file.text) {
        file.text().then(resolve, reject);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsText(file);
    });
  }

  function exportComponentFile(comp) {
    if (!comp) return;
    var payload = {
      format: 'lowcode-component',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      component: clone(comp)
    };
    downloadTextFile(safeFilePart(comp.name, 'component') + '.component.json', JSON.stringify(payload, null, 2));
    toast('已导出组件「' + comp.name + '」，包含 HTML、CSS 和 JS');
  }

  function normalizeImportedComponent(data) {
    if (!data || data.format !== 'lowcode-component') {
      throw new Error('这个文件不是低代码组件的导出文件（缺少 format: lowcode-component）。');
    }
    if (data.schemaVersion === undefined || data.schemaVersion === null) {
      throw new Error('组件文件缺少 schemaVersion，无法确认版本。');
    }
    if (Number(data.schemaVersion) > 1) {
      throw new Error('组件文件版本是 ' + data.schemaVersion + '，当前工作台只支持 schemaVersion 1，请先升级工作台。');
    }
    if (Number(data.schemaVersion) !== 1) {
      throw new Error('组件文件 schemaVersion 是 ' + data.schemaVersion + '，只接受 1。');
    }
    var c = data.component;
    if (!c || typeof c !== 'object') throw new Error('组件文件里缺少 component 对象。');
    if (typeof c.name !== 'string' || !c.name.trim()) throw new Error('组件缺少名称，无法导入。');
    if (typeof c.template !== 'string' || !c.template.trim()) throw new Error('组件缺少 HTML 模板，无法导入。');
    return {
      id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : uid('comp'),
      name: c.name.trim(),
      description: String(c.description || ''),
      template: c.template,
      css: String(c.css || ''),
      js: String(c.js || ''),
      fields: fieldsFromTemplate(c.template)
    };
  }

  function persistComponentChanges(message) {
    return dbPut(STORE_CONFIG, state.config).then(function () {
      renderComponents();
      renderQuickLib();
      renderComponentRail();
      renderCanvas();
      renderInspector();
      renderPreviewSoon();
      updateStorageSoon();
      toast(message);
    }).catch(function (err) { toast(writeError(err), true); });
  }

  function handleComponentImport(file) {
    if (!file) return;
    readFileText(file).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) {
        throw new Error('文件不是合法 JSON，可能已损坏或选错了文件。');
      }
      var comp = normalizeImportedComponent(data);
      var comps = state.config.components || [];
      var conflict = comps.filter(function (c) { return c.id === comp.id || c.name === comp.name; })[0];
      if (!conflict) {
        comps.push(comp);
        state.config.components = comps;
        persistComponentChanges('已导入组件「' + comp.name + '」');
        return;
      }
      showModal({
        title: '组件同名冲突',
        body: '<p>当前站点里已经有组件 <b>' + esc(conflict.name) + '</b>（id：<code>' + esc(conflict.id) + '</code>），和导入文件冲突。</p>' +
          '<p class="lc-hint">替换会用导入文件覆盖同名组件的 HTML / CSS / JS，引用它的区块会跟着变；另存会生成一个新组件，不动现有的。</p>',
        actions: [
          { label: '取消', onClick: function (close) { close(); } },
          {
            label: '另存为新组件',
            onClick: function (close) {
              close();
              comp.id = uid('comp');
              comp.name = comp.name + ' · 导入副本';
              var list = state.config.components || [];
              list.push(comp);
              state.config.components = list;
              persistComponentChanges('已另存为「' + comp.name + '」');
            }
          },
          {
            label: '替换同名',
            kind: 'lc-btn-primary',
            onClick: function (close) {
              close();
              var list = state.config.components || [];
              var idx = list.findIndex(function (c) { return c.id === conflict.id; });
              comp.id = conflict.id;
              list[idx] = comp;
              state.config.components = list;
              persistComponentChanges('已替换组件「' + comp.name + '」');
            }
          }
        ]
      });
    }).catch(function (err) {
      toast('导入组件失败：' + (err && err.message ? err.message : '未知错误'), true);
    });
  }

  function syncComponentCssToWorkbench() {
    var style = document.getElementById('lc-component-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'lc-component-css';
      document.head.appendChild(style);
    }
    style.textContent = componentCssAll();
  }

  function renderComponents() {
    syncComponentCssToWorkbench();
    var builtin = qs('[data-builtin-lib]');
    if (builtin) {
      builtin.innerHTML = BLOCK_DEFS.map(function (def) {
        return '<div class="lc-lib-card" draggable="true" data-lib-type="' + def.type + '">' +
          '<div class="lc-lib-name"><span>' + esc(def.name) + '</span><em>' + def.type + '</em></div>' +
          '<p class="lc-lib-desc">' + esc(def.hint) + '</p>' +
          '<button class="lc-lib-insert" type="button" data-insert-builtin="' + def.type + '">插入当前文档末尾 →</button>' +
          '</div>';
      }).join('');
    }
    var host = qs('[data-component-list]');
    var comps = (state.config && state.config.components) || [];
    var empty = qs('[data-component-empty]');
    if (empty) empty.hidden = comps.length > 0;
    if (host) {
      host.innerHTML = comps.map(function (comp) {
        var extras = [];
        if (String(comp.css || '').trim()) extras.push('CSS');
        if (String(comp.js || '').trim()) extras.push('JS');
        return '<div class="lc-comp-card" data-component-id="' + esc(comp.id) + '">' +
          '<div class="lc-comp-card-head"><b>' + esc(comp.name) + '</b><em>' + (comp.fields || []).length + ' 个字段' +
          (extras.length ? ' · 含 ' + extras.join(' + ') : '') + '</em></div>' +
          '<p>' + esc(comp.description || comp.template || '').slice(0, 140) + '</p>' +
          '<div class="lc-comp-card-actions">' +
            '<button class="lc-btn lc-btn-sm" type="button" data-insert-component="' + esc(comp.id) + '">插入</button>' +
            '<button class="lc-btn lc-btn-sm" type="button" data-edit-component="' + esc(comp.id) + '">编辑</button>' +
            '<button class="lc-btn lc-btn-sm" type="button" data-export-component="' + esc(comp.id) + '">导出</button>' +
            '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-delete-component="' + esc(comp.id) + '">删除</button>' +
          '</div></div>';
      }).join('');
    }
    renderComponentRail();
    var presetHost = qs('[data-preset-lib]');
    if (presetHost) {
      presetHost.innerHTML = PRESET_PAGES.map(function (preset) {
        return '<div class="lc-lib-card">' +
          '<div class="lc-lib-name"><span>' + esc(preset.name) + '</span><em>' + esc(preset.path) + '</em></div>' +
          '<p class="lc-lib-desc">' + esc(preset.description) + '</p>' +
          '<button class="lc-lib-insert" type="button" data-create-preset="' + preset.id + '">新建这个预设页 →</button>' +
          '</div>';
      }).join('');
    }
  }

  function insertIntoCurrent(type, componentId) {
    if (!state.doc) {
      toast('先在「内容」里打开一篇文章或页面，再插入组件', true);
      switchView('articles');
      return;
    }
    insertBlockAt(type, state.blocks.length, componentId);
    switchView('articles');
  }

  function openComponentEditor(id) {
    var existing = id ? componentById(id) : null;
    var comp = existing || { id: uid('comp'), name: '', description: '', template: '', fields: [] };
    showModal({
      title: existing ? '编辑自定义组件' : '新建自定义组件',
      body: '<div class="lc-field"><span>组件名称</span><input class="lc-input" data-comp-input="name" type="text" value="' + esc(comp.name) + '" placeholder="比如：发布检查清单" autocomplete="off"></div>' +
        '<div class="lc-field"><span>一句话说明</span><input class="lc-input" data-comp-input="description" type="text" value="' + esc(comp.description || '') + '" placeholder="它适合放在什么位置" autocomplete="off"></div>' +
        '<div class="lc-field"><span>HTML 模板</span><textarea class="lc-input" data-comp-input="template" rows="7" spellcheck="false" placeholder="' + esc('<div class="note note-info"><strong>{{title}}</strong><p>{{body}}</p></div>') + '">' + esc(comp.template) + '</textarea></div>' +
        '<div class="lc-field"><span>组件 CSS（可选）</span><textarea class="lc-input" data-comp-input="css" rows="5" spellcheck="false" placeholder=".my-card { border: 1px solid var(--line); }">' + esc(comp.css || '') + '</textarea></div>' +
        '<div class="lc-field"><span>组件 JS（可选）</span><textarea class="lc-input" data-comp-input="js" rows="5" spellcheck="false" placeholder="root.addEventListener(\'click\', function () { root.classList.toggle(\'is-open\'); });">' + esc(comp.js || '') + '</textarea></div>' +
        '<p class="lc-hint">' + componentTemplateHint() + ' CSS 会自动加上当前组件实例的作用域，不会污染整站；JS 每个实例独立执行，<code>root</code> 指向当前实例的根节点。</p>',
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: '保存组件',
          kind: 'lc-btn-primary',
          onClick: function (close) {
            var name = qs('[data-comp-input="name"]').value.trim();
            var desc = qs('[data-comp-input="description"]').value.trim();
            var template = qs('[data-comp-input="template"]').value;
            var css = qs('[data-comp-input="css"]').value;
            var js = qs('[data-comp-input="js"]').value;
            if (!name) { toast('组件名称不能为空', true); return; }
            if (!template.trim()) { toast('模板不能为空', true); return; }
            comp.name = name;
            comp.description = desc;
            comp.template = template;
            comp.css = css;
            comp.js = js;
            comp.fields = fieldsFromTemplate(template);
            var comps = state.config.components || [];
            if (existing) {
              var idx = comps.findIndex(function (c) { return c.id === comp.id; });
              comps[idx] = comp;
            } else {
              comps.push(comp);
            }
            state.config.components = comps;
            close();
            dbPut(STORE_CONFIG, state.config).then(function () {
              renderComponents();
              renderQuickLib();
              renderCanvas();
              renderInspector();
              renderPreviewSoon();
              toast(existing ? '组件已更新，引用它的区块会跟着变' : '组件已保存，可以拖进画布了');
              updateStorageSoon();
            }).catch(function (err) { toast(writeError(err), true); });
          }
        }
      ]
    });
  }

  function deleteComponent(id) {
    var comp = componentById(id);
    if (!comp) return;
    var used = state.articles.some(function (a) {
      return (a.blocks || []).some(function (b) { return b.type === 'component' && b.componentId === id; });
    }) || ((state.config.pages || []).some(function (p) {
      return (p.blocks || []).some(function (b) { return b.type === 'component' && b.componentId === id; });
    }));
    confirmDialog({
      title: '删除自定义组件',
      message: '确定删除「' + esc(comp.name) + '」？' +
        (used ? '已经有区块在引用它，删除后这些区块会显示为空的占位提示。' : '目前没有区块引用它。'),
      confirmLabel: '删除',
      onConfirm: function () {
        state.config.components = (state.config.components || []).filter(function (c) { return c.id !== id; });
        return dbPut(STORE_CONFIG, state.config).then(function () {
          renderComponents();
          renderQuickLib();
          renderCanvas();
          renderInspector();
          renderPreviewSoon();
          toast('组件已删除');
        });
      }
    });
  }

  function bindComponents() {
    var view = qs('#view-components');
    qsa('[data-new-component]').forEach(function (btn) {
      btn.addEventListener('click', function () { openComponentEditor(null); });
    });
    qsa('[data-import-component]').forEach(function (input) {
      input.addEventListener('change', function () {
        handleComponentImport(input.files && input.files[0]);
        input.value = '';
      });
    });
    if (!view) return;
    view.addEventListener('click', function (e) {
      var insertBuiltin = e.target.closest('[data-insert-builtin]');
      if (insertBuiltin) { insertIntoCurrent(insertBuiltin.getAttribute('data-insert-builtin')); return; }
      var insertComp = e.target.closest('[data-insert-component]');
      if (insertComp) { insertIntoCurrent('component', insertComp.getAttribute('data-insert-component')); return; }
      var edit = e.target.closest('[data-edit-component]');
      if (edit) { openComponentEditor(edit.getAttribute('data-edit-component')); return; }
      var exp = e.target.closest('[data-export-component]');
      if (exp) { exportComponentFile(componentById(exp.getAttribute('data-export-component'))); return; }
      var del = e.target.closest('[data-delete-component]');
      if (del) { deleteComponent(del.getAttribute('data-delete-component')); return; }
      var preset = e.target.closest('[data-create-preset]');
      if (preset) { createPresetPage(preset.getAttribute('data-create-preset')); }
    });
  }

  /* ---------------- 非内容页右侧信息栏 ---------------- */

  function asideRows(rows) {
    return rows.map(function (row) {
      return '<div class="lc-aside-stat' + (row.kind ? ' is-' + row.kind : '') + '"><span>' + esc(row.label) + '</span><b>' + esc(String(row.value)) + '</b></div>';
    }).join('');
  }

  function forEachDocBlock(callback) {
    state.articles.forEach(function (a) { walkBlockTree(a.blocks || [], callback); });
    ((state.config && state.config.pages) || []).forEach(function (p) { walkBlockTree(p.blocks || [], callback); });
  }

  function renderComponentRail() {
    var host = qs('[data-component-stats]');
    if (!host || !state.config) return;
    var comps = state.config.components || [];
    var withCss = comps.filter(function (c) { return String(c.css || '').trim(); }).length;
    var withJs = comps.filter(function (c) { return String(c.js || '').trim(); }).length;
    var refs = 0;
    forEachDocBlock(function (info) {
      if (info.block.type === 'component') refs += 1;
    });
    host.innerHTML = asideRows([
      { label: '内置区块', value: BLOCK_DEFS.length + ' 种' },
      { label: '自定义组件', value: comps.length + ' 个' },
      { label: '带 CSS 的组件', value: withCss + ' 个' },
      { label: '带 JS 的组件', value: withJs + ' 个' },
      { label: '全站引用次数', value: refs + ' 次' },
      { label: '当前打开的文档', value: state.doc ? ((state.doc.kind === 'page' ? '页面 · ' : '文章 · ') + (currentDocTitle() || '未命名')) : '未打开' }
    ]);
  }

  function currentDocTitle() {
    var doc = currentDoc();
    return doc && (doc.title || '');
  }

  function renderPaletteRail() {
    var info = qs('[data-palette-info]');
    var preview = qs('[data-palette-preview]');
    if (!info && !preview) return;
    var pal = paletteById(state.paletteEditingId) || activePalette();
    if (!pal || !state.config) return;
    var draft = state.paletteDraft && state.paletteDraft.id === pal.id ? state.paletteDraft : pal;
    var mode = themeNow();
    var vars = derivePalette(draft[mode], mode);
    var style = Object.keys(vars).map(function (k) { return k + ':' + vars[k]; }).join(';');
    if (info) {
      info.innerHTML = asideRows([
        { label: '方案名', value: draft.name },
        { label: '使用中', value: draft.id === state.config.theme.activePaletteId ? '是' : '否（编辑中）', kind: draft.id === state.config.theme.activePaletteId ? 'ok' : '' },
        { label: '亮色主题色', value: (draft.light || {}).accent || '—' },
        { label: '暗色主题色', value: (draft.dark || {}).accent || '—' },
        { label: '方案数量', value: (state.config.theme.palettes || []).length + ' 套' }
      ]);
    }
    if (preview) {
      preview.innerHTML = '<div class="lc-palette-demo" style="' + esc(style) +
        ';background:var(--bg);border-color:var(--line);color:var(--ink)">' +
        '<h3 style="color:var(--ink)">示例文章</h3>' +
        '<p style="color:var(--muted)">这块用当前方案实时渲染，导出站看到的就是这套颜色。</p>' +
        '<span class="lc-demo-chip" style="background:var(--accent);color:var(--bg)">主要按钮</span>' +
        '<div class="lc-demo-card" style="background:var(--surface);border-color:var(--line);color:var(--ink)">卡片背景：var(--surface)</div>' +
        '<div class="lc-demo-row">' +
          ['accent', 'bg', 'surface', 'ink', 'muted', 'line'].map(function (key) {
            var colors = draft[mode] || {};
            return '<i class="lc-demo-swatch" style="background:' + esc(colors[key] || '#999') + '" title="' + esc(PALETTE_LABELS[key] || key) + '"></i>';
          }).join('') +
        '</div></div>';
    }
  }

  function renderSettingsRail() {
    var host = qs('[data-settings-stats]');
    if (!host || !state.config) return;
    var latest = (state.builds || [])[0];
    var dirs = state.config.directions || [];
    var pages = state.config.pages || [];
    host.innerHTML = asideRows([
      { label: '文章', value: state.articles.length + ' 篇' },
      { label: '自定义页面', value: pages.length + ' 个' },
      { label: '方向', value: dirs.length + ' 个' },
      { label: '主题', value: (state.config.topics || []).length + ' 个' },
      { label: '系列', value: (state.config.series || []).length + ' 个' },
      { label: '自定义组件', value: (state.config.components || []).length + ' 个' },
      { label: '最近构建', value: latest ? latest.version + ' · ' + fmtDate(latest.createdAt) : '尚未导出', kind: latest ? 'ok' : 'warn' }
    ]);
  }

  function renderBuildRail() {
    var host = qs('[data-build-stats]');
    if (!host) return;
    var builds = state.builds || [];
    var snapBytes = builds.reduce(function (sum, b) { return sum + (b.snapshotBytes || 0); }, 0);
    var zipBytes = builds.reduce(function (sum, b) { return sum + (b.zipBytes || 0); }, 0);
    var latest = builds[0];
    host.innerHTML = asideRows([
      { label: '快照数量', value: builds.length + ' 份' },
      { label: '选中', value: (state.selectedBuilds ? state.selectedBuilds.size : 0) + ' 份' },
      { label: '快照总占用', value: fmtBytes(snapBytes) },
      { label: '导出包总大小', value: fmtBytes(zipBytes) },
      { label: '最近一次', value: latest ? fmtDate(latest.createdAt) : '暂无' },
      { label: '最近版本', value: latest ? latest.version : '暂无' }
    ]);
  }

  function renderExportRail() {
    var host = qs('[data-export-rail]');
    if (!host || !state.config) return;
    var result = validateForExport();
    var imageCount = 0;
    var compCount = 0;
    forEachDocBlock(function (info) {
      if (info.block.type === 'image' && /^data:image\//i.test(String(info.block.src || ''))) imageCount += 1;
      if (info.block.type === 'component') compCount += 1;
    });
    host.innerHTML = asideRows([
      { label: '文章', value: state.articles.length + ' 篇' },
      { label: '自定义页面', value: (state.config.pages || []).length + ' 个' },
      { label: '组件实例', value: compCount + ' 个' },
      { label: '内嵌图片', value: imageCount + ' 张（data URL）' },
      { label: '必须修', value: result.errors.length + ' 项', kind: result.errors.length ? 'danger' : 'ok' },
      { label: '建议修', value: result.warnings.length + ' 项', kind: result.warnings.length ? 'warn' : 'ok' }
    ]);
  }

  /* ---------------- 颜色方案界面 ---------------- */


  function paletteCardHtml(pal) {
    var active = state.config.theme.activePaletteId === pal.id;
    var light = pal.light || {};
    return '<button class="lc-palette-card' + (active ? ' is-active' : '') + '" type="button" data-palette-id="' + esc(pal.id) + '">' +
      '<div class="lc-palette-card-head"><b>' + esc(pal.name) + '</b>' + (active ? '<em>使用中</em>' : '') + '</div>' +
      '<div class="lc-swatches">' +
        '<i class="lc-swatch" style="background:' + esc(light.accent || '#3e6a56') + '"></i>' +
        '<i class="lc-swatch" style="background:' + esc(light.bg || '#f4f0e6') + '"></i>' +
        '<i class="lc-swatch" style="background:' + esc(light.surface || '#fffcf5') + '"></i>' +
        '<i class="lc-swatch" style="background:' + esc(light.ink || '#20242a') + '"></i>' +
        '<i class="lc-swatch" style="background:' + esc(light.line || '#ded6c5') + '"></i>' +
      '</div>' +
      '<small>' + esc(pal.note || '自定义方案') + '</small>' +
    '</button>';
  }

  function renderPaletteList() {
    var host = qs('[data-palette-list]');
    if (!host || !state.config) return;
    var palettes = state.config.theme.palettes;
    host.innerHTML = palettes.map(paletteCardHtml).join('');
    if (!state.paletteEditingId || !palettes.some(function (p) { return p.id === state.paletteEditingId; })) {
      state.paletteEditingId = state.config.theme.activePaletteId;
      state.paletteDraft = null;
    }
    renderPaletteEditor();
  }

  function renderPaletteEditor() {
    var host = qs('[data-palette-editor-body]');
    if (!host) return;
    var pal = paletteById(state.paletteEditingId) || activePalette();
    if (!pal) return;
    if (!state.paletteDraft || state.paletteDraft.id !== pal.id) state.paletteDraft = clone(pal);
    var draft = state.paletteDraft;
    var title = qs('[data-palette-editor-title]');
    if (title) title.textContent = '颜色明细 · ' + draft.name;
    function colorFields(mode) {
      return PALETTE_KEYS.map(function (key) {
        var value = normHex((draft[mode] || {})[key], normHex((pal[mode] || {})[key], '#000000'));
        return '<div class="lc-color-field">' +
          '<span>' + esc(PALETTE_LABELS[key]) + '</span>' +
          '<input type="color" data-palette-mode="' + mode + '" data-palette-key="' + key + '" value="' + esc(value) + '">' +
          '<input class="lc-input" type="text" data-palette-text="' + mode + '" data-palette-key="' + key + '" value="' + esc(value) + '" spellcheck="false">' +
        '</div>';
      }).join('');
    }
    host.innerHTML =
      '<div class="lc-palette-col"><h3>亮色模式</h3>' + colorFields('light') + '</div>' +
      '<div class="lc-palette-col"><h3>暗色模式</h3>' + colorFields('dark') + '</div>';
    renderPaletteRail();
  }

  function updatePaletteDraft(mode, key, value) {
    var draft = state.paletteDraft;
    if (!draft) return;
    var hex = normHex(value, '');
    if (!hex) return;
    draft[mode] = draft[mode] || {};
    draft[mode][key] = hex;
    if (draft.id === state.config.theme.activePaletteId) applyWorkbenchPalette(draft);
    renderPaletteRail();
  }

  function savePalette() {
    var draft = state.paletteDraft;
    if (!draft) return;
    var palettes = state.config.theme.palettes;
    var idx = palettes.findIndex(function (p) { return p.id === draft.id; });
    if (idx === -1) palettes.push(draft);
    else palettes[idx] = draft;
    if (state.paletteEditingId === state.config.theme.activePaletteId) applyWorkbenchPalette(draft);
    return dbPut(STORE_CONFIG, state.config).then(function () {
      state.paletteDraft = null;
      renderPaletteList();
      renderQuickLib();
      renderPreviewSoon();
      var label = qs('[data-palette-state]');
      if (label) label.textContent = '已保存 ' + fmtDate(Date.now()).slice(11);
      toast('颜色方案已保存，导出时会一起带走');
      updateStorageSoon();
    }).catch(function (err) { toast(writeError(err), true); });
  }

  function newPalette() {
    var base = activePalette();
    if (!base) return;
    var copy = clone(base);
    copy.id = uid('pal');
    copy.name = base.name + ' · 副本';
    copy.note = '从「' + base.name + '」复制出来的方案。';
    state.config.theme.palettes.push(copy);
    state.paletteEditingId = copy.id;
    state.paletteDraft = clone(copy);
    renderPaletteList();
    renderPaletteEditor();
    toast('已复制一套方案，改完点保存');
  }

  function deletePalette() {
    var pal = paletteById(state.paletteEditingId);
    if (!pal) return;
    var palettes = state.config.theme.palettes;
    if (palettes.length <= 1) { toast('至少保留一套颜色方案', true); return; }
    confirmDialog({
      title: '删除颜色方案',
      message: '确定删除「' + esc(pal.name) + '」？当前站点会切到第一套方案。已经导出的构建快照不受影响。',
      confirmLabel: '删除',
      onConfirm: function () {
        state.config.theme.palettes = palettes.filter(function (p) { return p.id !== pal.id; });
        if (state.config.theme.activePaletteId === pal.id) {
          state.config.theme.activePaletteId = state.config.theme.palettes[0].id;
        }
        state.paletteEditingId = state.config.theme.activePaletteId;
        state.paletteDraft = null;
        applyWorkbenchPalette();
        return dbPut(STORE_CONFIG, state.config).then(function () {
          renderPaletteList();
          renderPreviewSoon();
          toast('颜色方案已删除');
        });
      }
    });
  }

  function bindPalette() {
    var list = qs('[data-palette-list]');
    if (list) {
      list.addEventListener('click', function (e) {
        var card = e.target.closest('[data-palette-id]');
        if (!card) return;
        var id = card.getAttribute('data-palette-id');
        if (state.paletteDraft && state.paletteDraft.id !== state.config.theme.activePaletteId) {
          state.paletteDraft = null;
        }
        state.config.theme.activePaletteId = id;
        state.paletteEditingId = id;
        state.paletteDraft = null;
        applyWorkbenchPalette();
        renderPaletteList();
        renderPreviewSoon();
        dbPut(STORE_CONFIG, state.config).catch(function (err) { toast(writeError(err), true); });
      });
    }
    var editor = qs('[data-palette-editor-body]');
    if (editor) {
      editor.addEventListener('input', function (e) {
        var key = e.target.getAttribute('data-palette-key');
        var mode = e.target.getAttribute('data-palette-mode') || e.target.getAttribute('data-palette-text');
        if (!key || !mode) return;
        updatePaletteDraft(mode, key, e.target.value);
        var sibling = e.target.parentNode.querySelector(e.target.type === 'color' ? 'input[type="text"]' : 'input[type="color"]');
        if (sibling) sibling.value = e.target.value;
      });
    }
    qsa('[data-save-palette]').forEach(function (btn) { btn.addEventListener('click', savePalette); });
    qsa('[data-delete-palette]').forEach(function (btn) { btn.addEventListener('click', deletePalette); });
    qsa('[data-new-palette]').forEach(function (btn) { btn.addEventListener('click', newPalette); });
  }

  function renderSettings() {
    qsa('[data-site-field]').forEach(function (field) {
      var key = field.getAttribute('data-site-field');
      field.value = state.config[key] == null ? '' : state.config[key];
    });

    var dirs = (state.config.directions || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var dirList = qs('[data-direction-list]');
    dirList.innerHTML = dirs.map(function (d) {
      var topics = topicsFor(d.id);
      var count = state.articles.filter(function (a) { return a.directionId === d.id; }).length;
      return '<li class="lc-manage-row"><b>' + esc(d.name) + '</b><code>' + esc(d.id) + '</code>' +
        '<span class="lc-manage-meta">' + esc(d.intro || '没有写简介') + ' · ' + topics.length + ' 个主题 · ' + count + ' 篇</span>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-edit-direction="' + esc(d.id) + '">编辑</button>' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-delete-direction="' + esc(d.id) + '">删除</button></li>';
    }).join('') || '<li class="lc-manage-row"><span class="lc-manage-meta">还没有方向。</span></li>';

    var topicRows = (state.config.topics || []).slice().sort(function (a, b) {
      var da = (directionById(a.directionId) || {}).order || 0;
      var db = (directionById(b.directionId) || {}).order || 0;
      if (da !== db) return da - db;
      var sa = (seriesById(a.seriesId) || {}).order || 0;
      var sb = (seriesById(b.seriesId) || {}).order || 0;
      if (sa !== sb) return sa - sb;
      return (a.order || 0) - (b.order || 0);
    }).map(function (t) {
      var d = directionById(t.directionId);
      var s = seriesById(t.seriesId);
      var count = state.articles.filter(function (a) { return a.topicId === t.id; }).length;
      return '<li class="lc-manage-row"><b>' + esc(t.name) + '</b><code>' + esc(t.slug) + '</code>' +
        '<span class="lc-manage-meta">' + esc(d ? d.name : '未知方向') + ' · ' + esc(s ? s.name : '未知系列') + ' · ' +
        esc(t.intro || '没有写简介') + ' · ' + count + ' 篇</span>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-edit-topic="' + esc(t.id) + '">编辑</button>' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-delete-topic="' + esc(t.id) + '">删除</button></li>';
    }).join('');
    qs('[data-topic-list]').innerHTML = topicRows || '<li class="lc-manage-row"><span class="lc-manage-meta">还没有主题。</span></li>';

    var addTopicForm = qs('[data-add-topic]');
    addTopicForm.querySelector('[name="directionId"]').innerHTML = dirs.map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
    }).join('');
    addTopicForm.querySelector('[name="seriesId"]').innerHTML = state.config.series.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join('');
    renderSettingsRail();
  }

  function bindSettings() {
    qs('[data-save-site]').addEventListener('click', function () {
      var next = clone(state.config);
      qsa('[data-site-field]').forEach(function (field) {
        next[field.getAttribute('data-site-field')] = field.value.trim();
      });
      if (!next.siteName) { toast('站点名称不能为空', true); return; }
      state.config = next;
      dbPut(STORE_CONFIG, next).then(function () {
        qs('[data-site-save-state]').textContent = '已保存 · ' + fmtDate(Date.now()).slice(11);
        renderSettings();
        renderTree();
        renderExportSummary();
        renderPreviewSoon();
        toast('站点设置已保存');
        updateStorageSoon();
      }).catch(function (err) { toast(writeError(err), true); });
    });

    qs('[data-add-direction]').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var id = String(form.elements.id.value || '').trim().toLowerCase();
      var name = String(form.elements.name.value || '').trim();
      var intro = String(form.elements.intro.value || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) { toast('方向 id 只能用小写字母、数字和连字符', true); return; }
      if (!name) { toast('方向显示名不能为空', true); return; }
      if (directionById(id)) { toast('方向 id 已经存在', true); return; }
      var max = 0;
      state.config.directions.forEach(function (d) { max = Math.max(max, d.order || 0); });
      state.config.directions.push({ id: id, name: name, intro: intro, order: max + 1 });
      dbPut(STORE_CONFIG, state.config).then(function () {
        form.reset();
        renderSettings();
        renderTree();
        renderExportSummary();
        toast('方向「' + name + '」已添加');
        updateStorageSoon();
      }).catch(function (err) { toast(writeError(err), true); });
    });

    qs('[data-add-topic]').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var directionId = form.elements.directionId.value;
      var seriesId = form.elements.seriesId.value;
      var slug = String(form.elements.slug.value || '').trim().toLowerCase();
      var name = String(form.elements.name.value || '').trim();
      var intro = String(form.elements.intro.value || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) { toast('主题 id 只能用小写字母、数字和连字符', true); return; }
      if (!name) { toast('主题显示名不能为空', true); return; }
      if (!directionById(directionId)) { toast('先选一个方向', true); return; }
      var exists = topicsFor(directionId, seriesId).some(function (t) { return t.slug === slug; });
      if (exists) { toast('这个方向 / 系列下已经有同名主题 id', true); return; }
      var max = 0;
      topicsFor(directionId, seriesId).forEach(function (t) { max = Math.max(max, t.order || 0); });
      state.config.topics.push({
        id: uid('t'),
        directionId: directionId,
        seriesId: seriesId,
        slug: slug,
        name: name,
        intro: intro,
        order: max + 1
      });
      dbPut(STORE_CONFIG, state.config).then(function () {
        form.reset();
        renderSettings();
        renderTree();
        renderExportSummary();
        toast('主题「' + name + '」已添加');
        updateStorageSoon();
      }).catch(function (err) { toast(writeError(err), true); });
    });

    qs('[data-direction-list]').addEventListener('click', function (e) {
      var del = e.target.closest('[data-delete-direction]');
      if (del) {
        var d = directionById(del.getAttribute('data-delete-direction'));
        if (!d) return;
        var topics = topicsFor(d.id);
        if (topics.length) {
          toast('这个方向下还有 ' + topics.length + ' 个主题。先把主题删空，或者换个方向整理。', true);
          return;
        }
        confirmDialog({
          title: '删除方向',
          message: '确定删除方向「' + esc(d.name) + '」？它下面没有主题，但删掉后首页和列表页会少一个分区。',
          confirmLabel: '删除方向',
          onConfirm: function () {
            return dbPut(STORE_CONFIG, Object.assign({}, state.config, {
              directions: state.config.directions.filter(function (x) { return x.id !== d.id; })
            })).then(function () {
              state.config.directions = state.config.directions.filter(function (x) { return x.id !== d.id; });
              renderSettings();
              renderTree();
              renderExportSummary();
              toast('方向已删除');
              updateStorageSoon();
            }).catch(function (err) { toast(writeError(err), true); });
          }
        });
        return;
      }
      var edit = e.target.closest('[data-edit-direction]');
      if (edit) editDirection(edit.getAttribute('data-edit-direction'));
    });

    qs('[data-topic-list]').addEventListener('click', function (e) {
      var del = e.target.closest('[data-delete-topic]');
      if (del) {
        var t = topicById(del.getAttribute('data-delete-topic'));
        if (!t) return;
        var count = state.articles.filter(function (a) { return a.topicId === t.id; }).length;
        if (count) {
          toast('这个主题下还有 ' + count + ' 篇文章。先把文章移到别的主题，或者逐篇删除。', true);
          return;
        }
        confirmDialog({
          title: '删除主题',
          message: '确定删除主题「' + esc(t.name) + '」？删除后不能再往这个主题建文章。',
          confirmLabel: '删除主题',
          onConfirm: function () {
            var next = Object.assign({}, state.config, {
              topics: state.config.topics.filter(function (x) { return x.id !== t.id; })
            });
            return dbPut(STORE_CONFIG, next).then(function () {
              state.config = next;
              renderSettings();
              renderTree();
              renderExportSummary();
              toast('主题已删除');
              updateStorageSoon();
            }).catch(function (err) { toast(writeError(err), true); });
          }
        });
        return;
      }
      var edit = e.target.closest('[data-edit-topic]');
      if (edit) editTopic(edit.getAttribute('data-edit-topic'));
    });

    var goContent = qs('[data-go-content-from-settings]');
    if (goContent) goContent.addEventListener('click', function () { switchView('articles'); });
  }

  function editDirection(id) {
    var d = directionById(id);
    if (!d) return;
    showModal({
      title: '编辑方向',
      body: '<label class="lc-field"><span>显示名</span><input class="lc-input" name="name" value="' + esc(d.name) + '"></label>' +
        '<label class="lc-field" style="margin-top:10px"><span>简介</span><textarea class="lc-input" rows="3" name="intro">' + esc(d.intro || '') + '</textarea></label>' +
        '<p class="lc-hint" style="margin-top:8px">方向 id（<code>' + esc(d.id) + '</code>）是网址的一部分，不能改。</p>',
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: '保存',
          kind: 'lc-btn-primary',
          onClick: function (close) {
            var body = qs('[data-modal-body]');
            var name = body.querySelector('[name="name"]').value.trim();
            var intro = body.querySelector('[name="intro"]').value.trim();
            if (!name) { toast('显示名不能为空', true); return; }
            d.name = name;
            d.intro = intro;
            dbPut(STORE_CONFIG, state.config).then(function () {
              close();
              renderSettings();
              renderTree();
              renderExportSummary();
              renderPreviewSoon();
              toast('方向已更新');
            }).catch(function (err) { toast(writeError(err), true); });
          }
        }
      ]
    });
  }

  function editTopic(id) {
    var t = topicById(id);
    if (!t) return;
    showModal({
      title: '编辑主题',
      body: '<label class="lc-field"><span>显示名</span><input class="lc-input" name="name" value="' + esc(t.name) + '"></label>' +
        '<label class="lc-field" style="margin-top:10px"><span>简介</span><textarea class="lc-input" rows="3" name="intro">' + esc(t.intro || '') + '</textarea></label>' +
        '<p class="lc-hint" style="margin-top:8px">主题 id（<code>' + esc(t.slug) + '</code>）会出现在文章网址里，为了不让旧链接失效，这里不提供修改。</p>',
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: '保存',
          kind: 'lc-btn-primary',
          onClick: function (close) {
            var body = qs('[data-modal-body]');
            var name = body.querySelector('[name="name"]').value.trim();
            var intro = body.querySelector('[name="intro"]').value.trim();
            if (!name) { toast('显示名不能为空', true); return; }
            t.name = name;
            t.intro = intro;
            dbPut(STORE_CONFIG, state.config).then(function () {
              close();
              renderSettings();
              renderTree();
              renderExportSummary();
              renderPreviewSoon();
              toast('主题已更新');
            }).catch(function (err) { toast(writeError(err), true); });
          }
        }
      ]
    });
  }

  function openTopicModal(directionId, seriesId) {
    var d = directionById(directionId);
    if (!d) return;
    showModal({
      title: '给「' + d.name + '」加主题',
      body: '<label class="lc-field"><span>系列</span><select class="lc-input" name="seriesId">' +
        state.config.series.map(function (s) {
          return '<option value="' + esc(s.id) + '"' + (s.id === seriesId ? ' selected' : '') + '>' + esc(s.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="lc-field" style="margin-top:10px"><span>主题 id（英文短名）</span><input class="lc-input" name="slug" placeholder="browser" spellcheck="false"></label>' +
        '<label class="lc-field" style="margin-top:10px"><span>显示名</span><input class="lc-input" name="name" placeholder="浏览器与原理"></label>' +
        '<label class="lc-field" style="margin-top:10px"><span>简介</span><textarea class="lc-input" rows="2" name="intro" placeholder="按下回车之后到底发生了什么。"></textarea></label>',
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: '添加',
          kind: 'lc-btn-primary',
          onClick: function (close) {
            var body = qs('[data-modal-body]');
            var sId = body.querySelector('[name="seriesId"]').value;
            var slug = body.querySelector('[name="slug"]').value.trim().toLowerCase();
            var name = body.querySelector('[name="name"]').value.trim();
            var intro = body.querySelector('[name="intro"]').value.trim();
            if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) { toast('主题 id 只能用小写字母、数字和连字符', true); return; }
            if (!name) { toast('显示名不能为空', true); return; }
            if (topicsFor(d.id, sId).some(function (t) { return t.slug === slug; })) { toast('这个系列下已经有同名主题 id', true); return; }
            var max = 0;
            topicsFor(d.id, sId).forEach(function (t) { max = Math.max(max, t.order || 0); });
            state.config.topics.push({ id: uid('t'), directionId: d.id, seriesId: sId, slug: slug, name: name, intro: intro, order: max + 1 });
            dbPut(STORE_CONFIG, state.config).then(function () {
              close();
              renderSettings();
              renderTree();
              renderExportSummary();
              toast('主题「' + name + '」已添加');
              updateStorageSoon();
            }).catch(function (err) { toast(writeError(err), true); });
          }
        }
      ]
    });
  }

  /* ---------------- 构建记录与存储用量 ---------------- */
  function updateStorage() {
    var supported = !!(navigator.storage && navigator.storage.estimate);
    var task = supported ? navigator.storage.estimate().catch(function () { return null; }) : Promise.resolve(null);
    task.then(function (est) {
      var usage = est && typeof est.usage === 'number' ? est.usage : null;
      var quota = est && typeof est.quota === 'number' && est.quota > 0 ? est.quota : null;
      state.storage = { usage: usage, quota: quota, supported: supported };
      renderStorage();
    });
  }

  function renderStorage() {
    var data = state.storage || {};
    var usage = data.usage;
    var quota = data.quota;
    var ratio = quota && usage != null ? Math.min(1, usage / quota) : 0;
    var usedText = usage == null ? '—' : fmtBytes(usage);
    var remainingText = quota && usage != null ? fmtBytes(Math.max(0, quota - usage)) : '—';
    var quotaText = quota ? fmtBytes(quota) : '浏览器未给出';

    var chip = qs('[data-storage-chip]');
    var chipValue = qs('[data-storage-value]');
    var chipBar = qs('[data-storage-bar]');
    if (chipValue) chipValue.textContent = usage == null ? '读不到' : usedText + ' / ' + (quota ? quotaText : '配额未知');
    if (chipBar) chipBar.style.width = (ratio * 100).toFixed(1) + '%';
    if (chip) {
      chip.classList.toggle('is-warn', ratio >= 0.75 && ratio < 0.9);
      chip.classList.toggle('is-danger', ratio >= 0.9);
    }

    var usedEl = qs('[data-storage-used]');
    var remainEl = qs('[data-storage-remaining]');
    var quotaEl = qs('[data-storage-quota]');
    if (usedEl) usedEl.textContent = usedText;
    if (remainEl) remainEl.textContent = remainingText;
    if (quotaEl) quotaEl.textContent = quotaText;

    var track = qs('[data-storage-track]');
    if (track) track.style.width = (ratio * 100).toFixed(1) + '%';
    var panel = qs('.lc-storage-panel');
    if (panel) {
      panel.classList.toggle('is-warn', ratio >= 0.75 && ratio < 0.9);
      panel.classList.toggle('is-danger', ratio >= 0.9);
    }

    var detail = qs('[data-storage-detail]');
    if (detail) {
      if (!data.supported) {
        detail.textContent = '这个浏览器不支持 navigator.storage.estimate()，给不出已用空间和配额。下面的已用 / 剩余只能显示占位。';
      } else if (usage == null) {
        detail.textContent = '浏览器没有给出已用空间数据。部分浏览器的无痕模式或隐私设置会屏蔽这类查询，下面的数字只能当作估算。';
      } else if (!quota) {
        detail.textContent = '已用约 ' + usedText + '。浏览器没有给出确切配额，所以这是估算值，不是硬上限。';
      } else {
        var msg = '已用 ' + usedText + '，剩余 ' + remainingText + '，浏览器给这个站点的配额是 ' + quotaText + '。这是整个站点的估算值，包含本机学习记录、主题偏好等其他数据，不只是文章。';
        if (ratio >= 0.9) msg += ' 已经接近上限，建议马上删掉旧构建版本并导出备份。';
        else if (ratio >= 0.75) msg += ' 占用已经偏高，建议清理不再需要的旧版本。';
        else msg += ' 空间充足。';
        msg += ' 浏览器回收删除后的空间可能有延迟，数字不一定马上下降。';
        detail.textContent = msg;
      }
    }

    var footer = qs('[data-footer-storage]');
    if (footer) footer.textContent = usage == null ? '本机占用：浏览器未提供' : '本机占用：' + usedText + (quota ? ' / 剩余 ' + remainingText : '（估算）');
  }

  function renderBuilds() {
    var list = qs('[data-build-list]');
    var empty = qs('[data-build-empty]');
    if (!list) return;
    var ids = {};
    state.builds.forEach(function (b) { ids[b.id] = true; });
    Array.from(state.selectedBuilds).forEach(function (id) {
      if (!ids[id]) state.selectedBuilds.delete(id);
    });
    if (!state.builds.length) {
      list.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      list.innerHTML = state.builds.map(function (b) {
        return '<article class="lc-build" data-build-row="' + b.id + '">\n' +
          '  <input type="checkbox" data-build-check="' + b.id + '"' + (state.selectedBuilds.has(b.id) ? ' checked' : '') + ' aria-label="选择版本 ' + esc(b.version) + '">\n' +
          '  <div class="lc-build-main">\n' +
          '    <div class="lc-build-title"><b>' + esc(b.version) + '</b><span>' + esc(fmtDate(b.createdAt)) + '</span></div>\n' +
          '    <div class="lc-build-stats"><span>' + b.articleCount + ' 篇文章</span><span>快照 ' + fmtBytes(b.snapshotBytes) + '</span>' +
          '<span>导出包 ' + fmtBytes(b.zipBytes) + '</span>' +
          (b.mermaidBytes ? '<span>Mermaid ' + fmtBytes(b.mermaidBytes) + '</span>' : '') +
          '<span>' + esc(b.note || '导出') + '</span></div>\n' +
          '  </div>\n' +
          '  <div class="lc-build-actions"><button class="lc-btn lc-btn-sm" type="button" data-build-detail="' + b.id + '">详情</button>' +
          '<button class="lc-btn lc-btn-sm" type="button" data-build-rollback="' + b.id + '">回滚</button>' +
          '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-build-delete="' + b.id + '">删除</button></div>\n' +
          '</article>';
      }).join('');
    }
    var batch = qs('[data-delete-selected]');
    if (batch) {
      batch.disabled = state.selectedBuilds.size === 0;
      batch.textContent = '删除选中（' + state.selectedBuilds.size + '）';
    }
    var allBtn = qs('[data-select-all-builds]');
    if (allBtn) allBtn.textContent = state.builds.length && state.selectedBuilds.size === state.builds.length ? '取消全选' : '全选';
    renderBuildRail();
  }

  function bindBuilds() {
    qs('[data-build-list]').addEventListener('change', function (e) {
      var box = e.target.closest('[data-build-check]');
      if (!box) return;
      var id = Number(box.getAttribute('data-build-check'));
      if (box.checked) state.selectedBuilds.add(id);
      else state.selectedBuilds.delete(id);
      renderBuilds();
    });

    qs('[data-build-list]').addEventListener('click', function (e) {
      var detail = e.target.closest('[data-build-detail]');
      if (detail) { openBuildDetail(Number(detail.getAttribute('data-build-detail'))); return; }
      var rollback = e.target.closest('[data-build-rollback]');
      if (rollback) { rollbackBuild(Number(rollback.getAttribute('data-build-rollback'))); return; }
      var del = e.target.closest('[data-build-delete]');
      if (del) { deleteBuilds([Number(del.getAttribute('data-build-delete'))]); }
    });

    qs('[data-select-all-builds]').addEventListener('click', function () {
      if (state.selectedBuilds.size === state.builds.length) state.selectedBuilds.clear();
      else state.builds.forEach(function (b) { state.selectedBuilds.add(b.id); });
      renderBuilds();
    });

    qs('[data-delete-selected]').addEventListener('click', function () {
      if (!state.selectedBuilds.size) return;
      deleteBuilds(Array.from(state.selectedBuilds));
    });

    var goExport = qs('[data-go-export-from-builds]');
    if (goExport) goExport.addEventListener('click', function () { switchView('export'); });
  }

  function buildById(id) {
    return state.builds.filter(function (b) { return b.id === id; })[0] || null;
  }

  function openBuildDetail(id) {
    var b = buildById(id);
    if (!b) return;
    var articles = (b.snapshot && b.snapshot.articles) || [];
    var rows = articles.slice().sort(articleOrder).map(function (a) {
      var path = '';
      if (b.snapshot && b.snapshot.config) {
        var snapshotConfig = b.snapshot.config;
        var d = (snapshotConfig.directions || []).filter(function (x) { return x.id === a.directionId; })[0];
        var s = (snapshotConfig.series || []).filter(function (x) { return x.id === a.seriesId; })[0];
        var t = (snapshotConfig.topics || []).filter(function (x) { return x.id === a.topicId; })[0];
        if (d && s && t) path = 'articles/' + d.id + '/' + s.id + '/' + t.slug + '/' + a.slug + '.html';
      }
      return '<li><span>' + esc(a.title) + '</span><em>' + esc(a.difficulty || '') + ' · ' + esc(path || a.slug) + '</em></li>';
    }).join('');
    showModal({
      title: '版本 ' + b.version + ' 的快照',
      body: '<p>生成时间：' + esc(fmtDate(b.createdAt)) + '</p>' +
        '<p>文章 <b>' + b.articleCount + '</b> 篇；快照 <b>' + fmtBytes(b.snapshotBytes) + '</b>；当时导出的 zip <b>' + fmtBytes(b.zipBytes) + '</b>。</p>' +
        ((b.assets && b.assets.length)
          ? '<p>额外运行时：' + b.assets.map(function (item) { return esc(item.package + '（' + fmtBytes(item.bytes) + '）'); }).join('、') + '。</p>'
          : '') +
        '<p class="lc-hint">回滚会用这份快照覆盖当前的站点配置和文章。回滚前如果当前有改完没导出的内容，先导出一个版本留底。</p>' +
        '<div class="lc-build-detail-list">' + (rows || '<li><span>这份快照里没有文章。</span></li>') + '</div>',
      actions: [
        { label: '关闭', onClick: function (close) { close(); } },
        {
          label: '回滚到 ' + b.version,
          kind: 'lc-btn-primary',
          onClick: function (close) { close(); rollbackBuild(b.id); }
        }
      ]
    });
  }

  function rollbackBuild(id) {
    var b = buildById(id);
    if (!b || !b.snapshot) { toast('这个版本的快照不完整，回滚不了', true); return; }
    confirmDialog({
      title: '回滚到 ' + b.version,
      message: '当前站点的配置和文章会被这份快照覆盖，未导出的改动会消失。构建记录本身不会删。确定继续？',
      confirmLabel: '回滚',
      danger: false,
      onConfirm: function () {
        return dbClear(STORE_ARTICLES).then(function () {
          return dbPut(STORE_CONFIG, b.snapshot.config);
        }).then(function () {
          var pairs = b.snapshot.articles.map(function (a) { return dbPut(STORE_ARTICLES, a); });
          return Promise.all(pairs);
        }).then(function () {
          state.config = clone(b.snapshot.config);
          state.articles = clone(b.snapshot.articles);
          state.currentId = null;
          state.dirty = false;
          resetEditor();
          renderTree();
          renderSettings();
          renderBuilds();
          renderExportSummary();
          updateStorageSoon();
          toast('已回滚到 ' + b.version + '，共 ' + b.articleCount + ' 篇文章');
        }).catch(function (err) {
          toast(writeError(err), true);
        });
      }
    });
  }

  function deleteBuilds(ids) {
    if (!ids.length) return;
    var only = ids.length === 1 ? buildById(ids[0]) : null;
    confirmDialog({
      title: only ? '删除版本 ' + only.version : '删除 ' + ids.length + ' 个版本',
      message: only
        ? '版本 <b>' + esc(only.version) + '</b> 的完整快照会被彻底移除，之后不能再回滚到它。已经下载到别处的 zip 文件不受影响。这个动作不能撤销。'
        : '选中的 <b>' + ids.length + '</b> 个版本的完整快照会被彻底移除，之后不能再回滚到它们。已经下载到别处的 zip 文件不受影响。这个动作不能撤销。',
      confirmLabel: '彻底删除',
      onConfirm: function () {
        var chain = Promise.resolve();
        ids.forEach(function (id) {
          chain = chain.then(function () {
            return dbDelete(STORE_BUILDS, id);
          });
        });
        return chain.then(function () {
          state.builds = state.builds.filter(function (b) { return ids.indexOf(b.id) === -1; });
          ids.forEach(function (id) { state.selectedBuilds.delete(id); });
          renderBuilds();
          renderExportSummary();
          updateStorageSoon();
          toast('已删除 ' + ids.length + ' 个版本，快照已彻底移除');
        }).catch(function (err) {
          toast(writeError(err), true);
        });
      }
    });
  }

  /* ---------------- 导出 ---------------- */

  function renderExportSummary() {
    var catalog = buildCatalog();
    var dirs = buildDirections(catalog).filter(function (d) { return d.count > 0; });
    var topicCount = state.config.topics.filter(function (t) {
      return state.articles.some(function (a) { return a.topicId === t.id; });
    }).length;
    var snap = snapshotForExport();
    var summary = qs('[data-export-summary]');
    if (summary) {
      summary.innerHTML = '<span>' + catalog.length + ' 篇文章</span><span>' + dirs.length + ' 个方向</span>' +
        '<span>' + topicCount + ' 个主题</span><span>' + state.config.series.length + ' 个系列</span>' +
        '<span>' + pagesSorted().length + ' 个自定义页面</span>' +
        '<span>数据快照约 ' + fmtBytes(byteSize(snap)) + '</span>';
    }
    var input = qs('[data-export-version]');
    if (input && !input.value) input.value = nextVersion();
    renderExportRail();
  }

  function byteSize(value) {
    try { return new Blob([JSON.stringify(value)]).size; } catch (err) { return 0; }
  }

  function snapshotForExport() {
    return { config: clone(state.config), articles: clone(state.articles) };
  }

  function validateForExport() {
    var errors = [];
    var warnings = [];
    var slugMap = {};

    state.articles.forEach(function (a) {
      var name = a.title || '（无标题文章）';
      if (!a.title) errors.push('文章缺标题：' + a.id);
      if (!a.slug) errors.push('《' + name + '》缺 slug');
      if (a.slug && !/^[a-z0-9][a-z0-9-_]*$/.test(a.slug)) {
        errors.push('《' + name + '》的 slug「' + a.slug + '」只能用小写字母、数字、横线和下划线');
      }
      if (!pathFor(a)) errors.push('《' + name + '》的方向、系列或主题缺失，生成不了路径');
      if (!a.summary) warnings.push('《' + name + '》还没有简介，列表卡片会空一块');
      if (!articleBodyHtml(a).trim()) warnings.push('《' + name + '》正文是空的');
      if (a.slug) {
        if (slugMap[a.slug]) errors.push('slug 重复：' + a.slug + '（《' + name + '》和《' + slugMap[a.slug] + '》）');
        else slugMap[a.slug] = name;
      }
    });

    var pathMap = {};
    state.articles.forEach(function (a) {
      var path = pathFor(a);
      if (!path) return;
      if (pathMap[path]) errors.push('文章路径重复：' + path + '（《' + a.title + '》和《' + pathMap[path] + '》）');
      else pathMap[path] = a.title || '未命名';
    });

    ((state.config && state.config.pages) || []).forEach(function (page) {
      var path = pagePath(page);
      var name = page.title || '（无标题页面）';
      if (!page.title) errors.push('自定义页面缺标题：' + page.id);
      if (!path) errors.push('《' + name + '》缺导出路径');
      if (path && !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.html$/.test(path)) {
        errors.push('《' + name + '》的导出路径「' + path + '」要相对站点根目录、以 .html 结尾，且不能包含 ..');
      }
      if (pathMap[path]) errors.push('页面路径重复：' + path + '（《' + name + '》和《' + pathMap[path] + '》）');
      else if (path && path.split('/').every(function (seg) { return seg !== '..'; })) pathMap[path] = name;
      if (!navPages().some(function (p) { return p.id === page.id; })) warnings.push('《' + name + '》没有放进导航，只能直接输地址访问');
    });

    return { errors: errors, warnings: warnings };
  }

  function renderExportChecks() {
    var box = qs('[data-export-checks]');
    if (!box) return { errors: [], warnings: [] };
    var result = validateForExport();
    if (!result.errors.length && !result.warnings.length) {
      box.hidden = true;
      box.innerHTML = '';
      return result;
    }
    box.hidden = false;
    box.innerHTML = '<h3>导出前检查</h3><ul>' +
      result.errors.map(function (msg) { return '<li class="is-error">必须修：' + esc(msg) + '</li>'; }).join('') +
      result.warnings.map(function (msg) { return '<li class="is-warn">建议：' + esc(msg) + '</li>'; }).join('') +
      '</ul>';
    renderExportRail();
    return result;
  }

  function setExportError(message) {
    var box = qs('[data-export-error]');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
  }

  function setExportState(text, isError) {
    var el = qs('[data-export-state]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--danger)' : '';
  }

  var ZIP_SOURCES = [
    { name: '本地 vendor', url: 'vendor/jszip.min.js' }
  ];

  function zipSourceUrl(source) {
    if (/^https?:/i.test(source.url)) return source.url;
    return new URL(source.url, location.href).href;
  }

  function checkZipAvailability() {
    if (window.JSZip) {
      setExportError('');
      return true;
    }
    var tried = (state.zipErrors || []).map(function (err) { return err.name + '：' + err.message; });
    setExportError('压缩库 JSZip 没有加载，导出无法开始。' +
      (tried.length ? '\n已尝试：\n· ' + tried.join('\n· ') : '\n还没开始加载。') +
      '\n\n排查办法：确认 lowcode/vendor/jszip.min.js 存在（可用 npm run vendor:sync 从本地依赖同步），刷新页面后重试。' +
      '压缩库不到位时不会假装导出成功。');
    return false;
  }

  function loadScriptWithTimeout(src, timeout) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var done = false;
      var timer = window.setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('超过 ' + Math.round(timeout / 1000) + ' 秒没有响应'));
      }, timeout);
      script.src = src;
      script.async = true;
      script.onload = function () {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve();
      };
      script.onerror = function () {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        reject(new Error('加载失败'));
      };
      document.head.appendChild(script);
    });
  }

  function ensureZipLib() {
    if (window.JSZip) return Promise.resolve(true);
    if (state.zipLoading) return state.zipLoading;
    state.zipErrors = [];
    var chain = Promise.resolve(false);
    ZIP_SOURCES.forEach(function (source) {
      chain = chain.then(function (ok) {
        if (ok) return true;
        var url = zipSourceUrl(source);
        setExportState('正在加载压缩库（' + source.name + '）…');
        return loadScriptWithTimeout(url, 9000).then(function () {
          if (window.JSZip) {
            state.zipErrors.push({ name: source.name, message: '已加载' });
            return true;
          }
          throw new Error('脚本加载完成但没有暴露 JSZip');
        }).catch(function (err) {
          state.zipErrors.push({ name: source.name, message: (err && err.message) || '未知错误' });
          return false;
        });
      });
    });
    state.zipLoading = chain.then(function (ok) {
      state.zipLoading = null;
      if (!ok) setExportState('压缩库不可用，导出没有开始。', true);
      return ok;
    });
    return state.zipLoading;
  }

  function fetchVendor(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('读取 ' + path + ' 失败（HTTP ' + res.status + '）');
      return res.text();
    });
  }

  function verifyBundle(bundle) {
    var files = bundle.files;
    var required = ['index.html', 'articles/index.html', 'learning.html', 'search.html', 'notice.html', '404.html',
      'sitemap.xml', 'robots.txt', 'assets/css/site.css', 'assets/css/theme.css', 'assets/js/site.js', 'assets/favicon.svg',
      'data/articles.js', 'data/directions.js', 'data/routes.js', 'data/search-index.js', 'manifest.json']
      .concat((bundle.assets || []).map(function (item) { return item.path; }));
    var missing = required.filter(function (path) { return !files[path]; });
    var articlePaths = bundle.articles.map(pathFor);
    var pagePaths = (bundle.pages || []).map(pagePath);
    var missingArticles = articlePaths.filter(function (path) { return !files[path]; });
    var missingPages = pagePaths.filter(function (path) { return !files[path]; });
    return {
      ok: missing.length === 0 && missingArticles.length === 0 && missingPages.length === 0,
      fileCount: Object.keys(files).length,
      missing: missing.concat(missingArticles, missingPages)
    };
  }

  function bindExport() {
    qs('[data-export-run]').addEventListener('click', runExport);
    qs('[data-export-refresh]').addEventListener('click', function () {
      renderExportSummary();
      renderExportChecks();
      updateStorage();
      toast('统计已刷新');
    });
    qs('[data-export-version]').addEventListener('blur', function (e) {
      if (!e.target.value.trim()) e.target.value = nextVersion();
    });
  }

  function runExport() {
    if (state.exporting) return;
    state.exporting = true;
    setExportError('');
    setExportState('准备导出…');
    var versionInput = qs('[data-export-version]');
    var version = (versionInput.value || nextVersion()).trim() || nextVersion();

    Promise.resolve(flushSave(true)).then(function (ok) {
      if (!ok) {
        setExportState('正文或元数据还有错误，先修好再导出。', true);
        state.exporting = false;
        return null;
      }
      var checks = renderExportChecks();
      if (checks.errors.length) {
        setExportError('导出前校验没通过，共 ' + checks.errors.length + ' 个必须修的问题。看下方清单，修完再点导出。');
        setExportState('校验没通过，没有生成 zip。', true);
        state.exporting = false;
        return null;
      }
      return ensureZipLib();
    }).then(function (hasZip) {
      if (hasZip === null) return null;
      if (!hasZip) {
        checkZipAvailability();
        setExportState('压缩库不可用，导出没有开始。', true);
        state.exporting = false;
        return null;
      }
      var bundle = buildExportFiles();
      try {
        var manifest = JSON.parse(bundle.files['manifest.json']);
        manifest.version = version;
        bundle.files['manifest.json'] = JSON.stringify(manifest, null, 2);
      } catch (err) { /* 清单生成失败会在 verifyBundle 里拦下 */ }
      setExportState('正在读取样式和脚本…');
      var assetTool = window.LC && window.LC.ExportAssets;
      if (!assetTool) throw new Error('导出资源模块未加载：shared/export-assets.js');
      var conditional = assetTool.selectConditionalAssets(conditionalAssetTable(), bundle.files);
      return Promise.all([
        fetchVendor('vendor/site.css'),
        fetchVendor('vendor/site.js'),
        fetchVendor('vendor/favicon.svg')
      ].concat(conditional.map(function (item) { return fetchVendor(item.source); }))).then(function (assets) {
        bundle.files['assets/css/site.css'] = assets[0];
        bundle.files['assets/js/site.js'] = assets[1];
        bundle.files['assets/favicon.svg'] = assets[2];
        var sources = {};
        conditional.forEach(function (item, index) { sources[item.source] = assets[3 + index]; });
        var applied = assetTool.applyConditionalAssets({
          files: bundle.files,
          siteDir: '',
          table: conditional,
          conditionalSources: sources
        });
        var bundled = applied.bundled;
        bundle.assets = bundled;
        if (bundled.length) {
          try {
            var manifest = JSON.parse(bundle.files['manifest.json']);
            manifest.bundledAssets = bundled;
            bundle.files['manifest.json'] = JSON.stringify(manifest, null, 2);
          } catch (err) { /* 清单异常由 verifyBundle 拦下 */ }
        }
        return bundle;
      });
    }).then(function (bundle) {
      if (!bundle) return null;
      var check = verifyBundle(bundle);
      if (!check.ok) {
        setExportError('导出文件结构检查没通过：缺少 ' + check.missing.join('、') + '。导出已中止。');
        setExportState('结构检查失败，没有生成 zip。', true);
        state.exporting = false;
        return null;
      }
      var minifyTool = window.LC && window.LC.ExportMinify;
      if (!minifyTool) throw new Error('导出压缩模块未加载：shared/export-minify.js');
      var minifyToggle = qs('[data-export-minify]');
      var htmlToggle = qs('[data-export-minify-html]');
      var siteName = String(state.config.siteName || '低代码文档站');
      var minified = minifyTool.applyMinify({
        files: bundle.files,
        siteDir: '',
        enabled: minifyToggle ? minifyToggle.checked : true,
        html: htmlToggle ? htmlToggle.checked : false,
        artifactId: siteName,
        createdAt: new Date().toISOString(),
        version: version,
        title: siteName,
        skipPaths: (bundle.assets || []).map(function (item) { return item.path; })
      });
      bundle.files = minified.files;
      bundle.minify = minified.report;
      bundle.minifyWarnings = minified.warnings;
      setExportState(minified.report.enabled
        ? '正在压缩 ' + check.fileCount + ' 个文件（节省 ' + fmtBytes(Math.max(0, minified.report.saved)) + '）…'
        : '正在打包 ' + check.fileCount + ' 个文件（未压缩）…');
      var zip = new window.JSZip();
      Object.keys(bundle.files).forEach(function (path) {
        if (/\.(svg|txt|xml)$/i.test(path) || /\.html?$/i.test(path) || /\.(js|css)$/i.test(path)) {
          zip.file(path, bundle.files[path]);
        } else {
          zip.file(path, bundle.files[path]);
        }
      });
      return zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, function (meta) {
        setExportState('正在压缩 ' + Math.round(meta.percent) + '%…');
      }).then(function (blob) {
        return { blob: blob, bundle: bundle, check: check };
      });
    }).then(function (result) {
      if (!result) return null;
      var snapshot = snapshotForExport();
      var bundledAssets = result.bundle.assets || [];
      var assetBytes = bundledAssets.reduce(function (sum, item) { return sum + item.bytes; }, 0);
      var mermaidBytes = bundledAssets.filter(function (item) {
        return item.package.split('@')[0] === 'mermaid';
      }).reduce(function (sum, item) { return sum + item.bytes; }, 0);
      var record = {
        version: version,
        createdAt: Date.now(),
        articleCount: result.bundle.catalog.length,
        snapshotBytes: byteSize(snapshot),
        zipBytes: result.blob.size,
        assetBytes: assetBytes,
        mermaidBytes: mermaidBytes,
        assets: bundledAssets,
        minify: result.bundle.minify || null,
        minifyWarnings: result.bundle.minifyWarnings || [],
        note: '导出',
        snapshot: snapshot
      };
      var heavy = assetBytes > EXPORT_WARN_BYTES;
      return dbAdd(STORE_BUILDS, record).then(function (id) {
        record.id = id;
        state.builds.unshift(record);
        renderBuilds();
        renderExportSummary();
        updateStorageSoon();
        versionInput.value = nextVersion();
        return downloadBlob(result.blob, result.bundle, version).then(function () {
          var minifyInfo = result.bundle.minify || {};
          setExportState('完成：' + result.check.fileCount + ' 个文件，' +
            result.bundle.catalog.length + ' 篇文章，zip ' + fmtBytes(result.blob.size) +
            (mermaidBytes > 0 ? '（其中图表库 ' + fmtBytes(mermaidBytes) + '）' : '') +
            (minifyInfo.enabled ? '（CSS/JS 压缩节省 ' + fmtBytes(Math.max(0, minifyInfo.saved)) + '）' : '（未压缩）') +
            (heavy ? '（第三方运行时 ' + fmtBytes(assetBytes) + '，超过 ' + fmtBytes(EXPORT_WARN_BYTES) + ' 提示线）' : '') +
            '。构建记录已保存。');
          toast(heavy
            ? '已导出 ' + version + '，但第三方运行时体积偏大（' + fmtBytes(assetBytes) + '），已记入构建记录'
            : '已导出 ' + version + '，并生成了构建记录', heavy);
        });
      }).catch(function (err) {
        // 快照写不进去（多半是配额）时，zip 还是要给用户，避免白忙一场
        updateStorageSoon();
        return downloadBlob(result.blob, result.bundle, version).then(function () {
          var message = writeError(err) + ' 这次 zip 已经下载，但没有留下构建记录。';
          setExportError(message);
          setExportState('zip 已下载，构建记录没有保存。', true);
          toast('zip 已下载，但构建记录没有保存：' + (err && err.message ? err.message : '存储写入失败'), true);
        });
      }).finally(function () {
        state.exporting = false;
      });
    }).catch(function (err) {
      console.error(err);
      setExportError('导出失败：' + (err && err.message ? err.message : '未知错误') +
        '。如果是读取 vendor 文件失败，请确认低代码建站器是通过静态服务打开的，而不是直接双击 index.html。');
      setExportState('导出失败，没有生成 zip。', true);
      state.exporting = false;
    });
  }

  function downloadBlob(blob, bundle, version) {
    var safeName = String(state.config.siteName || 'site').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'site';
    var safeVersion = String(version || 'v1').replace(/[\\/:*?"<>|\s]+/g, '-');
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = safeName + '-' + safeVersion + '.zip';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1500);
    return Promise.resolve();
  }

  /* ---------------- 从压缩包导入 ---------------- */

  function setImportError(message) {
    var box = qs('[data-import-error]');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
  }

  function setImportState(text, isError) {
    var el = qs('[data-import-state]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--danger)' : '';
  }

  function setImportPending(result) {
    state.importPending = result;
    ['[data-import-replace]', '[data-import-new]'].forEach(function (sel) {
      var btn = qs(sel);
      if (btn) btn.disabled = !result;
    });
  }

  function readFileBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function parseImportZip(zip, name) {
    var manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      return Promise.reject(new Error('这个压缩包里没有 manifest.json。只能导入由本建站器导出的 zip；缺清单文件时无法判断文章、页面和路由，现有数据不会被改动。'));
    }
    return manifestFile.async('string').then(function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('manifest.json 不是合法 JSON，文件可能已损坏。现有数据没有改动。');
      }
      if (!data || data.format !== 'lowcode-site') {
        throw new Error('manifest.json 不是低代码建站器的站点清单（缺少 format: lowcode-site）。现有数据没有改动。');
      }
      if (!data.config || typeof data.config !== 'object') {
        throw new Error('清单里缺少站点配置 config。现有数据没有被改动。');
      }
      if (!Array.isArray(data.articles)) {
        throw new Error('清单里缺少文章数组 articles。现有数据没有被改动。');
      }
      var seen = {};
      data.articles.forEach(function (article, index) {
        if (!article || typeof article !== 'object') {
          throw new Error('第 ' + (index + 1) + ' 篇文章数据不是对象，清单已损坏。');
        }
        if (!article.id) throw new Error('第 ' + (index + 1) + ' 篇文章缺少 id，清单已损坏。');
        if (seen[article.id]) throw new Error('文章 id 重复（' + article.id + '），清单已损坏。');
        seen[article.id] = true;
      });
      var config = clone(data.config);
      config.key = CONFIG_KEY;
      if (!Array.isArray(config.pages)) config.pages = Array.isArray(data.pages) ? clone(data.pages) : [];
      var articles = clone(data.articles);
      var fileCount = Object.keys(zip.files || {}).filter(function (path) { return !/\/$/.test(path); }).length;
      return {
        fileName: name,
        version: data.version || '未标注',
        exportedAt: data.exportedAt || '',
        siteName: data.siteName || config.siteName || '未命名站点',
        articleCount: articles.length,
        pageCount: config.pages.length,
        fileCount: fileCount,
        config: config,
        articles: articles
      };
    });
  }

  function renderImportPreview(result) {
    var box = qs('[data-import-preview]');
    if (!box) return;
    var when = result.exportedAt ? new Date(result.exportedAt) : null;
    var timeText = when && !isNaN(when.getTime()) ? fmtDate(when.getTime()) : '未标注';
    box.hidden = false;
    box.innerHTML =
      '<span>站点：' + esc(result.siteName) + '</span>' +
      '<span>版本：' + esc(result.version) + '</span>' +
      '<span>' + result.articleCount + ' 篇文章</span>' +
      '<span>' + result.pageCount + ' 个自定义页面</span>' +
      '<span>' + result.fileCount + ' 个文件</span>' +
      '<span>导出时间：' + esc(timeText) + '</span>';
  }

  function handleImportFile(file) {
    if (!file) return;
    setImportPending(null);
    setImportError('');
    var preview = qs('[data-import-preview]');
    if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    setImportState('正在读取 ' + file.name + '…');
    ensureZipLib().then(function (ok) {
      if (!ok) {
        setImportError('压缩库 JSZip 三个来源都没能加载，导入无法开始。请检查网络，或把 jszip.min.js 放到 lowcode/vendor/jszip.min.js 后刷新重试。');
        setImportState('导入没有开始', true);
        return null;
      }
      return readFileBuffer(file);
    }).then(function (buffer) {
      if (!buffer) return null;
      return window.JSZip.loadAsync(buffer);
    }).then(function (zip) {
      if (!zip) return null;
      return parseImportZip(zip, file.name);
    }).then(function (result) {
      if (!result) return;
      renderImportPreview(result);
      setImportPending(result);
      setImportState('已解析，确认后才会写入数据库。');
    }).catch(function (err) {
      console.warn(err);
      setImportPending(null);
      setImportError((err && err.message) || '解析压缩包失败');
      setImportState('导入没有开始，现有数据没有改动。', true);
    });
  }

  function replaceSiteData(config, articles) {
    return new Promise(function (resolve, reject) {
      var tx = state.db.transaction([STORE_CONFIG, STORE_ARTICLES], 'readwrite');
      tx.objectStore(STORE_CONFIG).put(config);
      var store = tx.objectStore(STORE_ARTICLES);
      store.clear();
      articles.forEach(function (article) { store.put(article); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('写入数据库失败')); };
      tx.onabort = function () { reject(tx.error || new Error('写入被中止，现有数据没有改动')); };
    });
  }

  function applyImport(mode) {
    var pending = state.importPending;
    if (!pending || state.importing) return Promise.resolve(false);
    state.importing = true;
    setImportError('');
    setImportState(mode === 'new' ? '正在备份当前站点，然后写入…' : '正在写入导入数据…');

    return Promise.resolve(flushSave(true)).then(function (ok) {
      if (!ok) throw new Error('当前文档还有错误没保存，先处理好再导入。');
      if (mode !== 'new') return null;
      var snapshot = snapshotForExport();
      var record = {
        version: '导入前备份 ' + fmtDate(Date.now()),
        createdAt: Date.now(),
        articleCount: state.articles.length,
        snapshotBytes: byteSize(snapshot),
        zipBytes: 0,
        note: '导入前自动备份',
        snapshot: snapshot
      };
      return dbAdd(STORE_BUILDS, record).then(function (id) {
        record.id = id;
        state.builds.unshift(record);
      });
    }).then(function () {
      return replaceSiteData(pending.config, pending.articles);
    }).then(function () {
      state.config = pending.config;
      state.articles = pending.articles;
      normalizeConfig();
      dbPut(STORE_CONFIG, state.config).catch(function () { /* 规范化结果下次打开还会再算一遍 */ });
      resetEditor();
      state.currentId = null;
      state.currentPageId = null;
      state.history = { past: [], future: [] };
      applyWorkbenchPalette();
      renderAll();
      renderBuilds();
      renderExportSummary();
      updateStorageSoon();
      var preview = qs('[data-import-preview]');
      if (preview) { preview.hidden = true; preview.innerHTML = ''; }
      var input = qs('[data-import-file]');
      if (input) input.value = '';
      setImportPending(null);
      switchView('articles');
      var page = pagesSorted()[0];
      if (page) openPage(page.id);
      else if (state.articles[0]) openArticle(state.articles[0].id);
      setImportState('导入完成：' + pending.articleCount + ' 篇文章、' + pending.pageCount + ' 个页面。');
      toast('已导入 ' + pending.articleCount + ' 篇文章' + (mode === 'new' ? '，当前站点已备份到构建记录' : ''));
      return true;
    }).catch(function (err) {
      console.error(err);
      setImportError('导入写入失败，现有数据没有改动：' + ((err && err.message) || '未知错误') +
        '。如果提示配额不足，先到构建记录里删掉旧版本，再重试。');
      setImportState('导入失败', true);
      return false;
    }).finally(function () {
      state.importing = false;
    });
  }

  function bindImport() {
    var pageInput = qs('[data-import-page]');
    if (pageInput) {
      pageInput.addEventListener('change', function () {
        handlePageImport(pageInput.files && pageInput.files[0]);
        pageInput.value = '';
      });
    }
    var input = qs('[data-import-file]');
    if (!input) return;
    input.addEventListener('change', function () {
      handleImportFile(input.files && input.files[0]);
    });
    var replaceBtn = qs('[data-import-replace]');
    if (replaceBtn) {
      replaceBtn.addEventListener('click', function () {
        if (!state.importPending) return;
        confirmDialog({
          title: '覆盖当前站点',
          message: '导入会替换当前站点的配置和全部文章。现有数据不会自动保留，确定继续？如果想留一条退路，改用「导入为新站点」，会先备份当前站点。',
          confirmLabel: '覆盖导入',
          onConfirm: function () { return applyImport('replace'); }
        });
      });
    }
    var newBtn = qs('[data-import-new]');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        applyImport('new');
      });
    }
  }

  /* ---------------- 启动 ---------------- */

  bindEditor();
  bindImport();
  init();
})();

