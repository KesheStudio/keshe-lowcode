/* 渲染核心 · 站点外壳组件
   导航 / 页脚 / 侧栏 / 面包屑 / 页面标题区。
   只消费区块字段与渲染上下文：当前页高亮按 pageId、href 匹配，外链自动新窗口打开。
   移动端菜单用纯 CSS 复选框展开，静态导出后不需要额外运行时脚本。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../dom.js'), require('./common.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.Components = root.LC.Render.Components || {};
    factory(root.LC.Render, root.LC.Render.ComponentsCommon);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R, kit) {
  'use strict';

  var h = R.h;

  function text(value, fallback) {
    return value == null || value === '' ? (fallback == null ? '' : String(fallback)) : String(value);
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeItem(item, index) {
    if (typeof item === 'string') return { label: item, href: '' };
    if (!item || typeof item !== 'object') return { label: '第 ' + (index + 1) + ' 项', href: '' };
    return item;
  }

  function itemsOf(value) {
    return listOf(value).map(normalizeItem).filter(function (item) {
      return text(item.label, '') !== '';
    });
  }

  function childrenOf(item) {
    return itemsOf(item && item.children);
  }

  function normalizePath(value) {
    return text(value, '')
      .replace(/^\.?\//, '')
      .replace(/[?#].*$/, '')
      .replace(/\/index\.html?$/i, '/');
  }

  function isExternal(item) {
    if (!item) return false;
    if (typeof item.external === 'boolean') return item.external;
    var href = text(item.href, '').trim();
    return /^https?:\/\//i.test(href) || /^\/\//.test(href);
  }

  function safeHref(item, ctx) {
    var raw = text(item && item.href, '') || '#';
    var safe = ctx && typeof ctx.safeUrl === 'function' ? ctx.safeUrl(raw) : raw;
    if (!safe) return '#';
    /* 预览环境下内部链接不跳走，避免离开样例页；外链仍按真实地址打开。 */
    if (ctx && ctx.preview && !isExternal(item)) return '#';
    return safe;
  }

  function pageMatches(item, ctx) {
    if (!item) return false;
    if (item.active === true) return true;
    var page = ctx && ctx.page;
    if (page && item.pageId && item.pageId === page.id) return true;
    var targets = Array.isArray(item.match) ? item.match : [];
    if (page && targets.indexOf(page.id) !== -1) return true;
    if (item.href && ctx) {
      var href = normalizePath(item.href);
      var current = normalizePath(ctx.activePath || (page && page.path) || '');
      if (href && current && href === current) return true;
    }
    return false;
  }

  function branchMatches(item, ctx) {
    if (pageMatches(item, ctx)) return true;
    return childrenOf(item).some(function (child) { return branchMatches(child, ctx); });
  }

  function linkAttrs(item, ctx, active) {
    var attrs = {
      class: 'lc-shell-link' + (active ? ' is-active' : '') + (isExternal(item) ? ' is-external' : ''),
      href: safeHref(item, ctx)
    };
    if (active) attrs['aria-current'] = 'page';
    if (isExternal(item)) {
      attrs.target = '_blank';
      attrs.rel = 'noopener noreferrer';
    }
    if (item.description) attrs.title = text(item.description);
    return attrs;
  }

  function linkNode(item, ctx, className) {
    var active = pageMatches(item, ctx);
    var attrs = linkAttrs(item, ctx, active);
    if (className) attrs.class += ' ' + className;
    var children = [text(item.label, '')];
    if (item.badge != null && item.badge !== '') {
      children.push(h('span', { class: 'lc-shell-badge' }, text(item.badge)));
    }
    if (isExternal(item)) {
      children.push(h('span', { class: 'lc-ui-sr-only' }, '（新窗口打开）'));
    }
    return h('a', attrs, children);
  }

  function branchLabel(item, ctx) {
    var active = branchMatches(item, ctx);
    var attrs = {
      class: 'lc-shell-link is-parent' + (active ? ' is-branch-active' : ''),
      href: safeHref(item, ctx)
    };
    if (active) attrs['data-branch-active'] = 'true';
    if (isExternal(item)) {
      attrs.target = '_blank';
      attrs.rel = 'noopener noreferrer';
    }
    return h('a', attrs, [text(item.label, ''), h('span', { class: 'lc-shell-caret', 'aria-hidden': 'true' })]);
  }

  function navList(items, ctx, level) {
    var current = level || 1;
    return h('ul', { class: 'lc-shell-list lc-shell-level-' + current }, items.map(function (item) {
      var kids = childrenOf(item);
      if (current < 4 && kids.length) {
        return h('li', { class: 'lc-shell-item has-children' }, [
          branchLabel(item, ctx),
          navList(kids, ctx, current + 1)
        ]);
      }
      return h('li', { class: 'lc-shell-item' }, [linkNode(item, ctx)]);
    }));
  }

  function ctaNode(cta, ctx) {
    if (!cta || typeof cta !== 'object' || !cta.label) return null;
    var attrs = linkAttrs(cta, ctx, false);
    attrs.class += ' lc-shell-cta';
    var children = [text(cta.label)];
    if (isExternal(cta)) children.push(h('span', { class: 'lc-ui-sr-only' }, '（新窗口打开）'));
    return h('a', attrs, children);
  }

  /* ---------- 导航 ---------- */

  var NAV_SCHEMA = {
    type: 'ui-site-nav',
    name: '站点导航',
    version: 1,
    description: '品牌、多级菜单、当前页高亮、外链新窗口、移动端展开。',
    states: ['ready', 'empty'],
    props: {
      brand: { type: 'string', label: '品牌名', default: '站点' },
      brandHref: { type: 'string', label: '品牌链接', default: 'index.html' },
      items: {
        type: 'array',
        label: '导航项',
        default: [],
        items: {
          type: 'object',
          props: {
            label: { type: 'string', label: '文字', required: true },
            href: { type: 'string', label: '链接' },
            pageId: { type: 'string', label: '目标页面 ID' },
            external: { type: 'boolean', label: '外链' },
            description: { type: 'string', label: '提示文字' },
            badge: { type: 'string', label: '角标' },
            children: { type: 'array', label: '子菜单' }
          }
        }
      },
      cta: {
        type: 'object',
        label: '右侧行动按钮',
        props: {
          label: { type: 'string', label: '文字' },
          href: { type: 'string', label: '链接' },
          external: { type: 'boolean', label: '外链' }
        }
      },
      sticky: { type: 'boolean', label: '吸顶', default: false },
      label: { type: 'string', label: '导航区域名称', default: '站点导航' },
      mobileLabel: { type: 'string', label: '移动端菜单名称', default: '展开导航' }
    }
  };

  function renderNav(block, ctx) {
    var items = itemsOf(kit.prop(block, 'items', []));
    var brand = text(kit.prop(block, 'brand', ''), (ctx.project && ctx.project.name) || '站点');
    var brandHref = text(kit.prop(block, 'brandHref', ''), 'index.html');
    var sticky = kit.bool(kit.prop(block, 'sticky', false), false);
    var label = text(kit.prop(block, 'label', ''), '站点导航');
    var mobileLabel = text(kit.prop(block, 'mobileLabel', ''), '展开导航');
    var checkId = kit.uid('lc-nav-toggle');
    var cta = kit.prop(block, 'cta', null);

    return h('header', {
      class: 'lc-ui lc-shell-nav' + (sticky ? ' is-sticky' : ''),
      'data-lc-ui': 'ui-site-nav',
      'data-lc-state': items.length ? 'ready' : 'empty'
    }, [
      h('div', { class: 'lc-shell-nav-bar' }, [
        h('a', { class: 'lc-shell-brand', href: ctx && ctx.preview ? '#' : safeHref({ href: brandHref }, ctx) },
          ctx && ctx.pageHasH1 === false
            ? [h('h1', { class: 'lc-shell-brand-title' }, brand)]
            : brand),
        h('input', {
          type: 'checkbox',
          class: 'lc-shell-nav-check',
          id: checkId,
          'aria-label': mobileLabel
        }),
        h('label', { class: 'lc-shell-nav-burger', for: checkId }, [
          h('span', { class: 'lc-shell-burger-lines', 'aria-hidden': 'true' }, [
            h('span'), h('span'), h('span')
          ]),
          h('span', { class: 'lc-ui-sr-only' }, mobileLabel)
        ]),
        h('nav', { class: 'lc-shell-nav-panel', 'aria-label': label }, [
          items.length ? navList(items, ctx, 1) : h('p', { class: 'lc-shell-empty' }, '尚未配置导航项。'),
          ctaNode(cta, ctx)
        ])
      ])
    ]);
  }

  /* ---------- 页脚 ---------- */

  var FOOTER_SCHEMA = {
    type: 'ui-site-footer',
    name: '站点页脚',
    version: 1,
    description: '品牌说明、多列链接、版权与备案信息。',
    states: ['ready', 'empty'],
    props: {
      brand: { type: 'string', label: '品牌名', default: '' },
      description: { type: 'string', label: '品牌说明', default: '' },
      columns: {
        type: 'array',
        label: '链接列',
        default: [],
        items: {
          type: 'object',
          props: {
            title: { type: 'string', label: '列标题' },
            links: {
              type: 'array',
              label: '链接',
              items: {
                type: 'object',
                props: {
                  label: { type: 'string', label: '文字' },
                  href: { type: 'string', label: '链接' },
                  pageId: { type: 'string', label: '目标页面 ID' },
                  external: { type: 'boolean', label: '外链' }
                }
              }
            }
          }
        }
      },
      copyright: { type: 'string', label: '版权信息', default: '' },
      note: { type: 'string', label: '补充说明', default: '' },
      legal: { type: 'array', label: '底部链接', default: [] }
    }
  };

  function footerColumn(column, ctx) {
    if (!column || typeof column !== 'object') return null;
    var links = itemsOf(column.links);
    return h('section', { class: 'lc-shell-footer-col' }, [
      column.title ? h('h2', { class: 'lc-shell-footer-title' }, text(column.title)) : null,
      links.length ? h('ul', { class: 'lc-shell-footer-links' }, links.map(function (item) {
        return h('li', null, [linkNode(item, ctx)]);
      })) : null
    ]);
  }

  function renderFooter(block, ctx) {
    var columns = listOf(kit.prop(block, 'columns', []));
    var legal = itemsOf(kit.prop(block, 'legal', []));
    var brand = text(kit.prop(block, 'brand', ''), (ctx.project && ctx.project.name) || '');
    return h('footer', {
      class: 'lc-ui lc-shell-footer',
      'data-lc-ui': 'ui-site-footer',
      'data-lc-state': columns.length || brand ? 'ready' : 'empty'
    }, [
      h('div', { class: 'lc-shell-footer-inner' }, [
        h('div', { class: 'lc-shell-footer-main' }, [
          h('div', { class: 'lc-shell-footer-brand' }, [
            brand ? h('p', { class: 'lc-shell-footer-brand-name' }, brand) : null,
            kit.prop(block, 'description', '') ? h('p', { class: 'lc-shell-footer-desc' }, text(kit.prop(block, 'description', ''))) : null
          ]),
          h('div', { class: 'lc-shell-footer-cols' }, columns.map(function (column) {
            return footerColumn(column, ctx);
          }))
        ]),
        h('div', { class: 'lc-shell-footer-bottom' }, [
          h('p', { class: 'lc-shell-footer-copy' }, text(kit.prop(block, 'copyright', ''), '© ' + new Date().getFullYear() + ' ' + brand)),
          legal.length ? h('ul', { class: 'lc-shell-footer-legal' }, legal.map(function (item) {
            return h('li', null, [linkNode(item, ctx)]);
          })) : null,
          kit.prop(block, 'note', '') ? h('p', { class: 'lc-shell-footer-note' }, text(kit.prop(block, 'note', ''))) : null
        ])
      ])
    ]);
  }

  /* ---------- 侧栏 ---------- */

  var SIDEBAR_SCHEMA = {
    type: 'ui-sidebar',
    name: '侧栏目录',
    version: 1,
    description: '目录树、当前页高亮、吸顶与补充说明。',
    states: ['ready', 'empty'],
    props: {
      title: { type: 'string', label: '标题', default: '目录' },
      description: { type: 'string', label: '说明', default: '' },
      items: { type: 'array', label: '目录项', default: [] },
      sticky: { type: 'boolean', label: '吸顶', default: true },
      footnote: { type: 'string', label: '底部说明', default: '' },
      label: { type: 'string', label: '区域名称', default: '侧栏目录' }
    }
  };

  function renderSidebar(block, ctx) {
    var items = itemsOf(kit.prop(block, 'items', []));
    var sticky = kit.bool(kit.prop(block, 'sticky', true), true);
    var title = text(kit.prop(block, 'title', ''), '目录');
    return h('aside', {
      class: 'lc-ui lc-shell-sidebar' + (sticky ? ' is-sticky' : ''),
      'data-lc-ui': 'ui-sidebar',
      'data-lc-state': items.length ? 'ready' : 'empty'
    }, [
      h('div', { class: 'lc-shell-sidebar-head' }, [
        h('p', { class: 'lc-shell-sidebar-title' }, title),
        kit.prop(block, 'description', '') ? h('p', { class: 'lc-shell-sidebar-desc' }, text(kit.prop(block, 'description', ''))) : null
      ]),
      items.length
        ? h('nav', { class: 'lc-shell-sidebar-nav', 'aria-label': text(kit.prop(block, 'label', ''), '侧栏目录') }, [navList(items, ctx, 1)])
        : h('p', { class: 'lc-shell-empty' }, '尚未配置目录项。'),
      kit.prop(block, 'footnote', '') ? h('p', { class: 'lc-shell-sidebar-foot' }, text(kit.prop(block, 'footnote', ''))) : null
    ]);
  }

  /* ---------- 面包屑 ---------- */

  var BREADCRUMB_SCHEMA = {
    type: 'ui-breadcrumb',
    name: '面包屑',
    version: 1,
    description: '显式路径或按当前页面自动生成，末项标记为当前页。',
    states: ['ready', 'empty'],
    props: {
      items: { type: 'array', label: '路径项', default: [] },
      auto: { type: 'boolean', label: '自动生成', default: true },
      homeLabel: { type: 'string', label: '首页文字', default: '首页' },
      homeHref: { type: 'string', label: '首页链接', default: 'index.html' },
      label: { type: 'string', label: '区域名称', default: '面包屑' }
    }
  };

  function autoBreadcrumb(block, ctx) {
    var items = [];
    var homeLabel = text(kit.prop(block, 'homeLabel', ''), '首页');
    if (homeLabel) items.push({ label: homeLabel, href: text(kit.prop(block, 'homeHref', ''), 'index.html') });
    var page = (ctx && ctx.page) || {};
    var nav = page.nav || {};
    listOf(nav.trail).forEach(function (trail) {
      if (!trail) return;
      items.push(typeof trail === 'string' ? { label: trail } : trail);
    });
    var currentLabel = text(nav.label, '') || text(page.title, '') || text(page.id, '');
    if (currentLabel) items.push({ label: currentLabel, href: page.path || '' });
    return items;
  }

  function renderBreadcrumb(block, ctx) {
    var explicit = itemsOf(kit.prop(block, 'items', []));
    var auto = kit.bool(kit.prop(block, 'auto', true), true);
    var items = explicit.length ? explicit : (auto ? autoBreadcrumb(block, ctx) : []);
    var last = items.length - 1;
    return h('nav', {
      class: 'lc-ui lc-shell-breadcrumb',
      'data-lc-ui': 'ui-breadcrumb',
      'data-lc-state': items.length ? 'ready' : 'empty',
      'aria-label': text(kit.prop(block, 'label', ''), '面包屑')
    }, [
      items.length ? h('ol', { class: 'lc-shell-breadcrumb-list' }, items.map(function (item, index) {
        var current = index === last;
        var label = text(item.label, '');
        var content = current
          ? h('span', { class: 'lc-shell-breadcrumb-current', 'aria-current': 'page' }, label)
          : (item.href ? linkNode(item, ctx, 'lc-shell-breadcrumb-link') : h('span', { class: 'lc-shell-breadcrumb-current' }, label));
        return h('li', { class: 'lc-shell-breadcrumb-item' }, [content]);
      })) : h('p', { class: 'lc-shell-empty' }, '暂无路径信息。')
    ]);
  }

  /* ---------- 页面标题区 ---------- */

  var PAGE_HEADER_SCHEMA = {
    type: 'ui-page-header',
    name: '页面标题区',
    version: 1,
    description: '眉题、主标题、副标题、元信息与操作按钮。',
    states: ['ready', 'empty'],
    props: {
      eyebrow: { type: 'string', label: '眉题', default: '' },
      title: { type: 'string', label: '主标题', default: '' },
      subtitle: { type: 'string', label: '副标题', default: '' },
      meta: { type: 'array', label: '元信息', default: [] },
      actions: {
        type: 'array',
        label: '操作按钮',
        default: [],
        items: {
          type: 'object',
          props: {
            label: { type: 'string', label: '文字' },
            href: { type: 'string', label: '链接' },
            external: { type: 'boolean', label: '外链' },
            variant: { type: 'enum', label: '样式', options: ['primary', 'ghost'], default: 'ghost' }
          }
        }
      },
      align: { type: 'enum', label: '对齐', options: ['left', 'center'], default: 'left' }
    }
  };

  function metaNode(meta) {
    if (typeof meta === 'string' || typeof meta === 'number') return text(meta);
    if (!meta || typeof meta !== 'object') return '';
    if (meta.label != null && meta.value != null) return text(meta.label) + '：' + text(meta.value);
    return text(meta.label, '') || text(meta.value, '');
  }

  function renderPageHeader(block, ctx) {
    var title = text(kit.prop(block, 'title', ''), (ctx.page && ctx.page.title) || '');
    var eyebrow = text(kit.prop(block, 'eyebrow', ''));
    var subtitle = text(kit.prop(block, 'subtitle', ''));
    var meta = listOf(kit.prop(block, 'meta', [])).map(metaNode).filter(function (item) { return item !== ''; });
    var actions = listOf(kit.prop(block, 'actions', [])).filter(function (item) {
      return item && typeof item === 'object' && item.label;
    });
    var align = kit.prop(block, 'align', 'left') === 'center' ? 'center' : 'left';
    return h('header', {
      class: 'lc-ui lc-shell-page-header is-align-' + align,
      'data-lc-ui': 'ui-page-header',
      'data-lc-state': title ? 'ready' : 'empty'
    }, [
      eyebrow ? h('p', { class: 'lc-shell-page-eyebrow' }, eyebrow) : null,
      h('div', { class: 'lc-shell-page-heading' }, [
        h('h1', { class: 'lc-shell-page-title' }, title || '未命名页面'),
        actions.length ? h('div', { class: 'lc-shell-page-actions' }, actions.map(function (item) {
          var attrs = linkAttrs(item, ctx, false);
          attrs.class += ' lc-shell-page-action' + (item.variant === 'primary' ? ' is-primary' : '');
          var children = [text(item.label)];
          if (isExternal(item)) children.push(h('span', { class: 'lc-ui-sr-only' }, '（新窗口打开）'));
          return h('a', attrs, children);
        })) : null
      ]),
      subtitle ? h('p', { class: 'lc-shell-page-subtitle' }, subtitle) : null,
      meta.length ? h('ul', { class: 'lc-shell-page-meta' }, meta.map(function (item) {
        return h('li', null, item);
      })) : null
    ]);
  }

  /* ---------- 样式 ---------- */

  var SHELL_CSS = [
    '/* lc-ui-shell */',
    '.lc-shell-nav { position: relative; z-index: 20; background: var(--lc-color-surface); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line); }',
    '.lc-shell-nav.is-sticky { position: sticky; top: 0; }',
    '.lc-shell-nav-bar { display: flex; align-items: center; gap: var(--lc-space-4); width: 100%; max-width: var(--lc-shell-max, 1200px); margin: 0 auto; padding: var(--lc-space-2-5) var(--lc-space-5); position: relative; }',
    '.lc-shell-brand { flex: none; font-family: var(--lc-font-serif, Georgia, serif); font-size: var(--lc-text-lg, 18px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink); text-decoration: none; letter-spacing: 0.02em; }',
    '.lc-shell-brand-title { margin: 0; font: inherit; line-height: inherit; letter-spacing: inherit; }',
    '.lc-shell-nav-panel { display: flex; align-items: center; gap: var(--lc-space-4); flex: 1; min-width: 0; }',
    '.lc-shell-list { display: flex; align-items: center; gap: var(--lc-space-4); margin: 0; padding: 0; list-style: none; }',
    '.lc-shell-item { position: relative; }',
    '.lc-shell-link { display: inline-flex; align-items: center; gap: var(--lc-space-1-5); padding: var(--lc-space-1-5) 2px; color: var(--lc-color-muted); font-size: var(--lc-text-sm, 13px); text-decoration: none; border-bottom: 2px solid transparent; }',
    '.lc-shell-link:hover, .lc-shell-link:focus-visible { color: var(--lc-color-accent); }',
    '.lc-shell-link.is-active, .lc-shell-link.is-branch-active { color: var(--lc-color-ink); border-bottom-color: var(--lc-color-accent); }',
    '.lc-shell-caret { width: 0; height: 0; border-left: 3px solid transparent; border-right: 3px solid transparent; border-top: 4px solid currentColor; opacity: 0.6; }',
    '.lc-shell-level-2, .lc-shell-level-3, .lc-shell-level-4 { display: none; }',
    '.lc-shell-item:hover > .lc-shell-list, .lc-shell-item:focus-within > .lc-shell-list { display: flex; }',
    '.lc-shell-level-2, .lc-shell-level-3, .lc-shell-level-4 { position: absolute; top: 100%; left: 0; z-index: 30; min-width: 190px; flex-direction: column; align-items: stretch; gap: 2px; padding: var(--lc-space-2); border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); box-shadow: var(--lc-shadow-md); }',
    '.lc-shell-level-3, .lc-shell-level-4 { top: 0; left: 100%; }',
    '.lc-shell-level-2 .lc-shell-link, .lc-shell-level-3 .lc-shell-link, .lc-shell-level-4 .lc-shell-link { width: 100%; padding: 7px var(--lc-space-2-5); border-bottom: 0; border-radius: var(--lc-radius-sm, 4px); }',
    '.lc-shell-level-2 .lc-shell-link:hover, .lc-shell-level-3 .lc-shell-link:hover, .lc-shell-level-4 .lc-shell-link:hover { background: var(--lc-color-surface-2); }',
    '.lc-shell-cta { margin-left: auto; padding: 7px var(--lc-space-3-5); border: var(--lc-border-width, 1px) solid var(--lc-color-accent-fill); border-radius: var(--lc-radius-full); background: var(--lc-color-accent-fill); color: var(--lc-color-on-accent); font-size: var(--lc-text-sm, 13px); text-decoration: none; white-space: nowrap; }',
    '.lc-shell-cta:hover { opacity: 0.86; background: var(--lc-color-accent-fill-hover); color: var(--lc-color-on-accent); }',
    '.lc-shell-badge { padding: 1px var(--lc-space-1-5); border-radius: var(--lc-radius-full); background: var(--lc-color-accent-soft); color: var(--lc-color-accent); font-size: var(--lc-text-xs, 11px); }',
    '.lc-shell-nav-check { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
    '.lc-shell-nav-burger { display: none; margin-left: auto; width: 38px; height: 34px; align-items: center; justify-content: center; border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-sm, 4px); background: var(--lc-color-surface-2); color: var(--lc-color-ink); cursor: pointer; }',
    '.lc-shell-nav-check:focus-visible + .lc-shell-nav-burger { outline: 2px solid var(--lc-color-accent); outline-offset: 2px; }',
    '.lc-shell-burger-lines { display: inline-flex; flex-direction: column; gap: var(--lc-space-1); }',
    '.lc-shell-burger-lines > span { display: block; width: 16px; height: 2px; background: currentColor; }',
    '.lc-shell-empty { margin: 0; padding: var(--lc-space-2) 0; color: var(--lc-color-muted-2); font-size: var(--lc-text-sm, 13px); }',
    '.lc-shell-footer { background: var(--lc-color-surface-2); border-top: var(--lc-border-width, 1px) solid var(--lc-color-line); color: var(--lc-color-muted); font-size: var(--lc-text-sm, 13px); }',
    '.lc-shell-footer-inner { width: 100%; max-width: var(--lc-shell-max, 1200px); margin: 0 auto; padding: 28px var(--lc-space-5) 18px; }',
    '.lc-shell-footer-main { display: flex; justify-content: space-between; gap: var(--lc-space-6); flex-wrap: wrap; }',
    '.lc-shell-footer-brand { min-width: 180px; max-width: 320px; }',
    '.lc-shell-footer-brand-name { margin: 0 0 var(--lc-space-1-5); font-family: var(--lc-font-serif, Georgia, serif); font-size: var(--lc-text-md, 15px); color: var(--lc-color-ink); }',
    '.lc-shell-footer-desc { margin: 0; line-height: var(--lc-leading-base, 1.6); }',
    '.lc-shell-footer-cols { display: flex; gap: var(--lc-space-7); flex-wrap: wrap; }',
    '.lc-shell-footer-title { margin: 0 0 var(--lc-space-2); font-size: var(--lc-text-xs, 12px); letter-spacing: 0.08em; color: var(--lc-color-muted-2); }',
    '.lc-shell-footer-links, .lc-shell-footer-legal { display: flex; flex-direction: column; gap: var(--lc-space-1); margin: 0; padding: 0; list-style: none; }',
    '.lc-shell-footer .lc-shell-link { padding: 2px 0; border-bottom: 0; }',
    '.lc-shell-footer-bottom { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-4); flex-wrap: wrap; margin-top: 22px; padding-top: var(--lc-space-3); border-top: var(--lc-border-width, 1px) solid var(--lc-color-line); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted-2); }',
    '.lc-shell-footer-copy, .lc-shell-footer-note { margin: 0; }',
    '.lc-shell-footer-legal { flex-direction: row; gap: var(--lc-space-3); }',
    '.lc-shell-sidebar { border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); padding: var(--lc-space-3-5) var(--lc-space-4); }',
    '.lc-shell-sidebar.is-sticky { position: sticky; top: var(--lc-article-toc-top, 88px); align-self: start; max-height: calc(100vh - 110px); overflow: auto; }',
    '.lc-shell-sidebar-head { margin-bottom: var(--lc-space-2-5); padding-bottom: var(--lc-space-2); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line); }',
    '.lc-shell-sidebar-title { margin: 0; font-size: var(--lc-text-sm, 13px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink); }',
    '.lc-shell-sidebar-desc { margin: var(--lc-space-1) 0 0; color: var(--lc-color-muted-2); font-size: var(--lc-text-xs, 12px); }',
    '.lc-shell-sidebar-nav .lc-shell-list { flex-direction: column; align-items: stretch; gap: 2px; }',
    '.lc-shell-sidebar-nav .lc-shell-link { width: 100%; padding: var(--lc-space-1-5) var(--lc-space-2); border-bottom: 0; border-left: 2px solid transparent; border-radius: 0 var(--lc-radius-sm, 4px) var(--lc-radius-sm, 4px) 0; }',
    '.lc-shell-sidebar-nav .lc-shell-link.is-active, .lc-shell-sidebar-nav .lc-shell-link.is-branch-active { background: var(--lc-color-accent-soft); border-left-color: var(--lc-color-accent); }',
    '.lc-shell-sidebar-nav .lc-shell-level-2, .lc-shell-sidebar-nav .lc-shell-level-3, .lc-shell-sidebar-nav .lc-shell-level-4 { position: static; display: flex; min-width: 0; padding: 2px 0 2px var(--lc-space-3); border: 0; box-shadow: none; background: transparent; }',
    '.lc-shell-sidebar-foot { margin: var(--lc-space-2-5) 0 0; padding-top: var(--lc-space-2); border-top: var(--lc-border-width, 1px) dashed var(--lc-color-line); color: var(--lc-color-muted-2); font-size: var(--lc-text-xs, 12px); }',
    '.lc-shell-breadcrumb { font-size: var(--lc-text-sm, 13px); }',
    '.lc-shell-breadcrumb-list { display: flex; align-items: center; flex-wrap: wrap; gap: var(--lc-space-1-5); margin: 0; padding: 0; list-style: none; }',
    '.lc-shell-breadcrumb-item + .lc-shell-breadcrumb-item::before { content: var(--lc-breadcrumb-sep, "/"); margin-right: var(--lc-space-1-5); color: var(--lc-color-decor, #888); }',
    '.lc-shell-breadcrumb-link { padding: 0; border-bottom: 0; }',
    '.lc-shell-breadcrumb-current { color: var(--lc-color-ink-2); }',
    '.lc-shell-page-header { padding: var(--lc-space-1) 0 2px; }',
    '.lc-shell-page-header.is-align-center { text-align: center; }',
    '.lc-shell-page-eyebrow { margin: 0 0 var(--lc-space-1-5); font-size: var(--lc-text-xs, 12px); letter-spacing: 0.1em; color: var(--lc-color-accent); }',
    '.lc-shell-page-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-4); flex-wrap: wrap; }',
    '.is-align-center .lc-shell-page-heading { justify-content: center; }',
    '.lc-shell-page-title { margin: 0; font-family: var(--lc-font-serif, Georgia, serif); font-size: var(--lc-text-3xl, 34px); line-height: 1.15; color: var(--lc-color-ink); }',
    '.lc-shell-page-actions { display: flex; align-items: center; gap: var(--lc-space-2); flex-wrap: wrap; }',
    '.lc-shell-page-action { padding: var(--lc-space-2) var(--lc-space-3-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-md); text-decoration: none; }',
    '.lc-shell-page-action.is-primary { border-color: var(--lc-color-accent-fill); background: var(--lc-color-accent-fill); color: var(--lc-color-on-accent); }',
    '.lc-shell-page-subtitle { margin: var(--lc-space-2-5) 0 0; max-width: 68ch; color: var(--lc-color-muted); font-size: var(--lc-text-md, 15px); }',
    '.is-align-center .lc-shell-page-subtitle { margin-left: auto; margin-right: auto; }',
    '.lc-shell-page-meta { display: flex; flex-wrap: wrap; gap: var(--lc-space-3); margin: var(--lc-space-2-5) 0 0; padding: 0; list-style: none; color: var(--lc-color-muted-2); font-size: var(--lc-text-xs, 12px); }',
    '.is-align-center .lc-shell-page-meta { justify-content: center; }',
    '@media (max-width: 900px) {',
    '  .lc-shell-nav-burger { display: inline-flex; }',
    '  .lc-shell-nav-panel { display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column; align-items: stretch; gap: var(--lc-space-2); padding: var(--lc-space-3) var(--lc-space-5) var(--lc-space-4); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line); background: var(--lc-color-surface); box-shadow: var(--lc-shadow-md); }',
    '  .lc-shell-nav-check:checked ~ .lc-shell-nav-panel { display: flex; }',
    '  .lc-shell-nav .lc-shell-list, .lc-shell-nav .lc-shell-item { width: 100%; }',
    '  .lc-shell-nav .lc-shell-list { flex-direction: column; align-items: stretch; gap: 2px; }',
    '  .lc-shell-nav .lc-shell-link { width: 100%; padding: 9px var(--lc-space-1); border-bottom: 1px solid var(--lc-color-line); border-radius: 0; }',
    '  .lc-shell-nav .lc-shell-level-2, .lc-shell-nav .lc-shell-level-3, .lc-shell-nav .lc-shell-level-4 { position: static; display: flex; min-width: 0; padding: 2px 0 2px var(--lc-space-3-5); border: 0; box-shadow: none; background: transparent; }',
    '  .lc-shell-caret { display: none; }',
    '  .lc-shell-cta { margin-left: 0; text-align: center; }',
    '  .lc-shell-footer-main { flex-direction: column; }',
    '}',
    '@media (prefers-reduced-motion: reduce) { .lc-shell-cta, .lc-shell-page-action { transition: none; } }'
  ].join('\n');

  function makeDef(type, name, schema, render) {
    /* 统一状态：显式 loading/error 时交给公共基座出占位，其余状态照常渲染。 */
    function guarded(block, ctx) {
      var state = kit.stateOf(block, true);
      if (state === 'loading' || state === 'error') {
        return h('div', {
          class: 'lc-ui',
          'data-lc-ui': type,
          'data-lc-state': state
        }, [kit.renderStatus(state, {
          title: kit.prop(block, state === 'error' ? 'errorTitle' : 'loadingTitle', null),
          text: kit.prop(block, state === 'error' ? 'errorText' : 'loadingText', null)
        })]);
      }
      return render(block, ctx);
    }
    return {
      type: type,
      name: name,
      version: 1,
      schema: schema,
      sharedCss: kit.css,
      sharedCssId: 'lc-ui-common',
      cssId: 'lc-shell',
      css: SHELL_CSS,
      render: guarded,
      helpers: {
        isExternal: isExternal,
        pageMatches: pageMatches,
        normalizePath: normalizePath
      }
    };
  }

  var defs = {
    'ui-site-nav': makeDef('ui-site-nav', '站点导航', NAV_SCHEMA, renderNav),
    'ui-site-footer': makeDef('ui-site-footer', '站点页脚', FOOTER_SCHEMA, renderFooter),
    'ui-sidebar': makeDef('ui-sidebar', '侧栏目录', SIDEBAR_SCHEMA, renderSidebar),
    'ui-breadcrumb': makeDef('ui-breadcrumb', '面包屑', BREADCRUMB_SCHEMA, renderBreadcrumb),
    'ui-page-header': makeDef('ui-page-header', '页面标题区', PAGE_HEADER_SCHEMA, renderPageHeader)
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = defs;
  } else {
    var components = R.Components;
    Object.keys(defs).forEach(function (type) { components[type] = defs[type]; });
  }

  return defs;
}));
