/* 渲染核心 · 组件 CSS 作用域隔离
   把组件自带的 CSS 选择器统一挂到组件作用域属性下，避免污染整页或其他组件。
   @media/@supports/@container 递归处理；@import 直接丢掉（渲染层不访问网络）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  function stripComments(css) {
    return String(css == null ? '' : css).replace(/\/\*[\s\S]*?\*\//g, '');
  }

  // 从指定位置找到顶层结束符（{ 或 ;），跳过括号、字符串
  function findTopLevel(css, start) {
    var i = start;
    var paren = 0;
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
      if (ch === '(') { paren += 1; i += 1; continue; }
      if (ch === ')') { paren -= 1; i += 1; continue; }
      if (paren === 0 && (ch === '{' || ch === ';')) return i;
      i += 1;
    }
    return -1;
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

  // 按顶层逗号拆分选择器
  function splitSelectors(text) {
    var out = [];
    var buffer = '';
    var paren = 0;
    var bracket = 0;
    var quote = null;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (quote) {
        buffer += ch;
        if (ch === '\\') { buffer += text.charAt(i + 1); i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; buffer += ch; continue; }
      if (ch === '(') paren += 1;
      else if (ch === ')') paren -= 1;
      else if (ch === '[') bracket += 1;
      else if (ch === ']') bracket -= 1;
      if (ch === ',' && paren === 0 && bracket === 0) {
        if (buffer.trim()) out.push(buffer.trim());
        buffer = '';
        continue;
      }
      buffer += ch;
    }
    if (buffer.trim()) out.push(buffer.trim());
    return out;
  }

  function scopeSelector(selector, scope) {
    var sel = String(selector == null ? '' : selector).trim();
    if (!sel) return scope;
    if (/^:root$/i.test(sel) || /^html$/i.test(sel) || /^body$/i.test(sel)) return scope;
    if (/^(:root|html|body)(?=[\s>+~.:#[])/i.test(sel)) {
      return scope + sel.replace(/^(:root|html|body)/i, '');
    }
    return scope + ' ' + sel;
  }

  function scopeList(list, scope) {
    return splitSelectors(list).map(function (selector) {
      return scopeSelector(selector, scope);
    }).join(', ');
  }

  function scopeRules(css, scope, warn) {
    var source = stripComments(css);
    var out = [];
    var index = 0;
    while (index < source.length) {
      while (index < source.length && /\s/.test(source.charAt(index))) index += 1;
      if (index >= source.length) break;

      var start = index;
      var end = findTopLevel(source, start);
      if (end === -1) {
        var tail = source.slice(start).trim();
        if (tail) out.push(tail);
        break;
      }

      if (source.charAt(end) === ';') {
        var statement = source.slice(start, end).trim();
        if (/^@(charset|import)\b/i.test(statement)) {
          if (warn) warn('CSS 中的 ' + statement.split(/\s+/)[0] + ' 已丢弃：渲染层不访问网络。');
        } else if (statement) {
          out.push(statement + ';');
        }
        index = end + 1;
        continue;
      }

      var close = findBlockEnd(source, end);
      if (close === -1) break;
      var prelude = source.slice(start, end).trim();
      var body = source.slice(end + 1, close);

      if (/^@(media|supports|container|layer|document)\b/i.test(prelude)) {
        out.push(prelude + ' {\n' + scopeRules(body, scope, warn) + '\n}');
      } else if (/^@(-[a-z]+-)?keyframes\b/i.test(prelude)) {
        // 说明：渲染层不改写 keyframes 名称，同名 keyframes 会互相覆盖。
        out.push(prelude + ' {\n' + body + '\n}');
      } else if (/^@(font-face|page|property|counter-style|namespace)\b/i.test(prelude)) {
        out.push(prelude + ' {\n' + body + '\n}');
      } else {
        out.push(scopeList(prelude, scope) + ' {\n' + body.trim() + '\n}');
      }
      index = close + 1;
    }
    return out.join('\n');
  }

  /* scopeCss(css, '[data-lc-comp="x"]', warn) */
  function scopeCss(css, scope, warn) {
    var text = String(css == null ? '' : css).trim();
    if (!text) return '';
    if (!scope) {
      if (warn) warn('组件 CSS 缺少作用域属性，已原样输出，可能污染整页。');
      return text;
    }
    return scopeRules(text, scope, warn);
  }

  R.scopeCss = scopeCss;
  R.splitSelectors = splitSelectors;
  R.scopeSelector = scopeSelector;

  return R;
}));
