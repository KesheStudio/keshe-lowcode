/* 渲染核心 · 注册表
   渲染引擎不内置业务组件。区块渲染器、自定义组件、动作处理器全部从这里接入。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  function createRegistry() {
    var blocks = {};
    var components = {};
    var actions = {};

    var api = {
      registerBlock: function (type, def) {
        if (!type || typeof type !== 'string') throw new Error('registerBlock 需要字符串 type');
        if (!def || typeof def.render !== 'function') throw new Error('区块 ' + type + ' 缺少 render 函数');
        blocks[type] = def;
        return api;
      },
      registerComponent: function (component) {
        if (!component || !component.id) throw new Error('registerComponent 需要 component.id');
        components[component.id] = component;
        return api;
      },
      registerAction: function (type, handler) {
        if (!type || typeof handler !== 'function') throw new Error('registerAction 需要 type 与 handler');
        actions[type] = handler;
        return api;
      },
      block: function (type) { return blocks[type] || null; },
      component: function (id) { return components[id] || null; },
      action: function (type) { return actions[type] || null; },
      hasBlock: function (type) { return !!blocks[type]; },
      hasComponent: function (id) { return !!components[id]; },
      listBlocks: function () { return Object.keys(blocks); },
      listComponents: function () { return Object.keys(components); },
      listActions: function () { return Object.keys(actions); }
    };
    return api;
  }

  R.createRegistry = createRegistry;

  return R;
}));
