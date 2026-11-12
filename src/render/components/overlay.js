/* 渲染核心 · 内置组件 · 弹窗与抽屉
   打开/关闭、遮罩、Esc、焦点收进与归还、Tab 环绕；多层打开时用模块级栈保证不串层。
   modal 与 drawer 共用同一套行为，只是布局类不同。 */
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

  /* 打开中的浮层栈：只有栈顶响应 Esc，避免嵌套时一次关掉两层。 */
  var openStack = [];

  function trapStep(index, total, shift) {
    if (!total || total < 1) return -1;
    if (shift) return index <= 0 ? total - 1 : index - 1;
    return index >= total - 1 ? 0 : index + 1;
  }

  function commonProps(variant) {
    var base = {
      title: { type: 'string', label: '标题', default: variant === 'drawer' ? '抽屉' : '对话框' },
      triggerLabel: { type: 'string', label: '触发按钮', default: variant === 'drawer' ? '打开抽屉' : '打开对话框' },
      overlayId: { type: 'string', label: '浮层标识', description: '供 data-lc-open-overlay 引用；缺省用区块 id。' },
      body: { type: 'string', label: '正文', description: '按 Markdown 渲染。' },
      html: { type: 'string', label: '附加 HTML', description: '受信任片段，追加在正文之后。' },
      footer: { type: 'string', label: '底部文字' },
      size: { type: 'enum', label: '尺寸', options: ['sm', 'md', 'lg'], default: 'md' },
      open: { type: 'boolean', label: '初始打开', default: false },
      closeOnMask: { type: 'boolean', label: '点击遮罩关闭', default: true },
      closeOnEsc: { type: 'boolean', label: 'Esc 关闭', default: true },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    };
    if (variant === 'drawer') {
      base.placement = { type: 'enum', label: '方向', options: ['right', 'left', 'bottom'], default: 'right' };
    }
    return base;
  }

  function schemaFor(variant) {
    return {
      type: 'ui-' + variant,
      name: variant === 'modal' ? '弹窗' : '抽屉',
      version: 1,
      description: '焦点收进与归还、Esc 与遮罩关闭、嵌套不串层。',
      states: ['ready', 'loading', 'empty', 'error'],
      events: ['lc:overlay-open', 'lc:overlay-close'],
      props: commonProps(variant)
    };
  }

  function renderOverlay(block, ctx, variant) {
    var title = String(kit.prop(block, 'title', variant === 'drawer' ? '抽屉' : '对话框'));
    var triggerLabel = String(kit.prop(block, 'triggerLabel', variant === 'drawer' ? '打开抽屉' : '打开对话框'));
    var overlayId = String(kit.prop(block, 'overlayId', '') || kit.uid('lc-overlay'));
    var open = kit.bool(kit.prop(block, 'open', false), false);
    var closeOnMask = kit.bool(kit.prop(block, 'closeOnMask', true), true);
    var closeOnEsc = kit.bool(kit.prop(block, 'closeOnEsc', true), true);
    var size = ['sm', 'md', 'lg'].indexOf(kit.prop(block, 'size', 'md')) === -1 ? 'md' : kit.prop(block, 'size', 'md');
    var placement = ['right', 'left', 'bottom'].indexOf(kit.prop(block, 'placement', 'right')) === -1
      ? 'right' : kit.prop(block, 'placement', 'right');
    var state = kit.stateOf(block, true);
    var titleId = kit.uid('lc-overlay-title');
    var bodyId = kit.uid('lc-overlay-body');

    var body = [];
    if (state === 'ready') {
      if (kit.prop(block, 'body', null) != null) {
        body.push(raw(kit.contentHtml(ctx, kit.prop(block, 'body', ''))));
      }
      if (kit.prop(block, 'html', null) != null) {
        body.push(raw(kit.trustedHtml(kit.prop(block, 'html', ''))));
      }
      if (!body.length) body.push(h('p', {}, '这里是' + (variant === 'drawer' ? '抽屉' : '对话框') + '内容。'));
    } else {
      body.push(kit.renderStatus(state, {
        title: state === 'loading' ? '正在打开' : undefined,
        text: state === 'empty' ? '没有可显示的内容' : '',
        retry: false
      }));
    }

    var panelChildren = [
      h('div', { class: 'lc-ui-overlay-head' }, [
        h('h2', { class: 'lc-ui-overlay-title', id: titleId }, title),
        h('button', {
          type: 'button',
          class: 'lc-ui-icon-btn lc-ui-overlay-close',
          'data-lc-overlay-close': 'true',
          'aria-label': '关闭' + (variant === 'drawer' ? '抽屉' : '对话框')
        }, [kit.icon('close')])
      ]),
      h('div', { class: 'lc-ui-overlay-body', id: bodyId }, body),
      kit.prop(block, 'footer', null) != null
        ? h('div', { class: 'lc-ui-overlay-foot' }, String(kit.prop(block, 'footer', '')))
        : null
    ];

    var panelAttrs = {
      class: 'lc-ui-overlay-panel lc-ui-overlay-panel-' + variant +
        ' lc-ui-overlay-size-' + size + (variant === 'drawer' ? ' lc-ui-drawer-' + placement : ''),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-lc-overlay-panel': 'true',
      tabindex: '-1'
    };

    return h('div', {
      class: 'lc-ui lc-ui-overlay lc-ui-overlay-' + variant,
      'data-lc-ui': 'ui-' + variant,
      'data-lc-state': state,
      'data-lc-overlay-id': overlayId,
      'data-open': open ? 'true' : 'false',
      'data-close-on-mask': closeOnMask ? 'true' : 'false',
      'data-close-on-esc': closeOnEsc ? 'true' : 'false'
    }, [
      h('button', {
        type: 'button',
        class: 'lc-ui-action lc-ui-overlay-trigger',
        'data-lc-overlay-open': overlayId,
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false'
      }, [kit.icon('chevron-right', 'lc-icon-sm'), triggerLabel]),
      h('div', {
        class: 'lc-ui-overlay-backdrop',
        'data-lc-overlay-backdrop': 'true',
        hidden: open ? null : true
      }, [h('div', panelAttrs, panelChildren)])
    ]);
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var doc = el.ownerDocument;
    var backdrop = el.querySelector('[data-lc-overlay-backdrop]');
    var panel = el.querySelector('[data-lc-overlay-panel]');
    var trigger = el.querySelector('[data-lc-overlay-open]');
    if (!backdrop || !panel) return null;

    var closeOnMask = el.getAttribute('data-close-on-mask') !== 'false';
    var closeOnEsc = el.getAttribute('data-close-on-esc') !== 'false';
    var opened = false;
    var returnFocus = null;
    var destroyed = false;
    var overlayId = el.getAttribute('data-lc-overlay-id') || '';

    function stackIndex() {
      for (var i = 0; i < openStack.length; i += 1) {
        if (openStack[i].el === el) return i;
      }
      return -1;
    }

    function isTop() {
      return openStack.length > 0 && openStack[openStack.length - 1].el === el;
    }

    function syncTrigger() {
      if (trigger) trigger.setAttribute('aria-expanded', opened ? 'true' : 'false');
      el.setAttribute('data-open', opened ? 'true' : 'false');
    }

    function open(origin) {
      if (opened) return;
      opened = true;
      returnFocus = origin || trigger || doc.activeElement;
      backdrop.removeAttribute('hidden');
      syncTrigger();
      openStack.push({ el: el });
      kit.focusFirst(panel);
      kit.emit(el, 'lc:overlay-open', { id: overlayId, type: el.getAttribute('data-lc-ui') });
    }

    function close() {
      if (!opened) return;
      opened = false;
      backdrop.setAttribute('hidden', '');
      syncTrigger();
      var index = stackIndex();
      if (index !== -1) openStack.splice(index, 1);
      var target = returnFocus;
      returnFocus = null;
      if (target && typeof target.focus === 'function' && doc.contains(target)) {
        try { target.focus(); } catch (error) { /* 忽略 */ }
      }
      kit.emit(el, 'lc:overlay-close', { id: overlayId, type: el.getAttribute('data-lc-ui') });
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var closeBtn = target.closest('[data-lc-overlay-close]');
      if (closeBtn && el.contains(closeBtn)) {
        event.preventDefault();
        close();
        return;
      }
      var opener = target.closest('[data-lc-overlay-open]');
      if (opener) {
        var wanted = opener.getAttribute('data-lc-overlay-open');
        /* 指向自己的触发器（组件自带的「打开对话框」按钮）要直接打开本浮层；
           否则 targetRoot === el 会被下面的跨浮层判断跳过，按钮点了没反应。 */
        if (!wanted || wanted === overlayId) {
          event.preventDefault();
          open(opener);
          return;
        }
        var roots = Array.prototype.slice.call(doc.querySelectorAll('[data-lc-overlay-id]'));
        var targetRoot = null;
        roots.forEach(function (item) {
          if (!targetRoot && item.getAttribute('data-lc-overlay-id') === wanted) targetRoot = item;
        });
        if (targetRoot && targetRoot !== el) {
          event.preventDefault();
          if (targetRoot.__lcOverlay && typeof targetRoot.__lcOverlay.open === 'function') {
            targetRoot.__lcOverlay.open(opener);
          }
          return;
        }
      }
      if (event.target === backdrop && closeOnMask) close();
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && closeOnEsc && isTop()) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !isTop()) return;
      var list = kit.focusables(panel);
      if (!list.length) {
        event.preventDefault();
        try { panel.focus(); } catch (error) { /* 忽略 */ }
        return;
      }
      var current = list.indexOf(doc.activeElement);
      var next = trapStep(current, list.length, event.shiftKey);
      if (next === -1) return;
      if (current === -1) {
        event.preventDefault();
        try { list[0].focus(); } catch (error) { /* 忽略 */ }
        return;
      }
      if ((!event.shiftKey && current === list.length - 1) || (event.shiftKey && current === 0)) {
        event.preventDefault();
        try { list[next].focus(); } catch (error) { /* 忽略 */ }
      }
    }

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeydown);

    var api = {
      open: open,
      close: close,
      isOpen: function () { return opened; },
      panel: function () { return panel; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        el.removeEventListener('click', onClick);
        el.removeEventListener('keydown', onKeydown);
        var index = stackIndex();
        if (index !== -1) openStack.splice(index, 1);
        if (returnFocus && doc.contains(returnFocus)) {
          try { returnFocus.focus(); } catch (error) { /* 忽略 */ }
        }
        returnFocus = null;
        opened = false;
      }
    };
    el.__lcOverlay = api;

    if (el.getAttribute('data-open') === 'true') open(trigger);
    return api;
  }

  var CSS = [
    '.lc-ui-overlay { position: relative; }',
    '.lc-ui-overlay-trigger { position: relative; z-index: 2; }',
    '.lc-ui-overlay-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: var(--lc-space-5); background: var(--lc-color-overlay); }',
    '.lc-ui-overlay-backdrop[hidden] { display: none; }',
    '.lc-ui-overlay-panel { display: flex; flex-direction: column; width: 100%; max-height: min(86vh, 720px); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); color: var(--lc-color-ink, var(--ink, inherit)); box-shadow: var(--lc-shadow-lg); outline: none; }',
    '.lc-ui-overlay-size-sm { max-width: 360px; }',
    '.lc-ui-overlay-size-md { max-width: 540px; }',
    '.lc-ui-overlay-size-lg { max-width: 760px; }',
    '.lc-ui-overlay-head { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-3); padding: var(--lc-space-3-5) var(--lc-space-4); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); }',
    '.lc-ui-overlay-title { margin: 0; font-size: var(--lc-text-lg, 17px); font-weight: var(--lc-weight-semibold, 600); }',
    '.lc-ui-overlay-body { flex: 1; min-height: 0; overflow: auto; padding: var(--lc-space-4); font-size: var(--lc-text-sm, 14px); }',
    '.lc-ui-overlay-body > *:first-child { margin-top: 0; }',
    '.lc-ui-overlay-body > *:last-child { margin-bottom: 0; }',
    '.lc-ui-overlay-foot { padding: var(--lc-space-3) var(--lc-space-4); border-top: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-overlay-panel-drawer { position: fixed; top: 0; bottom: 0; max-height: 100vh; border-radius: 0; width: min(420px, 92vw); }',
    '.lc-ui-drawer-right { right: 0; }',
    '.lc-ui-drawer-left { left: 0; }',
    '.lc-ui-drawer-bottom { position: fixed; left: 0; right: 0; top: auto; bottom: 0; width: 100%; max-height: 76vh; border-radius: var(--lc-radius-md, var(--radius, 8px)) var(--lc-radius-md, var(--radius, 8px)) 0 0; }',
    '.lc-ui-overlay-backdrop:has(.lc-ui-overlay-panel-drawer) { align-items: flex-start; padding: 0; }',
    '@media (prefers-reduced-motion: reduce) { .lc-ui-overlay-panel { transition: none; } }'
  ].join('\n');

  function makeDef(variant) {
    return {
      type: 'ui-' + variant,
      name: variant === 'modal' ? '弹窗' : '抽屉',
      version: 1,
      schema: schemaFor(variant),
      sharedCss: kit.css,
      sharedCssId: 'lc-ui-common',
      css: CSS,
      render: function (block, ctx) { return renderOverlay(block, ctx, variant); },
      enhance: enhance,
      helpers: { trapStep: trapStep }
    };
  }

  var modal = makeDef('modal');
  var drawer = makeDef('drawer');

  if (typeof module === 'object' && module.exports) {
    module.exports = { modal: modal, drawer: drawer, trapStep: trapStep };
  } else {
    dom.Components['ui-modal'] = modal;
    dom.Components['ui-drawer'] = drawer;
  }

  return { modal: modal, drawer: drawer, trapStep: trapStep };
}));
