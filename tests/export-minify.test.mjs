import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../shared/export-minify.js');

const meta = {
  artifactId: 'site-20261108-1200',
  createdAt: '2026-11-08T12:00:00.000Z',
  version: '1.2.3',
  title: '示例站点'
};

test('HTML 压缩开关打开时压缩内联块，并写入一行头部注释', () => {
  const files = {
    'web/index.html': '<!doctype html>\n<html>\n  <head>\n    <style>  .a { color: red; }  </style>\n  </head>\n  <body>\n    <p>示例</p>\n  </body>\n</html>',
    'web/assets/css/site.css': Array.from({ length: 40 }, (_, index) =>
      '.item-' + index + ' {\n    color: red;\n    padding: 4px 8px;\n}\n').join('\n'),
    'web/assets/js/site.js': 'var a = 1;\n// 普通注释\nvar b = 2;\nfunction run() { return a + b; }\n'
  };
  const result = M.applyMinify({ files, siteDir: 'web', enabled: true, html: true, ...meta });

  assert.equal(result.report.enabled, true);
  assert.equal(result.report.html, true);
  assert.equal(result.report.applied, true);
  assert.equal(result.report.files.length, 3);
  assert.equal(result.report.files.find((item) => item.kind === 'css').saved > 0, true);
  /* 小文件加头部注释后总体积可能反向增加，报告需如实记录。 */
  assert.equal(typeof result.report.saved, 'number');

  const html = result.files['web/index.html'];
  assert.match(html, /^<!doctype html>\n<!--site-20261108-1200\|2026-11-08T12:00:00Z\|1\.2\.3-->/);
  assert.match(html, /<p>示例<\/p>/);

  const css = result.files['web/assets/css/site.css'];
  assert.match(css, /\/\*site-20261108-1200\|2026-11-08T12:00:00Z\|1\.2\.3\*\//);
  assert.equal(css.includes('.item-0 {\n'), false);
  assert.match(css, /\.item-39\{color:red;padding:4px 8px;\}/);

  const js = result.files['web/assets/js/site.js'];
  assert.match(js, /\/\*site-20261108-1200/);
  assert.equal(js.includes('普通注释'), false);
  assert.match(js, /function run\(\)/);
});

test('第三方许可证注释与 /*! 保留，不被压掉', () => {
  const license = '/*! mermaid 12.3.0 | MIT License | Copyright (c) 2014-2024 Knut Sveidqvist */';
  const cssLicense = '/*!\n * Bootstrap v5.0\n * Copyright 2011-2024 The Bootstrap Authors\n * Licensed under MIT\n */';
  const result = M.applyMinify({
    files: {
      'web/assets/js/app.js': license + '\nvar a = 1;\nfunction f() { return a; }\n',
      'web/assets/css/app.css': cssLicense + '\n.a { color: red; }\n'
    },
    siteDir: 'web',
    enabled: true,
    ...meta
  });

  assert.match(result.files['web/assets/js/app.js'], /mermaid 12\.3\.0 \| MIT License/);
  assert.match(result.files['web/assets/css/app.css'], /Copyright 2011-2024 The Bootstrap Authors/);
});

test('HTML 压缩默认关闭，CSS/JS 仍压缩，并记录跳过原因', () => {
  const source = '<!doctype html>\n<html>\n<body>\n  <p>示例</p>\n</body>\n</html>';
  const result = M.applyMinify({ files: { 'web/index.html': source, 'web/assets/css/a.css': '.a { color: red; }' }, siteDir: 'web', enabled: true, ...meta });

  assert.equal(result.report.html, false);
  assert.equal(result.files['web/index.html'], source);
  assert.equal(result.files['web/assets/css/a.css'].startsWith('/*site-'), true);
  assert.equal(result.report.skipped.some((item) => item.path === 'web/index.html' && /默认关闭/.test(item.reason)), true);
});

test('关闭压缩时原样返回，报告标记 enabled=false', () => {
  const source = '<!doctype html>\n<html>\n<body>\n  <p>示例</p>\n</body>\n</html>';
  const result = M.applyMinify({ files: { 'web/index.html': source }, siteDir: 'web', enabled: false, ...meta });
  assert.equal(result.report.enabled, false);
  assert.equal(result.report.applied, false);
  assert.equal(result.files['web/index.html'], source);
  assert.equal(result.warnings.length, 0);
});

test('压缩后校验失败的文件降级为原内容并记警告', () => {
  const broken = 'a { color: red;';
  const result = M.applyMinify({
    files: { 'web/assets/css/broken.css': broken, 'web/assets/css/ok.css': '.a { color: red; }' },
    siteDir: 'web',
    enabled: true,
    ...meta
  });

  assert.equal(result.files['web/assets/css/broken.css'], broken);
  assert.equal(result.files['web/assets/css/ok.css'].startsWith('/*site-20261108-1200|'), true);
  assert.equal(result.warnings.some((item) => item.code === 'LC_W_MINIFY_FALLBACK' && item.message.includes('broken.css')), true);
  assert.equal(result.report.skipped.some((item) => item.path === 'web/assets/css/broken.css'), true);
});

test('第三方运行时与已压缩文件不参与压缩', () => {
  const vendor = 'var x = 1; // vendor';
  const result = M.applyMinify({
    files: {
      'web/vendor/lib.js': vendor,
      'web/assets/js/mermaid.min.js': vendor,
      'web/index.html': '<!doctype html><html><body>示例</body></html>'
    },
    siteDir: 'web',
    enabled: true,
    html: true,
    skipPaths: ['web/assets/js/mermaid.min.js'],
    ...meta
  });

  assert.equal(result.files['web/vendor/lib.js'], vendor);
  assert.equal(result.files['web/assets/js/mermaid.min.js'], vendor);
  assert.equal(result.report.skipped.length, 2);
});

test('浏览器分支：加载 bundle 后可用 LC.ExportMinify', () => {
  const sandbox = { TextEncoder, TextDecoder, console };
  vm.createContext(sandbox);
  for (const name of ['export-bundle.js', 'export-minify.js']) {
    vm.runInContext(fs.readFileSync(new URL('../shared/' + name, import.meta.url), 'utf8'), sandbox, { filename: 'shared/' + name });
  }
  assert.equal(typeof sandbox.LC.ExportMinify.applyMinify, 'function');
  const result = sandbox.LC.ExportMinify.applyMinify({
    files: { 'web/index.html': '<!doctype html><html><body>x</body></html>' },
    siteDir: 'web',
    enabled: true,
    html: true,
    artifactId: 'b1',
    createdAt: '2026-11-08T00:00:00.000Z',
    version: '1'
  });
  assert.match(result.files['web/index.html'], /<!--b1\|2026-11-08T00:00:00Z\|1-->/);
});
