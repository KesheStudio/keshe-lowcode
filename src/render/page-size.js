/* 渲染核心 · 页面限高限宽
   页面对象 page.size = { maxWidth, maxHeight }，值为字符串。
   只接受 px / vh / vw / % / rem，空字符串表示不限。
   非法值（abc、-10px、100、100 px）一律忽略并回退为不限，不生成坏 CSS。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var SIZE_VALUE_RE = /^\d+(?:\.\d+)?(?:px|vh|vw|%|rem)$/;

  function cleanSizeValue(value) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (!text) return '';
    return SIZE_VALUE_RE.test(text) ? text : '';
  }

  /* 归一化：始终返回两个字符串字段，非法/缺失统一为空串（不限）。 */
  function normalizePageSize(size) {
    var source = size && typeof size === 'object' && !Array.isArray(size) ? size : {};
    return {
      maxWidth: cleanSizeValue(source.maxWidth),
      maxHeight: cleanSizeValue(source.maxHeight)
    };
  }

  function hasPageSize(size) {
    var normalized = normalizePageSize(size);
    return !!(normalized.maxWidth || normalized.maxHeight);
  }

  /* 页面根容器的内联样式：只在有合法值时输出，旧页面不带任何多余声明。 */
  function pageSizeStyle(size) {
    var normalized = normalizePageSize(size);
    var declarations = [];
    if (normalized.maxWidth) declarations.push('max-width:' + normalized.maxWidth);
    if (normalized.maxHeight) declarations.push('max-height:' + normalized.maxHeight);
    if (normalized.maxWidth || normalized.maxHeight) {
      declarations.push('overflow:auto');
      /* 预览里 .lc-page 默认 min-height:100vh，会压过 max-height；这里显式放开。 */
      if (normalized.maxHeight) declarations.push('min-height:0');
    }
    return declarations.length ? declarations.join(';') + ';' : '';
  }

  R.normalizePageSize = normalizePageSize;
  R.hasPageSize = hasPageSize;
  R.pageSizeStyle = pageSizeStyle;

  return R;
}));
