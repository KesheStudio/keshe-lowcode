/* 渲染核心 · 内置组件公共基座
   只放与具体组件无关的通用能力：状态解析、统一占位形态、图标、JSON 数据岛、事件派发。
   组件之间不互相引用；它们只依赖本文件与渲染核心的公开模块（dom / markdown / 引擎 ctx）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../dom.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.ComponentsCommon = factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  var h = R.h;
  var raw = R.raw;
  var escapeHtml = R.escapeHtml;

  /* 统一状态形态：骨架屏、加载、空、错误、重试。所有内置组件都复用这套标记与样式，
     但只通过本文件（公共基座）复用，不读取其他组件的内部实现。 */
  var COMMON_CSS = [
    '/* lc-ui-common */',
    '.lc-ui { min-width: 0; color: var(--lc-color-ink, var(--ink, inherit)); font-size: var(--lc-text-md, 15px); line-height: var(--lc-leading-base, 1.6); }',
    '.lc-ui button:focus-visible, .lc-ui a:focus-visible, .lc-ui [tabindex]:focus-visible, .lc-ui input:focus-visible, .lc-ui select:focus-visible, .lc-ui textarea:focus-visible { outline: 2px solid var(--lc-color-accent, var(--accent, #3e6a56)); outline-offset: 2px; }',
    '.lc-ui-state { display: flex; align-items: flex-start; gap: var(--lc-space-2-5); padding: var(--lc-space-4); border: var(--lc-border-width, 1px) dashed var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface-2, var(--surface-2, transparent)); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-state-error { border-style: solid; border-color: var(--lc-color-danger-line); }',
    '.lc-ui-state-icon { color: var(--lc-color-accent, var(--accent, currentColor)); }',
    '.lc-ui-state-body { min-width: 0; }',
    '.lc-ui-state-title { margin: 0; font-size: var(--lc-text-md, 15px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink, var(--ink, inherit)); }',
    '.lc-ui-state-title + .lc-ui-state-text { margin-top: var(--lc-space-1); }',
    '.lc-ui-state-text { margin: 0; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-spinner { width: 18px; height: 18px; flex: none; margin-top: 2px; border-radius: 50%; border: 2px solid var(--lc-color-line, var(--line, #ddd)); border-top-color: var(--lc-color-accent, var(--accent, #3e6a56)); animation: lc-ui-spin 0.8s linear infinite; }',
    '@keyframes lc-ui-spin { to { transform: rotate(360deg); } }',
    '.lc-ui-skeleton { margin-top: var(--lc-space-2-5); }',
    '.lc-ui-skeleton-line { display: block; height: 10px; margin-top: var(--lc-space-2); border-radius: var(--lc-radius-sm); background: var(--lc-color-surface-3, var(--surface-3, #e7e3d8)); animation: lc-ui-pulse 1.4s ease-in-out infinite; }',
    '.lc-ui-skeleton-line:nth-child(2n) { width: 82%; animation-delay: 0.2s; }',
    '.lc-ui-skeleton-line:nth-child(3n) { width: 64%; animation-delay: 0.4s; }',
    '@keyframes lc-ui-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.9; } }',
    '.lc-ui-action { display: inline-flex; align-items: center; gap: var(--lc-space-1-5); padding: 7px var(--lc-space-3-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, transparent)); color: var(--lc-color-ink, var(--ink, inherit)); font: inherit; font-size: var(--lc-text-sm, 13px); cursor: pointer; }',
    '.lc-ui-action:hover:not([disabled]) { border-color: var(--lc-color-accent-line, var(--accent-line, #999)); color: var(--lc-color-accent, var(--accent, currentColor)); }',
    '.lc-ui-action[disabled] { opacity: 0.55; cursor: not-allowed; }',
    '.lc-ui-action-primary { border-color: var(--lc-color-accent-fill); background: var(--lc-color-accent-fill); color: var(--lc-color-on-accent); }',
    '.lc-ui-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: var(--lc-border-width, 1px) solid transparent; border-radius: var(--lc-radius-md, var(--radius, 8px)); background: transparent; color: var(--lc-color-muted, var(--muted, #666)); cursor: pointer; }',
    '.lc-ui-icon-btn:hover { color: var(--lc-color-accent, var(--accent, currentColor)); border-color: var(--lc-color-line, var(--line, #ddd)); }',
    '.lc-ui-sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
    '@media (prefers-reduced-motion: reduce) { .lc-ui-spinner { animation-duration: 2.4s; } .lc-ui-skeleton-line { animation: none; opacity: 0.6; } }'
  ].join('\n');

  var seq = 0;

  function uid(prefix) {
    seq += 1;
    return (prefix || 'lc-ui') + '-' + seq;
  }

  /* 属性读取：优先 block.props，其次 block 自身，最后默认值。缺字段永远不抛错。 */
  function prop(block, key, fallback) {
    if (block && block.props && Object.prototype.hasOwnProperty.call(block.props, key)) return block.props[key];
    if (block && Object.prototype.hasOwnProperty.call(block, key)) return block[key];
    return fallback;
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function num(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /* 状态约定：ready / loading / empty / error。显式 state 优先，
     其次 loading/error 简写，最后按数据是否存在降级为空。 */
  function stateOf(block, hasData) {
    var explicit = prop(block, 'state', null) || prop(block, 'status', null) || prop(block, 'dataState', null);
    if (explicit === 'ready' || explicit === 'loading' || explicit === 'empty' || explicit === 'error') return explicit;
    if (prop(block, 'loading', false) === true) return 'loading';
    if (prop(block, 'error', null) != null && prop(block, 'error', null) !== false) return 'error';
    if (hasData === false) return 'empty';
    return 'ready';
  }

  function defaultTitle(kind) {
    if (kind === 'loading') return '正在加载';
    if (kind === 'error') return '加载失败';
    return '暂无内容';
  }

  function skeleton(lines) {
    var count = Math.max(1, Math.min(8, num(lines, 3)));
    var bars = [];
    for (var i = 0; i < count; i += 1) bars.push(h('span', { class: 'lc-ui-skeleton-line' }));
    return h('div', { class: 'lc-ui-skeleton', 'data-lc-skeleton': 'true' }, bars);
  }

  function icon(name, className) {
    return h('svg', {
      class: 'lc-icon' + (className ? ' ' + className : ''),
      'aria-hidden': 'true',
      focusable: 'false'
    }, [h('use', { href: '#lc-icon-' + name })]);
  }

  /* 统一占位：组件内部只调用这个函数，不读取其他组件的标记。 */
  function renderStatus(kind, options) {
    var opts = options || {};
    var state = kind === 'loading' || kind === 'empty' || kind === 'error' ? kind : 'empty';
    var body = [h('p', { class: 'lc-ui-state-title' }, opts.title != null ? String(opts.title) : defaultTitle(state))];
    if (opts.text != null && String(opts.text) !== '') {
      body.push(h('p', { class: 'lc-ui-state-text' }, String(opts.text)));
    }
    if (state === 'loading' && opts.variant === 'skeleton') {
      body.push(skeleton(opts.lines));
    }
    if (state === 'error' && opts.retry !== false) {
      body.push(h('button', {
        type: 'button',
        class: 'lc-ui-action',
        'data-lc-retry': 'true'
      }, [icon('warning', 'lc-icon-sm'), opts.retryLabel != null ? String(opts.retryLabel) : '重试']));
    }
    var mark = state === 'loading' ? h('span', { class: 'lc-ui-spinner', 'aria-hidden': 'true' })
      : icon(state === 'error' ? 'warning' : 'info', 'lc-ui-state-icon');
    return h('div', {
      class: 'lc-ui-state lc-ui-state-' + state,
      'data-lc-state': state,
      role: state === 'error' ? 'alert' : 'status',
      'aria-live': state === 'error' ? 'assertive' : 'polite'
    }, [mark, h('div', { class: 'lc-ui-state-body' }, body)]);
  }

  /* Markdown 内容由引擎 ctx 提供；ctx 不可用时退回纯文本，避免组件抛错。 */
  function contentHtml(ctx, value) {
    if (value == null || value === '') return '';
    try {
      if (ctx && typeof ctx.markdown === 'function') return String(ctx.markdown(String(value)) || '');
    } catch (error) { /* 降级为纯文本 */ }
    return '<p>' + escapeHtml(value) + '</p>';
  }

  function trustedHtml(value) {
    return value == null ? '' : String(value);
  }

  /* 数据岛：把交互所需的原始数据随 HTML 一起带走，供静态导出后的运行时读取。 */
  function jsonIsland(value) {
    var json = JSON.stringify(value == null ? {} : value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    return '<script type="application/json" class="lc-ui-data">' + json + '</script>';
  }

  function readJsonScript(el, className) {
    if (!el || typeof el.querySelector !== 'function') return null;
    var node = el.querySelector('script.' + (className || 'lc-ui-data'));
    if (!node) return null;
    try { return JSON.parse(node.textContent || node.innerHTML || '{}'); } catch (error) { return null; }
  }

  function emit(el, name, detail) {
    if (!el || typeof el.dispatchEvent !== 'function') return null;
    var doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var win = doc && doc.defaultView;
    var event;
    try {
      if (win && typeof win.CustomEvent === 'function') {
        event = new win.CustomEvent(name, { detail: detail, bubbles: true, cancelable: true });
      } else if (typeof CustomEvent === 'function') {
        event = new CustomEvent(name, { detail: detail, bubbles: true, cancelable: true });
      } else if (doc && doc.createEvent) {
        event = doc.createEvent('CustomEvent');
        event.initCustomEvent(name, true, true, detail);
      }
    } catch (error) {
      event = null;
    }
    if (event) el.dispatchEvent(event);
    return event;
  }

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return [];
    var list = Array.prototype.slice.call(node.querySelectorAll(FOCUSABLE));
    return list.filter(function (el) {
      if (!el || el.hidden) return false;
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
      if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
      return true;
    });
  }

  function show(el, visible) {
    if (!el) return;
    if (visible) {
      el.removeAttribute('hidden');
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.setAttribute('hidden', '');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function selectedValues(el) {
    var out = [];
    if (!el) return out;
    Array.prototype.slice.call(el.querySelectorAll('input[type="checkbox"]:checked')).forEach(function (input) {
      out.push(input.value);
    });
    return out;
  }

  function focusFirst(node) {
    var list = focusables(node);
    if (list.length) {
      try { list[0].focus(); } catch (error) { /* 忽略 */ }
      return list[0];
    }
    if (node && typeof node.focus === 'function') {
      try { node.focus(); } catch (error) { /* 忽略 */ }
    }
    return node;
  }

  R.ComponentsCommon = {
    css: COMMON_CSS,
    uid: uid,
    prop: prop,
    toArray: toArray,
    num: num,
    bool: bool,
    clamp: clamp,
    stateOf: stateOf,
    renderStatus: renderStatus,
    skeleton: skeleton,
    icon: icon,
    contentHtml: contentHtml,
    trustedHtml: trustedHtml,
    jsonIsland: jsonIsland,
    readJsonScript: readJsonScript,
    emit: emit,
    focusables: focusables,
    focusFirst: focusFirst,
    show: show,
    selectedValues: selectedValues,
    FOCUSABLE: FOCUSABLE,
    h: h,
    raw: raw,
    escapeHtml: escapeHtml
  };

  return R.ComponentsCommon;
}));
