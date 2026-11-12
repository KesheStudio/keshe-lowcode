/* 渲染核心 · 内置组件聚合
   Node 侧显式 require 全部组件，浏览器侧读取 R.Components。
   每个组件都可以单独注册；全部注册只是批量循环。组件之间不互相 require。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var table = require('./components/table.js');
    var image = require('./components/image.js');
    var form = require('./components/form.js');
    var overlay = require('./components/overlay.js');
    var tabs = require('./components/tabs.js');
    var carousel = require('./components/carousel.js');
    var timeline = require('./components/timeline.js');
    var code = require('./components/code.js');
    var state = require('./components/state.js');
    var textfield = require('./components/textfield.js');
    var otp = require('./components/otp.js');
    var upload = require('./components/upload.js');
    var date = require('./components/date.js');
    var slider = require('./components/slider.js');
    var autocomplete = require('./components/autocomplete.js');
    var controls = require('./components/controls.js');
    var shell = require('./components/shell.js');
    var charts = require('./components/charts.js');
    var stats = require('./components/stats.js');
    var samples = require('./components/samples.js');
    var defs = {};
    [table, image, form, overlay.modal, overlay.drawer, tabs, carousel, timeline, code, state,
      textfield, otp, upload, date, slider, autocomplete].forEach(function (def) {
      if (def && def.type) defs[def.type] = def;
    });
    [controls, shell, charts, stats].forEach(function (group) {
      Object.keys(group || {}).forEach(function (type) {
        if (group[type] && group[type].type) defs[group[type].type] = group[type];
      });
    });
    Object.keys(defs).forEach(function (type) {
      if (defs[type] && samples[type] && !defs[type].sample) defs[type].sample = samples[type];
    });
    module.exports = factory(defs);
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    var api = factory(root.LC.Render.Components || {});
    var R = root.LC.Render;
    Object.keys(api).forEach(function (key) { R[key] = api[key]; });
    root.LC.Builtins = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (defs) {
  'use strict';

  var map = defs || {};
  var ORDER = [
    'ui-table', 'ui-image', 'ui-form', 'ui-modal', 'ui-drawer', 'ui-tabs',
    'ui-carousel', 'ui-timeline', 'ui-code', 'ui-state',
    'ui-textfield', 'ui-otp', 'ui-upload',
    'ui-date', 'ui-slider', 'ui-autocomplete',
    'ui-select', 'ui-multiselect', 'ui-radio-group', 'ui-checkbox-group',
    'ui-switch', 'ui-number', 'ui-textarea', 'ui-tags', 'ui-cascader', 'ui-rating',
    'ui-chart-line', 'ui-chart-bar', 'ui-chart-pie', 'ui-chart-donut', 'ui-sparkline',
    'ui-kpi', 'ui-progress', 'ui-progress-ring',
    'ui-site-nav', 'ui-site-footer', 'ui-sidebar', 'ui-breadcrumb', 'ui-page-header'
  ];

  function componentDef(type) {
    return map[type] || null;
  }

  function registerBuiltinComponent(registry, type) {
    if (!registry || typeof registry.registerBlock !== 'function') {
      throw new Error('registerBuiltinComponent 需要注册表实例');
    }
    var def = componentDef(type);
    if (!def) throw new Error('未找到内置组件：' + type);
    registry.registerBlock(def.type, def);
    return def;
  }

  function registerBuiltinComponents(registry) {
    ORDER.forEach(function (type) {
      if (map[type]) registerBuiltinComponent(registry, type);
    });
    return registry;
  }

  function componentTypes() {
    return ORDER.filter(function (type) { return !!map[type]; });
  }

  function componentsSchemas() {
    return componentTypes().map(function (type) { return map[type].schema; });
  }

  function componentSchema(type) {
    return map[type] ? map[type].schema : null;
  }

  function componentSample(type) {
    var def = map[type];
    return def && def.sample ? JSON.parse(JSON.stringify(def.sample)) : null;
  }

  function componentsCss() {
    var seen = {};
    var out = [];
    componentTypes().forEach(function (type) {
      var def = map[type];
      if (def.sharedCss && def.sharedCssId && !seen['s:' + def.sharedCssId]) {
        seen['s:' + def.sharedCssId] = true;
        out.push(String(def.sharedCss));
      }
      if (def.css && !seen['d:' + type]) {
        seen['d:' + type] = true;
        out.push(String(def.css));
      }
    });
    return out.join('\n');
  }

  /* 内置组件的浏览器交互脚本。预览与导出页面不会像 demo 那样逐个加载源文件，
     Node 渲染时按页面实际用到的类型拼一份浏览器包，随页面脚本一起下发。
     demo 等浏览器直跑场景没有 require，返回空串，不影响原有加载方式。 */
  var RUNTIME_TYPE_FILES = {
    'ui-slider': ['dom.js', 'datasource.js', 'components/common.js', 'components/slider.js'],
    'ui-autocomplete': ['dom.js', 'datasource.js', 'components/common.js', 'components/autocomplete.js'],
    // 表格需要客户端 enhance 才能接住事件绑定回填的数据（空态表格要补骨架）。
    'ui-table': ['dom.js', 'datasource.js', 'components/common.js', 'components/table.js'],
    // 表单需要客户端 enhance 才有校验与 lc:form-submit 事件，页面脚本靠它接管提交。
    'ui-form': ['dom.js', 'datasource.js', 'components/common.js', 'components/form.js'],
    // 指标与图表依赖数据源才会动态取数，导出页面同样需要带上 enhance。
    'ui-kpi': ['dom.js', 'datasource.js', 'components/common.js', 'components/stats.js'],
    'ui-chart-pie': ['dom.js', 'datasource.js', 'components/common.js', 'components/charts.js'],
    'ui-chart-bar': ['dom.js', 'datasource.js', 'components/common.js', 'components/charts.js'],
    'ui-chart-line': ['dom.js', 'datasource.js', 'components/common.js', 'components/charts.js']
  };
  var runtimeCache = {};

  /* 类型列表里只保留有浏览器实现的类型；没有命中时返回空串。 */
  function builtinRuntimeSource(types) {
    if (typeof module !== 'object' || !module.exports || typeof require !== 'function') return '';
    var list = (types || []).filter(function (type) {
      return typeof type === 'string' && RUNTIME_TYPE_FILES[type];
    }).sort();
    if (!list.length) return '';
    var key = list.join('|');
    if (runtimeCache[key]) return runtimeCache[key];

    var fs = require('node:fs');
    var path = require('node:path');
    var files = ['dom.js', 'datasource.js', 'components/common.js'];
    list.forEach(function (type) {
      RUNTIME_TYPE_FILES[type].forEach(function (file) {
        if (files.indexOf(file) < 0) files.push(file);
      });
    });

    var parts = files.map(function (file) {
      return '/* ' + file + ' */\n' + fs.readFileSync(path.join(__dirname, file), 'utf8');
    });
    parts.push('(function () {\n' +
      '  "use strict";\n' +
      '  var R = window.LC && window.LC.Render;\n' +
      '  if (!R || !R.Components) return;\n' +
      '  var types = ' + JSON.stringify(list) + ';\n' +
      '  function run() {\n' +
      '    types.forEach(function (type) {\n' +
      '      var def = R.Components[type];\n' +
      '      if (!def || typeof def.enhance !== "function") return;\n' +
      '      var nodes = document.querySelectorAll(\'[data-lc-ui="\' + type + \'"]\');\n' +
      '      Array.prototype.forEach.call(nodes, function (node) {\n' +
      '        if (!node || node.getAttribute("data-lc-enhanced") === "true") return;\n' +
      '        try {\n' +
      '          def.enhance(node, {});\n' +
      '          node.setAttribute("data-lc-enhanced", "true");\n' +
      '        } catch (error) {\n' +
      '          if (typeof console !== "undefined") console.error("[lc] 内置组件增强失败：" + type, error);\n' +
      '        }\n' +
      '      });\n' +
      '    });\n' +
      '  }\n' +
      '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);\n' +
      '  else run();\n' +
      '  R.enhanceBuiltins = run;\n' +
      '})();');

    runtimeCache[key] = parts.join('\n\n');
    return runtimeCache[key];
  }

  /* 扫描容器内的 [data-lc-ui]，逐个调用组件自己的 enhance。
     每个实例只拿到自己的根节点；销毁时逐个回调，并把增强标记清掉以便重绘后再次增强。 */
  function enhanceComponents(host, options) {
    var scope = host || (typeof document !== 'undefined' ? document : null);
    var handles = [];
    if (scope && typeof scope.querySelectorAll === 'function') {
      Array.prototype.slice.call(scope.querySelectorAll('[data-lc-ui]')).forEach(function (el) {
        var type = el.getAttribute('data-lc-ui');
        var def = componentDef(type);
        if (!def || typeof def.enhance !== 'function') return;
        if (el.getAttribute('data-lc-enhanced') === 'true') return;
        var handle = null;
        try {
          handle = def.enhance(el, options || {});
        } catch (error) {
          if (el.setAttribute) el.setAttribute('data-lc-enhanced', 'error');
          if (typeof console !== 'undefined' && console.error) {
            console.error('[lc] 组件增强失败：' + type, error);
          }
          return;
        }
        if (el.setAttribute) el.setAttribute('data-lc-enhanced', 'true');
        handles.push({ el: el, handle: handle });
      });
    }
    var api = {
      size: handles.length,
      destroy: function () {
        handles.forEach(function (item) {
          try {
            if (item.handle && typeof item.handle.destroy === 'function') item.handle.destroy();
          } catch (error) {
            if (typeof console !== 'undefined' && console.error) console.error('[lc] 组件销毁失败', error);
          }
          if (item.el && item.el.removeAttribute) item.el.removeAttribute('data-lc-enhanced');
        });
        handles = [];
      }
    };
    return api;
  }

  return {
    componentDefs: map,
    componentTypes: componentTypes,
    componentSchema: componentSchema,
    componentSample: componentSample,
    componentsSchemas: componentsSchemas,
    componentsCss: componentsCss,
    registerBuiltinComponent: registerBuiltinComponent,
    registerBuiltinComponents: registerBuiltinComponents,
    enhanceComponents: enhanceComponents,
    builtinRuntimeSource: builtinRuntimeSource,
    builtinRuntimeTypes: RUNTIME_TYPE_FILES,
    builtinOrder: ORDER.slice()
  };
}));
