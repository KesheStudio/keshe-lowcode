/* 渲染核心 · 导出产物 HTTP 自检
   运行：node src/render/samples/export-check.cjs
   把 10k 表格、20 图、500 区块三个页面写成独立的 index.html + styles.css + runtime.js + data/*.json，
   输出目录默认在系统临时目录；需要用任意静态服务器访问（不能双击 file://）。 */
(function () {
  'use strict';

  var fs = require('fs');
  var os = require('os');
  var path = require('path');
  var R = require('../node.cjs');

  var site = R.loadModule('./samples/perf.data.js');
  var blocks = R.loadModule('./samples/blocks.js');
  var registry = R.createRegistry();
  blocks.registerSampleBlocks(registry);
  R.registerBuiltinComponents(registry);
  var renderer = R.createRenderer(site, { registry: registry, preview: false });

  var root = path.join(os.tmpdir(), 'lc-render-filecheck');
  var cases = [
    { id: 'page-perf-table-10k', dir: 'table-10k' },
    { id: 'page-perf-table-10k', dir: 'table-inline', inline: true },
    { id: 'page-perf-images', dir: 'images' },
    { id: 'page-perf-stress', dir: 'stress' }
  ];

  fs.mkdirSync(root, { recursive: true });

  cases.forEach(function (item) {
    var result = renderer.render(item.id, { themeId: 'ink-green', mode: 'light', defer: true });
    var bundle = R.createExportBundle(result, { minify: false, externalData: item.inline ? false : true });
    var dir = path.join(root, item.dir);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'assets', 'photo.svg'), path.join(dir, 'assets', 'photo.svg'));
    bundle.files.forEach(function (file) {
      var target = path.join(dir, file.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, 'utf8');
    });
    var page = result.page || {};
    var html = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + String(page.title || item.id) + '</title>' +
      '<link rel="stylesheet" href="styles.css"></head><body>' +
      bundle.html + '\n<script src="runtime.js"></script>\n</body></html>\n';
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    console.log(path.join(dir, 'index.html') + '  runtime=' + bundle.runtime.bytes + 'B modules=' +
      bundle.runtime.modules.join(',') + (bundle.data ? '  data=' + bundle.data.name + ' ' + bundle.data.bytes + 'B' : ''));
  });

  console.log('\n请用静态服务器访问上面的 index.html；双击 file:// 不可用（产物顶部会提示走 HTTP 或 Tauri）。');
}());
