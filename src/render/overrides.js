/* 渲染核心 · 实例级覆盖
   页面里的单个组件实例可以覆盖自己的 HTML / CSS / JS：
   - HTML：整段替换组件模板（仍支持 {{field}} 占位），无法安全地做「片段合并」；
   - CSS：追加在组件默认 CSS 之后，并强制作用域到该实例；
   - JS：追加在组件默认 JS 之后，随实例独立作用域执行。
   另提供重置与另存为组件的数据函数（只产出数据，不做 UI）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./scope.js'));
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  var FIELDS = ['html', 'css', 'js'];

  function normalizeOverrides(value) {
    var source = value && typeof value === 'object' ? value : {};
    var out = {};
    FIELDS.forEach(function (field) {
      var item = source[field];
      out[field] = item == null || String(item).trim() === '' ? null : String(item);
    });
    return out;
  }

  function hasOverrides(value) {
    var o = normalizeOverrides(value);
    return !!(o.html || o.css || o.js);
  }

  function positionAt(text, index) {
    var source = String(text == null ? '' : text);
    var line = 1;
    var column = 1;
    var limit = Math.max(0, Math.min(index, source.length));
    for (var i = 0; i < limit; i += 1) {
      if (source.charAt(i) === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    return { line: line, column: column };
  }

  /* ---------------- CSS 语法检查 ---------------- */

  function checkCss(css) {
    var source = String(css == null ? '' : css);
    var depth = 0;
    var openIndex = -1;
    var quote = null;
    var quoteIndex = -1;
    var i = 0;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; quoteIndex = i; i += 1; continue; }
      if (ch === '/' && source.charAt(i + 1) === '*') {
        var end = source.indexOf('*/', i + 2);
        if (end === -1) {
          var p = positionAt(source, i);
          return { message: 'CSS 注释没有闭合。', line: p.line, column: p.column };
        }
        i = end + 2;
        continue;
      }
      if (ch === '{') { depth += 1; if (depth === 1 && openIndex === -1) openIndex = i; i += 1; continue; }
      if (ch === '}') {
        depth -= 1;
        if (depth < 0) {
          var p2 = positionAt(source, i);
          return { message: '出现多余的右花括号 }。', line: p2.line, column: p2.column };
        }
        i += 1;
        continue;
      }
      i += 1;
    }
    if (quote) {
      var p3 = positionAt(source, quoteIndex);
      return { message: '字符串引号没有闭合。', line: p3.line, column: p3.column };
    }
    if (depth > 0) {
      var p4 = positionAt(source, openIndex === -1 ? 0 : openIndex);
      return { message: '花括号没有闭合，缺少 ' + depth + ' 个 }。', line: p4.line, column: p4.column };
    }
    return null;
  }

  /* ---------------- JS 语法检查 ---------------- */

  function scanJs(source) {
    var i = 0;
    var quote = null;
    var quoteIndex = -1;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; quoteIndex = i; i += 1; continue; }
      if (ch === '/' && source.charAt(i + 1) === '/') {
        var lineEnd = source.indexOf('\n', i + 2);
        i = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }
      if (ch === '/' && source.charAt(i + 1) === '*') {
        var end = source.indexOf('*/', i + 2);
        if (end === -1) {
          var p = positionAt(source, i);
          return { message: '注释没有闭合。', line: p.line, column: p.column };
        }
        i = end + 2;
        continue;
      }
      i += 1;
    }
    if (quote) {
      var p2 = positionAt(source, quoteIndex);
      return { message: '字符串没有闭合。', line: p2.line, column: p2.column };
    }
    return null;
  }

  function checkJs(source) {
    var text = String(source == null ? '' : source);
    var scanned = scanJs(text);
    if (scanned) return scanned;
    try {
      /* 用 Function 构造做语法检查；不执行代码。 */
      /* eslint-disable no-new-func */
      new Function(text);
    } catch (error) {
      var message = error && error.message ? String(error.message) : '语法错误。';
      var match = message.match(/:(\d+):(\d+)/);
      if (match) return { message: message, line: Number(match[1]), column: Number(match[2]) };
      return { message: message, line: 1, column: 1 };
    }
    return null;
  }

  /* ---------------- 内联脚本语法检查 ---------------- */

  var SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  /* 组件模板里的 {{field}} 在检查前替换成 null，避免把占位符当成非法 JS。 */
  function maskTemplateValues(source) {
    return String(source == null ? '' : source).replace(/\{\{\s*[a-zA-Z0-9_-]+\s*\}\}/g, 'null');
  }

  /* 扫描 HTML 中的内联 <script>（只查经典脚本，跳过 src / module / 数据脚本），
     返回相对整段 HTML 的行列，供预览与导出在源位置提示。 */
  function checkInlineScripts(source) {
    var text = String(source == null ? '' : source);
    var errors = [];
    var match;
    var index = 0;
    var regex = new RegExp(SCRIPT_BLOCK.source, 'gi');
    while ((match = regex.exec(text))) {
      var attrs = match[1] || '';
      var body = maskTemplateValues(match[2] || '');
      if (!body.trim()) continue;
      if (/\bsrc\s*=/i.test(attrs)) continue;
      var typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      var type = String((typeMatch && (typeMatch[1] || typeMatch[2] || typeMatch[3])) || '').trim().toLowerCase();
      if (type && type !== 'text/javascript' && type !== 'application/javascript') continue;
      index += 1;
      var error = checkJs(body);
      if (!error) continue;
      var bodyStart = match.index + match[0].indexOf('>') + 1;
      var origin = positionAt(text, bodyStart);
      errors.push({
        field: 'html',
        script: index,
        message: '内联脚本 #' + index + ' 语法错误：' + error.message,
        line: origin.line + error.line - 1,
        column: error.line === 1 ? origin.column + error.column - 1 : error.column
      });
    }
    return errors;
  }

  /* ---------------- HTML 语法检查 ---------------- */

  var VOID = {
    area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
    link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
  };

  function checkHtml(source) {
    var html = String(source == null ? '' : source);
    /* 注释替换成等长空白，保留行列位置。 */
    var masked = html.replace(/<!--[\s\S]*?-->/g, function (match) {
      return match.replace(/[^\n]/g, ' ');
    });
    var regex = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
    var stack = [];
    var match;
    while ((match = regex.exec(masked))) {
      var closing = match[1] === '/';
      var name = match[2].toLowerCase();
      var tail = match[3] || '';
      var selfClosing = /\/\s*$/.test(tail);
      if (!closing && !selfClosing && (name === 'script' || name === 'style')) {
        var closeIndex = masked.toLowerCase().indexOf('</' + name, regex.lastIndex);
        if (closeIndex === -1) {
          var p = positionAt(html, match.index);
          return { message: '<' + name + '> 没有闭合。', line: p.line, column: p.column };
        }
        regex.lastIndex = closeIndex + 2 + name.length;
        continue;
      }
      if (closing) {
        if (!stack.length) {
          var p2 = positionAt(html, match.index);
          return { message: '多余的结束标签 </' + name + '>。', line: p2.line, column: p2.column };
        }
        var top = stack[stack.length - 1];
        if (top.name !== name) {
          var p3 = positionAt(html, match.index);
          return {
            message: '结束标签 </' + name + '> 与 <' + top.name + '> 不匹配。',
            line: p3.line, column: p3.column
          };
        }
        stack.pop();
        continue;
      }
      if (VOID[name]) continue;
      stack.push({ name: name, index: match.index });
    }
    if (stack.length) {
      var last = stack[stack.length - 1];
      var p4 = positionAt(html, last.index);
      return { message: '<' + last.name + '> 没有闭合。', line: p4.line, column: p4.column };
    }
    return null;
  }

  function validateOverrideSource(value) {
    var overrides = normalizeOverrides(value);
    var errors = [];
    if (overrides.html) {
      var htmlError = checkHtml(overrides.html);
      if (htmlError) errors.push({ field: 'html', message: htmlError.message, line: htmlError.line, column: htmlError.column });
    }
    if (overrides.css) {
      var cssError = checkCss(overrides.css);
      if (cssError) errors.push({ field: 'css', message: cssError.message, line: cssError.line, column: cssError.column });
    }
    if (overrides.js) {
      var jsError = checkJs(overrides.js);
      if (jsError) errors.push({ field: 'js', message: jsError.message, line: jsError.line, column: jsError.column });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------------- 页面级覆盖 ---------------- */

  /* 页面级 HTML / CSS / JS 与实例覆盖共用同一套三字段校验；
     区别只在落点：页面级挂 page.overrides，作用域是整个页面容器。 */
  function normalizePageOverrides(value) {
    return normalizeOverrides(value);
  }

  function hasPageOverrides(value) {
    return hasOverrides(value);
  }

  /* 实例数据来源：mode=inherit 跟随组件/数据源默认；mode=custom 时由实例自己拉取。
     处理逻辑写在 transform 里，入参 (payload, root)，返回值作为实例数据。 */
  var DATA_METHODS = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };

  function normalizeInstanceData(value) {
    var source = value && typeof value === 'object' ? value : {};
    var mode = source.mode === 'custom' ? 'custom' : 'inherit';
    var method = String(source.method || 'GET').toUpperCase();
    if (!DATA_METHODS[method]) method = 'GET';
    return {
      mode: mode,
      url: mode === 'custom' ? String(source.url || '').trim() : '',
      method: method,
      transform: source.transform == null || String(source.transform).trim() === ''
        ? null
        : String(source.transform)
    };
  }

  function buildInstanceDataScript(block) {
    var data = normalizeInstanceData(block && block.overrides && block.overrides.data);
    if (data.mode !== 'custom' || !data.url) return '';
    var config = JSON.stringify({ url: data.url, method: data.method, transform: data.transform });
    /* 这段脚本由 engine 以实例作用域包一层，可直接用 root。
       lcPublicUrl 与 runtime.js 的 resolveUrl 同一口径：相对路径拼「域名 + 路径前缀」，
       绝对地址原样；基址缺失（含字面量 undefined/null）时回退同源相对路径。 */
    return [
      'var config = ' + config + ';',
      'var lcBase = "";',
      'try { if (typeof window.LC_PUBLIC_BASE_URL === "string") lcBase = window.LC_PUBLIC_BASE_URL; } catch (e) { lcBase = ""; }',
      'lcBase = String(lcBase == null ? "" : lcBase).trim().replace(/\\/+$/, "");',
      'if (lcBase === "undefined" || lcBase === "null") lcBase = "";',
      'var lcPublicUrl = function (raw) {',
      '  var text = String(raw == null ? "" : raw).trim();',
      '  if (!text) return raw;',
      '  if (text.charAt(0) === "#" || text.slice(0, 2) === "//") return raw;',
      '  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return raw;',
      '  if (!lcBase) return raw;',
      '  return lcBase + (text.charAt(0) === "/" ? text : "/" + text);',
      '};',
      'var url = lcPublicUrl(config.url);',
      'root.setAttribute("data-lc-data-state", "loading");',
      'fetch(url, { method: config.method, headers: { "accept": "application/json" } }).then(function (response) {',
      '  if (!response.ok) throw new Error("HTTP " + response.status + " " + url);',
      '  return response.json();',
      '}).then(function (payload) {',
      '  var data = payload;',
      '  if (config.transform) data = new Function("payload", "root", config.transform)(payload, root);',
      '  root.setAttribute("data-lc-data-state", "ready");',
      '  root.dispatchEvent(new CustomEvent("lc:instance-data", { bubbles: true, detail: { url: config.url, data: data } }));',
      '}).catch(function (error) {',
      '  root.setAttribute("data-lc-data-state", "error");',
      '  if (typeof console !== "undefined") console.warn("[lc] 实例数据来源失败", url, error);',
      '  root.dispatchEvent(new CustomEvent("lc:instance-data", { bubbles: true, detail: { url: config.url, error: String(error && error.message ? error.message : error) } }));',
      '});'
    ].join('\n');
  }

  function instanceDataAttrs(block) {
    var data = normalizeInstanceData(block && block.overrides && block.overrides.data);
    if (data.mode !== 'custom') return {};
    var attrs = { 'data-lc-data-mode': 'custom' };
    if (data.url) attrs['data-lc-data-url'] = data.url;
    attrs['data-lc-data-method'] = data.method;
    return attrs;
  }

  /* ---------------- 页面级接口覆盖 ---------------- */

  var API_METHODS = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1, HEAD: 1, OPTIONS: 1 };

  function normalizeApiPath(value) {
    var path = String(value == null ? '' : value).trim();
    if (!path) return '';
    if (!path.startsWith('/')) path = '/' + path;
    /* 允许末尾 * 通配，例如 /api/items/*；查询串不参与匹配。 */
    path = path.replace(/[?#].*$/, '');
    return path;
  }

  function normalizeApiOverride(entry, index) {
    var item = entry && typeof entry === 'object' ? entry : {};
    var method = String(item.method || 'GET').toUpperCase();
    if (!API_METHODS[method]) method = 'GET';
    var path = normalizeApiPath(item.path);
    if (!path) return null;
    var code = item.code == null ? '' : String(item.code);
    return {
      id: String(item.id || ('api-' + (index + 1))),
      path: path,
      method: method,
      code: code,
      note: item.note == null ? '' : String(item.note),
      updatedAt: String(item.updatedAt || '')
    };
  }

  function normalizeApiOverrides(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.forEach(function (entry, index) {
      var item = normalizeApiOverride(entry, index);
      if (item) out.push(item);
    });
    return out;
  }

  /* 同一页面里 method + path 只允许一段生效；重复时按 updatedAt 新者优先。 */
  function resolveApiOverrides(value) {
    var items = normalizeApiOverrides(value);
    var effective = [];
    var shadowed = [];
    var byKey = {};
    items.forEach(function (item) {
      var key = item.method + ' ' + item.path;
      var existing = byKey[key];
      if (!existing) {
        byKey[key] = item;
        effective.push(item);
        return;
      }
      var newer = String(item.updatedAt || '') >= String(existing.updatedAt || '');
      if (newer) {
        byKey[key] = item;
        shadowed.push(existing);
        effective[effective.indexOf(existing)] = item;
      } else {
        shadowed.push(item);
      }
    });
    return { effective: effective, shadowed: shadowed, items: items };
  }

  function buildApiOverrideScript(page) {
    var resolved = resolveApiOverrides(page && page.apiOverrides);
    if (!resolved.effective.length) return '';
    var entries = resolved.effective.map(function (item) {
      return { id: item.id, path: item.path, method: item.method, code: item.code };
    });
    return [
      'if (typeof window === "undefined" || typeof window.fetch !== "function") return;',
      'var entries = ' + JSON.stringify(entries) + ';',
      'var originalFetch = window.fetch;',
      'window.fetch = function (input, init) {',
      '  var url = typeof input === "string" ? input : (input && input.url) || "";',
      '  var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();',
      '  var pathname = url;',
      '  try { pathname = new URL(url, window.location.href).pathname; } catch (e) { /* 保持原值 */ }',
      '  for (var i = 0; i < entries.length; i += 1) {',
      '    var entry = entries[i];',
      '    if (entry.method !== method) continue;',
      '    var matched = entry.path === pathname || (entry.path.slice(-1) === "*" && pathname.indexOf(entry.path.slice(0, -1)) === 0);',
      '    if (!matched) continue;',
      '    var handler = new Function("request", "context", "return (async function () {\\n" + entry.code + "\\n})();");',
      '    return handler({ input: input, init: init, url: url, method: method, pathname: pathname }, {',
      '      page: ' + JSON.stringify(String((page && page.id) || '')) + ', entry: entry, originalFetch: originalFetch, pageRoot: page',
      '    });',
      '  }',
      '  return originalFetch.apply(this, arguments);',
      '};'
    ].join('\n');
  }

  /* ---------------- CSS 作用域 ---------------- */

  function escapeScopeValue(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function findBlockEnd(css, openIndex) {
    var depth = 1;
    var i = openIndex + 1;
    var quote = null;
    while (i < css.length) {
      var ch = css.charAt(i);
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  }

  /* 把顶层「裸声明」也收进实例作用域；其余规则交给 scopeCss。 */
  function scopeInstanceCss(css, instanceId) {
    var text = String(css == null ? '' : css).trim();
    if (!text) return '';
    var scope = '[data-lc-instance="' + escapeScopeValue(instanceId) + '"]';
    var chunks = [];
    var i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text.charAt(i))) i += 1;
      if (i >= text.length) break;
      var start = i;
      var paren = 0;
      var quote = null;
      while (i < text.length) {
        var ch = text.charAt(i);
        if (quote) {
          if (ch === '\\') { i += 2; continue; }
          if (ch === quote) quote = null;
          i += 1;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
        if (ch === '(') { paren += 1; i += 1; continue; }
        if (ch === ')') { paren -= 1; i += 1; continue; }
        if (paren === 0 && (ch === '{' || ch === ';')) break;
        i += 1;
      }
      if (i >= text.length) {
        var tail = text.slice(start).trim();
        if (tail) chunks.push({ type: 'decl', text: tail });
        break;
      }
      if (text.charAt(i) === ';') {
        var statement = text.slice(start, i).trim();
        if (statement) chunks.push({ type: /^@/.test(statement) ? 'at' : 'decl', text: statement });
        i += 1;
        continue;
      }
      var close = findBlockEnd(text, i);
      if (close === -1) {
        chunks.push({ type: 'rule', text: text.slice(start).trim() });
        break;
      }
      chunks.push({ type: 'rule', text: text.slice(start, close + 1).trim() });
      i = close + 1;
    }

    var out = [];
    var declarations = [];
    chunks.forEach(function (chunk) {
      if (chunk.type === 'decl') {
        declarations.push(chunk.text);
        return;
      }
      if (chunk.type === 'at') return; /* @import 等由 scopeCss 丢弃 */
      var scoped = R.scopeCss(chunk.text, scope);
      if (scoped) out.push(scoped);
    });
    if (declarations.length) out.push(scope + ' {\n' + declarations.join(';\n') + ';\n}');
    return out.join('\n');
  }

  /* ---------------- 合并 / 重置 / 另存 ---------------- */

  function mergeInstanceOverrides(component, overrides) {
    var comp = component && typeof component === 'object' ? component : {};
    var o = normalizeOverrides(overrides);
    var validation = validateOverrideSource(o);
    var valid = { html: o.html, css: o.css, js: o.js };
    validation.errors.forEach(function (error) {
      if (error.field === 'html') valid.html = null;
      if (error.field === 'css') valid.css = null;
      if (error.field === 'js') valid.js = null;
    });
    return {
      template: valid.html != null ? valid.html : String(comp.template || ''),
      css: String(comp.css || ''),
      js: String(comp.js || ''),
      overrideCss: valid.css || '',
      overrideJs: valid.js || '',
      hasHtmlOverride: valid.html != null,
      hasCssOverride: !!valid.css,
      hasJsOverride: !!valid.js,
      hasOverrides: !!(o.html || o.css || o.js),
      validation: validation,
      merge: { html: 'replace', css: 'append', js: 'append' }
    };
  }

  function resetInstanceOverrides(block) {
    var source = block && typeof block === 'object' ? block : {};
    var copy = {};
    Object.keys(source).forEach(function (key) {
      if (key !== 'overrides') copy[key] = source[key];
    });
    return copy;
  }

  function saveAsComponent(component, overrides, options) {
    var comp = component && typeof component === 'object' ? component : {};
    var opts = options || {};
    var merged = mergeInstanceOverrides(comp, overrides);
    var saved = {};
    Object.keys(comp).forEach(function (key) {
      if (key === 'overrides') return;
      saved[key] = comp[key];
    });
    saved.id = String(opts.id || (comp.id ? comp.id + '-custom' : 'component-custom'));
    saved.name = String(opts.name || ((comp.name || comp.id || '组件') + '（自定义）'));
    saved.template = merged.template;
    saved.css = [merged.css, merged.overrideCss].filter(Boolean).join('\n');
    saved.js = [merged.js, merged.overrideJs].filter(Boolean).join('\n');
    return saved;
  }

  /* ---------------- 事件绑定 ----------------
     前端元素绑定事件触发后端积木接口，并按 handler 处理返回值：
     auto 写进 target 组件的数据槽，custom 交给用户脚本。
     配置以 JSON 挂在元素上，整页只注入一次运行时；元素销毁或再次触发会 abort 旧请求。 */
  var BINDING_EVENTS = ['click', 'submit', 'change', 'input', 'dblclick', 'keydown', 'keyup', 'focus', 'blur', 'mouseenter'];
  var BINDING_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  function normalizeBindings(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var event = String(item.event || 'click').toLowerCase();
      if (BINDING_EVENTS.indexOf(event) === -1) event = 'click';
      var method = String(item.method || 'GET').toUpperCase();
      if (BINDING_METHODS.indexOf(method) === -1) method = 'GET';
      var route = String(item.route == null ? '' : item.route).trim();
      if (!route) return;
      var binding = {
        event: event,
        route: route,
        method: method,
        target: String(item.target == null ? '' : item.target).trim(),
        handler: item.handler === 'custom' ? 'custom' : 'auto',
        script: item.script == null ? '' : String(item.script)
      };
      /* 可选扩展：builder 不传时用运行时默认文案。 */
      if (item.loadingText != null) binding.loadingText = String(item.loadingText);
      if (item.errorText != null) binding.errorText = String(item.errorText);
      if (item.successText != null) binding.successText = String(item.successText);
      out.push(binding);
    });
    return out;
  }

  /* 页面级绑定运行时：扫描 [data-lc-bindings]，不依赖第三方库。
     加载 / 失败状态写回元素自身的 data-lc-binding-state，并在元素尾部给一行可见提示。 */
  function bindingsRuntimeSource() {
    return [
      'var lcWin = window;',
      'var lcDoc = document;',
      'var LC_KEY = "__lcBindingsRuntime";',
      'if (lcWin[LC_KEY] && lcWin[LC_KEY].scan) { lcWin[LC_KEY].scan(); return; }',
      'var LC_DEBOUNCE = 200;',
      'var lcEntries = [];',
      'var lcWatcher = null;',
      'function lcAttrId(value) { return String(value == null ? "" : value).replace(/[\\\\"]/g, "\\\\$&"); }',
      'function lcEmit(node, name, detail) {',
      '  if (!node || !node.dispatchEvent) return;',
      '  var ev;',
      '  try { ev = new CustomEvent(name, { bubbles: true, cancelable: true, detail: detail }); }',
      '  catch (e) {',
      '    if (!lcDoc.createEvent) return;',
      '    ev = lcDoc.createEvent("CustomEvent");',
      '    ev.initCustomEvent(name, true, true, detail);',
      '  }',
      '  node.dispatchEvent(ev);',
      '}',
      'function lcStyle() {',
      '  if (lcDoc.getElementById("lc-binding-runtime-style")) return;',
      '  var style = lcDoc.createElement("style");',
      '  style.id = "lc-binding-runtime-style";',
      '  style.textContent = ".lc-rt-binding-status{margin:8px 0 0;font-size:var(--lc-text-sm,13px);line-height:1.5;color:var(--lc-color-muted,#626a63)}" +',
      '    ".lc-rt-binding-status[data-lc-binding-tone=error]{padding:6px 10px;border-left:3px solid var(--lc-color-danger,#b3261e);background:var(--lc-color-surface-2,#f1ece0);color:var(--lc-color-ink,#1d2320)}" +',
      '    ".lc-rt-binding-status[hidden]{display:none}" +',
      '    ".lc-rt-list{display:flex;flex-direction:column;gap:6px}" +',
      '    ".lc-rt-list-item{padding:6px 10px;border:1px solid var(--lc-color-line,#d9d2c2);border-radius:var(--lc-radius-md,8px);background:var(--lc-color-surface,#fff)}";',
      '  (lcDoc.head || lcDoc.documentElement).appendChild(style);',
      '}',
      'function lcFindTarget(id) {',
      '  if (!id) return null;',
      '  var block = lcDoc.querySelector("[data-lc-block=\\"" + lcAttrId(id) + "\\"]");',
      '  if (block) return block;',
      '  return lcDoc.querySelector("[data-lc-instance=\\"" + lcAttrId(id) + "\\"]");',
      '}',
      'function lcSlot(scope, selector) {',
      '  if (!scope) return null;',
      '  if (scope.matches && scope.matches(selector)) return scope;',
      '  return scope.querySelector ? scope.querySelector(selector) : null;',
      '}',
      'function lcReadIsland(el) {',
      '  if (!el || !el.querySelector) return null;',
      '  var node = el.querySelector("script.lc-ui-data");',
      '  if (!node) return null;',
      '  try { return JSON.parse(node.textContent || "{}"); } catch (e) { return null; }',
      '}',
      'function lcReadBindings(value) {',
      '  try { var data = JSON.parse(value || "[]"); return Array.isArray(data) ? data : []; } catch (e) { return []; }',
      '}',
      'function lcStatus(root) {',
      '  var box = root.querySelector("[data-lc-binding-status]");',
      '  if (box) return box;',
      '  box = lcDoc.createElement("p");',
      '  box.className = "lc-rt-binding-status";',
      '  box.setAttribute("data-lc-binding-status", "true");',
      '  box.setAttribute("role", "status");',
      '  box.setAttribute("aria-live", "polite");',
      '  root.appendChild(box);',
      '  return box;',
      '}',
      'function lcSetState(root, state, message) {',
      '  root.setAttribute("data-lc-binding-state", state);',
      '  if (state === "loading") root.setAttribute("aria-busy", "true");',
      '  else root.removeAttribute("aria-busy");',
      '  var box = lcStatus(root);',
      '  if (message) {',
      '    box.textContent = message;',
      '    box.setAttribute("data-lc-binding-tone", state);',
      '    box.hidden = false;',
      '  } else {',
      '    box.textContent = "";',
      '    box.hidden = true;',
      '  }',
      '}',
      'function lcTextOf(value) {',
      '  if (value == null) return "";',
      '  if (Array.isArray(value)) return value.map(lcTextOf).join("，");',
      '  if (typeof value === "object") {',
      '    var keys = ["value", "total", "count", "text", "label", "title", "name"];',
      '    for (var i = 0; i < keys.length; i += 1) {',
      '      if (value[keys[i]] != null) return lcTextOf(value[keys[i]]);',
      '    }',
      '    try { return JSON.stringify(value); } catch (e) { return String(value); }',
      '  }',
      '  return String(value);',
      '}',
      'function lcRowValue(row, key) {',
      '  if (!row || key == null) return "";',
      '  var parts = String(key).split(".");',
      '  var current = row;',
      '  for (var i = 0; i < parts.length; i += 1) {',
      '    if (current == null) return "";',
      '    current = current[parts[i]];',
      '  }',
      '  return current == null ? "" : current;',
      '}',
      'function lcRowsOf(data) {',
      '  if (Array.isArray(data)) return data;',
      '  if (data && Array.isArray(data.rows)) return data.rows;',
      '  if (data && Array.isArray(data.items)) return data.items;',
      '  if (data && Array.isArray(data.list)) return data.list;',
      '  return null;',
      '}',
      'function lcValuesOf(root) {',
      '  var form = root.tagName === "FORM" ? root : (root.querySelector ? root.querySelector("form") : null);',
      '  if (!form || typeof FormData !== "function") return null;',
      '  var out = {};',
      '  try {',
      '    var fd = new FormData(form);',
      '    if (fd.forEach) fd.forEach(function (value, name) {',
      '      if (typeof value !== "string") return;',
      '      if (out[name] === undefined) out[name] = value;',
      '      else if (Array.isArray(out[name])) out[name].push(value);',
      '      else out[name] = [out[name], value];',
      '    });',
      '  } catch (e) { return null; }',
      '  return Object.keys(out).length ? out : null;',
      '}',
      'function lcQuery(route, detail) {',
      '  var parts = [];',
      '  function add(key, value) {',
      '    if (value == null) return;',
      '    if (Array.isArray(value)) value = value.join(",");',
      '    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));',
      '  }',
      '  add("event", detail.event);',
      '  if (detail.name) add(String(detail.name), detail.value);',
      '  if (detail.values) Object.keys(detail.values).forEach(function (key) { add(key, detail.values[key]); });',
      '  if (!parts.length) return route;',
      '  return route + (route.indexOf("?") === -1 ? "?" : "&") + parts.join("&");',
      '}',
      'function lcPublicUrl(raw) {',
      '  var text = String(raw == null ? "" : raw).trim();',
      '  if (!text) return raw;',
      '  if (text.charAt(0) === "#" || text.slice(0, 2) === "//") return raw;',
      '  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return raw;',
      '  var base = "";',
      '  try { if (typeof lcWin.LC_PUBLIC_BASE_URL === "string") base = lcWin.LC_PUBLIC_BASE_URL; } catch (e) { base = ""; }',
      '  base = String(base == null ? "" : base).trim().replace(/\\/+$/, "");',
      '  if (base === "undefined" || base === "null") base = "";',
      '  if (!base) return raw;',
      '  return base + (text.charAt(0) === "/" ? text : "/" + text);',
      '}',
      'function lcErrorOf(response) {',
      '  return response.text().then(function (text) {',
      '    var message = "HTTP " + response.status;',
      '    try {',
      '      var parsed = JSON.parse(text);',
      '      var found = parsed && (parsed.message || (parsed.error && parsed.error.message));',
      '      if (found) message = String(found);',
      '    } catch (e) { /* 非 JSON 错误体 */ }',
      '    var error = new Error(message);',
      '    error.status = response.status;',
      '    return error;',
      '  }).catch(function () {',
      '    var fallback = new Error("HTTP " + response.status);',
      '    fallback.status = response.status;',
      '    return fallback;',
      '  });',
      '}',
      'function lcParse(response) {',
      '  var type = String(response.headers.get("content-type") || "").toLowerCase();',
      '  if (type.indexOf("json") !== -1) return response.json();',
      '  return response.text();',
      '}',
      'function lcUnwrap(payload) {',
      '  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.data !== undefined) return payload.data;',
      '  return payload;',
      '}',
      'function lcDataApi(target) {',
      '  if (!target) return null;',
      '  if (target.__lcData && typeof target.__lcData.setData === "function") return target.__lcData;',
      '  var nodes = target.querySelectorAll("[data-lc-ui], [data-lc-list], [data-lc-slot]");',
      '  for (var i = 0; i < nodes.length; i += 1) {',
      '    if (nodes[i].__lcData && typeof nodes[i].__lcData.setData === "function") return nodes[i].__lcData;',
      '  }',
      '  return null;',
      '}',
      'function lcApplyTable(table, data) {',
      '  var rows = lcRowsOf(data);',
      '  if (!rows) return false;',
      '  if (table.__lcTable && typeof table.__lcTable.setRows === "function") { table.__lcTable.setRows(rows); return true; }',
      '  var tbody = table.querySelector("[data-lc-tbody]");',
      '  if (!tbody) return false;',
      '  var columns = [];',
      '  var heads = table.querySelectorAll("thead th[data-lc-col]");',
      '  for (var i = 0; i < heads.length; i += 1) columns.push(heads[i].getAttribute("data-lc-col"));',
      '  if (!columns.length && rows.length) columns = Object.keys(rows[0] || {});',
      '  if (!columns.length) return false;',
      '  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);',
      '  rows.forEach(function (row) {',
      '    var tr = lcDoc.createElement("tr");',
      '    columns.forEach(function (key) {',
      '      var td = lcDoc.createElement("td");',
      '      td.textContent = lcTextOf(lcRowValue(row, key));',
      '      tr.appendChild(td);',
      '    });',
      '    tbody.appendChild(tr);',
      '  });',
      '  table.setAttribute("data-lc-rt-table", "true");',
      '  return true;',
      '}',
      'function lcApplyChart(chart, data) {',
      '  var island = lcReadIsland(chart) || {};',
      '  var config = island.config && typeof island.config === "object" ? island.config : island;',
      '  var type = chart.getAttribute("data-lc-ui") || "ui-chart-bar";',
      '  var paint = lcWin.__LC_PAINT_ASYNC__;',
      '  if (typeof paint !== "function" && typeof chart.__lcChartPaint === "function") paint = chart.__lcChartPaint;',
      '  if (typeof paint !== "function") return false;',
      '  paint(chart, type, config, data);',
      '  return true;',
      '}',
      'function lcApplyStat(stat, data) {',
      '  var island = lcReadIsland(stat) || {};',
      '  var config = island.config && typeof island.config === "object" ? island.config : island;',
      '  var type = stat.getAttribute("data-lc-ui") || "ui-kpi";',
      '  var paint = lcWin.__LC_PAINT_ASYNC__;',
      '  if (typeof paint === "function") { paint(stat, type, config, data); return true; }',
      '  var node = stat.querySelector("[data-lc-value]") || stat.querySelector(".lc-ui-kpi-number") ||',
      '    stat.querySelector(".lc-ui-stat-number") || stat.querySelector("[data-lc-text]");',
      '  if (!node) return false;',
      '  node.textContent = lcTextOf(data);',
      '  return true;',
      '}',
      'function lcFillList(container, items) {',
      '  container.classList.add("lc-rt-list");',
      '  while (container.firstChild) container.removeChild(container.firstChild);',
      '  var list = String(container.tagName || "").toLowerCase();',
      '  items.forEach(function (item) {',
      '    var node = lcDoc.createElement(list === "ul" || list === "ol" ? "li" : "div");',
      '    node.className = "lc-rt-list-item";',
      '    node.textContent = lcTextOf(item);',
      '    container.appendChild(node);',
      '  });',
      '}',
      'function lcApplyText(target, data) {',
      '  var node = target.querySelector("[data-lc-value]") || target.querySelector("[data-lc-text]") ||',
      '    target.querySelector(".lc-ui-kpi-number") || target.querySelector(".lc-ui-stat-number");',
      '  if (!node) {',
      '    var kind = target.getAttribute("data-lc-type");',
      '    if (kind === "text" || kind === "heading" || kind === "paragraph" || kind === "markdown") {',
      '      node = target.querySelector("h1, h2, h3, h4, h5, h6, p, pre, code");',
      '    }',
      '  }',
      '  if (!node) return false;',
      '  node.textContent = lcTextOf(data);',
      '  return true;',
      '}',
      'function lcApplyAuto(binding, data, source) {',
      '  var target = lcFindTarget(binding.target);',
      '  if (!binding.target) return true;',
      '  if (!target) return "未找到目标组件「" + binding.target + "」。";',
      '  var chart = lcSlot(target, \'[data-lc-ui^="ui-chart-"], [data-lc-ui="ui-sparkline"]\');',
      '  if (chart) return lcApplyChart(chart, data) ? true : "图表绘制失败，缺少异步图表运行时。";',
      '  var table = lcSlot(target, \'[data-lc-ui="ui-table"]\');',
      '  if (table) return lcApplyTable(table, data) ? true : "返回数据无法写入表格。";',
      '  var stat = lcSlot(target, \'[data-lc-ui="ui-kpi"], [data-lc-ui="ui-progress"]\');',
      '  if (stat) return lcApplyStat(stat, data) ? true : "返回数据无法写入指标。";',
      '  var list = lcSlot(target, "[data-lc-list]");',
      '  if (list) {',
      '    var items = lcRowsOf(data);',
      '    if (!items) return "返回数据无法写入列表。";',
      '    lcFillList(list, items);',
      '    return true;',
      '  }',
      '  var api = lcDataApi(target);',
      '  if (api) {',
      '    try { api.setData(data, { source: source, binding: binding }); return true; }',
      '    catch (e) { return "目标组件处理数据时出错。"; }',
      '  }',
      '  if (lcApplyText(target, data)) return true;',
      '  return "返回数据无法写入组件「" + binding.target + "」。";',
      '}',
      'function lcRunCustom(binding, payload, data, event, root, target) {',
      '  if (!binding.script) return true;',
      '  try {',
      '    new Function("payload", "event", "root", "data", "target", binding.script)(payload, event, root, data, target);',
      '    return true;',
      '  } catch (error) {',
      '    if (typeof console !== "undefined") console.warn("[lc] 绑定脚本执行失败", binding.route, error);',
      '    lcEmit(root, "lc:binding-script-error", { binding: binding, error: String(error && error.message ? error.message : error) });',
      '    return "自定义脚本执行失败：" + String(error && error.message ? error.message : error);',
      '  }',
      '}',
      'function lcRun(entry, binding, event) {',
      '  var key = binding.event + "|" + binding.method + "|" + binding.route;',
      '  var control = entry.controls[key] || (entry.controls[key] = {});',
      '  var now = Date.now();',
      '  if (now - (control.at || 0) < LC_DEBOUNCE) return;',
      '  control.at = now;',
      '  if (control.controller && control.controller.abort) {',
      '    try { control.controller.abort(); } catch (e) { /* 旧请求已结束 */ }',
      '  }',
      '  var values = binding.event === "submit" ? lcValuesOf(entry.root) : null;',
      '  var detail = { event: binding.event };',
      '  if (values) detail.values = values;',
      '  if (event && event.target && event.target.name) {',
      '    detail.name = event.target.name;',
      '    if (event.target.type === "checkbox" || event.target.type === "radio") detail.value = event.target.checked ? event.target.value : "";',
      '    else detail.value = event.target.value;',
      '  }',
      '  var controller = lcWin.AbortController ? new lcWin.AbortController() : null;',
      '  control.controller = controller;',
      '  var init = { method: binding.method, credentials: "same-origin", headers: { accept: "application/json" } };',
      '  if (controller) init.signal = controller.signal;',
      '  var url = lcPublicUrl(binding.route);',
      '  if (binding.method === "GET" || binding.method === "HEAD") url = lcQuery(url, detail);',
      '  else {',
      '    init.headers["content-type"] = "application/json";',
      '    init.body = JSON.stringify(detail);',
      '  }',
      '  lcSetState(entry.root, "loading", binding.loadingText == null ? "正在加载…" : String(binding.loadingText));',
      '  lcEmit(entry.root, "lc:binding-start", { binding: binding });',
      '  var request;',
      '  if (typeof lcWin.fetch !== "function") request = Promise.reject(new Error("当前环境不支持 fetch"));',
      '  else {',
      '    try { request = lcWin.fetch(url, init); } catch (error) { request = Promise.reject(error); }',
      '  }',
      '  request.then(function (response) {',
      '    if (!response.ok) return lcErrorOf(response).then(function (error) { throw error; });',
      '    return lcParse(response);',
      '  }).then(function (payload) {',
      '    if (entry.dead) return;',
      '    var data = lcUnwrap(payload);',
      '    var target = lcFindTarget(binding.target);',
      '    var result = binding.handler === "custom"',
      '      ? lcRunCustom(binding, payload, data, event, entry.root, target)',
      '      : lcApplyAuto(binding, data, entry.root);',
      '    if (result !== true) {',
      '      var message = binding.errorText == null ? String(result || "返回数据无法写入目标组件。") : String(binding.errorText);',
      '      lcSetState(entry.root, "error", message);',
      '      lcEmit(entry.root, "lc:binding-error", { binding: binding, error: message });',
      '      return;',
      '    }',
      '    var success = binding.successText == null ? "" : String(binding.successText);',
      '    lcSetState(entry.root, "ready", success);',
      '    if (success) setTimeout(function () {',
      '      if (entry.root.getAttribute("data-lc-binding-state") === "ready") lcSetState(entry.root, "ready", "");',
      '    }, 2400);',
      '    lcEmit(entry.root, "lc:binding-complete", { binding: binding, data: data, target: target });',
      '  }).catch(function (error) {',
      '    if (!entry || entry.dead) return;',
      '    if (error && (error.name === "AbortError" || error.code === 20)) return;',
      '    var message = binding.errorText == null',
      '      ? ("请求失败" + (error && error.status ? "（HTTP " + error.status + "）" : "") + "，请稍后重试。")',
      '      : String(binding.errorText);',
      '    lcSetState(entry.root, "error", message);',
      '    if (typeof console !== "undefined") console.warn("[lc] 事件绑定调用失败", binding.route, error);',
      '    lcEmit(entry.root, "lc:binding-error", { binding: binding, error: message });',
      '  });',
      '}',
      'function lcBind(root) {',
      '  if (root.getAttribute("data-lc-bound") === "true") return;',
      '  var raw = lcReadBindings(root.getAttribute("data-lc-bindings"));',
      '  root.setAttribute("data-lc-bound", "true");',
      '  if (!raw.length) {',
      '    lcSetState(root, "error", "绑定配置无法解析。");',
      '    return;',
      '  }',
      '  var entry = { root: root, controls: {}, dead: false };',
      '  raw.forEach(function (item) {',
      '    if (!item || !item.route) return;',
      '    var binding = {',
      '      event: String(item.event || "click").toLowerCase(),',
      '      route: String(item.route),',
      '      method: String(item.method || "GET").toUpperCase(),',
      '      target: String(item.target == null ? "" : item.target),',
      '      handler: item.handler === "custom" ? "custom" : "auto",',
      '      script: item.script == null ? "" : String(item.script),',
      '      loadingText: item.loadingText,',
      '      errorText: item.errorText,',
      '      successText: item.successText',
      '    };',
      '    root.addEventListener(binding.event, function (event) {',
      '      if (binding.event === "submit") event.preventDefault();',
      '      lcRun(entry, binding, event);',
      '    });',
      '  });',
      '  lcEntries.push(entry);',
      '}',
      'function lcScan() {',
      '  var nodes = lcDoc.querySelectorAll("[data-lc-bindings]");',
      '  for (var i = 0; i < nodes.length; i += 1) lcBind(nodes[i]);',
      '}',
      'function lcDestroy(entry) {',
      '  entry.dead = true;',
      '  Object.keys(entry.controls).forEach(function (key) {',
      '    var control = entry.controls[key];',
      '    if (control && control.controller && control.controller.abort) {',
      '      try { control.controller.abort(); } catch (e) { /* 已结束 */ }',
      '    }',
      '  });',
      '  entry.controls = {};',
      '  var index = lcEntries.indexOf(entry);',
      '  if (index !== -1) lcEntries.splice(index, 1);',
      '}',
      'function lcWatch() {',
      '  if (lcWatcher || typeof lcWin.MutationObserver !== "function" || !lcDoc.body) return;',
      '  lcWatcher = new lcWin.MutationObserver(function () {',
      '    lcEntries.slice().forEach(function (entry) {',
      '      if (!entry.dead && entry.root.isConnected === false) lcDestroy(entry);',
      '    });',
      '  });',
      '  lcWatcher.observe(lcDoc.body, { childList: true, subtree: true });',
      '}',
      'function lcStart() { lcStyle(); lcScan(); lcWatch(); }',
      'lcWin[LC_KEY] = { scan: lcScan };',
      'if (lcDoc.readyState === "loading") {',
      '  lcDoc.addEventListener("DOMContentLoaded", lcStart);',
      '  lcStart();',
      '} else {',
      '  lcStart();',
      '}'
    ].join('\n');
  }

  var api = {
    normalizeOverrides: normalizeOverrides,
    hasOverrides: hasOverrides,
    validateOverrideSource: validateOverrideSource,
    mergeInstanceOverrides: mergeInstanceOverrides,
    scopeInstanceCss: scopeInstanceCss,
    resetInstanceOverrides: resetInstanceOverrides,
    saveAsComponent: saveAsComponent,
    normalizePageOverrides: normalizePageOverrides,
    hasPageOverrides: hasPageOverrides,
    normalizeInstanceData: normalizeInstanceData,
    buildInstanceDataScript: buildInstanceDataScript,
    instanceDataAttrs: instanceDataAttrs,
    normalizeApiOverrides: normalizeApiOverrides,
    resolveApiOverrides: resolveApiOverrides,
    buildApiOverrideScript: buildApiOverrideScript,
    normalizeBindings: normalizeBindings,
    bindingsRuntimeSource: bindingsRuntimeSource,
    checkCss: checkCss,
    checkJs: checkJs,
    checkHtml: checkHtml,
    checkInlineScripts: checkInlineScripts
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.keys(api).forEach(function (key) { R[key] = api[key]; });
  }

  return api;
}));
