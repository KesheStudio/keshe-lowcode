/* 低代码平台 · 导出压缩（F3 第④步）
 *
 * 浏览器与服务端共用：
 * - 默认压缩 HTML / CSS / JS，可显式关闭（界面开关与 CLI --no-minify）。
 * - 压缩后做等价校验（可解析、关键标记仍在），失败按文件降级为原内容并记警告。
 * - 每个压缩文件保留一行头部注释（产物名 / 构建时间 / 版本）。
 * - 第三方许可证注释不删（/*! 以及含 @license / Copyright / 许可证字样的注释）。
 *
 * 边界：本文件不读磁盘、不写 zip；调用方把已生成的文件传进来，拿回压缩后的副本与报告。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./export-bundle.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.ExportMinify = factory(root.LC.ExportBundle);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Bundle) {
  'use strict';

  if (!Bundle) throw new Error('LC.ExportMinify 依赖 shared/export-bundle.js，请先加载');

  var LICENSE_RE = /@license|@preserve|copyright|license|licensed|许可证|版权/mi;

  function isLicenseComment(text) {
    if (text.charAt(2) === '!') return true;
    return LICENSE_RE.test(text);
  }

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
        var comment = end === -1 ? source.slice(i) : source.slice(i, end + 2);
        if (isLicenseComment(comment)) out += comment + '\n';
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

  /* 逐字符处理并保留换行，避免 ASI 语义变化。 */
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
        if (ch === '\n') { line += 1; if (quote === '`') { protectedLine[line] = true; protectedLine[line - 1] = true; } }
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
        var lineEnd = source.indexOf('\n', i + 2);
        var lineComment = source.slice(i, lineEnd === -1 ? source.length : lineEnd);
        if (isLicenseComment(lineComment)) out += lineComment + '\n';
        i = lineEnd === -1 ? source.length : lineEnd;
        continue;
      }
      if (ch === '/' && source.charAt(i + 1) === '*') {
        var end = source.indexOf('*/', i + 2);
        var blockComment = end === -1 ? source.slice(i) : source.slice(i, end + 2);
        if (isLicenseComment(blockComment)) out += blockComment + '\n';
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
    }).filter(function (text, index) {
      if (protectedLine[index]) return true;
      return text !== '';
    }).join('\n');
  }

  /* 只有块级标签两侧的空白可以安全删除。像 <span>a</span> <span>b</span> 这种
     内联标签之间的空白是正文的一部分，删掉会把两个词粘在一起。 */
  var BLOCK_TAGS = 'html|head|body|div|section|article|header|footer|nav|main|aside|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|form|fieldset|figure|figcaption|p|h[1-6]|pre|script|style|link|meta|title|template|blockquote|dl|dt|dd|details|summary|address|hr|br';
  var BLOCK_BEFORE = new RegExp('\\s+(<\\/?(?:' + BLOCK_TAGS + ')\\b[^>]*>)', 'gi');
  var BLOCK_AFTER = new RegExp('(<\\/?(?:' + BLOCK_TAGS + ')\\b[^>]*>)\\s+', 'gi');
  var PRE_BLOCK = /(<pre\b[^>]*>)([\s\S]*?)(<\/pre>)/gi;
  var TEXTAREA_BLOCK = /(<textarea\b[^>]*>)([\s\S]*?)(<\/textarea>)/gi;

  function htmlMinify(html) {
    var source = String(html == null ? '' : html);
    /* pre/textarea 里的空白原样保留，先用占位符换出来，避免被下面的空白规则误伤。 */
    var protectedBlocks = [];
    source = source
      .replace(PRE_BLOCK, function (match) {
        protectedBlocks.push(match);
        return '\u0000LC_PRE_' + (protectedBlocks.length - 1) + '\u0000';
      })
      .replace(TEXTAREA_BLOCK, function (match) {
        protectedBlocks.push(match);
        return '\u0000LC_PRE_' + (protectedBlocks.length - 1) + '\u0000';
      });
    var compactScript = function (match, open, body, close) {
      if (!body || !body.trim()) return match;
      if (/\ssrc\s*=/i.test(open)) return match;
      var type = (open.match(/\stype\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      if (type && !/^(?:text\/javascript|application\/javascript|module)$/i.test(type)) return match;
      if (type === 'module') return match;
      var output = jsMinify(body);
      try {
        /* eslint-disable no-new-func */
        new Function(output);
      } catch (error) {
        return match;
      }
      return open + output + close;
    };
    var compactStyle = function (match, open, body, close) {
      if (!body || !body.trim()) return match;
      var output = cssMinify(body);
      return verifyCss(body, output) ? match : open + output + close;
    };
    /* 只删除块级标签两侧的空白：文本节点、内联标签之间的空格与代码块内容都保留。 */
    var output = source
      .replace(/<!--([\s\S]*?)-->/g, function (match) {
        return isLicenseComment(match) ? match : '';
      })
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, compactStyle)
      .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, compactScript)
      .replace(BLOCK_BEFORE, '$1')
      .replace(BLOCK_AFTER, '$1')
      .trim();
    return output.replace(/\u0000LC_PRE_(\d+)\u0000/g, function (match, index) {
      return protectedBlocks[Number(index)] || '';
    });
  }

  function shortTime(createdAt) {
    var text = String(createdAt || '');
    var match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    return match ? match[1] + 'Z' : text;
  }

  function bannerFor(kind, meta) {
    /* 一行以内的最短形式：产物名|构建时间|版本，不加空格。 */
    var text = [String((meta && meta.artifactId) || ''), shortTime(meta && meta.createdAt), String((meta && meta.version) || '')]
      .filter(function (part) { return part; }).join('|');
    if (kind === 'html') return '<!--' + text + '-->\n';
    return '/*' + text + '*/\n';
  }

  function withBanner(html, text, meta) {
    var banner = bannerFor('html', meta);
    if (/^<!doctype[^>]*>/i.test(html)) {
      return html.replace(/^(<!doctype[^>]*>)/i, '$1\n' + banner);
    }
    return banner + html;
  }

  function countOf(text, re) {
    var match = text.match(re);
    return match ? match.length : 0;
  }

  function checkHtml(html) {
    var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
    var regex = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
    var stack = [];
    var match;
    while ((match = regex.exec(html))) {
      var closing = match[1] === '/';
      var name = match[2].toLowerCase();
      var selfClosing = /\/\s*$/.test(match[3] || '');
      if (!closing && !selfClosing && (name === 'script' || name === 'style')) {
        var close = html.toLowerCase().indexOf('</' + name, regex.lastIndex);
        if (close === -1) return '<' + name + '> 没有闭合';
        regex.lastIndex = close + 2 + name.length;
        continue;
      }
      if (closing) {
        if (!stack.length || stack.pop() !== name) return '结束标签 </' + name + '> 不匹配';
        continue;
      }
      if (!VOID[name]) stack.push(name);
    }
    if (stack.length) return '<' + stack[stack.length - 1] + '> 没有闭合';
    return '';
  }

  function verifyHtml(original, output) {
    if (!output && original.trim()) return '压缩后为空';
    var reason = checkHtml(output);
    if (reason) return reason;
    if (countOf(original, /<script\b/gi) !== countOf(output, /<script\b/gi)) return 'script 标签数量变化';
    if (countOf(original, /<style\b/gi) !== countOf(output, /<style\b/gi)) return 'style 标签数量变化';
    if (countOf(original, /\sid\s*=\s*["']/gi) !== countOf(output, /\sid\s*=\s*["']/gi)) return 'id 属性数量变化';
    if (/^<!doctype/i.test(original) && !/^<!doctype/i.test(output)) return 'DOCTYPE 丢失';
    return '';
  }

  function verifyCss(original, output) {
    if (!output && original.trim()) return '压缩后为空';
    var depth = 0;
    var quote = null;
    for (var i = 0; i < output.length; i += 1) {
      var ch = output.charAt(i);
      if (quote) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      if (depth < 0) return '出现多余的 }';
    }
    if (quote) return '字符串引号没有闭合';
    if (depth > 0) return '缺少 ' + depth + ' 个 }';
    if (countOf(original, /\{/g) !== countOf(output, /\{/g)) return '规则块数量变化';
    return '';
  }

  function verifyJs(original, output) {
    if (!output && original.trim()) return '压缩后为空';
    try {
      /* 只做语法解析，不执行代码。 */
      /* eslint-disable no-new-func */
      new Function(output);
    } catch (error) {
      return '语法解析失败：' + (error && error.message ? error.message : '未知错误');
    }
    if (/use strict/.test(original) && !/use strict/.test(output)) return '"use strict" 标记丢失';
    if (countOf(original, /\bfunction\b/g) !== countOf(output, /\bfunction\b/g)) return 'function 数量变化';
    return '';
  }

  function extensionOf(path) {
    var match = String(path || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function isInsideSite(siteDir, path) {
    return !siteDir || path === siteDir || path.indexOf(siteDir + '/') === 0;
  }

  function isSkipped(path, opts) {
    var skip = opts.skipPaths || [];
    if (skip.indexOf(path) !== -1) return '第三方运行时';
    if (/(^|\/)vendor\//.test(path)) return 'vendor 目录';
    if (/\.min\.(?:js|css)$/i.test(path)) return '已压缩的第三方文件';
    return '';
  }

  /**
   * 对产物里的 HTML/CSS/JS 执行压缩。
   * input: { files, siteDir, enabled, artifactId, createdAt, version, title, skipPaths }
   * 返回 { files, report, warnings }；report 记录是否压缩、逐文件前后体积与节省量。
   */
  function applyMinify(input) {
    var opts = input || {};
    var siteDir = opts.siteDir == null ? 'web' : String(opts.siteDir);
    var files = {};
    Object.keys(opts.files || {}).forEach(function (path) { files[path] = opts.files[path]; });
    var warnings = [];
    var records = [];
    var skipped = [];
    var enabled = opts.enabled !== false;
    var htmlEnabled = opts.html === true;
    var meta = {
      title: opts.title || 'lowcode 产物',
      artifactId: opts.artifactId || '',
      createdAt: opts.createdAt || '',
      version: opts.version || ''
    };

    var before = 0;
    var after = 0;
    var byKind = { html: { count: 0, before: 0, after: 0, saved: 0 }, css: { count: 0, before: 0, after: 0, saved: 0 }, js: { count: 0, before: 0, after: 0, saved: 0 } };

    if (enabled) {
      Object.keys(files).forEach(function (path) {
        var kind = extensionOf(path);
        if (kind !== 'html' && kind !== 'htm' && kind !== 'css' && kind !== 'js') return;
        if (!isInsideSite(siteDir, path)) return;
        if ((kind === 'html' || kind === 'htm') && !htmlEnabled) {
          skipped.push({ path: path, reason: 'HTML 压缩默认关闭：实测 zip 体积反而更大' });
          return;
        }
        var skipReason = isSkipped(path, opts);
        if (skipReason) {
          skipped.push({ path: path, reason: skipReason });
          return;
        }
        var original = files[path];
        if (typeof original !== 'string') return;
        if (!original.trim()) return;

        var output = kind === 'css' ? cssMinify(original)
          : kind === 'js' ? jsMinify(original)
            : htmlMinify(original);
        output = kind === 'css' || kind === 'js' ? bannerFor('css', meta) + output : withBanner(output, null, meta);

        var reason = kind === 'css' ? verifyCss(original, output)
          : kind === 'js' ? verifyJs(original, output)
            : verifyHtml(original, output);
        if (reason) {
          warnings.push({
            code: 'LC_W_MINIFY_FALLBACK',
            message: path + ' 压缩后校验失败（' + reason + '），已保留未压缩内容'
          });
          skipped.push({ path: path, reason: '校验失败：' + reason });
          return;
        }

        var sizeBefore = Bundle.byteSize(original);
        var sizeAfter = Bundle.byteSize(output);
        files[path] = output;
        before += sizeBefore;
        after += sizeAfter;
        var kindKey = kind === 'htm' ? 'html' : kind;
        var bucket = byKind[kindKey] || (byKind[kindKey] = { count: 0, before: 0, after: 0, saved: 0 });
        bucket.count += 1;
        bucket.before += sizeBefore;
        bucket.after += sizeAfter;
        bucket.saved += sizeBefore - sizeAfter;
        records.push({
          path: path,
          kind: kind,
          before: sizeBefore,
          after: sizeAfter,
          saved: sizeBefore - sizeAfter
        });
      });
    }

    return {
      files: files,
      report: {
        enabled: enabled,
        html: htmlEnabled,
        applied: enabled && records.length > 0,
        files: records,
        byKind: byKind,
        skipped: skipped,
        before: before,
        after: after,
        saved: before - after
      },
      warnings: warnings
    };
  }

  return {
    LICENSE_PATTERN: LICENSE_RE,
    isLicenseComment: isLicenseComment,
    minifyCss: cssMinify,
    minifyJs: jsMinify,
    minifyHtml: htmlMinify,
    bannerFor: bannerFor,
    verifyHtml: verifyHtml,
    verifyCss: verifyCss,
    verifyJs: verifyJs,
    applyMinify: applyMinify
  };
}));
