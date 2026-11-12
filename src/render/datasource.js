/* 渲染核心 · 数据源接口
   组件不自己发请求：需要远程数据的组件统一从这里的注册表取数据源。
   平台侧注册方式：LC.Render.registerDataSource('user-search', {
     search: function (query, context) {
       // context: { signal, limit }
       // 返回 Promise<Array<{ label, value }>>；取消时可通过 signal.addEventListener('abort', ...)
       return Promise.resolve([]);
     }
   });
   没有注册的数据源会被组件识别为不可用，并优雅降级。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};
  R.dataSources = R.dataSources || {};

  function registerDataSource(name, source) {
    var key = String(name == null ? '' : name).trim();
    if (!key) throw new Error('数据源需要一个非空名称。');
    R.dataSources[key] = source;
    return source;
  }

  function resolveDataSource(ref) {
    if (typeof ref === 'function') return ref;
    if (ref && typeof ref === 'object' && typeof ref.search === 'function') return ref;
    var key = String(ref == null ? '' : ref).trim();
    return key ? (R.dataSources[key] || null) : null;
  }

  function dataSourceNames() {
    return Object.keys(R.dataSources);
  }

  R.registerDataSource = registerDataSource;
  R.resolveDataSource = resolveDataSource;
  R.dataSourceNames = dataSourceNames;

  return R;
}));
