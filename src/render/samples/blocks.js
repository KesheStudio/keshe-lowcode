/* 渲染核心 · 样例业务区块
   这些渲染器不属于引擎本身，只演示“组件通过注册表接入”。
   正式项目可以按同样签名替换或新增自己的区块。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../index.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.SampleBlocks = factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  var h = R.h;
  var raw = R.raw;

  function previewHref(ctx, href) {
    return ctx.preview ? '#' : href;
  }

  function heading(block) {
    var level = Math.max(1, Math.min(6, Number(block.level) || 2));
    return h('h' + level, { class: 'demo-heading' }, [
      block.text || '',
      block.sub ? h('span', { class: 'demo-heading-sub' }, block.sub) : null
    ]);
  }

  function paragraph(block, ctx) {
    var md = block.md != null ? block.md : (block.text || '');
    return h('p', { class: 'demo-p' }, raw(ctx.markdownInline(md)));
  }

  function markdown(block, ctx) {
    return h('div', { class: 'demo-md' }, raw(ctx.markdown(block.md || '')));
  }

  function cards(block) {
    var cols = Math.max(1, Math.min(4, Number(block.columns) || 2));
    var items = block.cards || [];
    return h('div', { class: 'demo-cards', style: { '--demo-cols': cols } }, items.map(function (card) {
      return h('div', { class: 'demo-card' }, [
        card.tag ? h('span', { class: 'demo-card-tag' }, card.tag) : null,
        h('p', { class: 'demo-card-title' }, card.title || ''),
        h('p', { class: 'demo-card-body' }, card.body || '')
      ]);
    }));
  }

  function note(block, ctx) {
    var tone = block.tone === 'warn' || block.tone === 'ok' ? block.tone : 'info';
    return h('div', { class: 'demo-note demo-note-' + tone }, [
      block.title ? h('p', { class: 'demo-note-title' }, block.title) : null,
      h('div', { class: 'demo-note-body' }, raw(ctx.markdown(block.md || '')))
    ]);
  }

  function buttons(block) {
    var items = block.buttons || (block.button ? [block.button] : []);
    return h('div', { class: 'demo-actions' }, items.map(function (item) {
      return h('button', {
        type: 'button',
        class: 'demo-btn' + (item.primary ? ' demo-btn-primary' : '')
      }, item.label || '按钮');
    }));
  }

  function divider() {
    return h('hr', { class: 'demo-divider' });
  }

  function html(block) {
    return h('div', { class: 'demo-html' }, raw(block.html || ''));
  }

  function articleList(block, ctx) {
    var all = (ctx.site && ctx.site.articles) || [];
    var limit = Number(block.limit) > 0 ? Number(block.limit) : all.length;
    var articles = all.slice(0, limit);
    return h('div', { class: 'demo-article-list' }, [
      block.title ? h('p', { class: 'demo-list-title' }, block.title) : null,
      h('div', { class: 'demo-article-grid' }, articles.map(function (article) {
        return h('a', {
          class: 'demo-article',
          href: previewHref(ctx, article.path || '#')
        }, [
          h('span', { class: 'demo-article-meta' }, (article.direction || '') + ' · ' + (article.topic || '')),
          h('span', { class: 'demo-article-title' }, article.title || ''),
          h('span', { class: 'demo-article-summary' }, article.summary || '')
        ]);
      }))
    ]);
  }

  function siteNav(block, ctx) {
    var items = block.items || [];
    var activePath = ctx.activePath;
    var pageId = ctx.page && ctx.page.id;
    return h('nav', { class: 'demo-nav', 'aria-label': '样例导航' }, [
      h('span', { class: 'demo-nav-brand' }, block.brand || '站点'),
      h('div', { class: 'demo-nav-links' }, items.map(function (item) {
        var active = (item.pageId && item.pageId === pageId) ||
          (item.href && ctx.activePath && item.href === ctx.activePath);
        var attrs = {
          class: 'demo-nav-link' + (active ? ' is-active' : ''),
          href: previewHref(ctx, item.href || '#')
        };
        if (active) attrs['aria-current'] = 'page';
        return h('a', attrs, item.label || '');
      }))
    ]);
  }

  function siteFooter(block) {
    return h('p', { class: 'demo-footer-text' }, block.text || '');
  }

  /* 实例覆盖的数据演示：重置、另存为组件、合并产物。只输出数据，不做编辑器 UI。 */
  function overrideDemo(block, ctx) {
    var components = (ctx.site && ctx.site.components) || [];
    var component = null;
    components.forEach(function (item) {
      if (!component && item && item.id === block.componentId) component = item;
    });
    var instance = block.instance && typeof block.instance === 'object' ? block.instance : {};
    var merged = R.mergeInstanceOverrides(component || {}, instance.overrides);
    var panels = [
      { title: '重置为组件默认', data: R.resetInstanceOverrides(instance) },
      { title: '另存为新组件 · ' + (block.savedId || 'component-custom'), data: R.saveAsComponent(component || {}, instance.overrides, {
        id: block.savedId,
        name: block.savedName
      }) },
      { title: '实例合并结果（可直接压缩）', data: {
        template: merged.template,
        css: merged.css,
        overrideCss: merged.overrideCss,
        js: merged.js,
        overrideJs: merged.overrideJs,
        merge: merged.merge
      } }
    ];
    return h('div', { class: 'demo-override-demo' }, [
      h('p', { class: 'demo-override-title' }, '实例覆盖 · 重置与另存的数据演示'),
      h('div', { class: 'demo-override-grid' }, panels.map(function (panel) {
        return h('section', { class: 'demo-override-panel' }, [
          h('p', { class: 'demo-override-panel-title' }, panel.title),
          h('pre', { class: 'demo-override-json' }, JSON.stringify(panel.data, null, 2))
        ]);
      }))
    ]);
  }

  function registerSampleBlocks(registry) {
    registry.registerBlock('heading', { render: heading });
    registry.registerBlock('paragraph', { render: paragraph });
    registry.registerBlock('markdown', { render: markdown });
    registry.registerBlock('cards', { render: cards });
    registry.registerBlock('note', { render: note });
    registry.registerBlock('buttons', { render: buttons });
    registry.registerBlock('divider', { render: divider });
    registry.registerBlock('html', { render: html });
    registry.registerBlock('articleList', { render: articleList });
    registry.registerBlock('siteNav', { render: siteNav });
    registry.registerBlock('siteFooter', { render: siteFooter });
    registry.registerBlock('overrideDemo', { render: overrideDemo });
    return registry;
  }

  return {
    registerSampleBlocks: registerSampleBlocks,
    renderers: {
      heading: heading,
      paragraph: paragraph,
      markdown: markdown,
      cards: cards,
      note: note,
      buttons: buttons,
      divider: divider,
      html: html,
      articleList: articleList,
      siteNav: siteNav,
      siteFooter: siteFooter
    }
  };
}));
