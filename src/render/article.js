/* 渲染核心 · 文章页增强
   区块渲染完成后补充页面级能力：章节 id、右侧目录、上一篇/下一篇。
   只处理已经渲染出来的节点树，不读文章文件、不访问网络。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var ns = {};
    ['./dom.js', './errors.js', './markdown.js'].forEach(function (path) {
      var mod = require(path);
      Object.keys(mod).forEach(function (key) { ns[key] = mod[key]; });
    });
    module.exports = factory(ns);
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var HEADING_RE = /<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi;

  function decodeEntities(value) {
    return String(value == null ? '' : value)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }

  function plainText(html) {
    return decodeEntities(String(html == null ? '' : html).replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nodeText(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (node.text != null) return String(node.text);
    if (node.raw != null) return plainText(node.raw);
    return (node.children || []).map(nodeText).join('');
  }

  function warnDuplicate(state, id) {
    if (!state.report || !R.CODES) return;
    state.report.warn(R.CODES.DUPLICATE_HEADING_ID, '章节 id 重复：' + id + '，已生成新的 id。', {
      path: state.path || 'article.headings'
    });
  }

  /* h2 → section-N；h3 → section-<h2>-sub-N。已有且不重复的 id 保留。 */
  function registerHeading(state, level, text, existing) {
    var id = existing ? state.prefix + String(existing).trim() : '';
    if (id && state.ids[id]) {
      warnDuplicate(state, id);
      id = '';
    }
    if (!id) {
      if (level === 'h2') {
        state.h2 += 1;
        state.h3 = 0;
        id = state.prefix + 'section-' + state.h2;
      } else {
        state.h3 += 1;
        id = state.prefix + 'section-' + (state.h2 || 1) + '-sub-' + state.h3;
      }
      while (state.ids[id]) id += '-2';
    }
    state.ids[id] = true;
    state.headings.push({ id: id, level: level === 'h3' ? 3 : 2, text: text || id });
    return id;
  }

  function processRawHtml(html, state) {
    return String(html).replace(HEADING_RE, function (whole, tag, attrs, inner) {
      var level = tag.toLowerCase();
      var idMatch = attrs.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      var existing = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3] || '') : '';
      var cleanAttrs = idMatch ? attrs.replace(idMatch[0], '') : attrs;
      var id = registerHeading(state, level, plainText(inner), existing);
      return '<' + level + cleanAttrs + ' id="' + R.escapeAttr(id) + '">' + inner + '</' + level + '>';
    });
  }

  function walk(node, state) {
    if (!node || typeof node !== 'object') return;
    if (node.raw != null) {
      node.raw = processRawHtml(node.raw, state);
      return;
    }
    if (node.tag) {
      var level = String(node.tag).toLowerCase();
      if (level === 'h2' || level === 'h3') {
        var id = registerHeading(state, level, nodeText(node), node.attrs && node.attrs.id);
        node.attrs = node.attrs || {};
        node.attrs.id = id;
      }
      (node.children || []).forEach(function (child) { walk(child, state); });
    }
  }

  function buildToc(headings, article) {
    var items = [];
    var lastH2 = null;

    headings.forEach(function (item) {
      var link = R.h('a', { class: 'lc-toc-link', href: '#' + item.id }, item.text);
      if (item.level === 3 && lastH2) {
        if (!lastH2.sub) {
          lastH2.sub = R.h('ul', { class: 'lc-toc-sublist' }, []);
          lastH2.li.children.push(lastH2.sub);
        }
        lastH2.sub.children.push(R.h('li', { class: 'lc-toc-item lc-toc-sub' }, [link]));
        return;
      }
      var li = R.h('li', { class: 'lc-toc-item' }, [link]);
      items.push(li);
      lastH2 = item.level === 2 ? { li: li, sub: null } : null;
    });

    var title = article.tocTitle || '本文目录';
    return R.h('aside', { class: 'lc-article-aside' }, [
      R.h('nav', { class: 'lc-article-toc', 'aria-label': title }, [
        R.h('p', { class: 'lc-article-toc-title' }, title),
        R.h('ul', { class: 'lc-article-toc-list' }, items)
      ])
    ]);
  }

  function articleList(site) {
    return Array.isArray(site && site.articles) ? site.articles : [];
  }

  function neighbors(article, page, site) {
    var list = articleList(site);
    var articleId = article.id || page.articleId || page.id;
    var index = -1;
    list.forEach(function (item, i) {
      if (index < 0 && item && item.id === articleId) index = i;
    });

    var prev = article.prev;
    if (prev === undefined && index > 0) prev = list[index - 1];
    if (prev === false) prev = null;

    var next = article.next;
    if (next === undefined && index >= 0 && index < list.length - 1) next = list[index + 1];
    if (next === false) next = null;

    return { prev: prev, next: next };
  }

  function navLink(kind, label, item, preview) {
    var href = item && item.path ? String(item.path) : '#';
    if (preview) href = '#';
    var safe = R.safeUrl ? R.safeUrl(href) : href;
    if (!safe) safe = '#';
    return R.h('a', { class: 'lc-article-nav-link lc-article-nav-' + kind, href: safe }, [
      R.h('span', { class: 'lc-article-nav-label' }, label),
      R.h('span', { class: 'lc-article-nav-title' }, (item && (item.title || item.id)) || '未命名')
    ]);
  }

  function buildNav(prev, next, preview) {
    if (!prev && !next) return null;
    var children = [];
    if (prev) children.push(navLink('prev', '上一篇', prev, preview));
    if (next) children.push(navLink('next', '下一篇', next, preview));
    return R.h('nav', { class: 'lc-article-nav', 'aria-label': '上下篇导航' }, children);
  }

  /* 返回 { nodes, headings, tocNode, navNode }。
     article 支持 true 或 { toc, tocTitle, id, prev, next, autoNav }。 */
  function enhanceArticle(nodes, options) {
    var opts = options || {};
    var article = opts.article === true || !opts.article ? {} : opts.article;
    var state = {
      h2: 0,
      h3: 0,
      ids: {},
      headings: [],
      prefix: String(opts.idPrefix || ''),
      report: opts.report || null,
      path: opts.path || 'article'
    };

    var list = Array.isArray(nodes) ? nodes : (nodes == null ? [] : [nodes]);
    list.forEach(function (node) { walk(node, state); });

    var tocNode = article.toc === false || !state.headings.length
      ? null
      : buildToc(state.headings, article);
    var nav = article.autoNav === false && !article.prev && !article.next
      ? { prev: null, next: null }
      : neighbors(article, opts.page || {}, opts.site || {});

    return {
      nodes: list,
      headings: state.headings,
      tocNode: tocNode,
      navNode: buildNav(nav.prev, nav.next, !!opts.preview)
    };
  }

  R.enhanceArticle = enhanceArticle;

  return R;
}));
