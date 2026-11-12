/* 渲染核心 · 内置组件 · 轮播
   自动播放可关、指示点、循环、悬停/聚焦/页面隐藏时暂停；键盘方向键可切换。 */
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
    type: 'ui-carousel',
    name: '轮播',
    version: 1,
    description: '自动播放可关、指示点、循环、暂停时机。',
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:carousel-change'],
    props: {
      label: { type: 'string', label: '区域名称', default: '轮播' },
      items: {
        type: 'array',
        label: '幻灯片',
        required: true,
        default: [],
        items: {
          type: 'object',
          props: {
            title: { type: 'string', label: '标题' },
            content: { type: 'string', label: 'Markdown 正文' },
            html: { type: 'string', label: '受信任 HTML' }
          }
        }
      },
      autoplay: { type: 'boolean', label: '自动播放', default: true },
      interval: { type: 'number', label: '间隔毫秒', default: 5000, min: 800 },
      loop: { type: 'boolean', label: '循环', default: true },
      indicators: { type: 'boolean', label: '指示点', default: true },
      controls: { type: 'boolean', label: '前后按钮', default: true },
      pauseOnHover: { type: 'boolean', label: '悬停暂停', default: true },
      start: { type: 'number', label: '起始序号', default: 0, min: 0 },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
      emptyText: { type: 'string', label: '空状态文案', default: '暂无幻灯片' }
    }
  };

  function normalizeItems(items) {
    return (Array.isArray(items) ? items : []).filter(function (item) {
      return item && typeof item === 'object';
    }).map(function (item, index) {
      return {
        title: item.title == null ? '第 ' + (index + 1) + ' 张' : String(item.title),
        content: item.content == null ? (item.md == null ? '' : item.md) : item.content,
        html: item.html == null ? null : String(item.html)
      };
    });
  }

  function stepSlide(index, total, delta, loop) {
    if (total < 1) return -1;
    var next = index + (delta || 0);
    if (next < 0) return loop === false ? 0 : total - 1;
    if (next >= total) return loop === false ? total - 1 : 0;
    return next;
  }

  function slideBody(item, ctx) {
    var body = [];
    if (item.html != null) body.push(raw(kit.trustedHtml(item.html)));
    if (item.content != null && String(item.content) !== '') body.push(raw(kit.contentHtml(ctx, item.content)));
    return body;
  }

  function render(block, ctx) {
    var items = normalizeItems(kit.prop(block, 'items', []));
    var state = kit.stateOf(block, items.length > 0);
    var autoplay = kit.bool(kit.prop(block, 'autoplay', true), true);
    var interval = Math.max(800, kit.num(kit.prop(block, 'interval', 5000), 5000));
    var loop = kit.bool(kit.prop(block, 'loop', true), true);
    var indicators = kit.bool(kit.prop(block, 'indicators', true), true);
    var controls = kit.bool(kit.prop(block, 'controls', true), true);
    var pauseOnHover = kit.bool(kit.prop(block, 'pauseOnHover', true), true);
    var start = kit.clamp(kit.num(kit.prop(block, 'start', 0), 0), 0, Math.max(0, items.length - 1));
    var label = String(kit.prop(block, 'label', '轮播'));
    var emptyText = kit.prop(block, 'emptyText', '暂无幻灯片');
    var groupId = kit.uid('lc-carousel');

    var rootAttrs = {
      class: 'lc-ui lc-ui-carousel',
      'data-lc-ui': 'ui-carousel',
      'data-lc-state': state,
      role: 'region',
      'aria-roledescription': '轮播',
      'aria-label': label,
      'data-autoplay': autoplay ? 'on' : 'off',
      'aria-live': autoplay ? 'off' : 'polite'
    };

    if (state !== 'ready') {
      return h('div', rootAttrs, [
        kit.renderStatus(state, {
          title: state === 'loading' ? '正在加载轮播' : undefined,
          text: state === 'empty' ? emptyText : (state === 'error' ? '轮播内容加载失败' : ''),
          retry: state === 'error',
          retryLabel: kit.prop(block, 'retryLabel', '重试')
        }),
        raw(kit.jsonIsland({ items: items, autoplay: autoplay, interval: interval, loop: loop, pauseOnHover: pauseOnHover, start: start }))
      ]);
    }

    var slides = items.map(function (item, index) {
      return h('div', {
        class: 'lc-ui-slide' + (index === start ? ' is-active' : ''),
        role: 'group',
        'aria-roledescription': '幻灯片',
        'aria-label': '第 ' + (index + 1) + ' 张，共 ' + items.length + ' 张',
        'data-lc-slide': String(index),
        hidden: index === start ? null : true
      }, [
        h('h3', { class: 'lc-ui-slide-title' }, item.title),
        h('div', { class: 'lc-ui-slide-body' }, slideBody(item, ctx))
      ]);
    });

    var dots = indicators ? h('div', { class: 'lc-ui-carousel-dots', role: 'group', 'aria-label': '选择幻灯片' },
      items.map(function (item, index) {
        return h('button', {
          type: 'button',
          class: 'lc-ui-carousel-dot' + (index === start ? ' is-active' : ''),
          'data-lc-slide-to': String(index),
          'aria-label': '第 ' + (index + 1) + ' 张：' + item.title,
          'aria-current': index === start ? 'true' : 'false'
        }, []);
      })) : null;

    var controlsNode = controls ? h('div', { class: 'lc-ui-carousel-controls' }, [
      h('button', {
        type: 'button',
        class: 'lc-ui-icon-btn lc-ui-carousel-prev',
        'data-lc-carousel-prev': 'true',
        'aria-label': '上一张',
        disabled: loop || start > 0 ? null : true
      }, [kit.icon('chevron-right', 'lc-ui-flip')]),
      h('button', {
        type: 'button',
        class: 'lc-ui-icon-btn lc-ui-carousel-next',
        'data-lc-carousel-next': 'true',
        'aria-label': '下一张',
        disabled: loop || start < items.length - 1 ? null : true
      }, [kit.icon('chevron-right')])
    ]) : null;

    var toggle = autoplay ? h('button', {
      type: 'button',
      class: 'lc-ui-action lc-ui-carousel-toggle',
      'data-lc-carousel-toggle': 'true',
      'aria-pressed': 'true',
      'aria-label': '暂停自动播放'
    }, '暂停') : null;

    return h('div', rootAttrs, [
      h('div', { class: 'lc-ui-carousel-viewport', id: groupId }, slides),
      controlsNode,
      h('div', { class: 'lc-ui-carousel-foot' }, [dots, toggle]),
      raw(kit.jsonIsland({
        items: items, autoplay: autoplay, interval: interval, loop: loop, pauseOnHover: pauseOnHover, start: start
      }))
    ]);
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var data = kit.readJsonScript(el);
    if (!data || !Array.isArray(data.items)) return null;
    var items = data.items;
    var total = items.length;
    if (total < 1) return null;

    var doc = el.ownerDocument;
    var win = doc.defaultView;
    var index = kit.clamp(kit.num(data.start, 0), 0, total - 1);
    var loop = data.loop !== false;
    var interval = Math.max(800, kit.num(data.interval, 5000));
    var pauseOnHover = data.pauseOnHover !== false;
    var autoplay = data.autoplay !== false;
    var playing = autoplay;
    var timer = null;
    var hovered = false;
    var focused = false;
    var destroyed = false;

    var slides = Array.prototype.slice.call(el.querySelectorAll('[data-lc-slide]'));
    var dots = Array.prototype.slice.call(el.querySelectorAll('[data-lc-slide-to]'));
    var prev = el.querySelector('[data-lc-carousel-prev]');
    var next = el.querySelector('[data-lc-carousel-next]');
    var toggle = el.querySelector('[data-lc-carousel-toggle]');

    function reducedMotion() {
      try { return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); }
      catch (error) { return false; }
    }

    function updateControls() {
      if (prev) prev.disabled = !loop && index === 0;
      if (next) next.disabled = !loop && index === total - 1;
    }

    function show(nextIndex) {
      index = nextIndex;
      slides.forEach(function (slide, i) {
        if (i === index) slide.removeAttribute('hidden');
        else slide.setAttribute('hidden', '');
        slide.classList.toggle('is-active', i === index);
      });
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === index);
        dot.setAttribute('aria-current', i === index ? 'true' : 'false');
      });
      updateControls();
      el.setAttribute('data-index', String(index));
    }

    function go(delta, source) {
      var nextIndex = stepSlide(index, total, delta, loop);
      if (nextIndex === -1 || nextIndex === index) return;
      show(nextIndex);
      restart();
      kit.emit(el, 'lc:carousel-change', { index: index, total: total, source: source || 'control' });
    }

    function stop() {
      if (timer) { win.clearInterval(timer); timer = null; }
    }

    function start() {
      stop();
      if (!playing || total < 2 || reducedMotion()) return;
      timer = win.setInterval(function () {
        var nextIndex = stepSlide(index, total, 1, loop);
        if (nextIndex === -1 || (nextIndex === index && !loop)) return;
        show(nextIndex);
        kit.emit(el, 'lc:carousel-change', { index: index, total: total, source: 'autoplay' });
      }, interval);
    }

    function restart() { if (playing) start(); }

    function pause() { stop(); }

    function setPlaying(value) {
      playing = !!value;
      if (toggle) {
        toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
        toggle.setAttribute('aria-label', playing ? '暂停自动播放' : '开始自动播放');
        toggle.textContent = playing ? '暂停' : '播放';
      }
      el.setAttribute('data-autoplay', playing ? 'on' : 'off');
      if (playing) start(); else stop();
      kit.emit(el, 'lc:carousel-toggle', { playing: playing });
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('[data-lc-carousel-prev]')) { go(-1, 'prev'); return; }
      if (target.closest('[data-lc-carousel-next]')) { go(1, 'next'); return; }
      var dot = target.closest('[data-lc-slide-to]');
      if (dot) {
        var targetIndex = Number(dot.getAttribute('data-lc-slide-to'));
        if (isFinite(targetIndex) && targetIndex !== index) {
          show(targetIndex);
          restart();
          kit.emit(el, 'lc:carousel-change', { index: index, total: total, source: 'indicator' });
        }
        return;
      }
      if (target.closest('[data-lc-carousel-toggle]')) {
        setPlaying(!playing);
        return;
      }
      if (target.closest('[data-lc-retry]')) {
        kit.emit(el, 'lc:state-retry', { kind: 'carousel' });
      }
    }

    function onKeydown(event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1, 'keyboard'); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(1, 'keyboard'); }
    }

    function onEnter() { hovered = true; if (pauseOnHover) pause(); }
    function onLeave() { hovered = false; if (!focused && playing) start(); }
    function onFocusIn() { focused = true; pause(); }
    function onFocusOut(event) {
      if (el.contains(event.relatedTarget)) return;
      focused = false;
      if (!hovered && playing) start();
    }
    function onVisibility() {
      if (doc.hidden) pause();
      else if (playing && !hovered && !focused) start();
    }

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    if (doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);

    show(index);
    start();
    if (autoplay && reducedMotion() && toggle) {
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', '开始自动播放');
      toggle.textContent = '播放';
    }

    var api = {
      go: go,
      show: function (nextIndex) { show(nextIndex); restart(); },
      setPlaying: setPlaying,
      isPlaying: function () { return playing; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        stop();
        el.removeEventListener('click', onClick);
        el.removeEventListener('keydown', onKeydown);
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        el.removeEventListener('focusin', onFocusIn);
        el.removeEventListener('focusout', onFocusOut);
        if (doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
      }
    };
    el.__lcCarousel = api;
    return api;
  }

  var def = {
    type: 'ui-carousel',
    name: '轮播',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-carousel { position: relative; display: flex; flex-direction: column; gap: var(--lc-space-2-5); padding: var(--lc-space-3-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, transparent)); }',
      '.lc-ui-carousel-viewport { min-height: 120px; }',
      '.lc-ui-slide[hidden] { display: none; }',
      '.lc-ui-slide-title { margin: 0 0 var(--lc-space-1-5); font-size: var(--lc-text-lg, 17px); }',
      '.lc-ui-slide-body { font-size: var(--lc-text-sm, 14px); color: var(--lc-color-ink-2, var(--ink-2, inherit)); }',
      '.lc-ui-slide-body > *:first-child { margin-top: 0; }',
      '.lc-ui-slide-body > *:last-child { margin-bottom: 0; }',
      '.lc-ui-carousel-controls { position: absolute; top: 50%; left: 8px; right: 8px; display: flex; justify-content: space-between; margin-top: -15px; pointer-events: none; }',
      '.lc-ui-carousel-controls .lc-ui-icon-btn { pointer-events: auto; background: var(--lc-color-surface, var(--surface, #fff)); border-color: var(--lc-color-line, var(--line, #ddd)); }',
      '.lc-ui-flip { transform: rotate(180deg); }',
      '.lc-ui-carousel-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-2-5); }',
      '.lc-ui-carousel-dots { display: flex; gap: var(--lc-space-1-5); }',
      '.lc-ui-carousel-dot { width: 9px; height: 9px; padding: 0; border: 0; border-radius: 50%; background: var(--lc-color-line, var(--line, #ddd)); cursor: pointer; }',
      '.lc-ui-carousel-dot.is-active { background: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-carousel-toggle { padding: 3px var(--lc-space-2-5); }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeItems: normalizeItems,
      stepSlide: stepSlide
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = def;
  else dom.Components['ui-carousel'] = def;

  return def;
}));
