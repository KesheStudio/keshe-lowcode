/* 渲染核心 · 错误报告
   渲染不抛出整页错误：单块失败就跳过并记录，其余照常渲染。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var CODES = {
    PAGE_MISSING: 'LC_R_PAGE_MISSING',
    PAGE_INVALID: 'LC_R_PAGE_INVALID',
    BLOCK_INVALID: 'LC_R_BLOCK_INVALID',
    BLOCK_UNKNOWN: 'LC_R_BLOCK_UNKNOWN',
    BLOCK_RENDER_FAILED: 'LC_R_BLOCK_RENDER_FAILED',
    COMPONENT_MISSING: 'LC_R_COMPONENT_MISSING',
    COMPONENT_TEMPLATE_EMPTY: 'LC_R_COMPONENT_TEMPLATE_EMPTY',
    NESTING_TOO_DEEP: 'LC_R_NESTING_TOO_DEEP',
    DUPLICATE_BLOCK_ID: 'LC_R_DUPLICATE_BLOCK_ID',
    POS_INVALID: 'LC_R_POS_INVALID',
    THEME_MISSING: 'LC_R_THEME_MISSING',
    SHELL_MISSING: 'LC_R_SHELL_MISSING',
    ACTION_UNKNOWN: 'LC_R_ACTION_UNKNOWN',
    MODE_UNRESOLVED: 'LC_R_MODE_UNRESOLVED',
    DUPLICATE_HEADING_ID: 'LC_R_DUPLICATE_HEADING_ID',
    CSS_IMPORT_DROPPED: 'LC_R_CSS_IMPORT_DROPPED',
    CSS_SCOPE_FALLBACK: 'LC_R_CSS_SCOPE_FALLBACK',
    HTML_UNSAFE_URL: 'LC_R_HTML_UNSAFE_URL',
    OVERRIDE_SOURCE_INVALID: 'LC_R_OVERRIDE_SOURCE_INVALID'
  };

  function createReport() {
    var items = [];

    function add(severity, code, message, detail) {
      var item = {
        severity: severity === 'warn' ? 'warn' : 'error',
        code: code,
        message: String(message == null ? '' : message)
      };
      if (detail) {
        if (detail.path) item.path = detail.path;
        if (detail.blockId) item.blockId = detail.blockId;
        if (detail.componentId) item.componentId = detail.componentId;
        if (detail.reason) item.reason = detail.reason;
      }
      items.push(item);
      return item;
    }

    return {
      items: items,
      error: function (code, message, detail) { return add('error', code, message, detail); },
      warn: function (code, message, detail) { return add('warn', code, message, detail); },
      errors: function () { return items.filter(function (item) { return item.severity === 'error'; }); },
      warnings: function () { return items.filter(function (item) { return item.severity === 'warn'; }); },
      hasErrors: function () { return items.some(function (item) { return item.severity === 'error'; }); },
      toJSON: function () { return items.slice(); }
    };
  }

  function reportToText(report) {
    if (!report || !report.items || !report.items.length) return '无渲染错误。';
    return report.items.map(function (item) {
      return '[' + item.severity + '] ' + item.code + ' · ' + item.message +
        (item.path ? ' · ' + item.path : '') +
        (item.blockId ? ' · block=' + item.blockId : '');
    }).join('\n');
  }

  R.CODES = CODES;
  R.createReport = createReport;
  R.reportToText = reportToText;

  return R;
}));
