/* 渲染核心 · 外壳交互层
   文章页的运行时能力：目录滚动高亮、目录折叠、深链接定位、正文检索。
   只用原生 DOM / IntersectionObserver / rAF，无第三方依赖、无网络请求；
   样式随文件注入，静态导出时把本文件一起带走即可。
   纯计算部分（高亮判定、检索分段、折叠状态）单独导出，Node 可直接测。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory({});
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var DEFAULT_OFFSET = 80;
  var DEFAULT_STORAGE_KEY = 'lc-article-toc-collapsed';
  var EPSILON = 2;
  var SHOW_TEXT = 4;
  var FILTER_ACCEPT = 1;
  var FILTER_REJECT = 2;
  var listSeq = 0;

  var INTERACTIONS_CSS = [
    '.lc-toc-toggle {',
    '  display: block; width: 100%; margin: 0 0 var(--lc-space-2);',
    '  padding: 5px var(--lc-space-2); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd));',
    '  border-radius: var(--lc-radius-md, var(--radius, 8px));',
    '  background: var(--lc-color-surface, var(--surface, transparent));',
    '  color: var(--lc-color-muted, var(--muted, #666));',
    '  font: inherit; font-size: var(--lc-text-xs, 12px); line-height: 1.4; text-align: left; cursor: pointer;',
    '}',
    '.lc-toc-toggle:hover { color: var(--lc-color-accent, var(--accent, currentColor)); border-color: var(--lc-color-accent-line, var(--accent-line, #999)); }',
    '.lc-toc-toggle:focus-visible { outline: 2px solid var(--lc-color-accent, var(--accent, #3e6a56)); outline-offset: 2px; }',
    '[data-lc-toc-collapsed="true"] .lc-article-toc-list { display: none; }',
    '.lc-toc-link.is-active { color: var(--lc-color-accent, var(--accent, currentColor)); font-weight: var(--lc-weight-semibold, 600); }',
    '.lc-toc-link.is-active::before { content: ""; display: inline-block; width: 3px; height: 0.9em; margin-right: var(--lc-space-1-5); vertical-align: -1px; border-radius: var(--lc-radius-xs); background: currentColor; }',
    '.lc-search-hit { background: var(--lc-color-accent-soft); color: inherit; border-radius: var(--lc-radius-xs); padding: 0 1px; border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-accent-line); }',
    '.lc-search-hit.is-current { background: var(--lc-color-accent-soft); outline: 2px solid var(--lc-color-accent); outline-offset: 1px; }'
  ].join('\n');

  /* ---------- 纯函数（可被 Node 自检直接调用） ---------- */

  function parsePx(value, fallback) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      var match = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:px)?$/);
      if (match) return parseFloat(match[1]);
    }
    return fallback == null ? 0 : fallback;
  }

  function reachedBottom(scrollTop, clientHeight, scrollHeight, epsilon) {
    var gap = epsilon == null ? EPSILON : epsilon;
    return scrollHeight > clientHeight + gap && scrollTop + clientHeight >= scrollHeight - gap;
  }

  /* 选当前章节：
     - 只返回一个 id，天然不会出现两处同时高亮；
     - 以“滚动位置 + 头部偏移”为激活线，取线以上最后一个章节；
     - 滚动到底时强制取最后一节，避免最后一节永远点不亮。 */
  function pickActiveSection(items, options) {
    var opts = options || {};
    var list = [];
    (items || []).forEach(function (item) {
      if (!item || item.id == null) return;
      list.push({ id: String(item.id), top: Number(item.top) || 0 });
    });
    if (!list.length) return null;
    list.sort(function (a, b) { return a.top - b.top; });
    if (opts.atBottom) return list[list.length - 1].id;

    var line = (Number(opts.scrollTop) || 0) + (Number(opts.offset) || 0);
    var active = list[0].id;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].top <= line + 0.5) active = list[i].id;
      else break;
    }
    return active;
  }

  /* 检索分段：返回 [{text, hit}]，调用方按段拼文本节点与 mark，不靠 innerHTML。 */
  function searchSegments(text, query, options) {
    var source = String(text == null ? '' : text);
    var needle = String(query == null ? '' : query);
    if (!needle) return [{ text: source, hit: false }];

    var caseSensitive = !!(options && options.caseSensitive);
    var hay = caseSensitive ? source : source.toLowerCase();
    var target = caseSensitive ? needle : needle.toLowerCase();
    var out = [];
    var from = 0;
    var index = hay.indexOf(target, from);

    while (index !== -1) {
      if (index > from) out.push({ text: source.slice(from, index), hit: false });
      out.push({ text: source.slice(index, index + target.length), hit: true });
      from = index + target.length;
      index = hay.indexOf(target, from);
    }
    if (from < source.length) out.push({ text: source.slice(from), hit: false });
    return out.length ? out : [{ text: source, hit: false }];
  }

  /* 上一个/下一个：越界循环，空集合返回 -1。 */
  function stepIndex(index, total, delta) {
    if (!total || total < 1) return -1;
    var step = delta || 1;
    if (index < 0 || index >= total) return step > 0 ? 0 : total - 1;
    var next = (index + step) % total;
    if (next < 0) next += total;
    return next;
  }

  function sectionIdFromHash(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    if (!raw) return '';
    try { return decodeURIComponent(raw); } catch (error) { return raw; }
  }

  /* 目标准置：向上留出吸顶头部的高度，并夹在可滚动范围内。 */
  function scrollTopFor(targetTop, offset, maxScroll) {
    var value = (Number(targetTop) || 0) - (Number(offset) || 0);
    if (value < 0) value = 0;
    if (maxScroll != null && maxScroll > 0 && value > maxScroll) value = maxScroll;
    return value;
  }

  function memoryStorage(seed) {
    var data = seed || {};
    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) { data[key] = String(value); },
      removeItem: function (key) { delete data[key]; },
      _data: data
    };
  }

  function usableStorage(candidate) {
    try {
      if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
        var probe = '__lc_probe__';
        candidate.setItem(probe, '1');
        candidate.removeItem(probe);
        return candidate;
      }
    } catch (error) { /* 隐私模式 / file:// 下 localStorage 可能抛错 */ }
    return memoryStorage();
  }

  /* 目录折叠状态：默认读本地存储，写入失败不抛错；aria-expanded 由这里统一给出。 */
  function createTocState(options) {
    var opts = options || {};
    var key = opts.key || DEFAULT_STORAGE_KEY;
    var storage = opts.storage === false ? memoryStorage() : usableStorage(opts.storage);
    var initial = null;

    if (typeof opts.collapsed === 'boolean') {
      initial = opts.collapsed;
    } else {
      try {
        var saved = storage.getItem(key);
        if (saved === '1' || saved === 'true') initial = true;
        else if (saved === '0' || saved === 'false') initial = false;
      } catch (error) { initial = null; }
    }
    var collapsed = initial === true;

    function persist(value) {
      try { storage.setItem(key, value ? '1' : '0'); } catch (error) { /* 忽略写入失败 */ }
    }

    return {
      key: function () { return key; },
      collapsed: function () { return collapsed; },
      set: function (value, save) {
        collapsed = !!value;
        if (save !== false) persist(collapsed);
        return collapsed;
      },
      toggle: function () { return this.set(!collapsed); },
      ariaExpanded: function () { return collapsed ? 'false' : 'true'; },
      label: function () { return collapsed ? '展开目录' : '收起目录'; }
    };
  }

  /* ---------- 浏览器侧实现 ---------- */

  function injectCss(doc) {
    if (!doc || !doc.head) return;
    if (doc.querySelector('style[data-lc-interactions]')) return;
    var style = doc.createElement('style');
    style.setAttribute('data-lc-interactions', 'css');
    style.textContent = INTERACTIONS_CSS;
    doc.head.appendChild(style);
  }

  function createInteractions(pageRoot, options) {
    if (!pageRoot || typeof pageRoot.querySelectorAll !== 'function') return null;
    var doc = pageRoot.ownerDocument;
    var win = doc && (doc.defaultView || (typeof window !== 'undefined' ? window : null));
    if (!doc || !win) return null;

    var opts = options || {};
    injectCss(doc);

    var scroller = null;
    if (opts.scroller === false) scroller = null;
    else if (opts.scroller && opts.scroller.nodeType === 1) scroller = opts.scroller;
    else if (opts.scroller !== 'window') scroller = detectScroller(pageRoot);

    var tocNav = null;
    var tocList = null;
    var tocTitle = null;
    var targets = [];
    var activeId = '';
    var io = null;
    var scheduled = false;
    var rafHandle = null;
    var destroyed = false;
    var hits = [];
    var hitIndex = -1;
    var query = '';

    var searchRoot = resolveSearchRoot();
    var storage = opts.storage === false ? false : opts.storage;
    if (!storage) {
      try { storage = win.localStorage; }
      catch (error) { storage = null; }
    }
    var state = createTocState({
      key: opts.storageKey || DEFAULT_STORAGE_KEY,
      storage: storage,
      collapsed: opts.collapsed
    });
    var toggleButton = null;

    function detectScroller(start) {
      var node = start;
      while (node && node.nodeType === 1) {
        if (node === doc.body || node === doc.documentElement) break;
        if (isScrollContainer(node)) return node;
        node = node.parentNode;
      }
      return null;
    }

    function isScrollContainer(el) {
      var style = win.getComputedStyle ? win.getComputedStyle(el) : null;
      if (!style) return false;
      var overflow = String(style.overflowY || '');
      if (!/^(auto|scroll|overlay)$/.test(overflow)) return false;
      return el.scrollHeight > el.clientHeight + 1;
    }

    function metrics() {
      if (scroller) {
        return {
          top: scroller.scrollTop,
          client: scroller.clientHeight,
          total: scroller.scrollHeight
        };
      }
      var de = doc.documentElement;
      var body = doc.body;
      var top = typeof win.pageYOffset === 'number' ? win.pageYOffset : de.scrollTop;
      var client = win.innerHeight || de.clientHeight;
      var total = Math.max(de.scrollHeight, body ? body.scrollHeight : 0);
      return { top: top, client: client, total: total };
    }

    function contentTop(el) {
      if (!el || !el.getBoundingClientRect) return 0;
      var rect = el.getBoundingClientRect();
      if (!scroller) {
        var y = typeof win.pageYOffset === 'number' ? win.pageYOffset : doc.documentElement.scrollTop;
        return rect.top + y;
      }
      var box = scroller.getBoundingClientRect();
      var border = parsePx(win.getComputedStyle ? win.getComputedStyle(scroller).borderTopWidth : 0, 0);
      return rect.top - box.top - border + scroller.scrollTop;
    }

    function offsetValue() {
      var raw = typeof opts.offset === 'function'
        ? opts.offset({ scroller: scroller, usesWindow: !scroller })
        : opts.offset;
      var parsed = parsePx(raw, NaN);
      if (isFinite(parsed)) return parsed;

      var host = pageRoot.querySelector('.lc-page') || pageRoot;
      var cs = win.getComputedStyle ? win.getComputedStyle(host) : null;
      if (cs && cs.getPropertyValue) {
        var cssValue = parsePx(cs.getPropertyValue('--lc-anchor-offset'), NaN);
        if (isFinite(cssValue)) return cssValue;
      }
      return DEFAULT_OFFSET;
    }

    function applyScroll(value, behavior) {
      var m = metrics();
      var max = m.total - m.client;
      if (max < 0) max = 0;
      var top = value < 0 ? 0 : (value > max ? max : value);
      if (scroller) {
        if (typeof scroller.scrollTo === 'function') {
          try { scroller.scrollTo({ top: top, left: scroller.scrollLeft, behavior: behavior || 'auto' }); }
          catch (error) { scroller.scrollTop = top; }
        } else {
          scroller.scrollTop = top;
        }
        return;
      }
      if (typeof win.scrollTo === 'function') {
        try { win.scrollTo({ top: top, left: win.pageXOffset, behavior: behavior || 'auto' }); }
        catch (error) { win.scrollTo(0, top); }
      }
    }

    function scrollToElement(el, behavior, offset) {
      if (!el) return;
      var m = metrics();
      var gap = offset == null ? offsetValue() : offset;
      var max = m.total - m.client;
      applyScroll(scrollTopFor(contentTop(el), gap, max < 0 ? 0 : max), behavior);
    }

    function findById(id) {
      if (!id) return null;
      var el = doc.getElementById ? doc.getElementById(id) : null;
      if (el && pageRoot.contains && !pageRoot.contains(el)) el = null;
      if (el) return el;
      var nodes = pageRoot.querySelectorAll('[id]');
      for (var i = 0; i < nodes.length; i += 1) {
        if (nodes[i].id === id) return nodes[i];
      }
      return null;
    }

    function resolveSearchRoot() {
      if (opts.searchRoot) {
        if (typeof opts.searchRoot === 'string') return pageRoot.querySelector(opts.searchRoot) || pageRoot;
        return opts.searchRoot;
      }
      return pageRoot.querySelector('article.lc-article-body') ||
        pageRoot.querySelector('[data-lc-blocks="root"]') || pageRoot;
    }

    /* ---- 目录高亮 ---- */

    function collectTargets() {
      var nav = pageRoot.querySelector('.lc-article-toc');
      var seen = {};
      var list = [];
      var links = nav ? nav.querySelectorAll('a.lc-toc-link[href^="#"]') : [];
      Array.prototype.forEach.call(links, function (link) {
        var id = sectionIdFromHash(link.getAttribute('href'));
        if (!id || seen[id]) return;
        var el = findById(id);
        if (!el) return;
        seen[id] = true;
        list.push({ id: id, link: link, element: el });
      });

      if (!list.length) {
        var headings = pageRoot.querySelectorAll('h2[id], h3[id]');
        Array.prototype.forEach.call(headings, function (el) {
          var id = el.id;
          if (!id || seen[id]) return;
          seen[id] = true;
          list.push({ id: id, link: null, element: el });
        });
      }
      return { nav: nav, list: list };
    }

    function setActive(id) {
      activeId = id || '';
      targets.forEach(function (item) {
        if (!item.link) return;
        var on = item.id === activeId;
        if (item.link.classList) item.link.classList.toggle('is-active', on);
        if (on) item.link.setAttribute('aria-current', 'location');
        else item.link.removeAttribute('aria-current');
      });
      notify();
    }

    function updateActive() {
      if (destroyed || !targets.length) return;
      var m = metrics();
      var atBottom = reachedBottom(m.top, m.client, m.total, EPSILON);
      var items = targets.map(function (item) {
        return { id: item.id, top: contentTop(item.element) };
      });
      var nextId = pickActiveSection(items, {
        scrollTop: m.top,
        offset: offsetValue(),
        atBottom: atBottom
      });
      if (nextId !== activeId) setActive(nextId);
    }

    function scheduleUpdate() {
      if (destroyed || scheduled) return;
      scheduled = true;
      var run = function () {
        scheduled = false;
        updateActive();
      };
      if (typeof win.requestAnimationFrame === 'function') rafHandle = win.requestAnimationFrame(run);
      else rafHandle = win.setTimeout(run, 16);
    }

    function observe() {
      if (io) { io.disconnect(); io = null; }
      if (typeof win.IntersectionObserver !== 'function' || !targets.length) return;
      try {
        io = new win.IntersectionObserver(function () { scheduleUpdate(); }, {
          root: scroller || null,
          rootMargin: '-' + Math.round(offsetValue()) + 'px 0px -40% 0px',
          threshold: [0, 0.25, 1]
        });
      } catch (error) {
        io = null;
        return;
      }
      targets.forEach(function (item) {
        try { io.observe(item.element); } catch (error) { /* 忽略单个目标 */ }
      });
    }

    /* ---- 深链接 ---- */

    function setHash(hash) {
      if (!win.history || !win.history.pushState) {
        try { win.location.hash = hash; } catch (error) { /* 忽略 */ }
        return;
      }
      try { win.history.pushState(null, '', hash); }
      catch (error) { try { win.location.hash = hash; } catch (ignore) { /* 忽略 */ } }
    }

    function goToSection(id, goOptions) {
      var goOpts = goOptions || {};
      var el = findById(id);
      if (!el) return false;
      scrollToElement(el, goOpts.behavior || 'smooth', goOpts.offset);
      setActive(id);
      if (goOpts.hash !== false) setHash('#' + id);
      return true;
    }

    function applyHash(hash) {
      var id = sectionIdFromHash(hash == null ? win.location.hash : hash);
      if (!id) return false;
      var el = findById(id);
      if (!el) return false;
      scrollToElement(el, 'auto');
      setActive(id);
      return true;
    }

    function onTocClick(event) {
      var node = event.target;
      while (node && node !== tocNav && node.nodeType === 1) {
        if (node.matches && node.matches('a.lc-toc-link')) {
          var id = sectionIdFromHash(node.getAttribute('href'));
          if (id && findById(id)) {
            event.preventDefault();
            goToSection(id, { behavior: 'smooth' });
          }
          return;
        }
        node = node.parentNode;
      }
    }

    /* ---- 目录折叠 ---- */

    function removeToggle() {
      if (toggleButton && toggleButton.parentNode) toggleButton.parentNode.removeChild(toggleButton);
      toggleButton = null;
      if (tocNav) {
        tocNav.removeAttribute('data-lc-toc-collapsed');
        if (tocList) tocList.style.display = '';
      }
    }

    function applyCollapsed(collapsed, persist) {
      if (!tocNav) return;
      state.set(collapsed, persist);
      var flag = state.collapsed();
      tocNav.setAttribute('data-lc-toc-collapsed', flag ? 'true' : 'false');
      if (toggleButton) {
        toggleButton.setAttribute('aria-expanded', state.ariaExpanded());
        toggleButton.textContent = state.label();
      }
      notify();
    }

    function setupToggle() {
      removeToggle();
      if (opts.tocCollapse === false || !tocNav || !tocList) return;

      if (!tocList.id) {
        listSeq += 1;
        tocList.id = 'lc-toc-list-' + listSeq;
      }

      toggleButton = doc.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'lc-toc-toggle';
      toggleButton.setAttribute('aria-controls', tocList.id);
      toggleButton.setAttribute('aria-expanded', state.ariaExpanded());
      toggleButton.textContent = state.label();
      toggleButton.addEventListener('click', function () {
        applyCollapsed(!state.collapsed());
      });

      if (tocTitle && tocTitle.parentNode === tocNav) {
        tocNav.insertBefore(toggleButton, tocTitle.nextSibling);
      } else {
        tocNav.insertBefore(toggleButton, tocNav.firstChild);
      }
      applyCollapsed(state.collapsed(), false);
    }

    /* ---- 正文检索 ---- */

    function clearSearch() {
      var marks = searchRoot.querySelectorAll('mark[data-lc-search-hit]');
      Array.prototype.forEach.call(marks, function (mark) {
        var parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(doc.createTextNode(mark.textContent), mark);
        if (parent.normalize) parent.normalize();
      });
      hits = [];
      hitIndex = -1;
      query = '';
      notify();
    }

    function searchableTextNodes() {
      var out = [];
      if (!doc.createTreeWalker) return out;
      var walker = doc.createTreeWalker(searchRoot, SHOW_TEXT, function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return FILTER_REJECT;
        var parent = node.parentNode;
        if (!parent || parent.nodeType !== 1) return FILTER_REJECT;
        var tag = String(parent.nodeName || '').toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'mark') return FILTER_REJECT;
        if (parent.closest && parent.closest('.lc-article-aside, .lc-article-nav, [data-lc-search-skip]')) {
          return FILTER_REJECT;
        }
        return FILTER_ACCEPT;
      }, false);

      var node = walker.nextNode();
      while (node) {
        out.push(node);
        node = walker.nextNode();
      }
      return out;
    }

    function makeMark(text) {
      var mark = doc.createElement('mark');
      mark.className = 'lc-search-hit';
      mark.setAttribute('data-lc-search-hit', '');
      mark.textContent = text;
      return mark;
    }

    function wrapMatches(textNode, needle) {
      var segments = searchSegments(textNode.nodeValue, needle);
      var hasHit = false;
      segments.forEach(function (segment) { if (segment.hit) hasHit = true; });
      if (!hasHit) return;

      var parent = textNode.parentNode;
      if (!parent) return;
      var frag = doc.createDocumentFragment();
      segments.forEach(function (segment) {
        frag.appendChild(segment.hit ? makeMark(segment.text) : doc.createTextNode(segment.text));
      });
      parent.replaceChild(frag, textNode);
    }

    function highlightCurrent(scroll) {
      hits.forEach(function (mark, index) {
        var on = index === hitIndex;
        if (mark.classList) mark.classList.toggle('is-current', on);
        if (on) mark.setAttribute('data-lc-search-current', 'true');
        else mark.removeAttribute('data-lc-search-current');
      });
      if (scroll && hits[hitIndex]) {
        var m = metrics();
        scrollToElement(hits[hitIndex], 'smooth', Math.max(24, Math.round(m.client * 0.25)));
      }
      notify();
    }

    function search(value, searchOptions) {
      var sOpts = searchOptions || {};
      clearSearch();
      var needle = String(value == null ? '' : value).trim();
      if (!needle) return searchState();

      query = needle;
      searchableTextNodes().forEach(function (node) { wrapMatches(node, needle); });
      hits = Array.prototype.slice.call(searchRoot.querySelectorAll('mark[data-lc-search-hit]'));
      hitIndex = hits.length ? 0 : -1;
      if (hitIndex >= 0) highlightCurrent(!!sOpts.scroll);
      else notify();
      return searchState();
    }

    function stepHit(delta) {
      if (!hits.length) return -1;
      hitIndex = stepIndex(hitIndex, hits.length, delta);
      highlightCurrent(true);
      return hitIndex;
    }

    function searchState() {
      return {
        query: query,
        total: hits.length,
        index: hitIndex,
        current: hitIndex >= 0 ? hitIndex + 1 : 0
      };
    }

    /* ---- 状态与生命周期 ---- */

    function getState() {
      return {
        activeId: activeId,
        collapsed: state.collapsed(),
        query: query,
        total: hits.length,
        hitIndex: hitIndex,
        offset: offsetValue(),
        scroller: scroller || null,
        usesWindow: !scroller,
        targets: targets.length
      };
    }

    function notify() {
      if (typeof opts.onChange === 'function') {
        try { opts.onChange(getState()); } catch (error) { /* 回调异常不影响交互 */ }
      }
    }

    function refresh() {
      removeToggle();
      var info = collectTargets();
      tocNav = info.nav;
      tocList = tocNav ? tocNav.querySelector('.lc-article-toc-list') : null;
      tocTitle = tocNav ? tocNav.querySelector('.lc-article-toc-title') : null;
      targets = info.list;
      setupToggle();
      observe();
      updateActive();
    }

    function onHashChange() {
      if (destroyed) return;
      applyHash(win.location.hash);
    }

    function onResize() { scheduleUpdate(); }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearSearch();
      if (io) { io.disconnect(); io = null; }
      if (scroller) scroller.removeEventListener('scroll', scheduleUpdate);
      else win.removeEventListener('scroll', scheduleUpdate);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('hashchange', onHashChange);
      if (tocNav) tocNav.removeEventListener('click', onTocClick);
      if (rafHandle) {
        if (win.cancelAnimationFrame) win.cancelAnimationFrame(rafHandle);
        else win.clearTimeout(rafHandle);
      }
      removeToggle();
      targets = [];
      activeId = '';
    }

    /* ---- 初始化 ---- */

    var collected = collectTargets();
    tocNav = collected.nav;
    tocList = tocNav ? tocNav.querySelector('.lc-article-toc-list') : null;
    tocTitle = tocNav ? tocNav.querySelector('.lc-article-toc-title') : null;
    targets = collected.list;
    setupToggle();

    if (scroller) scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    else win.addEventListener('scroll', scheduleUpdate, { passive: true });
    win.addEventListener('resize', onResize);
    win.addEventListener('hashchange', onHashChange);
    if (tocNav) tocNav.addEventListener('click', onTocClick);

    observe();
    updateActive();

    if (opts.deepLink !== false && win.location.hash) {
      var openHash = win.location.hash;
      var kick = function () { if (!destroyed) applyHash(openHash); };
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(kick);
      else win.setTimeout(kick, 0);
    }

    return {
      root: pageRoot,
      scroller: scroller || null,
      usesWindow: !scroller,
      refresh: refresh,
      update: scheduleUpdate,
      getState: getState,
      activeId: function () { return activeId; },
      setActive: setActive,
      goToSection: goToSection,
      scrollToSection: function (id, behavior) { return goToSection(id, { behavior: behavior || 'smooth' }); },
      applyHash: applyHash,
      isCollapsed: function () { return state.collapsed(); },
      setCollapsed: function (collapsed) { applyCollapsed(!!collapsed); return state.collapsed(); },
      toggleCollapsed: function () { applyCollapsed(!state.collapsed()); return state.collapsed(); },
      search: search,
      nextHit: function () { return stepHit(1); },
      prevHit: function () { return stepHit(-1); },
      clearSearch: clearSearch,
      searchState: searchState,
      destroy: destroy
    };
  }

  function enhanceInteractions(pageRoot, options) {
    return createInteractions(pageRoot, options);
  }

  R.parsePx = parsePx;
  R.reachedBottom = reachedBottom;
  R.pickActiveSection = pickActiveSection;
  R.searchSegments = searchSegments;
  R.stepIndex = stepIndex;
  R.sectionIdFromHash = sectionIdFromHash;
  R.scrollTopFor = scrollTopFor;
  R.createTocState = createTocState;
  R.createInteractions = createInteractions;
  R.enhanceInteractions = enhanceInteractions;
  R.interactionsCss = function () { return INTERACTIONS_CSS; };

  return R;
}));
