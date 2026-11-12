/* 渲染核心 · 内置组件 · 图片
   懒加载 + 宽高占位 + 失败占位。可视区外用 IntersectionObserver 才写入真实 src，
   因此不会发起请求；占位图用 1×1 透明 GIF，本身不产生网络请求。
   file:// 下同样工作：不依赖 fetch，只操作 img.src。 */
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

  var TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var DEFAULT_RATIO = '16 / 9';
  var FITS = { cover: 1, contain: 1, fill: 1, none: 1, 'scale-down': 1 };

  var SCHEMA = {
    type: 'ui-image',
    name: '图片',
    version: 1,
    description: '懒加载图片，带宽高占位与失败说明。',
    states: ['ready', 'empty', 'error'],
    props: {
      src: { type: 'string', label: '图片地址', required: true, description: '相对路径在 file:// 下也可用。' },
      alt: { type: 'string', label: '替代文本', default: '' },
      width: { type: 'number', label: '宽', default: 0, description: '用于占位与布局，0 表示不限制。' },
      height: { type: 'number', label: '高', default: 0 },
      ratio: { type: 'string', label: '宽高比', default: '16:9', description: '如 16:9、4:3；填 auto 则不锁定比例。' },
      fit: { type: 'enum', label: '填充方式', options: ['cover', 'contain', 'fill'], default: 'cover' },
      caption: { type: 'string', label: '图注', default: '' },
      lazy: { type: 'boolean', label: '懒加载', default: true },
      errorText: { type: 'string', label: '失败说明', default: '图片加载失败，请检查地址或网络。' },
      retryLabel: { type: 'string', label: '重试按钮', default: '重试' },
      state: { type: 'enum', label: '状态', options: ['ready', 'empty', 'error'], default: 'ready' }
    }
  };

  function px(value) {
    var number = Number(value);
    if (!isFinite(number) || number <= 0) return '';
    return number + 'px';
  }

  /* 比例优先取显式 ratio；否则由宽高推导；都没有才退回 16:9。 */
  function ratioOf(block, width, height) {
    var value = kit.prop(block, 'ratio', '');
    if (value === 'auto') return '';
    if (value != null && String(value).indexOf(':') !== -1) {
      var parts = String(value).split(':');
      var left = Number(parts[0]);
      var right = Number(parts[1]);
      if (isFinite(left) && isFinite(right) && left > 0 && right > 0) return left + ' / ' + right;
    }
    if (width > 0 && height > 0) return width + ' / ' + height;
    return DEFAULT_RATIO;
  }

  function frameStyle(ratio, width, fit) {
    var style = [];
    if (ratio) style.push('aspect-ratio:' + ratio);
    if (width > 0) style.push('max-width:' + width + 'px');
    style.push('--lc-image-fit:' + (FITS[fit] ? fit : 'cover'));
    return style.join(';');
  }

  function imageAttrs(block, src, alt, width, height) {
    var lazy = kit.bool(kit.prop(block, 'lazy', true), true);
    var attrs = {
      class: 'lc-ui-image-el',
      alt: alt,
      'data-lc-src': src,
      decoding: 'async',
      loading: lazy ? 'lazy' : 'eager',
      src: lazy ? TRANSPARENT : src
    };
    if (width > 0) attrs.width = width;
    if (height > 0) attrs.height = height;
    return attrs;
  }

  function render(block, ctx) {
    var src = String(kit.prop(block, 'src', '') || '');
    var alt = String(kit.prop(block, 'alt', '') || '');
    var width = kit.num(kit.prop(block, 'width', 0), 0);
    var height = kit.num(kit.prop(block, 'height', 0), 0);
    var caption = kit.prop(block, 'caption', '');
    var errorText = kit.prop(block, 'errorText', '图片加载失败，请检查地址或网络。');
    var retryLabel = kit.prop(block, 'retryLabel', '重试');
    var fit = kit.prop(block, 'fit', 'cover');
    var state = kit.stateOf(block, src !== '');

    var rootAttrs = {
      class: 'lc-ui lc-ui-image',
      'data-lc-ui': 'ui-image',
      'data-lc-state': state
    };

    if (state !== 'ready') {
      return h('div', rootAttrs, [
        kit.renderStatus(state, {
          title: state === 'error' ? '图片不可用' : '未设置图片',
          text: state === 'error' ? errorText : '在属性里填写图片地址后即可显示。',
          retry: false
        }),
        raw(kit.jsonIsland({ src: src, alt: alt, errorText: errorText, retryLabel: retryLabel }))
      ]);
    }

    var ratio = ratioOf(block, width, height);
    var lazy = kit.bool(kit.prop(block, 'lazy', true), true);
    var frame = h('div', { class: 'lc-ui-image-frame', style: frameStyle(ratio, width, fit) }, [
      h('img', imageAttrs(block, src, alt, width, height)),
      h('div', {
        class: 'lc-ui-image-error',
        'data-lc-image-error': 'true',
        role: 'status',
        hidden: true
      }, [
        h('span', { class: 'lc-ui-image-error-title' }, '图片加载失败'),
        h('span', { class: 'lc-ui-image-error-text', 'data-lc-image-error-text': 'true' }, errorText),
        h('button', {
          type: 'button',
          class: 'lc-ui-action lc-ui-image-retry',
          'data-lc-image-retry': 'true'
        }, retryLabel)
      ])
    ]);

    var children = [h('figure', { class: 'lc-ui-image-figure' }, [
      frame,
      caption ? h('figcaption', { class: 'lc-ui-image-caption' }, caption) : null
    ])];

    /* 脚本被禁用时退回原生图片，内容仍然可见。 */
    if (lazy) {
      children.push(raw('<noscript><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '"' +
        (width > 0 ? ' width="' + width + '"' : '') + (height > 0 ? ' height="' + height + '"' : '') +
        ' loading="lazy" decoding="async"></noscript>'));
    }

    children.push(raw(kit.jsonIsland({ src: src, alt: alt, errorText: errorText, retryLabel: retryLabel })));
    return h('div', rootAttrs, children);
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-image-enhanced') === 'true') return null;
    var img = el.querySelector('img[data-lc-src]');
    if (!img) return null;
    el.setAttribute('data-lc-image-enhanced', 'true');

    var doc = el.ownerDocument;
    var view = doc.defaultView;
    var data = kit.readJsonScript(el) || {};
    var errorBox = el.querySelector('[data-lc-image-error]');
    var errorText = el.querySelector('[data-lc-image-error-text]');
    var loaded = false;

    if (errorText && data.errorText) errorText.textContent = data.errorText;

    function settle(ok) {
      if (loaded) return;
      loaded = true;
      el.classList.remove('is-loading');
      el.classList.toggle('is-loaded', ok);
      el.classList.toggle('is-error', !ok);
      if (errorBox) errorBox.hidden = ok;
      if (!ok) {
        img.setAttribute('hidden', '');
        img.setAttribute('aria-hidden', 'true');
      }
      kit.emit(el, ok ? 'lc:image-load' : 'lc:image-error', { src: img.getAttribute('data-lc-src') || '' });
    }

    function load() {
      var src = img.getAttribute('data-lc-src');
      if (!src) { settle(false); return; }
      el.classList.add('is-loading');
      img.addEventListener('load', function onLoad() {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        settle(true);
      });
      img.addEventListener('error', function onError() {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        settle(false);
      });
      img.src = src;
      /* 图片已在缓存中时 load/error 可能在监听前就完成，补一次同步判定。 */
      if (img.complete) {
        if (img.naturalWidth > 0) settle(true);
        else settle(false);
      }
    }

    function retry() {
      var src = img.getAttribute('data-lc-src') || '';
      if (!src) return;
      loaded = false;
      el.classList.remove('is-error', 'is-loaded');
      el.classList.add('is-loading');
      if (errorBox) errorBox.hidden = true;
      img.removeAttribute('hidden');
      img.removeAttribute('aria-hidden');
      var join = src.indexOf('?') === -1 ? '?' : '&';
      img.src = src + join + 'lc_retry=' + Date.now();
    }

    el.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('[data-lc-image-retry]')) retry();
    });

    if (kit.bool(kit.prop({}, 'lazy', true), true) && img.getAttribute('src') === TRANSPARENT) {
      if (view && typeof view.IntersectionObserver === 'function') {
        var observer = new view.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            observer.unobserve(img);
            load();
          });
        }, { rootMargin: '200px 0px' });
        observer.observe(img);
      } else {
        load();
      }
    } else {
      load();
    }

    return { destroy: function () { settle(true); } };
  }

  var def = {
    type: 'ui-image',
    name: '图片',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-image { margin: 0; }',
      '.lc-ui-image-figure { margin: 0; display: flex; flex-direction: column; gap: var(--lc-space-1-5); }',
      '.lc-ui-image-frame { position: relative; width: 100%; overflow: hidden; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface-2, var(--surface-2, #f1efe7)); }',
      '.lc-ui-image-el { display: block; width: 100%; height: 100%; object-fit: var(--lc-image-fit, cover); }',
      '.lc-ui-image.is-loading .lc-ui-image-frame::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--lc-color-line, var(--line, #ddd)), transparent); opacity: 0.45; animation: lc-ui-image-shimmer 1.1s linear infinite; }',
      '.lc-ui-image.is-loaded .lc-ui-image-frame::after { display: none; }',
      '.lc-ui-image.is-error .lc-ui-image-frame { background: var(--lc-color-surface-2, var(--surface-2, #f1efe7)); }',
      '.lc-ui-image-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--lc-space-1-5); padding: var(--lc-space-3); text-align: center; color: var(--lc-color-muted, var(--muted, #666)); font-size: var(--lc-text-xs, 12px); }',
      '.lc-ui-image-error[hidden] { display: none; }',
      '.lc-ui-image-error-title { color: var(--lc-color-danger, var(--danger, currentColor)); font-weight: var(--lc-weight-semibold, 600); }',
      '.lc-ui-image-error-text { max-width: 34ch; line-height: var(--lc-leading-base, 1.5); }',
      '.lc-ui-image-retry { margin-top: var(--lc-space-1); }',
      '.lc-ui-image-caption { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '@keyframes lc-ui-image-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }',
      '@media (prefers-reduced-motion: reduce) { .lc-ui-image.is-loading .lc-ui-image-frame::after { animation: none; } }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: { ratioOf: ratioOf, frameStyle: frameStyle }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-image'] = def;
  }

  return def;
}));
