/* 渲染核心 · 内置组件 · 时间线
   节点状态、连接线、内容插槽（Markdown / 受信任 HTML）。 */
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

  var STATUS = ['done', 'active', 'pending', 'error'];

  var SCHEMA = {
    type: 'ui-timeline',
    name: '时间线',
    version: 1,
    description: '节点状态、连接线、内容插槽。',
    states: ['ready', 'loading', 'empty', 'error'],
    props: {
      orientation: { type: 'enum', label: '方向', options: ['vertical', 'horizontal'], default: 'vertical' },
      items: {
        type: 'array',
        label: '节点',
        required: true,
        default: [],
        items: {
          type: 'object',
          props: {
            title: { type: 'string', label: '标题' },
            time: { type: 'string', label: '时间' },
            status: { type: 'enum', label: '状态', options: STATUS, default: 'pending' },
            content: { type: 'string', label: 'Markdown 内容' },
            html: { type: 'string', label: '受信任 HTML' },
            slot: { type: 'string', label: '插槽 HTML', description: '与 html 等价，便于编辑器区分。' }
          }
        }
      },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
      emptyText: { type: 'string', label: '空状态文案', default: '暂无时间线节点' }
    }
  };

  var LABEL = { done: '已完成', active: '进行中', pending: '待处理', error: '有错误' };
  var ICON = { done: 'check', active: 'info', error: 'warning', pending: null };

  function normalizeItems(items) {
    return (Array.isArray(items) ? items : []).filter(function (item) {
      return item && typeof item === 'object';
    }).map(function (item, index) {
      return {
        title: item.title == null ? '节点 ' + (index + 1) : String(item.title),
        time: item.time == null ? '' : String(item.time),
        status: STATUS.indexOf(item.status) === -1 ? 'pending' : item.status,
        content: item.content == null ? (item.md == null ? '' : item.md) : item.content,
        html: item.html == null ? (item.slot == null ? null : String(item.slot)) : String(item.html)
      };
    });
  }

  function marker(item) {
    var iconName = ICON[item.status];
    return h('span', {
      class: 'lc-ui-timeline-marker lc-ui-timeline-marker-' + item.status,
      'aria-hidden': 'true'
    }, iconName ? [kit.icon(iconName, 'lc-icon-sm')] : []);
  }

  function render(block, ctx) {
    var items = normalizeItems(kit.prop(block, 'items', []));
    var state = kit.stateOf(block, items.length > 0);
    var orientation = kit.prop(block, 'orientation', 'vertical') === 'horizontal' ? 'horizontal' : 'vertical';
    var emptyText = kit.prop(block, 'emptyText', '暂无时间线节点');

    var rootAttrs = {
      class: 'lc-ui lc-ui-timeline-root lc-ui-timeline-' + orientation,
      'data-lc-ui': 'ui-timeline',
      'data-lc-state': state
    };

    if (state !== 'ready') {
      return h('div', rootAttrs, [
        kit.renderStatus(state, {
          title: state === 'loading' ? '正在加载时间线' : undefined,
          text: state === 'empty' ? emptyText : (state === 'error' ? '时间线加载失败' : ''),
          retry: state === 'error',
          retryLabel: kit.prop(block, 'retryLabel', '重试')
        })
      ]);
    }

    var children = items.map(function (item, index) {
      var bodyChildren = [
        h('div', { class: 'lc-ui-timeline-head' }, [
          item.time ? h('span', { class: 'lc-ui-timeline-time' }, item.time) : null,
          h('h3', { class: 'lc-ui-timeline-title' }, item.title)
        ])
      ];
      var slot = [];
      if (item.html != null) slot.push(raw(kit.trustedHtml(item.html)));
      if (item.content != null && item.content !== '') slot.push(raw(kit.contentHtml(ctx, item.content)));
      if (slot.length) {
        bodyChildren.push(h('div', { class: 'lc-ui-timeline-content', 'data-lc-slot': 'content' }, slot));
      }
      bodyChildren.push(h('span', { class: 'lc-ui-sr-only' }, '状态：' + (LABEL[item.status] || '待处理')));
      return h('li', {
        class: 'lc-ui-timeline-item lc-ui-timeline-item-' + item.status,
        'data-lc-timeline-item': String(index),
        'data-status': item.status
      }, [
        marker(item),
        h('div', { class: 'lc-ui-timeline-body' }, bodyChildren)
      ]);
    });

    return h('div', rootAttrs, [
      h('ol', { class: 'lc-ui-timeline', 'aria-label': kit.prop(block, 'label', '时间线') }, children)
    ]);
  }

  var def = {
    type: 'ui-timeline',
    name: '时间线',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-timeline-root { min-width: 0; }',
      '.lc-ui-timeline { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }',
      '.lc-ui-timeline-item { position: relative; display: flex; gap: var(--lc-space-3); padding: 0 0 18px; min-width: 0; }',
      '.lc-ui-timeline-item:last-child { padding-bottom: 0; }',
      '.lc-ui-timeline-item::before { content: ""; position: absolute; top: 22px; bottom: 0; left: 7px; width: 1px; background: var(--lc-color-line, var(--line, #ddd)); }',
      '.lc-ui-timeline-item:last-child::before { display: none; }',
      '.lc-ui-timeline-marker { position: relative; z-index: 1; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; margin-top: var(--lc-space-1); border-radius: 50%; border: 2px solid var(--lc-color-line, var(--line, #ddd)); background: var(--lc-color-surface, var(--surface, #fff)); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-timeline-marker .lc-icon { width: 9px; height: 9px; }',
      '.lc-ui-timeline-marker-done { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); background: var(--lc-color-accent, var(--accent, #3e6a56)); color: var(--lc-color-on-accent, #fff); }',
      '.lc-ui-timeline-marker-active { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); color: var(--lc-color-accent, var(--accent, #3e6a56)); box-shadow: 0 0 0 3px var(--lc-color-accent-soft, var(--accent-soft, transparent)); }',
      '.lc-ui-timeline-marker-error { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-timeline-body { min-width: 0; flex: 1; }',
      '.lc-ui-timeline-head { display: flex; align-items: baseline; gap: var(--lc-space-2-5); flex-wrap: wrap; }',
      '.lc-ui-timeline-time { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); font-variant-numeric: tabular-nums; }',
      '.lc-ui-timeline-title { margin: 0; font-size: var(--lc-text-md, 15px); font-weight: var(--lc-weight-semibold, 600); }',
      '.lc-ui-timeline-content { margin-top: var(--lc-space-1); font-size: var(--lc-text-sm, 13px); color: var(--lc-color-ink-2, var(--ink-2, inherit)); }',
      '.lc-ui-timeline-content > *:first-child { margin-top: 0; }',
      '.lc-ui-timeline-content > *:last-child { margin-bottom: 0; }',
      '.lc-ui-timeline-horizontal .lc-ui-timeline { flex-direction: row; gap: 0; overflow-x: auto; }',
      '.lc-ui-timeline-horizontal .lc-ui-timeline-item { flex: 1 0 200px; flex-direction: column; gap: var(--lc-space-2); padding: 0 var(--lc-space-4) 0 0; }',
      '.lc-ui-timeline-horizontal .lc-ui-timeline-item::before { top: 7px; bottom: auto; left: 22px; right: 0; width: auto; height: 1px; }',
      '.lc-ui-timeline-horizontal .lc-ui-timeline-item:last-child::before { display: none; }'
    ].join('\n'),
    render: render,
    helpers: {
      normalizeItems: normalizeItems,
      statuses: STATUS.slice()
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = def;
  else dom.Components['ui-timeline'] = def;

  return def;
}));
