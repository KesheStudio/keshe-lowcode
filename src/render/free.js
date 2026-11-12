/* 渲染核心 · 自由定位
   容器 variant:'free' 或页面 layout.mode:'free' 时，子块按 pos 绝对定位；
   普通容器仍走流式排版，两种模式共用同一套区块渲染。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./errors.js'));
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var LENGTH_RE = /^[-+]?\d*\.?\d+(px|%|em|rem|vw|vh|vmin|vmax|ch|pt|pc|cm|mm|in)?$/i;

  function toLength(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
      return isFinite(value) ? value + 'px' : null;
    }
    var text = String(value).trim();
    if (!text) return null;
    if (text === 'auto') return 'auto';
    if (LENGTH_RE.test(text)) {
      return /^[-+]?\d*\.?\d+$/.test(text) ? text + 'px' : text;
    }
    if (/^calc\(.+\)$/.test(text)) return text;
    return null;
  }

  function normalizePos(pos, report, path) {
    if (pos == null) return null;
    if (typeof pos !== 'object') {
      if (report) report.warn(R.CODES.POS_INVALID, 'pos 不是对象，已按默认位置处理。', { path: path });
      return null;
    }
    var raw = {
      left: pos.left != null ? pos.left : pos.x,
      top: pos.top != null ? pos.top : pos.y,
      width: pos.width != null ? pos.width : pos.w,
      height: pos.height != null ? pos.height : pos.h,
      zIndex: pos.zIndex != null ? pos.zIndex : pos.z
    };
    var geom = {};
    var invalid = [];
    Object.keys(raw).forEach(function (key) {
      if (raw[key] == null || raw[key] === '') return;
      if (key === 'zIndex') {
        var z = Number(raw[key]);
        if (isFinite(z)) geom.zIndex = Math.round(z);
        else invalid.push('z');
        return;
      }
      var length = toLength(raw[key]);
      if (length == null) invalid.push(key === 'left' ? 'x' : key === 'top' ? 'y' : key === 'width' ? 'w' : 'h');
      else geom[key] = length;
    });
    if (invalid.length && report) {
      report.warn(R.CODES.POS_INVALID, 'pos 字段无效：' + invalid.join('、') + '，已忽略。', { path: path });
    }
    if (geom.left == null) geom.left = '0px';
    if (geom.top == null) geom.top = '0px';
    return geom;
  }

  function styleOf(geom, extra) {
    var style = {
      position: 'absolute',
      left: geom.left,
      top: geom.top
    };
    if (geom.width != null) style.width = geom.width;
    if (geom.height != null) style.height = geom.height;
    if (geom.zIndex != null) style.zIndex = geom.zIndex;
    if (extra) Object.keys(extra).forEach(function (key) { style[key] = extra[key]; });
    return style;
  }

  function pxNumber(length) {
    if (!length) return 0;
    var match = String(length).match(/^([-+]?\d*\.?\d+)px$/);
    return match ? Number(match[1]) : 0;
  }

  function bottomOf(geom, fallbackTop) {
    var top = geom && geom.top != null ? pxNumber(geom.top) : (fallbackTop || 0);
    var height = geom && geom.height != null ? pxNumber(geom.height) : 0;
    return top + height;
  }

  /* 无 pos 的子块按流式顺序向下排，避免在自由容器里全部叠在原点。 */
  function fallbackGeom(cursorY, report, path) {
    if (report) {
      report.warn(R.CODES.POS_INVALID, '自由布局里的区块缺少 pos，已按流式顺序向下摆放。', { path: path });
    }
    return { left: '0px', top: (cursorY || 0) + 'px' };
  }

  function containerHeight(blocks) {
    var maxBottom = 0;
    (blocks || []).forEach(function (block) {
      var geom = block && block._geom ? block._geom : null;
      if (!geom) return;
      var bottom = bottomOf(geom);
      if (bottom > maxBottom) maxBottom = bottom;
    });
    return maxBottom;
  }

  R.toLength = toLength;
  R.normalizePos = normalizePos;
  R.positionStyle = styleOf;
  R.fallbackGeom = fallbackGeom;
  R.bottomOf = bottomOf;
  R.containerHeight = containerHeight;

  return R;
}));
