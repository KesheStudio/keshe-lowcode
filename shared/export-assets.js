/* 低代码平台 · 导出资源拷贝与内联（F3 第②步）
 *
 * 与 shared/export-bundle.js 配套，浏览器与服务端共用：
 * - 唯一一份 CONDITIONAL_ASSETS 表（mermaid 等按引用打包的运行时）。
 * - 把站点 assets/images、assets/fonts、assets/icons 中被页面/CSS 引用到的文件拷进产物。
 * - 小于阈值且不含 url()/@import 的 CSS 内联进 HTML，减少首屏请求。
 *
 * 本文件不读磁盘、不发请求：调用方把 assetSources（站点资源内容）和
 * conditionalSources（平台 vendor 内容）准备好传进来，两边走同一套计划逻辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./export-bundle.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.ExportAssets = factory(root.LC.ExportBundle);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Bundle) {
  'use strict';

  if (!Bundle) throw new Error('LC.ExportAssets 依赖 shared/export-bundle.js，请先加载');

  var INLINE_CSS_LIMIT = 4096;

  /* 第三方站点运行时清单：产物实际引用到才进包（D-48）。
     服务端与浏览器都从这里取，不再各自维护一份。 */
  var CONDITIONAL_ASSETS = [
    {
      package: 'mermaid',
      version: '12.3.0',
      license: 'MIT',
      source: 'vendor/mermaid.min.js',
      target: 'assets/js/mermaid.min.js',
      used: function (bundle) {
        var adapter = typeof window !== 'undefined' && window.LC && window.LC.Mermaid;
        var files = (bundle && bundle.files) || {};
        return Object.keys(files).some(function (path) {
          var text = files[path];
          if (!/\.html?$/i.test(path) || typeof text !== 'string') return false;
          return adapter ? adapter.hasMermaidMarkup(text) : /data-lc-mermaid|class="mermaid"/.test(text);
        });
      }
    }
  ];

  var ASSET_MIME = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav'
  };

  function joinSitePath(siteDir, target) {
    var path = String(target || '').replace(/^\/+/, '');
    return siteDir ? siteDir + '/' + path : path;
  }

  function extensionOf(path) {
    var match = String(path || '').match(/\.[a-z0-9]+$/i);
    return match ? match[0].slice(1).toLowerCase() : '';
  }

  function isAssetPath(path) {
    return !!ASSET_MIME[extensionOf(path)];
  }

  function selectConditionalAssets(table, files) {
    return (table || []).filter(function (item) {
      try {
        return !!item.used({ files: files });
      } catch (error) {
        return false;
      }
    });
  }

  function collectLocalRefs(files) {
    var refs = [];
    Object.keys(files || {}).forEach(function (path) {
      if (/\.html?$/i.test(path)) {
        Bundle.htmlRefs(String(files[path] || '')).forEach(function (ref) {
          pushRef(path, ref);
        });
      } else if (/\.css$/i.test(path)) {
        Bundle.cssRefs(String(files[path] || '')).forEach(function (ref) {
          pushRef(path, ref);
        });
      }
    });
    return refs;

    function pushRef(from, ref) {
      if (!Bundle.localRefUsable(ref)) return;
      refs.push({ from: from, ref: ref, target: Bundle.resolveRef(from, ref) });
    }
  }

  /**
   * 按 CONDITIONAL_ASSETS 表把被引用的运行时拷进产物。
   * 缺少平台侧源文件时记进 missing，由最终离线检查拦下（不静默生成坏包）。
   */
  function applyConditionalAssets(input) {
    var opts = input || {};
    var files = opts.files || {};
    var siteDir = opts.siteDir == null ? '' : String(opts.siteDir);
    var sources = opts.conditionalSources || {};
    var used = selectConditionalAssets(opts.table || CONDITIONAL_ASSETS, files);
    var bundled = [];
    var missing = [];
    var copied = [];

    used.forEach(function (item) {
      var target = joinSitePath(siteDir, item.target);
      var body = sources[item.source];
      if (body == null) {
        missing.push({ source: item.source, target: target, package: item.package });
        return;
      }
      if (files[target] == null) {
        files[target] = body;
        copied.push(target);
      }
      bundled.push({
        path: target,
        package: item.package + '@' + item.version,
        license: item.license,
        bytes: Bundle.byteSize(body),
        sha256: ''
      });
    });

    return {
      files: files,
      used: used,
      bundled: bundled,
      copied: copied,
      missing: missing
    };
  }

  /**
   * 把站点 assets/ 下被页面或 CSS 引用到的文件拷进产物。
   * assetSources 的键相对站点根，例如 assets/images/logo.png。
   */
  function copyReferencedAssets(input) {
    var opts = input || {};
    var files = opts.files || {};
    var siteDir = opts.siteDir == null ? 'web' : String(opts.siteDir);
    var assetSources = opts.assetSources || {};
    var refs = collectLocalRefs(files);
    var copied = [];
    var missing = [];

    refs.forEach(function (item) {
      var target = item.target;
      if (!target || files[target] != null) return;
      var siteKey = siteDir && target.indexOf(siteDir + '/') === 0
        ? target.slice(siteDir.length + 1)
        : target;
      var body = assetSources[siteKey];
      if (body == null) body = assetSources[target];
      if (body != null) {
        files[target] = body;
        copied.push(target);
        return;
      }
      if ((siteDir && target.indexOf(siteDir + '/assets/') === 0) || isAssetPath(target)) {
        missing.push({ from: item.from, ref: item.ref, target: target });
      }
    });

    return { files: files, copied: copied, missing: missing };
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function styleTagFor(target, css, tag) {
    var media = (tag.match(/\bmedia\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    var attr = media ? ' media="' + media + '"' : '';
    return '<style data-lc-inlined="' + target + '"' + attr + '>\n' + css + '\n</style>';
  }

  /**
   * 小首屏 CSS 内联：只处理 <link rel="stylesheet">，且 CSS 内不含 url()/@import。
   * 含资源引用的 CSS 一旦内联，相对路径基准会变，因此不内联。
   */
  function inlineSmallCss(input) {
    var opts = input || {};
    var files = opts.files || {};
    var limit = Number(opts.limit == null ? INLINE_CSS_LIMIT : opts.limit);
    var siteDir = opts.siteDir == null ? 'web' : String(opts.siteDir);
    var inlined = [];

    Object.keys(files).forEach(function (path) {
      if (!/\.html?$/i.test(path) || typeof files[path] !== 'string') return;
      var text = files[path];
      var next = text.replace(/<link\b[^>]*>/gi, function (tag) {
        if (!/\brel\s*=\s*["'][^"']*stylesheet/i.test(tag)) return tag;
        if (/\bdata-lc-no-inline\b/i.test(tag)) return tag;
        var href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
        if (!Bundle.localRefUsable(href)) return tag;
        var target = Bundle.resolveRef(path, href);
        if (!target || typeof files[target] !== 'string') return tag;
        var css = files[target];
        if (Bundle.byteSize(css) > limit) return tag;
        if (/url\s*\(|@import\b/i.test(css)) return tag;
        if (!inlined.some(function (item) { return item.path === target; })) {
          inlined.push({ path: target, bytes: Bundle.byteSize(css) });
        }
        return styleTagFor(target, css, tag);
      });
      files[path] = next;
    });

    /* 只有彻底没人再引用时才删源 CSS；仍有 media/print 等引用则保留。 */
    var removed = [];
    if (inlined.length) {
      var refs = collectLocalRefs(files);
      inlined.forEach(function (item) {
        var stillUsed = refs.some(function (ref) { return ref.target === item.path; });
        if (!stillUsed && files[item.path] != null) {
          delete files[item.path];
          item.removed = true;
          removed.push(item.path);
        }
      });
    }

    return { files: files, inlined: inlined, removed: removed };
  }

  /**
   * 资源阶段总入口：先按引用装第三方运行时，再拷贝站点资源，最后内联小 CSS。
   * 返回的 files / bundledAssets 直接交给 export-bundle 的 assemble()。
   */
  function planAssets(input) {
    var opts = input || {};
    var siteDir = opts.siteDir == null ? 'web' : String(opts.siteDir);
    var files = {};
    Object.keys(opts.files || {}).forEach(function (path) {
      if (opts.files[path] != null) files[path] = opts.files[path];
    });
    var warnings = [];

    var conditional = applyConditionalAssets({
      files: files,
      siteDir: siteDir,
      table: opts.conditionalTable || CONDITIONAL_ASSETS,
      conditionalSources: opts.conditionalSources || {}
    });
    conditional.missing.forEach(function (item) {
      warnings.push({
        code: 'LC_W_ASSET_MISSING',
        message: '缺少第三方运行时 ' + item.source + '，产物中的 ' + item.target + ' 将无法离线打开'
      });
    });

    var copied = copyReferencedAssets({
      files: files,
      siteDir: siteDir,
      assetSources: opts.assetSources || {}
    });
    copied.missing.forEach(function (item) {
      warnings.push({
        code: 'LC_W_ASSET_MISSING',
        message: item.from + ' 引用的 ' + item.ref + ' 在站点资源中不存在'
      });
    });

    var inline = opts.inlineCss === false
      ? { files: files, inlined: [], removed: [] }
      : inlineSmallCss({ files: files, limit: opts.inlineCssLimit, siteDir: siteDir });

    return {
      files: inline.files,
      bundledAssets: conditional.bundled,
      copied: copied.copied,
      missing: conditional.missing.concat(copied.missing),
      inlined: inline.inlined,
      removed: inline.removed,
      warnings: warnings
    };
  }

  return {
    INLINE_CSS_LIMIT: INLINE_CSS_LIMIT,
    CONDITIONAL_ASSETS: CONDITIONAL_ASSETS,
    ASSET_MIME: ASSET_MIME,
    isAssetPath: isAssetPath,
    selectConditionalAssets: selectConditionalAssets,
    collectLocalRefs: collectLocalRefs,
    applyConditionalAssets: applyConditionalAssets,
    copyReferencedAssets: copyReferencedAssets,
    inlineSmallCss: inlineSmallCss,
    planAssets: planAssets
  };
}));
