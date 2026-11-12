/* 渲染核心 · 导出配合
   把渲染产物整理成可安全合并的 HTML / CSS / JS；默认压缩，可显式关闭。
   压缩策略是保守的：只去注释与多余空白，不做变量重命名、不改变换行语义、不动字符串与模板字面量。
   实例覆盖产生的编辑器字段不会进入产物；这里只输出运行时需要的内容。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dom.js'), require('./runtime.js'));
  } else {
    factory(root.LC.Render, root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R, runtimeApi) {
  'use strict';

  R = R || {};

  function cssMinify(css) {
    var source = String(css == null ? '' : css);
    var out = '';
    var quote = null;
    var i = 0;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (quote) {
        out += ch;
        if (ch === '\\') { out += source.charAt(i + 1); i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; out += ch; i += 1; continue; }
      if (ch === '/' && source.charAt(i + 1) === '*') {
        var end = source.indexOf('*/', i + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (/\s/.test(ch)) {
        var j = i + 1;
        while (j < source.length && /\s/.test(source.charAt(j))) j += 1;
        var prev = out.charAt(out.length - 1);
        var next = j < source.length ? source.charAt(j) : '';
        if (!prev || !next) { /* 首尾空白直接丢弃 */ }
        else if ('{};:,>'.indexOf(prev) !== -1 || '{};:,>'.indexOf(next) !== -1) { /* 标点旁空白丢弃 */ }
        else out += ' ';
        i = j;
        continue;
      }
      out += ch;
      i += 1;
    }
    return out.trim();
  }

  /* 逐字符处理，保留换行（避免 ASI 语义变化）；块注释两侧都是单词字符时补一个空格。 */
  function jsMinify(js) {
    var source = String(js == null ? '' : js);
    var out = '';
    var quote = null;
    var i = 0;
    var protectedLine = {};
    var line = 0;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (quote) {
        out += ch;
        if (ch === '\\') { out += source.charAt(i + 1); i += 2; continue; }
        if (ch === quote) quote = null;
        if (ch === '\n') { line += 1; if (quote === '`') protectedLine[line] = true; protectedLine[line - 1] = true; }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        out += ch;
        if (ch === '`') protectedLine[line] = true;
        i += 1;
        continue;
      }
      if (ch === '/' && source.charAt(i + 1) === '/') {
        while (i < source.length && source.charAt(i) !== '\n') i += 1;
        continue;
      }
      if (ch === '/' && source.charAt(i + 1) === '*') {
        var end = source.indexOf('*/', i + 2);
        i = end === -1 ? source.length : end + 2;
        var prev = out.charAt(out.length - 1);
        var next = source.charAt(i);
        if (/[\w$]/.test(prev) && /[\w$]/.test(next)) out += ' ';
        continue;
      }
      if (ch === '\n') {
        out += '\n';
        line += 1;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
    }
    return out.split('\n').map(function (text, index) {
      if (protectedLine[index]) return text;
      return text.replace(/^\s+|\s+$/g, '');
    }).filter(function (text, index, all) {
      if (protectedLine[index]) return true;
      return text !== '';
    }).join('\n');
  }

  /* 只有块级标签两侧的空白可以安全删除；内联标签之间的空格属于正文，删掉会粘连文本。 */
  var BLOCK_TAGS = 'html|head|body|div|section|article|header|footer|nav|main|aside|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|form|fieldset|figure|figcaption|p|h[1-6]|pre|script|style|link|meta|title|template|blockquote|dl|dt|dd|details|summary|address|hr|br';
  var BLOCK_BEFORE = new RegExp('\\s+(<\\/?(?:' + BLOCK_TAGS + ')\\b[^>]*>)', 'gi');
  var BLOCK_AFTER = new RegExp('(<\\/?(?:' + BLOCK_TAGS + ')\\b[^>]*>)\\s+', 'gi');

  function htmlMinify(html) {
    var source = String(html == null ? '' : html);
    /* pre/textarea 内的空白原样保留，先换占位符再压缩其余部分。 */
    var protectedBlocks = [];
    source = source
      .replace(/(<pre\b[^>]*>)([\s\S]*?)(<\/pre>)/gi, function (match) {
        protectedBlocks.push(match);
        return '\u0000LC_PRE_' + (protectedBlocks.length - 1) + '\u0000';
      })
      .replace(/(<textarea\b[^>]*>)([\s\S]*?)(<\/textarea>)/gi, function (match) {
        protectedBlocks.push(match);
        return '\u0000LC_PRE_' + (protectedBlocks.length - 1) + '\u0000';
      });
    var output = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(BLOCK_BEFORE, '$1')
      .replace(BLOCK_AFTER, '$1')
      .trim();
    return output.replace(/\u0000LC_PRE_(\d+)\u0000/g, function (match, index) {
      return protectedBlocks[Number(index)] || '';
    });
  }

  function scriptSelector(blockId, componentId) {
    var selector = '[data-lc-instance="' + String(blockId == null ? '' : blockId)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
    return selector;
  }

  function blockScript(item) {
    if (!item) return '';
    /* 全局脚本（内置组件浏览器包）不绑定某个区块，直接执行。 */
    if (item.global) {
      return '(function () {\n' +
        '  "use strict";\n' +
        '  try {\n' + String(item.source || '') + '\n' +
        '  } catch (e) {\n' +
        '    if (typeof console !== "undefined") console.error("[lc] 全局脚本出错", e);\n' +
        '  }\n' +
        '})();';
    }
    var selector = scriptSelector(item.blockId, item.componentId);
    var label = '[lc] 组件 ' + String(item.componentId == null ? '' : item.componentId) + ' 脚本出错';
    return '(function () {\n' +
      '  "use strict";\n' +
      '  var root = document.querySelector(' + JSON.stringify(selector) + ');\n' +
      '  if (!root) return;\n' +
      '  try {\n' + String(item.source || '') + '\n' +
      '  } catch (e) {\n' +
      '    if (typeof console !== "undefined") console.error(' + JSON.stringify(label) + ', e);\n' +
      '  }\n' +
      '})();';
  }

  function normalizeScripts(result) {
    if (!result) return [];
    if (Array.isArray(result.scripts)) {
      return result.scripts.map(blockScript).filter(Boolean);
    }
    return [];
  }

  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(text), 'utf8');
    return unescape(encodeURIComponent(String(text))).length;
  }

  /* 超过这个体积的数据岛改成外部 JSON；阈值以下继续内联，避免小表格多一次请求。 */
  var ISLAND_EXTERNAL_MIN = 32 * 1024;
  var ISLAND_RE = /<script type="application\/json" class="lc-ui-data">([\s\S]*?)<\/script>/g;

  function safeFileBase(value, fallback) {
    var text = String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return text || fallback;
  }

  /* 把大数组从 HTML 里搬到同目录的 data/*.json；HTML 只留 data-lc-src + data-lc-key。
     运行时读不到内联 JSON 时会 fetch 这个文件，并把同一个集合按 key 分给各实例。 */
  function externalizeIslands(html, pageId) {
    var islands = [];
    var dataName = 'data/' + safeFileBase(pageId, 'islands') + '.json';
    var replaced = String(html).replace(ISLAND_RE, function (match, json) {
      if (byteLength(json) < ISLAND_EXTERNAL_MIN) return match;
      var value;
      try { value = JSON.parse(json); } catch (error) { return match; }
      var key = 'island-' + (islands.length + 1);
      islands.push({ key: key, value: value, bytes: byteLength(json) });
      return '<script type="application/json" class="lc-ui-data" data-lc-src="' +
        dataName + '" data-lc-key="' + key + '"></script>';
    });
    if (!islands.length) return { html: replaced, data: null, name: null, rawBytes: 0 };
    var payload = {};
    var rawBytes = 0;
    islands.forEach(function (item) { payload[item.key] = item.value; rawBytes += item.bytes; });
    var content = JSON.stringify(payload);
    return {
      html: replaced,
      data: { name: dataName, content: content, bytes: byteLength(content), islands: islands.length, rawBytes: rawBytes },
      name: dataName,
      rawBytes: rawBytes
    };
  }

  var TRANSPORT_NOTE = '此导出包需要通过 HTTP 访问：直接双击打开（file://）时数据与交互不会工作。' +
    '需要双击运行，请改用 Tauri 打包导出。';

  /* file:// 下先给一句人话，避免用户只看到表格空壳还以为页面坏了。 */
  function transportNotice() {
    return '<script>(function(){if(typeof location==="undefined"||location.protocol!=="file:")return;' +
      'var box=document.createElement("div");box.setAttribute("role","alert");box.setAttribute("data-lc-transport-notice","true");' +
      'box.style.cssText="position:sticky;top:0;z-index:2147483647;padding:12px 16px;background:#fff3cd;color:#3d2b00;' +
      'border-bottom:1px solid #d9b44a;font:14px/1.6 -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif";' +
      'box.textContent=' + JSON.stringify(TRANSPORT_NOTE) + ';' +
      'if(document.body)document.body.insertBefore(box, document.body.firstChild);' +
      '})();<\/script>';
  }

  function injectTransportNotice(html) {
    var source = String(html == null ? '' : html);
    var note = transportNotice();
    if (/<body[^>]*>/i.test(source)) return source.replace(/<body[^>]*>/i, function (tag) { return tag + note; });
    return note + source;
  }

  function readmeText() {
    return [
      '此导出包需要通过 HTTP 访问（例如任意静态服务器）。',
      '直接双击 index.html（file://）时浏览器会拦截数据文件请求，表格与交互不会工作。',
      '需要双击运行，请改用 Tauri 打包导出。',
      ''
    ].join('\n');
  }

  /* createExportBundle(result, { minify:true|false, runtime:false|object, htmlOnly?, cssOnly?, jsOnly? })
     运行时与实例脚本合并成一个 runtime.js；大数据改成 data/*.json，由运行时 fetch 加载。 */
  function createExportBundle(result, options) {
    var opts = options || {};
    var minify = opts.minify !== false;
    var rawHtml = result && result.html != null ? String(result.html)
      : (result && result.node && R && typeof R.toHtml === 'function' ? R.toHtml(result.node) : '');
    var pageId = result && result.page && (result.page.id || result.page.slug);
    var external = opts.externalData === false
      ? { html: rawHtml, data: null, name: null, rawBytes: 0 }
      : externalizeIslands(rawHtml, pageId);
    var html = injectTransportNotice(external.html);
    var css = result && result.css != null ? String(result.css) : '';
    var buildRuntime = runtimeApi && typeof runtimeApi.buildRuntime === 'function' ? runtimeApi.buildRuntime : null;
    var runtime = null;
    if (opts.runtime !== false && buildRuntime) {
      var runtimeOptions = opts.runtimeOptions || {};
      ['theme', 'mode', 'themes', 'themeSwitch', 'articleSearch', 'sources', 'modules'].forEach(function (key) {
        if (opts[key] !== undefined && runtimeOptions[key] === undefined) runtimeOptions[key] = opts[key];
      });
      runtime = buildRuntime({
        html: html,
        site: result && result.site,
        page: result && result.page
      }, runtimeOptions);
    }
    var instanceJs = normalizeScripts(result).join('\n');
    var js = instanceJs;
    if (runtime) js = js ? js + '\n' + runtime.code : runtime.code;

    var raw = { html: html, css: css, js: js };
    var output = {
      html: minify ? htmlMinify(html) : html,
      css: minify ? cssMinify(css) : css,
      js: minify ? jsMinify(js) : js
    };

    var before = rawHtml.length + raw.css.length + raw.js.length;
    var after = output.html.length + output.css.length + output.js.length;
    var runtimeOut = runtime ? (minify ? jsMinify(runtime.code) : runtime.code) : '';
    var dataBytes = external.data ? external.data.bytes : 0;
    var files = [
      { name: 'index.html', content: output.html },
      { name: 'styles.css', content: output.css },
      { name: 'runtime.js', content: output.js }
    ];
    if (external.data) {
      files.push({ name: external.data.name, content: external.data.content, type: 'data' });
    }
    files.push({ name: 'README.txt', content: readmeText(), type: 'text' });

    return {
      minify: minify,
      html: output.html,
      css: output.css,
      js: output.js,
      data: external.data ? {
        name: external.data.name,
        bytes: dataBytes,
        islands: external.data.islands,
        rawBytes: external.data.rawBytes,
        content: opts.embedData === true ? external.data.content : null
      } : null,
      runtime: runtime ? {
        version: runtime.version,
        modules: runtime.modules,
        bytes: byteLength(runtimeOut),
        maxBytes: runtime.maxBytes,
        overCap: byteLength(runtimeOut) > runtime.maxBytes
      } : null,
      files: files,
      stats: {
        before: before,
        after: after,
        saved: before - after,
        htmlBeforeBytes: byteLength(rawHtml),
        htmlAfterBytes: byteLength(output.html),
        dataBytes: dataBytes,
        dataIslands: external.data ? external.data.islands : 0,
        transferAfter: after + dataBytes,
        runtimeBytes: runtime ? byteLength(runtimeOut) : 0,
        instanceBytes: byteLength(instanceJs)
      }
    };
  }

  var api = {
    minifyCss: cssMinify,
    minifyJs: jsMinify,
    compactHtml: htmlMinify,
    createExportBundle: createExportBundle,
    blockScript: blockScript
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.keys(api).forEach(function (key) { R[key] = api[key]; });

  return api;
}));
