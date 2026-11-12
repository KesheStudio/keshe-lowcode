/* 渲染核心 · Node 侧自检
   直接运行：node src/render/samples/verify.cjs
   不依赖浏览器，验证纯函数输出、错误隔离、作用域 CSS、主题变量。 */
(async function () {
  'use strict';

  var R = require('../node.cjs');
  var site = R.loadModule('./samples/site.data.js');
  var blocks = R.loadModule('./samples/blocks.js');

  var failures = [];
  var passes = [];

  function check(name, condition, detail) {
    if (condition) {
      passes.push(name);
      console.log('  PASS  ' + name);
    } else {
      failures.push(name + (detail ? ' — ' + detail : ''));
      console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function hexLuminance(hex) {
    var text = String(hex || '').replace('#', '');
    if (text.length === 3) text = text.split('').map(function (ch) { return ch + ch; }).join('');
    var rgb = [0, 2, 4].map(function (index) {
      var value = parseInt(text.slice(index, index + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrastRatio(foreground, background) {
    var a = hexLuminance(foreground);
    var b = hexLuminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function themeColor(theme, mode, token) {
    return theme && theme[mode] ? theme[mode][token] : null;
  }

  console.log('渲染核心 Node 自检');
  console.log('版本 ' + R.version + ' · 模块就绪 ' + (R.ready ? '是' : '否'));

  check('入口模块完整', R.ready === true, R.missing && R.missing.join(', '));

  var registry = R.createRegistry();
  blocks.registerSampleBlocks(registry);
  R.registerBuiltinComponents(registry);
  var renderer = R.createRenderer(site, { registry: registry });

  check('页面数量为 16', renderer.listPages().length === 16, String(renderer.listPages().length));
  check('主题数量为 3', renderer.themes.length === 3, String(renderer.themes.length));

  // ---------- 亮色次要文字对比度 ----------
  site.themes.forEach(function (theme) {
    var lightBg = ['--lc-color-bg', '--lc-color-surface', '--lc-color-surface-2', '--lc-color-surface-3'];
    var lightMin = Math.min.apply(null, lightBg.map(function (token) {
      return contrastRatio(themeColor(theme, 'light', '--lc-color-muted-2'), themeColor(theme, 'light', token));
    }));
    check('亮色次要文字 ≥4.5:1 · ' + theme.id, lightMin >= 4.5, lightMin.toFixed(2));
    var darkBg = ['--lc-color-bg', '--lc-color-surface', '--lc-color-surface-2'];
    var darkMin = Math.min.apply(null, darkBg.map(function (token) {
      return contrastRatio(themeColor(theme, 'dark', '--lc-color-muted-2'), themeColor(theme, 'dark', token));
    }));
    check('暗色次要文字 ≥4.5:1 · ' + theme.id, darkMin >= 4.5, darkMin.toFixed(2));
    var decorLight = contrastRatio(themeColor(theme, 'light', '--lc-color-decor'), themeColor(theme, 'light', '--lc-color-surface-2'));
    var decorDark = contrastRatio(themeColor(theme, 'dark', '--lc-color-decor'), themeColor(theme, 'dark', '--lc-color-surface-2'));
    check('亮暗两套装饰令牌齐全 · ' + theme.id,
      themeColor(theme, 'light', '--lc-color-decor') && themeColor(theme, 'dark', '--lc-color-decor'),
      (decorLight || 0).toFixed(2) + '/' + (decorDark || 0).toFixed(2));
    ['light', 'dark'].forEach(function (mode) {
      var decor = themeColor(theme, mode, '--lc-color-decor');
      var surfaces = ['--lc-color-bg', '--lc-color-surface', '--lc-color-surface-2',
        '--lc-color-surface-3', '--lc-color-bg-deep'];
      var minDecor = Math.min.apply(null, surfaces.map(function (token) {
        return contrastRatio(decor, themeColor(theme, mode, token));
      }));
      check('装饰色 ≥3:1 · ' + theme.id + ' ' + mode, minDecor >= 3, minDecor.toFixed(2));
      var mutedOnBg = contrastRatio(themeColor(theme, mode, '--lc-color-muted-2'), themeColor(theme, mode, '--lc-color-bg'));
      var decorOnBg = contrastRatio(decor, themeColor(theme, mode, '--lc-color-bg'));
      var gap = mutedOnBg - decorOnBg;
      check('装饰色比 muted-2 淡 ≥1.0 · ' + theme.id + ' ' + mode, gap >= 1, gap.toFixed(2));
    });
  });

  function componentCss(id) {
    var mod = R.loadModule('./components/' + id + '.js');
    var defs;
    if (Array.isArray(mod)) defs = mod;
    else if (mod && (mod.type || mod.css || mod.sharedCss)) defs = [mod];
    else defs = Object.keys(mod || {}).map(function (key) { return mod[key]; });
    function cssOf(def) {
      var parts = [];
      if (Array.isArray(def.css)) parts.push(def.css.join('\n'));
      else if (def.css) parts.push(String(def.css));
      if (Array.isArray(def.sharedCss)) parts.push(def.sharedCss.join('\n'));
      else if (def.sharedCss) parts.push(String(def.sharedCss));
      return parts.join('\n');
    }
    return defs.map(cssOf).join('\n');
  }

  var decorCss = ['charts', 'code', 'date', 'slider', 'otp', 'shell'].map(componentCss).join('\n');
  check('装饰色兜底收敛为单层', decorCss.indexOf('var(--lc-color-decor, var(--lc-color-muted-2') === -1 &&
    decorCss.split('var(--lc-color-decor, #888)').length - 1 >= 7,
    String(decorCss.split('var(--lc-color-decor, #888)').length - 1));
  var textfieldCss = componentCss('textfield');
  check('文本框禁用态使用 disabled-ink', /\.lc-ui-textfield-input:disabled[^}]*var\(--lc-color-disabled-ink, #888\)/.test(textfieldCss) &&
    !/\.lc-ui-textfield-input:disabled[^}]*muted-2/.test(textfieldCss));
  var otpCss = componentCss('otp');
  check('验证码禁用态不再叠加透明度', !/\.lc-ui-otp-cell:disabled[^}]*opacity/.test(otpCss) &&
    /\.lc-ui-otp-cell:disabled[^}]*var\(--lc-color-decor, #888\)/.test(otpCss));

  // ---------- 流式页 ----------
  var home = renderer.render('page-home', { themeId: 'ink-green', mode: 'light' });
  var homeHtml = R.toHtml(home.node);
  console.log('\n[流式布局页]');
  check('无渲染错误', home.report.errors().length === 0, R.reportToText(home.report));
  check('输出为 HTML 字符串', typeof homeHtml === 'string' && homeHtml.length > 1000, String(homeHtml.length));
  check('页面根节点存在', homeHtml.indexOf('data-lc-page="page-home"') !== -1);
  check('流式容器存在', homeHtml.indexOf('lc-flow') !== -1);
  check('卡片容器存在', homeHtml.indexOf('lc-container-card') !== -1);
  check('分栏容器存在', homeHtml.indexOf('lc-container-columns') !== -1);
  check('折叠容器存在', homeHtml.indexOf('lc-container-accordion') !== -1);
  check('导航外壳存在', homeHtml.indexOf('data-lc-ui="ui-site-nav"') !== -1 && homeHtml.indexOf('lc-shell-nav') !== -1);
  check('页脚外壳存在', homeHtml.indexOf('data-lc-ui="ui-site-footer"') !== -1 && homeHtml.indexOf('lc-shell-footer') !== -1);
  check('两个提示条实例各有一份脚本', home.scripts.length === 2, String(home.scripts.length));
  check('脚本绑定到实例根节点', home.scripts.every(function (item) {
    return item.source.indexOf('querySelector') !== -1 && item.source.indexOf('addEventListener') !== -1;
  }));
  check('组件 CSS 已按组件作用域', home.css.indexOf('[data-lc-comp="comp-callout"] .demo-callout') !== -1);
  check('组件 CSS 没有裸选择器', home.css.indexOf('\n.demo-callout {') === -1);
  check('主题变量已注入', home.css.indexOf('[data-lc-theme="ink-green"][data-lc-mode="light"]') !== -1 && home.css.indexOf('--lc-color-bg:') !== -1);
  check('暗色规则走 data-lc-mode', home.css.indexOf('[data-lc-theme="ink-green"][data-lc-mode="dark"]') !== -1);
  check('主题不再读系统偏好', home.css.indexOf('prefers-color-scheme') === -1);
  check('data-theme 兼容规则保留', home.css.indexOf('[data-theme="dark"]') !== -1);
  check('模式属性为 data-lc-mode', homeHtml.indexOf('data-lc-mode="light"') !== -1);
  check('旧 data-theme 兼容标记存在', homeHtml.indexOf('data-theme="light"') !== -1);
  check('根元素有默认主题背景兜底', /:root \{[^}]*--lc-color-bg:/.test(home.css));
  check('html/body 背景用主题令牌', /html,\s*body \{[^}]*background: var\(--lc-color-bg/.test(home.css));
  check('页面根容器背景用主题令牌', /:where\(\.lc-page\)[^{]*\{[^}]*background: var\(--lc-color-bg/.test(home.css));

  // ---------- 自由页 ----------
  var free = renderer.render('page-free', { themeId: 'ink-ochre', mode: 'dark' });
  var freeHtml = R.toHtml(free.node);
  console.log('\n[自由定位页]');
  check('无渲染错误', free.report.errors().length === 0, R.reportToText(free.report));
  check('自由布局根存在', freeHtml.indexOf('data-lc-layout="free"') !== -1 && freeHtml.indexOf('lc-free') !== -1);
  check('绝对定位标记存在', freeHtml.indexOf('data-lc-positioned="abs"') !== -1);
  check('左侧坐标生效', freeHtml.indexOf('left:0px') !== -1);
  check('右侧坐标生效', freeHtml.indexOf('left:600px') !== -1);
  check('容器内部仍可流式', freeHtml.indexOf('lc-container-card') !== -1 && freeHtml.indexOf('lc-flow') !== -1);
  check('自由页组件脚本 1 段', free.scripts.length === 1, String(free.scripts.length));
  check('深色模式标记正确', freeHtml.indexOf('data-lc-mode="dark"') !== -1 && freeHtml.indexOf('data-theme="dark"') !== -1);
  check('赭石主题变量注入', free.css.indexOf('[data-lc-theme="ink-ochre"]') !== -1);

  // ---------- 嵌套页 ----------
  var nested = renderer.render('page-nested', { themeId: 'ink-slate', mode: 'auto' });
  var nestedHtml = R.toHtml(nested.node);
  console.log('\n[嵌套容器页]');
  check('无渲染错误', nested.report.errors().length === 0, R.reportToText(nested.report));
  check('自由容器存在', nestedHtml.indexOf('lc-container-free') !== -1);
  check('嵌套卡片存在', nestedHtml.indexOf('data-lc-block="nf-card"') !== -1 && nestedHtml.indexOf('lc-container-card') !== -1);
  check('内层自由容器存在', nestedHtml.indexOf('data-lc-block="nf-inner"') !== -1);
  check('绝对定位子块不少于 6 个', (nestedHtml.match(/data-lc-positioned="abs"/g) || []).length >= 6,
    String((nestedHtml.match(/data-lc-positioned="abs"/g) || []).length));
  check('auto 原样输出不自行判断', nestedHtml.indexOf('data-lc-mode="auto"') !== -1 && nestedHtml.indexOf('data-theme=') === -1);
  check('auto 未解析会记提醒', nested.report.items.some(function (item) {
    return item.code === R.CODES.MODE_UNRESOLVED;
  }));
  check('嵌套页组件脚本 1 段', nested.scripts.length === 1, String(nested.scripts.length));

  // ---------- 文章页 ----------
  console.log('\n[文章页]');
  var article = renderer.render('page-article', { themeId: 'ink-green', mode: 'light', preview: true });
  var articleHtml = R.toHtml(article.node);
  var expectedIds = ['section-1', 'section-1-sub-1', 'section-2', 'section-2-sub-1', 'section-3', 'section-3-sub-1'];
  check('文章页根带标记', articleHtml.indexOf('data-lc-article="true"') !== -1);
  check('章节 id 按规则生成', expectedIds.every(function (id) {
    return articleHtml.indexOf('id="' + id + '"') !== -1;
  }));
  check('标题全部登记', article.article && article.article.headings.length === 6,
    article.article ? String(article.article.headings.length) : 'null');
  check('右侧目录存在', articleHtml.indexOf('lc-article-toc') !== -1 && articleHtml.indexOf('href="#section-2"') !== -1);
  check('h3 目录缩进', articleHtml.indexOf('lc-toc-sub') !== -1);
  check('目录标题可配置', articleHtml.indexOf('本文目录') !== -1);
  check('上下篇自动取', articleHtml.indexOf('lc-article-nav-prev') !== -1 && articleHtml.indexOf('lc-article-nav-next') !== -1);
  check('上下篇标题正确', articleHtml.indexOf('单块失败如何不拖垮整页') !== -1 &&
    articleHtml.indexOf('主题切换为什么不需要重渲染') !== -1);
  check('文章页无渲染错误', article.report.errors().length === 0, String(article.report.errors().length));

  var plainArticle = R.enhanceArticle([R.raw('<h2>标题</h2>')], {
    article: { toc: false, autoNav: false },
    page: { articleId: 'a5' },
    site: site
  });
  check('可关闭目录', plainArticle.tocNode === null);
  check('可关闭上下篇', plainArticle.navNode === null);

  var dupReport = R.createReport();
  var dup = R.enhanceArticle([R.raw('<h2 id="dup">A</h2><h2 id="dup">B</h2>')], { report: dupReport });
  check('重复章节 id 会换新值', dup.headings[0].id !== dup.headings[1].id, dup.headings.map(function (h) { return h.id; }).join(','));
  check('重复章节 id 被记录', dupReport.items.some(function (item) {
    return item.code === R.CODES.DUPLICATE_HEADING_ID;
  }));

  // ---------- 错误隔离 ----------
  console.log('\n[错误隔离]');
  var brokenPage = clone(site.pages[0]);
  brokenPage.id = 'page-broken';
  brokenPage.layout = { mode: 'free' };
  brokenPage.blocks.push({ id: 'bad-unknown', type: 'not-registered' });
  brokenPage.blocks.push({ id: 'bad-null', type: null });
  brokenPage.blocks.push(null);
  brokenPage.blocks.push({ id: 'bad-component', type: 'component', componentId: 'comp-missing' });
  brokenPage.blocks.push({ id: 'bad-pos', type: 'note', tone: 'info', md: '坏坐标', pos: { x: 'oops', y: 0 } });

  var broken = renderer.render(brokenPage, { themeId: 'ink-green', mode: 'light' });
  var brokenHtml = R.toHtml(broken.node);
  var codes = broken.report.items.map(function (item) { return item.code; });
  check('坏页面仍有正常区块', brokenHtml.indexOf('home-hero') !== -1 && brokenHtml.indexOf('home-cards') !== -1);
  check('未知区块被记录', codes.indexOf(R.CODES.BLOCK_UNKNOWN) !== -1);
  check('非法区块被记录', codes.indexOf(R.CODES.BLOCK_INVALID) !== -1);
  check('缺失组件被记录', codes.indexOf(R.CODES.COMPONENT_MISSING) !== -1);
  check('坏坐标只产生提醒', codes.indexOf(R.CODES.POS_INVALID) !== -1);
  check('错误数量与坏块匹配', broken.report.errors().length === 4, String(broken.report.errors().length));

  // ---------- 纯函数细节 ----------
  console.log('\n[纯函数]');
  var md = R.markdownToHtml('## 标题\n\n段落 **加粗** 和 `代码`\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  check('Markdown 标题输出', md.indexOf('<h2>标题</h2>') !== -1);
  check('Markdown 表格输出', md.indexOf('<table>') !== -1 && md.indexOf('<th>A</th>') !== -1);
  check('Markdown 转义原始标签', R.markdownToHtml('<script>alert(1)</script>').indexOf('&lt;script&gt;') !== -1);
  check('危险链接被拦截', R.markdownToHtml('[x](javascript:alert(1))').indexOf('javascript:') === -1);

  var scoped = R.scopeCss('.a{} :root .b{} @media (min-width: 700px){.c{color:red}}', '[data-test="x"]');
  check('普通选择器加作用域', scoped.indexOf('[data-test="x"] .a') !== -1);
  check(':root 映射到作用域根', scoped.indexOf('[data-test="x"] .b') !== -1);
  check('媒体查询内部继续作用域', scoped.indexOf('@media (min-width: 700px)') !== -1 && scoped.indexOf('[data-test="x"] .c') !== -1);

  var dropped = R.scopeCss('@import url("https://example.com/x.css");.a{}', '[data-test="x"]');
  check('@import 被丢弃', dropped.indexOf('@import') === -1 && dropped.indexOf('[data-test="x"] .a') !== -1);

  // ---------- 外壳交互 ----------
  console.log('\n[外壳交互]');

  check('px 解析', R.parsePx('24px') === 24 && R.parsePx(18) === 18 && R.parsePx('', 80) === 80);
  check('到底判定', R.reachedBottom(900, 500, 1500) === false && R.reachedBottom(998, 500, 1500) === true);

  var sections = [{ id: 's1', top: 0 }, { id: 's2', top: 400 }, { id: 's3', top: 900 }];
  check('顶部高亮第一节', R.pickActiveSection(sections, { scrollTop: 0, offset: 80 }) === 's1');
  check('中途切换章节', R.pickActiveSection(sections, { scrollTop: 380, offset: 40 }) === 's2');
  check('偏移改变激活线', R.pickActiveSection(sections, { scrollTop: 340, offset: 20 }) === 's1');
  check('到底收尾到最后一节', R.pickActiveSection(sections, { scrollTop: 120, offset: 20, atBottom: true }) === 's3');
  check('只返回单个章节', typeof R.pickActiveSection(sections, { scrollTop: 500, offset: 0 }) === 'string');
  check('空章节列表安全', R.pickActiveSection([], {}) === null);

  var segments = R.searchSegments('Alpha alpha ALPHA', 'alpha');
  check('检索不区分大小写', segments.filter(function (item) { return item.hit; }).length === 3);
  check('命中保留原文大小写', segments.filter(function (item) { return item.hit; })[0].text === 'Alpha');
  check('区分大小写模式', R.searchSegments('Alpha alpha', 'Alpha', { caseSensitive: true })
    .filter(function (item) { return item.hit; }).length === 1);
  check('未命中不分段', R.searchSegments('nothing here', 'alpha').length === 1 &&
    R.searchSegments('nothing here', 'alpha')[0].hit === false);
  check('空关键词零命中', R.searchSegments('abc', '').every(function (item) { return !item.hit; }));
  check('下一个循环', R.stepIndex(0, 3, 1) === 1 && R.stepIndex(2, 3, 1) === 0);
  check('上一个循环', R.stepIndex(0, 3, -1) === 2 && R.stepIndex(-1, 3, -1) === 2);
  check('空集合返回 -1', R.stepIndex(0, 0, 1) === -1);

  check('深链接解析', R.sectionIdFromHash('#section-2') === 'section-2' &&
    R.sectionIdFromHash('section-1') === 'section-1' &&
    R.sectionIdFromHash('#section%2D3') === 'section-3');
  check('偏移定位', R.scrollTopFor(900, 80) === 820);
  check('定位夹在边界内', R.scrollTopFor(20, 80) === 0 && R.scrollTopFor(1200, 80, 500) === 500);

  var fakeStore = (function () {
    var data = {};
    return {
      data: data,
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { data[key] = String(value); },
      removeItem: function (key) { delete data[key]; }
    };
  }());
  var tocState = R.createTocState({ storage: fakeStore, key: 'toc' });
  check('目录默认展开', tocState.collapsed() === false && tocState.ariaExpanded() === 'true');
  tocState.toggle();
  check('折叠写入本地', tocState.collapsed() === true && fakeStore.data.toc === '1' &&
    tocState.ariaExpanded() === 'false' && tocState.label() === '展开目录');
  check('重建读取折叠状态', R.createTocState({ storage: fakeStore, key: 'toc' }).collapsed() === true);
  tocState.set(false);
  check('展开同步状态', tocState.ariaExpanded() === 'true' && fakeStore.data.toc === '0');
  var brokenStore = {
    getItem: function () { throw new Error('blocked'); },
    setItem: function () { throw new Error('blocked'); },
    removeItem: function () { throw new Error('blocked'); }
  };
  var safeState = R.createTocState({ storage: brokenStore, key: 'x' });
  safeState.set(true);
  check('存储异常不影响交互', safeState.collapsed() === true && safeState.ariaExpanded() === 'false');
  check('交互样式含折叠与高亮', R.interactionsCss().indexOf('[data-lc-toc-collapsed="true"]') !== -1 &&
    R.interactionsCss().indexOf('.lc-toc-link.is-active') !== -1 &&
    R.interactionsCss().indexOf('.lc-search-hit') !== -1);

  // ---------- Mermaid ----------
  console.log('\n[Mermaid]');

  var flow = R.renderMermaidSvg('flowchart LR\n  A[开始] --> B{判断}\n  B -->|是| C((完成))');
  check('flowchart 出图', flow.ok && flow.type === 'flowchart' && flow.svg.indexOf('<svg') !== -1 &&
    flow.svg.indexOf('开始') !== -1, flow.message || '');
  check('flowchart 保留连线标签', flow.svg.indexOf('是') !== -1);

  var seq = R.renderMermaidSvg('sequenceDiagram\n  participant U as 用户\n  participant S as 服务端\n  U->>S: 提交\n  S-->>U: 返回');
  check('sequenceDiagram 出图', seq.ok && seq.type === 'sequenceDiagram' &&
    seq.svg.indexOf('用户') !== -1 && seq.svg.indexOf('提交') !== -1, seq.message || '');

  var gantt = R.renderMermaidSvg('gantt\n  title 发布节奏\n  section 交付\n  开发 :2026-11-08, 10d');
  check('gantt 出图', gantt.ok && gantt.type === 'gantt' && gantt.svg.indexOf('发布节奏') !== -1 &&
    gantt.svg.indexOf('开发') !== -1, gantt.message || '');

  var classSvg = R.renderMermaidSvg('classDiagram\n  class Page {\n    +String id\n  }\n  Page --> Block : 包含');
  check('classDiagram 出图', classSvg.ok && classSvg.type === 'classDiagram' &&
    classSvg.svg.indexOf('Page') !== -1 && classSvg.svg.indexOf('Block') !== -1, classSvg.message || '');

  var syntax = R.renderMermaidSvg('flowchart TD\n  A[开始] -->\n  B[结束]');
  check('语法错误带行号', syntax.ok === false && syntax.code === 'MERMAID_SYNTAX' && syntax.line === 2,
    JSON.stringify({ code: syntax.code, line: syntax.line }));
  var unsupported = R.renderMermaidSvg('pie\n  "A": 1');
  check('不支持类型降级', unsupported.ok === false && unsupported.code === 'MERMAID_UNSUPPORTED' && unsupported.line === 1);

  check('SVG 使用主题变量', flow.svg.indexOf('var(--lc-mermaid') !== -1 &&
    flow.svg.indexOf('var(--lc-color') !== -1);
  check('SVG 无脚本与事件', flow.svg.indexOf('<script') === -1 && flow.svg.indexOf(' on') === -1);

  var dirtySvg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>alert(2)</script><rect x="0" y="0" width="10" height="10" fill="red" onclick="x()"/>' +
    '<a href="https://evil.test"><text>hi</text></a><image href="https://evil.test/x.png"/>' +
    '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">bad</body></foreignObject></svg>';
  var cleanSvg = R.sanitizeSvg(dirtySvg);
  check('消毒去掉脚本', cleanSvg.indexOf('<script') === -1 && cleanSvg.indexOf('onload') === -1);
  check('消毒去掉事件属性', cleanSvg.indexOf('onclick') === -1);
  check('消毒去掉外链', cleanSvg.indexOf('evil.test') === -1 && cleanSvg.indexOf('href') === -1);
  check('消毒保留图形', cleanSvg.indexOf('<rect') !== -1 && cleanSvg.indexOf('fill="red"') !== -1);
  check('消毒拒绝 url(javascript)', R.sanitizeSvg('<svg><rect fill="url(javascript:alert(1))" width="1" height="1"/></svg>')
    .indexOf('javascript:') === -1);
  check('无 svg 时不返回垃圾', R.sanitizeSvg('not an svg') === '');

  var injectMd = R.markdownToHtml('```mermaid\nflowchart TD\n  A --> B\n```\n\n```js\nvar a = 1;\n```');
  check('mermaid 不当普通代码', injectMd.indexOf('data-lc-mermaid="true"') !== -1 &&
    injectMd.indexOf('language-mermaid') === -1);
  check('mermaid 保留原始代码', injectMd.indexOf('flowchart TD') !== -1);
  check('普通代码块不受影响', injectMd.indexOf('language-js') !== -1);
  var hookedMd = R.markdownToHtml('```mermaid\nflowchart TD\n  A --> B\n```', {
    mermaid: function (code) { return R.renderMermaidBuiltin(code); }
  });
  check('渲染期注入渲染器', hookedMd.indexOf('<svg') !== -1 &&
    hookedMd.indexOf('data-lc-mermaid-status="ready"') !== -1);

  var noRenderer = R.createMermaidRegistry().render('flowchart TD\n  A --> B');
  check('未注册渲染器降级', noRenderer.ok === false && noRenderer.code === 'MERMAID_NO_RENDERER');
  var throwing = R.createMermaidRegistry().use(function () { throw new Error('boom'); });
  var thrown = throwing.render('flowchart TD\n  A --> B');
  check('渲染器异常被捕获', thrown.ok === false && thrown.code === 'MERMAID_RENDER_FAILED');

  var lazyRegistry = R.createMermaidRegistry();
  var lazyLoads = 0;
  lazyRegistry.setLoader(function () { lazyLoads += 1; return R.renderMermaidBuiltin; });
  var emptyPage = R.enhanceMermaid({ querySelectorAll: function () { return []; } }, { registry: lazyRegistry });
  check('无图块不触发加载', emptyPage.total === 0 && lazyLoads === 0, String(lazyLoads));
  lazyRegistry.load();
  lazyRegistry.load();
  check('多个块共享一次加载', lazyLoads === 1, String(lazyLoads));

  var mermaidPage = renderer.render('page-mermaid', { themeId: 'ink-green', mode: 'light' });
  var mermaidHtml = R.toHtml(mermaidPage.node);
  check('图表页无渲染错误', mermaidPage.report.errors().length === 0, R.reportToText(mermaidPage.report));
  check('图表页有 5 个图块', (mermaidHtml.match(/data-lc-mermaid="true"/g) || []).length === 5,
    String((mermaidHtml.match(/data-lc-mermaid="true"/g) || []).length));
  check('图表页保留源码作为降级', mermaidHtml.indexOf('data-lc-mermaid-source') !== -1 &&
    mermaidHtml.indexOf('sequenceDiagram') !== -1);

  // ---------- 内置组件 ----------
  console.log('\n[内置组件]');

  var types = R.componentTypes();
  check('内置组件共 39 类', types.length === 39, types.join(','));
  check('每类都有 schema', types.every(function (type) {
    var schema = R.componentSchema(type);
    return !!schema && schema.type === type && Array.isArray(schema.states) &&
      !!schema.props && typeof schema.props === 'object';
  }));
  check('表格 schema 覆盖列与分页', (function () {
    var schema = R.componentSchema('ui-table');
    return schema.props.columns && schema.props.rows && schema.props.pageSize &&
      schema.props.selectable && schema.props.sortKey;
  }()));
  check('表单 schema 覆盖四类校验', (function () {
    var fields = R.componentSchema('ui-form').props.fields.items.props;
    return fields.required && fields.minLength && fields.maxLength &&
      fields.pattern && fields.min && fields.max;
  }()));
  check('弹窗/抽屉各有 schema 与事件', R.componentSchema('ui-modal') &&
    R.componentSchema('ui-drawer') &&
    R.componentSchema('ui-modal').events.indexOf('lc:overlay-open') !== -1);

  check('每类都可单独注册进注册表', types.every(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    var def = single.block(type);
    return !!def && typeof def.render === 'function' && !!def.schema;
  }));

  var minimalSite = {
    project: { theme: { defaultThemeId: 'a', mode: 'light' } },
    themes: [{ id: 'a', light: {} }],
    pages: [{ id: 'p', blocks: [] }]
  };
  check('缺字段不抛错且零错误', types.every(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    var page = { id: 'p', blocks: [{ id: 'b-' + type, type: type }] };
    try {
      var result = single && R.createRenderer(minimalSite, { registry: single }).render(page, { themeId: 'a', mode: 'light' });
      var html = R.toHtml(result.node);
      return result.report.errors().length === 0 && html.indexOf('data-lc-block="b-' + type + '"') !== -1;
    } catch (error) {
      return false;
    }
  }), types.filter(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    try {
      return R.createRenderer(minimalSite, { registry: single })
        .render({ id: 'p', blocks: [{ id: 'b-' + type, type: type }] }, { themeId: 'a', mode: 'light' })
        .report.errors().length > 0;
    } catch (error) { return true; }
  }).join(','));

  check('加载态与错误态统一标记', types.every(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    var def = single.block(type);
    var states = type === 'ui-state' ? [['kind', 'loading'], ['kind', 'error']] : [['state', 'loading'], ['state', 'error']];
    return states.every(function (pair) {
      var block = { id: 'b', type: type };
      block[pair[0]] = pair[1];
      var result = R.createRenderer(minimalSite, { registry: single }).render({ id: 'p', blocks: [block] }, { themeId: 'a', mode: 'light' });
      var html = R.toHtml(result.node);
      return result.report.errors().length === 0 &&
        new RegExp('data-lc-state="' + pair[1] + '"').test(html);
    });
  }));

  var compPage = renderer.render('page-components', { themeId: 'ink-green', mode: 'light', preview: true });
  var compHtml = R.toHtml(compPage.node);
  check('组件页无渲染错误', compPage.report.errors().length === 0, R.reportToText(compPage.report));
  var baseTypes = ['ui-table', 'ui-form', 'ui-modal', 'ui-drawer', 'ui-tabs',
    'ui-carousel', 'ui-timeline', 'ui-code', 'ui-state'];
  check('组件页覆盖首轮九类组件', baseTypes.every(function (type) {
    return compHtml.indexOf('data-lc-ui="' + type + '"') !== -1;
  }), baseTypes.filter(function (type) {
    return compHtml.indexOf('data-lc-ui="' + type + '"') === -1;
  }).join(','));
  check('共享样式只注入一次', (compPage.css.match(/\/\* lc-ui-common \*\//g) || []).length === 1,
    String((compPage.css.match(/\/\* lc-ui-common \*\//g) || []).length));
  check('表格含排序与分页控件', compHtml.indexOf('data-lc-sort') !== -1 && compHtml.indexOf('data-lc-page') !== -1);
  check('表格行选择存在', compHtml.indexOf('data-lc-row=') !== -1);
  check('表单错误提示位于控件下方', compHtml.indexOf('aria-describedby') !== -1);
  check('弹窗与抽屉都在遮罩内渲染', compHtml.indexOf('lc-ui-overlay-backdrop') !== -1 &&
    compHtml.indexOf('data-lc-overlay-id="demo-drawer"') !== -1);
  check('标签页懒加载面板用 template', compHtml.indexOf('data-lc-tab-template') !== -1);
  check('轮播含指示点与暂停开关', compHtml.indexOf('data-lc-slide-to=') !== -1 && compHtml.indexOf('data-lc-carousel-toggle') !== -1);
  check('时间线节点带状态', compHtml.indexOf('data-status="done"') !== -1 && compHtml.indexOf('data-status="error"') !== -1);
  check('代码块含行号与复制按钮', compHtml.indexOf('lc-ui-code-line') !== -1 && compHtml.indexOf('data-lc-copy') !== -1);

  var tableHelpers = R.componentDefs['ui-table'].helpers;
  check('表格排序纯函数', JSON.stringify(tableHelpers.sortRows([{ n: 3 }, { n: 1 }, { n: 2 }], 'n', 'asc')
    .map(function (row) { return row.n; })) === '[1,2,3]');
  var paged = tableHelpers.paginate(new Array(7).join(',').split(','), 2, 3);
  check('分页纯函数', paged.page === 2 && paged.totalPages === 3 && paged.rows.length === 3,
    JSON.stringify({ page: paged.page, totalPages: paged.totalPages, rows: paged.rows.length }));
  check('排序方向切换', tableHelpers.nextSort('n', 'asc').dir === 'desc');

  var formHelpers = R.componentDefs['ui-form'].helpers;
  check('必填校验', formHelpers.validateField({ name: 'x', required: true }, '') !== null);
  check('长度校验', formHelpers.validateField({ minLength: 3 }, 'ab') !== null &&
    formHelpers.validateField({ maxLength: 2 }, 'abc') !== null);
  check('正则校验', formHelpers.validateField({ pattern: '^\\d+$' }, 'abc') !== null &&
    formHelpers.validateField({ pattern: '^\\d+$' }, '123') === null);
  check('数值范围校验', formHelpers.validateField({ type: 'number', min: 2, max: 5 }, '1') !== null &&
    formHelpers.validateField({ type: 'number', min: 2, max: 5 }, '9') !== null);

  var tabsHelpers = R.componentDefs['ui-tabs'].helpers;
  var tabItems = tabsHelpers.normalizeItems([{ id: 'a' }, { id: 'b', disabled: true }, { id: 'c' }]);
  check('标签页方向键跳过禁用项', tabsHelpers.nextTabIndex(tabItems, 0, 1) === 2,
    String(tabsHelpers.nextTabIndex(tabItems, 0, 1)));

  var carouselHelpers = R.componentDefs['ui-carousel'].helpers;
  check('轮播循环步进', carouselHelpers.stepSlide(2, 3, 1, true) === 0 &&
    carouselHelpers.stepSlide(0, 3, -1, true) === 2);
  check('轮播非循环夹边', carouselHelpers.stepSlide(2, 3, 1, false) === 2 &&
    carouselHelpers.stepSlide(0, 3, -1, false) === 0);

  var codeHelpers = R.componentDefs['ui-code'].helpers;
  var highlighted = codeHelpers.highlightLine('const a = 1;', 'js');
  check('代码高亮含关键字 token', highlighted.indexOf('lc-ui-token-keyword') !== -1);
  check('代码高亮转义尖括号', codeHelpers.highlightLine('<script>alert(1)</script>', 'html').indexOf('&lt;') !== -1 &&
    codeHelpers.highlightLine('<script>alert(1)</script>', 'html').indexOf('<script>') === -1);
  check('状态类型解析', R.componentDefs['ui-state'].helpers.resolveKind({ kind: 'error' }) === 'error');

  // ---------- 文本框 / 验证码 / 上传 ----------
  console.log('\n[表单增强]');

  var tfPage = renderer.render('page-textfield', { themeId: 'ink-green', mode: 'light', preview: true });
  var tfHtml = R.toHtml(tfPage.node);
  check('文本框页无渲染错误', tfPage.report.errors().length === 0, R.reportToText(tfPage.report));
  check('浮动标签形态成立', tfHtml.indexOf('data-floating="true"') !== -1 &&
    tfHtml.indexOf('class="lc-ui-textfield-float" for="lc-tf') !== -1);
  check('占位符形态保留 label 关联', tfHtml.indexOf('lc-ui-textfield-label') !== -1 &&
    tfHtml.indexOf('placeholder="请输入内容"') !== -1);
  check('错误/禁用/只读都有标记', tfHtml.indexOf('role="alert"') !== -1 &&
    tfHtml.indexOf('disabled="disabled"') !== -1 && tfHtml.indexOf('readonly="readonly"') !== -1);
  check('字数计数随最大长度渲染', tfHtml.indexOf('0 / 40') !== -1 && tfHtml.indexOf('0 / 20') !== -1);
  check('输入框有 aria 关联', tfHtml.indexOf('aria-describedby') !== -1 && tfHtml.indexOf('aria-invalid') !== -1);
  check('前缀后缀文本与清除按钮', tfHtml.indexOf('lc-ui-textfield-text') !== -1 &&
    tfHtml.indexOf('>¥<') !== -1 && tfHtml.indexOf('>元<') !== -1 &&
    tfHtml.indexOf('data-lc-textfield-clear="true"') !== -1 &&
    tfHtml.indexOf('aria-label="清除输入"') !== -1);
  var tfHelpers = R.componentDefs['ui-textfield'].helpers;
  check('未知输入类型回退 text', tfHelpers.normalizeType('weird') === 'text');
  check('计数文本带上限', tfHelpers.countText('abc', 5) === '3 / 5');

  var otpPage = renderer.render('page-otp', { themeId: 'ink-green', mode: 'light', preview: true });
  var otpHtml = R.toHtml(otpPage.node);
  check('验证码页无渲染错误', otpPage.report.errors().length === 0, R.reportToText(otpPage.report));
  check('逐格输入且数字键盘', otpHtml.indexOf('data-lc-otp-cell="0"') !== -1 &&
    otpHtml.indexOf('inputmode="numeric"') !== -1 && otpHtml.indexOf('pattern="[0-9]*"') !== -1);
  check('字母数字模式带对应 pattern', otpHtml.indexOf('pattern="[0-9A-Za-z]*"') !== -1);
  check('验证码错误态带提示', otpHtml.indexOf('lc-ui-otp-error') !== -1 && otpHtml.indexOf('role="alert"') !== -1);
  var otpHelpers = R.componentDefs['ui-otp'].helpers;
  check('验证码过滤非法字符', otpHelpers.sanitize('12a3b', 'numeric') === '123');
  check('粘贴超长截断', JSON.stringify(otpHelpers.splitPaste('123456789', 'numeric', 6)) ===
    JSON.stringify(['1', '2', '3', '4', '5', '6']));
  check('粘贴不足保留空格不补齐', JSON.stringify(otpHelpers.splitPaste('12', 'numeric', 6)) ===
    JSON.stringify(['1', '2', '', '', '', '']));
  check('位数夹在 4–8', otpHelpers.normalizeLength(2) === 4 && otpHelpers.normalizeLength(12) === 8);
  check('验证码渲染过滤提示区', otpHtml.indexOf('data-lc-otp-notice') !== -1 &&
    otpHtml.indexOf('aria-live="polite"') !== -1);

  /* 四条硬边界：中文输入法、含空格换行、粘贴不足、粘贴位置在中间。 */
  var ime = otpHelpers.pastePlan(['', '', '', '', '', ''], '验证码', 2, 'numeric', 6);
  check('中文输入法被过滤且不落格', ime.filled === 0 && ime.removed === 3 &&
    ime.cells.join('') === '' && ime.focusIndex === 2);
  var spaced = otpHelpers.pastePlan(['', '', '', '', '', ''], '12 34\n56', 0, 'numeric', 6);
  check('粘贴含空格与换行逐格铺入', spaced.cells.join('') === '123456' &&
    spaced.filled === 6 && spaced.removed === 2);
  var shortPaste = otpHelpers.pastePlan(['', '', '', '', '', ''], '12', 0, 'numeric', 6);
  check('粘贴不足只填已有字符', shortPaste.filled === 2 &&
    shortPaste.cells.join(',') === '1,2,,,,');
  var middle = otpHelpers.pastePlan(['1', '2', '', '', '', ''], '789', 2, 'numeric', 6);
  check('粘贴位置在中间从当前格向后铺', middle.cells.join(',') === '1,2,7,8,9,' &&
    middle.startIndex === 2 && middle.focusIndex === 5 && middle.truncated === 0);
  var overflow = otpHelpers.pastePlan(['1', '2', '3', '', '', ''], '456789', 3, 'numeric', 6);
  check('中间粘贴超长只填剩余位数', overflow.filled === 3 && overflow.truncated === 3 &&
    overflow.cells.join(',') === '1,2,3,4,5,6');
  var alpha = otpHelpers.pastePlan(['', '', '', ''], 'a-1 b2', 0, 'alphanumeric', 4);
  check('字母数字模式保留字母并过滤符号', alpha.cells.join('') === 'a1b2' && alpha.removed === 2);

  var upPage = renderer.render('page-upload', { themeId: 'ink-green', mode: 'light', preview: true });
  var upHtml = R.toHtml(upPage.node);
  check('上传页无渲染错误', upPage.report.errors().length === 0, R.reportToText(upPage.report));
  check('未配置时明确提示', upHtml.indexOf('data-endpoint="false"') !== -1 &&
    upHtml.indexOf('data-lc-upload-notice') !== -1 &&
    upHtml.indexOf('未配置上传地址') !== -1);
  check('错误提示有文字与 aria', upHtml.indexOf('data-lc-upload-summary') !== -1 &&
    upHtml.indexOf('role="alert"') !== -1 &&
    upHtml.indexOf('aria-describedby="lc-upload-') !== -1);
  check('单文件与总大小上限进入配置', upHtml.indexOf('"maxSize":5242880') !== -1 &&
    upHtml.indexOf('"maxTotalSize":10485760') !== -1);
  check('本地预览模式只展示不伪造进度', upHtml.indexOf('data-lc-upload-mode="preview"') !== -1 &&
    upHtml.indexOf('data-lc-upload-preview="true"') !== -1 &&
    upHtml.indexOf('本地预览模式：只显示已选文件与大小') !== -1 &&
    upHtml.indexOf('data-status="preview"') !== -1);
  check('已配置实例带端点与字段名', upHtml.indexOf('data-endpoint="true"') !== -1 &&
    upHtml.indexOf('"endpoint":"/api/upload"') !== -1 &&
    upHtml.indexOf('"fieldName":"attachment"') !== -1 &&
    upHtml.indexOf('"X-Demo-Client":"lc-render"') !== -1);
  check('已有文件按状态渲染', upHtml.indexOf('设计稿.pdf') !== -1 &&
    upHtml.indexOf('data-status="error"') !== -1 && upHtml.indexOf('data-status="uploading"') !== -1);
  var upHelpers = R.componentDefs['ui-upload'].helpers;
  check('端点判定空值', upHelpers.hasEndpoint('') === false && upHelpers.hasEndpoint('/api/upload') === true);
  check('类型校验支持扩展名与通配', upHelpers.acceptMatch({ name: 'a.pdf', type: 'application/pdf' }, '.pdf') &&
    upHelpers.acceptMatch({ name: 'b.png', type: 'image/png' }, 'image/*') &&
    !upHelpers.acceptMatch({ name: 'c.zip', type: 'application/zip' }, '.pdf'));
  check('大小格式化', upHelpers.formatSize(1048576) === '1.0 MB' && upHelpers.formatSize(512) === '512 B');
  check('总大小排除失败项', upHelpers.totalSizeOf([
    { size: 100, status: 'success' },
    { size: 200, status: 'error' },
    { size: 300, status: 'preview' }
  ]) === 400);
  check('请求头兼容对象与数组', JSON.stringify(upHelpers.normalizeHeaders({ a: 1 })) === '{"a":"1"}' &&
    JSON.stringify(upHelpers.normalizeHeaders([{ name: 'A', value: 1 }])) === '{"A":"1"}');

  // ---------- 实例覆盖与导出 ----------
  console.log('\n[实例覆盖]');

  var overrideComponent = site.components.filter(function (item) { return item.id === 'comp-callout'; })[0];
  var overrideInstance = site.pages.filter(function (page) { return page.id === 'page-components'; })[0]
    .blocks.filter(function (block) { return block.id === 'comp-inst-overridden'; })[0];
  var mergedOverride = R.mergeInstanceOverrides(overrideComponent, overrideInstance.overrides);
  var htmlOverrides = { html: '<p class="x">{{title}}</p>', css: 'color:red;', js: 'var b=2;' };
  var mergedHtml = R.mergeInstanceOverrides(overrideComponent, htmlOverrides);
  check('HTML 覆盖是整段替换', mergedHtml.template === htmlOverrides.html &&
    mergedHtml.hasHtmlOverride === true);
  check('CSS 覆盖是追加', mergedOverride.css === overrideComponent.css &&
    mergedOverride.overrideCss === overrideInstance.overrides.css);
  check('JS 覆盖是追加', mergedOverride.js === overrideComponent.js &&
    mergedOverride.overrideJs === overrideInstance.overrides.js);
  check('合并说明清晰', mergedOverride.merge.html === 'replace' &&
    mergedOverride.merge.css === 'append' && mergedOverride.merge.js === 'append');
  check('覆盖实例带标记', compHtml.indexOf('data-lc-instance="comp-inst-overridden"') !== -1 &&
    compHtml.indexOf('data-lc-overridden="true"') !== -1);
  check('未覆盖实例保持默认', compHtml.indexOf('data-lc-instance="comp-inst-default"') !== -1 &&
    compHtml.indexOf('data-lc-instance="comp-inst-default" data-lc-overridden') === -1);
  check('覆盖 CSS 只作用于该实例', compPage.css.indexOf('[data-lc-instance="comp-inst-overridden"] .demo-callout') !== -1 &&
    compPage.css.indexOf('[data-lc-instance="comp-inst-default"]') === -1);
  check('覆盖 JS 进入实例脚本', compPage.scripts.some(function (item) {
    return item.blockId === 'comp-inst-overridden' && item.source.indexOf('JS 覆盖生效') !== -1;
  }));
  check('未覆盖实例不携带覆盖脚本', compPage.scripts.some(function (item) {
    return item.blockId === 'comp-inst-default' && item.source.indexOf('JS 覆盖生效') === -1;
  }));
  check('每个实例脚本独立作用域', compPage.scripts.every(function (item) {
    var wrapped = R.blockScript(item);
    return wrapped.indexOf('"use strict"') !== -1 &&
      wrapped.indexOf('document.querySelector') !== -1 &&
      wrapped.indexOf('var root') !== -1;
  }));

  var bareScoped = R.scopeInstanceCss('color: red;\n.a { color: blue; }\n@import url(x.css);', 'inst-x');
  check('裸声明也收进实例作用域', bareScoped.indexOf('[data-lc-instance="inst-x"] {') !== -1 &&
    bareScoped.indexOf('color: red;') !== -1);
  check('实例 CSS 规则加作用域', bareScoped.indexOf('[data-lc-instance="inst-x"] .a') !== -1);
  check('实例 CSS 丢弃 @import', bareScoped.indexOf('@import') === -1);

  var badCss = R.validateOverrideSource({ css: '.x { color: red;' });
  check('CSS 语法错误带行列', badCss.ok === false && badCss.errors[0].field === 'css' &&
    badCss.errors[0].line === 1 && badCss.errors[0].column > 0,
    JSON.stringify(badCss.errors[0]));
  var badJs = R.validateOverrideSource({ js: 'function {' });
  var badHtml = R.validateOverrideSource({ html: '<div><span></div>' });
  check('JS 与 HTML 语法错误都能报出', badJs.ok === false && badHtml.ok === false &&
    badJs.errors.length === 1 && badHtml.errors.length === 1);

  var resetData = R.resetInstanceOverrides(overrideInstance);
  check('重置移除 overrides', !Object.prototype.hasOwnProperty.call(resetData, 'overrides') &&
    resetData.id === 'comp-inst-overridden');
  var savedData = R.saveAsComponent(overrideComponent, overrideInstance.overrides,
    { id: 'comp-callout-custom', name: '提示条（自定义）' });
  check('另存输出干净组件', savedData.id === 'comp-callout-custom' &&
    !Object.prototype.hasOwnProperty.call(savedData, 'overrides') &&
    savedData.css.indexOf('border-style: dashed') !== -1 &&
    savedData.css.length > overrideComponent.css.length);
  check('另存模板取覆盖后的 HTML', savedData.template === overrideComponent.template);

  var compact = R.createExportBundle(compPage, { minify: true });
  var plainBundle = R.createExportBundle(compPage, { minify: false });
  var fileNames = compact.files.map(function (file) { return file.name; });
  check('导出文件齐全', ['index.html', 'styles.css', 'runtime.js', 'README.txt'].every(function (name) {
    return fileNames.indexOf(name) !== -1;
  }) && compact.html.length > 0 && compact.css.length > 0 && compact.js.length > 0);
  check('默认压缩更小', compact.stats.after < plainBundle.stats.after,
    JSON.stringify({ min: compact.stats.after, pretty: plainBundle.stats.after }));
  check('压缩产物无 HTML 注释', compact.html.indexOf('<!--') === -1 && compact.css.indexOf('/*') === -1);
  check('压缩产物不泄露编辑器字段', compact.html.indexOf('data-lc-override-fields') === -1 &&
    compact.html.indexOf('data-lc-instance') !== -1);
  check('压缩保留实例标记', compact.html.indexOf('data-lc-instance="comp-inst-overridden"') !== -1);
  check('代码缩进不被 HTML 压缩破坏', compact.html.indexOf('lc-ui-code-line') !== -1 &&
    compact.html.indexOf('  merged.validation.errors.forEach') !== -1);
  check('JS 压缩保留换行避免 ASI 变化', R.minifyJs('var a = 1;\nvar b = 2;').indexOf('\n') !== -1);

  // ---------- 内置组件的单实例覆盖 ----------
  console.log('\n[内置组件实例覆盖]');

  var builtinOverridePageData = {
    id: 'page-inst-builtin',
    title: '内置组件实例覆盖',
    layout: 'flow',
    blocks: [
      {
        id: 'ui-slider-over', type: 'ui-slider',
        label: '已覆盖滑块', min: 0, max: 100, step: 1, value: 30,
        overrides: {
          html: '<div class="demo-inst-slider">{{label}}</div>',
          css: '.demo-inst-slider { color: #b3261e; }',
          js: 'window.__lcInstOverride = true;'
        }
      },
      { id: 'ui-slider-plain', type: 'ui-slider', label: '默认滑块', min: 0, max: 100, step: 1, value: 20 }
    ]
  };
  var builtinOverridePage = renderer.render(builtinOverridePageData, { themeId: 'ink-green', mode: 'light', preview: true });
  var builtinOverrideHtml = R.toHtml(builtinOverridePage.node);
  check('内置组件实例覆盖无渲染错误', builtinOverridePage.report.errors().length === 0,
    R.reportToText(builtinOverridePage.report));
  check('内置实例覆盖标记只落在被覆盖实例',
    builtinOverrideHtml.indexOf('data-lc-instance="ui-slider-over"') !== -1 &&
    builtinOverrideHtml.indexOf('data-lc-instance="ui-slider-plain"') === -1 &&
    (builtinOverrideHtml.match(/data-lc-overridden="true"/g) || []).length === 1,
    String((builtinOverrideHtml.match(/data-lc-overridden="true"/g) || []).length));
  check('内置实例 HTML 覆盖生效且不影响同类型其它实例',
    builtinOverrideHtml.indexOf('demo-inst-slider') !== -1 &&
    builtinOverrideHtml.indexOf('已覆盖滑块') !== -1 &&
    (builtinOverrideHtml.match(/lc-ui-slider-head/g) || []).length === 1,
    String((builtinOverrideHtml.match(/lc-ui-slider-head/g) || []).length));
  check('内置实例 CSS 只作用于该实例',
    builtinOverridePage.css.indexOf('[data-lc-instance="ui-slider-over"] .demo-inst-slider') !== -1 &&
    builtinOverridePage.css.indexOf('[data-lc-instance="ui-slider-plain"]') === -1);
  check('内置实例 JS 进入实例脚本且独立作用域',
    builtinOverridePage.scripts.some(function (item) {
      return item.blockId === 'ui-slider-over' && item.source.indexOf('__lcInstOverride') !== -1;
    }) &&
    builtinOverridePage.scripts.every(function (item) {
      return !item.global || item.source.indexOf('__lcInstOverride') === -1;
    }));
  check('未覆盖的内置实例保持默认结构与默认样式',
    builtinOverrideHtml.indexOf('data-lc-block="ui-slider-plain"') !== -1 &&
    builtinOverrideHtml.indexOf('lc-ui-slider-track') !== -1 &&
    builtinOverridePage.css.indexOf('.lc-ui-slider-value') !== -1);
  var builtinReset = R.resetInstanceOverrides(builtinOverridePageData.blocks[0]);
  check('内置实例重置移除 overrides', !Object.prototype.hasOwnProperty.call(builtinReset, 'overrides') &&
    builtinReset.id === 'ui-slider-over');
  var builtinBundle = R.createExportBundle(builtinOverridePage, { minify: false });
  check('内置实例覆盖随导出保留',
    builtinBundle.html.indexOf('data-lc-instance="ui-slider-over"') !== -1 &&
    builtinBundle.html.indexOf('data-lc-overridden="true"') !== -1 &&
    builtinBundle.css.indexOf('[data-lc-instance="ui-slider-over"] .demo-inst-slider') !== -1);
  check('内置组件浏览器包进入导出脚本',
    builtinBundle.js.indexOf('R.enhanceBuiltins') !== -1 &&
    builtinBundle.js.indexOf('components/slider.js') !== -1);

  // ---------- 日期 / 滑块 / 自动补全 / 常用控件 ----------
  console.log('\n[日期与滑块]');

  var dateHelpers = R.componentDefs['ui-date'].helpers;
  var correctedPair = dateHelpers.correctRange('2026-11-20', '2026-11-05');
  check('日期范围自动纠正', correctedPair.corrected === true &&
    correctedPair.start === '2026-11-05' && correctedPair.end === '2026-11-20',
    JSON.stringify(correctedPair));
  check('日期非法值不纠正', dateHelpers.correctRange('2026-02-30', '2026-11-05').corrected === false);
  check('日期格式提示为人话', /YYYY-MM-DD/.test(dateHelpers.dateError('2026-02-30', {}) || ''),
    String(dateHelpers.dateError('2026-02-30', {})));
  check('日期最小边界提示', !!dateHelpers.dateError('2026-11-01', { min: '2026-11-05' }));

  var datePage = renderer.render('page-date', { themeId: 'ink-green', mode: 'light', preview: true });
  var dateHtml = R.toHtml(datePage.node);
  check('日期页无渲染错误', datePage.report.errors().length === 0, R.reportToText(datePage.report));
  check('日期页含单日期与范围', dateHtml.indexOf('data-mode="single"') !== -1 && dateHtml.indexOf('data-mode="range"') !== -1);
  check('日期页含快捷项与禁用日期', dateHtml.indexOf('data-lc-date-shortcut="today"') !== -1 &&
    dateHtml.indexOf('data-disabled-dates="2026-11-15,2026-11-16"') !== -1);
  check('日期页错误态有人话提示', dateHtml.indexOf('请按 YYYY-MM-DD') !== -1);

  var sliderHelpers = R.componentDefs['ui-slider'].helpers;
  check('滑块双值不交叉', JSON.stringify(sliderHelpers.normalizeValue([80, 20], true, 0, 100)) === '[20,80]',
    JSON.stringify(sliderHelpers.normalizeValue([80, 20], true, 0, 100)));
  check('滑块值夹在边界内', sliderHelpers.normalizeValue(120, false, 0, 100) === 100);
  check('滑块百分比格式化', sliderHelpers.formatValue(40, { percent: true }) === '40%');
  check('滑块自定义格式化', sliderHelpers.formatValue(30, { format: function (value) { return value + ' 分'; } }) === '30 分');
  check('滑块位置百分比', sliderHelpers.percentOf(50, 0, 100) === 50);

  var sliderPage = renderer.render('page-slider', { themeId: 'ink-green', mode: 'light', preview: true });
  var sliderHtml = R.toHtml(sliderPage.node);
  check('滑块页无渲染错误', sliderPage.report.errors().length === 0, R.reportToText(sliderPage.report));
  check('滑块页含单值与双值', sliderHtml.indexOf('data-range="true"') !== -1 && sliderHtml.indexOf('data-range="false"') !== -1);
  check('滑块页含刻度与百分比', sliderHtml.indexOf('lc-ui-slider-mark') !== -1 && sliderHtml.indexOf('data-percent="true"') !== -1);

  var sliderSourcePage = renderer.render({
    id: 'page-slider-source',
    title: '滑块数据源',
    layout: 'flow',
    blocks: [
      {
        id: 'sl-range', type: 'ui-slider', label: '区间取值',
        datasource: 'demo-range', sourceMode: 'range', value: 40,
        sourceErrorText: '区间源失败', sourceUnconfiguredText: '区间源未注册'
      },
      {
        id: 'sl-stops', type: 'ui-slider', label: '档位取值',
        datasource: 'demo-stops', sourceMode: 'stops', value: 20,
        sourceEmptyText: '档位源为空'
      }
    ]
  }, { themeId: 'ink-green', mode: 'light', preview: true });
  var sliderSourceHtml = R.toHtml(sliderSourcePage.node);
  check('滑块数据源无渲染错误', sliderSourcePage.report.errors().length === 0,
    R.reportToText(sliderSourcePage.report));
  check('滑块区间取值模式写入渲染属性',
    sliderSourceHtml.indexOf('data-datasource="demo-range"') !== -1 &&
    sliderSourceHtml.indexOf('data-source-mode="range"') !== -1 &&
    sliderSourceHtml.indexOf('data-source-error-text="区间源失败"') !== -1 &&
    sliderSourceHtml.indexOf('data-source-unconfigured-text="区间源未注册"') !== -1);
  check('滑块档位取值模式写入渲染属性',
    sliderSourceHtml.indexOf('data-datasource="demo-stops"') !== -1 &&
    sliderSourceHtml.indexOf('data-source-mode="stops"') !== -1 &&
    sliderSourceHtml.indexOf('data-source-empty-text="档位源为空"') !== -1);
  check('滑块带数据源提示节点', sliderSourceHtml.indexOf('data-lc-slider-source-note="true"') !== -1);
  check('滑块 marks 容器始终存在且空时隐藏',
    /data-lc-slider-marks="true"[^>]* hidden="hidden"/.test(sliderSourceHtml));
  check('滑块数据源进入 JSON 岛',
    sliderSourceHtml.indexOf('"datasource":"demo-range"') !== -1 &&
    sliderSourceHtml.indexOf('"sourceMode":"stops"') !== -1);
  check('滑块页按需注入内置组件浏览器包', sliderPage.scripts.some(function (item) {
    return item.global === true && item.source.indexOf('components/slider.js') !== -1 &&
      item.source.indexOf('R.enhanceBuiltins') !== -1;
  }), sliderPage.scripts.map(function (item) { return item.global ? 'global' : item.blockId; }).join(','));
  check('没有滑块的页面不注入滑块运行时',
    home.scripts.every(function (item) { return !item.source || item.source.indexOf('components/slider.js') === -1; }));
  check('内置组件浏览器包在脚本列表最前', R.scriptsHtml(sliderPage.scripts, '').indexOf('R.enhanceBuiltins') !== -1 &&
    sliderPage.scripts[0] && sliderPage.scripts[0].global === true);

  console.log('\n[自动补全]');

  R.registerDataSource('demo-people', {
    search: function (query) {
      return Promise.resolve([{ label: '张' + (query || ''), value: 'zhang' }]);
    }
  });
  var acHelpers = R.componentDefs['ui-autocomplete'].helpers;
  var acOptions = acHelpers.normalizeOptions([
    { label: '北京', value: 'bj' },
    { label: '上海', value: 'sh' },
    '广州'
  ], { labelField: 'label', valueField: 'value' });
  check('自动补全选项归一化', acOptions.length === 3 && acOptions[2].value === '广州',
    JSON.stringify(acOptions));
  check('自动补全本地过滤', acHelpers.filterOptions(acOptions, '北').length === 1);
  check('自动补全多选值归一化', JSON.stringify(acHelpers.asSelected(['bj', 'sh'], true)) === '["bj","sh"]');

  var acPage = renderer.render('page-autocomplete', { themeId: 'ink-green', mode: 'light', preview: true });
  var acHtml = R.toHtml(acPage.node);
  check('自动补全页无渲染错误', acPage.report.errors().length === 0, R.reportToText(acPage.report));
  check('自动补全远程模式成立', acHtml.indexOf('data-mode="remote"') !== -1 &&
    acHtml.indexOf('data-datasource="demo-people"') !== -1);
  check('自动补全未注册退回静态选项', acHtml.indexOf('data-mode="local-fallback"') !== -1 &&
    acHtml.indexOf('data-unconfigured="true"') !== -1);
  check('自动补全缺配置有明确提示', acHtml.indexOf('数据源「missing-people」未注册') !== -1 ||
    acHtml.indexOf('尚未配置数据源') !== -1);

  console.log('\n[常用表单控件]');

  var controlTypes = ['ui-select', 'ui-multiselect', 'ui-radio-group', 'ui-checkbox-group',
    'ui-switch', 'ui-number', 'ui-textarea', 'ui-tags', 'ui-cascader', 'ui-rating'];
  check('常用控件都有 schema 与事件', controlTypes.every(function (type) {
    var schema = R.componentSchema(type);
    return !!schema && !!schema.props.error && !!schema.props.state &&
      Array.isArray(schema.events) && schema.events.indexOf('lc:field-change') !== -1;
  }), controlTypes.filter(function (type) { return !R.componentSchema(type); }).join(','));
  check('每类常用控件可单独注册', controlTypes.every(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    return !!single.block(type);
  }));

  var ctlHelpers = R.componentDefs['ui-select'].helpers;
  check('控件必填校验', !!ctlHelpers.numError('', { required: true }));
  check('控件数值范围校验', !!ctlHelpers.numError('11', { max: 10 }) && !ctlHelpers.numError('5', { max: 10 }));
  check('控件文本长度校验', !!ctlHelpers.textError('ab', { minLength: 3 }) && !ctlHelpers.textError('abc', { minLength: 3 }));
  check('控件选择数量校验', !!ctlHelpers.choiceError([], { required: true }) &&
    !!ctlHelpers.choiceError(['a', 'b'], { maxSelected: 1 }));
  check('控件标签数量校验', !!ctlHelpers.tagsError(['a'], { maxTags: 1 }) === false &&
    !!ctlHelpers.tagsError(['a', 'b'], { maxTags: 1 }));
  var cascadeOptions = ctlHelpers.normalizeCascade([
    { label: '浙江', value: 'zj', children: [{ label: '杭州', value: 'hz' }] },
    { label: '坏数据' }
  ]);
  check('级联选项过滤非法项', cascadeOptions.length === 1 && cascadeOptions[0].children.length === 1);
  check('级联层级展开', ctlHelpers.cascadeLevels(cascadeOptions, ['zj', 'hz'], []).length >= 2);

  var ctlPage = renderer.render('page-controls', { themeId: 'ink-green', mode: 'light', preview: true });
  var ctlHtml = R.toHtml(ctlPage.node);
  check('常用控件页无渲染错误', ctlPage.report.errors().length === 0, R.reportToText(ctlPage.report));
  check('常用控件页覆盖十类', controlTypes.every(function (type) {
    return ctlHtml.indexOf('data-lc-ui="' + type + '"') !== -1;
  }), controlTypes.filter(function (type) {
    return ctlHtml.indexOf('data-lc-ui="' + type + '"') === -1;
  }).join(','));
  check('无选项时降级为空态', ctlHtml.indexOf('data-lc-state="empty"') !== -1 &&
    ctlHtml.indexOf('暂无可选项') !== -1);
  check('控件错误提示在控件下方', ctlHtml.indexOf('role="alert"') !== -1 &&
    ctlHtml.indexOf('lc-ui-field-error') !== -1);

  console.log('\n[图表与统计]');

  var chartTypes = ['ui-chart-line', 'ui-chart-bar', 'ui-chart-pie', 'ui-chart-donut', 'ui-sparkline'];
  var statTypes = ['ui-kpi', 'ui-progress', 'ui-progress-ring'];
  check('图表与统计组件可单独注册', chartTypes.concat(statTypes).every(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    return !!single.block(type);
  }));
  check('图表与统计都有 schema 与空态', chartTypes.concat(statTypes).every(function (type) {
    var schema = R.componentSchema(type);
    return !!schema && schema.states.indexOf('empty') !== -1 && !!schema.props.datasource;
  }));

  var chartHelpers = R.componentDefs['ui-chart-line'].helpers;
  var domainPositive = chartHelpers.valueDomain({ series: [{ values: [10, 20] }] });
  var domainNegative = chartHelpers.valueDomain({ series: [{ values: [-20, -10] }] });
  var domainMixed = chartHelpers.valueDomain({ series: [{ values: [-20, 30] }] });
  check('图表值域：全正从 0 起', domainPositive.min === 0 && domainPositive.max === 20);
  check('图表值域：全负到 0 止', domainNegative.min === -20 && domainNegative.max === 0);
  check('图表值域：正负都包含 0', domainMixed.min === -20 && domainMixed.max === 30);
  check('图表刻度覆盖数据范围', (function () {
    var ticks = chartHelpers.niceTicks(-60, 210, 4);
    return ticks.min <= -60 && ticks.max >= 210 && ticks.ticks.length <= 24;
  })());
  check('折线路径使用贝塞尔平滑', chartHelpers.smoothPath([
    { x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 5 }
  ]).indexOf(' C') !== -1);
  check('单点路径不抛错', chartHelpers.smoothPath([{ x: 0, y: 0 }]) === 'M0 0');

  var barRects = chartHelpers.barRects(
    { labels: ['a', 'b'], series: [{ values: [-10, 20] }] },
    { left: 0, top: 0, innerW: 100, innerH: 100, ticks: { min: -10, max: 20 } }
  );
  check('柱状图负值向下生长', barRects.length === 2 && barRects[0].y > barRects[1].y &&
    barRects[0].height > 0 && barRects[1].height > 0);

  var slices = chartHelpers.pieSlices({
    labels: ['负', '零', '小', '大'],
    series: [{ values: [-5, 0, 10, 20] }]
  });
  check('饼图忽略非正数', slices.items.length === 2 && slices.total === 30);
  check('图表坐标轴极大值压缩', chartHelpers.formatAxisNumber(120000000) === '1.2亿' &&
    chartHelpers.formatAxisNumber(98000000) === '9800万');

  var kpiHelpers = R.componentDefs['ui-kpi'].helpers;
  check('KPI 大数压缩', kpiHelpers.formatMetric(1284000, { compact: true, decimals: 1 }) === '128.4万');
  check('进度百分比夹取', kpiHelpers.percentOf(-20, 100) === 0 && kpiHelpers.percentOf(150, 100) === 100);
  check('KPI 趋势与正负向', kpiHelpers.kpiTone({ trend: 'auto', comparison: -3, positiveIsGood: true }).tone === 'bad' &&
    kpiHelpers.kpiTone({ trend: 'auto', comparison: -3, positiveIsGood: false }).tone === 'good' &&
    kpiHelpers.kpiTone({ trend: 'auto', comparison: 0 }).tone === 'flat');

  /* 注册只读的演示数据源，用于验证「已注册 → SSR 加载态」「未注册 → 空态」。 */
  R.registerDataSource('demo-traffic', {
    load: function () {
      return Promise.resolve({
        labels: ['a', 'b'],
        series: [{ name: '访问量', values: [1, 2] }]
      });
    }
  });
  R.registerDataSource('demo-empty-chart', { load: function () { return Promise.resolve([]); } });
  R.registerDataSource('demo-fail-chart', { load: function () { return Promise.reject(new Error('演示错误')); } });
  R.registerDataSource('demo-kpi', { load: function () { return Promise.resolve({ value: 128.4, comparison: 12.6 }); } });
  R.registerDataSource('demo-progress', { load: function () { return Promise.resolve({ value: 72, max: 100 }); } });

  var chartPage = renderer.render('page-charts', { themeId: 'ink-green', mode: 'light', preview: true });
  var chartHtml = R.toHtml(chartPage.node);
  check('图表页无渲染错误', chartPage.report.errors().length === 0, R.reportToText(chartPage.report));
  check('图表页覆盖四类图表', ['ui-chart-line', 'ui-chart-bar', 'ui-chart-pie', 'ui-chart-donut'].every(function (type) {
    return chartHtml.indexOf('data-lc-ui="' + type + '"') !== -1;
  }));
  check('图表容器有 role=img 与 aria-label', chartHtml.indexOf('role="img"') !== -1 &&
    /aria-label="[^"]*折线图/.test(chartHtml));
  check('图表附可展开数据表', chartHtml.indexOf('<details') !== -1 &&
    chartHtml.indexOf('lc-ui-chart-table') !== -1);
  check('未注册数据源进入空态并说明', chartHtml.indexOf('data-lc-state="empty"') !== -1 &&
    chartHtml.indexOf('数据源「missing-chart」未注册') !== -1);
  check('已注册数据源 SSR 为加载态', /data-lc-state="loading"[^>]*data-datasource="demo-traffic"/.test(chartHtml) ||
    /data-datasource="demo-traffic"[^>]*data-lc-state="loading"/.test(chartHtml));
  check('已注册数据源标记绑定成功', /data-source-bound="true"[^>]*data-datasource="demo-traffic"/.test(chartHtml) ||
    /data-datasource="demo-traffic"[^>]*data-source-bound="true"/.test(chartHtml));
  check('饼图全非正数进入空态', chartHtml.indexOf('没有可用于饼图的正数数据') !== -1);
  check('柱状图含零线', chartHtml.indexOf('lc-ui-chart-zero') !== -1);
  check('极大值坐标轴已压缩', chartHtml.indexOf('5000万') !== -1 || chartHtml.indexOf('1亿') !== -1);
  check('数据表格列宽可配', chartHtml.indexOf('width:34%') !== -1 || chartHtml.indexOf('width: 34%') !== -1);
  check('空表格显示空态', chartHtml.indexOf('暂无渠道数据') !== -1);

  var statsPage = renderer.render('page-stats', { themeId: 'ink-green', mode: 'light', preview: true });
  var statsHtml = R.toHtml(statsPage.node);
  check('统计页无渲染错误', statsPage.report.errors().length === 0, R.reportToText(statsPage.report));
  check('统计页覆盖 KPI/进度/环形/迷你走势', statTypes.concat(['ui-sparkline']).every(function (type) {
    return statsHtml.indexOf('data-lc-ui="' + type + '"') !== -1;
  }));
  check('KPI 显示压缩数值与趋势', statsHtml.indexOf('128.4万') !== -1 &&
    statsHtml.indexOf('+12.6%') !== -1 && statsHtml.indexOf('is-good') !== -1);
  check('KPI 下降为负向色', statsHtml.indexOf('is-bad') !== -1);
  check('进度条有 progressbar 语义', statsHtml.indexOf('role="progressbar"') !== -1 &&
    statsHtml.indexOf('aria-valuenow="64"') !== -1);
  check('进度负数与超限被夹取', statsHtml.indexOf('aria-valuenow="0"') !== -1 &&
    statsHtml.indexOf('aria-valuenow="100"') !== -1);
  check('不确定进度不谎报数值', statsHtml.indexOf('aria-busy="true"') !== -1);
  check('环形进度绘制描边弧', statsHtml.indexOf('lc-ui-ring-bar') !== -1 &&
    statsHtml.indexOf('stroke-dashoffset') !== -1);
  check('迷你走势图有 aria 摘要与趋势色', statsHtml.indexOf('ui-sparkline') !== -1 &&
    statsHtml.indexOf('is-good') !== -1 && statsHtml.indexOf('is-bad') !== -1);
  check('统计远程组件 SSR 为加载态', /data-lc-ui="ui-kpi"[^>]*data-lc-state="loading"/.test(statsHtml) ||
    /data-lc-state="loading"[^>]*data-lc-ui="ui-kpi"/.test(statsHtml));

  // ---------- 站点外壳 ----------
  console.log('\n[站点外壳]');

  var shellTypes = ['ui-site-nav', 'ui-site-footer', 'ui-sidebar', 'ui-breadcrumb', 'ui-page-header'];
  check('外壳组件五类齐全', shellTypes.every(function (type) { return !!R.componentDefs[type]; }),
    shellTypes.filter(function (type) { return !R.componentDefs[type]; }).join(','));
  check('外壳组件都有 schema 字段', shellTypes.every(function (type) {
    var schema = R.componentSchema(type);
    return !!schema && !!schema.props && Object.keys(schema.props).length > 0;
  }));
  check('外壳组件可单独注册', shellTypes.every(function (type) {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, type);
    return !!single.block(type);
  }));

  var navHelpers = R.componentDefs['ui-site-nav'].helpers;
  check('路径归一化去掉查询与 index', navHelpers.normalizePath('./docs/index.html?x=1') === 'docs/',
    navHelpers.normalizePath('./docs/index.html?x=1'));
  check('外链判定支持协议与显式标记', navHelpers.isExternal({ href: 'https://x.test' }) === true &&
    navHelpers.isExternal({ href: '//cdn.test' }) === true &&
    navHelpers.isExternal({ href: 'a.html' }) === false &&
    navHelpers.isExternal({ href: 'a.html', external: true }) === true &&
    navHelpers.isExternal({ href: 'https://x.test', external: false }) === false);
  check('当前页按 pageId 命中', navHelpers.pageMatches({ pageId: 'page-shell' }, { page: { id: 'page-shell' } }) === true);
  check('当前页按路径命中', navHelpers.pageMatches({ href: 'shell.html' }, { page: { path: 'shell.html' } }) === true);

  var shellPage = renderer.render('page-shell', { themeId: 'ink-green', mode: 'light', preview: true });
  var shellHtml = R.toHtml(shellPage.node);
  check('外壳页无渲染错误', shellPage.report.errors().length === 0, R.reportToText(shellPage.report));
  check('外壳页覆盖五类组件', shellTypes.every(function (type) {
    return shellHtml.indexOf('data-lc-ui="' + type + '"') !== -1;
  }), shellTypes.filter(function (type) {
    return shellHtml.indexOf('data-lc-ui="' + type + '"') === -1;
  }).join(','));
  check('导航当前页高亮带 aria-current', /class="lc-shell-link is-active"[^>]*aria-current="page"/.test(shellHtml));
  check('外链自动新窗口打开', shellHtml.indexOf('target="_blank"') !== -1 &&
    shellHtml.indexOf('rel="noopener noreferrer"') !== -1);
  check('外链带读屏提示', shellHtml.indexOf('（新窗口打开）') !== -1);
  check('多级菜单展开到二级', shellHtml.indexOf('lc-shell-level-2') !== -1 &&
    shellHtml.indexOf('lc-shell-level-3') !== -1);
  check('移动端展开为纯 CSS', shellHtml.indexOf('lc-shell-nav-check') !== -1 &&
    shellPage.css.indexOf(':checked ~ .lc-shell-nav-panel') !== -1);
  check('移动端开关有可读名称', /aria-label="展开导航"/.test(shellHtml));
  check('外壳 CSS 只注入一次', shellPage.css.split('/* lc-ui-shell */').length - 1 === 1,
    String(shellPage.css.split('/* lc-ui-shell */').length - 1));
  check('多级菜单支持悬停与键盘聚焦', shellPage.css.indexOf(':hover > .lc-shell-list') !== -1 &&
    shellPage.css.indexOf(':focus-within > .lc-shell-list') !== -1);
  check('面包屑自动生成且末项为当前页', /aria-current="page">站点外壳</.test(shellHtml) &&
    shellHtml.indexOf('lc-shell-breadcrumb-list') !== -1);
  check('页脚多列与版权齐全', shellHtml.indexOf('lc-shell-footer-col') !== -1 &&
    shellHtml.indexOf('lc-shell-footer-copy') !== -1 && shellHtml.indexOf('© 2026 示例品牌') !== -1);
  check('页面标题区含眉题与操作', shellHtml.indexOf('lc-shell-page-eyebrow') !== -1 &&
    shellHtml.indexOf('lc-shell-page-action is-primary') !== -1);

  var shellStateHtml = R.toHtml((function () {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, 'ui-site-nav');
    return R.createRenderer(minimalSite, { registry: single })
      .render({ id: 'p', blocks: [{ id: 'b', type: 'ui-site-nav', state: 'error', errorTitle: '导航加载失败' }] },
        { themeId: 'a', mode: 'light' }).node;
  }()));
  check('外壳组件支持统一错误态', shellStateHtml.indexOf('data-lc-state="error"') !== -1 &&
    shellStateHtml.indexOf('导航加载失败') !== -1);

  // ---------- 模板骨架 ----------
  console.log('\n[模板骨架]');

  var starters = R.loadModule('./templates/starters.js');
  var starterList = starters.templates;
  check('模板共四套', starterList.length === 4, String(starterList.length));
  check('模板 ID 唯一且齐全', (function () {
    var ids = starterList.map(function (item) { return item.id; });
    var unique = ids.filter(function (id, index) { return ids.indexOf(id) === index; });
    return unique.length === ids.length && ['doc-site', 'portfolio', 'dashboard', 'auth'].every(function (id) {
      return ids.indexOf(id) !== -1;
    });
  }()), starters.starterTemplateIds().join(','));
  check('每套都有默认页面与外壳数据', starterList.every(function (tpl) {
    return Array.isArray(tpl.pages) && tpl.pages.length > 0 &&
      Array.isArray(tpl.shellBlocks) && !!tpl.project;
  }));

  function collectBlockTypes(blocks, out) {
    (blocks || []).forEach(function (block) {
      if (!block || !block.type) return;
      out.push(block.type);
      collectBlockTypes(block.blocks, out);
    });
    return out;
  }

  /* 引擎自带的容器与组件实例类型不在注册表里，模板允许使用。 */
  var ENGINE_TYPES = ['container', 'component'];
  function templateTypeExists(type) {
    return ENGINE_TYPES.indexOf(type) !== -1 || !!registry.block(type);
  }

  check('模板只使用现有组件', starterList.every(function (tpl) {
    var used = [];
    (tpl.pages || []).forEach(function (page) { collectBlockTypes(page.blocks, used); });
    (tpl.shellBlocks || []).forEach(function (block) { collectBlockTypes([block], used); });
    return used.every(templateTypeExists);
  }), (function () {
    var missing = [];
    starterList.forEach(function (tpl) {
      var used = [];
      (tpl.pages || []).forEach(function (page) { collectBlockTypes(page.blocks, used); });
      (tpl.shellBlocks || []).forEach(function (block) { collectBlockTypes([block], used); });
      used.forEach(function (type) {
        if (!templateTypeExists(type) && missing.indexOf(type) === -1) missing.push(type);
      });
    });
    return missing.join(',');
  }()));

  function renderTemplate(tpl, pageId) {
    var data = {
      project: tpl.project,
      themes: site.themes,
      pages: tpl.pages,
      shellBlocks: tpl.shellBlocks,
      articles: tpl.articles || [],
      components: []
    };
    return R.createRenderer(data, { registry: registry })
      .render(pageId || tpl.pages[0].id, { themeId: 'ink-green', mode: 'light', preview: true });
  }

  check('四套模板默认页都能渲染', starterList.every(function (tpl) {
    try {
      var result = renderTemplate(tpl);
      return result.report.errors().length === 0 && R.toHtml(result.node).length > 200;
    } catch (error) {
      return false;
    }
  }), starterList.filter(function (tpl) {
    try {
      return renderTemplate(tpl).report.errors().length > 0;
    } catch (error) { return true; }
  }).map(function (tpl) { return tpl.id; }).join(','));

  check('模板取用是深拷贝', (function () {
    var copy = starters.getStarterTemplate('doc-site');
    copy.pages[0].title = '改过的标题';
    return starters.getStarterTemplate('doc-site').pages[0].title === '文档首页' &&
      starters.getStarterTemplate('missing') === null;
  }()));

  var docTemplate = starters.getStarterTemplate('doc-site');
  check('文档模板含侧栏与文章配置', !!docTemplate.project.sidebar &&
    docTemplate.pages.every(function (page) { return !!page.article; }) &&
    docTemplate.articles.length === docTemplate.pages.length);
  var docResult = renderTemplate(docTemplate, 'tpl-doc-quickstart');
  var docHtml = R.toHtml(docResult.node);
  check('文档模板产出右侧目录与上下篇', docResult.report.errors().length === 0 &&
    docHtml.indexOf('lc-article-toc') !== -1 &&
    docHtml.indexOf('lc-article-nav-prev') !== -1 && docHtml.indexOf('lc-article-nav-next') !== -1);
  check('文档模板侧栏高亮当前页', /lc-shell-link is-active[^>]*aria-current="page"/.test(docHtml));
  check('文档模板面包屑自动生成', docHtml.indexOf('lc-shell-breadcrumb-list') !== -1);

  var portfolioTemplate = starters.getStarterTemplate('portfolio');
  var portfolioTypes = collectBlockTypes(portfolioTemplate.pages[0].blocks, []);
  check('作品集模板为英雄区 + 网格 + 联系区', portfolioTypes.indexOf('ui-page-header') !== -1 &&
    portfolioTypes.indexOf('container') !== -1 && portfolioTypes.indexOf('ui-form') !== -1);

  var dashTemplate = starters.getStarterTemplate('dashboard');
  var dashTypes = collectBlockTypes(dashTemplate.pages[0].blocks, []);
  check('仪表盘模板含 KPI/图表/表格/侧栏', dashTypes.indexOf('ui-kpi') !== -1 &&
    dashTypes.indexOf('ui-chart-line') !== -1 && dashTypes.indexOf('ui-table') !== -1 &&
    !!dashTemplate.project.sidebar);
  var dashResult = renderTemplate(dashTemplate);
  check('仪表盘默认页无渲染错误', dashResult.report.errors().length === 0, R.reportToText(dashResult.report));

  var authTemplate = starters.getStarterTemplate('auth');
  var authPage = authTemplate.pages[0];
  var authTypes = collectBlockTypes(authPage.blocks, []);
  check('认证模板为居中卡片 + 表单 + 错误区', authPage.layout.align === 'center' &&
    authPage.layout.maxWidth === '480px' && authTypes.indexOf('ui-form') !== -1 &&
    authTypes.indexOf('ui-state') !== -1 && authPage.shell.header === false);
  check('模板不含任何订单数据', JSON.stringify(starterList).indexOf('订单') === -1);


  // ---------- 性能与大数据 ----------
  console.log('\n[性能与大数据]');

  function countIn(text, pattern) {
    var found = text.match(pattern);
    return found ? found.length : 0;
  }

  var perfSite = R.loadModule('./samples/perf.data.js');
  var perfRenderer = R.createRenderer(perfSite, { registry: registry });
  var table1k = perfRenderer.render('page-perf-table-1k', { themeId: 'ink-green', mode: 'light' });
  var table10k = perfRenderer.render('page-perf-table-10k', { themeId: 'ink-green', mode: 'light' });
  var html1k = R.toHtml(table1k.node);
  var html10k = R.toHtml(table10k.node);
  check('1k 行表格无渲染错误', table1k.report.errors().length === 0, R.reportToText(table1k.report));
  check('1k 行表格只渲染可视区', countIn(html1k, /class="lc-ui-tr"/g) <= 30 &&
    html1k.indexOf('data-lc-virtual="true"') !== -1,
    String(countIn(html1k, /class="lc-ui-tr"/g)));
  check('10k 行表格只渲染可视区', countIn(html10k, /class="lc-ui-tr"/g) <= 30,
    String(countIn(html10k, /class="lc-ui-tr"/g)));
  check('10k 行填充行撑出完整滚动高度', html10k.indexOf('height:369112px') !== -1);
  check('虚拟表滚动容器有固定高度', html10k.indexOf('data-lc-table-scroll="true"') !== -1 &&
    html10k.indexOf('height:420px') !== -1);
  check('虚拟表行高写入固定值', html10k.indexOf('data-lc-row-height="37"') !== -1 &&
    html10k.indexOf('--lc-table-row-h:37px') !== -1);
  check('虚拟表带范围与跳转按钮', html10k.indexOf('data-lc-virtual-info') !== -1 &&
    html10k.indexOf('data-lc-jump-bottom') !== -1 && html10k.indexOf('data-lc-jump-top') !== -1);
  check('虚拟表行不带 tabindex，焦点留在滚动容器', html10k.indexOf('tabindex="-1"') === -1 &&
    html10k.indexOf('role="group"') !== -1 && html10k.indexOf('方向键移动活动行') !== -1);
  check('虚拟表活动行样式存在', table10k.css.indexOf('.lc-ui-tr.is-active') !== -1 &&
    table10k.css.indexOf('.lc-ui-table-scroll:focus-visible') !== -1);

  var tableHelpers2 = R.componentDefs['ui-table'].helpers;
  var rangeTop = tableHelpers2.windowRange(0, 420, 37, 10000, 6);
  var rangeBottom = tableHelpers2.windowRange(9999 * 37, 420, 37, 10000, 6);
  check('虚拟窗口从顶部开始', rangeTop.start === 0 && rangeTop.end === 24, JSON.stringify(rangeTop));
  check('虚拟窗口能精确到 10k 末尾', rangeBottom.end === 10000 && rangeBottom.start === 9976,
    JSON.stringify(rangeBottom));
  check('不足阈值不启用虚拟滚动', tableHelpers2.virtualConfig({}, 8, false).on === false);
  check('关闭虚拟滚动后全量渲染', (function () {
    var page = clone(perfSite.pages.filter(function (item) { return item.id === 'page-perf-table-10k'; })[0]);
    page.blocks.forEach(function (block) { if (block.type === 'ui-table') block.virtual = false; });
    var html = R.toHtml(perfRenderer.render(page, { themeId: 'ink-green', mode: 'light' }).node);
    return countIn(html, /class="lc-ui-tr"/g) === 10000;
  }()));

  var imgPage = perfRenderer.render('page-perf-images', { themeId: 'ink-green', mode: 'light' });
  var imgHtml = R.toHtml(imgPage.node);
  check('图片页无渲染错误', imgPage.report.errors().length === 0, R.reportToText(imgPage.report));
  check('图片页共 21 张图', countIn(imgHtml, /data-lc-ui="ui-image"/g) === 21,
    String(countIn(imgHtml, /data-lc-ui="ui-image"/g)));
  check('图片使用透明占位不请求真实地址', imgHtml.indexOf('data-lc-src="assets/photo.svg?i=1"') !== -1 &&
    imgHtml.indexOf('src="data:image/gif;base64,R0lGOD') !== -1);
  check('图片带宽高占位属性', imgHtml.indexOf('width="320"') !== -1 && imgHtml.indexOf('height="180"') !== -1 &&
    imgHtml.indexOf('aspect-ratio:16 / 9') !== -1);
  check('图片无脚本时退回原生图', imgHtml.indexOf('<noscript><img src="assets/photo.svg?i=1"') !== -1);
  check('图片失败占位含说明与重试', imgHtml.indexOf('data-lc-image-error="true"') !== -1 &&
    imgHtml.indexOf('这张示例图不存在') !== -1 && imgHtml.indexOf('data-lc-image-retry="true"') !== -1);
  check('未填地址进入空态', (function () {
    var single = R.createRegistry();
    R.registerBuiltinComponent(single, 'ui-image');
    var html = R.toHtml(R.createRenderer(minimalSite, { registry: single })
      .render({ id: 'p', blocks: [{ id: 'b', type: 'ui-image' }] }, { themeId: 'a', mode: 'light' }).node);
    return html.indexOf('data-lc-state="empty"') !== -1 && html.indexOf('未设置图片') !== -1;
  }()));

  var stressOn = perfRenderer.render('page-perf-stress', { themeId: 'ink-green', mode: 'light', defer: true });
  var stressOff = perfRenderer.render('page-perf-stress', { themeId: 'ink-green', mode: 'light', defer: false });
  var stressOnHtml = R.toHtml(stressOn.node);
  var stressOffHtml = R.toHtml(stressOff.node);
  check('500 区块页无渲染错误', stressOn.report.errors().length === 0, R.reportToText(stressOn.report));
  check('首屏后区块标记延迟渲染', countIn(stressOnHtml, /data-lc-defer="true"/g) === 488,
    String(countIn(stressOnHtml, /data-lc-defer="true"/g)));
  check('关闭延迟后不产生标记', stressOffHtml.indexOf('data-lc-defer=') === -1);
  check('延迟样式使用 content-visibility', stressOn.css.indexOf('content-visibility: auto') !== -1 &&
    stressOn.css.indexOf('contain-intrinsic-size: auto 320px') !== -1);
  check('文章页不启用延迟避免目录偏移', (function () {
    var html = R.toHtml(renderer.render('page-article', { themeId: 'ink-green', mode: 'light' }).node);
    return html.indexOf('data-lc-defer=') === -1;
  }()));

  var docBundle = R.createExportBundle(home, { minify: false });
  var imgBundle = R.createExportBundle(imgPage, { minify: false });
  var tableBundle = R.createExportBundle(table10k, { minify: false });
  var imgRuntime = R.buildRuntime(imgBundle.html, {});
  var tableRuntime = R.buildRuntime(tableBundle.html, {});
  check('纯文档运行时不带图片与表格模块', docBundle.runtime.modules.indexOf('media') === -1 &&
    docBundle.runtime.modules.indexOf('table') === -1, docBundle.runtime.modules.join(','));
  check('图片页按需加载 media 模块', imgBundle.runtime.modules.indexOf('media') !== -1 &&
    imgBundle.runtime.modules.indexOf('form') === -1, imgBundle.runtime.modules.join(','));
  check('表格页按需加载 table 模块', tableBundle.runtime.modules.indexOf('table') !== -1);
  check('运行时体积仍在 64KB 上限内', tableBundle.runtime.bytes <= tableBundle.runtime.maxBytes &&
    imgBundle.runtime.bytes <= imgBundle.runtime.maxBytes,
    tableBundle.runtime.bytes + '/' + imgBundle.runtime.bytes);
  check('图片运行时用 IntersectionObserver 且不 fetch', imgRuntime.code.indexOf('IntersectionObserver') !== -1 &&
    imgRuntime.code.indexOf('fetch(') === -1);
  check('图片运行时可在 file:// 下工作', imgRuntime.code.indexOf('http://') === -1 &&
    imgRuntime.code.indexOf('https://') === -1 && imgBundle.js.indexOf('type="module"') === -1);
  check('表格运行时包含虚拟滚动代码', tableRuntime.code.indexOf('lc-ui-virtual-pad') !== -1 &&
    tableRuntime.code.indexOf('data-lc-jump-bottom') !== -1);
  check('运行时重复注入有幂等守卫', imgRuntime.code.indexOf('__LC_RUNTIME__') !== -1);
  check('运行时活动行使用 aria-activedescendant', tableRuntime.code.indexOf('aria-activedescendant') !== -1 &&
    tableRuntime.code.indexOf('lc-ui-tr.is-active') !== -1);

  var dataFile = tableBundle.files.filter(function (file) { return file.type === 'data'; })[0];
  var dataPayload = null;
  try { dataPayload = dataFile ? JSON.parse(dataFile.content) : null; } catch (error) { dataPayload = null; }
  check('大数据岛改为外部文件', tableBundle.data && tableBundle.data.islands > 0 &&
    dataFile && dataFile.name.indexOf('data/') === 0 && dataFile.name.slice(-5) === '.json',
    dataFile ? dataFile.name : '无数据文件');
  check('外部数据按 key 还原', dataPayload && Object.keys(dataPayload).length === tableBundle.data.islands &&
    Array.isArray(dataPayload[Object.keys(dataPayload)[0]].rows) &&
    dataPayload[Object.keys(dataPayload)[0]].rows.length === 10000);
  check('外部化后 HTML 不再内联大 JSON', tableBundle.stats.htmlAfterBytes < 100 * 1024 &&
    tableBundle.html.indexOf('data-lc-src="data/') !== -1,
    tableBundle.stats.htmlAfterBytes + 'B');
  check('小数据岛继续内联', compact.data === null);
  check('数据文件体积接近原始数据岛', tableBundle.data.rawBytes > 500 * 1024 &&
    tableBundle.data.bytes >= tableBundle.data.rawBytes, tableBundle.data.rawBytes + '/' + tableBundle.data.bytes);
  check('导出产物说明 HTTP 与 Tauri', (function () {
    var readme = compact.files.filter(function (file) { return file.name === 'README.txt'; })[0];
    return readme && readme.content.indexOf('HTTP') !== -1 && readme.content.indexOf('Tauri') !== -1 &&
      compact.html.indexOf('data-lc-transport-notice') !== -1;
  }()));
  check('外部数据运行时带加载与重试', tableRuntime.code.indexOf('loadIsland') !== -1 &&
    tableRuntime.code.indexOf('data-lc-table-load-error') !== -1 &&
    tableRuntime.code.indexOf('data-lc-table-retry') !== -1 &&
    tableRuntime.code.indexOf('Tauri') !== -1);


  // ---------- 内置组件与基础区块默认内容 ----------
  console.log('\n[组件默认内容]');
  var baseBlocks = await import('../../../server/src/export/base-blocks.js');
  var defaultsMap = R.componentDefaults || {};
  var blockDefaultsMap = R.blockDefaults || {};
  var componentTypes = R.componentTypes();
  var placeholderPhrases = ['按需改写', '自定义副本', '示例文本', 'lorem ipsum', 'Lorem ipsum', '在此输入'];

  function valueKind(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }

  function defaultProblems(schema, props) {
    var problems = [];
    Object.keys(props).forEach(function (key) {
      var prop = schema.props && schema.props[key];
      if (!prop) { problems.push('未知字段 ' + key); return; }
      var declared = String(prop.type || '');
      var actual = valueKind(props[key]);
      var accepted = !declared || ['code', 'html', 'markdown', 'text'].indexOf(declared) !== -1;
      if (!accepted) {
        declared.split('|').forEach(function (part) {
          part = part.trim();
          if (part === 'array' && actual === 'array') accepted = true;
          if (part === 'object' && actual === 'object') accepted = true;
          if ((part === 'number' || part === 'integer') && actual === 'number') accepted = true;
          if ((part === 'boolean' || part === 'bool') && actual === 'boolean') accepted = true;
          if (part === 'string' && actual === 'string') accepted = true;
          if (part === 'enum' && (actual === 'string' || actual === 'number' || actual === 'boolean')) accepted = true;
          if (part === 'json' && (actual === 'array' || actual === 'object')) accepted = true;
        });
      }
      if (!accepted) problems.push(key + ' 类型不符（' + declared + ' / ' + actual + '）');
      if (declared === 'enum' && Array.isArray(prop.options)) {
        var allowed = prop.options.map(function (option) {
          return typeof option === 'object' ? option.value : option;
        });
        var values = Array.isArray(props[key]) ? props[key] : [props[key]];
        values.forEach(function (value) {
          if (allowed.indexOf(value) === -1) problems.push(key + ' 不在枚举内（' + value + '）');
        });
      }
    });
    Object.keys(schema.props || {}).forEach(function (key) {
      if (schema.props[key].required && props[key] == null) problems.push('缺必填字段 ' + key);
    });
    return problems;
  }

  check('默认值覆盖全部组件类型', componentTypes.every(function (type) {
    return defaultsMap[type] && Object.keys(defaultsMap[type]).length > 0;
  }), String(Object.keys(defaultsMap).length) + '/' + componentTypes.length);

  var defaultsPage = {
    id: 'page-defaults', slug: 'defaults', path: 'defaults.html',
    title: '组件默认内容', themeId: 'ink-green', blocks: []
  };
  var defaultsSite = {
    project: { name: 'Lantern 数据平台' },
    pages: [defaultsPage],
    themes: [site.themes[0]],
    components: [],
    articles: [
      { id: 'a-1', title: '把订单数据接入指标层', path: 'articles/a-1.html', summary: '从上报到出数的完整流程。', order: 1 },
      { id: 'a-2', title: '统一指标口径的五个步骤', path: 'articles/a-2.html', summary: '先写指标字典，再接入数据。', order: 2 },
      { id: 'a-3', title: '大促期间的同步延迟排查', path: 'articles/a-3.html', summary: '队列积压与重试策略怎么查。', order: 3 }
    ]
  };
  var defaultsRegistry = R.createRegistry();
  R.registerBuiltinComponents(defaultsRegistry);
  baseBlocks.registerBaseBlocks(defaultsRegistry);
  var defaultsRenderer = R.createRenderer(defaultsSite, { registry: defaultsRegistry });
  var defaultHtmlList = [];

  function renderDefault(type, props) {
    var block = clone(props);
    block.id = 'default-' + String(type).replace(/[^a-zA-Z0-9-]/g, '-');
    block.type = type;
    defaultsPage.blocks = [block];
    var result = defaultsRenderer.render('page-defaults', { themeId: 'ink-green', mode: 'light' });
    var html = R.toHtml(result.node);
    defaultHtmlList.push(html);
    return { html: html, errors: result.report.errors() };
  }

  componentTypes.forEach(function (type) {
    var props = defaultsMap[type];
    var problems = defaultProblems(R.componentSchema(type), props);
    check('默认值通过 schema 校验 · ' + type, problems.length === 0, problems.join('；'));
    var rendered = renderDefault(type, props);
    check('默认值渲染无错误 · ' + type, rendered.errors.length === 0,
      rendered.errors.map(function (item) { return item.code || item; }).join(', '));
    check('默认值渲染出内容 · ' + type, rendered.html.length > 240, rendered.html.length + ' 字节');
  });

  var baseSchemas = {};
  baseBlocks.baseBlockSchemas().forEach(function (schema) { baseSchemas[schema.type] = schema; });
  var baseRenderTypes = Object.keys(blockDefaultsMap).filter(function (type) {
    return type !== 'mermaid' && type !== 'articleBody';
  });
  check('基础区块默认值覆盖 12 类', baseRenderTypes.length >= 12, baseRenderTypes.join(', '));
  baseRenderTypes.forEach(function (type) {
    var props = blockDefaultsMap[type];
    if (baseSchemas[type]) {
      var problems = defaultProblems(baseSchemas[type], props);
      check('基础区块默认值通过 schema 校验 · ' + type, problems.length === 0, problems.join('；'));
    }
    var rendered = renderDefault(type, props);
    check('基础区块默认值渲染无错误 · ' + type, rendered.errors.length === 0,
      rendered.errors.map(function (item) { return item.code || item; }).join(', '));
    check('基础区块默认值渲染出内容 · ' + type, rendered.html.length > 120, rendered.html.length + ' 字节');
  });

  var mermaidRendered = renderDefault('markdown', blockDefaultsMap.mermaid);
  check('Mermaid 默认值输出图表占位', mermaidRendered.errors.length === 0 &&
    mermaidRendered.html.indexOf('data-lc-mermaid="true"') !== -1 &&
    mermaidRendered.html.indexOf('flowchart LR') !== -1);
  var bodyRendered = renderDefault('markdown', blockDefaultsMap.articleBody);
  check('文章正文默认值输出章节', bodyRendered.errors.length === 0 &&
    bodyRendered.html.indexOf('接入前准备') !== -1 && bodyRendered.html.indexOf('event_id') !== -1);

  check('表格默认样例行列充足', defaultsMap['ui-table'].rows.length >= 3 &&
    defaultsMap['ui-table'].columns.length >= 4,
    defaultsMap['ui-table'].rows.length + ' 行 / ' + defaultsMap['ui-table'].columns.length + ' 列');
  check('图表默认样例数据点充足', ['ui-chart-line', 'ui-chart-bar', 'ui-chart-pie', 'ui-chart-donut', 'ui-sparkline']
    .every(function (type) {
      var props = defaultsMap[type];
      var points = props.labels && props.labels.length;
      if (!points && props.series) {
        points = Math.max.apply(null, props.series.map(function (item) { return item.values.length; }));
      }
      if (!points && props.data) points = props.data.length;
      return points >= 6;
    }));
  check('列表类默认数据至少 3 条', (function () {
    return defaultsMap['ui-timeline'].items.length >= 3 &&
      defaultsMap['ui-tabs'].items.length >= 3 &&
      defaultsMap['ui-carousel'].items.length >= 3 &&
      defaultsMap['ui-site-nav'].items.length >= 3 &&
      defaultsMap['ui-site-footer'].columns.length >= 3 &&
      defaultsMap['ui-site-footer'].columns.every(function (column) { return column.links.length >= 3; }) &&
      defaultsMap['ui-sidebar'].items.length >= 3 &&
      defaultsMap['ui-breadcrumb'].items.length >= 3 &&
      defaultsMap['ui-form'].fields.length >= 3 &&
      defaultsMap['ui-upload'].files.length >= 3 &&
      defaultsMap['ui-cascader'].options.length >= 3 &&
      defaultsMap['ui-cascader'].options.every(function (option) { return option.children.length >= 2; });
  }()));
  check('默认内容不含占位文案', placeholderPhrases.every(function (phrase) {
    return defaultHtmlList.join('\n').indexOf(phrase) === -1;
  }));
  check('getComponentDefaults 可读取且返回副本', (function () {
    var first = R.getComponentDefaults('ui-table');
    var second = R.getComponentDefaults('ui-table');
    first.rows.push({ id: 'mutated' });
    return second.rows.length === defaultsMap['ui-table'].rows.length &&
      R.getComponentDefaults('ui-kpi').comparison === 12.4 &&
      R.getComponentDefaults('heading').level === 2 &&
      R.getComponentDefaults('not-a-type') === null;
  }()));

  /* ---------- 页面限高限宽 ---------- */
  var sizePage = {
    id: 'page-size', slug: 'size', path: 'size.html', title: '页面限高限宽', blocks: [
      { id: 'size-h', type: 'heading', text: '页面限高限宽', level: 2 },
      { id: 'size-p', type: 'paragraph', text: '页面内部滚动，外层文档不出现滚动条。' }
    ]
  };
  var sizeSite = {
    project: { name: '尺寸测试' },
    pages: [sizePage],
    themes: [site.themes[0]],
    components: [],
    articles: []
  };
  var sizeRenderer = R.createRenderer(sizeSite, { registry: defaultsRegistry });

  var validSizePairs = [
    ['640px', '80vh'],
    ['320px', '100%'],
    ['48rem', '60vw'],
    ['0px', '0px']
  ];
  validSizePairs.forEach(function (pair) {
    var normalized = R.normalizePageSize({ maxWidth: pair[0], maxHeight: pair[1] });
    check('合法尺寸原样保留 · ' + pair[0] + ' / ' + pair[1],
      normalized.maxWidth === pair[0] && normalized.maxHeight === pair[1],
      normalized.maxWidth + ' / ' + normalized.maxHeight);
  });

  var invalidSizes = ['abc', '-10px', '100', '100 px', '10em', '1vh;', ' calc(100vh)', '100PX'];
  invalidSizes.forEach(function (value) {
    var normalized = R.normalizePageSize({ maxWidth: value, maxHeight: value });
    check('非法尺寸回退为不限 · ' + value,
      normalized.maxWidth === '' && normalized.maxHeight === '',
      normalized.maxWidth + ' / ' + normalized.maxHeight);
  });
  check('尺寸缺失或非对象回退为不限',
    R.normalizePageSize(null).maxWidth === '' &&
    R.normalizePageSize(undefined).maxHeight === '' &&
    R.normalizePageSize(42).maxWidth === '' &&
    R.normalizePageSize(['100px']).maxWidth === '' &&
    R.hasPageSize(null) === false);

  check('尺寸样式只输出合法声明', (function () {
    var both = R.pageSizeStyle({ maxWidth: '640px', maxHeight: '80vh' });
    var widthOnly = R.pageSizeStyle({ maxWidth: '640px' });
    var heightOnly = R.pageSizeStyle({ maxHeight: '80vh' });
    var none = R.pageSizeStyle({ maxWidth: 'abc', maxHeight: '-10px' });
    return both === 'max-width:640px;max-height:80vh;overflow:auto;min-height:0;' &&
      widthOnly === 'max-width:640px;overflow:auto;' &&
      heightOnly === 'max-height:80vh;overflow:auto;min-height:0;' &&
      none === '';
  }()));

  function renderSizedPage(size) {
    if (size === undefined) delete sizePage.size;
    else sizePage.size = size;
    var rendered = sizeRenderer.renderToHtml('page-size', { themeId: 'ink-green', mode: 'light' });
    if (size === undefined) delete sizePage.size;
    return rendered;
  }

  check('两者都设：根容器同时生效并内部滚动', (function () {
    var rendered = renderSizedPage({ maxWidth: '640px', maxHeight: '80vh' });
    return rendered.html.indexOf('max-width:640px') !== -1 &&
      rendered.html.indexOf('max-height:80vh') !== -1 &&
      rendered.html.indexOf('overflow:auto') !== -1 &&
      rendered.html.indexOf('min-height:0') !== -1 &&
      rendered.html.indexOf('data-lc-page-max-width="640px"') !== -1 &&
      rendered.html.indexOf('data-lc-page-max-height="80vh"') !== -1 &&
      rendered.result.pageSize.maxHeight === '80vh';
  }()));

  check('只设 maxHeight：不凭空生成 max-width', (function () {
    var rendered = renderSizedPage({ maxHeight: '60vh' });
    return rendered.html.indexOf('max-height:60vh') !== -1 &&
      rendered.html.indexOf('max-width:') === -1 &&
      rendered.html.indexOf('overflow:auto') !== -1;
  }()));

  check('旧页面没有 size：维持现状', (function () {
    var rendered = renderSizedPage(undefined);
    return rendered.html.indexOf('data-lc-page-max-width') === -1 &&
      rendered.html.indexOf('data-lc-page-max-height') === -1 &&
      rendered.html.indexOf('max-width:') === -1 &&
      rendered.html.indexOf('overflow:auto') === -1 &&
      rendered.result.pageSize.maxWidth === '' &&
      rendered.result.pageSize.maxHeight === '';
  }()));

  check('全是非法值：等同未设置', (function () {
    var rendered = renderSizedPage({ maxWidth: 'abc', maxHeight: '100' });
    return rendered.html.indexOf('data-lc-page-max-width') === -1 &&
      rendered.html.indexOf('max-width:') === -1 &&
      rendered.html.indexOf('overflow:auto') === -1;
  }()));

  check('恶意尺寸不会注入额外 CSS 结构', (function () {
    var rendered = renderSizedPage({ maxWidth: '640px;}body{x', maxHeight: '80vh;}' });
    return rendered.html.indexOf('body{x') === -1 &&
      rendered.html.indexOf('max-width:') === -1 &&
      rendered.html.indexOf('max-height:') === -1;
  }()));

  console.log('\n----------------------------------------');
  console.log('通过 ' + passes.length + ' 项，失败 ' + failures.length + ' 项。');
  if (failures.length) {
    failures.forEach(function (name) { console.log('失败：' + name); });
    process.exitCode = 1;
  } else {
    console.log('全部通过。浏览器验收请用静态服务器访问 src/render/demo.html；导出包需 HTTP 访问（双击请走 Tauri）。');
  }
}());
