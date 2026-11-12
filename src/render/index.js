/* 渲染核心 · 入口
   浏览器：按顺序加载 dom/errors/markdown/scope/theme/registry/free/shell/engine 后，
   本文件只做版本标记与完整性检查。
   Node：把各模块合并成一个对象导出，便于服务端/构建脚本直接 require。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var ns = {};
    ['./dom.js', './errors.js', './markdown.js', './scope.js', './theme.js',
     './registry.js', './free.js', './shell.js', './article.js', './engine.js',
     './mermaid.js', './interactions.js', './overrides.js', './export.js',
     './datasource.js', './builtins.js', './defaults.js', './runtime.js',
     './page-size.js'].forEach(function (path) {
      var mod = require(path);
      Object.keys(mod).forEach(function (key) { ns[key] = mod[key]; });
    });
    module.exports = factory(ns);
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  var VERSION = '0.1.0';
  var REQUIRED = [
    'h', 'toHtml', 'toDom', 'createReport', 'markdownToHtml', 'scopeCss',
    'themeCss', 'createRegistry', 'normalizePos', 'resolveShellBlock',
    'enhanceArticle', 'createRenderer', 'mount',
    'parsePx', 'pickActiveSection', 'searchSegments', 'stepIndex',
    'sectionIdFromHash', 'scrollTopFor', 'createTocState',
    'createInteractions', 'enhanceInteractions',
    'createMermaidRegistry', 'collectMermaidBlocks', 'sanitizeSvg',
    'registerBuiltinComponents', 'registerBuiltinComponent', 'componentTypes',
    'componentSchema', 'componentSample', 'componentsSchemas', 'componentsCss', 'enhanceComponents',
    'mergeInstanceOverrides', 'saveAsComponent', 'validateOverrideSource',
    'createExportBundle', 'minifyCss', 'minifyJs',
    'buildRuntime', 'selectRuntimeModules', 'runtimeUtil',
    'registerDataSource', 'resolveDataSource', 'dataSourceNames',
    'componentDefaults', 'blockDefaults', 'getComponentDefaults', 'getBlockDefaults',
    'normalizePageSize', 'pageSizeStyle', 'hasPageSize'
  ];

  /* runtimeUtil 是工具对象而非函数，完整性检查按「可用」判定。 */
  var missing = REQUIRED.filter(function (name) {
    var value = R[name];
    if (value == null) return true;
    return typeof value !== 'function' && typeof value !== 'object';
  });

  R.version = VERSION;
  R.ready = missing.length === 0;
  R.missing = missing;

  if (missing.length && typeof console !== 'undefined') {
    console.error('[lc render] 缺少模块：' + missing.join(', ') + '。请检查脚本加载顺序。');
  }

  return R;
}));
