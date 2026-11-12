/* 渲染核心 · 性能基准数据
   在样例站点上追加三个压力页，只在性能验收里使用，不进入常规 16 页自检。
   浏览器挂到 window.LC_PERF_SITE；Node 里直接 module.exports。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./site.data.js'));
  } else {
    root.LC_PERF_SITE = factory(root.LC_SAMPLE_SITE);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (base) {
  'use strict';

  var OWNERS = ['产品', '设计', '前端', '后端', '测试', '运维'];
  var STATUS = ['待开始', '进行中', '已完成', '已阻塞'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* 固定数据，保证多次基准之间可比。 */
  function makeRows(count) {
    var rows = [];
    for (var i = 0; i < count; i += 1) {
      rows.push({
        id: 'row-' + i,
        name: '任务 ' + (i + 1) + ' · ' + ['需求', '设计', '开发', '联调', '回归'][i % 5],
        owner: OWNERS[i % OWNERS.length],
        status: STATUS[i % STATUS.length],
        amount: ((i * 37) % 9000) + 100,
        date: '2026-' + ('0' + ((i % 12) + 1)).slice(-2) + '-' + ('0' + ((i % 28) + 1)).slice(-2)
      });
    }
    return rows;
  }

  function tablePage(id, count) {
    return {
      id: id,
      slug: id.replace(/^page-/, ''),
      path: id.replace(/^page-/, '') + '.html',
      title: count + ' 行表格',
      nav: { label: count + ' 行表格' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      blocks: [
        {
          id: id + '-hero',
          type: 'heading',
          level: 1,
          text: count + ' 行 · 虚拟滚动',
          sub: '只渲染可视区加缓冲行；滚动条高度按总行数换算，End 键可直接到底。'
        },
        {
          id: id + '-table',
          type: 'ui-table',
          caption: count + ' 行数据',
          pageSize: 0,
          height: 420,
          selectable: true,
          columns: [
            { key: 'name', title: '任务', width: '30%' },
            { key: 'owner', title: '负责人', width: 90 },
            { key: 'status', title: '状态', width: 100 },
            { key: 'amount', title: '金额', align: 'right', width: 110, format: 'number' },
            { key: 'date', title: '日期', width: 120, format: 'date' }
          ],
          rows: makeRows(count)
        }
      ]
    };
  }

  /* 20 张图片：19 张本地 SVG，1 张故意 404，用来验收失败占位。 */
  function imagePage() {
    var blocks = [{
      id: 'perf-img-hero',
      type: 'heading',
      level: 1,
      text: '图片懒加载',
      sub: '视口外不发起请求；宽高占位避免跳动；失败有占位与说明。'
    }];
    for (var i = 1; i <= 20; i += 1) {
      blocks.push({
        id: 'perf-img-' + i,
        type: 'ui-image',
        src: 'assets/photo.svg?i=' + i,
        alt: '示例图片 ' + i,
        width: 320,
        height: 180,
        ratio: '16:9',
        caption: '第 ' + i + ' 张 · 懒加载',
        lazy: true
      });
    }
    blocks.push({
      id: 'perf-img-missing',
      type: 'ui-image',
      src: 'assets/missing.svg',
      alt: '故意缺失的图片',
      width: 320,
      height: 180,
      caption: '失败占位验收',
      errorText: '这张示例图不存在，展示失败占位。',
      lazy: true
    });
    return {
      id: 'page-perf-images',
      slug: 'perf-images',
      path: 'perf-images.html',
      title: '图片懒加载',
      nav: { label: '图片懒加载' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      blocks: blocks
    };
  }

  function stressPage(count) {
    var blocks = [];
    var tones = ['info', 'warn', 'ok'];
    for (var i = 0; i < count; i += 1) {
      if (i % 50 === 0) {
        blocks.push({
          id: 'perf-stress-h-' + i,
          type: 'heading',
          level: 2,
          text: '区块组 ' + (i / 50 + 1),
          sub: '第 ' + (i + 1) + ' / ' + count + ' 个区块'
        });
      } else if (i % 10 === 0) {
        blocks.push({
          id: 'perf-stress-note-' + i,
          type: 'note',
          tone: tones[i % tones.length],
          title: '提示 ' + (i + 1),
          md: '这段提示用于填充页面高度，**不包含**业务数据，也不发起任何请求。'
        });
      } else if (i % 7 === 0) {
        blocks.push({
          id: 'perf-stress-cards-' + i,
          type: 'cards',
          columns: 2,
          cards: [
            { tag: 'A', title: '卡片 ' + (i + 1), body: '压测区块，无外部依赖。' },
            { tag: 'B', title: '卡片 ' + (i + 2), body: '用于观察首屏渲染耗时。' }
          ]
        });
      } else {
        blocks.push({
          id: 'perf-stress-p-' + i,
          type: 'paragraph',
          md: '第 ' + (i + 1) + ' 段：渲染核心在静态导出时按区块顺序生成节点，这段文字只用于测量渲染与布局耗时。'
        });
      }
    }
    return {
      id: 'page-perf-stress',
      slug: 'perf-stress',
      path: 'perf-stress.html',
      title: count + ' 区块压力页',
      nav: { label: count + ' 区块压力页' },
      layout: { mode: 'flow' },
      shell: { header: true, footer: true, breadcrumb: false },
      blocks: blocks
    };
  }

  var site = clone(base || {});
  /* 反向对照页：同一份数据关闭虚拟滚动，只用于基准对比。 */
  function fullPage(id, count) {
    var page = tablePage(id, count);
    page.nav = { label: String(count) + ' 行全量（对照）' };
    page.blocks.forEach(function (block) { if (block.type === 'ui-table') block.virtual = false; });
    return page;
  }
  site.pages = (site.pages || []).concat([
    tablePage('page-perf-table-1k', 1000),
    tablePage('page-perf-table-10k', 10000),
    fullPage('page-perf-table-1k-full', 1000),
    fullPage('page-perf-table-10k-full', 10000),
    imagePage(),
    stressPage(500)
  ]);
  site.perf = { tableRows: [1000, 10000], imageCount: 20, stressBlocks: 500 };
  return site;
}));
