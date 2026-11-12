/* 渲染核心 · 样例站点数据
   这份数据只用于独立验收：project + pages + components + themes + articles。
   浏览器里挂到 window.LC_SAMPLE_SITE；Node 里直接 module.exports。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC_SAMPLE_SITE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  var SERIF = 'Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", serif';

  /* 装饰色不在样例里手写，按主题侧同一套派生规则算：
     decor = ensureContrastAll(mix(muted-2, bg, 0.45), [bg, surface, surface-2, surface-3, bg-deep], 3)
     这样主题调整 muted-2 时样例会自动跟随，不会出现两套值漂移。 */
  function parseHex(value) {
    var text = String(value == null ? '' : value).replace('#', '');
    if (text.length === 3) {
      text = text.split('').map(function (ch) { return ch + ch; }).join('');
    }
    if (text.length !== 6) return null;
    return {
      r: parseInt(text.slice(0, 2), 16),
      g: parseInt(text.slice(2, 4), 16),
      b: parseInt(text.slice(4, 6), 16)
    };
  }

  function toHex(color) {
    function channel(value) {
      var n = Math.max(0, Math.min(255, Math.round(value)));
      return ('0' + n.toString(16)).slice(-2);
    }
    return '#' + channel(color.r) + channel(color.g) + channel(color.b);
  }

  function mixColor(a, b, t) {
    var ca = parseHex(a);
    var cb = parseHex(b);
    if (!ca || !cb) return a;
    return toHex({
      r: ca.r + (cb.r - ca.r) * t,
      g: ca.g + (cb.g - ca.g) * t,
      b: ca.b + (cb.b - ca.b) * t
    });
  }

  function relativeLuminance(value) {
    var color = parseHex(value);
    if (!color) return null;
    function channel(n) {
      var v = n / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function contrastRatio(fg, bg) {
    var a = relativeLuminance(fg);
    var b = relativeLuminance(bg);
    if (a == null || b == null) return null;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function ensureContrastAll(color, backgrounds, min) {
    function passes(value) {
      return backgrounds.every(function (bg) {
        var ratio = contrastRatio(value, bg);
        return ratio != null && ratio >= min;
      });
    }
    if (passes(color)) return color;
    var directions = ['#000000', '#ffffff'];
    for (var d = 0; d < directions.length; d += 1) {
      for (var step = 1; step <= 32; step += 1) {
        var candidate = mixColor(color, directions[d], step / 32);
        if (passes(candidate)) return candidate;
      }
    }
    return color;
  }

  function deriveDecor(mode) {
    var backgrounds = ['--lc-color-bg', '--lc-color-surface', '--lc-color-surface-2',
      '--lc-color-surface-3', '--lc-color-bg-deep'].map(function (token) {
      return mode[token];
    }).filter(Boolean);
    return ensureContrastAll(mixColor(mode['--lc-color-muted-2'], mode['--lc-color-bg'], 0.45), backgrounds, 3);
  }

  var themes = [
    {
      id: 'ink-green',
      name: '墨绿',
      colorScheme: 'light',
      variables: {
        '--lc-font-sans': SANS,
        '--lc-font-serif': SERIF,
        '--lc-radius-md': '10px',
        '--lc-gap': '1.25rem',
        '--lc-page-max': '1080px'
      },
      light: {
        '--lc-color-bg': '#f7f5ef',
        '--lc-color-bg-deep': '#efece2',
        '--lc-color-surface': '#fffefb',
        '--lc-color-surface-2': '#f1efe7',
        '--lc-color-surface-3': '#e7e3d8',
        '--lc-color-ink': '#1d2320',
        '--lc-color-ink-2': '#3a423d',
        '--lc-color-muted': '#6d756e',
        '--lc-color-muted-2': '#606760',
        '--lc-color-line': '#d9d4c7',
        '--lc-color-line-strong': '#b9b2a1',
        '--lc-color-accent': '#2f6b55',
        '--lc-color-on-accent': '#ffffff',
        '--lc-color-accent-fill': '#2f6b55',
        '--lc-color-accent-fill-hover': '#285b49',
        '--lc-color-accent-soft': '#e2efe8',
        '--lc-color-accent-line': '#9fc4b4',
        '--lc-color-code-bg': '#eeece3'
      },
      dark: {
        '--lc-color-bg': '#151a18',
        '--lc-color-bg-deep': '#101412',
        '--lc-color-surface': '#1d2421',
        '--lc-color-surface-2': '#232b27',
        '--lc-color-surface-3': '#2b342f',
        '--lc-color-ink': '#e6e9e3',
        '--lc-color-ink-2': '#c7cec7',
        '--lc-color-muted': '#9aa49c',
        '--lc-color-muted-2': '#8b9590',
        '--lc-color-line': '#333d37',
        '--lc-color-line-strong': '#4a564e',
        '--lc-color-accent': '#77c3a1',
        '--lc-color-on-accent': '#0f1512',
        '--lc-color-accent-fill': '#77c3a1',
        '--lc-color-accent-fill-hover': '#8fd4b4',
        '--lc-color-accent-soft': '#223a30',
        '--lc-color-accent-line': '#3d6a58',
        '--lc-color-code-bg': '#1a201d'
      }
    },
    {
      id: 'ink-ochre',
      name: '赭石',
      colorScheme: 'light',
      variables: {
        '--lc-font-sans': SANS,
        '--lc-font-serif': SERIF,
        '--lc-radius-md': '4px',
        '--lc-gap': '1.15rem',
        '--lc-page-max': '1080px'
      },
      light: {
        '--lc-color-bg': '#f8f3e8',
        '--lc-color-bg-deep': '#f0e8d8',
        '--lc-color-surface': '#fffcf5',
        '--lc-color-surface-2': '#f3ecde',
        '--lc-color-surface-3': '#e9dfca',
        '--lc-color-ink': '#2a241b',
        '--lc-color-ink-2': '#463d2f',
        '--lc-color-muted': '#776b56',
        '--lc-color-muted-2': '#695e46',
        '--lc-color-line': '#dccfb4',
        '--lc-color-line-strong': '#bfae8d',
        '--lc-color-accent': '#8a5a22',
        '--lc-color-on-accent': '#fffaf0',
        '--lc-color-accent-fill': '#8a5a22',
        '--lc-color-accent-fill-hover': '#744a1a',
        '--lc-color-accent-soft': '#f2e5cd',
        '--lc-color-accent-line': '#c9a978',
        '--lc-color-code-bg': '#f0e9da'
      },
      dark: {
        '--lc-color-bg': '#1c1813',
        '--lc-color-bg-deep': '#16130f',
        '--lc-color-surface': '#252019',
        '--lc-color-surface-2': '#2d261e',
        '--lc-color-surface-3': '#383025',
        '--lc-color-ink': '#eee6d6',
        '--lc-color-ink-2': '#d3c6ad',
        '--lc-color-muted': '#a79a80',
        '--lc-color-muted-2': '#9b8e75',
        '--lc-color-line': '#3e3527',
        '--lc-color-line-strong': '#584b37',
        '--lc-color-accent': '#d2a05f',
        '--lc-color-on-accent': '#1a140c',
        '--lc-color-accent-fill': '#d2a05f',
        '--lc-color-accent-fill-hover': '#e2b274',
        '--lc-color-accent-soft': '#3a2e1d',
        '--lc-color-accent-line': '#6f5734',
        '--lc-color-code-bg': '#211b14'
      }
    },
    {
      id: 'ink-slate',
      name: '青灰',
      colorScheme: 'light',
      variables: {
        '--lc-font-sans': SANS,
        '--lc-font-serif': SERIF,
        '--lc-radius-md': '0px',
        '--lc-gap': '1.1rem',
        '--lc-page-max': '1080px'
      },
      light: {
        '--lc-color-bg': '#f2f5f4',
        '--lc-color-bg-deep': '#e7ecea',
        '--lc-color-surface': '#ffffff',
        '--lc-color-surface-2': '#edf2f0',
        '--lc-color-surface-3': '#e0e8e5',
        '--lc-color-ink': '#1c2422',
        '--lc-color-ink-2': '#364440',
        '--lc-color-muted': '#65756f',
        '--lc-color-muted-2': '#596762',
        '--lc-color-line': '#cfd9d6',
        '--lc-color-line-strong': '#aebeb9',
        '--lc-color-accent': '#3c6a7a',
        '--lc-color-on-accent': '#ffffff',
        '--lc-color-accent-fill': '#3c6a7a',
        '--lc-color-accent-fill-hover': '#335c6a',
        '--lc-color-accent-soft': '#e0edf1',
        '--lc-color-accent-line': '#a3c2cc',
        '--lc-color-code-bg': '#eaf0ee'
      },
      dark: {
        '--lc-color-bg': '#141a1b',
        '--lc-color-bg-deep': '#0f1415',
        '--lc-color-surface': '#1c2526',
        '--lc-color-surface-2': '#222d2e',
        '--lc-color-surface-3': '#2a3637',
        '--lc-color-ink': '#e4ecea',
        '--lc-color-ink-2': '#c3d0cd',
        '--lc-color-muted': '#93a4a0',
        '--lc-color-muted-2': '#8d9d99',
        '--lc-color-line': '#303d3e',
        '--lc-color-line-strong': '#465556',
        '--lc-color-accent': '#7fb6c4',
        '--lc-color-on-accent': '#0d1516',
        '--lc-color-accent-fill': '#7fb6c4',
        '--lc-color-accent-fill-hover': '#93c6d3',
        '--lc-color-accent-soft': '#21353a',
        '--lc-color-accent-line': '#3d6068',
        '--lc-color-code-bg': '#192122'
      }
    }
  ];

  themes.forEach(function (theme) {
    ['light', 'dark'].forEach(function (mode) {
      theme[mode]['--lc-color-decor'] = deriveDecor(theme[mode]);
    });
  });

  var components = [
    {
      id: 'comp-callout',
      name: '提示条（带计数按钮）',
      fields: ['title', 'body', 'action'],
      template: '<div class="demo-callout">' +
        '<span class="demo-callout-mark" aria-hidden="true"></span>' +
        '<div class="demo-callout-body">' +
        '<p class="demo-callout-title">{{title}}</p>' +
        '<p class="demo-callout-text">{{body}}</p>' +
        '<button class="demo-callout-btn" type="button">{{action}} · <span class="demo-callout-count" data-count="0">0</span></button>' +
        '</div></div>',
      css: [
        ':root .demo-callout { --demo-callout-pad: 14px; }',
        '.demo-callout { display: flex; gap: var(--lc-space-3); align-items: flex-start; padding: var(--demo-callout-pad); border: 1px solid var(--lc-color-accent-line); background: var(--lc-color-accent-soft); border-radius: var(--lc-radius-md); }',
        '.demo-callout-mark { width: 4px; align-self: stretch; flex: none; background: var(--lc-color-accent); border-radius: var(--lc-radius-xs); }',
        '.demo-callout-body { flex: 1; min-width: 0; }',
        '.demo-callout-title { margin: 0 0 var(--lc-space-1); font-size: var(--lc-text-md); font-weight: 600; color: var(--lc-color-ink); }',
        '.demo-callout-text { margin: 0 0 var(--lc-space-2-5); font-size: var(--lc-text-sm); color: var(--lc-color-ink-2); }',
        '.demo-callout-btn { border: 1px solid var(--lc-color-accent-line); background: var(--lc-color-surface); color: var(--lc-color-accent); border-radius: var(--lc-radius-full); padding: var(--lc-space-1) var(--lc-space-3); font: inherit; font-size: var(--lc-text-xs); cursor: pointer; }',
        '.demo-callout-btn:hover { background: var(--lc-color-accent-fill); color: var(--lc-color-on-accent); }',
        '.demo-callout-count { font-weight: 700; color: var(--lc-color-accent); }',
        '@media (max-width: 520px) { .demo-callout { padding: var(--lc-space-2-5); gap: var(--lc-space-2); } }'
      ].join('\n'),
      js: [
        'var button = root.querySelector(".demo-callout-btn");',
        'var output = root.querySelector(".demo-callout-count");',
        'if (button && output) {',
        '  button.addEventListener("click", function () {',
        '    var count = Number(output.getAttribute("data-count") || "0") + 1;',
        '    output.setAttribute("data-count", String(count));',
        '    output.textContent = String(count);',
        '  });',
        '}'
      ].join('\n')
    },
    {
      id: 'comp-stat',
      name: '统计卡片',
      fields: ['label', 'value', 'unit', 'hint'],
      template: '<div class="demo-stat">' +
        '<span class="demo-shared">指标</span>' +
        '<p class="demo-stat-label">{{label}}</p>' +
        '<p class="demo-stat-value">{{value}}<span class="demo-stat-unit">{{unit}}</span></p>' +
        '<p class="demo-stat-hint">{{hint}}</p>' +
        '</div>',
      css: [
        '.demo-stat { padding: var(--lc-space-3-5) var(--lc-space-4); border: 1px solid var(--lc-color-line); background: var(--lc-color-surface); border-radius: var(--lc-radius-md); }',
        '.demo-stat .demo-shared { display: inline-block; padding: 1px var(--lc-space-2); border-radius: var(--lc-radius-full); font-size: 11px; letter-spacing: 0.08em; background: var(--lc-color-accent-soft); color: var(--lc-color-accent); }',
        '.demo-stat-label { margin: var(--lc-space-2) 0 2px; font-size: var(--lc-text-xs); color: var(--lc-color-muted); }',
        '.demo-stat-value { margin: 0; font-family: var(--lc-font-serif); font-size: 32px; line-height: 1.2; color: var(--lc-color-ink); }',
        '.demo-stat-unit { margin-left: var(--lc-space-1); font-size: var(--lc-text-sm); color: var(--lc-color-muted); }',
        '.demo-stat-hint { margin: var(--lc-space-1-5) 0 0; font-size: var(--lc-text-xs); color: var(--lc-color-muted-2); }'
      ].join('\n')
    },
    {
      id: 'comp-chip-row',
      name: '标签行（同名类名隔离测试）',
      fields: ['title', 'hint'],
      template: '<div class="demo-chip-row">' +
        '<p class="demo-chip-title">{{title}}</p>' +
        '<div class="demo-chip-list">' +
        '<span class="demo-shared">流式</span>' +
        '<span class="demo-shared">自由定位</span>' +
        '<span class="demo-shared">嵌套</span>' +
        '</div>' +
        '<p class="demo-chip-hint">{{hint}}</p>' +
        '</div>',
      css: [
        '.demo-chip-row { padding: var(--lc-space-3-5) var(--lc-space-4); border: 1px dashed var(--lc-color-line-strong); border-radius: var(--lc-radius-md); }',
        '.demo-chip-title { margin: 0 0 var(--lc-space-2); font-size: var(--lc-text-sm); font-weight: 600; color: var(--lc-color-ink-2); }',
        '.demo-chip-list { display: flex; flex-wrap: wrap; gap: var(--lc-space-1-5); }',
        '.demo-chip-list .demo-shared { padding: 2px var(--lc-space-2-5); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-full); background: var(--lc-color-surface-2); color: var(--lc-color-muted); font-size: var(--lc-text-xs); }',
        '.demo-chip-hint { margin: var(--lc-space-2) 0 0; font-size: var(--lc-text-xs); color: var(--lc-color-muted-2); }'
      ].join('\n')
    }
  ];

  var shellBlocks = [
    {
      id: 'shell-nav',
      type: 'ui-site-nav',
      brand: '渲染核心 F2',
      brandHref: 'index.html',
      sticky: true,
      items: [
        {
          label: '布局',
          children: [
            { label: '流式布局', href: 'index.html', pageId: 'page-home' },
            { label: '自由定位', href: 'free.html', pageId: 'page-free' },
            { label: '嵌套容器', href: 'nested.html', pageId: 'page-nested' },
            { label: '文章页', href: 'article.html', pageId: 'page-article' }
          ]
        },
        {
          label: '组件',
          children: [
            { label: '内置组件', href: 'components.html', pageId: 'page-components' },
            { label: '图表页', href: 'mermaid.html', pageId: 'page-mermaid' }
          ]
        },
        {
          label: '表单与上传',
          children: [
            { label: '文本框', href: 'textfield.html', pageId: 'page-textfield' },
            { label: '验证码', href: 'otp.html', pageId: 'page-otp' },
            { label: '拖拽上传', href: 'upload.html', pageId: 'page-upload' }
          ]
        },
        {
          label: '数据录入',
          children: [
            { label: '日期', href: 'date.html', pageId: 'page-date' },
            { label: '滑块', href: 'slider.html', pageId: 'page-slider' },
            { label: '自动补全', href: 'autocomplete.html', pageId: 'page-autocomplete' },
            { label: '常用控件', href: 'controls.html', pageId: 'page-controls' }
          ]
        },
        {
          label: '图表与统计',
          children: [
            { label: '数据图表', href: 'charts.html', pageId: 'page-charts' },
            { label: '统计指标', href: 'stats.html', pageId: 'page-stats' }
          ]
        },
        { label: '站点外壳', href: 'shell.html', pageId: 'page-shell' },
        {
          label: '外链示例',
          href: 'https://github.com/',
          external: true,
          description: '外部站点，自动在新窗口打开'
        }
      ]
    },
    {
      id: 'shell-footer',
      type: 'ui-site-footer',
      brand: '渲染核心 F2',
      description: '同一份 JSON 数据，浏览器出真实 DOM，Node 出 HTML 字符串。纯静态，无 CDN。',
      columns: [
        {
          title: '布局',
          links: [
            { label: '流式布局', href: 'index.html', pageId: 'page-home' },
            { label: '自由定位', href: 'free.html', pageId: 'page-free' },
            { label: '嵌套容器', href: 'nested.html', pageId: 'page-nested' }
          ]
        },
        {
          title: '组件',
          links: [
            { label: '内置组件', href: 'components.html', pageId: 'page-components' },
            { label: '数据图表', href: 'charts.html', pageId: 'page-charts' },
            { label: '统计指标', href: 'stats.html', pageId: 'page-stats' }
          ]
        },
        {
          title: '关于',
          links: [
            { label: '站点外壳', href: 'shell.html', pageId: 'page-shell' },
            { label: '项目主页', href: 'https://github.com/', external: true }
          ]
        }
      ],
      copyright: '© 2026 渲染核心样例',
      note: '纯静态 · 无外链字体 · 无图标库',
      legal: [
        { label: '隐私说明', href: 'privacy.html' },
        { label: '使用条款', href: 'terms.html' }
      ]
    }
  ];

  var articles = [
    { id: 'a1', title: '流式排版里的容器嵌套', path: 'articles/demo/flow/nested.html', direction: '演示', topic: '布局', summary: '讲清楚容器怎么递归渲染。' },
    { id: 'a2', title: '自由定位的坐标换算', path: 'articles/demo/free/pos.html', direction: '演示', topic: '布局', summary: 'pos 数值如何变成 left/top。' },
    { id: 'a3', title: '组件 CSS 的作用域隔离', path: 'articles/demo/component/scope.html', direction: '演示', topic: '组件', summary: '为什么同名类名不会串味。' },
    { id: 'a4', title: '单块失败如何不拖垮整页', path: 'articles/demo/render/error.html', direction: '演示', topic: '容错', summary: '错误报告与跳过策略。' },
    { id: 'a5', title: '文章页的章节 id 与右侧目录', path: 'articles/demo/article/toc.html', direction: '演示', topic: '文章', summary: '标题锚点、目录、上下篇的渲染。' },
    { id: 'a6', title: '主题切换为什么不需要重渲染', path: 'articles/demo/theme/switch.html', direction: '演示', topic: '主题', summary: '变量注入与属性切换的关系。' }
  ];

  var pages = [
    {
      schemaVersion: 2,
      id: 'page-home',
      slug: 'home',
      path: 'index.html',
      title: '流式布局',
      nav: { label: '流式布局' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '渲染核心的流式布局验收页。' },
      blocks: [
        {
          id: 'home-hero',
          type: 'heading',
          level: 1,
          text: '渲染核心验收样例',
          sub: '同一份 JSON 数据，浏览器出真实 DOM，Node 出 HTML 字符串。'
        },
        {
          id: 'home-intro',
          type: 'markdown',
          md: '这是一段 **Markdown 区块**，用来验证行内语法：`代码`、[链接](#)、加粗与斜体。\n\n' +
            '下面依次覆盖：流式区块、卡片、嵌套容器、分栏容器、折叠容器、自定义组件、事件动作、文章列表。'
        },
        {
          id: 'home-cards',
          type: 'cards',
          columns: 3,
          cards: [
            { tag: '布局', title: '流式 + 自由', body: '普通容器按流式排版，variant:free 的子块按 pos 绝对定位。' },
            { tag: '组件', title: '注册表接入', body: '引擎不内置业务组件，全部通过注册表注册渲染器。' },
            { tag: '容错', title: '单块失败不崩页', body: '坏区块跳过并写入错误报告，其余区块继续渲染。' }
          ]
        },
        {
          id: 'home-nest',
          type: 'container',
          variant: 'card',
          title: '嵌套容器 · 卡片里套分栏',
          blocks: [
            {
              id: 'home-nest-p',
              type: 'paragraph',
              md: '容器渲染器会递归调用同一套区块渲染流程，所以卡片、分栏、折叠都能任意套。'
            },
            {
              id: 'home-cols',
              type: 'container',
              variant: 'columns',
              columns: 2,
              blocks: [
                { id: 'home-col-a', type: 'note', tone: 'info', title: '左栏', md: '左栏是一个 note 区块，仍走注册表渲染。' },
                { id: 'home-col-b', type: 'note', tone: 'warn', title: '右栏', md: '右栏与左栏共用同一套容器内边距与间距。' }
              ]
            }
          ]
        },
        {
          id: 'home-callout-1',
          type: 'component',
          componentId: 'comp-callout',
          fields: {
            title: '自定义组件实例 A',
            body: '这个提示条自带 CSS 和一段 JS。点击按钮只会改变本实例的计数。',
            action: '实例 A 点击加一'
          }
        },
        {
          id: 'home-banner',
          type: 'html',
          html: '<div class="demo-banner">动作测试区：点击下面的按钮，切换本块的 <code>is-hot</code> 状态。</div>'
        },
        {
          id: 'home-actions',
          type: 'buttons',
          buttons: [
            { label: '切换横幅状态', primary: true, action: { type: 'toggle', target: '.demo-banner', className: 'is-hot' } }
          ]
        },
        {
          id: 'home-accordion',
          type: 'container',
          variant: 'accordion',
          title: '折叠容器里的再嵌套',
          open: true,
          blocks: [
            { id: 'home-acc-p', type: 'paragraph', md: '折叠容器展开后，里面还能再套一个卡片容器。' },
            {
              id: 'home-acc-nest',
              type: 'container',
              variant: 'card',
              title: '再套一层卡片',
              blocks: [
                { id: 'home-acc-note', type: 'note', tone: 'ok', md: '到这里已经是第三层容器，渲染深度仍受 maxDepth 保护。' }
              ]
            }
          ]
        },
        { id: 'home-divider', type: 'divider' },
        {
          id: 'home-callout-2',
          type: 'component',
          componentId: 'comp-callout',
          fields: {
            title: '自定义组件实例 B',
            body: '和实例 A 使用同一个组件与同一段 JS，但计数互不影响。',
            action: '实例 B 点击加一'
          }
        },
        {
          id: 'home-stat',
          type: 'component',
          componentId: 'comp-stat',
          fields: { label: '本页区块数', value: '13', unit: '个', hint: '含外层容器与嵌套子块' }
        },
        {
          id: 'home-chip',
          type: 'component',
          componentId: 'comp-chip-row',
          fields: {
            title: '同名类名 .demo-shared 隔离测试',
            hint: '统计卡片里的 .demo-shared 是浅底强调色；这里的是描边灰色，互不污染。'
          }
        },
        {
          id: 'home-articles',
          type: 'articleList',
          title: '文章列表区块',
          limit: 3
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-free',
      slug: 'free',
      path: 'free.html',
      title: '自由定位',
      nav: { label: '自由定位' },
      layout: { mode: 'free', snap: 8 },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '渲染核心的页面级自由定位验收页。' },
      blocks: [
        {
          id: 'free-hero',
          type: 'heading',
          level: 1,
          text: '页面级自由定位',
          sub: 'layout.mode = free，顶层区块按 pos 绝对定位。',
          pos: { x: 0, y: 0, w: 560, h: 86 }
        },
        {
          id: 'free-intro',
          type: 'paragraph',
          md: '这些区块本身按坐标摆放，但右侧卡片内部仍然走流式排版。',
          pos: { x: 0, y: 100, w: 560, h: 160 }
        },
        {
          id: 'free-card',
          type: 'container',
          variant: 'card',
          title: '右侧流式卡片',
          pos: { x: 600, y: 0, w: 400, h: 250 },
          blocks: [
            { id: 'free-card-p', type: 'paragraph', md: '自由定位只作用在容器直接子块，容器内部仍可选择流式或自由。' },
            { id: 'free-card-note', type: 'note', tone: 'info', md: '这就是两种布局在同一页共存的方式。' }
          ]
        },
        {
          id: 'free-callout',
          type: 'component',
          componentId: 'comp-callout',
          fields: { title: '自由定位里的组件', body: '组件实例同样可以绝对定位，脚本仍绑定到自己的实例根节点。', action: '点击加一' },
          pos: { x: 600, y: 270, w: 400, h: 180 }
        },
        {
          id: 'free-note',
          type: 'note',
          tone: 'warn',
          title: '坐标单位',
          md: 'pos 里的数字按 px 处理；字符串可以带 px、%、rem 等单位。',
          pos: { x: 0, y: 280, w: 560, h: 170 }
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-nested',
      slug: 'nested',
      path: 'nested.html',
      title: '嵌套容器',
      nav: { label: '嵌套容器' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '渲染核心的嵌套容器验收页。' },
      blocks: [
        {
          id: 'nested-intro',
          type: 'heading',
          level: 2,
          text: '自由容器套卡片，卡片里再套自由容器',
          sub: '所有层级共用同一套渲染函数，不存在“只支持两层”的限制。'
        },
        {
          id: 'nested-free',
          type: 'container',
          variant: 'free',
          title: '自由定位容器（内部绝对定位）',
          pos: { height: 460 },
          blocks: [
            {
              id: 'nf-card',
              type: 'container',
              variant: 'card',
              title: '左上卡片',
              pos: { x: 0, y: 0, w: 360, h: 230 },
              blocks: [
                { id: 'nf-card-p', type: 'paragraph', md: '卡片内部先流式放一段文字，再嵌入一个自由定位子容器。' },
                {
                  id: 'nf-inner',
                  type: 'container',
                  variant: 'free',
                  pos: { height: 96 },
                  blocks: [
                    { id: 'nf-inner-a', type: 'note', tone: 'ok', md: '内层 A', pos: { x: 0, y: 0, w: 150, h: 88 } },
                    { id: 'nf-inner-b', type: 'note', tone: 'warn', md: '内层 B', pos: { x: 166, y: 0, w: 150, h: 88 } }
                  ]
                }
              ]
            },
            {
              id: 'nf-note',
              type: 'note',
              tone: 'info',
              title: '右上说明',
              md: '自由容器里每个直接子块都带 pos，子块之间不会互相挤压。',
              pos: { x: 380, y: 0, w: 400, h: 140 }
            },
            {
              id: 'nf-comp',
              type: 'component',
              componentId: 'comp-callout',
              fields: { title: '自由容器里的组件', body: '组件照样能挂在自己的位置上，CSS 作用域不受影响。', action: '点击加一' },
              pos: { x: 380, y: 156, w: 400, h: 170 }
            },
            {
              id: 'nf-stat',
              type: 'component',
              componentId: 'comp-stat',
              fields: { label: '当前嵌套深度', value: '3', unit: '层', hint: '页面 → 自由容器 → 卡片 → 自由容器' },
              pos: { x: 0, y: 248, w: 360, h: 150 }
            }
          ]
        },
        {
          id: 'nested-after',
          type: 'paragraph',
          md: '自由容器结束后，页面回到流式排版。这个段落是普通区块，没有 pos，也不受上面的绝对定位影响。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-article',
      slug: 'article',
      path: 'article.html',
      title: '文章页',
      nav: { label: '文章页' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '渲染核心的文章页验收：章节 id、右侧目录、上下篇。' },
      articleId: 'a5',
      article: { toc: true, tocTitle: '本文目录', autoNav: true },
      blocks: [
        {
          id: 'article-hero',
          type: 'heading',
          level: 1,
          text: '文章页：章节、目录与上下篇',
          sub: '标题锚点由渲染层统一补上，目录与上下篇都在同一份节点树里生成。'
        },
        {
          id: 'article-intro',
          type: 'paragraph',
          md: '下面的 Markdown 区块里有 h2 与 h3。渲染完成后，右侧目录会按标题层级自动出现。'
        },
        {
          id: 'article-body',
          type: 'markdown',
          md: '## 为什么要给标题加 id\n\n' +
            '章节 id 让读者可以把链接直接发到某一节。渲染层在区块输出后统一补 id，作者不用手写。\n\n' +
            '### 命名规则\n\n' +
            'h2 按顺序得到 `section-1`、`section-2`；h3 挂在所属 h2 下，得到 `section-2-sub-1`。已有且不重复的 id 会保留。\n\n' +
            '## 目录怎么生成\n\n' +
            '右侧目录只取 h2 和 h3，h3 缩进显示。目录是渲染结果的一部分，不额外发请求。\n\n' +
            '### 为什么不做滚动高亮\n\n' +
            '滚动高亮需要监听滚动位置，属于外壳交互；静态导出时不希望带额外脚本。\n\n' +
            '## 上下篇从哪来\n\n' +
            '优先用页面上的 `article.prev` / `article.next`；没有就按 `site.articles` 的顺序自动取前后两篇。\n\n' +
            '### 显式关闭\n\n' +
            '把 `article.toc` 或 `article.autoNav` 设为 false，就可以只保留正文。'
        },
        {
          id: 'article-note',
          type: 'note',
          tone: 'info',
          title: '目录位置',
          md: '桌面端目录固定在右侧；窄屏时回到正文上方，避免挤占正文宽度。'
        }
      ]
    },
    {
      id: 'page-mermaid',
      slug: 'mermaid',
      path: 'mermaid.html',
      title: '图表页',
      nav: { label: '图表页' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: 'Mermaid 图块验收：流程图、时序图、甘特图、类图与错误降级。' },
      blocks: [
        {
          id: 'mermaid-hero',
          type: 'heading',
          level: 1,
          text: 'Mermaid 图块：注入式渲染',
          sub: 'Markdown 里的 ```mermaid 块由外部渲染器生成 SVG；没有渲染器时保留原始代码。'
        },
        {
          id: 'mermaid-body',
          type: 'markdown',
          md: '## 流程图（flowchart）\n\n' +
            '```mermaid\n' +
            'flowchart LR\n' +
            '  A[开始] --> B{是否登录}\n' +
            '  B -->|是| C[进入首页]\n' +
            '  B -->|否| D[去登录]\n' +
            '  C --> E((完成))\n' +
            '```\n\n' +
            '## 时序图（sequenceDiagram）\n\n' +
            '```mermaid\n' +
            'sequenceDiagram\n' +
            '  participant U as 用户\n' +
            '  participant S as 服务端\n' +
            '  participant D as 数据库\n' +
            '  U->>S: 提交表单\n' +
            '  S->>D: 写入记录\n' +
            '  D-->>S: 确认\n' +
            '  S-->>U: 返回结果\n' +
            '```\n\n' +
            '## 甘特图（gantt）\n\n' +
            '```mermaid\n' +
            'gantt\n' +
            '  title 发布节奏\n' +
            '  dateFormat YYYY-MM-DD\n' +
            '  section 准备\n' +
            '  需求冻结 :2026-11-01, 3d\n' +
            '  设计定稿 :2026-11-04, 4d\n' +
            '  section 交付\n' +
            '  开发 :2026-11-08, 10d\n' +
            '  联调 :2026-11-18, 5d\n' +
            '```\n\n' +
            '## 类图（classDiagram）\n\n' +
            '```mermaid\n' +
            'classDiagram\n' +
            '  class Page {\n' +
            '    +String id\n' +
            '    +render()\n' +
            '  }\n' +
            '  class Block {\n' +
            '    +String type\n' +
            '  }\n' +
            '  Page --> Block : 包含\n' +
            '```\n\n' +
            '## 故意写错的块\n\n' +
            '下面这块缺少连线目标，应该只影响它自己：原始代码保留，并指出行号。\n\n' +
            '```mermaid\n' +
            'flowchart TD\n' +
            '  A[开始] -->\n' +
            '  B[结束]\n' +
            '```'
        },
        {
          id: 'mermaid-note',
          type: 'note',
          tone: 'info',
          title: '懒加载',
          md: '页面没有 mermaid 块时不会触发渲染器加载；多个块共享同一次加载。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-components',
      slug: 'components',
      path: 'components.html',
      title: '内置组件',
      nav: { label: '内置组件' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '九类内置组件的交互、状态与实例覆盖验收。' },
      blocks: [
        {
          id: 'comp-hero',
          type: 'heading',
          level: 1,
          text: '内置组件验收',
          sub: '每类组件都有属性 schema、正常/空/加载/错误四种状态与键盘可达的交互。'
        },
        {
          id: 'comp-note',
          type: 'note',
          tone: 'info',
          title: '状态与事件',
          md: '统一状态为 `ready` / `loading` / `empty` / `error`；交互统一派发 `lc:*` 自定义事件，组件之间不引用彼此的内部实现。'
        },
        {
          id: 'comp-table',
          type: 'ui-table',
          caption: '发布计划 · 表头排序 + 行选择 + 分页',
          pageSize: 5,
          selectable: true,
          sortKey: 'name',
          sortDir: 'asc',
          columns: [
            { key: 'name', title: '任务' },
            { key: 'owner', title: '负责人' },
            { key: 'status', title: '状态' },
            { key: 'size', title: '工作量', align: 'right', format: 'number' }
          ],
          rows: [
            { id: 't1', name: '需求冻结', owner: '产品', status: '已完成', size: 3 },
            { id: 't2', name: '视觉定稿', owner: '设计', status: '已完成', size: 5 },
            { id: 't3', name: '组件开发', owner: '前端', status: '进行中', size: 8 },
            { id: 't4', name: '接口联调', owner: '前后端', status: '进行中', size: 5 },
            { id: 't5', name: '回归测试', owner: '测试', status: '待开始', size: 3 },
            { id: 't6', name: '灰度发布', owner: '运维', status: '待开始', size: 2 },
            { id: 't7', name: '文档收尾', owner: '产品', status: '待开始', size: 1 }
          ]
        },
        {
          id: 'comp-table-empty',
          type: 'ui-table',
          state: 'empty',
          emptyText: '这个实例没有行数据，自动降级为空状态。',
          columns: [{ key: 'name', title: '任务' }, { key: 'owner', title: '负责人' }],
          rows: []
        },
        {
          id: 'comp-form',
          type: 'ui-form',
          submitLabel: '提交校验',
          successText: '校验通过，这里只做前端演示。',
          fields: [
            { name: 'name', label: '姓名', type: 'text', required: true, minLength: 2, maxLength: 12, placeholder: '2–12 个字符' },
            { name: 'email', label: '邮箱', type: 'email', required: true, placeholder: 'name@example.com', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', message: '邮箱格式不正确' },
            { name: 'age', label: '年龄', type: 'number', min: 18, max: 65, step: 1, help: '只接受 18–65 的整数' },
            { name: 'role', label: '角色', type: 'select', options: [
              { value: 'frontend', label: '前端' },
              { value: 'backend', label: '后端' },
              { value: 'design', label: '设计' }
            ] },
            { name: 'bio', label: '简介', type: 'textarea', maxLength: 60, rows: 3, help: '最多 60 个字符' },
            { name: 'subscribe', label: '订阅发布通知', type: 'checkbox' }
          ]
        },
        {
          id: 'comp-form-submit',
          type: 'ui-form',
          submitLabel: '提交到数据源',
          endpoint: '/api/form-submit',
          method: 'POST',
          successText: '提交成功，服务端已接收。',
          errorText: '提交失败，请检查地址或网络。',
          fields: [
            { name: 'contact', label: '联系人', type: 'text', required: true, minLength: 2, placeholder: '至少 2 个字符' },
            { name: 'channel', label: '联系方式', type: 'select', required: true, value: 'email', options: [
              { value: 'email', label: '邮箱' },
              { value: 'phone', label: '手机' }
            ] },
            { name: 'email', label: '邮箱', type: 'email', required: true, visibleWhen: { field: 'channel', equals: 'email' }, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', message: '邮箱格式不正确' },
            { name: 'phone', label: '手机号', type: 'text', required: true, visibleWhen: { field: 'channel', equals: 'phone' }, pattern: '^1\\d{10}$', message: '请输入 11 位手机号' },
            { name: 'note', label: '备注', type: 'textarea', maxLength: 80, rows: 3, help: '最多 80 个字符' }
          ]
        },
        {
          id: 'comp-overlay-modal',
          type: 'ui-modal',
          overlayId: 'demo-modal',
          title: '对话框：焦点收进与归还',
          triggerLabel: '打开对话框',
          body: '打开后焦点进入浮层，Tab 在浮层内部环绕；Esc 只关闭最上层浮层。',
          html: '<p><button class="demo-inline-btn" type="button" data-lc-overlay-open="demo-drawer">在对话框里打开抽屉</button></p>',
          footer: '点击遮罩默认关闭'
        },
        {
          id: 'comp-overlay-drawer',
          type: 'ui-drawer',
          overlayId: 'demo-drawer',
          title: '抽屉：嵌套不串层',
          triggerLabel: '单独打开抽屉',
          placement: 'right',
          body: '这是内层抽屉。此时按 Esc 只会关闭抽屉，对话框仍然保留。',
          footer: '关闭后焦点回到打开它的按钮'
        },
        {
          id: 'comp-tabs',
          type: 'ui-tabs',
          label: '组件能力',
          active: 'table',
          items: [
            { id: 'table', label: '表格', content: '列定义、排序、分页、行选择；空数据自动降级。' },
            { id: 'form', label: '表单', content: '必填、长度、正则、数值范围四条规则按顺序校验。' },
            { id: 'lazy', label: '懒加载面板', lazy: true, content: '这个面板在首次切换前不会实例化内容。' },
            { id: 'disabled', label: '禁用项', disabled: true, content: '不会被键盘切换选中。' }
          ]
        },
        {
          id: 'comp-carousel',
          type: 'ui-carousel',
          label: '轮播',
          autoplay: true,
          interval: 4200,
          loop: true,
          indicators: true,
          controls: true,
          pauseOnHover: true,
          items: [
            { title: '第一张 · 自动播放', content: '悬停或聚焦会暂停；移开且失焦后恢复。' },
            { title: '第二张 · 指示点', content: '指示点可点击，也可用键盘切换。' },
            { title: '第三张 · 循环', content: '到最后一张后回到第一张。' }
          ]
        },
        {
          id: 'comp-timeline',
          type: 'ui-timeline',
          items: [
            { title: '需求评审', time: '11-01', status: 'done', content: '范围与验收标准确认。' },
            { title: '组件开发', time: '11-08', status: 'active', content: '正在实现渲染与交互。' },
            { title: '灰度发布', time: '待定', status: 'pending', content: '等待回归测试结果。' },
            { title: '历史遗留问题', time: '11-03', status: 'error', content: '旧版本样式冲突，已记录待修。' }
          ]
        },
        {
          id: 'comp-code',
          type: 'ui-code',
          filename: 'overrides-merge.js',
          language: 'js',
          lineNumbers: true,
          copyable: true,
          maxHeight: '300px',
          code: [
            '// 组件默认 < 实例覆盖：HTML 替换，CSS/JS 追加',
            'var merged = mergeInstanceOverrides(component, instance.overrides);',
            'if (!merged.validation.ok) {',
            '  merged.validation.errors.forEach(function (error) {',
            '    console.warn(error.field + " 第 " + error.line + " 行，第 " + error.column + " 列：" + error.message);',
            '  });',
            '}',
            'var out = [merged.css, merged.overrideCss].filter(Boolean).join("\\n");'
          ].join('\n')
        },
        {
          id: 'comp-state-skeleton',
          type: 'ui-state',
          kind: 'loading',
          variant: 'skeleton',
          lines: 3,
          title: '骨架屏',
          text: '数据到达前先用骨架占位，避免布局跳动。'
        },
        {
          id: 'comp-state-error',
          type: 'ui-state',
          kind: 'error',
          title: '加载失败',
          text: '点击重试会派发 lc:state-retry，由数据层决定是否重新请求。',
          retry: true,
          retryLabel: '重新加载'
        },
        {
          id: 'comp-override-note',
          type: 'note',
          tone: 'warn',
          title: '实例覆盖：同一组件的两个实例',
          md: '第一个实例覆盖了 CSS 与 JS，第二个保持组件默认。两个实例的样式与变量互不影响。'
        },
        {
          id: 'comp-inst-overridden',
          type: 'component',
          componentId: 'comp-callout',
          fields: {
            title: '实例 A · 已覆盖 CSS/JS',
            body: '边框被改成虚线、背景换成更深一档；标题文案由实例 JS 追加。',
            action: '实例 A 点击加一'
          },
          overrides: {
            css: [
              '.demo-callout { border-style: dashed; border-color: var(--lc-color-accent); background: var(--lc-color-surface-3); }',
              '.demo-callout-title { letter-spacing: 0.06em; }'
            ].join('\n'),
            js: [
              'var title = root.querySelector(".demo-callout-title");',
              'if (title) { title.textContent = title.textContent + " · JS 覆盖生效"; }'
            ].join('\n')
          }
        },
        {
          id: 'comp-inst-default',
          type: 'component',
          componentId: 'comp-callout',
          fields: {
            title: '实例 B · 组件默认',
            body: '同一个组件、同一份默认模板与样式，没有 overrides。',
            action: '实例 B 点击加一'
          }
        },
        {
          id: 'comp-override-data',
          type: 'overrideDemo',
          componentId: 'comp-callout',
          savedId: 'comp-callout-custom',
          savedName: '提示条（自定义）',
          instance: {
            id: 'demo-instance',
            type: 'component',
            componentId: 'comp-callout',
            fields: { title: '带覆盖的实例', body: '演示重置与另存', action: '点击加一' },
            overrides: {
              css: '.demo-callout { border-style: dashed; }',
              js: 'root.setAttribute("data-inline", "true");'
            }
          }
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-textfield',
      slug: 'textfield',
      path: 'textfield.html',
      title: '文本框',
      nav: { label: '文本框' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '浮动标签与普通占位符两种形态，含错误、禁用、只读、图标与字数计数。' },
      blocks: [
        { id: 'tf-hero', type: 'heading', level: 1, text: '文本框', sub: '同一个组件用 floating 属性切换两种形态；两种形态都保留 label 与输入框的关联。' },
        {
          id: 'tf-floating',
          type: 'ui-textfield',
          props: { type: 'email' },
          label: '邮箱（浮动标签）',
          name: 'email-floating',
          floating: true,
          placeholder: 'name@example.com',
          help: '聚焦或有值时标签上浮；占位符只作提示，不替代标签。',
          required: true,
          maxLength: 40,
          prefixIcon: 'info',
          autocomplete: 'email'
        },
        {
          id: 'tf-plain',
          type: 'ui-textfield',
          label: '普通占位符',
          name: 'email-plain',
          placeholder: '请输入内容',
          help: '标签固定在上方，占位符单独显示。',
          suffixIcon: 'search',
          maxLength: 20
        },
        {
          id: 'tf-affix',
          type: 'ui-textfield',
          label: '金额（前缀 / 后缀 + 清除）',
          name: 'amount',
          floating: true,
          value: '1280',
          prefixText: '¥',
          suffixText: '元',
          clearable: true,
          maxLength: 10,
          help: '前缀/后缀可以放单位或短文本；清除按钮只在有值时出现，并带 aria-label。'
        },
        {
          id: 'tf-error',
          type: 'ui-textfield',
          label: '错误态',
          name: 'tf-error',
          value: 'abc',
          error: '格式不正确：需要包含 @ 的邮箱地址。',
          state: 'error',
          help: '错误提示紧贴控件下方并带 role=alert。'
        },
        {
          id: 'tf-readonly',
          type: 'ui-textfield',
          label: '只读',
          name: 'tf-readonly',
          value: '只读内容仍可聚焦与复制',
          readonly: true,
          floating: true
        },
        {
          id: 'tf-disabled',
          type: 'ui-textfield',
          label: '禁用',
          name: 'tf-disabled',
          value: '禁用时不能输入',
          disabled: true
        },
        {
          id: 'tf-loading',
          type: 'ui-textfield',
          label: '加载态',
          name: 'tf-loading',
          value: '正在校验',
          state: 'loading',
          help: '加载时输入框禁用，右侧显示进度指示。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-otp',
      slug: 'otp',
      path: 'otp.html',
      title: '多位验证码',
      nav: { label: '验证码' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '逐格验证码：自动前进后退、方向键、退格与整段粘贴拆分。' },
      blocks: [
        { id: 'otp-hero', type: 'heading', level: 1, text: '多位验证码', sub: '位数 4–8；数字或字母数字；粘贴从当前格开始逐格向后铺。' },
        {
          id: 'otp-numeric',
          type: 'ui-otp',
          label: '数字验证码（6 位）',
          length: 6,
          mode: 'numeric',
          value: '123',
          help: '输入后自动前进；退格在空格子会回退并清除上一格。粘贴会从当前格开始向后铺，超出部分截断。',
          copyable: true,
          autofocus: true
        },
        {
          id: 'otp-alpha',
          type: 'ui-otp',
          label: '字母数字（4 位）',
          length: 4,
          mode: 'alphanumeric',
          help: '字母与数字都可输入；其他字符会被过滤。',
          name: 'otp-alpha'
        },
        {
          id: 'otp-error',
          type: 'ui-otp',
          label: '错误态',
          length: 6,
          value: '0000',
          error: '验证码不完整或已过期，请重新获取。',
          state: 'error'
        },
        {
          id: 'otp-loading',
          type: 'ui-otp',
          label: '加载态',
          length: 4,
          state: 'loading',
          help: '加载时所有格子禁用。'
        },
        {
          id: 'otp-rule',
          type: 'note',
          tone: 'info',
          title: '粘贴规则',
          md: '粘贴从当前光标所在的格子开始，按字符依次向后填充：超出剩余位数的字符截断，不足位数的保留空格子、不自动补齐。空格、换行、中文等非允许字符会被过滤，并在输入框下方给出文字提示（同时通过 `aria-live` 播报）；中文输入法组合期间不会打断，组合结束后再按最终文本处理。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-upload',
      slug: 'upload',
      path: 'upload.html',
      title: '拖拽上传',
      nav: { label: '拖拽上传' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '上传目标由使用者配置；未配置时明确提示，不伪造成功。' },
      blocks: [
        { id: 'up-hero', type: 'heading', level: 1, text: '拖拽上传', sub: '上传地址、请求头、字段名全部由属性配置；支持多文件、大小/类型限制、进度、重试、取消与移除。' },
        {
          id: 'up-unconfigured',
          type: 'ui-upload',
          title: '未配置上传地址',
          maxFiles: 3,
          accept: 'image/*,.pdf',
          maxSize: 2097152,
          autoUpload: true
        },
        {
          id: 'up-configured',
          type: 'ui-upload',
          endpoint: '/api/upload',
          method: 'POST',
          fieldName: 'attachment',
          headers: { 'X-Demo-Client': 'lc-render' },
          title: '拖拽文件到这里，或点击选择',
          hint: '示例端点 /api/upload 由使用者替换；未启动服务时会显示网络错误，而不是假装成功。',
          multiple: true,
          maxFiles: 4,
          maxSize: 5242880,
          maxTotalSize: 10485760,
          accept: '',
          autoUpload: false,
          files: [
            { id: 'seed-1', name: '设计稿.pdf', size: 1048576, status: 'success', progress: 100 },
            { id: 'seed-2', name: '截图.png', size: 524288, status: 'uploading', progress: 45 },
            { id: 'seed-3', name: '旧版本.zip', size: 7340032, status: 'error', error: '文件超过大小上限（5.0 MB）。' }
          ]
        },
        {
          id: 'up-preview',
          type: 'ui-upload',
          mode: 'preview',
          title: '本地预览模式',
          multiple: true,
          maxFiles: 5,
          maxTotalSize: 5242880,
          accept: 'image/*,.pdf',
          files: [
            { id: 'pv-1', name: '方案-v1.pdf', size: 824000, status: 'preview', progress: 0 },
            { id: 'pv-2', name: '封面.png', size: 186000, status: 'preview', progress: 0 }
          ]
        },
        {
          id: 'up-note',
          type: 'note',
          tone: 'warn',
          title: '没有配置时 / 本地预览',
          md: '`endpoint` 为空时，拖入的文件会以错误状态留在列表里，并明确提示「未配置上传地址」；不会发出请求，也不会标记为成功。没有真实接口时可设置 `mode: "preview"` 进入本地预览模式：只展示已选文件与大小，不发起上传、不伪造进度。单文件与总大小上限分别由 `maxSize`、`maxTotalSize` 控制。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-date',
      slug: 'date',
      path: 'date.html',
      title: '日期选择',
      nav: { label: '日期' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '单日期与日期范围：日历和键盘输入并存，范围自动纠正。' },
      blocks: [
        { id: 'date-hero', type: 'heading', level: 1, text: '日期选择', sub: '单日期与双日期范围；日历点选和手动输入并存，非法输入给出人话提示。' },
        {
          id: 'date-single',
          type: 'ui-date',
          label: '单日期',
          name: 'day',
          value: '2026-11-08',
          min: '2026-01-01',
          max: '2027-12-31',
          disabledDates: ['2026-11-15', '2026-11-16'],
          shortcuts: ['today', 'month', 'last7'],
          required: true,
          help: '格式 YYYY-MM-DD；11-15、11-16 为禁用日期；快捷项：今天 / 本月 / 最近七天。'
        },
        {
          id: 'date-range',
          type: 'ui-date',
          mode: 'range',
          label: '日期范围',
          value: { start: '2026-11-01', end: '2026-11-10' },
          min: '2026-01-01',
          max: '2027-12-31',
          shortcuts: ['today', 'month', 'last7'],
          help: '输入或点选结束后，开始晚于结束会自动交换，并派发 corrected:true。'
        },
        {
          id: 'date-range-reversed',
          type: 'ui-date',
          mode: 'range',
          label: '初始值故意反向',
          value: { start: '2026-11-20', end: '2026-11-05' },
          help: '失焦提交后纠正为 11-05 → 11-20，不会静默保存非法范围。'
        },
        {
          id: 'date-error',
          type: 'ui-date',
          label: '错误态',
          value: '2026-02-30',
          state: 'error',
          error: '请按 YYYY-MM-DD 格式输入有效日期。'
        },
        {
          id: 'date-loading',
          type: 'ui-date',
          label: '加载态',
          state: 'loading',
          help: '加载时输入框与日历弹层都不可用。'
        },
        {
          id: 'date-note',
          type: 'note',
          tone: 'info',
          title: '纠正规则',
          md: '两端都合法且开始晚于结束时交换并标记 `corrected`；任一端非法时原样保留并给出错误提示，不静默改成合法值。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-slider',
      slug: 'slider',
      path: 'slider.html',
      title: '滑块',
      nav: { label: '滑块' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '单值与双值滑块：步长、刻度、数字框联动、键盘微调。' },
      blocks: [
        { id: 'slider-hero', type: 'heading', level: 1, text: '滑块', sub: '单值与双值范围；步长、刻度、数字输入联动，双值手柄不会交叉。' },
        {
          id: 'slider-single',
          type: 'ui-slider',
          label: '音量',
          name: 'volume',
          value: 30,
          min: 0,
          max: 100,
          step: 5,
          unit: '%',
          marks: [{ value: 0, label: '静音' }, { value: 50, label: '一半' }, { value: 100, label: '最大' }],
          help: '方向键微调一个步长；数字框与滑块双向联动。'
        },
        {
          id: 'slider-range',
          type: 'ui-slider',
          label: '价格区间',
          range: true,
          value: [20, 80],
          min: 0,
          max: 100,
          step: 10,
          unit: ' 元',
          marks: [{ value: 0, label: '0' }, { value: 50, label: '50' }, { value: 100, label: '100' }],
          help: '两个手柄互相夹住，左侧不会越过右侧。'
        },
        {
          id: 'slider-percent',
          type: 'ui-slider',
          label: '完成度（百分比格式）',
          value: 40,
          min: 0,
          max: 100,
          step: 5,
          percent: true,
          showInput: true,
          help: 'percent:true 时数值以百分比展示（值本身仍是 0–100）。'
        },
        {
          id: 'slider-error',
          type: 'ui-slider',
          label: '错误态',
          value: 90,
          min: 0,
          max: 100,
          unit: '%',
          state: 'error',
          error: '当前值超出允许范围。'
        },
        {
          id: 'slider-loading',
          type: 'ui-slider',
          label: '加载态',
          state: 'loading',
          help: '加载时滑块与数字框都禁用。'
        },
        {
          id: 'slider-note',
          type: 'note',
          tone: 'info',
          title: '格式化',
          md: '值格式支持 `unit`、`percent`，也可以在增强后通过实例 API `setFormat(fn)` 注入自定义格式化函数，纯展示层不影响真实值。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-autocomplete',
      slug: 'autocomplete',
      path: 'autocomplete.html',
      title: '自动补全',
      nav: { label: '自动补全' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '本地与远程两种模式；远程数据源由使用者注册，支持防抖与取消上一笔请求。' },
      blocks: [
        { id: 'ac-hero', type: 'heading', level: 1, text: '自动补全', sub: '本地选项与远程数据源两种模式；键盘上下选择、回车选中、Esc 关闭，可多选与限制数量。' },
        {
          id: 'ac-local',
          type: 'ui-autocomplete',
          label: '本地选项（可多选）',
          mode: 'local',
          multiple: true,
          maxSelected: 2,
          value: ['bj'],
          options: [
            { label: '北京', value: 'bj' },
            { label: '上海', value: 'sh' },
            { label: '广州', value: 'gz' },
            { label: '深圳', value: 'sz' },
            { label: '杭州', value: 'hz' }
          ],
          help: '最多选 2 个；已选项以 chip 展示，可单独移除。'
        },
        {
          id: 'ac-remote',
          type: 'ui-autocomplete',
          label: '远程数据源（演示防抖与取消）',
          mode: 'remote',
          datasource: 'demo-people',
          debounce: 400,
          placeholder: '输入姓名，例如「张」',
          help: '假数据源固定 900ms 延迟；快速连续输入会取消上一笔请求，只保留最后一次结果。'
        },
        {
          id: 'ac-fallback',
          type: 'ui-autocomplete',
          label: '数据源未注册（退回静态选项）',
          mode: 'remote',
          datasource: 'missing-people',
          options: [
            { label: '静态选项 A', value: 'a' },
            { label: '静态选项 B', value: 'b' }
          ],
          help: '数据源找不到时不清空、不报错，退回静态选项并给出明确提示。'
        },
        {
          id: 'ac-unconfigured',
          type: 'ui-autocomplete',
          label: '远程模式但没配数据源',
          mode: 'remote',
          help: '输入框禁用，并提示尚未配置数据源，不假装有数据。'
        },
        {
          id: 'ac-empty',
          type: 'ui-autocomplete',
          label: '空结果',
          mode: 'local',
          state: 'empty',
          options: [],
          emptyText: '没有匹配到任何选项'
        },
        {
          id: 'ac-error',
          type: 'ui-autocomplete',
          label: '错误态',
          mode: 'local',
          state: 'error',
          error: '请求失败：请稍后重试。',
          options: [{ label: '北京', value: 'bj' }]
        },
        {
          id: 'ac-note',
          type: 'note',
          tone: 'info',
          title: '数据源接口',
          md: '组件自身不发请求，只消费平台注册的数据源：`R.registerDataSource(name, { search(query, { signal, limit }) })`。没注册时退回静态选项或禁用态。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-controls',
      slug: 'controls',
      path: 'controls.html',
      title: '常用表单控件',
      nav: { label: '常用控件' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '下拉、多选、单选组、复选组、开关、数字、多行文本、标签、级联、评分。' },
      blocks: [
        { id: 'ctl-hero', type: 'heading', level: 1, text: '常用表单控件', sub: '十类控件统一字段外壳、校验规则与错误提示；键盘可达、缺配置时优雅降级。' },
        {
          id: 'ctl-select',
          type: 'ui-select',
          label: '下拉选择',
          name: 'role',
          required: true,
          value: 'fe',
          options: [
            { label: '前端', value: 'fe' },
            { label: '后端', value: 'be' },
            { label: '设计', value: 'design' }
          ],
          help: '必填；未选择时提交会给出错误提示。'
        },
        {
          id: 'ctl-select-empty',
          type: 'ui-select',
          label: '没有选项',
          options: [],
          help: '选项缺失时显示「暂无可选项」，不抛错。'
        },
        {
          id: 'ctl-multiselect',
          type: 'ui-multiselect',
          label: '多选',
          name: 'skills',
          value: ['html'],
          maxSelected: 2,
          options: [
            { label: 'HTML', value: 'html' },
            { label: 'CSS', value: 'css' },
            { label: 'JavaScript', value: 'js' }
          ],
          help: '最多选 2 项。'
        },
        {
          id: 'ctl-radio',
          type: 'ui-radio-group',
          label: '单选组',
          name: 'plan',
          required: true,
          value: 'pro',
          options: [
            { label: '基础版', value: 'basic' },
            { label: '专业版', value: 'pro' },
            { label: '团队版', value: 'team' }
          ]
        },
        {
          id: 'ctl-checkbox',
          type: 'ui-checkbox-group',
          label: '复选组',
          name: 'notify',
          value: ['mail'],
          minSelected: 1,
          options: [
            { label: '邮件', value: 'mail' },
            { label: '短信', value: 'sms' },
            { label: '站内信', value: 'inbox' }
          ],
          help: '至少选择 1 项。'
        },
        {
          id: 'ctl-switch',
          type: 'ui-switch',
          label: '开关',
          name: 'enabled',
          value: true,
          onLabel: '已启用',
          offLabel: '已停用'
        },
        {
          id: 'ctl-number',
          type: 'ui-number',
          label: '数字输入',
          name: 'weight',
          value: 4,
          min: 1,
          max: 10,
          step: 0.5,
          unit: ' kg',
          required: true,
          help: '范围 1–10，步长 0.5。'
        },
        {
          id: 'ctl-textarea',
          type: 'ui-textarea',
          label: '多行文本',
          name: 'summary',
          value: '渲染层只依赖公开 schema。',
          rows: 3,
          minLength: 5,
          maxLength: 30,
          help: '5–30 个字符，右下角实时计数。'
        },
        {
          id: 'ctl-tags',
          type: 'ui-tags',
          label: '标签输入',
          name: 'tags',
          value: ['渲染', '组件'],
          minTags: 1,
          maxTags: 4,
          help: '回车添加，Backspace 在空输入时删除最后一个；最多 4 个。'
        },
        {
          id: 'ctl-cascader',
          type: 'ui-cascader',
          label: '级联选择',
          name: 'region',
          required: true,
          value: ['zj', 'hz'],
          placeholder: '省 / 市',
          options: [
            {
              label: '浙江省', value: 'zj',
              children: [
                { label: '杭州', value: 'hz', children: [{ label: '西湖区', value: 'xh' }, { label: '滨江区', value: 'bj' }] },
                { label: '宁波', value: 'nb' }
              ]
            },
            {
              label: '江苏省', value: 'js',
              children: [{ label: '南京', value: 'nj' }, { label: '苏州', value: 'sz' }]
            }
          ]
        },
        {
          id: 'ctl-rating',
          type: 'ui-rating',
          label: '评分',
          name: 'score',
          value: 4,
          max: 5,
          required: true,
          help: '方向键左右调整星级。'
        },
        {
          id: 'ctl-error',
          type: 'ui-number',
          label: '错误态示例',
          value: 0,
          min: 1,
          max: 10,
          state: 'error',
          error: '请填写 1–10 之间的数值。'
        },
        {
          id: 'ctl-note',
          type: 'note',
          tone: 'info',
          title: '统一事件',
          md: '所有控件统一派发 `lc:field-change`，payload 含 `type / name / value / valid / error`；错误提示位于控件下方，并用 `role="alert"` 播报。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-charts',
      slug: 'charts',
      path: 'charts.html',
      title: '数据图表',
      nav: { label: '数据图表' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '手写 SVG 的折线、柱状、饼图、环形与迷你走势，含空态、负数与极大值边界。' },
      blocks: [
        {
          id: 'chart-hero',
          type: 'heading',
          level: 1,
          text: '数据图表',
          sub: '全部手写 SVG，不引图表库；颜色只取主题变量，曲线用贝塞尔平滑。'
        },
        {
          id: 'chart-source-note',
          type: 'note',
          tone: 'info',
          title: '数据源与空态',
          md: '远程数据统一走 `registerDataSource / resolveDataSource`，组件内不发请求。数据源未注册时显示空态并说明原因，不会画一张假图。'
        },
        {
          id: 'chart-line-remote',
          type: 'ui-chart-line',
          title: '折线图 · 远程数据源',
          subtitle: '页面先显示加载态，数据源返回后替换为真实曲线。',
          datasource: 'demo-traffic',
          height: 250
        },
        {
          id: 'chart-bar-negative',
          type: 'ui-chart-bar',
          title: '柱状图 · 含负数与零值',
          subtitle: '负值从零线向下生长，零值保留 1px 可见高度。',
          labels: ['一月', '二月', '三月', '四月', '五月', '六月', '七月'],
          series: [{ name: '净增', values: [120, -60, 90, -20, 150, 0, 210] }],
          height: 240
        },
        {
          id: 'chart-pie',
          type: 'ui-chart-pie',
          title: '饼图 · 职能占比',
          data: [
            { label: '前端', value: 42 },
            { label: '后端', value: 30 },
            { label: '设计', value: 18 },
            { label: '测试', value: 10 }
          ]
        },
        {
          id: 'chart-donut',
          type: 'ui-chart-donut',
          title: '环形图 · 交付完成度',
          data: [
            { label: '已完成', value: 64 },
            { label: '进行中', value: 26 },
            { label: '未开始', value: 10 }
          ],
          centerValue: '64%',
          centerLabel: '已完成'
        },
        {
          id: 'chart-single',
          type: 'ui-chart-line',
          title: '单点数据',
          subtitle: '只有一个数据点时强制画出圆点，不出现空白画布。',
          data: [{ label: '唯一数据点', value: 42 }],
          showDots: true,
          height: 200
        },
        {
          id: 'chart-extreme',
          type: 'ui-chart-bar',
          title: '极大值',
          subtitle: '坐标轴刻度自动压缩为「万」，避免文字溢出。',
          data: [
            { label: 'A', value: 98000000 },
            { label: 'B', value: 120000000 },
            { label: 'C', value: 3000000 }
          ],
          height: 220
        },
        {
          id: 'chart-pie-nonpositive',
          type: 'ui-chart-pie',
          title: '饼图 · 全是非正数',
          data: [
            { label: 'A', value: -5 },
            { label: 'B', value: 0 }
          ],
          emptyText: '没有可用于饼图的正数数据。'
        },
        {
          id: 'chart-empty-remote',
          type: 'ui-chart-line',
          title: '远程空结果',
          subtitle: '数据源返回空数组时进入空态。',
          datasource: 'demo-empty-chart',
          height: 200
        },
        {
          id: 'chart-fail-remote',
          type: 'ui-chart-line',
          title: '远程失败与重试',
          subtitle: '数据源报错时显示错误说明，并提供重试按钮。',
          datasource: 'demo-fail-chart',
          height: 200
        },
        {
          id: 'chart-missing-source',
          type: 'ui-chart-bar',
          title: '未注册的数据源',
          subtitle: '不绘制假图，直接说明数据源不可用。',
          datasource: 'missing-chart'
        },
        {
          id: 'chart-table',
          type: 'ui-table',
          caption: '渠道明细 · 列宽可配、表头排序、分页',
          pageSize: 3,
          sortKey: 'visits',
          sortDir: 'desc',
          columns: [
            { key: 'channel', title: '渠道', width: '34%' },
            { key: 'visits', title: '访问量', align: 'right', format: 'number', width: 110 },
            { key: 'rate', title: '转化率', align: 'right', width: 100 },
            { key: 'owner', title: '负责人', width: '20%' }
          ],
          rows: [
            { id: 'c1', channel: '自然搜索', visits: 128000, rate: '4.8%', owner: '张伟' },
            { id: 'c2', channel: '直接访问', visits: 96000, rate: '3.1%', owner: '李娜' },
            { id: 'c3', channel: '内容推荐', visits: 73000, rate: '5.6%', owner: '王强' },
            { id: 'c4', channel: '外部合作', visits: 41000, rate: '2.4%', owner: '陈静' },
            { id: 'c5', channel: '邮件触达', visits: 22000, rate: '6.2%', owner: '刘洋' }
          ]
        },
        {
          id: 'chart-table-empty',
          type: 'ui-table',
          caption: '空表格',
          pageSize: 3,
          columns: [
            { key: 'channel', title: '渠道', width: '34%' },
            { key: 'visits', title: '访问量', align: 'right', format: 'number', width: 110 }
          ],
          rows: [],
          emptyText: '暂无渠道数据'
        },
        {
          id: 'chart-a11y-note',
          type: 'note',
          tone: 'info',
          title: '无障碍',
          md: '图表容器使用 `role="img"` 与自动生成的 `aria-label` 概述数据；下方「查看数据表」提供等价文字替代，可展开、可键盘操作。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-stats',
      slug: 'stats',
      path: 'stats.html',
      title: '统计指标',
      nav: { label: '统计指标' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: 'KPI 数字卡、进度条、环形进度与迷你走势图的主题、空态与边界。' },
      blocks: [
        {
          id: 'stats-hero',
          type: 'heading',
          level: 1,
          text: '统计指标',
          sub: 'KPI、线性进度、环形进度与迷你走势；趋势色随主题变量变化。'
        },
        {
          id: 'stats-kpi-row',
          type: 'container',
          variant: 'columns',
          columns: 3,
          blocks: [
            {
              id: 'stats-kpi-sales',
              type: 'ui-kpi',
              title: '本月销售额',
              value: 1284000,
              unit: '元',
              compact: true,
              decimals: 1,
              comparison: 12.6,
              comparisonLabel: '同比',
              subtitle: '较去年同期',
              positiveIsGood: true
            },
            {
              id: 'stats-kpi-refund',
              type: 'ui-kpi',
              title: '退款率',
              value: 1.8,
              unit: '%',
              decimals: 1,
              comparison: -0.6,
              comparisonLabel: '环比',
              subtitle: '下降为正向',
              positiveIsGood: false
            },
            {
              id: 'stats-kpi-flat',
              type: 'ui-kpi',
              title: '订单量',
              value: 2480,
              unit: '单',
              comparison: 0,
              comparisonLabel: '环比',
              subtitle: '与上期持平'
            },
            {
              id: 'stats-kpi-aov',
              type: 'ui-kpi',
              title: '客单价',
              value: 320,
              unit: '元',
              comparison: -4.2,
              comparisonLabel: '环比',
              subtitle: '下降按负向色显示',
              positiveIsGood: true
            }
          ]
        },
        {
          id: 'stats-kpi-remote',
          type: 'ui-kpi',
          title: '远程 KPI 示例',
          datasource: 'demo-kpi',
          valueField: 'value',
          comparisonField: 'comparison',
          labelField: 'label',
          unit: '万元',
          decimals: 1,
          comparisonLabel: '同比'
        },
        {
          id: 'stats-progress-normal',
          type: 'ui-progress',
          title: '季度目标完成度',
          value: 64,
          max: 100,
          tone: 'accent',
          caption: '数值会被夹在 0–100 之间。'
        },
        {
          id: 'stats-progress-success',
          type: 'ui-progress',
          title: '稳定性目标',
          value: 100,
          max: 100,
          tone: 'success',
          size: 'lg',
          caption: '达到上限时显示 100%。'
        },
        {
          id: 'stats-progress-indeterminate',
          type: 'ui-progress',
          title: '正在同步',
          indeterminate: true,
          tone: 'warn',
          caption: '不确定进度：没有具体数值，用动画表达进行中。'
        },
        {
          id: 'stats-progress-negative',
          type: 'ui-progress',
          title: '异常数值 · 负数',
          value: -20,
          max: 100,
          caption: '负数夹到 0%，不出现反向进度。'
        },
        {
          id: 'stats-progress-overflow',
          type: 'ui-progress',
          title: '异常数值 · 超限',
          value: 150,
          max: 100,
          tone: 'danger',
          caption: '超出上限按 100% 显示。'
        },
        {
          id: 'stats-progress-remote',
          type: 'ui-progress',
          title: '远程进度',
          datasource: 'demo-progress',
          caption: '数据源返回 { value, max }，组件只读消费。'
        },
        {
          id: 'stats-ring-row',
          type: 'container',
          variant: 'columns',
          columns: 3,
          blocks: [
            {
              id: 'stats-ring-normal',
              type: 'ui-progress-ring',
              title: '交付进度',
              value: 64,
              max: 100,
              centerLabel: '已完成',
              tone: 'accent'
            },
            {
              id: 'stats-ring-overflow',
              type: 'ui-progress-ring',
              title: '超限示例',
              value: 120,
              max: 100,
              centerLabel: '已封顶',
              tone: 'danger'
            },
            {
              id: 'stats-ring-zero',
              type: 'ui-progress-ring',
              title: '未开始',
              value: 0,
              max: 100,
              centerLabel: '0%',
              tone: 'warn'
            }
          ]
        },
        {
          id: 'stats-spark-card',
          type: 'container',
          variant: 'card',
          title: '卡片角上的迷你走势',
          blocks: [
            {
              id: 'stats-spark-up-label',
              type: 'paragraph',
              md: '近七日访问量持续上升；走势图只占卡片一角。'
            },
            {
              id: 'stats-spark-up',
              type: 'ui-sparkline',
              series: [{ name: '访问量', values: [820, 932, 901, 1234, 1290, 1330, 1420] }],
              width: 160,
              height: 40,
              area: true
            },
            {
              id: 'stats-spark-down-label',
              type: 'paragraph',
              md: '错误率下降：`positiveIsGood: false` 时下降显示为正向色。'
            },
            {
              id: 'stats-spark-down',
              type: 'ui-sparkline',
              series: [{ name: '错误率', values: [12, 10, 11, 8, 6, 5, 3] }],
              width: 160,
              height: 40,
              positiveIsGood: false
            },
            {
              id: 'stats-spark-bad-label',
              type: 'paragraph',
              md: '超时率上升且上升为负向：`positiveIsGood: false` 显示为负向色。'
            },
            {
              id: 'stats-spark-bad',
              type: 'ui-sparkline',
              series: [{ name: '超时率', values: [3, 5, 4, 6, 8, 9, 11] }],
              width: 160,
              height: 40,
              positiveIsGood: false
            },
            {
              id: 'stats-spark-bar-label',
              type: 'paragraph',
              md: '柱形迷你图与单点数据：'
            },
            {
              id: 'stats-spark-bar',
              type: 'ui-sparkline',
              series: [{ name: '订单', values: [4, 8, 3, 9, 6, 11, 7] }],
              sparkType: 'bar',
              width: 160,
              height: 40
            },
            {
              id: 'stats-spark-single',
              type: 'ui-sparkline',
              series: [{ name: '单点', values: [42] }],
              width: 80,
              height: 32
            },
            {
              id: 'stats-spark-negative',
              type: 'ui-sparkline',
              series: [{ name: '净增', values: [-5, 3, -2, 6, -1, 4] }],
              width: 160,
              height: 40
            }
          ]
        },
        {
          id: 'stats-state-note',
          type: 'note',
          tone: 'info',
          title: '缺失与远程',
          md: '没有数值时进入空态；配置了未注册的数据源时明确提示「数据源不可用」，不展示 0 或假数值。'
        }
      ]
    },
    {
      schemaVersion: 2,
      id: 'page-shell',
      slug: 'shell',
      path: 'shell.html',
      title: '站点外壳',
      nav: { label: '站点外壳', trail: ['组件'] },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      seo: { description: '导航、页脚、侧栏、面包屑、页面标题区都已组件化，字段走 schema。' },
      blocks: [
        {
          id: 'shell-hero',
          type: 'ui-page-header',
          eyebrow: '站点外壳',
          title: '外壳组件化',
          subtitle: '导航、页脚、侧栏、面包屑、页面标题区不再是页面级写死结构；它们是带 schema 的内置组件，可被导出管线直接消费。',
          meta: ['内置组件', 'schema 驱动', '移动端可用'],
          actions: [
            { label: '查看模板', href: '#shell-template', variant: 'primary' },
            { label: '导出说明', href: '#shell-export' }
          ]
        },
        {
          id: 'shell-usage-note',
          type: 'note',
          tone: 'info',
          title: '当前页高亮与外链',
          md: '导航项用 `pageId` 或 `href` 匹配当前页，命中后自动加 `aria-current="page"` 与高亮样式。`href` 以 `http(s)://` 开头或显式 `external: true` 时自动补 `target="_blank" rel="noopener noreferrer"`，并给读屏追加「新窗口打开」提示。'
        },
        {
          id: 'shell-nav-title',
          type: 'heading',
          level: 2,
          text: '导航 · 多级与移动端',
          sub: '桌面端悬停或键盘聚焦展开子菜单；窄屏折叠成汉堡面板，纯 CSS 复选框控制。'
        },
        {
          id: 'shell-nav-demo',
          type: 'ui-site-nav',
          brand: '示例品牌',
          items: [
            { label: '首页', href: '#', pageId: 'page-shell' },
            {
              label: '产品',
              children: [
                { label: '渲染核心', href: '#' },
                {
                  label: '高级能力',
                  children: [
                    { label: '实例覆盖', href: '#' },
                    { label: '图表统计', href: '#' }
                  ]
                }
              ]
            },
            {
              label: '资源',
              children: [
                { label: '使用文档', href: '#' },
                { label: '外部参考', href: 'https://developer.mozilla.org/', external: true }
              ]
            }
          ],
          cta: { label: '开始使用', href: '#' }
        },
        {
          id: 'shell-breadcrumb-title',
          type: 'heading',
          level: 2,
          text: '面包屑',
          sub: '不传 items 时按页面的 nav.trail 与标题自动生成，末项固定为当前页。'
        },
        {
          id: 'shell-breadcrumb-demo',
          type: 'ui-breadcrumb',
          auto: true
        },
        {
          id: 'shell-sidebar-title',
          type: 'heading',
          level: 2,
          text: '侧栏 + 正文',
          sub: '侧栏目录支持多级与当前页高亮；文档站模板会把它接到 project.sidebar 上，全站复用一份。'
        },
        {
          id: 'shell-sidebar-demo',
          type: 'container',
          variant: 'columns',
          columns: 2,
          blocks: [
            {
              id: 'shell-sidebar-demo-aside',
              type: 'ui-sidebar',
              title: '目录',
              description: '多级目录示例',
              footnote: '当前页会高亮',
              items: [
                {
                  label: '快速开始',
                  children: [
                    { label: '安装', href: '#shell-install' },
                    { label: '第一个页面', href: '#shell-first' }
                  ]
                },
                {
                  label: '组件',
                  children: [
                    { label: '外壳组件', href: '#shell-components' },
                    { label: '表单组件', href: '#shell-forms' }
                  ]
                },
                { label: '站点外壳', href: '#shell', pageId: 'page-shell' }
              ]
            },
            {
              id: 'shell-sidebar-demo-body',
              type: 'markdown',
              md: '### 正文区域\n\n侧栏与正文是同一层容器里的两列：容器负责排版，外壳组件只负责自己的语义与交互。\n\n' +
                '- 侧栏：`ui-sidebar`，支持任意层级目录、当前页高亮、吸顶。\n' +
                '- 正文：普通区块，可用 Markdown、段落、表格、代码块等现有组件拼。\n' +
                '- 右侧章节导航与上下篇：文章页能力，由页面 `article` 配置开启。'
            }
          ]
        },
        {
          id: 'shell-footer-title',
          type: 'heading',
          level: 2,
          text: '页脚',
          sub: '品牌说明、多列链接、版权与备案；外链同样自动新窗口打开。'
        },
        {
          id: 'shell-footer-demo',
          type: 'ui-site-footer',
          brand: '示例品牌',
          description: '页脚组件示例：品牌说明、链接列与底部信息都可以在 schema 里改。',
          columns: [
            {
              title: '产品',
              links: [
                { label: '渲染核心', href: '#' },
                { label: '模板骨架', href: '#shell-template' }
              ]
            },
            {
              title: '资源',
              links: [
                { label: '使用文档', href: '#' },
                { label: '外部参考', href: 'https://developer.mozilla.org/', external: true }
              ]
            }
          ],
          copyright: '© 2026 示例品牌',
          legal: [{ label: '隐私说明', href: '#' }]
        },
        {
          id: 'shell-template-note',
          type: 'note',
          tone: 'ok',
          title: '模板骨架',
          md: '文档站、作品集、后台仪表盘、认证中心四套模板都以纯数据给出（`templates/starters.js`），页面与区块组合可逐项修改；模板内只使用现有内置组件。'
        },
        {
          id: 'shell-export',
          type: 'note',
          tone: 'info',
          title: '导出',
          md: '外壳组件注册在 `builtins.js` 中，页面一旦使用，它的 HTML 与 CSS 会自动进入导出产物；移动端展开不依赖运行时脚本。'
        }
      ]
    }
  ];

  return {
    schemaVersion: 2,
    project: {
      schemaVersion: 5,
      name: '渲染核心样例',
      language: 'zh-CN',
      theme: {
        defaultThemeId: 'ink-green',
        mode: 'auto'
      },
      navigation: { blockId: 'shell-nav' },
      footer: { blockId: 'shell-footer' }
    },
    themes: themes,
    components: components,
    shellBlocks: shellBlocks,
    articles: articles,
    pages: pages
  };
}));
