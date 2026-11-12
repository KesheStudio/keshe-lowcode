/* 渲染核心 · 内置组件 · 标签页
   切换、懒加载面板、方向键/Home/End 键盘切换；面板使用 template 延迟实例化。 */
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

  var SCHEMA = {
    type: 'ui-tabs',
    name: '标签页',
    version: 1,
    description: '切换、懒加载内容、方向键切换。',
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:tabs-change'],
    props: {
      label: { type: 'string', label: '标签组名称', default: '标签页' },
      active: { type: 'string', label: '初始激活', description: '标签 id 或序号；缺省第一个可用项。' },
      items: {
        type: 'array',
        label: '标签项',
        required: true,
        default: [],
        items: {
          type: 'object',
          props: {
            id: { type: 'string', label: '标识' },
            label: { type: 'string', label: '标签文字' },
            content: { type: 'string', label: 'Markdown 内容' },
            html: { type: 'string', label: '受信任 HTML' },
            lazy: { type: 'boolean', label: '懒加载', default: false },
            disabled: { type: 'boolean', label: '禁用', default: false }
          }
        }
      },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
      emptyText: { type: 'string', label: '空状态文案', default: '还没有标签页' }
    }
  };

  function normalizeItems(items) {
    return (Array.isArray(items) ? items : []).filter(function (item) {
      return item && typeof item === 'object';
    }).map(function (item, index) {
      return {
        id: String(item.id == null ? 'tab-' + (index + 1) : item.id),
        label: String(item.label == null ? '标签 ' + (index + 1) : item.label),
        content: item.content == null ? (item.md == null ? '' : item.md) : item.content,
        html: item.html == null ? null : String(item.html),
        lazy: item.lazy === true,
        disabled: item.disabled === true
      };
    });
  }

  function resolveActive(items, active) {
    if (!items.length) return -1;
    if (active != null && active !== '') {
      var text = String(active);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].id === text) return items[i].disabled ? -1 : i;
      }
      var number = Number(active);
      if (isFinite(number) && items[number] && !items[number].disabled) return number;
    }
    for (var j = 0; j < items.length; j += 1) {
      if (!items[j].disabled) return j;
    }
    return -1;
  }

  function nextTabIndex(items, from, delta) {
    var list = items || [];
    if (!list.length) return -1;
    var total = list.length;
    var index = from == null ? -1 : from;
    var step = delta || 1;
    for (var i = 0; i < total; i += 1) {
      index = (index + step + total) % total;
      if (!list[index].disabled) return index;
    }
    return -1;
  }

  function panelContent(item, ctx) {
    var content = [];
    if (item.html != null) content.push(raw(kit.trustedHtml(item.html)));
    if (item.content != null && item.content !== '') content.push(raw(kit.contentHtml(ctx, item.content)));
    if (!content.length) content.push(h('p', {}, '（空面板）'));
    return content;
  }

  function render(block, ctx) {
    var items = normalizeItems(kit.prop(block, 'items', []));
    var state = kit.stateOf(block, items.length > 0);
    var active = resolveActive(items, kit.prop(block, 'active', null));
    var label = String(kit.prop(block, 'label', '标签页'));
    var emptyText = kit.prop(block, 'emptyText', '还没有标签页');
    var groupId = kit.uid('lc-tabs');

    var rootAttrs = {
      class: 'lc-ui lc-ui-tabs',
      'data-lc-ui': 'ui-tabs',
      'data-lc-state': state
    };

    if (state !== 'ready') {
      return h('div', rootAttrs, [
        kit.renderStatus(state, {
          title: state === 'loading' ? '正在加载标签页' : undefined,
          text: state === 'empty' ? emptyText : (state === 'error' ? '标签页加载失败' : ''),
          retry: state === 'error',
          retryLabel: kit.prop(block, 'retryLabel', '重试')
        }),
        raw(kit.jsonIsland({ items: items, active: active }))
      ]);
    }

    var tabs = items.map(function (item, index) {
      var tabId = groupId + '-tab-' + index;
      var panelId = groupId + '-panel-' + index;
      return h('button', {
        type: 'button',
        role: 'tab',
        id: tabId,
        class: 'lc-ui-tab' + (index === active ? ' is-active' : ''),
        'aria-selected': index === active ? 'true' : 'false',
        'aria-controls': panelId,
        tabindex: index === active ? '0' : '-1',
        'data-lc-tab': String(index),
        disabled: item.disabled ? true : null
      }, item.label);
    });

    var panels = items.map(function (item, index) {
      var tabId = groupId + '-tab-' + index;
      var panelId = groupId + '-panel-' + index;
      var attrs = {
        role: 'tabpanel',
        id: panelId,
        class: 'lc-ui-tabpanel',
        'aria-labelledby': tabId,
        tabindex: '0',
        'data-lc-panel': String(index),
        hidden: index === active ? null : true
      };
      if (item.lazy && index !== active) {
        return h('div', attrs, []);
      }
      return h('div', attrs, panelContent(item, ctx));
    });

    var lazyTemplates = items.map(function (item, index) {
      if (!item.lazy) return null;
      return h('template', {
        'data-lc-tab-template': String(index),
        'data-lc-loaded': index === active ? 'true' : 'false'
      }, panelContent(item, ctx));
    });

    var children = [
      h('div', { class: 'lc-ui-tablist', role: 'tablist', 'aria-label': label }, tabs),
      h('div', { class: 'lc-ui-tabpanels' }, panels)
    ].concat(lazyTemplates.filter(Boolean));
    children.push(raw(kit.jsonIsland({ items: items, active: active, label: label })));

    return h('div', rootAttrs, children);
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var data = kit.readJsonScript(el);
    if (!data || !Array.isArray(data.items)) return null;
    var items = data.items;
    var tablist = el.querySelector('[role="tablist"]');
    if (!tablist) return null;
    var destroyed = false;

    function tabs() {
      return Array.prototype.slice.call(tablist.querySelectorAll('[data-lc-tab]'));
    }

    function panels() {
      return Array.prototype.slice.call(el.querySelectorAll('[data-lc-panel]'));
    }

    function currentIndex() {
      var list = tabs();
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].getAttribute('aria-selected') === 'true') return Number(list[i].getAttribute('data-lc-tab'));
      }
      return -1;
    }

    function loadPanel(index) {
      var panel = panels()[index];
      if (!panel) return;
      var template = el.querySelector('template[data-lc-tab-template="' + index + '"]');
      if (!template || template.getAttribute('data-lc-loaded') === 'true') return;
      var fragment = template.content;
      if (fragment) {
        var holder = panel;
        while (holder.firstChild) holder.removeChild(holder.firstChild);
        holder.appendChild(fragment.cloneNode(true));
      }
      template.setAttribute('data-lc-loaded', 'true');
    }

    function activate(index, focusTab) {
      var list = tabs();
      if (!list[index]) return;
      if (items[index] && items[index].disabled) return;
      loadPanel(index);
      list.forEach(function (tab, i) {
        var selected = i === index;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.setAttribute('tabindex', selected ? '0' : '-1');
        tab.classList.toggle('is-active', selected);
      });
      panels().forEach(function (panel, i) {
        if (i === index) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });
      if (focusTab) {
        try { list[index].focus(); } catch (error) { /* 忽略 */ }
      }
      kit.emit(el, 'lc:tabs-change', {
        index: index,
        id: items[index] ? items[index].id : '',
        label: items[index] ? items[index].label : ''
      });
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var tab = target.closest('[data-lc-tab]');
      if (!tab) return;
      var index = Number(tab.getAttribute('data-lc-tab'));
      if (!isFinite(index)) return;
      activate(index, false);
    }

    function onKeydown(event) {
      var target = event.target;
      if (!target || !target.closest || !target.closest('[data-lc-tab]')) return;
      var index = currentIndex();
      if (index === -1) return;
      var next = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = nextTabIndex(items, index, 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = nextTabIndex(items, index, -1);
      else if (event.key === 'Home') next = nextTabIndex(items, -1, 1);
      else if (event.key === 'End') next = nextTabIndex(items, items.length, -1);
      if (next === -1) return;
      event.preventDefault();
      activate(next, true);
    }

    tablist.addEventListener('click', onClick);
    tablist.addEventListener('keydown', onKeydown);

    var start = currentIndex();
    if (start === -1) start = resolveActive(items, data.active);
    if (start >= 0) loadPanel(start);

    var api = {
      activate: function (index) { activate(index, false); },
      getIndex: currentIndex,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        tablist.removeEventListener('click', onClick);
        tablist.removeEventListener('keydown', onKeydown);
      }
    };
    el.__lcTabs = api;
    return api;
  }

  var def = {
    type: 'ui-tabs',
    name: '标签页',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-tabs { display: flex; flex-direction: column; gap: var(--lc-space-2-5); }',
      '.lc-ui-tablist { display: flex; flex-wrap: wrap; gap: var(--lc-space-1); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); }',
      '.lc-ui-tab { padding: 7px var(--lc-space-3-5); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--lc-color-muted, var(--muted, #666)); font: inherit; font-size: var(--lc-text-sm, 13px); cursor: pointer; }',
      '.lc-ui-tab:hover:not([disabled]) { color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-tab.is-active { border-bottom-color: var(--lc-color-accent, var(--accent, #3e6a56)); color: var(--lc-color-accent, var(--accent, #3e6a56)); font-weight: var(--lc-weight-semibold, 600); }',
      '.lc-ui-tab[disabled] { opacity: 0.5; cursor: not-allowed; }',
      '.lc-ui-tabpanel { padding: var(--lc-space-2) 2px; outline: none; }',
      '.lc-ui-tabpanel[hidden] { display: none; }',
      '.lc-ui-tabpanel > *:first-child { margin-top: 0; }',
      '.lc-ui-tabpanel > *:last-child { margin-bottom: 0; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeItems: normalizeItems,
      resolveActive: resolveActive,
      nextTabIndex: nextTabIndex
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = def;
  else dom.Components['ui-tabs'] = def;

  return def;
}));
