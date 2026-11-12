/* 渲染核心 · 外壳引用解析
   契约里导航/页脚通过 project.navigation.blockId / footer.blockId 引用区块。
   渲染层只负责找到那个区块，具体长什么样由注册表里的 siteNav / siteFooter 渲染器决定。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  function fromShellBlocks(shellBlocks, id) {
    if (!shellBlocks) return null;
    if (Array.isArray(shellBlocks)) {
      for (var i = 0; i < shellBlocks.length; i += 1) {
        if (shellBlocks[i] && shellBlocks[i].id === id) return shellBlocks[i];
      }
      return null;
    }
    return shellBlocks[id] || null;
  }

  function walk(blocks, id) {
    var found = null;
    (blocks || []).forEach(function (block) {
      if (found || !block) return;
      if (block.id === id) { found = block; return; }
      if (Array.isArray(block.blocks)) found = walk(block.blocks, id);
    });
    return found;
  }

  function resolveShellBlock(site, id) {
    if (!site || !id) return null;
    var direct = fromShellBlocks(site.shellBlocks, id);
    if (direct) return direct;
    var pages = site.pages || [];
    for (var i = 0; i < pages.length && !direct; i += 1) {
      direct = walk(pages[i] && pages[i].blocks, id);
    }
    return direct || null;
  }

  R.resolveShellBlock = resolveShellBlock;

  return R;
}));
