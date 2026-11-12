/* 渲染核心 · 节点树与 DOM 互转
   纯函数：输入 JSON 描述的虚拟节点，输出 DOM 节点或 HTML 字符串。
   浏览器里用真实 DOM；Node 里只能输出字符串或节点树，不依赖 DOM 实现。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var VOID_TAGS = {
    area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
    link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function normalizeChildren(children) {
    var out = [];
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child == null || child === false || child === true) return;
      if (Array.isArray(child)) {
        normalizeChildren(child).forEach(function (item) { out.push(item); });
        return;
      }
      if (typeof child === 'string' || typeof child === 'number') {
        out.push({ text: String(child) });
        return;
      }
      out.push(child);
    });
    return out;
  }

  /* 虚拟节点：
     { tag, attrs, children }  普通元素
     { text }                  文本
     { raw }                   原样 HTML（只用于受信任的组件模板） */
  function h(tag, attrs, children) {
    return { tag: String(tag || 'div'), attrs: attrs || {}, children: normalizeChildren(children || []) };
  }

  function text(value) {
    return { text: String(value == null ? '' : value) };
  }

  function raw(html) {
    return { raw: String(html == null ? '' : html) };
  }

  function isNode(value) {
    return !!value && (typeof value === 'object') && (value.tag || value.text != null || value.raw != null);
  }

  function styleToString(style) {
    if (!style) return '';
    if (typeof style === 'string') return style;
    return Object.keys(style).map(function (key) {
      var value = style[key];
      if (value == null || value === '') return '';
      return key + ':' + value + ';';
    }).filter(Boolean).join('');
  }

  function classToString(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(' ');
    return value == null ? '' : String(value);
  }

  function attrsToString(attrs) {
    var out = [];
    Object.keys(attrs || {}).forEach(function (name) {
      var value = attrs[name];
      if (value == null || value === false) return;
      if (name === 'class') {
        var cls = classToString(value);
        if (cls) out.push('class="' + escapeAttr(cls) + '"');
        return;
      }
      if (name === 'style') {
        var style = styleToString(value);
        if (style) out.push('style="' + escapeAttr(style) + '"');
        return;
      }
      if (value === true) {
        out.push(name);
        return;
      }
      out.push(name + '="' + escapeAttr(value) + '"');
    });
    return out.length ? ' ' + out.join(' ') : '';
  }

  function toHtml(node) {
    if (!isNode(node)) return escapeHtml(node);
    if (node.text != null) return escapeHtml(node.text);
    if (node.raw != null) return node.raw;
    var tag = node.tag;
    var open = '<' + tag + attrsToString(node.attrs) + '>';
    if (VOID_TAGS[tag.toLowerCase()]) return open;
    var inner = (node.children || []).map(toHtml).join('');
    return open + inner + '</' + tag + '>';
  }

  function appendToDom(node, parent, doc) {
    if (!isNode(node)) {
      parent.appendChild(doc.createTextNode(String(node == null ? '' : node)));
      return;
    }
    if (node.text != null) {
      parent.appendChild(doc.createTextNode(node.text));
      return;
    }
    if (node.raw != null) {
      var tpl = doc.createElement('template');
      tpl.innerHTML = node.raw;
      parent.appendChild(tpl.content);
      return;
    }
    var el = doc.createElement(node.tag);
    Object.keys(node.attrs || {}).forEach(function (name) {
      var value = node.attrs[name];
      if (value == null || value === false) return;
      if (name === 'class') {
        var cls = classToString(value);
        if (cls) el.className = cls;
        return;
      }
      if (name === 'style') {
        var style = styleToString(value);
        if (style) el.setAttribute('style', style);
        return;
      }
      if (value === true) {
        el.setAttribute(name, '');
        return;
      }
      el.setAttribute(name, String(value));
    });
    (node.children || []).forEach(function (child) {
      appendToDom(child, el, doc);
    });
    parent.appendChild(el);
  }

  /* 把虚拟节点转成真实 DOM 节点。raw 节点会返回 DocumentFragment。 */
  function toDom(node, doc) {
    var documentRef = doc || (typeof document !== 'undefined' ? document : null);
    if (!documentRef) {
      throw new Error('toDom 需要浏览器环境；Node 侧请使用 toHtml。');
    }
    if (!isNode(node)) return documentRef.createTextNode(String(node == null ? '' : node));
    if (node.text != null) return documentRef.createTextNode(node.text);
    if (node.raw != null) {
      var tpl = documentRef.createElement('template');
      tpl.innerHTML = node.raw;
      return tpl.content;
    }
    var holder = documentRef.createElement('div');
    appendToDom(node, holder, documentRef);
    return holder.firstChild;
  }

  R.h = h;
  R.text = text;
  R.raw = raw;
  R.isNode = isNode;
  R.escapeHtml = escapeHtml;
  R.escapeAttr = escapeAttr;
  R.attrsToString = attrsToString;
  R.toHtml = toHtml;
  R.toDom = toDom;
  R.appendToDom = appendToDom;

  return R;
}));
