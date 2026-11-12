/* 渲染核心 · Mermaid 图块
   渲染层不依赖 mermaid 包：内置一份轻量 SVG 渲染器，同时开放注册表让外部实现接入。
   - Markdown 只负责识别 ```mermaid 并输出占位结构，不触发生成；
   - 运行时 enhanceMermaid 先检查页面有没有图块，再按需加载渲染器（同页只加载一次）；
   - 单个块失败只影响该块：保留原始代码并给出行号，其余块继续；
   - SVG 一律经过消毒，禁止脚本、事件属性、外链资源；
   - 内置渲染器只输出 CSS 变量引用，配色随主题/明暗自动切换。
   纯函数（解析、消毒、注册表）可在 Node 侧直接使用，用于静态导出。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory({});
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var MERMAID_TYPES = {
    flowchart: 1, graph: 1, sequenceDiagram: 1, gantt: 1, classDiagram: 1
  };

  var MERMAID_CSS = [
    '.lc-mermaid { margin: var(--lc-space-5) 0; overflow-x: auto; }',
    '.lc-mermaid[data-lc-mermaid-status="ready"] .lc-mermaid-source { display: none; }',
    '.lc-mermaid-source { margin: 0; padding: var(--lc-space-3) var(--lc-space-3-5); overflow: auto; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-code-bg, #eeece3); color: var(--lc-color-ink-2, var(--ink, #222)); }',
    '.lc-mermaid-source code { font-family: var(--lc-font-mono); font-size: var(--lc-text-xs); line-height: 1.55; }',
    '.lc-mermaid-canvas { text-align: center; }',
    '.lc-mermaid-canvas svg { display: inline-block; max-width: 100%; height: auto; }',
    '.lc-mermaid-error { margin: var(--lc-space-2) 0 0; padding: var(--lc-space-2) var(--lc-space-2-5); border-left: 3px solid var(--lc-color-accent, var(--accent, #3e6a56)); background: var(--lc-color-surface-2, #f9f5ed); color: var(--lc-color-muted, #666); font-size: var(--lc-text-xs); }'
  ].join('\n');

  /* ---------- 基础工具 ---------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function syntaxError(message, line) {
    var error = new Error(message);
    error.line = Number(line) || 1;
    error.isMermaidSyntax = true;
    return error;
  }

  function splitLines(code) {
    return String(code == null ? '' : code).replace(/\r\n?/g, '\n').split('\n');
  }

  function firstKeyword(lines) {
    for (var i = 0; i < lines.length; i += 1) {
      var line = String(lines[i] || '').trim();
      if (line && line.indexOf('%%') !== 0) return { line: line, index: i + 1 };
    }
    return { line: '', index: 1 };
  }

  function diagramType(code) {
    var first = firstKeyword(splitLines(code));
    var keyword = first.line.split(/\s+/)[0];
    return MERMAID_TYPES[keyword] ? keyword : '';
  }

  /* ---------- SVG 消毒 ----------
     只保留结构/图形/文本标签；属性白名单 + 外链检查，脚本、事件、foreignObject
     和外部 href 全部剔除。输出统一是单个 <svg>，可直接 innerHTML 或静态导出。 */

  var ALLOWED_TAGS = {
    svg: 1, g: 1, defs: 1, marker: 1, path: 1, line: 1, rect: 1, circle: 1,
    ellipse: 1, polyline: 1, polygon: 1, text: 1, tspan: 1, title: 1, desc: 1,
    clippath: 1, symbol: 1, use: 1
  };

  var ALLOWED_ATTRS = {
    xmlns: 1, viewbox: 1, width: 1, height: 1, preserveaspectratio: 1, role: 1,
    'aria-label': 1, 'aria-hidden': 1, class: 1, id: 1, style: 1, transform: 1,
    x: 1, y: 1, x1: 1, y1: 1, x2: 1, y2: 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1,
    d: 1, points: 1, fill: 1, stroke: 1, 'stroke-width': 1, 'stroke-dasharray': 1,
    'stroke-linecap': 1, 'stroke-linejoin': 1, opacity: 1, 'fill-opacity': 1,
    'stroke-opacity': 1, 'font-size': 1, 'font-family': 1, 'font-weight': 1,
    'text-anchor': 1, 'dominant-baseline': 1, 'marker-end': 1, 'marker-start': 1,
    'marker-mid': 1, offset: 1, refx: 1, refy: 1, markerwidth: 1, markerheight: 1,
    markerunits: 1, orient: 1, 'clip-path': 1, 'text-decoration': 1, 'letter-spacing': 1,
    'white-space': 1, 'vector-effect': 1, 'stop-color': 1, 'stop-opacity': 1, 'xlink:href': 1, href: 1
  };

  function unsafeValue(name, value) {
    var text = String(value == null ? '' : value);
    if (/^\s*(javascript|data|vbscript|file):/i.test(text)) return true;
    if (/\bexpression\s*\(/i.test(text)) return true;
    if (/url\s*\(\s*(?!['"]?#)(?:['"]?)(?:javascript|data|http|https|ftp)[^)]*\)/i.test(text)) return true;
    if ((name === 'href' || name === 'xlink:href') && text.trim().charAt(0) !== '#') return true;
    if (name === 'style' && /(@import|url\s*\(\s*(?!['"]?#))/i.test(text)) return true;
    return false;
  }

  function sanitizeAttrs(raw) {
    var out = '';
    var attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    var match = attrRe.exec(raw);
    while (match) {
      var written = match[1];
      var name = written.toLowerCase();
      var value = match[3] != null ? match[3] : (match[4] != null ? match[4] : match[5]);
      match = attrRe.exec(raw);
      if (!ALLOWED_ATTRS[name]) continue;
      if (/^on/.test(name)) continue;
      if (unsafeValue(name, value)) continue;
      if (name === 'style' && /[<>]/.test(value)) continue;
      out += ' ' + written + '="' + esc(value) + '"';
    }
    return out;
  }

  function sanitizeSvg(input) {
    var source = String(input == null ? '' : input);
    var start = source.indexOf('<svg');
    var end = source.lastIndexOf('</svg>');
    if (start === -1 || end === -1 || end <= start) return '';

    var svg = source.slice(start, end + 6);
    svg = svg
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/?>/gi, '')
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<(iframe|object|embed|link|meta|base|audio|video|image|img)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<(iframe|object|embed|link|meta|base|audio|video|image|img)\b[^>]*\/?>/gi, '');

    svg = svg.replace(/<([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>/g, function (whole, tag, attrs, selfClose) {
      var lower = String(tag).toLowerCase();
      if (!ALLOWED_TAGS[lower]) return '';
      var isSelfClosing = !!selfClose || /\/\s*$/.test(attrs || '');
      var cleanAttrs = sanitizeAttrs(String(attrs || '').replace(/\/\s*$/, ''));
      return '<' + tag + cleanAttrs + (isSelfClosing ? ' />' : '>');
    });

    svg = svg.replace(/<\/([a-zA-Z][a-zA-Z0-9:-]*)>/g, function (whole, tag) {
      return ALLOWED_TAGS[String(tag).toLowerCase()] ? whole : '';
    });

    if (/javascript:|vbscript:/i.test(svg)) return '';
    return svg;
  }

  /* ---------- 渲染器注册表 ---------- */

  function resolveRenderer(input) {
    if (typeof input === 'function') return input;
    if (input && typeof input.render === 'function') return function (code, ctx) { return input.render(code, ctx); };
    return null;
  }

  function failResult(code, message, line) {
    return { ok: false, code: code || 'MERMAID_FAILED', message: message || '渲染失败', line: Number(line) || 1 };
  }

  function runRenderer(renderer, code, context) {
    if (typeof renderer !== 'function') return failResult('MERMAID_NO_RENDERER', '未注册 mermaid 渲染器，已降级为原始代码。', 1);
    var raw;
    try {
      raw = renderer(code, context || {});
    } catch (error) {
      return failResult('MERMAID_RENDER_FAILED', error && error.message ? error.message : String(error),
        error && error.line ? error.line : 1);
    }
    if (typeof raw === 'string') raw = { svg: raw };
    if (!raw || raw.ok === false) {
      return failResult(raw && raw.code, (raw && raw.message) || '渲染器返回失败。', raw && raw.line);
    }
    var safe = sanitizeSvg(raw.svg);
    if (!safe) return failResult('MERMAID_UNSAFE_SVG', 'SVG 为空或消毒后不合法。', raw.line || 1);
    return { ok: true, svg: safe, type: raw.type || '' };
  }

  function createMermaidRegistry() {
    var renderer = null;
    var loader = null;
    var loading = null;
    var stats = { renders: 0, loads: 0, failures: 0 };

    var api = {
      use: function (input) {
        renderer = resolveRenderer(input);
        return api;
      },
      setLoader: function (fn) {
        loader = typeof fn === 'function' ? fn : null;
        return api;
      },
      hasRenderer: function () { return typeof renderer === 'function'; },
      hasLoader: function () { return typeof loader === 'function'; },
      /* 同页多个块只会走到这里一次：loading 是共享的 Promise。 */
      load: function () {
        if (renderer) return Promise.resolve(renderer);
        if (!loader) return Promise.resolve(null);
        if (loading) return loading;
        stats.loads += 1;
        try {
          loading = Promise.resolve(loader()).then(function (resolved) {
            if (!renderer) renderer = resolveRenderer(resolved);
            return renderer;
          }, function () { return renderer; });
        } catch (error) {
          loading = Promise.resolve(renderer);
        }
        return loading;
      },
      render: function (code, context) {
        stats.renders += 1;
        var result = runRenderer(renderer, code, context);
        if (!result.ok) stats.failures += 1;
        return result;
      },
      renderAsync: function (code, context) {
        var self = this;
        return this.load().then(function () { return self.render(code, context); });
      },
      stats: function () {
        return { renders: stats.renders, loads: stats.loads, failures: stats.failures, loaded: !!renderer };
      }
    };
    return api;
  }

  /* ---------- 通用 SVG ---------- */

  var THEME = {
    ink: 'var(--lc-mermaid-label)',
    muted: 'var(--lc-color-muted)',
    line: 'var(--lc-mermaid-line)',
    nodeBg: 'var(--lc-mermaid-node-fill)',
    nodeStroke: 'var(--lc-mermaid-node-stroke)',
    noteFill: 'var(--lc-mermaid-note-fill)',
    labelBg: 'var(--lc-mermaid-label-bg)',
    accent: 'var(--lc-color-accent)',
    accentSoft: 'var(--lc-color-accent-soft)',
    font: 'var(--lc-font-sans)'
  };

  function textNode(x, y, value, extra) {
    var attrs = 'x="' + x + '" y="' + y + '" fill="' + THEME.ink + '" font-family="' + THEME.font + '" font-size="' + (extra && extra.size ? extra.size : 12) + '"';
    if (extra && extra.anchor) attrs += ' text-anchor="' + extra.anchor + '"';
    if (extra && extra.weight) attrs += ' font-weight="' + extra.weight + '"';
    if (extra && extra.fill) attrs = attrs.replace('fill="' + THEME.ink + '"', 'fill="' + extra.fill + '"');
    return '<text ' + attrs + '>' + esc(value) + '</text>';
  }

  function arrowDefs(id) {
    return '<defs><marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + THEME.line + '"/></marker></defs>';
  }

  function svgDocument(width, height, body, type) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="' + esc(type || 'mermaid') + ' 图表" class="lc-mermaid-svg">' +
      body + '</svg>';
  }

  function labelWidth(label, min, max) {
    var text = String(label == null ? '' : label);
    return Math.max(min || 88, Math.min(max || 220, text.length * 8 + 30));
  }

  /* ---------- flowchart / graph ---------- */

  var FLOW_OP_RE = /(-\.->|-->|---|==>)/g;
  var FLOW_NODE_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*(?:(\[\[|\[|\(\(|\(|\{)([\s\S]*?)(\]\]|\]|\)\)|\}|\))?)?$/;
  var svgSeq = 0;

  function cleanLabel(value) {
    var text = String(value == null ? '' : value).trim();
    if (/^"(.*)"$/.test(text) || /^'(.*)'$/.test(text)) text = text.slice(1, -1);
    return text.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseFlowNode(token, lineNo) {
    var text = String(token == null ? '' : token).trim();
    if (!text) throw syntaxError('连线缺少节点', lineNo);
    var match = text.match(FLOW_NODE_RE);
    if (!match) throw syntaxError('无法解析节点：' + text, lineNo);
    var open = match[2] || '';
    var close = match[4] || '';
    if (open && !close) throw syntaxError('节点括号没有闭合：' + text, lineNo);
    var label = cleanLabel(match[3]);
    var shape = 'rect';
    if (open === '{') shape = 'diamond';
    else if (open === '((') shape = 'stadium';
    else if (open === '(') shape = 'rounded';
    return { id: match[1], label: label || match[1], shape: shape, hasLabel: !!open };
  }

  function touchFlowNode(state, parsed) {
    var node = state.nodes[parsed.id];
    if (!node) {
      node = state.nodes[parsed.id] = {
        id: parsed.id,
        label: parsed.label || parsed.id,
        shape: parsed.shape || 'rect'
      };
      state.order.push(parsed.id);
    } else if (parsed.hasLabel) {
      node.label = parsed.label;
      node.shape = parsed.shape;
    }
    return node;
  }

  function splitFlowChain(statement) {
    var parts = [];
    var last = 0;
    FLOW_OP_RE.lastIndex = 0;
    var match = FLOW_OP_RE.exec(statement);
    while (match) {
      parts.push({ text: statement.slice(last, match.index), op: match[1] });
      last = match.index + match[1].length;
      match = FLOW_OP_RE.exec(statement);
    }
    if (!parts.length) return null;
    parts.push({ text: statement.slice(last), op: '' });
    return parts;
  }

  function parseFlowchart(code) {
    var lines = splitLines(code);
    var state = { nodes: {}, order: [], edges: [] };
    var direction = 'TB';
    var head = firstKeyword(lines);
    var headerMatch = head.line.match(/^(flowchart|graph)\s+(LR|RL|TD|TB|BT)\s*;?\s*$/i);
    if (!headerMatch) throw syntaxError('flowchart 缺少方向（TD/LR/RL/BT）', head.index);
    direction = headerMatch[2].toUpperCase() === 'TD' ? 'TB' : headerMatch[2].toUpperCase();

    for (var i = head.index; i < lines.length; i += 1) {
      var raw = String(lines[i] == null ? '' : lines[i]).trim();
      if (!raw || raw.indexOf('%%') === 0) continue;
      if (/^(subgraph|end|classDef|class\s|style\s|click\s|linkStyle\s|direction\s)/i.test(raw)) continue;
      if (/^(flowchart|graph)\s/i.test(raw)) continue;

      var statements = raw.split(';');
      for (var s = 0; s < statements.length; s += 1) {
        var statement = statements[s].trim();
        if (!statement) continue;
        var chain = splitFlowChain(statement);
        if (!chain) {
          touchFlowNode(state, parseFlowNode(statement, i + 1));
          continue;
        }
        var previousId = null;
        chain.forEach(function (part, index) {
          var text = part.text.trim();
          var label = '';
          var labelMatch = text.match(/^\|([^|]*)\|\s*([\s\S]*)$/);
          if (labelMatch) {
            label = labelMatch[1].trim();
            text = labelMatch[2].trim();
          }
          var parsed = parseFlowNode(text, i + 1);
          touchFlowNode(state, parsed);
          if (index > 0 && previousId) {
            state.edges.push({ from: previousId, to: parsed.id, label: label, op: chain[index - 1].op });
          }
          previousId = parsed.id;
        });
      }
    }

    if (!state.order.length) throw syntaxError('flowchart 没有节点', head.index);
    return { nodes: state.nodes, order: state.order, edges: state.edges, direction: direction };
  }

  function boxEdge(cx, cy, w, h, dx, dy) {
    var tx = dx ? (w / 2) / Math.abs(dx) : Infinity;
    var ty = dy ? (h / 2) / Math.abs(dy) : Infinity;
    var scale = Math.min(tx, ty);
    if (!isFinite(scale)) scale = 0;
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  function renderFlowchart(code) {
    var flow = parseFlowchart(code);
    var order = flow.order;
    var layer = {};
    order.forEach(function (id) { layer[id] = 0; });
    for (var pass = 0; pass < order.length; pass += 1) {
      var changed = false;
      flow.edges.forEach(function (edge) {
        if (!flow.nodes[edge.from] || !flow.nodes[edge.to]) return;
        var candidate = layer[edge.from] + 1;
        if (candidate <= order.length && layer[edge.to] < candidate) {
          layer[edge.to] = candidate;
          changed = true;
        }
      });
      if (!changed) break;
    }

    var groups = {};
    order.forEach(function (id) {
      var key = layer[id];
      if (!groups[key]) groups[key] = [];
      groups[key].push(id);
    });
    var layerKeys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
    var vertical = flow.direction === 'TB' || flow.direction === 'BT';

    order.forEach(function (id) {
      var node = flow.nodes[id];
      node.w = node.shape === 'diamond' ? labelWidth(node.label, 100, 230) + 24 : labelWidth(node.label, 92, 230);
      node.h = node.shape === 'diamond' ? 48 : 36;
    });

    var pad = 24;
    var rowGap = 34;
    var colGap = 46;
    var width = 0;
    var height = 0;
    var maxRowWidth = 0;
    var rowsTotal = 0;
    layerKeys.forEach(function (key) {
      var ids = groups[key];
      var rowWidth = 0;
      ids.forEach(function (id, index) {
        rowWidth += flow.nodes[id].w + (index ? colGap : 0);
      });
      if (rowWidth > maxRowWidth) maxRowWidth = rowWidth;
      rowsTotal += (ids.length ? flow.nodes[ids[0]].h : 0) + rowGap * (ids.length - 1);
    });

    if (vertical) {
      width = maxRowWidth + pad * 2;
      height = pad * 2 + rowsTotal + (layerKeys.length - 1) * 56;
      var yCursor = pad + 18;
      layerKeys.forEach(function (key, layerIndex) {
        var ids = groups[key];
        var rowWidth = 0;
        ids.forEach(function (id, index) {
          rowWidth += flow.nodes[id].w + (index ? colGap : 0);
        });
        var xCursor = (width - rowWidth) / 2;
        var rowHeight = 0;
        ids.forEach(function (id) {
          var node = flow.nodes[id];
          node.x = xCursor + node.w / 2;
          node.y = yCursor + node.h / 2;
          xCursor += node.w + colGap;
          if (node.h > rowHeight) rowHeight = node.h;
        });
        yCursor += rowHeight + 56;
      });
    } else {
      var maxColWidth = 0;
      order.forEach(function (id) {
        if (flow.nodes[id].w > maxColWidth) maxColWidth = flow.nodes[id].w;
      });
      var xCursor2 = pad + 18;
      var maxLayerHeight = 0;
      layerKeys.forEach(function (key) {
        var ids = groups[key];
        var heightOfLayer = ids.reduce(function (sum, id, index) {
          return sum + flow.nodes[id].h + (index ? rowGap : 0);
        }, 0);
        if (heightOfLayer > maxLayerHeight) maxLayerHeight = heightOfLayer;
      });
      layerKeys.forEach(function (key) {
        var ids = groups[key];
        var yCursor2 = pad;
        ids.forEach(function (id) {
          var node = flow.nodes[id];
          node.x = xCursor2 + node.w / 2;
          node.y = yCursor2 + node.h / 2;
          yCursor2 += node.h + rowGap;
        });
        xCursor2 += maxColWidth + 92;
      });
      width = xCursor2 - 92 + pad;
      height = pad * 2 + Math.max(120, maxLayerHeight);
    }

    width = Math.max(240, Math.round(width));
    height = Math.max(160, Math.round(height));
    svgSeq += 1;
    var markerId = 'lc-mermaid-arrow-' + svgSeq;
    var body = arrowDefs(markerId);

    flow.edges.forEach(function (edge) {
      var from = flow.nodes[edge.from];
      var to = flow.nodes[edge.to];
      if (!from || !to) return;
      var dx = to.x - from.x;
      var dy = to.y - from.y;
      if (!dx && !dy) return;
      var start = boxEdge(from.x, from.y, from.w, from.h, dx, dy);
      var end = boxEdge(to.x, to.y, to.w, to.h, -dx, -dy);
      var stroke = THEME.line;
      var dash = edge.op === '-.->' ? ' stroke-dasharray="6 4"' : '';
      var thick = edge.op === '==>' ? ' stroke-width="2.2"' : ' stroke-width="1.4"';
      body += '<line x1="' + round(start.x) + '" y1="' + round(start.y) + '" x2="' + round(end.x) +
        '" y2="' + round(end.y) + '" stroke="' + stroke + '"' + thick + dash + ' marker-end="url(#' + markerId + ')"/>';
      if (edge.label) {
        body += textNode(round((start.x + end.x) / 2), round((start.y + end.y) / 2 - 6), edge.label, {
          size: 11, anchor: 'middle', fill: THEME.muted
        });
      }
    });

    order.forEach(function (id) {
      var node = flow.nodes[id];
      var left = round(node.x - node.w / 2);
      var top = round(node.y - node.h / 2);
      if (node.shape === 'diamond') {
        body += '<polygon points="' + [node.x + ',' + top, round(left + node.w) + ',' + node.y,
          node.x + ',' + round(top + node.h), left + ',' + node.y].join(' ') +
          '" fill="' + THEME.nodeBg + '" stroke="' + THEME.nodeStroke + '" stroke-width="1.4"/>';
      } else {
        var rx = node.shape === 'stadium' || node.shape === 'rounded' ? node.h / 2 : 4;
        body += '<rect x="' + left + '" y="' + top + '" width="' + round(node.w) + '" height="' + node.h +
          '" rx="' + rx + '" fill="' + THEME.nodeBg + '" stroke="' + THEME.nodeStroke + '" stroke-width="1.4"/>';
      }
      body += textNode(node.x, node.y + 4, node.label, { anchor: 'middle', size: 12 });
    });

    return { ok: true, svg: svgDocument(width, height, body, 'flowchart'), type: 'flowchart' };
  }

  function round(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  /* ---------- sequenceDiagram ---------- */

  function renderSequence(code) {
    var lines = splitLines(code);
    var participants = {};
    var order = [];
    var events = [];
    var title = '';
    var head = firstKeyword(lines);

    function ensureParticipant(id, label) {
      if (!participants[id]) {
        participants[id] = { id: id, label: label || id };
        order.push(id);
      } else if (label) {
        participants[id].label = label;
      }
    }

    for (var i = head.index - 1; i < lines.length; i += 1) {
      var raw = String(lines[i] == null ? '' : lines[i]).trim();
      if (!raw || raw.indexOf('%%') === 0) continue;
      if (/^sequenceDiagram\b/i.test(raw)) continue;
      if (/^title\s+/i.test(raw)) { title = raw.replace(/^title\s+/i, ''); continue; }
      if (/^(autonumber|hide footbox)\b/i.test(raw)) continue;

      var participant = raw.match(/^(participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i);
      if (participant) {
        ensureParticipant(participant[2], cleanLabel(participant[3]));
        continue;
      }

      var message = raw.match(/^([A-Za-z0-9_.-]+)\s*(-->>|->>|-->|->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (message) {
        ensureParticipant(message[1]);
        ensureParticipant(message[3]);
        events.push({
          kind: 'message', from: message[1], to: message[3],
          text: cleanLabel(message[4]), dashed: message[2].indexOf('--') === 0
        });
        continue;
      }

      var note = raw.match(/^Note\s+(left of|right of|over)\s+([A-Za-z0-9_.-]+)(?:\s*,\s*([A-Za-z0-9_.-]+))?\s*:\s*(.*)$/i);
      if (note) {
        ensureParticipant(note[2]);
        if (note[3]) ensureParticipant(note[3]);
        events.push({ kind: 'note', place: note[1].toLowerCase(), from: note[2], to: note[3] || note[2], text: cleanLabel(note[4]) });
        continue;
      }

      var band = raw.match(/^(loop|alt|opt|par|critical|else)\s+([\s\S]+)$/i);
      if (band) { events.push({ kind: 'band', text: cleanLabel(band[1] + ' ' + band[2]) }); continue; }
      if (/^(end|activate|deactivate|destroy|create)\b/i.test(raw)) continue;
      throw syntaxError('无法解析时序图语句：' + raw, i + 1);
    }

    if (!order.length) throw syntaxError('时序图没有参与者', 2);

    var gap = 28;
    var widths = order.map(function (id) { return Math.max(118, participants[id].label.length * 8 + 36); });
    var xs = [];
    var cursor = 24;
    widths.forEach(function (width, index) {
      var center = cursor + width / 2;
      xs[index] = { x: center, w: width };
      cursor += width + gap;
    });
    var width = cursor - gap + 24;
    var y = 76;
    var rows = [];
    events.forEach(function (event) {
      var rowHeight = event.kind === 'message' ? 44 : (event.kind === 'note' ? 52 : 34);
      rows.push({ event: event, y: y });
      y += rowHeight;
    });
    var height = Math.max(160, y + 20);
    var centerOf = {};
    order.forEach(function (id, index) {
      centerOf[id] = xs[index].x;
    });

    svgSeq += 1;
    var markerId = 'lc-mermaid-seq-' + svgSeq;
    var body = arrowDefs(markerId);
    var top = 22;
    var lifelineTop = top + 34;

    order.forEach(function (id, index) {
      var info = xs[index];
      var boxHeight = 34;
      body += '<rect x="' + round(info.x - info.w / 2) + '" y="' + top + '" width="' + round(info.w) + '" height="' + boxHeight +
        '" rx="5" fill="' + THEME.labelBg + '" stroke="' + THEME.nodeStroke + '" stroke-width="1.4"/>';
      body += textNode(info.x, top + 22, participants[id].label, { anchor: 'middle', size: 12, weight: 600 });
      body += '<line x1="' + round(info.x) + '" y1="' + lifelineTop + '" x2="' + round(info.x) + '" y2="' + (height - 18) +
        '" stroke="' + THEME.line + '" stroke-width="1" stroke-dasharray="5 5"/>';
    });

    rows.forEach(function (row) {
      var event = row.event;
      var rowY = row.y;
      if (event.kind === 'message') {
        var x1 = centerOf[event.from];
        var x2 = centerOf[event.to];
        var dashed = event.dashed ? ' stroke-dasharray="6 4"' : '';
        if (x1 === x2) {
          body += '<line x1="' + round(x1) + '" y1="' + rowY + '" x2="' + round(x1 + 46) + '" y2="' + rowY +
            '" stroke="' + THEME.line + '" stroke-width="1.4"' + dashed + '/>';
          body += '<line x1="' + round(x1 + 46) + '" y1="' + rowY + '" x2="' + round(x1 + 46) + '" y2="' + (rowY + 16) +
            '" stroke="' + THEME.line + '" stroke-width="1.4"' + dashed + '/>';
          body += '<line x1="' + round(x1 + 46) + '" y1="' + (rowY + 16) + '" x2="' + round(x1) + '" y2="' + (rowY + 16) +
            '" stroke="' + THEME.line + '" stroke-width="1.4"' + dashed + ' marker-end="url(#' + markerId + ')"/>';
          body += textNode(round(x1 + 23), rowY - 6, event.text, { anchor: 'middle', size: 11 });
        } else {
          body += '<line x1="' + round(x1) + '" y1="' + rowY + '" x2="' + round(x2) + '" y2="' + rowY +
            '" stroke="' + THEME.line + '" stroke-width="1.4"' + dashed + ' marker-end="url(#' + markerId + ')"/>';
          body += textNode(round((x1 + x2) / 2), rowY - 8, event.text, { anchor: 'middle', size: 11 });
        }
      } else if (event.kind === 'note') {
        var leftX = Math.min(centerOf[event.from], centerOf[event.to]);
        var rightX = Math.max(centerOf[event.from], centerOf[event.to]);
        var noteWidth = Math.max(160, Math.min(width - 48, event.text.length * 7 + 28));
        var centerX = event.place === 'left of' ? leftX - 20 : (event.place === 'right of' ? rightX + 20 : (leftX + rightX) / 2);
        var noteLeft = Math.max(12, centerX - noteWidth / 2);
        body += '<rect x="' + round(noteLeft) + '" y="' + (rowY - 12) + '" width="' + round(noteWidth) + '" height="26" rx="3" fill="' +
          THEME.noteFill + '" stroke="' + THEME.nodeStroke + '" stroke-width="1"/>';
        body += textNode(noteLeft + noteWidth / 2, rowY + 6, event.text, { anchor: 'middle', size: 11 });
      } else if (event.kind === 'band') {
        body += '<rect x="12" y="' + (rowY - 10) + '" width="' + round(width - 24) + '" height="24" rx="3" fill="' +
          THEME.noteFill + '" opacity="0.5"/>';
        body += textNode(20, rowY + 6, event.text, { size: 11, fill: THEME.accent, weight: 600 });
      }
    });

    if (title) body = textNode(width / 2, 14, title, { anchor: 'middle', size: 13, weight: 600 }) + body;
    return { ok: true, svg: svgDocument(Math.max(320, round(width)), Math.max(180, round(height)), body, 'sequenceDiagram'), type: 'sequenceDiagram' };
  }

  /* ---------- gantt ---------- */

  function parseGanttDate(value, context, lineNo) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    var absolute = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (absolute) return Date.UTC(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]));
    if (/^after\s+/i.test(text)) {
      var afterId = text.replace(/^after\s+/i, '').trim();
      var after = context.byId[afterId];
      if (!after) throw syntaxError('after 引用了未知任务：' + afterId, lineNo);
      return after.end;
    }
    if (/^today$/i.test(text)) {
      var now = new Date();
      return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    }
    return null;
  }

  function parseDurationMs(value) {
    var match = String(value == null ? '' : value).trim().match(/^(\d+(?:\.\d+)?)\s*([dhw])$/i);
    if (!match) return null;
    var amount = parseFloat(match[1]);
    var unit = match[2].toLowerCase();
    if (unit === 'h') return amount * 3600000;
    if (unit === 'w') return amount * 7 * 86400000;
    return amount * 86400000;
  }

  function renderGantt(code) {
    var lines = splitLines(code);
    var rows = [];
    var byId = {};
    var title = '';
    var head = firstKeyword(lines);

    for (var i = head.index - 1; i < lines.length; i += 1) {
      var raw = String(lines[i] == null ? '' : lines[i]).trim();
      if (!raw || raw.indexOf('%%') === 0) continue;
      if (/^gantt\b/i.test(raw)) continue;
      if (/^(dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker)\b/i.test(raw)) continue;
      if (/^title\s+/i.test(raw)) { title = raw.replace(/^title\s+/i, ''); continue; }
      var section = raw.match(/^section\s+(.+)$/i);
      if (section) { rows.push({ kind: 'section', label: cleanLabel(section[1]) }); continue; }

      var colon = raw.indexOf(':');
      if (colon === -1) throw syntaxError('甘特任务缺少“:”分隔：' + raw, i + 1);
      var name = cleanLabel(raw.slice(0, colon));
      var parts = raw.slice(colon + 1).split(',').map(function (item) { return item.trim(); }).filter(Boolean);
      var flags = parts.filter(function (item) { return /^(done|active|crit|milestone)$/i.test(item); });
      var values = parts.filter(function (item) { return !/^(done|active|crit|milestone)$/i.test(item); });

      var start = null;
      var end = null;
      if (values.length >= 2) {
        start = parseGanttDate(values[values.length - 2], { byId: byId }, i + 1);
        end = parseGanttDate(values[values.length - 1], { byId: byId }, i + 1);
        if (end == null) {
          var duration = parseDurationMs(values[values.length - 1]);
          if (duration == null) throw syntaxError('无法识别的结束时间或工期：' + values[values.length - 1], i + 1);
          end = start == null ? null : start + duration;
        }
      } else if (values.length === 1) {
        var durationOnly = parseDurationMs(values[0]);
        if (durationOnly != null) {
          var prevEnd = rows.length ? lastTaskEnd(rows) : Date.UTC(new Date().getFullYear(), 0, 1);
          start = prevEnd;
          end = start + durationOnly;
        } else {
          start = parseGanttDate(values[0], { byId: byId }, i + 1);
          if (start == null) throw syntaxError('无法识别的开始时间：' + values[0], i + 1);
          end = start + 86400000;
        }
      } else {
        start = rows.length ? lastTaskEnd(rows) : Date.UTC(new Date().getFullYear(), 0, 1);
        end = start + 86400000;
      }
      if (start == null) throw syntaxError('任务“' + name + '”缺少开始时间', i + 1);
      if (end == null || end <= start) end = start + 86400000;

      var task = {
        kind: 'task', name: name, start: start, end: end,
        milestone: flags.some(function (flag) { return /milestone/i.test(flag); })
      };
      rows.push(task);
      if (name) byId[name] = task;
    }

    var tasks = rows.filter(function (row) { return row.kind === 'task'; });
    if (!tasks.length) throw syntaxError('甘特图没有任务', head.index);

    var min = tasks[0].start;
    var max = tasks[0].end;
    tasks.forEach(function (task) {
      if (task.start < min) min = task.start;
      if (task.end > max) max = task.end;
    });
    if (max - min < 86400000) max = min + 86400000;

    var left = 190;
    var chartWidth = 560;
    var rowHeight = 30;
    var sectionHeight = 26;
    var top = title ? 46 : 28;
    var y = top;
    var body = '';
    var renderedRows = [];

    rows.forEach(function (row) {
      if (row.kind === 'section') {
        renderedRows.push({ row: row, y: y });
        y += sectionHeight;
      } else {
        renderedRows.push({ row: row, y: y });
        y += rowHeight;
      }
    });

    var chartTop = top;
    var chartBottom = y;
    var scale = (chartWidth) / (max - min);
    var ticks = 5;
    var axis = '';
    for (var t = 0; t <= ticks; t += 1) {
      var ms = min + (max - min) * (t / ticks);
      var xx = left + (ms - min) * scale;
      axis += '<line x1="' + round(xx) + '" y1="' + chartTop + '" x2="' + round(xx) + '" y2="' + round(chartBottom) +
        '" stroke="' + THEME.line + '" stroke-width="0.6" opacity="0.5"/>';
      axis += textNode(round(xx), chartBottom + 18, formatDay(ms), { size: 10, anchor: 'middle', fill: THEME.muted });
    }

    body += axis;
    renderedRows.forEach(function (item) {
      var row = item.row;
      if (row.kind === 'section') {
        body += '<rect x="12" y="' + (item.y - 4) + '" width="' + round(left + chartWidth + 12) + '" height="' + (sectionHeight - 6) +
          '" fill="' + THEME.accentSoft + '" opacity="0.35"/>';
        body += textNode(16, item.y + 12, row.label, { size: 12, weight: 600, fill: THEME.accent });
        return;
      }
      body += textNode(16, item.y + 18, row.name, { size: 11 });
      var barX = left + (row.start - min) * scale;
      var barW = Math.max(6, (row.end - row.start) * scale);
      if (row.milestone) {
        body += '<polygon points="' + [round(barX) + ',' + (item.y + 6), round(barX + 8) + ',' + (item.y + 14),
          round(barX) + ',' + (item.y + 22), round(barX - 8) + ',' + (item.y + 14)].join(' ') +
          '" fill="' + THEME.accent + '"/>';
      } else {
        body += '<rect x="' + round(barX) + '" y="' + (item.y + 6) + '" width="' + round(barW) + '" height="16" rx="4" fill="' +
          THEME.accentSoft + '" stroke="' + THEME.accent + '" stroke-width="1"/>';
      }
    });

    var width = left + chartWidth + 24;
    var height = chartBottom + 34;
    if (title) body = textNode(width / 2, 22, title, { anchor: 'middle', size: 13, weight: 600 }) + body;
    return { ok: true, svg: svgDocument(Math.round(width), Math.round(height), body, 'gantt'), type: 'gantt' };
  }

  function lastTaskEnd(rows) {
    for (var i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].kind === 'task') return rows[i].end;
    }
    return Date.UTC(new Date().getFullYear(), 0, 1);
  }

  function formatDay(ms) {
    var date = new Date(ms);
    var month = date.getUTCMonth() + 1;
    var day = date.getUTCDate();
    return (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
  }

  /* ---------- classDiagram ---------- */

  function renderClassDiagram(code) {
    var lines = splitLines(code);
    var classes = {};
    var order = [];
    var relations = [];
    var head = firstKeyword(lines);

    function ensureClass(name) {
      var id = String(name || '').trim();
      if (!id) return null;
      if (!classes[id]) {
        classes[id] = { id: id, members: [] };
        order.push(id);
      }
      return classes[id];
    }

    for (var i = head.index; i < lines.length; i += 1) {
      var raw = String(lines[i] == null ? '' : lines[i]).trim();
      if (!raw || raw.indexOf('%%') === 0) continue;
      if (/^classDiagram\b/i.test(raw)) continue;

      var classStart = raw.match(/^class\s+([A-Za-z0-9_.-]+)(?:\s*\{)?\s*$/);
      if (classStart) {
        var current = ensureClass(classStart[1]);
        if (raw.indexOf('{') !== -1) {
          i += 1;
          while (i < lines.length && String(lines[i]).trim() !== '}') {
            var member = String(lines[i]).trim();
            if (member && member.indexOf('%%') !== 0) current.members.push(member);
            i += 1;
          }
        }
        continue;
      }

      var relation = raw.match(/^([A-Za-z0-9_.-]+)\s*([<|*o.]*(?:[-.]{1,3})[>|*o.]*)\s*([A-Za-z0-9_.-]+)(?:\s*:\s*(.+))?$/);
      if (relation) {
        ensureClass(relation[1]);
        ensureClass(relation[3]);
        relations.push({ from: relation[1], to: relation[3], op: relation[2], label: cleanLabel(relation[4]) });
        continue;
      }
      if (/^note\s+/i.test(raw)) continue;
      throw syntaxError('无法解析类图语句：' + raw, i + 1);
    }

    if (!order.length) throw syntaxError('类图没有类', head.index);

    var columns = order.length <= 2 ? order.length : Math.min(3, Math.ceil(Math.sqrt(order.length)));
    var gapX = 46;
    var cellWidth = 0;
    var maxBoxHeight = 0;
    order.forEach(function (id) {
      var item = classes[id];
      var longest = item.id.length;
      item.members.forEach(function (member) {
        if (member.length > longest) longest = member.length;
      });
      item.w = Math.max(120, Math.min(240, longest * 7.2 + 32));
      item.h = 32 + item.members.length * 17 + 10;
      if (item.w > cellWidth) cellWidth = item.w;
      if (item.h > maxBoxHeight) maxBoxHeight = item.h;
    });

    var pad = 24;
    var rowPitch = maxBoxHeight + 42;
    var rowsCount = Math.ceil(order.length / columns);
    order.forEach(function (id, index) {
      var item = classes[id];
      var col = index % columns;
      var row = Math.floor(index / columns);
      item.x = pad + col * (cellWidth + gapX) + cellWidth / 2;
      item.y = pad + row * rowPitch + item.h / 2;
    });

    var width = pad * 2 + columns * cellWidth + (columns - 1) * gapX;
    var height = pad * 2 + rowsCount * rowPitch + 20;
    var markerId = 'lc-mermaid-class-' + (svgSeq += 1);
    var body = arrowDefs(markerId);

    relations.forEach(function (relation) {
      var from = classes[relation.from];
      var to = classes[relation.to];
      if (!from || !to) return;
      var dx = to.x - from.x;
      var dy = to.y - from.y;
      if (!dx && !dy) return;
      var start = boxEdge(from.x, from.y, from.w, from.h, dx, dy);
      var end = boxEdge(to.x, to.y, to.w, to.h, -dx, -dy);
      var dash = /\./.test(relation.op) ? ' stroke-dasharray="6 4"' : '';
      body += '<line x1="' + round(start.x) + '" y1="' + round(start.y) + '" x2="' + round(end.x) + '" y2="' + round(end.y) +
        '" stroke="' + THEME.line + '" stroke-width="1.4"' + dash + ' marker-end="url(#' + markerId + ')"/>';
      if (relation.label) {
        body += textNode(round((start.x + end.x) / 2), round((start.y + end.y) / 2 - 5), relation.label, {
          size: 10, anchor: 'middle', fill: THEME.muted
        });
      }
    });

    order.forEach(function (id) {
      var item = classes[id];
      var left = round(item.x - item.w / 2);
      var top = round(item.y - item.h / 2);
      body += '<rect x="' + left + '" y="' + top + '" width="' + round(item.w) + '" height="' + round(item.h) +
        '" rx="4" fill="' + THEME.nodeBg + '" stroke="' + THEME.nodeStroke + '" stroke-width="1.4"/>';
      body += textNode(item.x, top + 20, item.id, { anchor: 'middle', size: 12, weight: 600 });
      body += '<line x1="' + left + '" y1="' + (top + 28) + '" x2="' + round(left + item.w) + '" y2="' + (top + 28) +
        '" stroke="' + THEME.line + '" stroke-width="0.8"/>';
      item.members.forEach(function (member, index) {
        body += textNode(left + 10, top + 46 + index * 17, member, { size: 10, fill: THEME.muted });
      });
    });

    return { ok: true, svg: svgDocument(Math.round(width), Math.round(height), body, 'classDiagram'), type: 'classDiagram' };
  }

  /* ---------- 内置渲染器入口 ---------- */

  function renderMermaidBuiltin(code) {
    var type = diagramType(code);
    if (!type) {
      var head = firstKeyword(splitLines(code));
      return {
        ok: false, code: 'MERMAID_UNSUPPORTED',
        message: '不支持的图表类型：' + (head.line ? head.line.split(/\s+/)[0] : '(空)'),
        line: head.index
      };
    }
    try {
      if (type === 'flowchart' || type === 'graph') return renderFlowchart(code);
      if (type === 'sequenceDiagram') return renderSequence(code);
      if (type === 'gantt') return renderGantt(code);
      if (type === 'classDiagram') return renderClassDiagram(code);
      return { ok: false, code: 'MERMAID_UNSUPPORTED', message: '暂不支持：' + type, line: head.index };
    } catch (error) {
      if (error && error.isMermaidSyntax) {
        return { ok: false, code: 'MERMAID_SYNTAX', message: error.message, line: error.line };
      }
      return { ok: false, code: 'MERMAID_RENDER_FAILED', message: error && error.message ? error.message : String(error), line: (error && error.line) || 1 };
    }
  }

  function renderMermaidSvg(code, options) {
    var opts = options || {};
    var renderer = opts.renderer ? resolveRenderer(opts.renderer) : renderMermaidBuiltin;
    return runRenderer(renderer, code, opts.context || {});
  }

  /* ---------- 浏览器运行时：按需加载 + 逐块降级 ---------- */

  var defaultRegistry = null;

  function getDefaultMermaidRegistry() {
    if (!defaultRegistry) defaultRegistry = createMermaidRegistry();
    return defaultRegistry;
  }

  function collectMermaidBlocks(pageRoot) {
    if (!pageRoot || typeof pageRoot.querySelectorAll !== 'function') return [];
    return Array.prototype.slice.call(pageRoot.querySelectorAll('[data-lc-mermaid="true"]'));
  }

  function injectMermaidCss(doc) {
    if (!doc || !doc.head || doc.querySelector('style[data-lc-mermaid]')) return;
    var style = doc.createElement('style');
    style.setAttribute('data-lc-mermaid', 'css');
    style.textContent = MERMAID_CSS;
    doc.head.appendChild(style);
  }

  function readThemeContext(pageRoot, doc) {
    var host = pageRoot.querySelector('.lc-page') || pageRoot;
    var mode = host && host.getAttribute ? (host.getAttribute('data-lc-mode') || 'light') : 'light';
    var theme = host && host.getAttribute ? (host.getAttribute('data-lc-theme') || '') : '';
    var variables = {};
    var win = doc && doc.defaultView;
    if (win && win.getComputedStyle && host) {
      var names = ['--lc-color-bg', '--lc-color-surface', '--lc-color-surface-2', '--lc-color-ink',
        '--lc-color-ink-2', '--lc-color-muted', '--lc-color-line', '--lc-color-line-strong',
        '--lc-color-accent', '--lc-color-accent-soft', '--lc-color-code-bg'];
      var computed = win.getComputedStyle(host);
      names.forEach(function (name) {
        var value = computed.getPropertyValue(name);
        if (value) variables[name] = value.trim();
      });
    }
    return { mode: mode, theme: theme, variables: variables };
  }

  function applyMermaidResult(block, result) {
    var canvas = block.querySelector('[data-lc-mermaid-canvas]');
    var errorBox = block.querySelector('[data-lc-mermaid-error]');
    if (result && result.ok) {
      if (canvas) canvas.innerHTML = result.svg;
      block.setAttribute('data-lc-mermaid-status', 'ready');
      if (errorBox) {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
      return true;
    }
    if (canvas) canvas.innerHTML = '';
    if (result && result.code === 'MERMAID_NO_RENDERER') {
      block.setAttribute('data-lc-mermaid-status', 'fallback');
      if (errorBox) errorBox.hidden = true;
      return false;
    }
    block.setAttribute('data-lc-mermaid-status', 'error');
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = '第 ' + (result && result.line ? result.line : 1) + ' 行：' +
        (result && result.message ? result.message : '渲染失败');
    }
    return false;
  }

  /* 页面里没有图块时提前返回，绝不触发 loader。 */
  function enhanceMermaid(pageRoot, options) {
    var opts = options || {};
    var blocks = collectMermaidBlocks(pageRoot);
    if (!blocks.length) return { total: 0, rendered: 0, failed: 0, loaded: false };

    var doc = pageRoot.ownerDocument;
    if (!doc) return { total: blocks.length, rendered: 0, failed: 0, loaded: false };
    injectMermaidCss(doc);

    var registry = opts.registry || getDefaultMermaidRegistry();
    var context = typeof opts.context === 'object' && opts.context
      ? opts.context
      : readThemeContext(pageRoot, doc);

    function runAll() {
      var summary = { total: blocks.length, rendered: 0, failed: 0, loaded: false };
      blocks.forEach(function (block) {
        var source = block.querySelector('[data-lc-mermaid-source]');
        var code = source ? source.textContent : '';
        var result = registry.render(code, context);
        if (applyMermaidResult(block, result)) summary.rendered += 1;
        else summary.failed += 1;
      });
      return summary;
    }

    if (registry.hasRenderer && registry.hasRenderer()) {
      return runAll();
    }
    if (registry.hasLoader && registry.hasLoader()) {
      var pending = { total: blocks.length, rendered: 0, failed: 0, loaded: true, pending: true };
      registry.load().then(function (renderer) {
        if (!renderer) {
          blocks.forEach(function (block) { applyMermaidResult(block, failResult('MERMAID_NO_RENDERER')); });
          return;
        }
        runAll();
      });
      return pending;
    }

    blocks.forEach(function (block) { applyMermaidResult(block, failResult('MERMAID_NO_RENDERER')); });
    return { total: blocks.length, rendered: 0, failed: blocks.length, loaded: false };
  }

  R.mermaidCss = function () { return MERMAID_CSS; };
  R.sanitizeSvg = sanitizeSvg;
  R.diagramType = diagramType;
  R.syntaxError = syntaxError;
  R.createMermaidRegistry = createMermaidRegistry;
  R.renderMermaidBuiltin = renderMermaidBuiltin;
  R.renderMermaidSvg = renderMermaidSvg;
  R.getDefaultMermaidRegistry = getDefaultMermaidRegistry;
  R.collectMermaidBlocks = collectMermaidBlocks;
  R.enhanceMermaid = enhanceMermaid;
  R.MERMAID_TYPES = MERMAID_TYPES;

  return R;
}));

