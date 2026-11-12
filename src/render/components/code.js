/* 渲染核心 · 内置组件 · 代码块
   语法着色（原生分词，无第三方库）、行号、复制按钮、长代码横向滚动。
   着色输出全部经过 HTML 转义，原始代码通过隐藏 textarea 携带，供复制与导出使用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../dom.js'), require('./common.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.Components = root.LC.Render.Components || {};
    factory(root.LC.Render, root.LC.Render.ComponentsCommon);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dom, kit) {
  'use strict';

  var h = dom.h;
  var raw = dom.raw;
  var escapeHtml = dom.escapeHtml;

  var SCHEMA = {
    type: 'ui-code',
    name: '代码块',
    version: 1,
    description: '语法着色、行号、复制按钮、长代码横向滚动。',
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:code-copy'],
    props: {
      code: { type: 'string', label: '代码', required: true, default: '' },
      language: { type: 'string', label: '语言', default: 'text', description: 'js/json/css/html/markdown/shell 等。' },
      filename: { type: 'string', label: '文件名' },
      lineNumbers: { type: 'boolean', label: '显示行号', default: true },
      copyable: { type: 'boolean', label: '复制按钮', default: true },
      highlight: { type: 'boolean', label: '语法着色', default: true },
      maxHeight: { type: 'string', label: '最大高度', default: '360px' },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
      emptyText: { type: 'string', label: '空状态文案', default: '没有可显示的代码' }
    }
  };

  var JS_KEYWORDS = 'var let const function return if else for while do switch case break continue class extends new import from export default async await try catch finally throw typeof instanceof in of this null true false undefined void yield delete';
  var KEYWORDS = {};
  JS_KEYWORDS.split(/\s+/).forEach(function (word) { if (word) KEYWORDS[word] = 1; });

  function normalizeLang(value) {
    var lang = String(value == null ? '' : value).toLowerCase();
    if (lang === 'javascript' || lang === 'js' || lang === 'jsx' || lang === 'ts' || lang === 'typescript' || lang === 'tsx') return 'js';
    if (lang === 'json' || lang === 'json5') return 'json';
    if (lang === 'css' || lang === 'scss' || lang === 'less') return 'css';
    if (lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'vue') return 'html';
    if (lang === 'md' || lang === 'markdown') return 'md';
    if (lang === 'sh' || lang === 'bash' || lang === 'shell' || lang === 'zsh' || lang === 'powershell') return 'sh';
    return 'text';
  }

  var RULES = {
    js: {
      re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"[^"\n]*"|'[^'\n]*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g,
      classify: function (token) {
        if (token.indexOf('//') === 0 || token.indexOf('/*') === 0) return 'comment';
        var first = token.charAt(0);
        if (first === '"' || first === "'" || first === '`') return 'string';
        if (/^\d/.test(token)) return 'number';
        return KEYWORDS[token] ? 'keyword' : null;
      }
    },
    json: {
      re: /("[^"\n]*"|-?\b\d+(?:\.\d+)?\b|\b(?:true|false|null)\b)/g,
      classify: function (token) {
        if (token.charAt(0) === '"') return 'string';
        if (/^-?\d/.test(token)) return 'number';
        return 'keyword';
      }
    },
    css: {
      re: /(\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}\b|@[\w-]+|--[\w-]+|[\w-]+(?=\s*:)|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)/g,
      classify: function (token) {
        if (token.indexOf('/*') === 0) return 'comment';
        if (token.charAt(0) === '"' || token.charAt(0) === "'") return 'string';
        if (token.charAt(0) === '@') return 'keyword';
        if (token.charAt(0) === '#') return 'number';
        if (token.indexOf('--') === 0) return 'attr';
        if (/^\d/.test(token)) return 'number';
        return 'prop';
      }
    },
    html: {
      re: /(<!--[\s\S]*?-->|<\/?[\w-]+|\/?>|"[^"]*"|'[^']*'|[A-Za-z_:][\w:.-]*(?=\s*=))|&[#\w]+;/g,
      classify: function (token) {
        if (token.indexOf('<!--') === 0) return 'comment';
        if (token.charAt(0) === '&') return 'attr';
        if (token.charAt(0) === '<' || token.indexOf('/>') === 0) return 'tag';
        if (token.charAt(0) === '"' || token.charAt(0) === "'") return 'string';
        return 'attr';
      }
    },
    md: {
      re: /(^#{1,6}\s[^\n]*|`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]*\]\([^)]*\))/g,
      classify: function (token) {
        if (token.charAt(0) === '#') return 'keyword';
        if (token.charAt(0) === '`') return 'string';
        if (token.indexOf('**') === 0) return 'keyword';
        if (token.charAt(0) === '[') return 'tag';
        return 'comment';
      }
    },
    sh: {
      re: /(#[^\n]*|"[^"]*"|'[^']*'|\b(?:if|then|else|fi|for|do|done|while|case|esac|function|export|local|echo|cd|set|return|in)\b)/g,
      classify: function (token) {
        if (token.charAt(0) === '#') return 'comment';
        if (token.charAt(0) === '"' || token.charAt(0) === "'") return 'string';
        return 'keyword';
      }
    },
    text: null
  };

  function highlightLine(line, lang) {
    var rules = RULES[lang];
    if (!rules) return escapeHtml(line);
    var out = '';
    var last = 0;
    var regex = rules.re;
    regex.lastIndex = 0;
    var match;
    while ((match = regex.exec(line))) {
      if (match.index > last) out += escapeHtml(line.slice(last, match.index));
      var token = match[0];
      var kind = token && rules.classify(token);
      if (!token) { regex.lastIndex += 1; continue; }
      out += kind
        ? '<span class="lc-ui-token lc-ui-token-' + kind + '">' + escapeHtml(token) + '</span>'
        : escapeHtml(token);
      last = match.index + token.length;
    }
    out += escapeHtml(line.slice(last));
    return out;
  }

  function highlightLines(code, language) {
    var lang = normalizeLang(language);
    return String(code == null ? '' : code).split('\n').map(function (line) {
      return highlightLine(line, lang);
    });
  }

  function normalizeCode(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(function (line) { return String(line == null ? '' : line); }).join('\n');
    }
    return value == null ? '' : String(value);
  }

  function render(block, ctx) {
    var code = normalizeCode(kit.prop(block, 'code', ''));
    var language = String(kit.prop(block, 'language', 'text'));
    var filename = kit.prop(block, 'filename', null);
    var lineNumbers = kit.bool(kit.prop(block, 'lineNumbers', true), true);
    var copyable = kit.bool(kit.prop(block, 'copyable', true), true);
    var highlight = kit.bool(kit.prop(block, 'highlight', true), true);
    var maxHeight = kit.prop(block, 'maxHeight', '360px');
    var state = kit.stateOf(block, code !== '');
    var emptyText = kit.prop(block, 'emptyText', '没有可显示的代码');

    var rootAttrs = {
      class: 'lc-ui lc-ui-code',
      'data-lc-ui': 'ui-code',
      'data-lc-state': state,
      'data-language': normalizeLang(language),
      style: { '--lc-code-max-height': typeof maxHeight === 'number' ? maxHeight + 'px' : String(maxHeight || '360px') }
    };

    if (state !== 'ready') {
      return h('div', rootAttrs, [
        kit.renderStatus(state, {
          title: state === 'loading' ? '正在加载代码' : undefined,
          text: state === 'empty' ? emptyText : (state === 'error' ? '代码加载失败' : ''),
          retry: state === 'error',
          retryLabel: kit.prop(block, 'retryLabel', '重试')
        })
      ]);
    }

    var lines = highlight ? highlightLines(code, language) : code.split('\n').map(escapeHtml);
    var width = String(Math.max(1, lines.length)).length;
    var codeChildren = lines.map(function (line, index) {
      return h('span', { class: 'lc-ui-code-line' }, [
        lineNumbers ? h('span', {
          class: 'lc-ui-code-num',
          'aria-hidden': 'true',
          style: { '--lc-code-num-width': width + 'ch' }
        }, String(index + 1)) : null,
      h('span', { class: 'lc-ui-code-src' }, raw(line || '&nbsp;'))
      ]);
    });

    var head = h('div', { class: 'lc-ui-code-head' }, [
      h('span', { class: 'lc-ui-code-file' }, filename == null ? (language || 'text') : String(filename)),
      h('span', { class: 'lc-ui-code-lang' }, normalizeLang(language)),
      copyable ? h('button', {
        type: 'button',
        class: 'lc-ui-copy',
        'data-lc-copy': 'true',
        'aria-label': '复制代码'
      }, [
        kit.icon('copy', 'lc-icon-sm'),
        h('span', { class: 'lc-ui-copy-label', 'data-lc-copy-label': 'true' }, '复制')
      ]) : null
    ]);

    var copyStatus = copyable ? h('span', {
      class: 'lc-ui-sr-only',
      role: 'status',
      'aria-live': 'polite',
      'data-lc-copy-status': 'true'
    }) : null;

    return h('div', rootAttrs, [
      head,
      h('div', {
        class: 'lc-ui-code-scroll',
        tabindex: '0',
        role: 'region',
        'aria-label': (filename == null ? '代码' : '代码：' + filename) + '，可横向滚动'
      }, [
        h('pre', { class: 'lc-ui-code-pre' }, [h('code', { class: 'lc-ui-code-body' }, codeChildren)])
      ]),
      copyStatus,
      h('textarea', {
        hidden: true,
        readonly: true,
        class: 'lc-ui-code-source',
        'data-lc-code-source': 'true',
        'aria-hidden': 'true',
        tabindex: '-1'
      }, code)
    ]);
  }

  function legacyCopy(text, doc) {
    var area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    doc.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (error) { ok = false; }
    doc.body.removeChild(area);
    return ok;
  }

  function copyText(text, doc) {
    var win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (win && win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
      return win.navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return legacyCopy(text, doc);
      });
    }
    return Promise.resolve(legacyCopy(text, doc));
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var button = el.querySelector('[data-lc-copy]');
    var source = el.querySelector('[data-lc-code-source]');
    if (!button) return null;
    var destroyed = false;

    function onClick(event) {
      if (!event.target || !event.target.closest || !event.target.closest('[data-lc-copy]')) return;
      var text = source ? (source.value != null && source.value !== '' ? source.value : source.textContent) : '';
      var label = button.querySelector('[data-lc-copy-label]');
      var use = button.querySelector('.lc-icon use');
      var status = el.querySelector('[data-lc-copy-status]');
      copyText(text, el.ownerDocument).then(function (ok) {
        if (destroyed) return;
        if (label) label.textContent = ok ? '已复制' : '复制失败';
        if (use) use.setAttribute('href', ok ? '#lc-icon-check' : '#lc-icon-copy');
        button.classList.toggle('is-copied', !!ok);
        if (status) status.textContent = ok ? '代码已复制到剪贴板' : '复制失败，请手动选择代码';
        kit.emit(el, 'lc:code-copy', { ok: !!ok, length: text.length });
        setTimeout(function () {
          if (destroyed) return;
          if (label) label.textContent = '复制';
          if (use) use.setAttribute('href', '#lc-icon-copy');
          button.classList.remove('is-copied');
          if (status) status.textContent = '';
        }, 1600);
      });
    }

    el.addEventListener('click', onClick);
    var api = {
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        el.removeEventListener('click', onClick);
      }
    };
    el.__lcCode = api;
    return api;
  }

  var def = {
    type: 'ui-code',
    name: '代码块',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-code { border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-code-bg, var(--code-bg, #f6f4ec)); overflow: hidden; }',
      '.lc-ui-code-head { display: flex; align-items: center; gap: var(--lc-space-2-5); padding: 7px var(--lc-space-2-5); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); background: var(--lc-color-surface-2, var(--surface-2, transparent)); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-code-file { margin-right: auto; font-weight: var(--lc-weight-semibold, 600); }',
      '.lc-ui-code-lang { text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.8; }',
      '.lc-ui-copy { display: inline-flex; align-items: center; gap: var(--lc-space-1); padding: 3px var(--lc-space-2); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-sm, 5px); background: var(--lc-color-surface, var(--surface, transparent)); color: inherit; font: inherit; font-size: var(--lc-text-xs, 12px); cursor: pointer; }',
      '.lc-ui-copy:hover { color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-copy.is-copied { color: var(--lc-color-accent, var(--accent, #3e6a56)); border-color: var(--lc-color-accent-line, var(--accent-line, #999)); }',
      '.lc-ui-code-scroll { max-height: var(--lc-code-max-height, 360px); overflow: auto; }',
      '.lc-ui-code-pre { margin: 0; padding: var(--lc-space-2-5) 0; min-width: max-content; font-family: var(--lc-font-mono); font-size: var(--lc-text-xs, 12.5px); line-height: 1.7; tab-size: 2; }',
      '.lc-ui-code-body { display: block; min-width: max-content; }',
      '.lc-ui-code-line { display: flex; min-width: max-content; padding-right: var(--lc-space-3-5); }',
      '.lc-ui-code-num { flex: none; width: var(--lc-code-num-width, 2ch); padding: 0 var(--lc-space-2-5) 0 var(--lc-space-3); text-align: right; color: var(--lc-color-decor, #888); user-select: none; }',
      '.lc-ui-code-src { flex: 1; white-space: pre; }',
      '.lc-ui-token-comment { color: var(--lc-color-muted-2, var(--muted-2, #8a9085)); font-style: italic; }',
      '.lc-ui-token-string { color: var(--lc-color-code-string); }',
      '.lc-ui-token-number { color: var(--lc-color-code-number); }',
      '.lc-ui-token-keyword { color: var(--lc-color-code-keyword); font-weight: var(--lc-weight-semibold, 600); }',
      '.lc-ui-token-tag { color: var(--lc-color-code-tag); }',
      '.lc-ui-token-attr { color: var(--lc-color-code-attr); }',
      '.lc-ui-token-prop { color: var(--lc-color-code-prop); }',
      '.lc-ui-code-source { position: absolute !important; width: 1px; height: 1px; opacity: 0; pointer-events: none; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeLang: normalizeLang,
      highlightLine: highlightLine,
      highlightLines: highlightLines,
      normalizeCode: normalizeCode
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = def;
  else dom.Components['ui-code'] = def;

  return def;
}));
