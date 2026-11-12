/* 渲染核心 · 内置组件 · 加载与空状态
   把骨架屏、占位、错误重试收敛成统一形态；其他组件通过公共基座复用同一套标记。 */
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

  var KINDS = ['loading', 'empty', 'error'];

  var SCHEMA = {
    type: 'ui-state',
    name: '加载与空状态',
    version: 1,
    description: '骨架屏、占位、错误重试的统一形态。',
    states: ['loading', 'empty', 'error'],
    events: ['lc:state-retry'],
    props: {
      kind: { type: 'enum', label: '类型', options: KINDS, default: 'empty' },
      title: { type: 'string', label: '标题' },
      text: { type: 'string', label: '说明文字' },
      variant: { type: 'enum', label: '加载形态', options: ['spinner', 'skeleton'], default: 'spinner' },
      lines: { type: 'number', label: '骨架行数', default: 3, min: 1, max: 8 },
      retry: { type: 'boolean', label: '显示重试', default: true },
      retryLabel: { type: 'string', label: '重试按钮', default: '重试' },
      compact: { type: 'boolean', label: '紧凑', default: false }
    }
  };

  function resolveKind(block) {
    var kind = kit.prop(block, 'kind', null) || kit.prop(block, 'state', null);
    if (kind === 'loading' || kind === 'empty' || kind === 'error') return kind;
    if (kit.prop(block, 'loading', false) === true) return 'loading';
    if (kit.prop(block, 'error', null) != null && kit.prop(block, 'error', null) !== false) return 'error';
    return 'empty';
  }

  function render(block) {
    var kind = resolveKind(block);
    var variant = kit.prop(block, 'variant', 'spinner') === 'skeleton' ? 'skeleton' : 'spinner';
    var lines = kit.num(kit.prop(block, 'lines', 3), 3);
    var retry = kit.bool(kit.prop(block, 'retry', true), true);
    var compact = kit.bool(kit.prop(block, 'compact', false), false);

    return h('div', {
      class: 'lc-ui lc-ui-state-card' + (compact ? ' is-compact' : ''),
      'data-lc-ui': 'ui-state',
      'data-lc-state': kind,
      'data-lc-kind': kind
    }, [
      kit.renderStatus(kind, {
        title: kit.prop(block, 'title', null),
        text: kit.prop(block, 'text', null),
        variant: variant,
        lines: lines,
        retry: retry,
        retryLabel: kit.prop(block, 'retryLabel', '重试')
      })
    ]);
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var destroyed = false;
    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest || !target.closest('[data-lc-retry]')) return;
      var kind = el.getAttribute('data-lc-kind') || el.getAttribute('data-lc-state') || '';
      kit.emit(el, 'lc:state-retry', { kind: kind });
    }
    el.addEventListener('click', onClick);
    var api = {
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        el.removeEventListener('click', onClick);
      }
    };
    el.__lcState = api;
    return api;
  }

  var def = {
    type: 'ui-state',
    name: '加载与空状态',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-state-card .lc-ui-state { border-radius: var(--lc-radius-md, var(--radius, 8px)); }',
      '.lc-ui-state-card.is-compact .lc-ui-state { padding: var(--lc-space-2-5) var(--lc-space-3); }',
      '.lc-ui-state-card.is-compact .lc-ui-state-title { font-size: var(--lc-text-sm, 13px); }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: { resolveKind: resolveKind, kinds: KINDS.slice() }
  };

  if (typeof module === 'object' && module.exports) module.exports = def;
  else dom.Components['ui-state'] = def;

  return def;
}));
