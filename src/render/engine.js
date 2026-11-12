/* 渲染核心 · 页面与区块编排
   输入站点数据（project + pages + components + themes），输出节点树。
   不读存储、不发请求；单块失败只跳过该块并记录，不影响其余区块。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var ns = {};
    ['./dom.js', './errors.js', './markdown.js', './scope.js', './theme.js',
     './registry.js', './free.js', './shell.js', './article.js', './overrides.js',
     './builtins.js', './page-size.js'].forEach(function (path) {
      var mod = require(path);
      Object.keys(mod).forEach(function (key) { ns[key] = mod[key]; });
    });
    module.exports = factory(ns);
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  var BUILTIN_ACTIONS = { link: 1, toggle: 1, scrollTo: 1 };

  /* 页面内容里已有 h1 时，外壳品牌不再重复承担 h1 语义。 */
  function pageHasH1(blocks) {
    var found = false;
    (Array.isArray(blocks) ? blocks : []).forEach(function (block) {
      if (found || !block || typeof block !== 'object') return;
      if ((block.type === 'heading' || block.type === 'ui-heading') && Number(block.level || 2) === 1) {
        found = true;
        return;
      }
      if (pageHasH1(block.blocks)) found = true;
      if (pageHasH1(block.children)) found = true;
    });
    return found;
  }

  /* 结构样式只消费 CSS 变量：优先设计系统令牌（--lc-*），旧变量作为兜底，
     渲染层不读主题文件、也不写死具体色值。 */
  var BASE_CSS = [
    'html, body { background: var(--lc-color-bg, #f4f0e6); color: var(--lc-color-ink, #1d2320); }',
    ':where(.lc-page) {',
    '  color: var(--lc-color-ink, #1d2320);',
    '  background: var(--lc-color-bg, #f4f0e6);',
    '  font-family: var(--lc-font-sans);',
    '  line-height: var(--lc-leading-base);',
    '  font-size: var(--lc-text-md);',
    '}',
    '.lc-page *, .lc-page *::before, .lc-page *::after { box-sizing: border-box; }',
    '.lc-page a { color: var(--lc-color-accent); }',
    '.lc-shell { padding: var(--lc-shell-pad, var(--lc-space-3-5) var(--lc-space-5)); }',
    '.lc-shell-header { border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line); }',
    '.lc-shell-footer { border-top: var(--lc-border-width, 1px) solid var(--lc-color-line); color: var(--lc-color-muted); font-size: var(--lc-text-sm); }',
    '.lc-main { max-width: var(--lc-page-max, 1080px); margin: 0 auto; padding: var(--lc-main-pad, 28px var(--lc-space-5) 48px); }',
    '.lc-main-center .lc-blocks { width: 100%; max-width: var(--lc-main-max, 560px); margin: 0 auto; }',
    '.lc-shell-layout { display: grid; grid-template-columns: var(--lc-sidebar-w, 240px) minmax(0, 1fr); gap: var(--lc-shell-gap, var(--lc-space-6)); width: 100%; max-width: var(--lc-shell-max, 1200px); margin: 0 auto; padding: 0 var(--lc-space-5); align-items: start; }',
    '.lc-shell-layout > .lc-main { width: 100%; max-width: none; margin: 0; padding: var(--lc-main-pad, 28px 0 48px); }',
    '.lc-blocks { min-width: 0; }',
    /* 双端独立 UI：同一页面里放两棵区块树，按视口宽度只显示对应那一端。
       默认态就先做互斥，媒体查询只负责 ≤900px 翻到移动端：
       这样 900~901 之间的分数视口（缩放/嵌入 WebView）也不会两端同时出现。 */
    '.lc-ui-ends { display: block; }',
    '.lc-ui-end[data-lc-ui-end="mobile"] { display: none; }',
    '.lc-ui-end[data-lc-ui-end="desktop"] { display: block; }',
    '@media (max-width: 900px) {',
    '  .lc-ui-end[data-lc-ui-end="desktop"] { display: none; }',
    '  .lc-ui-end[data-lc-ui-end="mobile"] { display: block; }',
    '}',
    '.lc-flow { display: flex; flex-direction: column; gap: var(--lc-gap, var(--lc-space-5, 1.25rem)); }',
    '.lc-free { position: relative; }',
    '.lc-block { min-width: 0; }',
    '.lc-block[data-lc-defer="true"] { content-visibility: auto; contain-intrinsic-size: 320px; contain-intrinsic-size: auto 320px; }',
    /* 深链接直接命中区块时立即渲染，避免跳到估算位置后再跳动。 */
    '.lc-block[data-lc-defer="true"]:target { content-visibility: visible; }',
    '@media print { .lc-block[data-lc-defer="true"] { content-visibility: visible; } }',
    '.lc-block[data-lc-positioned="abs"] { position: absolute; }',
    '.lc-container { min-width: 0; }',
    '.lc-container-card { border: var(--lc-border-width, 1px) solid var(--lc-color-line); background: var(--lc-color-surface); border-radius: var(--lc-radius-md); padding: var(--lc-container-pad, var(--lc-space-4)); }',
    '.lc-container-title { margin: 0 0 var(--lc-space-2-5); padding-bottom: var(--lc-space-2); border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line); font-size: var(--lc-text-sm); font-weight: var(--lc-weight-semibold, 600); letter-spacing: 0.04em; color: var(--lc-color-muted); }',
    '.lc-container-columns .lc-container-inner { display: grid; grid-template-columns: repeat(var(--lc-cols, 2), minmax(0, 1fr)); gap: var(--lc-gap, var(--lc-space-5, 1.25rem)); }',
    '.lc-container-accordion { border: var(--lc-border-width, 1px) solid var(--lc-color-line); background: var(--lc-color-surface); border-radius: var(--lc-radius-md); padding: var(--lc-space-1) var(--lc-container-pad, var(--lc-space-4)); }',
    '.lc-container-accordion > summary { cursor: pointer; padding: 9px 0; font-weight: var(--lc-weight-semibold, 600); }',
    '.lc-container-free { position: relative; }',
    '.lc-container-free > .lc-container-inner { position: relative; }',
    '.lc-component { min-width: 0; }',
    '.lc-block-error { padding: var(--lc-space-3) var(--lc-space-3-5); border: var(--lc-border-width, 1px) dashed var(--lc-color-accent-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface-2); color: var(--lc-color-muted); font-size: var(--lc-text-sm); }',
    '.lc-page h2[id], .lc-page h3[id] { scroll-margin-top: var(--lc-anchor-offset, 80px); }',
    '.lc-article-layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: var(--lc-article-gap, var(--lc-space-6)); align-items: start; }',
    '.lc-article-layout-single { grid-template-columns: minmax(0, 1fr); }',
    '.lc-article-body { min-width: 0; }',
    '.lc-article-aside { position: sticky; top: var(--lc-article-toc-top, 88px); align-self: start; max-height: calc(100vh - 120px); overflow: auto; }',
    '.lc-article-toc { padding-left: var(--lc-space-4); border-left: var(--lc-border-width, 1px) solid var(--lc-color-line); font-size: var(--lc-text-sm); }',
    '.lc-article-toc-title { margin: 0 0 var(--lc-space-2); font-weight: var(--lc-weight-semibold, 600); letter-spacing: 0.04em; color: var(--lc-color-muted); }',
    '.lc-article-toc-list, .lc-toc-sublist { margin: 0; padding: 0; list-style: none; }',
    '.lc-article-toc-list { display: flex; flex-direction: column; gap: 2px; }',
    '.lc-toc-item { margin: 0; }',
    '.lc-toc-link { display: block; padding: var(--lc-space-1) 0; color: var(--lc-color-muted); text-decoration: none; }',
    '.lc-toc-link:hover { color: var(--lc-color-accent); }',
    '.lc-toc-sublist { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 var(--lc-space-1-5); padding-left: var(--lc-space-3); }',
    '.lc-toc-sub .lc-toc-link { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted-2); }',
    '.lc-article-nav { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--lc-space-3); margin-top: var(--lc-space-7); padding-top: var(--lc-space-4); border-top: var(--lc-border-width, 1px) solid var(--lc-color-line); }',
    '.lc-article-nav-link { display: flex; flex-direction: column; gap: 2px; padding: var(--lc-space-2-5) var(--lc-space-3-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); text-decoration: none; }',
    '.lc-article-nav-link:hover { border-color: var(--lc-color-accent-line); }',
    '.lc-article-nav-next { grid-column: 2; text-align: right; }',
    '.lc-article-nav-label { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted); }',
    '.lc-article-nav-title { font-size: var(--lc-text-md, 14px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink); }',
    '@media (max-width: 900px) {',
    '  .lc-article-layout { grid-template-columns: minmax(0, 1fr); }',
    '  .lc-article-aside { position: static; max-height: none; order: -1; }',
    '}',
    '@media (max-width: 720px) {',
    '  .lc-container-columns .lc-container-inner { grid-template-columns: 1fr; }',
    '}',
    '@media (max-width: 900px) {',
    '  .lc-shell-layout { grid-template-columns: minmax(0, 1fr); padding: 0 var(--lc-space-4); }',
    '  .lc-shell-layout > .lc-main { padding: var(--lc-space-4) 0 36px; }',
    '}'
  ].join('\n');

  function copyStyle(existing, extra) {
    var base = existing == null ? '' : String(existing);
    var tail = Object.keys(extra || {}).map(function (key) {
      return key + ':' + extra[key] + ';';
    }).join('');
    return base + tail;
  }

  function cssAttrValue(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function normalizePath(value) {
    return String(value == null ? '' : value).replace(/^\.?\//, '').replace(/[?#].*$/, '');
  }

  function scriptSelector(blockId) {
    return '[data-lc-instance="' + cssAttrValue(blockId) + '"]';
  }

  function scriptSource(blockId, componentId, source) {
    return '(function () {\n' +
      '  "use strict";\n' +
      '  var root = document.querySelector(' + JSON.stringify(scriptSelector(blockId)) + ');\n' +
      '  if (!root) return;\n' +
      '  try {\n' + String(source || '') + '\n' +
      '  } catch (e) {\n' +
      '    if (typeof console !== "undefined") console.error(' +
      JSON.stringify('[lc] 组件 ' + componentId + ' 脚本出错') + ', e);\n' +
      '  }\n' +
      '})();';
  }

  function pageScriptSource(pageId, source) {
    return '(function () {\n' +
      '  "use strict";\n' +
      '  var page = document.querySelector(' + JSON.stringify('[data-lc-page="' + cssAttrValue(pageId) + '"]') + ');\n' +
      '  if (!page) return;\n' +
      '  try {\n' + String(source || '') + '\n' +
      '  } catch (e) {\n' +
      '    if (typeof console !== "undefined") console.error(' +
      JSON.stringify('[lc] 页面 ' + pageId + ' 脚本出错') + ', e);\n' +
      '  }\n' +
      '})();';
  }

  function scriptsHtml(scripts, nonce) {
    var attr = nonce ? ' nonce="' + R.escapeAttr(nonce) + '"' : '';
    return (scripts || []).map(function (item) {
      var wrapped;
      if (item.global) {
        wrapped = '(function () {\n' +
          '  "use strict";\n' +
          '  try {\n' + String(item.source || '') + '\n' +
          '  } catch (e) {\n' +
          '    if (typeof console !== "undefined") console.error("[lc] 全局脚本出错", e);\n' +
          '  }\n' +
          '})();';
      } else {
        wrapped = item.pageId
          ? pageScriptSource(item.pageId, item.source)
          : scriptSource(item.blockId, item.componentId, item.source);
      }
      return '<script' + attr + '>' + wrapped.replace(/<\/script/gi, '<\\/script') + '</script>';
    }).join('\n');
  }

  function createRenderer(site, options) {
    var opts = options || {};
    var data = site || {};
    var registry = opts.registry || R.createRegistry();

    (data.components || []).forEach(function (component) {
      if (!registry.hasComponent(component && component.id)) registry.registerComponent(component);
    });

    var project = data.project || {};
    var themes = data.themes || (project.theme && project.theme.themes) || [];
    var defaultThemeId = (project.theme && project.theme.defaultThemeId) || (themes[0] && themes[0].id) || '';
    var defaultMode = (project.theme && project.theme.mode) || 'auto';

    /* 渲染层不做系统偏好判断：只认 light/dark，其余一律按未解析的 auto 处理。 */
    function normalizeMode(value) {
      return value === 'light' || value === 'dark' ? value : 'auto';
    }

    function listPages() {
      return Array.isArray(data.pages) ? data.pages : [];
    }

    function findPage(ref) {
      if (ref && typeof ref === 'object' && (ref.blocks || ref.layout)) return ref;
      var pages = listPages();
      if (typeof ref === 'number') return pages[ref] || null;
      var text = String(ref == null ? '' : ref);
      var path = normalizePath(text);
      for (var i = 0; i < pages.length; i += 1) {
        var page = pages[i] || {};
        if (page.id === text || page.slug === text || normalizePath(page.path) === path) return page;
      }
      return null;
    }

    function makeBlockContext(ctx) {
      return {
        site: ctx.site,
        project: ctx.project,
        page: ctx.page,
        options: ctx.options,
        preview: !!ctx.options.preview,
        activePath: ctx.activePath,
        report: ctx.report,
        registry: ctx.registry,
        themeId: ctx.themeId,
        mode: ctx.mode,
        h: R.h,
        text: R.text,
        raw: R.raw,
        markdown: function (md, mdOptions) {
          return R.markdownToHtml(md, mdOptions || {});
        },
        markdownInline: R.markdownInline,
        escapeHtml: R.escapeHtml,
        escapeAttr: R.escapeAttr,
        safeUrl: R.safeUrl
      };
    }

    function collectActions(block, path, ctx) {
      if (!Array.isArray(block.actions)) return [];
      var list = [];
      block.actions.forEach(function (action, index) {
        if (!action || typeof action !== 'object') {
          ctx.report.warn(R.CODES.ACTION_UNKNOWN, 'actions 项不是对象，已忽略。', {
            path: path + '.actions[' + index + ']', blockId: block.id
          });
          return;
        }
        var type = action.type || 'link';
        if (!BUILTIN_ACTIONS[type] && !ctx.registry.action(type)) {
          ctx.report.warn(R.CODES.ACTION_UNKNOWN, '未注册的动作类型：' + type, {
            path: path + '.actions[' + index + ']', blockId: block.id
          });
        }
        list.push(action);
      });
      if (list.length) {
        ctx.actions.push({ blockId: block.id, actions: list });
      }
      return list;
    }

    function renderComponentBlock(block, path, ctx) {
      var component = ctx.registry.component(block.componentId);
      if (!component) {
        ctx.report.error(R.CODES.COMPONENT_MISSING, '自定义组件 ' + String(block.componentId || '(空)') + ' 未注册，已跳过该区块。', {
          path: path, blockId: block.id, componentId: block.componentId
        });
        return null;
      }
      /* 实例覆盖：HTML 整段替换、CSS/JS 追加；语法错误逐项降级并记录位置。 */
      var merged = R.mergeInstanceOverrides(component, block.overrides);
      if (merged.validation && !merged.validation.ok) {
        merged.validation.errors.forEach(function (error) {
          ctx.report.warn(R.CODES.OVERRIDE_SOURCE_INVALID,
            '实例覆盖 ' + String(error.field).toUpperCase() + ' 语法错误（第 ' + error.line + ' 行，第 ' + error.column + ' 列）：' + error.message,
            { path: path + '.overrides.' + error.field, blockId: block.id, componentId: component.id });
        });
      }
      var template = String(merged.template || '');
      if (!template.trim()) {
        ctx.report.warn(R.CODES.COMPONENT_TEMPLATE_EMPTY, '组件 ' + component.id + ' 的模板为空。', {
          path: path, blockId: block.id, componentId: component.id
        });
      }
      var fields = block.fields || (block.data && block.data.fields) || {};
      var html = template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, function (_, key) {
        var value = fields[key];
        return R.escapeHtml(value == null ? '' : value);
      });

      if (component.css && !ctx.cssSeen['comp:' + component.id]) {
        ctx.cssSeen['comp:' + component.id] = true;
        ctx.css.push(R.scopeCss(component.css, '[data-lc-comp="' + cssAttrValue(component.id) + '"]', function (message) {
          ctx.report.warn(R.CODES.CSS_IMPORT_DROPPED, message, { blockId: block.id, componentId: component.id });
        }));
      }
      if (merged.overrideCss && !ctx.cssSeen['inst:' + block.id]) {
        ctx.cssSeen['inst:' + block.id] = true;
        ctx.css.push(R.scopeInstanceCss(merged.overrideCss, block.id));
      }
      var jsSource = [merged.js, merged.overrideJs].filter(function (item) { return item && String(item).trim(); }).join('\n');
      if (jsSource) {
        ctx.scripts.push({ blockId: block.id, componentId: component.id, source: jsSource });
      }
      /* 实例数据覆盖：拉取自己的数据来源，处理逻辑在 transform 里。 */
      var dataScript = R.buildInstanceDataScript(block);
      if (dataScript) {
        ctx.scripts.push({ blockId: block.id, componentId: component.id, source: dataScript });
      }

      var instanceAttrs = {
        class: 'lc-component',
        'data-lc-comp': component.id,
        'data-lc-instance': block.id
      };
      if (merged.hasOverrides) instanceAttrs['data-lc-overridden'] = 'true';
      var dataAttrs = R.instanceDataAttrs(block);
      Object.keys(dataAttrs).forEach(function (key) { instanceAttrs[key] = dataAttrs[key]; });
      return R.h('div', instanceAttrs, [R.raw(html)]);
    }

    function renderContainerBlock(block, path, ctx, depth) {
      var variant = block.variant === 'free' || block.variant === 'columns' ||
        block.variant === 'accordion' ? block.variant : 'card';
      var result = renderBlockList(block.blocks, path + '.blocks', ctx, {
        free: variant === 'free', depth: depth + 1
      });

      if (variant === 'accordion') {
        var accordionAttrs = { class: 'lc-container lc-container-accordion' };
        if (block.open !== false) accordionAttrs.open = true;
        return R.h('details', accordionAttrs, [
          R.h('summary', {}, block.title || '折叠面板'),
          R.h('div', { class: 'lc-container-inner lc-blocks lc-flow' }, result.nodes)
        ]);
      }

      if (variant === 'columns') {
        var cols = Math.max(1, Math.min(6, Number(block.columns) || 2));
        return R.h('section', { class: 'lc-container lc-container-columns', style: { '--lc-cols': cols } }, [
          block.title ? R.h('div', { class: 'lc-container-title' }, block.title) : null,
          R.h('div', { class: 'lc-container-inner lc-blocks lc-flow' }, result.nodes)
        ]);
      }

      if (variant === 'free') {
        var innerStyle = result.height > 0 ? { 'min-height': result.height + 'px' } : null;
        return R.h('section', { class: 'lc-container lc-container-free' }, [
          block.title ? R.h('div', { class: 'lc-container-title' }, block.title) : null,
          R.h('div', { class: 'lc-container-inner lc-blocks lc-free', style: innerStyle }, result.nodes)
        ]);
      }

      return R.h('section', { class: 'lc-container lc-container-card' }, [
        block.title ? R.h('div', { class: 'lc-container-title' }, block.title) : null,
        R.h('div', { class: 'lc-container-inner lc-blocks lc-flow' }, result.nodes)
      ]);
    }

    function nextBlockId(block, path, ctx) {
      if (block && typeof block.id === 'string' && block.id.trim()) {
        if (ctx.idsSeen[block.id]) {
          ctx.report.warn(R.CODES.DUPLICATE_BLOCK_ID, '区块 id 重复：' + block.id + '，动作与脚本可能定位到第一个同名块。', {
            path: path, blockId: block.id
          });
        }
        ctx.idsSeen[block.id] = true;
        return block.id;
      }
      ctx.autoId += 1;
      var id = 'lc-auto-' + ctx.autoId;
      ctx.report.warn(R.CODES.BLOCK_INVALID, '区块缺少 id，已临时使用 ' + id + '。', { path: path, blockId: id });
      return id;
    }

    function renderBlock(block, path, ctx, depth) {
      if (depth > ctx.maxDepth) {
        ctx.report.error(R.CODES.NESTING_TOO_DEEP, '容器嵌套超过 ' + ctx.maxDepth + ' 层，已停止渲染该子树。', { path: path });
        return null;
      }
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        ctx.report.error(R.CODES.BLOCK_INVALID, '区块不是对象，已跳过。', { path: path });
        return null;
      }
      if (block.visible === false) return null;
      if (typeof block.type !== 'string' || !block.type) {
        ctx.report.error(R.CODES.BLOCK_INVALID, '区块缺少 type，已跳过。', { path: path, blockId: block.id });
        return null;
      }

      var blockId = nextBlockId(block, path, ctx);
      ctx.blockMap[blockId] = block;

      var inner = null;
      try {
        if (block.type === 'container') {
          inner = renderContainerBlock(block, path, ctx, depth);
        } else if (block.type === 'component') {
          inner = renderComponentBlock(block, path, ctx);
        } else {
          var def = ctx.registry.block(block.type);
          if (!def) {
            ctx.report.error(R.CODES.BLOCK_UNKNOWN, '未注册的区块类型：' + block.type + '，已跳过。', {
              path: path, blockId: blockId
            });
            return null;
          }
          /* 区块自带的样式：共享样式按 id 去重，组件样式按类型或 cssId 去重，避免多实例重复注入。 */
          if (def.sharedCss && def.sharedCssId && !ctx.cssSeen['shared:' + def.sharedCssId]) {
            ctx.cssSeen['shared:' + def.sharedCssId] = true;
            ctx.css.push(String(def.sharedCss));
          }
          var cssKey = 'def:' + (def.cssId || block.type);
          if (def.css && !ctx.cssSeen[cssKey]) {
            ctx.cssSeen[cssKey] = true;
            ctx.css.push(String(def.css));
          }
          if (R.builtinRuntimeTypes && R.builtinRuntimeTypes[block.type]) {
            ctx.builtinTypes[block.type] = true;
          }
          inner = def.render(block, ctx.blockContext);
        }
      } catch (error) {
        ctx.report.error(R.CODES.BLOCK_RENDER_FAILED, '区块渲染失败：' + (error && error.message ? error.message : String(error)), {
          path: path, blockId: blockId, reason: error && error.stack ? String(error.stack).split('\n')[0] : ''
        });
        return null;
      }

      if (inner == null || inner === false) return null;

      var children;
      if (typeof inner === 'string' || typeof inner === 'number') children = [R.raw(String(inner))];
      else if (Array.isArray(inner)) children = inner;
      else children = [inner];

      collectActions(block, path, ctx);

      var blockAttrs = {
        class: 'lc-block',
        'data-lc-block': blockId,
        'data-lc-type': block.type
      };

      /* 内置区块也支持实例级 HTML/CSS/JS 覆盖；组件区块在 renderComponentBlock 里已处理。 */
      if (block.type !== 'component' && block.overrides && typeof block.overrides === 'object' && R.hasOverrides(block.overrides)) {
        var instanceOverride = R.normalizeOverrides(block.overrides);
        var overrideCheck = R.validateOverrideSource(instanceOverride);
        var usable = { html: instanceOverride.html, css: instanceOverride.css, js: instanceOverride.js };
        (overrideCheck.errors || []).forEach(function (item) {
          if (usable[item.field] != null) usable[item.field] = null;
          ctx.report.warn(R.CODES.OVERRIDE_SOURCE_INVALID, '实例覆盖 ' + String(item.field).toUpperCase() + ' 语法错误（第 ' + item.line + ' 行，第 ' + item.column + ' 列）：' + item.message, {
            path: path + '.overrides.' + item.field, blockId: blockId
          });
        });
        if (usable.html != null) {
          children = [R.raw(String(usable.html).replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, function (match, key) {
            return R.escapeHtml(block[key] == null ? '' : block[key]);
          }))];
        }
        if (usable.css && !ctx.cssSeen['inst:' + blockId]) {
          ctx.cssSeen['inst:' + blockId] = true;
          ctx.css.push(R.scopeInstanceCss(usable.css, blockId));
        }
        if (usable.js) ctx.scripts.push({ blockId: blockId, componentId: block.type, source: usable.js });
        blockAttrs['data-lc-instance'] = blockId;
        blockAttrs['data-lc-overridden'] = 'true';
      }

      /* 事件绑定：配置挂在元素上，页面级运行时统一扫描，不按块重复注入脚本。 */
      var blockBindings = R.normalizeBindings(block.bindings);
      if (blockBindings.length) {
        blockAttrs['data-lc-bindings'] = JSON.stringify(blockBindings);
        if (block.type !== 'component' && !blockAttrs['data-lc-instance']) blockAttrs['data-lc-instance'] = blockId;
        if (!ctx.bindingsRuntime) {
          ctx.bindingsRuntime = true;
          ctx.scripts.push({ global: true, componentId: 'bindings', source: R.bindingsRuntimeSource() });
        }
      }

      return R.h('div', blockAttrs, children);
    }

    /* 返回 { nodes, height }。free 模式下按 pos 绝对定位，其余走流式。 */
    function renderBlockList(blocks, path, ctx, listOptions) {
      var listOpts = listOptions || {};
      var source = Array.isArray(blocks) ? blocks : [];
      if (blocks != null && !Array.isArray(blocks)) {
        ctx.report.error(R.CODES.BLOCK_INVALID, 'blocks 不是数组，已按空列表处理。', { path: path });
      }
      var nodes = [];
      var cursorY = 0;
      var maxBottom = 0;

      source.forEach(function (block, index) {
        var childPath = path + '[' + index + ']';
        var node = renderBlock(block, childPath, ctx, listOpts.depth || 0);
        if (!node) return;

        if (listOpts.free) {
          var geom = R.normalizePos(block.pos, ctx.report, childPath);
          if (!geom) geom = R.fallbackGeom(cursorY, ctx.report, childPath);
          node.attrs.style = copyStyle(node.attrs.style, R.positionStyle(geom));
          node.attrs['data-lc-positioned'] = 'abs';
          var bottom = R.bottomOf(geom, cursorY);
          cursorY = bottom + 12;
          if (bottom > maxBottom) maxBottom = bottom;
        } else if (listOpts.deferAfter != null && index >= listOpts.deferAfter) {
          node.attrs['data-lc-defer'] = 'true';
        }
        nodes.push(node);
      });

      return { nodes: nodes, height: maxBottom };
    }

    function resolveShellNode(ref, path, ctx, depth) {
      if (!ref || !ref.blockId) return null;
      var block = R.resolveShellBlock(data, ref.blockId);
      if (!block) {
        ctx.report.warn(R.CODES.SHELL_MISSING, '外壳引用的区块 ' + ref.blockId + ' 不存在。', { path: path, blockId: ref.blockId });
        return null;
      }
      var node = renderBlock(block, path, ctx, depth);
      /* 标记公共外壳区块：编辑器里不当作可编辑内容选中，也不参与拖拽（BLD-05）。 */
      if (node && node.attrs) node.attrs['data-lc-shell'] = 'true';
      return node;
    }

    function render(pageRef, renderOptions) {
      var pageOptions = Object.assign({}, opts, renderOptions || {});
      var page = findPage(pageRef);
      var report = R.createReport();
      var themeId = pageOptions.themeId || defaultThemeId;
      var mode = normalizeMode(pageOptions.mode != null ? pageOptions.mode : defaultMode);
      if (mode === 'auto') {
        report.warn(R.CODES.MODE_UNRESOLVED, '模式 auto 未解析：渲染层不读系统偏好，应由外壳层解析后传入 light/dark。', {
          path: 'theme.mode'
        });
      }

      if (!page) {
        report.error(R.CODES.PAGE_MISSING, '找不到页面：' + String(pageRef) + '。', { path: String(pageRef) });
        var missingNode = R.h('div', {
          class: 'lc-page',
          'data-lc-theme': themeId,
          'data-lc-mode': mode
        }, [
          R.h('div', { class: 'lc-block-error' }, '页面数据缺失，无法渲染：' + String(pageRef))
        ]);
        return {
          page: null,
          node: missingNode,
          css: BASE_CSS + '\n' + R.themeCss(themes),
          scripts: [],
          actions: [],
          report: report,
          nonce: pageOptions.nonce || '',
          blockMap: {},
          registry: registry,
          site: data
        };
      }

      if (!R.resolveTheme(themes, themeId)) {
        report.warn(R.CODES.THEME_MISSING, '主题 ' + themeId + ' 不存在，页面将只保留结构样式。');
      }

      /* 双端独立 UI：page.blocks 是桌面端，page.blocksMobile 是移动端；
         标记关闭时只渲染 page.blocks，移动端数据保留但不参与产物。 */
      var independentUi = page.independentUi === true && Array.isArray(page.blocksMobile);

      var ctx = {
        site: data,
        project: project,
        page: page,
        pageHasH1: pageHasH1(page.blocks) || (independentUi && pageHasH1(page.blocksMobile)),
        options: pageOptions,
        activePath: page.path || '',
        report: report,
        registry: registry,
        themeId: themeId,
        mode: mode,
        css: [],
        cssSeen: {},
        scripts: [],
        actions: [],
        blockMap: {},
        idsSeen: {},
        builtinTypes: {},
        autoId: 0,
        maxDepth: Number(pageOptions.maxDepth) > 0 ? Number(pageOptions.maxDepth) : 20,
        blockContext: null
      };
      ctx.blockContext = makeBlockContext(ctx);

      try {
        var isFree = !!(page.layout && page.layout.mode === 'free');
        var articleConfig = page.article;
        var isArticle = articleConfig === true || (!!articleConfig && typeof articleConfig === 'object');
        /* 长页面把首屏之后的顶级区块交给浏览器延迟渲染；文章页不启用，避免目录定位与深链接偏移。 */
        var deferAfter = null;
        var desktopCount = Array.isArray(page.blocks) ? page.blocks.length : 0;
        var mobileCount = Array.isArray(page.blocksMobile) ? page.blocksMobile.length : 0;
        /* 双端页的总长度也要算进来：移动端长页同样需要延迟首屏之后的区块。 */
        if (pageOptions.defer !== false && !isArticle && !isFree && desktopCount + mobileCount >= 24) {
          deferAfter = Number(pageOptions.deferAfter) > 0 ? Number(pageOptions.deferAfter) : 12;
        }
        /* 渲染一棵区块树；双端模式下会被调用两次，各自的 CSS / 脚本 / 报告都汇入同一 ctx。 */
        var renderEnd = function (blocks, path, idPrefix) {
          var body = renderBlockList(blocks, path, ctx, { free: isFree, depth: 0, deferAfter: deferAfter });
          var bodyStyle = isFree && body.height > 0 ? { 'min-height': body.height + 'px' } : null;
          var info = null;
          if (isArticle) {
            info = R.enhanceArticle(body.nodes, {
              page: page,
              site: data,
              report: report,
              preview: !!pageOptions.preview,
              article: articleConfig === true ? {} : articleConfig,
              idPrefix: idPrefix || ''
            });
            body.nodes = info.nodes;
          }
          var node = R.h('div', {
            class: 'lc-blocks ' + (isFree ? 'lc-free' : 'lc-flow'),
            'data-lc-blocks': 'root',
            style: bodyStyle
          }, body.nodes);
          return { body: body, node: node, info: info };
        };

        var endResults = [];
        if (independentUi) {
          endResults.push({ end: 'desktop', result: renderEnd(page.blocks, 'blocks', '') });
          endResults.push({ end: 'mobile', result: renderEnd(page.blocksMobile, 'blocksMobile', 'm-') });
        } else {
          endResults.push({ end: null, result: renderEnd(page.blocks, 'blocks', '') });
        }
        var articleInfo = endResults[0].result.info;

        var shell = page.shell || {};
        var headerNode = shell.header === false ? null : resolveShellNode(project.navigation, 'shell.navigation', ctx, 0);
        var footerNode = shell.footer === false ? null : resolveShellNode(project.footer, 'shell.footer', ctx, 0);
        var sidebarNode = shell.sidebar === false ? null : resolveShellNode(project.sidebar, 'shell.sidebar', ctx, 0);
        var breadcrumbNode = null;
        if (pageOptions.showBreadcrumb || (shell.breadcrumb === true && project.breadcrumb)) {
          breadcrumbNode = resolveShellNode(project.breadcrumb, 'shell.breadcrumb', ctx, 0);
        }

        var mainChildren = [breadcrumbNode];
        if (independentUi) {
          mainChildren.push(R.h('div', { class: 'lc-ui-ends', 'data-lc-ui-ends': 'true' },
            endResults.map(function (item) {
              var result = item.result;
              var children = [];
              if (result.info) {
                children.push(R.h('div', {
                  class: 'lc-article-layout' + (result.info.tocNode ? '' : ' lc-article-layout-single')
                }, [
                  R.h('article', { class: 'lc-article-body' }, [result.node]),
                  result.info.tocNode
                ]));
                if (result.info.navNode) children.push(result.info.navNode);
              } else {
                children.push(result.node);
              }
              return R.h('div', { class: 'lc-ui-end', 'data-lc-ui-end': item.end }, children);
            })
          ));
        } else if (articleInfo) {
          mainChildren.push(R.h('div', {
            class: 'lc-article-layout' + (articleInfo.tocNode ? '' : ' lc-article-layout-single')
          }, [
            R.h('article', { class: 'lc-article-body' }, [endResults[0].result.node]),
            articleInfo.tocNode
          ]));
          if (articleInfo.navNode) mainChildren.push(articleInfo.navNode);
        } else {
          mainChildren.push(endResults[0].result.node);
        }

        var pageAttrs = {
          class: 'lc-page',
          'data-lc-page': page.id || '',
          'data-lc-layout': isFree ? 'free' : 'flow',
          'data-lc-theme': themeId,
          'data-lc-mode': mode
        };
        var pageSize = R.normalizePageSize(page.size);
        var pageSizeCss = R.pageSizeStyle(pageSize);
        if (pageSizeCss) pageAttrs.style = pageSizeCss;
        if (pageSize.maxWidth) pageAttrs['data-lc-page-max-width'] = pageSize.maxWidth;
        if (pageSize.maxHeight) pageAttrs['data-lc-page-max-height'] = pageSize.maxHeight;
        if (mode !== 'auto') pageAttrs['data-theme'] = mode; // 旧属性兼容，不是主路径
        if (isArticle) pageAttrs['data-lc-article'] = 'true';
        if (independentUi) pageAttrs['data-lc-independent-ui'] = 'true';

        var mainAttrs = { class: 'lc-main' };
        var pageLayout = page.layout || {};
        if (pageLayout.align === 'center') mainAttrs.class += ' lc-main-center';
        var maxWidth = pageLayout.maxWidth == null ? '' : String(pageLayout.maxWidth).trim();
        if (/^\d+(?:\.\d+)?(?:px|rem|em|%)?$/.test(maxWidth)) {
          mainAttrs.style = '--lc-main-max:' + maxWidth + ';';
        }
        var mainNode = R.h('main', mainAttrs, mainChildren);
        var contentNode = sidebarNode
          ? R.h('div', { class: 'lc-shell-layout' }, [sidebarNode, mainNode])
          : mainNode;

        /* 页面级覆盖：HTML 追加在页面容器末尾，CSS 强制作用域到该页面，JS 随页面脚本执行。
           与实例覆盖同一套语法校验，坏掉的字段逐项降级并记录行列。 */
        var pageOverrides = R.normalizePageOverrides(page.overrides);
        var pageValidation = R.validateOverrideSource(pageOverrides);
        if (!pageValidation.ok) {
          pageValidation.errors.forEach(function (error) {
            pageOverrides[error.field] = null;
            report.warn(R.CODES.OVERRIDE_SOURCE_INVALID,
              '页面覆盖 ' + String(error.field).toUpperCase() + ' 语法错误（第 ' + error.line + ' 行，第 ' + error.column + ' 列）：' + error.message,
              { path: 'overrides.' + error.field, pageId: page.id });
          });
        }
        if (pageOverrides.css) {
          var pageCss = R.scopeCss(pageOverrides.css, '[data-lc-page="' + cssAttrValue(page.id) + '"]');
          if (pageCss) ctx.css.push(pageCss);
        }
        if (pageOverrides.js) {
          ctx.scripts.push({ pageId: page.id, source: pageOverrides.js });
        }
        /* 页面级接口覆盖：在该页面拦截 fetch，重复 method+path 只保留最新一段。 */
        var apiOverrideScript = R.buildApiOverrideScript(page);
        if (apiOverrideScript) {
          var apiResolved = R.resolveApiOverrides(page.apiOverrides);
          pageAttrs['data-lc-api-overrides'] = String(apiResolved.effective.length);
          if (apiResolved.shadowed.length) pageAttrs['data-lc-api-shadowed'] = String(apiResolved.shadowed.length);
          ctx.scripts.push({ pageId: page.id, source: apiOverrideScript });
        }

        /* 内置组件交互脚本：按页面实际用到的类型拼一份浏览器包，放在实例脚本之前，
           让 demo 之外的预览与导出页面也能直接获得组件 enhance（滑块数据源依赖它）。 */
        if (typeof R.builtinRuntimeSource === 'function') {
          var builtinTypes = Object.keys(ctx.builtinTypes || {});
          var builtinSource = builtinTypes.length ? R.builtinRuntimeSource(builtinTypes) : '';
          if (builtinSource) ctx.scripts.unshift({ global: true, source: builtinSource });
        }

        var pageChildren = [headerNode, contentNode, footerNode];
        if (pageOverrides.html) pageChildren.push(R.raw(pageOverrides.html));
        if (pageOverrides.html || pageOverrides.css || pageOverrides.js) pageAttrs['data-lc-overridden'] = 'true';
        var node = R.h('div', pageAttrs, pageChildren);

        var css = BASE_CSS + '\n' + R.themeCss(themes) +
          (ctx.css.length ? '\n' + ctx.css.join('\n') : '');

        return {
          page: page,
          node: node,
          css: css,
          scripts: ctx.scripts,
          actions: ctx.actions,
          report: report,
          article: articleInfo,
          pageSize: pageSize,
          nonce: pageOptions.nonce || '',
          blockMap: ctx.blockMap,
          registry: registry,
          site: data
        };
      } catch (error) {
        report.error(R.CODES.PAGE_INVALID, '页面渲染失败：' + (error && error.message ? error.message : String(error)), {
          path: String(pageRef)
        });
        return {
          page: page,
          node: R.h('div', {
            class: 'lc-page',
            'data-lc-theme': themeId,
            'data-lc-mode': mode
          }, [
            R.h('div', { class: 'lc-block-error' }, '页面渲染失败，详情见错误报告。')
          ]),
          css: BASE_CSS,
          scripts: [],
          actions: [],
          report: report,
          nonce: pageOptions.nonce || '',
          blockMap: {},
          registry: registry,
          site: data
        };
      }
    }

    function renderToHtml(pageRef, renderOptions) {
      var result = render(pageRef, renderOptions);
      return {
        html: R.toHtml(result.node),
        css: result.css,
        scripts: result.scripts,
        scriptsHtml: scriptsHtml(result.scripts, result.nonce),
        actions: result.actions,
        report: result.report,
        result: result
      };
    }

    return {
      site: data,
      project: project,
      registry: registry,
      themes: themes,
      defaultThemeId: defaultThemeId,
      defaultMode: defaultMode,
      listPages: listPages,
      findPage: findPage,
      render: render,
      renderPage: render,
      renderToHtml: renderToHtml,
      themeCss: function () { return R.themeCss(themes); },
      baseCss: function () { return BASE_CSS; }
    };
  }

  function findActionTarget(action, blockEl, ctx) {
    if (!action) return null;
    if (action.targetId) {
      var byId = ctx.host ? ctx.host.querySelector('[data-lc-block="' + cssAttrValue(action.targetId) + '"]') : null;
      if (byId) return byId;
    }
    var selector = action.target || action.selector;
    if (!selector) return blockEl;
    try {
      return (ctx.host || blockEl.ownerDocument).querySelector(selector);
    } catch (error) {
      return null;
    }
  }

  function runAction(action, event, blockEl, ctx) {
    if (!action || !action.type) return;
    var handler = ctx.registry ? ctx.registry.action(action.type) : null;
    if (handler) {
      handler(action, event, {
        block: ctx.blockMap[blockEl.getAttribute('data-lc-block')],
        element: blockEl,
        host: ctx.host,
        root: ctx.root,
        page: ctx.page,
        site: ctx.site,
        report: ctx.report
      });
      return;
    }
    if (action.type === 'link') {
      var safe = R.safeUrl(action.href);
      if (!safe) return;
      if (typeof window !== 'undefined') window.location.href = safe;
      return;
    }
    if (action.type === 'toggle') {
      var className = action.className || action.class || 'is-open';
      var target = action.only === 'self' ? blockEl : findActionTarget(action, blockEl, ctx);
      if (target && target.classList) target.classList.toggle(className);
      return;
    }
    if (action.type === 'scrollTo') {
      var scroller = findActionTarget(action, blockEl, ctx);
      if (scroller && scroller.scrollIntoView) scroller.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (typeof console !== 'undefined') console.warn('[lc] 未注册的动作类型：' + action.type);
  }

  function bindEvents(result, host, bindOptions) {
    var options = bindOptions || {};
    var ctx = {
      host: host,
      root: result.node,
      page: result.page,
      site: options.site || result.site,
      report: result.report,
      registry: options.registry || result.registry || null,
      blockMap: result.blockMap || {}
    };
    if (!host || !host.querySelectorAll || !result.actions) return;
    var walkers = Array.prototype.slice.call(host.querySelectorAll('[data-lc-block]'));
    walkers.forEach(function (blockEl) {
      var blockId = blockEl.getAttribute('data-lc-block');
      var group = null;
      for (var i = 0; i < result.actions.length; i += 1) {
        if (result.actions[i].blockId === blockId) { group = result.actions[i]; break; }
      }
      if (!group) return;
      group.actions.forEach(function (action) {
        var eventName = action.event || 'click';
        blockEl.addEventListener(eventName, function (event) {
          if (action.preventDefault !== false) event.preventDefault();
          runAction(action, event, blockEl, ctx);
        });
      });
    });
  }

  function mount(result, host, mountOptions) {
    if (!host) throw new Error('mount 需要一个挂载节点');
    var options = mountOptions || {};
    var doc = host.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('mount 需要浏览器环境；Node 侧请使用 renderToHtml。');

    while (host.firstChild) host.removeChild(host.firstChild);

    if (result.css) {
      var style = doc.createElement('style');
      style.setAttribute('data-lc-render', 'css');
      style.textContent = result.css;
      host.appendChild(style);
    }

    host.appendChild(R.toDom(result.node, doc));

    (result.scripts || []).forEach(function (item) {
      var script = doc.createElement('script');
      if (result.nonce) script.setAttribute('nonce', result.nonce);
      script.textContent = scriptSource(item.blockId, item.componentId, item.source);
      host.appendChild(script);
    });

    bindEvents(result, host, options);
    return host.querySelector('.lc-page') || host.firstChild;
  }

  R.BASE_CSS = BASE_CSS;
  R.createRenderer = createRenderer;
  R.renderPage = function (site, pageRef, options) {
    return createRenderer(site, options).render(pageRef, options);
  };
  R.renderPageToHtml = function (site, pageRef, options) {
    return createRenderer(site, options).renderToHtml(pageRef, options);
  };
  R.mount = mount;
  R.bindEvents = bindEvents;
  R.scriptsHtml = scriptsHtml;
  R.runAction = runAction;

  return R;
}));
