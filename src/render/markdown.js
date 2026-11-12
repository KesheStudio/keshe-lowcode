/* 渲染核心 · 极简 Markdown
   只覆盖站点实际用到的语法：标题、段落、列表、表格、代码块、引用、分隔线、
   行内加粗/斜体/代码/链接。所有原始 HTML 一律转义，避免把正文当代码执行。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dom.js'));
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  var escapeHtml = R.escapeHtml;

  var SAFE_SCHEMES = { 'http:': 1, 'https:': 1, 'mailto:': 1, 'tel:': 1 };

  function unescapeEntities(value) {
    return String(value == null ? '' : value)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function safeUrl(url) {
    var text = unescapeEntities(String(url == null ? '' : url)).trim();
    if (!text) return null;
    if (text === '#') return '#';
    if (text.indexOf('//') === 0) return null;
    var scheme = text.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (scheme) {
      var name = scheme[1].toLowerCase() + ':';
      if (!SAFE_SCHEMES[name]) return null;
      return text;
    }
    // 相对路径只允许普通字符，挡掉换行与尖括号
    if (/[<>"\s]/.test(text)) return null;
    return text;
  }

  function inline(text) {
    var codes = [];
    var source = String(text == null ? '' : text);
    source = source.replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push(code);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    var out = escapeHtml(source);
    out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (whole, label, href) {
      var safe = safeUrl(href);
      if (!safe) return label;
      return '<a href="' + R.escapeAttr(safe) + '">' + label + '</a>';
    });
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, index) {
      return '<code>' + escapeHtml(codes[Number(index)] || '') + '</code>';
    });
    return out;
  }

  function isFenceStart(line) { return /^```/.test(line); }
  function isHeading(line) { return /^(#{1,6})\s+/.test(line); }
  function isDivider(line) { return /^\s*(?:-\s*){3,}$/.test(line) || /^\s*(?:_\s*){3,}$/.test(line); }
  function isUl(line) { return /^\s*[-*+]\s+/.test(line); }
  function isOl(line) { return /^\s*\d+\.\s+/.test(line); }
  function isQuote(line) { return /^\s*>\s?/.test(line); }

  function isTableSeparator(line) {
    var cells = splitTableRow(line);
    if (cells.length < 2) return false;
    return cells.every(function (cell) {
      return /^:?-{3,}:?$/.test(cell.trim());
    });
  }

  function isTableStart(lines, index) {
    if (!lines[index] || lines[index].indexOf('|') === -1) return false;
    return isTableSeparator(lines[index + 1] || '');
  }

  function splitTableRow(line) {
    var text = String(line == null ? '' : line).trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
    return text.split('|');
  }

  function renderTable(lines, index) {
    var head = splitTableRow(lines[index]);
    var rows = [];
    var i = index + 2;
    while (i < lines.length && lines[i].indexOf('|') !== -1 && !isFenceStart(lines[i])) {
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }
    var html = '<table><thead><tr>' + head.map(function (cell) {
      return '<th>' + inline(cell.trim()) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    html += rows.map(function (row) {
      return '<tr>' + row.map(function (cell) {
        return '<td>' + inline(cell.trim()) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    html += '</tbody></table>';
    return { html: html, next: i };
  }

  /* mermaid 块只输出占位结构：默认可直接显示原始代码，
     有渲染器时（opts.mermaid）可在渲染期直接把 SVG 交给导出层；
     浏览器预览则交给 interactions/mermaid 运行时按需升级。 */
  function mermaidBlock(code, opts) {
    var container = opts && opts.mermaid;
    var inlineSvg = '';
    var problem = null;

    if (container) {
      var result = null;
      try {
        result = typeof container === 'function'
          ? container(code, opts)
          : (container.render ? container.render(code, opts) : null);
      } catch (error) {
        result = { ok: false, message: error && error.message ? error.message : String(error), line: error && error.line };
      }
      if (typeof result === 'string') result = { ok: true, svg: result };
      if (result && result.ok && result.svg) {
        inlineSvg = String(result.svg);
      } else if (result) {
        problem = {
          message: result.message || '渲染失败',
          line: result.line || 1
        };
      }
    }

    var status = inlineSvg ? 'ready' : (problem ? 'error' : 'pending');
    var message = problem ? '第 ' + problem.line + ' 行：' + problem.message : '';
    return '<div class="lc-mermaid" data-lc-mermaid="true" data-lc-mermaid-status="' + status + '">' +
      '<pre class="lc-mermaid-source" data-lc-mermaid-source><code>' + escapeHtml(code) + '</code></pre>' +
      '<div class="lc-mermaid-canvas" data-lc-mermaid-canvas>' + inlineSvg + '</div>' +
      '<p class="lc-mermaid-error" data-lc-mermaid-error' + (problem ? '' : ' hidden') + '>' +
      escapeHtml(message) + '</p>' +
      '</div>';
  }

  function renderMarkdown(md, options) {
    var opts = options || {};
    var source = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    var lines = source.split('\n');
    var out = [];
    var index = 0;
    var headingIndex = 0;

    function flushParagraph(buffer) {
      if (!buffer.length) return;
      out.push('<p>' + inline(buffer.join(' ')) + '</p>');
      buffer.length = 0;
    }

    var paragraph = [];
    while (index < lines.length) {
      var line = lines[index];

      if (/^\s*$/.test(line)) {
        flushParagraph(paragraph);
        index += 1;
        continue;
      }

      if (isFenceStart(line)) {
        flushParagraph(paragraph);
        var lang = line.replace(/^```/,'').trim();
        var code = [];
        index += 1;
        while (index < lines.length && !isFenceStart(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        if (lang && /^mermaid\b/i.test(lang)) {
          out.push(mermaidBlock(code.join('\n'), opts));
          continue;
        }
        out.push('<pre><code' + (lang ? ' class="language-' + R.escapeAttr(lang) + '"' : '') + '>' +
          escapeHtml(code.join('\n')) + '</code></pre>');
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushParagraph(paragraph);
        var level = heading[1].length;
        var idAttr = '';
        if (opts.headingIds) {
          headingIndex += 1;
          idAttr = ' id="' + R.escapeAttr((opts.idPrefix || '') + 'section-' + headingIndex) + '"';
        }
        out.push('<h' + level + idAttr + '>' + inline(heading[2]) + '</h' + level + '>');
        index += 1;
        continue;
      }

      if (isDivider(line)) {
        flushParagraph(paragraph);
        out.push('<hr>');
        index += 1;
        continue;
      }

      if (isTableStart(lines, index)) {
        flushParagraph(paragraph);
        var table = renderTable(lines, index);
        out.push(table.html);
        index = table.next;
        continue;
      }

      if (isUl(line)) {
        flushParagraph(paragraph);
        var items = [];
        while (index < lines.length && isUl(lines[index])) {
          items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
          index += 1;
        }
        out.push('<ul>' + items.map(function (item) { return '<li>' + inline(item) + '</li>'; }).join('') + '</ul>');
        continue;
      }

      if (isOl(line)) {
        flushParagraph(paragraph);
        var ordered = [];
        while (index < lines.length && isOl(lines[index])) {
          ordered.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
          index += 1;
        }
        out.push('<ol>' + ordered.map(function (item) { return '<li>' + inline(item) + '</li>'; }).join('') + '</ol>');
        continue;
      }

      if (isQuote(line)) {
        flushParagraph(paragraph);
        var quoted = [];
        while (index < lines.length && isQuote(lines[index])) {
          quoted.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        out.push('<blockquote>' + renderMarkdown(quoted.join('\n'), {}) + '</blockquote>');
        continue;
      }

      // 普通段落：连续行合并，遇到空行或块级语法前先冲刷
      paragraph.push(line.trim());
      index += 1;
      if (index < lines.length) {
        var next = lines[index];
        if (/^\s*$/.test(next) || isFenceStart(next) || isHeading(next) || isDivider(next) ||
            isUl(next) || isOl(next) || isQuote(next) || isTableStart(lines, index)) {
          flushParagraph(paragraph);
        }
      }
    }
    flushParagraph(paragraph);
    return out.join('\n');
  }

  R.markdownToHtml = renderMarkdown;
  R.markdownInline = inline;
  R.safeUrl = safeUrl;

  return R;
}));
