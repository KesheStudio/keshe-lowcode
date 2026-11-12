/* 渲染核心 · 性能基准（Node 侧）
   运行：node --expose-gc src/render/samples/bench.cjs
   输出：每个场景的渲染耗时、HTML 体积、实际渲染行/区块数、堆内存增量。
   参数：
     --json   只输出 JSON，便于把数字贴进验收表
   Node 只能测「节点构建 + 序列化」，布局与绘制耗时由浏览器基准（demo.html 的 __LC_BENCH__）给出。
   对照页 page-perf-table-1k-full / 10k-full 用同一份数据关闭虚拟滚动。 */
(function () {
  'use strict';

  var R = require('../node.cjs');
  var site = R.loadModule('./samples/perf.data.js');
  var blocks = R.loadModule('./samples/blocks.js');

  var jsonOnly = process.argv.indexOf('--json') !== -1;

  function gc() { if (typeof global.gc === 'function') global.gc(); }

  function mb(bytes) { return Math.round((bytes / 1024 / 1024) * 10) / 10; }

  function round(ms) { return Math.round(ms * 10) / 10; }

  function makeRenderer() {
    var registry = R.createRegistry();
    blocks.registerSampleBlocks(registry);
    R.registerBuiltinComponents(registry);
    return R.createRenderer(site, { registry: registry, preview: true });
  }

  function countOf(text, pattern) {
    var matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  function runCase(name, pageRef, options) {
    var page = pageRef || name;
    var renderOptions = Object.assign({ themeId: 'ink-green', mode: 'light' }, options || {});
    gc();
    var before = process.memoryUsage().heapUsed;
    var renderer = makeRenderer();
    var t0 = process.hrtime.bigint();
    var result = renderer.render(page, renderOptions);
    var t1 = process.hrtime.bigint();
    var html = R.toHtml(result.node);
    var t2 = process.hrtime.bigint();
    gc();
    var after = process.memoryUsage().heapUsed;

    return {
      name: name,
      page: page,
      renderMs: round(Number(t1 - t0) / 1e6),
      htmlMs: round(Number(t2 - t1) / 1e6),
      totalMs: round(Number(t2 - t0) / 1e6),
      htmlKB: Math.round(html.length / 1024),
      rows: countOf(html, /class="lc-ui-tr"/g),
      pads: countOf(html, /lc-ui-virtual-pad/g),
      blocks: countOf(html, /data-lc-block="/g),
      images: countOf(html, /data-lc-ui="ui-image"/g),
      deferred: countOf(html, /data-lc-defer="true"/g),
      heapMB: mb(after - before),
      errors: result.report.errors().length
    };
  }

  var cases = [
    runCase('首页', 'page-home'),
    runCase('10k 虚拟滚动', 'page-perf-table-10k', { defer: true }),
    runCase('10k 全量对照', 'page-perf-table-10k-full', { defer: true }),
    runCase('1k 虚拟滚动', 'page-perf-table-1k', { defer: true }),
    runCase('1k 全量对照', 'page-perf-table-1k-full', { defer: true }),
    runCase('20 图懒加载', 'page-perf-images', { defer: true }),
    runCase('500 区块 · 延迟渲染', 'page-perf-stress', { defer: true }),
    runCase('500 区块 · 不延迟', 'page-perf-stress', { defer: false })
  ];

  /* 导出改造：大 JSON 移到 data/*.json，HTML 只留地址；这里测体积、构建与 JSON 解析耗时。 */
  function runBundle(name, pageRef, options) {
    var renderOptions = Object.assign({ themeId: 'ink-green', mode: 'light' }, options || {});
    var renderer = makeRenderer();
    var result = renderer.render(pageRef, renderOptions);
    var t0 = process.hrtime.bigint();
    var bundle = R.createExportBundle(result, { minify: true });
    var t1 = process.hrtime.bigint();
    var dataFile = (bundle.files || []).filter(function (file) { return file.type === 'data'; })[0];
    var parseMs = 0;
    if (dataFile) {
      var samples = [];
      for (var i = 0; i < 5; i += 1) {
        gc();
        var p0 = process.hrtime.bigint();
        JSON.parse(dataFile.content);
        var p1 = process.hrtime.bigint();
        samples.push(Number(p1 - p0) / 1e6);
      }
      samples.sort(function (a, b) { return a - b; });
      parseMs = round(samples[2]);
    }
    return {
      name: name,
      page: pageRef,
      htmlBeforeKB: Math.round(bundle.stats.htmlBeforeBytes / 1024),
      htmlAfterKB: Math.round(bundle.stats.htmlAfterBytes / 1024),
      dataKB: Math.round(bundle.stats.dataBytes / 1024),
      dataIslands: bundle.stats.dataIslands,
      bundleMs: round(Number(t1 - t0) / 1e6),
      parseMs: parseMs,
      runtimeKB: Math.round(bundle.runtime.bytes / 1024),
      dataName: dataFile ? dataFile.name : ''
    };
  }

  var bundles = [
    runBundle('首页', 'page-home', { defer: true }),
    runBundle('10k 虚拟滚动', 'page-perf-table-10k', { defer: true }),
    runBundle('10k 全量对照', 'page-perf-table-10k-full', { defer: true }),
    runBundle('1k 虚拟滚动', 'page-perf-table-1k', { defer: true }),
    runBundle('1k 全量对照', 'page-perf-table-1k-full', { defer: true })
  ];

  if (jsonOnly) {
    console.log(JSON.stringify({ render: cases, bundles: bundles }, null, 2));
    return;
  }

  console.log('渲染核心性能基准 · Node（GC: ' + (typeof global.gc === 'function' ? 'on' : 'off，加 --expose-gc 更准') + '）');
  console.log('');
  console.log('场景                      渲染ms  HTMLms  合计ms   HTML    行   填充  区块  图片  延迟  堆增量');
  cases.forEach(function (item) {
    console.log(
      pad(item.name, 26) +
      pad(item.renderMs, 7) + pad(item.htmlMs, 8) + pad(item.totalMs, 8) +
      pad(item.htmlKB + 'KB', 9) + pad(item.rows, 6) + pad(item.pads, 6) +
      pad(item.blocks, 6) + pad(item.images, 6) + pad(item.deferred, 6) + pad(item.heapMB + 'MB', 8)
    );
  });

  console.log('');
  console.log('导出体积与数据加载');
  console.log('场景                      原HTML   导出HTML  数据文件  岛  构建ms  解析ms  运行时');
  bundles.forEach(function (item) {
    console.log(
      pad(item.name, 26) +
      pad(item.htmlBeforeKB + 'KB', 8) + pad(item.htmlAfterKB + 'KB', 10) +
      pad((item.dataKB ? item.dataKB + 'KB' : '—'), 10) + pad(item.dataIslands, 4) +
      pad(item.bundleMs, 8) + pad((item.parseMs || '—'), 8) + pad(item.runtimeKB + 'KB', 8)
    );
  });

  function pad(value, width) {
    var text = String(value);
    while (text.length < width) text += ' ';
    return text;
  }
}());
