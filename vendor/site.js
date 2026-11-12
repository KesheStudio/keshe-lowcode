/* 科设文档 · 站点脚本
   纯手写，无第三方依赖。所有功能在静态页面上就地运行。 */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var LS_THEME = 'czgrzx-docs-theme';
  var LS_LEARNING = 'czgrzx-docs-learning';
  var LS_CONSENT = 'czgrzx-security-consent';
  var LS_NOTICE_PROGRESS = 'czgrzx-security-read';
  var NOTICE_VERSION = '2026-11-06.b6f3cae1';
  var NOTICE_PATH = '/notice.html';

  /* 低代码建站器导出补丁：把站内绝对路径改成相对路径。
     body 上的 data-site-depth 表示当前页在站点根下的层数，
     比如 /articles/frontend/basics/browser/foo.html 是 4 层。
     这样导出包既能 nginx 直出，也能本地双击打开。 */
  function siteDepth() {
    var b = doc.body;
    var raw = b ? b.getAttribute('data-site-depth') : '';
    var n = parseInt(raw, 10);
    return Math.max(0, isNaN(n) ? 0 : n);
  }

  function siteUrl(path) {
    var prefix = new Array(siteDepth() + 1).join('../');
    return prefix + String(path == null ? '' : path).replace(/^\/+/, '');
  }

  function qs(sel, scope) {
    return (scope || doc).querySelector(sel);
  }

  function qsa(sel, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(sel));
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function escReg(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ---------------- 提示条 ---------------- */

  var toastTimer = 0;

  function toast(message) {
    var el = qs('[data-toast]');
    if (!el) {
      el = doc.createElement('div');
      el.className = 'toast';
      el.setAttribute('data-toast', '');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      doc.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.classList.remove('is-visible');
    }, 2600);
  }

  function copyText(text, okMessage) {
    function fallback() {
      var area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.left = '-9999px';
      doc.body.appendChild(area);
      area.select();
      var done = false;
      try {
        done = doc.execCommand('copy');
      } catch (err) {
        done = false;
      }
      doc.body.removeChild(area);
      toast(done ? okMessage : '复制失败，请手动复制：' + text);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMessage);
      }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------------- 明暗主题 ---------------- */

  function initTheme() {
    var btn = qs('[data-theme-toggle]');
    if (!btn) return;

    function apply(theme, persist) {
      root.setAttribute('data-theme', theme);
      if (persist) {
        try {
          localStorage.setItem(LS_THEME, theme);
        } catch (err) { /* 忽略存储不可用 */ }
      }
      btn.setAttribute('aria-label', theme === 'dark' ? '切换为浅色主题' : '切换为深色主题');
      btn.setAttribute('title', theme === 'dark' ? '切换为浅色主题' : '切换为深色主题');
      var meta = qs('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme === 'dark' ? '#141a1f' : '#f4f0e6');
    }

    btn.addEventListener('click', function () {
      apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });

    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function (e) {
      var saved = null;
      try {
        saved = localStorage.getItem(LS_THEME);
      } catch (err) { /* 忽略 */ }
      if (!saved) apply('light', false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }

  /* ---------------- 文章是否已产出 ---------------- */

  var catalog = [];
  var warnedCatalog = false;

  function getCatalog() {
    if (catalog.length) return catalog;
    var data = window.CZ_ARTICLES;
    if (data && Array.isArray(data.articles)) catalog = data.articles;
    else if (!warnedCatalog) {
      warnedCatalog = true;
      if (window.console && console.warn) {
        console.warn('[czgrzx-docs] 没有读到文章元数据（/data/articles.js），列表照常显示，可用性标记、学习记录和搜索会退化为静态内容。');
      }
    }
    return catalog;
  }

  function slugSet() {
    var map = {};
    getCatalog().forEach(function (item) {
      if (item && item.slug) map[item.slug] = item;
    });
    return map;
  }

  function articleBySlug(slug) {
    return slugSet()[slug] || null;
  }

  function applyAvailability() {
    var data = window.CZ_ARTICLES;
    if (!data || !Array.isArray(data.articles)) return;
    var known = slugSet();

    qsa('[data-slug]').forEach(function (el) {
      if (!el.matches('[data-article-card], .article-row, .route-step, [data-preview-card]')) return;
      var slug = el.getAttribute('data-slug');
      if (!slug) return;
      if (known[slug]) {
        el.classList.remove('is-pending');
        el.removeAttribute('data-pending');
        var badge = el.querySelector('[data-availability]');
        if (badge) badge.hidden = true;
        var stateBtn = el.querySelector('[data-step-state]');
        if (stateBtn && stateBtn.getAttribute('data-pending-label')) {
          stateBtn.removeAttribute('data-pending-label');
        }
        return;
      }
      el.classList.add('is-pending');
      el.setAttribute('data-pending', '1');
      var avail = el.querySelector('[data-availability]');
      if (avail) avail.hidden = false;
      var btn = el.querySelector('[data-step-state]');
      if (btn) {
        btn.textContent = '待更新';
        btn.setAttribute('data-pending-label', '1');
      }
    });
  }

  doc.addEventListener('click', function (e) {
    var pending = e.target.closest('[data-pending="1"], [data-static-pending]');
    if (!pending) return;
    e.preventDefault();
    e.stopPropagation();
    toast('这篇还在写，先把已经有的看完吧。');
  }, false);

  /* 正文里指向还没写完的文章时，不让人撞到 404 */
  doc.addEventListener('click', function (e) {
    if (!window.CZ_ARTICLES || !Array.isArray(window.CZ_ARTICLES.articles)) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    var url;
    try {
      url = new URL(link.href, location.href);
    } catch (err) {
      return;
    }
    if (url.origin !== location.origin) return;
    if (!/^\/articles\/[^/]+\/[^/]+\/[^/]+\/[^/]+\.html$/i.test(url.pathname)) return;
    var slug = url.pathname.split('/').pop().replace(/\.html$/i, '');
    if (slugSet()[slug]) return;
    e.preventDefault();
    e.stopPropagation();
    toast('这篇还在写，先把已经有的看完吧。');
  }, false);

  /* ---------------- 页面切换过渡 ---------------- */

  function initTransitions() {
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) root.classList.remove('is-leaving');
    });

    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var link = e.target.closest('a[href]');
      if (!link) return;
      if (link.target && link.target !== '_self') return;
      if (link.hasAttribute('download') || link.hasAttribute('data-no-transition')) return;

      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;

      var url;
      try {
        url = new URL(link.href, location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return;
      if (reduceMotion.matches) return;

      e.preventDefault();
      root.classList.add('is-leaving');
      window.setTimeout(function () {
        location.href = link.href;
      }, 150);
    }, false);
  }

  /* ---------------- 本地学习记录 ---------------- */

  var emptyStore = function () {
    return { version: 1, articles: {}, routes: [] };
  };

  var memoryStore = null;

  function readStore() {
    try {
      var raw = localStorage.getItem(LS_LEARNING);
      if (!raw) return emptyStore();
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return emptyStore();
      if (!data.articles || typeof data.articles !== 'object') data.articles = {};
      if (!Array.isArray(data.routes)) data.routes = [];
      return data;
    } catch (err) {
      return memoryStore || emptyStore();
    }
  }

  function writeStore(data) {
    memoryStore = data;
    try {
      localStorage.setItem(LS_LEARNING, JSON.stringify(data));
    } catch (err) { /* 存储满了就只在内存里生效 */ }
  }

  function touchArticle(slug, patch) {
    var store = readStore();
    var current = store.articles[slug] || { state: 'unread', lastSection: '', lastAt: 0 };
    store.articles[slug] = Object.assign({}, current, patch, { lastAt: Date.now() });
    writeStore(store);
    return store.articles[slug];
  }

  /* ---------------- 文章页 ---------------- */

  function ensureJsonLd() {
    if (qs('script[type="application/ld+json"]')) return;
    var h1 = qs('.article-head h1');
    if (!h1) return;
    var canonical = qs('link[rel="canonical"]');
    var desc = qs('meta[name="description"]');
    var metaBox = qs('.article-meta');
    var tags = metaBox && metaBox.getAttribute('data-tags')
      ? metaBox.getAttribute('data-tags').split(',') : [];
    var section = qs('.article-meta .badge:not(.badge-level)');
    var data = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: h1.textContent.trim(),
      description: desc ? desc.getAttribute('content') : '',
      inLanguage: 'zh-CN',
      url: canonical ? canonical.href : location.href,
      mainEntityOfPage: canonical ? canonical.href : location.href,
      articleSection: section ? section.textContent.trim() : '',
      keywords: tags.join(','),
      author: { '@type': 'Organization', name: '科设文档' },
      publisher: { '@type': 'Organization', name: '科设文档' }
    };
    var script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    doc.head.appendChild(script);
  }

  function currentSlug() {
    var name = location.pathname.split('/').pop() || '';
    return name.replace(/\.html$/i, '');
  }

  /* ---------------- 文章左侧：路线 / 同标签 ---------------- */

  var ROUTE_CTX_KEY = 'czgrzx-route-context';

  function readRouteCtx() {
    try {
      return JSON.parse(sessionStorage.getItem(ROUTE_CTX_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }

  function writeRouteCtx(routeId, slug) {
    try {
      sessionStorage.setItem(ROUTE_CTX_KEY, JSON.stringify({ route: routeId, slug: slug }));
    } catch (err) { /* 忽略 */ }
  }

  function clearRouteCtx() {
    try {
      sessionStorage.removeItem(ROUTE_CTX_KEY);
    } catch (err) { /* 忽略 */ }
  }

  function presetRoutes() {
    if (window.CZ_ROUTES && Array.isArray(window.CZ_ROUTES.routes)) return window.CZ_ROUTES.routes;
    if (!presetRoutes.warned) {
      presetRoutes.warned = true;
      if (window.console && console.warn) {
        console.warn('[czgrzx-docs] 没有读到预设路线（/data/routes.js），文章页左侧会退回同标签文章。');
      }
    }
    return [];
  }

  function findRouteById(id) {
    if (!id) return null;
    var found = null;
    presetRoutes().forEach(function (route) {
      if (route && route.id === id) found = route;
    });
    if (found) return found;
    readStore().routes.forEach(function (route) {
      if (route && route.id === id) found = route;
    });
    return found;
  }

  function normalizeRoute(route) {
    if (!route) return null;
    var map = slugSet();
    var steps = (route.steps || []).map(function (step) {
      if (typeof step === 'string') {
        var meta = map[step];
        return {
          slug: step,
          title: meta ? meta.title : step,
          meta: meta ? (meta.difficulty || '') : '待更新',
          pending: !meta
        };
      }
      var item = map[step.slug];
      return {
        slug: step.slug || '',
        title: step.title || (item ? item.title : ''),
        meta: step.meta || (item ? (item.difficulty || '') : ''),
        pending: step.pending || !step.slug
      };
    });
    return { id: route.id, name: route.name, intro: route.intro || '', steps: steps };
  }

  function routeContextFor(slug) {
    var map = slugSet();
    var urlId = '';
    try {
      urlId = new URLSearchParams(location.search).get('route') || '';
    } catch (err) { /* 忽略 */ }

    var navType = '';
    try {
      var navEntry = performance.getEntriesByType('navigation')[0];
      navType = navEntry ? navEntry.type : '';
    } catch (err) { /* 忽略 */ }

    // 没有 ?route= 时，只有刷新才沿用上次的路线上下文；
    // 从搜索或目录点进来按同标签渲染，避免残留上下文误判。
    var saved = readRouteCtx();
    if (!urlId && navType !== 'reload') {
      clearRouteCtx();
      saved = null;
    }
    if (saved && saved.slug !== slug) {
      clearRouteCtx();
      saved = null;
    }

    var route = resolveRoute(urlId) || resolveRoute(saved && saved.route);
    if (!route) return null;
    var written = route.steps.filter(function (step) {
      return step.slug && map[step.slug];
    });
    var index = -1;
    written.forEach(function (step, i) {
      if (step.slug === slug) index = i;
    });
    if (index === -1) return null;
    var pending = route.steps.filter(function (step) { return !step.slug || step.pending; });
    writeRouteCtx(route.id, slug);
    return { id: route.id, name: route.name, written: written, index: index, pending: pending };
  }

  function resolveRoute(id) {
    if (!id) return null;
    return normalizeRoute(findRouteById(id));
  }

  function relatedArticlesFor(slug) {
    var map = slugSet();
    var current = map[slug];
    var metaBox = qs('.article-meta');
    var tags = current && current.tags && current.tags.length
      ? current.tags
      : (metaBox ? (metaBox.getAttribute('data-tags') || '').split(',').filter(Boolean) : []);
    var topic = current ? current.topic : (metaBox ? metaBox.getAttribute('data-group') : '');

    var items = getCatalog().filter(function (article) {
      return article && article.slug !== slug;
    }).map(function (article) {
      var shared = (article.tags || []).filter(function (tag) {
        return tags.indexOf(tag) !== -1;
      }).length;
      return {
        article: article,
        shared: shared,
        sameTopic: topic && article.topic === topic ? 1 : 0,
        order: article.order || 0
      };
    }).filter(function (item) {
      return item.shared > 0;
    }).sort(function (a, b) {
      if (b.shared !== a.shared) return b.shared - a.shared;
      if (b.sameTopic !== a.sameTopic) return b.sameTopic - a.sameTopic;
      return a.order - b.order;
    }).slice(0, 8);

    return { tags: tags, items: items };
  }

  function routeNavHtml(ctx) {
    var map = slugSet();
    var list = ctx.written.map(function (step, i) {
      var isCurrent = i === ctx.index;
      var meta = map[step.slug];
      var href = siteUrl(meta ? meta.url : 'articles/') + '?route=' + encodeURIComponent(ctx.id);
      return '<li class="context-item' + (isCurrent ? ' is-current' : '') + '">' +
        '<a' + (isCurrent ? ' aria-current="true"' : '') + ' href="' + esc(href) + '">' +
        '<span class="context-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="context-name">' + esc(step.title) + '</span>' +
        '</a></li>';
    }).join('');

    var pending = ctx.pending.length
      ? '<li class="context-pending-label">路线里还没写的</li>' + ctx.pending.map(function (step) {
        return '<li class="context-item is-pending"><span class="context-no">·</span><span class="context-name">' + esc(step.title) + '</span></li>';
      }).join('')
      : '';

    return '<p class="context-kicker">学习路线</p>' +
      '<h2 class="context-title"><a href="' + siteUrl('learning.html') + '?route=' + encodeURIComponent(ctx.id) + '">' + esc(ctx.name) + '</a></h2>' +
      '<p class="context-sub">第 ' + (ctx.index + 1) + ' 篇 / 共 ' + ctx.written.length + ' 篇已上线</p>' +
      '<ol class="context-list">' + list + pending + '</ol>' +
      '<a class="context-back" href="' + siteUrl('learning.html') + '?route=' + encodeURIComponent(ctx.id) + '">回到这条路线</a>';
  }

  function relatedNavHtml(related, slug) {
    if (!related.items.length) {
      return '<p class="context-kicker">同标签</p><h2 class="context-title">相关文章</h2>' +
        '<p class="context-empty">暂时没有同标签的其他文章。</p>' +
        '<a class="context-back" href="' + siteUrl('articles/') + '">去看全部文章</a>';
    }
    var list = related.items.map(function (item) {
      return '<li class="context-item"><a href="' + esc(siteUrl(item.article.url)) + '">' +
        '<span class="context-name">' + esc(item.article.title) + '</span>' +
        '<span class="context-meta">' + esc(item.article.difficulty || '') + '</span>' +
        '</a></li>';
    }).join('');
    return '<p class="context-kicker">同标签</p>' +
      '<h2 class="context-title">相关文章</h2>' +
      '<p class="context-sub">按共同标签挑的 · ' + related.tags.slice(0, 2).join(' / ') + '</p>' +
      '<ol class="context-list">' + list + '</ol>' +
      '<a class="context-back" href="' + siteUrl('articles/') + '?tag=' + encodeURIComponent(related.tags[0] || '') + '">按标签看全部</a>';
  }

  function initArticleContext(slug) {
    var layout = qs('.article-layout');
    if (!layout) return;
    var ctx = routeContextFor(slug);
    var bodyHtml;
    var label;
    if (ctx) {
      bodyHtml = routeNavHtml(ctx);
      label = '这条路线 · ' + ctx.name + '（第 ' + (ctx.index + 1) + ' / ' + ctx.written.length + ' 篇）';
    } else {
      var related = relatedArticlesFor(slug);
      bodyHtml = relatedNavHtml(related, slug);
      label = related.items.length ? '同标签的相关文章（' + related.items.length + ' 篇）' : '相关文章';
    }

    var aside = doc.createElement('aside');
    aside.className = 'article-context';
    aside.setAttribute('aria-label', ctx ? '路线内文章' : '相关文章');
    aside.innerHTML = bodyHtml;
    layout.insertBefore(aside, layout.firstChild);
    layout.classList.add('has-context');

    var head = qs('.article-head');
    if (head) {
      var inline = doc.createElement('details');
      inline.className = 'context-inline';
      inline.innerHTML = '<summary>' + esc(label) + '</summary><div class="context-inline-body">' + bodyHtml + '</div>';
      head.parentNode.insertBefore(inline, head.nextSibling);
    }

    if (ctx) {
      qsa('.article-foot a[href]').forEach(function (link) {
        var href = link.getAttribute('href');
        if (!href || href.charAt(0) === '#' || /\?/.test(href)) return;
        link.setAttribute('href', href + '?route=' + encodeURIComponent(ctx.id));
      });
    }
  }

  function initArticle() {
    var body = qs('.article-body');
    if (!body) return;
    var slug = currentSlug();
    var isPreview = slug.charAt(0) === '_';
    ensureJsonLd();
    initArticleContext(slug);

    // 只收正文直属层级的标题；figure / compare 卡片内部的 h3 保留 id，但不进目录
    var headings = Array.prototype.slice.call(body.children).filter(function (el) {
      return el.tagName === 'H2' || el.tagName === 'H3';
    });
    var index = 0;
    headings.forEach(function (h) {
      if (!h.id) {
        index += 1;
        h.id = 'section-' + index;
      }
      if (!h.querySelector('.heading-anchor')) {
        var anchor = doc.createElement('a');
        anchor.className = 'heading-anchor';
        anchor.href = '#' + h.id;
        anchor.setAttribute('data-copy-anchor', h.id);
        anchor.setAttribute('aria-label', '复制这一段落的链接');
        anchor.setAttribute('title', '复制段落链接');
        anchor.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.6 14.4a4.2 4.2 0 0 0 5.9 0l2.2-2.2a4.2 4.2 0 0 0-5.9-5.9l-1.1 1.1" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14.4 9.6a4.2 4.2 0 0 0-5.9 0l-2.2 2.2a4.2 4.2 0 0 0 5.9 5.9l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
        h.appendChild(anchor);
      }
    });

    // 目录
    var tocHost = qs('[data-toc]');
    var tocHtml = '';
    if (headings.length) {
      tocHtml = '<p class="toc-title">本页目录</p><ol class="toc-list">';
      headings.forEach(function (h) {
        tocHtml += '<li class="toc-' + h.tagName.toLowerCase() + '"><a href="#' + h.id + '">' + esc(h.textContent.trim()) + '</a></li>';
      });
      tocHtml += '</ol><a class="toc-top" href="#" data-to-top>回到文章顶部</a>';
    } else if (tocHost) {
      tocHtml = '<p class="toc-title">本页目录</p><p class="toc-empty">这篇没有分节标题。</p><a class="toc-top" href="#" data-to-top>回到文章顶部</a>';
    }

    if (tocHost) tocHost.innerHTML = tocHtml;

    // 窄屏用可折叠目录
    var inlineToc = null;
    var inlineSlot = null;
    function syncInlineToc() {
      var narrow = window.matchMedia('(max-width: 900px)').matches;
      if (narrow && headings.length) {
        if (!inlineToc) {
          inlineToc = doc.createElement('details');
          inlineToc.className = 'toc-inline';
          inlineToc.innerHTML = '<summary>本页目录</summary>' + tocHtml;
          inlineSlot = qs('.article-head');
          if (inlineSlot && inlineSlot.parentNode) {
            inlineSlot.parentNode.insertBefore(inlineToc, inlineSlot.nextSibling);
          }
        }
      } else if (inlineToc && inlineToc.parentNode) {
        inlineToc.parentNode.removeChild(inlineToc);
        inlineToc = null;
      }
    }
    syncInlineToc();
    window.addEventListener('resize', function () {
      window.clearTimeout(syncInlineToc.timer);
      syncInlineToc.timer = window.setTimeout(syncInlineToc, 150);
    });

    // 锚点复制
    doc.addEventListener('click', function (e) {
      var anchor = e.target.closest('[data-copy-anchor]');
      if (!anchor) return;
      e.preventDefault();
      var canonical = qs('link[rel="canonical"]');
      var base = canonical ? canonical.href.replace(/#.*$/, '') : location.origin + location.pathname;
      copyText(base + '#' + anchor.getAttribute('data-copy-anchor'), '段落链接已复制');
    });

    // 回到顶部
    doc.addEventListener('click', function (e) {
      var top = e.target.closest('[data-to-top]');
      if (!top) return;
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      history.replaceState(null, '', location.pathname + location.search);
    });

    // 阅读进度条
    var bar = doc.createElement('div');
    bar.className = 'read-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(doc.createElement('i'));
    doc.body.appendChild(bar);
    var barInner = bar.firstChild;

    // 当前段落 + 阅读记录
    var tocLinks = [];
    function collectTocLinks() {
      tocLinks = qsa('[data-toc] a[href^="#"], .toc-inline a[href^="#"]');
    }
    collectTocLinks();

    var lastSavedSection = '';

    function activeHeadingId() {
      var current = '';
      for (var i = 0; i < headings.length; i += 1) {
        var rect = headings[i].getBoundingClientRect();
        if (rect.top <= 110) current = headings[i].id;
        else break;
      }
      return current;
    }

    function onScroll() {
      var top = window.scrollY || doc.documentElement.scrollTop;
      var height = doc.documentElement.scrollHeight - window.innerHeight;
      var pct = height > 0 ? Math.min(1, Math.max(0, top / height)) : 0;
      barInner.style.width = (pct * 100).toFixed(2) + '%';

      var active = activeHeadingId();
      if (tocLinks.length) {
        tocLinks.forEach(function (link) {
          var target = link.getAttribute('href').slice(1);
          link.classList.toggle('is-active', target === active);
        });
      }
      if (!isPreview && active && active !== lastSavedSection) {
        lastSavedSection = active;
        touchArticle(slug, { lastSection: active });
      }
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        onScroll();
      });
    }, { passive: true });

    if (!isPreview) {
      var entry = readStore().articles[slug];
      var state = entry && entry.state ? entry.state : 'unread';
      touchArticle(slug, {
        state: state === 'unread' ? 'reading' : state,
        lastSection: entry && entry.lastSection ? entry.lastSection : (location.hash ? location.hash.slice(1) : '')
      });
    }

    // 阅读工具条
    if (!isPreview) {
      var meta = qs('.article-meta');
      if (meta) {
        var tools = doc.createElement('div');
        tools.className = 'reading-tools';
        tools.innerHTML = '<span class="reading-chip" data-reading-chip>在读</span><button class="mark-read" type="button" data-mark-read>标记为已读</button><span class="reading-hint">阅读位置只记在这台设备上</span>';
        meta.parentNode.insertBefore(tools, meta.nextSibling);
        var chip = qs('[data-reading-chip]', tools);
        var markBtn = qs('[data-mark-read]', tools);
        var labels = { unread: '未读', reading: '在读', read: '已读' };

        function paintState() {
          var s = readStore().articles[slug] || { state: 'unread' };
          var st = s.state || 'unread';
          chip.textContent = labels[st];
          chip.setAttribute('data-state', st);
          markBtn.textContent = st === 'read' ? '标记为未读' : '标记为已读';
        }
        paintState();
        markBtn.addEventListener('click', function () {
          var current = (readStore().articles[slug] || {}).state || 'unread';
          touchArticle(slug, { state: current === 'read' ? 'unread' : 'read' });
          paintState();
          toast(current === 'read' ? '已标记为未读' : '已标记为已读');
        });
      }
    }

    onScroll();
  }

  /* ---------------- 通用筛选 ---------------- */

  var FILTER_KEYS = ['direction', 'series', 'topic'];
  var FILTER_LABELS = { direction: '方向', series: '系列', topic: '主题', tag: '标签' };

  function readFilterState() {
    var state = { direction: '', series: '', topic: '', tags: [] };
    try {
      var params = new URLSearchParams(location.search);
      state.direction = params.get('direction') || '';
      state.series = params.get('series') || '';
      state.topic = params.get('category') || params.get('topic') || '';
      var raw = params.getAll('tag');
      var tags = [];
      raw.forEach(function (item) {
        String(item).split(',').forEach(function (tag) {
          tag = tag.trim();
          if (tag && tags.indexOf(tag) === -1) tags.push(tag);
        });
      });
      state.tags = tags;
    } catch (err) { /* 忽略 */ }
    return state;
  }

  function filterParams(state) {
    var params = new URLSearchParams(location.search);
    ['direction', 'series', 'category', 'topic', 'level', 'tag'].forEach(function (key) {
      params.delete(key);
    });
    if (state.direction) params.set('direction', state.direction);
    if (state.series) params.set('series', state.series);
    if (state.topic) params.set('category', state.topic);
    if (state.tags && state.tags.length) params.set('tag', state.tags.join(','));
    return params;
  }

  function writeFilterUrl(state, push) {
    var params = filterParams(state);
    var search = params.toString();
    var url = location.pathname + (search ? '?' + search : '');
    try {
      if (push) history.pushState(null, '', url);
      else history.replaceState(null, '', url);
    } catch (err) { /* 忽略 */ }
  }

  function activeFilterCount(state) {
    var count = FILTER_KEYS.filter(function (key) { return state[key]; }).length;
    if (state.tags && state.tags.length) count += 1;
    return count;
  }

  function filterReason(state, labels) {
    var parts = [];
    FILTER_KEYS.forEach(function (key) {
      if (!state[key]) return;
      var name = labels && labels[key] ? (labels[key][state[key]] || state[key]) : state[key];
      parts.push(FILTER_LABELS[key] + '：' + name);
    });
    if (state.tags && state.tags.length) {
      parts.push('标签：' + state.tags.map(function (tag) {
        return labels && labels.tag ? (labels.tag[tag] || tag) : tag;
      }).join(' / ') + '（任一满足）');
    }
    return parts.join('；');
  }

  function metaMatches(meta, state) {
    if (!meta) return false;
    if (state.direction && meta.direction !== state.direction) return false;
    if (state.series && meta.series !== state.series) return false;
    if (state.topic) {
      if (state.topic.indexOf('::') !== -1) {
        if ((meta.direction || '') + '::' + meta.topic !== state.topic) return false;
      } else if (meta.topic !== state.topic) {
        return false;
      }
    }
    if (state.tags && state.tags.length) {
      var hit = (meta.tags || []).some(function (tag) {
        return state.tags.indexOf(tag) !== -1;
      });
      if (!hit) return false;
    }
    return true;
  }

  function directionName(id) {
    var registry = window.CZ_DIRECTIONS && window.CZ_DIRECTIONS.directions;
    if (registry) {
      for (var i = 0; i < registry.length; i += 1) {
        if (registry[i].id === id) return registry[i].name;
      }
    }
    return id;
  }

  function collectFilterOptions(metas) {
    var options = { direction: {}, series: {}, topic: {}, tag: {} };

    metas.forEach(function (meta) {
      if (meta.direction) options.direction[meta.direction] = meta.directionName || directionName(meta.direction);
      if (meta.series) options.series[meta.series] = meta.seriesName || meta.series;
      if (meta.topic) options.topic[(meta.direction || '') + '::' + meta.topic] = meta.topicName || meta.topic;
      (meta.tags || []).forEach(function (tag) { options.tag[tag] = tag; });
    });

    var result = {};
    result.direction = Object.keys(options.direction).map(function (key) {
      return { value: key, label: options.direction[key] };
    });
    result.series = Object.keys(options.series).map(function (key) {
      return { value: key, label: options.series[key] };
    });
    result.topic = Object.keys(options.topic).map(function (key) {
      return { value: key, label: options.topic[key] };
    });
    result.tag = Object.keys(options.tag).sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN');
    }).map(function (tag) { return { value: tag, label: tag }; });
    return result;
  }

  function setupFilterBar(bar, metas, state, onChange) {
    var options = collectFilterOptions(metas);
    var labels = {};

    ['direction', 'series', 'topic', 'tag'].forEach(function (key) {
      labels[key] = {};
      options[key].forEach(function (item) { labels[key][item.value] = item.label; });
    });
    metas.forEach(function (meta) {
      if (meta.topic && !labels.topic[meta.topic]) labels.topic[meta.topic] = meta.topicName || meta.topic;
    });

    function topicsFor(direction) {
      var seen = {};
      metas.forEach(function (meta) {
        if (!meta.topic) return;
        if (direction && meta.direction !== direction) return;
        seen[(meta.direction || '') + '::' + meta.topic] = meta.topicName || meta.topic;
        // 旧链接可能只用裸主题 id，保留中文标签用于摘要
        if (!seen[meta.topic]) seen[meta.topic] = meta.topicName || meta.topic;
      });
      return Object.keys(seen).map(function (key) {
        return { value: key, label: seen[key] };
      }).filter(function (item) {
        return item.value.indexOf('::') !== -1;
      });
    }

    function makeChips(box, key, items) {
      if (!box) return;
      box.innerHTML = '';
      var all = doc.createElement('button');
      all.className = 'filter-chip';
      all.type = 'button';
      all.setAttribute('data-filter', key);
      all.setAttribute('data-value', '');
      all.textContent = '全部';
      box.appendChild(all);

      items.forEach(function (item) {
        var chip = doc.createElement('button');
        chip.className = 'filter-chip';
        chip.type = 'button';
        chip.setAttribute('data-filter', key);
        chip.setAttribute('data-value', item.value);
        chip.textContent = item.label;
        box.appendChild(chip);
      });
    }

    var directionBox = qs('[data-options="direction"]', bar);
    var seriesBox = qs('[data-options="series"]', bar);
    var topicBox = qs('[data-options="topic"]', bar);

    makeChips(directionBox, 'direction', options.direction);
    makeChips(seriesBox, 'series', options.series);

    function renderTopics() {
      var items = topicsFor(state.direction);
      var exists = items.some(function (item) { return item.value === state.topic; });
      if (state.topic && !exists) state.topic = '';
      makeChips(topicBox, 'topic', items);
    }

    // 标签搜索与多选
    var selectedBox = qs('[data-tag-selected]', bar);
    var tagInput = qs('[data-tag-search]', bar);
    var suggestBox = qs('[data-tag-suggest]', bar);
    var tagClear = qs('[data-tag-clear]', bar);
    var activeSuggestion = -1;
    var currentSuggestions = [];

    function paintTags() {
      if (!selectedBox) return;
      selectedBox.innerHTML = '';
      state.tags.forEach(function (tag) {
        var chip = doc.createElement('button');
        chip.className = 'tag-selected-chip';
        chip.type = 'button';
        chip.setAttribute('data-remove-tag', tag);
        chip.setAttribute('aria-label', '移除标签 ' + tag);
        chip.textContent = labels.tag[tag] || tag;
        chip.appendChild(doc.createTextNode(' ×'));
        selectedBox.appendChild(chip);
      });
    }

    function renderSuggest() {
      if (!suggestBox || !tagInput) return;
      var query = tagInput.value.trim().toLowerCase();
      var available = options.tag.filter(function (item) {
        return state.tags.indexOf(item.value) === -1;
      });
      var list = available.filter(function (item) {
        return !query
          || item.label.toLowerCase().indexOf(query) !== -1
          || item.value.toLowerCase().indexOf(query) !== -1;
      }).slice(0, 8);

      currentSuggestions = list;
      activeSuggestion = -1;
      suggestBox.innerHTML = '';

      if (!list.length) {
        var emptyItem = doc.createElement('li');
        emptyItem.className = 'tag-suggest-empty';
        emptyItem.textContent = query ? '没有匹配的标签' : '标签都选上了';
        suggestBox.appendChild(emptyItem);
      } else {
        list.forEach(function (item, i) {
          var li = doc.createElement('li');
          li.className = 'tag-suggest-item';
          li.setAttribute('role', 'option');
          li.setAttribute('data-suggest-value', item.value);
          li.textContent = item.label;
          li.addEventListener('mousedown', function (e) { e.preventDefault(); });
          suggestBox.appendChild(li);
        });
      }
      suggestBox.hidden = false;
      tagInput.setAttribute('aria-expanded', 'true');
    }

    function hideSuggest() {
      if (!suggestBox || !tagInput) return;
      suggestBox.hidden = true;
      tagInput.setAttribute('aria-expanded', 'false');
      activeSuggestion = -1;
    }

    function selectTag(tag) {
      if (!tag || state.tags.indexOf(tag) !== -1) return;
      state.tags.push(tag);
      tagInput.value = '';
      paintTags();
      sync();
      onChange(true);
      if (tagInput.focus) tagInput.focus();
      renderSuggest();
    }

    function removeTag(tag) {
      state.tags = state.tags.filter(function (item) { return item !== tag; });
      paintTags();
      sync();
      onChange(true);
    }

    function highlightSuggestion() {
      qsa('.tag-suggest-item', suggestBox).forEach(function (item, i) {
        item.classList.toggle('is-active', i === activeSuggestion);
      });
    }

    if (tagInput && suggestBox) {
      tagInput.addEventListener('input', function () {
        renderSuggest();
      });
      tagInput.addEventListener('focus', function () {
        renderSuggest();
      });
      tagInput.addEventListener('blur', function () {
        window.setTimeout(function () {
          if (!bar.contains(doc.activeElement)) hideSuggest();
        }, 140);
      });
      tagInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          renderSuggest();
          activeSuggestion = Math.min(currentSuggestions.length - 1, activeSuggestion + 1);
          highlightSuggestion();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeSuggestion = Math.max(0, activeSuggestion - 1);
          highlightSuggestion();
        } else if (e.key === 'Enter') {
          if (currentSuggestions.length) {
            e.preventDefault();
            var picked = currentSuggestions[activeSuggestion >= 0 ? activeSuggestion : 0];
            if (picked) selectTag(picked.value);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (tagInput.value) {
            tagInput.value = '';
            renderSuggest();
          } else if (state.tags.length) {
            state.tags = [];
            paintTags();
            sync();
            onChange(true);
          }
          hideSuggest();
        }
      });
    }

    if (tagClear && tagInput) {
      tagClear.addEventListener('click', function () {
        tagInput.value = '';
        state.tags = [];
        paintTags();
        sync();
        onChange(true);
        renderSuggest();
        tagInput.focus();
      });
    }

    function sync() {
      renderTopics();
      qsa('.filter-chip', bar).forEach(function (chip) {
        var key = chip.getAttribute('data-filter');
        var value = chip.getAttribute('data-value') || '';
        chip.setAttribute('aria-pressed', value === (state[key] || '') ? 'true' : 'false');
      });
      paintTags();
      if (tagClear) tagClear.hidden = state.tags.length === 0;
      if (suggestBox && !suggestBox.hidden) renderSuggest();
    }

    bar.addEventListener('click', function (e) {
      var remove = e.target.closest('[data-remove-tag]');
      if (remove) {
        removeTag(remove.getAttribute('data-remove-tag'));
        return;
      }
      var suggest = e.target.closest('.tag-suggest-item');
      if (suggest) {
        selectTag(suggest.getAttribute('data-suggest-value'));
        return;
      }
      var chip = e.target.closest('.filter-chip');
      if (!chip) return;
      var key = chip.getAttribute('data-filter');
      if (!key) return;
      var value = chip.getAttribute('data-value') || '';
      var nextValue = state[key] === value ? '' : value;
      state[key] = nextValue;
      if (key === 'direction') {
        var valid = topicsFor(nextValue).some(function (item) { return item.value === state.topic; });
        if (!valid) state.topic = '';
      }
      sync();
      onChange(true);
    });

    sync();
    return { sync: sync, labels: labels };
  }

  /* ---------------- 文章列表筛选 ---------------- */

  function initArticleFilters() {
    var bar = qs('[data-filters]');
    var list = qs('[data-article-list]');
    if (!bar || !list) return;

    var rows = qsa('.article-row', list);
    var summary = qs('[data-filter-summary]');
    var empty = qs('[data-filter-empty]');
    var clearButtons = qsa('[data-filter-clear]');
    var state = readFilterState();

    var metas = rows.map(function (row) {
      return {
        direction: row.getAttribute('data-direction') || '',
        directionName: directionName(row.getAttribute('data-direction') || ''),
        series: row.getAttribute('data-series') || '',
        seriesName: row.getAttribute('data-series') || '',
        topic: row.getAttribute('data-topic') || row.getAttribute('data-group') || '',
        topicName: '',
        difficulty: row.getAttribute('data-level') || '',
        tags: (row.getAttribute('data-tags') || '').split(',').filter(Boolean),
        row: row
      };
    });

    var catalog = window.CZ_ARTICLES && window.CZ_ARTICLES.articles;
    if (catalog && catalog.length) {
      var bySlug = {};
      catalog.forEach(function (article) { bySlug[article.slug] = article; });
      metas.forEach(function (meta) {
        var row = meta.row;
        var article = bySlug[row.getAttribute('data-slug')];
        if (!article) return;
        meta.directionName = article.directionName || meta.directionName;
        meta.seriesName = article.seriesName || meta.seriesName;
        meta.topicName = article.topicName || meta.topicName;
      });
    }

    var ui = setupFilterBar(bar, metas, state, apply);

    function apply(push) {
      var shown = 0;
      metas.forEach(function (meta) {
        var ok = metaMatches(meta, state);
        meta.row.hidden = !ok;
        if (ok) shown += 1;
      });

      qsa('.list-topic', list).forEach(function (topic) {
        var visible = false;
        qsa('.article-row', topic).forEach(function (row) {
          if (!row.hidden) visible = true;
        });
        topic.hidden = !visible;
      });
      qsa('.list-series', list).forEach(function (series) {
        var visible = false;
        qsa('.list-topic', series).forEach(function (topic) {
          if (!topic.hidden) visible = true;
        });
        series.hidden = !visible;
      });

      var active = activeFilterCount(state);
      if (summary) {
        summary.textContent = shown === rows.length
          ? '共 ' + rows.length + ' 篇'
          : '显示 ' + shown + ' 篇（共 ' + rows.length + ' 篇）';
      }
      if (empty) {
        empty.hidden = shown !== 0;
        var reason = qs('[data-empty-reason]', empty);
        if (reason) {
          reason.textContent = filterReason(state, ui.labels)
            ? '没有同时满足这些条件的文章：' + filterReason(state, ui.labels) + '。'
            : '没有符合当前条件的文章。';
        }
      }
      clearButtons.forEach(function (button) {
        button.hidden = active === 0;
        button.textContent = button.hasAttribute('data-empty-clear') ? '清除全部筛选' : '清除筛选';
      });

      if (push !== null) writeFilterUrl(state, push);
    }

    clearButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        FILTER_KEYS.forEach(function (key) { state[key] = ''; });
        state.tags = [];
        ui.sync();
        apply(true);
      });
    });

    bar.addEventListener('click', function (e) {
      if (e.target.closest('[data-filter-clear]')) {
        FILTER_KEYS.forEach(function (key) { state[key] = ''; });
        state.tags = [];
        ui.sync();
        apply(true);
      }
    });

    window.addEventListener('popstate', function () {
      var next = readFilterState();
      FILTER_KEYS.forEach(function (key) { state[key] = next[key]; });
      state.tags = next.tags.slice();
      ui.sync();
      apply(null);
    });

    apply(false);
  }

  /* ---------------- 安全方向访问闸门 ---------------- */

  function readConsent() {
    try {
      var raw = localStorage.getItem(LS_CONSENT);
      if (!raw) return null;
      var record = JSON.parse(raw);
      if (!record || typeof record !== 'object') return null;
      return record;
    } catch (err) {
      return null;
    }
  }

  function consentValid() {
    var record = readConsent();
    return !!record && record.version === NOTICE_VERSION && record.lawRead === true && !!record.at;
  }

  function clearConsent() {
    try {
      localStorage.removeItem(LS_CONSENT);
      localStorage.removeItem(LS_NOTICE_PROGRESS);
    } catch (err) { /* 忽略存储不可用 */ }
  }

  function protectedTopic(pathname) {
    var match = String(pathname || '').match(/^\/articles\/security\/([^/]+)\/([^/]+)\//);
    return match ? match[2] : '';
  }

  function isProtectedUrl(url) {
    if (!url) return false;
    var pathname = String(url);
    try {
      pathname = new URL(url, location.href).pathname;
    } catch (err) {
      pathname = String(url).split('?')[0].split('#')[0];
    }
    var topic = protectedTopic(pathname);
    return !!topic && topic !== 'law';
  }

  function absolutePath(target) {
    try {
      var parsed = new URL(target, location.href);
      if (parsed.origin !== location.origin) return '';
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (err) {
      return '';
    }
  }

  function noticeUrlFor(target) {
    var ret = absolutePath(target || (location.pathname + location.search + location.hash));
    return siteUrl(NOTICE_PATH) + (ret ? '?return=' + encodeURIComponent(ret) : '');
  }

  function safeReturnPath() {
    var raw = '';
    try {
      raw = new URLSearchParams(location.search).get('return') || '';
    } catch (err) {
      return '';
    }
    if (!raw) return '';
    var path = absolutePath(raw);
    if (!path || path.charAt(0) !== '/') return '';
    if (path.indexOf(NOTICE_PATH) === 0) return '';
    return path;
  }

  function markProtectedLinks() {
    var valid = consentValid();
    qsa('.article-card, .article-row, .route-step, .search-result').forEach(function (host) {
      var link = host.tagName === 'A' ? host : qs('a[href]', host);
      if (!link) return;
      if (!isProtectedUrl(link.getAttribute('href'))) return;
      if (valid) {
        host.classList.remove('is-security-locked');
        host.removeAttribute('data-security-lock');
        return;
      }
      host.classList.add('is-security-locked');
      host.setAttribute('data-security-lock', '1');
      if (!host.getAttribute('title')) host.setAttribute('title', '需先阅读网络安全访问须知');
    });
  }

  function initSecurityGate() {
    if (isProtectedUrl(location.pathname) && !consentValid()) {
      location.replace(noticeUrlFor(location.pathname + location.search + location.hash));
      return;
    }

    markProtectedLinks();

    doc.addEventListener('click', function (e) {
      var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!link) return;
      if (!isProtectedUrl(link.getAttribute('href'))) return;
      if (consentValid()) return;
      e.preventDefault();
      e.stopPropagation();
      location.href = noticeUrlFor(link.href);
    }, true);
  }

  function initNotice() {
    var page = qs('.page-notice');
    if (!page) return;

    var versionEl = qs('[data-notice-version]');
    if (versionEl) versionEl.textContent = NOTICE_VERSION;

    var statusEl = qs('[data-notice-status]');
    var revokeBtn = qs('[data-notice-revoke]');
    var returnHint = qs('[data-notice-return]');
    var step1 = qs('[data-notice-step1-check]');
    var nextBtn = qs('[data-notice-next]');
    var step2 = qs('[data-notice-step2]');
    var step2Check = qs('[data-notice-step2-check]');
    var confirmBtn = qs('[data-notice-confirm]');
    var messageEl = qs('[data-notice-message]');
    var scrollText = qs('[data-read-scroll]');
    var scrollBar = qs('[data-read-scroll-bar]');
    var timeText = qs('[data-read-time]');
    var timeBar = qs('[data-read-time-bar]');

    var seconds = 0;
    var reachedEnd = false;
    var returnPath = safeReturnPath();

    try {
      var stored = JSON.parse(localStorage.getItem(LS_NOTICE_PROGRESS) || 'null');
      if (stored && stored.version === NOTICE_VERSION && stored.ended) reachedEnd = true;
    } catch (err) { /* 忽略 */ }

    function saveProgress() {
      try {
        localStorage.setItem(LS_NOTICE_PROGRESS, JSON.stringify({ version: NOTICE_VERSION, ended: reachedEnd }));
      } catch (err) { /* 忽略 */ }
    }

    function canProceed() {
      return reachedEnd && seconds >= 20;
    }

    function paint() {
      if (scrollText) scrollText.textContent = reachedEnd ? '已完成' : '未完成';
      if (scrollBar) scrollBar.style.width = reachedEnd ? '100%' : '0%';
      if (timeText) timeText.textContent = Math.min(seconds, 20) + ' / 20 秒';
      if (timeBar) timeBar.style.width = Math.min(100, (seconds / 20) * 100) + '%';
      if (step1) step1.disabled = !canProceed();
      if (nextBtn) nextBtn.disabled = !step1 || !step1.checked || !canProceed();
      if (step2Check && confirmBtn) confirmBtn.disabled = !step2Check.checked;
    }

    function paintStatus() {
      var record = readConsent();
      if (consentValid()) {
        var when = '';
        try {
          when = new Date(record.at).toLocaleString('zh-CN', { hour12: false });
        } catch (err) { when = ''; }
        if (statusEl) {
          statusEl.textContent = '已确认（版本 ' + record.version + (when ? '，' + when : '') + '）。可以直接访问安全方向的非法规内容。';
        }
        if (revokeBtn) revokeBtn.hidden = false;
        if (step1) {
          step1.checked = true;
          step1.disabled = true;
        }
        if (nextBtn) nextBtn.disabled = true;
        if (step2) step2.hidden = true;
      } else {
        if (statusEl) {
          statusEl.textContent = record
            ? '本机记录属于旧版本（' + String(record.version || '未知') + '），已失效。请重新完成阅读与两次确认。'
            : '尚未确认。完成下方阅读与两次确认后，才会写入本机记录。';
        }
        if (revokeBtn) revokeBtn.hidden = !record;
        paint();
      }
      if (returnHint) {
        if (returnPath) {
          returnHint.hidden = false;
          returnHint.textContent = '确认通过后会自动回到：' + returnPath;
        } else {
          returnHint.hidden = true;
        }
      }
    }

    function checkScroll() {
      var height = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
      var atEnd = (window.pageYOffset || doc.documentElement.scrollTop || 0) + window.innerHeight >= height - 24;
      if (atEnd && !reachedEnd) {
        reachedEnd = true;
        saveProgress();
        if (messageEl) messageEl.textContent = '已到达页尾，开始计时；停留满 20 秒后可进行第一次确认。';
      }
      paint();
    }

    function tick() {
      if (reachedEnd && doc.visibilityState !== 'hidden' && seconds < 20) {
        seconds += 1;
        paint();
        if (seconds === 20 && messageEl) messageEl.textContent = '阅读条件已满足，可以勾选第一次确认。';
      }
    }

    if (step1) step1.addEventListener('change', paint);
    if (step2Check) step2Check.addEventListener('change', paint);

    if (nextBtn) nextBtn.addEventListener('click', function () {
      if (!step1 || !step1.checked || !canProceed()) return;
      if (step2) {
        step2.hidden = false;
        step2.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
      if (step2Check) step2Check.focus();
      if (messageEl) messageEl.textContent = '第一步已确认，请完成第二次确认。';
    });

    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      if (!step2Check || !step2Check.checked || !canProceed()) return;
      try {
        localStorage.setItem(LS_CONSENT, JSON.stringify({ version: NOTICE_VERSION, at: Date.now(), lawRead: true }));
      } catch (err) { /* 存储不可用时保持未确认 */ }
      if (messageEl) messageEl.textContent = '第二关已通过，确认记录已写入本机。';
      paintStatus();
      if (returnPath) {
        window.setTimeout(function () {
          location.replace(returnPath);
        }, 500);
      }
    });

    if (revokeBtn) revokeBtn.addEventListener('click', function () {
      clearConsent();
      seconds = 0;
      reachedEnd = false;
      if (step1) {
        step1.checked = false;
        step1.disabled = true;
      }
      if (step2) step2.hidden = true;
      if (step2Check) step2Check.checked = false;
      paintStatus();
      paint();
      if (messageEl) messageEl.textContent = '已撤回同意，本机记录已清除。再次访问安全方向的非法规文章会回到本页。';
    });

    window.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden) checkScroll();
    });
    window.setInterval(tick, 1000);

    checkScroll();
    paintStatus();
    paint();

    window.__CZ_SECURITY__ = {
      version: NOTICE_VERSION,
      state: function () {
        return { reachedEnd: reachedEnd, seconds: seconds, canProceed: canProceed(), consent: readConsent(), valid: consentValid() };
      }
    };
  }

  /* ---------------- 搜索页 ---------------- */

  function initSearch() {
    var input = qs('[data-search-input]');
    var results = qs('[data-search-results]');
    var status = qs('[data-search-status]');
    var empty = qs('[data-search-empty]');
    if (!input || !results) return;

    var data = window.CZ_SEARCH_INDEX;
    var articles = data && Array.isArray(data.articles) ? data.articles : null;
    if (!articles && window.console && console.warn) {
      console.warn('[czgrzx-docs] 没有读到搜索索引（/data/search-index.js），搜索页只提示，不报错。');
    }
    var activeIndex = -1;
    var rendered = [];
    var filters = readFilterState();
    var searchBar = qs('[data-search-filters]');
    var filterUi = null;

    var metas = (articles || []).map(function (article) {
      return {
        direction: article.direction || '',
        directionName: article.directionName || directionName(article.direction || ''),
        series: article.series || '',
        seriesName: article.seriesName || article.series || '',
        topic: article.topic || article.group || '',
        topicName: article.topicName || article.groupName || '',
        difficulty: article.difficulty || '',
        tags: article.tags || []
      };
    });

    function activeCount() {
      return activeFilterCount(filters);
    }

    function syncUrl(push) {
      var params = filterParams(filters);
      var q = input.value.trim();
      if (q) params.set('q', q);
      else params.delete('q');
      var search = params.toString();
      var url = location.pathname + (search ? '?' + search : '');
      try {
        if (push) history.pushState(null, '', url);
        else history.replaceState(null, '', url);
      } catch (err) { /* 忽略 */ }
    }

    function termsOf(query) {
      return query.toLowerCase().split(/[\s,，、。；;:：!?！？/]+/).filter(function (t) {
        return t.length > 0;
      }).slice(0, 6);
    }

    function pickSection(article, terms) {
      var best = null;
      var bestScore = 0;
      (article.sections || []).forEach(function (section) {
        var score = 0;
        var title = (section.title || '').toLowerCase();
        var text = (section.text || '').toLowerCase();
        terms.forEach(function (term) {
          if (title.indexOf(term) !== -1) score += 24;
          if (text.indexOf(term) !== -1) score += 7;
        });
        if (score > bestScore) {
          bestScore = score;
          best = section;
        }
      });
      return best;
    }

    function scoreArticle(article, terms) {
      var title = (article.title || '').toLowerCase();
      var summary = (article.summary || '').toLowerCase();
      var tags = (article.tags || []).join(' ').toLowerCase();
      var group = (article.topicName || article.groupName || '').toLowerCase();
      var text = (article.text || '').toLowerCase();
      var score = 0;
      var all = true;

      terms.forEach(function (term) {
        var hit = false;
        if (title.indexOf(term) !== -1) { score += 40; hit = true; }
        if (tags.indexOf(term) !== -1) { score += 18; hit = true; }
        if (summary.indexOf(term) !== -1) { score += 12; hit = true; }
        if (group.indexOf(term) !== -1) { score += 6; hit = true; }
        if (text.indexOf(term) !== -1) { score += 3; hit = true; }
        (article.sections || []).forEach(function (section) {
          if ((section.title || '').toLowerCase().indexOf(term) !== -1) { score += 16; hit = true; }
          else if ((section.text || '').toLowerCase().indexOf(term) !== -1) { score += 3; hit = true; }
        });
        if (!hit) all = false;
      });

      if (!all) return null;
      var section = pickSection(article, terms);
      if (section) score += 8;
      return { score: score, section: section };
    }

    function snippetAround(text, terms) {
      var clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (!clean) return '';
      var at = -1;
      terms.forEach(function (term) {
        var pos = clean.toLowerCase().indexOf(term);
        if (pos !== -1 && (at === -1 || pos < at)) at = pos;
      });
      if (at === -1) return clean.slice(0, 118) + (clean.length > 118 ? '…' : '');
      var start = Math.max(0, at - 36);
      var end = Math.min(clean.length, at + 96);
      return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
    }

    function highlight(text, terms) {
      var html = esc(text);
      terms.forEach(function (term) {
        if (!term) return;
        html = html.replace(new RegExp(escReg(esc(term)), 'gi'), function (match) {
          return '<mark>' + match + '</mark>';
        });
      });
      return html;
    }

    function setActive(index) {
      activeIndex = index;
      rendered.forEach(function (el, i) {
        el.classList.toggle('is-active', i === index);
      });
      if (index >= 0 && rendered[index] && rendered[index].scrollIntoView) {
        rendered[index].scrollIntoView({ block: 'nearest' });
      }
    }

    function render(items, query) {
      var terms = termsOf(query);
      results.innerHTML = '';
      rendered = [];
      activeIndex = -1;
      var filtered = activeCount() > 0;

      if (items.length === 0) {
        if (status) {
          status.textContent = query
            ? '没有找到与“' + query + '”相关的文章。'
            : '当前筛选下没有文章。';
        }
        if (empty) {
          empty.hidden = (query || filtered) ? false : true;
          var reason = qs('[data-search-empty-reason]', empty);
          if (reason) {
            var condition = filterReason(filters, filterUi ? filterUi.labels : null);
            reason.textContent = query && condition
              ? '关键词“' + query + '”加上这些条件后没有结果：' + condition + '。'
              : condition ? '这些条件组合下没有文章：' + condition + '。' : '没有匹配的文章。';
          }
        }
        return;
      }
      if (empty) empty.hidden = true;

      items.slice(0, 30).forEach(function (item) {
        var article = item.article;
        var section = item.section;
        var href = siteUrl(article.url) + (section && section.id ? '#' + section.id : '');
        var snippet;
        if (!terms.length) {
          snippet = esc(article.summary || '');
        } else {
          var snippetSource = section && section.text ? section.text : (article.text || article.summary || '');
          snippet = highlight(snippetAround(snippetSource, terms), terms);
        }
        var card = doc.createElement('a');
        card.className = 'search-result';
        card.href = href;
        card.innerHTML =
          '<div class="result-title">' + esc(article.title) + '</div>' +
          '<div class="result-meta"><span>' + esc(article.directionName || '') + '</span>' +
          '<span>' + esc(article.seriesName || '') + '</span>' +
          '<span>' + esc(article.topicName || article.groupName || '') + '</span>' +
          '<span>' + esc(article.difficulty || '') + '</span>' +
          ((article.tags || []).slice(0, 4).map(function (tag) {
            return '<span class="tag">' + esc(tag) + '</span>';
          }).join('')) +
          '</div>' +
          '<div class="result-snippet">' + snippet + '</div>' +
          (section && section.title ? '<span class="result-section">命中段落：' + esc(section.title) + '</span>' : '');
        results.appendChild(card);
        rendered.push(card);
      });
      markProtectedLinks();

      if (status) {
        status.textContent = query
          ? '找到 ' + items.length + ' 篇，按相关度排序' + (items.length > 30 ? '（只显示前 30 篇）' : '') + '。'
          : '当前筛选下共 ' + items.length + ' 篇' + (items.length > 30 ? '（只显示前 30 篇）' : '') + '。';
      }
    }

    function pool() {
      if (!articles) return [];
      if (!activeCount()) return articles;
      return articles.filter(function (article) { return metaMatches(article, filters); });
    }

    function run(query, push, skipUrl) {
      var q = String(query || '').trim();
      if (!articles) {
        results.innerHTML = '';
        rendered = [];
        activeIndex = -1;
        if (empty) empty.hidden = true;
        if (status) status.textContent = '搜索数据还没有生成，可以先浏览文章列表。';
        return;
      }

      var candidates = pool();
      if (!q && !activeCount()) {
        results.innerHTML = '';
        rendered = [];
        activeIndex = -1;
        if (empty) empty.hidden = true;
        if (status) status.textContent = '输入关键词开始筛选，标题、标签和正文都会参与匹配。';
        if (!skipUrl) syncUrl(false);
        return;
      }

      var items = [];
      if (q) {
        var terms = termsOf(q);
        candidates.forEach(function (article) {
          var scored = scoreArticle(article, terms);
          if (scored) items.push({ article: article, section: scored.section, score: scored.score });
        });
        items.sort(function (a, b) {
          if (b.score !== a.score) return b.score - a.score;
          return a.article.title.localeCompare(b.article.title, 'zh-CN');
        });
      } else {
        candidates.forEach(function (article) {
          items.push({ article: article, section: null, score: 0 });
        });
        items.sort(function (a, b) {
          var orderA = (a.article.directionOrder || 0) * 1000 + (a.article.order || 0);
          var orderB = (b.article.directionOrder || 0) * 1000 + (b.article.order || 0);
          return orderA - orderB;
        });
      }

      render(items, q);
      if (!skipUrl) syncUrl(push === true);
    }

    if (searchBar && metas.length) {
      filterUi = setupFilterBar(searchBar, metas, filters, function (push) {
        syncUrl(push);
        run(input.value, false, true);
      });
    }

    var urlQuery = '';
    try {
      urlQuery = new URLSearchParams(location.search).get('q') || '';
    } catch (err) { /* 忽略 */ }
    if (urlQuery) input.value = urlQuery;

    var timer = 0;
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        run(input.value, false);
      }, 120);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (rendered.length) setActive(Math.min(rendered.length - 1, activeIndex + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (rendered.length) setActive(Math.max(0, activeIndex - 1));
      } else if (e.key === 'Enter') {
        if (rendered.length) {
          e.preventDefault();
          var target = rendered[activeIndex >= 0 ? activeIndex : 0];
          if (target) {
            if (isProtectedUrl(target.href) && !consentValid()) location.href = noticeUrlFor(target.href);
            else location.href = target.href;
          }
        }
      } else if (e.key === 'Escape') {
        if (input.value) {
          input.value = '';
          run('', false);
          if (status) status.textContent = '已清空搜索词。';
        }
      }
    });

    var form = qs('[data-search-form]');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        run(input.value, true);
        input.focus();
      });
    }

    var clearAll = qs('[data-search-clear]');
    if (clearAll) {
      clearAll.addEventListener('click', function () {
        input.value = '';
        FILTER_KEYS.forEach(function (key) { filters[key] = ''; });
        filters.tags = [];
        if (filterUi) filterUi.sync();
        syncUrl(false);
        run('', false, true);
        input.focus();
      });
    }

    window.addEventListener('popstate', function () {
      var next = readFilterState();
      FILTER_KEYS.forEach(function (key) { filters[key] = next[key]; });
      filters.tags = next.tags.slice();
      if (filterUi) filterUi.sync();
      var q = '';
      try {
        q = new URLSearchParams(location.search).get('q') || '';
      } catch (err) { /* 忽略 */ }
      input.value = q;
      run(q, false, true);
    });

    if (urlQuery || activeCount()) run(urlQuery, false, true);
  }

  /* ---------------- 学习页 ---------------- */

  var routeDialogState = { routeId: null };

  function initLearning() {
    var page = qs('.page-learning');
    if (!page) return;

    var store = readStore();

    function save() {
      writeStore(store);
    }

    function labels(state) {
      return { unread: '未读', reading: '在读', read: '已读' }[state] || '未读';
    }

    function stateOf(slug) {
      return (store.articles[slug] && store.articles[slug].state) || 'unread';
    }

    function stepsOf(card) {
      return qsa('.route-step[data-slug]', card);
    }

    function refreshProgress() {
      qsa('.route-card', page).forEach(function (card) {
        var rows = stepsOf(card);
        if (!rows.length) return;
        var read = rows.filter(function (row) {
          return stateOf(row.getAttribute('data-slug')) === 'read';
        }).length;
        var total = rows.length;
        var progressText = qs('[data-route-progress]', card);
        var progressBar = qs('[data-route-bar]', card);
        if (progressText) progressText.textContent = read + ' / ' + total + ' 已读';
        if (progressBar) progressBar.style.width = (total ? (read / total) * 100 : 0) + '%';
      });
      refreshOverall();
    }

    function paintStates() {
      qsa('[data-step-state]', page).forEach(function (btn) {
        if (btn.getAttribute('data-pending-label')) return;
        var slug = btn.getAttribute('data-slug');
        if (!slug) return;
        var st = stateOf(slug);
        btn.setAttribute('data-state', st);
        btn.textContent = labels(st);
        btn.title = st === 'read' ? '点击标为未读' : '点击标为已读';
      });
    }

    function refreshOverall() {
      var map = slugSet();
      var slugs = Object.keys(map);
      var readCount = slugs.filter(function (s) { return stateOf(s) === 'read'; }).length;
      var readingCount = slugs.filter(function (s) { return stateOf(s) === 'reading'; }).length;
      var total = slugs.length;
      var readEl = qs('[data-stat-read]');
      var readingEl = qs('[data-stat-reading]');
      var totalEl = qs('[data-stat-total]');
      var routesEl = qs('[data-stat-routes]');
      var barEl = qs('[data-overall-bar]');
      var textEl = qs('[data-overall-text]');
      if (readEl) readEl.textContent = readCount;
      if (readingEl) readingEl.textContent = readingCount;
      if (totalEl) totalEl.textContent = total;
      if (routesEl) routesEl.textContent = qsa('.route-card[data-route]', page).length;
      var pct = total ? Math.round((readCount / total) * 100) : 0;
      if (barEl) barEl.style.width = pct + '%';
      if (textEl) textEl.textContent = pct + '%';
      renderRecent();
    }

    function relativeTime(ts) {
      if (!ts) return '';
      var diff = Date.now() - ts;
      if (diff < 60 * 1000) return '刚刚';
      if (diff < 60 * 60 * 1000) return Math.round(diff / 60000) + ' 分钟前';
      var d = new Date(ts);
      var today = new Date();
      if (d.toDateString() === today.toDateString()) {
        return '今天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      }
      return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    }

    function renderRecent() {
      var host = qs('[data-recent-list]');
      if (!host) return;
      var map = slugSet();
      var entries = Object.keys(store.articles).map(function (slug) {
        var meta = map[slug];
        if (!meta) return null;
        var item = store.articles[slug];
        if (!item || !item.lastAt) return null;
        return { slug: slug, meta: meta, item: item };
      }).filter(Boolean).sort(function (a, b) {
        return b.item.lastAt - a.item.lastAt;
      }).slice(0, 3);

      if (!entries.length) {
        host.innerHTML = '<p class="recent-empty">还没有阅读记录，随便打开一篇就会出现在这里。</p>';
        return;
      }
      host.innerHTML = '<ul class="recent-list">' + entries.map(function (entry) {
        var href = siteUrl(entry.meta.url) + (entry.item.lastSection ? '#' + entry.item.lastSection : '');
        return '<li><a href="' + esc(href) + '">' + esc(entry.meta.title) + '</a><time>' + esc(relativeTime(entry.item.lastAt)) + '</time></li>';
      }).join('') + '</ul>';
    }

    // 路线折叠：默认收起，可以同时展开多条
    function setRouteOpen(card, open) {
      if (!card) return;
      var body = qs('.route-body', card);
      var toggle = qs('.route-toggle', card);
      var wasOpen = card.classList.contains('is-open');
      if (wasOpen === open) {
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      var oldHeight = card.getBoundingClientRect().height;
      var cardTop = card.getBoundingClientRect().top;
      card.classList.toggle('is-open', open);
      if (body) {
        body.classList.toggle('is-open', open);
        body.setAttribute('aria-hidden', open ? 'false' : 'true');
        if ('inert' in body) body.inert = !open;
        else if (!open) body.setAttribute('inert', '');
        else body.removeAttribute('inert');
      }
      if (toggle) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        var text = qs('.route-toggle-text', toggle);
        if (text) text.textContent = open ? '收起' : '展开文章清单';
      }

      if (!open && cardTop < 0) {
        var settle = function () {
          var delta = oldHeight - card.getBoundingClientRect().height;
          if (delta > 2) window.scrollBy(0, -delta);
        };
        if (body) body.addEventListener('transitionend', function once(e) {
          if (e.propertyName !== 'grid-template-rows') return;
          body.removeEventListener('transitionend', once);
          settle();
        });
        if (reduceMotion.matches) window.requestAnimationFrame(settle);
      }
    }

    function setupRouteCard(card) {
      if (!card || card.getAttribute('data-route-ready')) return;
      card.setAttribute('data-route-ready', '1');
      var head = qs('.route-head', card);
      if (!head) return;
      var progress = qs('.route-progress', head);
      var side = doc.createElement('div');
      side.className = 'route-head-side';
      if (progress) side.appendChild(progress);
      var toggle = doc.createElement('button');
      toggle.className = 'route-toggle';
      toggle.type = 'button';
      toggle.setAttribute('data-toggle-route', '');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span class="route-toggle-text">展开文章清单</span><i aria-hidden="true"></i>';
      side.appendChild(toggle);
      head.appendChild(side);

      var body = doc.createElement('div');
      body.className = 'route-body';
      body.setAttribute('aria-hidden', 'true');
      body.setAttribute('inert', '');
      var inner = doc.createElement('div');
      inner.className = 'route-body-inner';
      var actions = null;
      Array.prototype.slice.call(card.children).forEach(function (child) {
        if (child === head) return;
        if (child.classList.contains('route-actions')) {
          actions = child;
          return;
        }
        inner.appendChild(child);
      });
      body.appendChild(inner);
      if (actions) card.insertBefore(body, actions);
      else card.appendChild(body);
      setRouteOpen(card, false);
    }

    function decorateRouteLinks(card) {
      var routeId = card.getAttribute('data-route') || card.getAttribute('data-custom-id');
      if (!routeId) return;
      qsa('.route-step a[href]', card).forEach(function (link) {
        var raw = link.getAttribute('href') || '';
        if (!raw || raw.charAt(0) === '#') return;
        if (raw.indexOf('?route=') === -1) {
          link.setAttribute('href', raw + (raw.indexOf('?') === -1 ? '?' : '&') + 'route=' + encodeURIComponent(routeId));
        }
        link.setAttribute('data-route-ctx', routeId);
      });
    }

    function setupRouteCards() {
      qsa('.route-card', page).forEach(function (card) {
        setupRouteCard(card);
        decorateRouteLinks(card);
      });
    }

    // 预设路线点击状态
    page.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-route]');
      if (toggle && page.contains(toggle)) {
        e.preventDefault();
        var cardForToggle = toggle.closest('.route-card');
        if (cardForToggle) setRouteOpen(cardForToggle, !cardForToggle.classList.contains('is-open'));
        return;
      }

      var head = e.target.closest('.route-head');
      if (head && page.contains(head) && !e.target.closest('a, button, input, select, textarea')) {
        var cardForHead = head.closest('.route-card');
        if (cardForHead) {
          setRouteOpen(cardForHead, !cardForHead.classList.contains('is-open'));
          return;
        }
      }

      var stateBtn = e.target.closest('[data-step-state]');
      if (stateBtn && page.contains(stateBtn)) {
        e.preventDefault();
        var slug = stateBtn.getAttribute('data-slug');
        if (!slug) return;
        var next = stateOf(slug) === 'read' ? 'unread' : 'read';
        if (store.articles[slug]) {
          store.articles[slug].state = next;
          store.articles[slug].lastAt = Date.now();
        } else {
          store.articles[slug] = { state: next, lastSection: '', lastAt: Date.now() };
        }
        save();
        paintStates();
        refreshProgress();
        return;
      }

      var reset = e.target.closest('[data-reset]');
      if (reset) {
        e.preventDefault();
        openDialog('reset');
      }
    });

    // 自定义路线
    function findRoute(id) {
      return store.routes.filter(function (r) { return r.id === id; })[0] || null;
    }

    function routeHtml(route) {
      var map = slugSet();
      var steps = route.steps || [];
      var minutes = 0;
      var stepRows = steps.map(function (slug, i) {
        var meta = map[slug];
        if (meta && meta.minutes) minutes += meta.minutes;
        return '<li class="route-step" data-slug="' + esc(slug) + '">' +
          '<span class="step-no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<div class="step-main">' +
          '<a href="' + esc(meta ? siteUrl(meta.url) + '?route=' + encodeURIComponent(route.id) : '#') + '"' + (meta ? ' data-route-ctx="' + esc(route.id) + '"' : '') + '>' + esc(meta ? meta.title : slug) + '</a>' +
          '<span class="step-meta">' + esc(meta ? (meta.difficulty + (meta.minutes ? ' · 约 ' + meta.minutes + ' 分钟' : '')) : '文章待更新') + '</span>' +
          '</div>' +
          '<button class="step-state" type="button" data-step-state data-slug="' + esc(slug) + '">未读</button>' +
          '<button class="delete-step" type="button" data-remove-step aria-label="从这条路线移除">×</button>' +
          '</li>';
      }).join('');

      return '<article class="route-card" data-custom-id="' + esc(route.id) + '">' +
        '<header class="route-head"><div><span class="route-no">我的路线</span><h3>' + esc(route.name) + '</h3></div>' +
        '<div class="route-progress"><span data-route-progress>0 / ' + steps.length + ' 已读</span><i class="bar"><b data-route-bar></b></i></div></header>' +
        '<p class="route-desc">' + (steps.length ? steps.length + ' 篇文章' + (minutes ? ' · 预计 ' + minutes + ' 分钟' : '') : '还没有安排文章') + '</p>' +
        (steps.length ? '<ol class="route-steps">' + stepRows + '</ol>' : '<p class="empty-state">这条路线还是空的，点下面的“添加文章”挑几篇。</p>') +
        '<div class="route-actions">' +
        '<button class="btn" type="button" data-add-article>添加文章</button>' +
        '<button class="btn btn-ghost" type="button" data-rename-route>改名</button>' +
        '<button class="btn btn-danger" type="button" data-delete-route>删除路线</button>' +
        '</div></article>';
    }

    function renderCustom() {
      var host = qs('[data-custom-routes]');
      if (!host) return;
      var empty = qs('[data-custom-empty]');
      if (!store.routes.length) {
        host.innerHTML = '';
        if (empty) empty.hidden = false;
      } else {
        host.innerHTML = store.routes.map(routeHtml).join('');
        if (empty) empty.hidden = true;
      }
      applyAvailability();
      paintStates();
      refreshProgress();
      setupRouteCards();
    }

    page.addEventListener('click', function (e) {
      var card = e.target.closest('[data-custom-id]');
      if (!card) return;
      var id = card.getAttribute('data-custom-id');
      var route = findRoute(id);
      if (!route) return;

      if (e.target.closest('[data-add-article]')) {
        e.preventDefault();
        routeDialogState.routeId = id;
        var addDialog = qs('[data-dialog="add"]');
        if (addDialog) {
          var searchInput = qs('[data-add-search]', addDialog);
          if (searchInput) searchInput.value = '';
          renderAddList('');
          addDialog.showModal();
        }
        return;
      }
      if (e.target.closest('[data-rename-route]')) {
        e.preventDefault();
        routeDialogState.routeId = id;
        var renameDialog = qs('[data-dialog="rename"]');
        if (renameDialog) {
          var input = qs('[data-rename-input]', renameDialog);
          if (input) input.value = route.name;
          renameDialog.showModal();
        }
        return;
      }
      if (e.target.closest('[data-delete-route]')) {
        e.preventDefault();
        routeDialogState.routeId = id;
        var delText = qs('[data-delete-name]');
        if (delText) delText.textContent = route.name;
        openDialog('delete-route');
        return;
      }
      var remove = e.target.closest('[data-remove-step]');
      if (remove) {
        e.preventDefault();
        var step = remove.closest('.route-step');
        var slug = step && step.getAttribute('data-slug');
        if (slug) {
          route.steps = route.steps.filter(function (s) { return s !== slug; });
          save();
          renderCustom();
          toast('已从路线里移除');
        }
      }
    });

    function openDialog(name) {
      var dialog = qs('[data-dialog="' + name + '"]');
      if (!dialog) return;
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', 'open');
    }

    function closeDialog(name) {
      var dialog = qs('[data-dialog="' + name + '"]');
      if (!dialog) return;
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
    }

    // 新建路线
    var createForm = qs('[data-route-create]');
    if (createForm) {
      createForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = qs('input[name="name"]', createForm);
        var name = input ? input.value.trim() : '';
        if (!name) {
          if (input) input.focus();
          return;
        }
        store.routes.push({
          id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: name,
          steps: []
        });
        save();
        if (input) input.value = '';
        renderCustom();
        toast('路线已创建，接着往里添加文章。');
      });
    }

    // 弹窗逻辑
    var renameDialog = qs('[data-dialog="rename"]');
    if (renameDialog) {
      renameDialog.addEventListener('close', function () {
        if (renameDialog.returnValue !== 'ok') return;
        var route = findRoute(routeDialogState.routeId);
        var input = qs('[data-rename-input]', renameDialog);
        var name = input ? input.value.trim() : '';
        if (!route) return;
        if (!name) {
          toast('名字不能为空。');
          return;
        }
        route.name = name;
        save();
        renderCustom();
        toast('已改名');
      });
    }

    var deleteDialog = qs('[data-dialog="delete-route"]');
    if (deleteDialog) {
      deleteDialog.addEventListener('close', function () {
        if (deleteDialog.returnValue !== 'ok') return;
        store.routes = store.routes.filter(function (r) { return r.id !== routeDialogState.routeId; });
        save();
        renderCustom();
        toast('路线已删除');
      });
    }

    var resetDialog = qs('[data-dialog="reset"]');
    if (resetDialog) {
      resetDialog.addEventListener('close', function () {
        if (resetDialog.returnValue !== 'ok') return;
        store = emptyStore();
        save();
        renderCustom();
        paintStates();
        refreshProgress();
        renderRecent();
        toast('学习记录已重置');
      });
    }

    // 添加文章弹窗
    function renderAddList(filter) {
      var list = qs('[data-add-list]');
      var route = findRoute(routeDialogState.routeId);
      if (!list || !route) return;
      var map = slugSet();
      var keyword = String(filter || '').trim().toLowerCase();
      var candidates = Object.keys(map).map(function (slug) {
        return map[slug];
      }).filter(function (meta) {
        if (route.steps.indexOf(meta.slug) !== -1) return false;
        if (!keyword) return true;
        return (meta.title + ' ' + (meta.tags || []).join(' ') + ' ' + (meta.groupName || '')).toLowerCase().indexOf(keyword) !== -1;
      });

      if (!candidates.length) {
        list.innerHTML = '<p class="add-empty">' +
          (Object.keys(map).length ? '没有可添加的文章了。' : '还没有已产出的文章，等文章写好后就能添加。') +
          '</p>';
        return;
      }

      list.innerHTML = candidates.map(function (meta) {
        return '<button class="add-item" type="button" data-add-slug="' + esc(meta.slug) + '">' +
          '<span>' + esc(meta.title) + '</span>' +
          '<span class="add-meta">' + esc(meta.groupName || '') + ' · ' + esc(meta.difficulty || '') + '</span>' +
          '</button>';
      }).join('');
    }

    var addSearch = qs('[data-add-search]');
    if (addSearch) {
      addSearch.addEventListener('input', function () {
        renderAddList(addSearch.value);
      });
    }

    var addList = qs('[data-add-list]');
    if (addList) {
      addList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-add-slug]');
        if (!btn) return;
        var route = findRoute(routeDialogState.routeId);
        if (!route) return;
        var slug = btn.getAttribute('data-add-slug');
        if (route.steps.indexOf(slug) === -1) route.steps.push(slug);
        save();
        closeDialog('add');
        renderCustom();
        toast('已加入路线');
      });
    }

    // 初始渲染
    renderCustom();
    paintStates();
    refreshProgress();
    renderRecent();

    var wantedRoute = '';
    try {
      wantedRoute = new URLSearchParams(location.search).get('route') || '';
    } catch (err) { /* 忽略 */ }
    if (wantedRoute) {
      var targetCard = null;
      qsa('.route-card', page).forEach(function (card) {
        var id = card.getAttribute('data-route') || card.getAttribute('data-custom-id');
        if (id === wantedRoute) targetCard = card;
      });
      if (targetCard) {
        setRouteOpen(targetCard, true);
        window.setTimeout(function () {
          targetCard.scrollIntoView({ block: 'start', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
        }, 60);
      }
    }
  }

  /* ---------------- 启动 ---------------- */

  function safeInit(name, fn) {
    try {
      fn();
    } catch (err) {
      if (window.console && console.warn) {
        console.warn('[czgrzx-docs] ' + name + ' 初始化失败，已跳过，不影响其它模块：', err);
      }
    }
  }

  /* ---------------- 系列概览紧凑索引 ---------------- */

  function initSeriesIndex() {
    var wrap = qs('[data-series-index]');
    var detail = qs('.series-overview-detail');
    if (!wrap || !detail) return;
    var base = detail.getAttribute('data-default') || detail.textContent;
    function show(chip) {
      var text = chip.getAttribute('data-series-detail');
      if (text) detail.textContent = text;
    }
    function reset() {
      detail.textContent = base;
    }
    wrap.addEventListener('mouseover', function (e) {
      var chip = e.target.closest('[data-series-chip]');
      if (chip) show(chip);
    });
    wrap.addEventListener('mouseleave', reset);
    wrap.addEventListener('focusin', function (e) {
      var chip = e.target.closest('[data-series-chip]');
      if (chip) show(chip);
    });
    wrap.addEventListener('focusout', function (e) {
      if (!wrap.contains(e.relatedTarget)) reset();
    });
  }

  safeInit('明暗主题', initTheme);
  safeInit('安全方向闸门', initSecurityGate);
  safeInit('访问须知页', initNotice);
  safeInit('文章可用性', applyAvailability);
  safeInit('页面过渡', initTransitions);
  safeInit('系列概览索引', initSeriesIndex);
  safeInit('文章页', initArticle);
  safeInit('文章列表筛选', initArticleFilters);
  safeInit('搜索页', initSearch);
  safeInit('学习页', initLearning);
})();
