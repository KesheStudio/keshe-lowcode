import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EB = require('../shared/export-bundle.js');
const EA = require('../shared/export-assets.js');

const createdAt = '2026-11-08T05:00:00.000Z';
const artifactId = 'site-20261108-0500';

function siteFiles() {
  return {
    'web/index.html': '<!doctype html><html><body><img src="assets/images/logo.png" alt="logo">' +
      '<link rel="stylesheet" href="assets/css/small.css"></body></html>',
    'web/assets/css/small.css': 'body{margin:0}'
  };
}

function assembleInput(files, extra) {
  return Object.assign({
    target: 'web-static',
    artifactId,
    createdAt,
    project: { id: 'site-1', name: '示例站点', config: {} },
    files,
    backend: { language: 'none' }
  }, extra || {});
}

test('CONDITIONAL_ASSETS 是唯一一份表，只在页面引用 mermaid 时才打进去', () => {
  assert.equal(EA.CONDITIONAL_ASSETS.length, 1);
  const mermaid = EA.CONDITIONAL_ASSETS[0];
  assert.equal(mermaid.package, 'mermaid');
  assert.equal(mermaid.source, 'vendor/mermaid.min.js');
  assert.equal(mermaid.target, 'assets/js/mermaid.min.js');

  const plain = siteFiles();
  const selected = EA.selectConditionalAssets(EA.CONDITIONAL_ASSETS, plain);
  assert.equal(selected.length, 0);

  plain['web/index.html'] = '<pre class="mermaid">graph TD;A-->B</pre>';
  const withChart = EA.selectConditionalAssets(EA.CONDITIONAL_ASSETS, plain);
  assert.equal(withChart.length, 1);
});

test('第三方运行时按引用拷贝，缺源文件时不静默生成坏包', () => {
  const files = {
    'web/index.html': '<pre class="mermaid">graph TD</pre><script src="assets/js/mermaid.min.js"></script>'
  };
  const ok = EA.applyConditionalAssets({
    files,
    siteDir: 'web',
    conditionalSources: { 'vendor/mermaid.min.js': '/*! mermaid */\nconsole.log(1);' }
  });
  assert.equal(ok.bundled.length, 1);
  assert.equal(ok.bundled[0].path, 'web/assets/js/mermaid.min.js');
  assert.equal(ok.bundled[0].package, 'mermaid@12.3.0');
  assert.equal(ok.bundled[0].bytes > 0, true);
  assert.equal(typeof ok.files['web/assets/js/mermaid.min.js'], 'string');

  const missing = EA.applyConditionalAssets({ files: { 'web/index.html': files['web/index.html'] }, siteDir: 'web' });
  assert.equal(missing.bundled.length, 0);
  assert.equal(missing.missing.length, 1);
  assert.equal(missing.missing[0].source, 'vendor/mermaid.min.js');
});

test('被页面引用到的站点图片按二进制原样拷贝，嵌套页面的 ../ 能正确解析', () => {
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
  const files = {
    'web/docs/index.html': '<img src="../assets/images/logo.png">',
    'web/index.html': '<link rel="icon" href="assets/icons/favicon.svg">'
  };
  const result = EA.copyReferencedAssets({
    files,
    siteDir: 'web',
    assetSources: {
      'assets/images/logo.png': image,
      'assets/icons/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    }
  });

  assert.equal(result.copied.length, 2);
  assert.deepEqual(result.files['web/assets/images/logo.png'], image);
  assert.equal(result.files['web/docs/index.html'].includes('../assets/images/logo.png'), true);
  assert.equal(result.missing.length, 0);
});

test('CSS 内联：小且无 url()/import 才内联并删除源文件，大文件与带资源引用的保留', () => {
  const files = {
    'web/a.html': '<link rel="stylesheet" href="assets/css/a.css">',
    'web/b.html': '<link rel="stylesheet" href="assets/css/b.css">',
    'web/c.html': '<link rel="stylesheet" href="assets/css/c.css">',
    'web/assets/css/a.css': 'a{color:#333}',
    'web/assets/css/b.css': 'x'.repeat(5000),
    'web/assets/css/c.css': 'c{background:url(../images/bg.png)}'
  };
  const result = EA.inlineSmallCss({ files, siteDir: 'web', limit: 4096 });

  assert.match(result.files['web/a.html'], /<style data-lc-inlined="web\/assets\/css\/a.css">/);
  assert.match(result.files['web/a.html'], /a\{color:#333\}/);
  assert.equal(result.files['web/assets/css/a.css'], undefined);
  assert.equal(result.files['web/assets/css/b.css'] != null, true);
  assert.equal(result.files['web/assets/css/c.css'] != null, true);
  assert.equal(result.files['web/b.html'].includes('<link'), true);
  assert.equal(result.files['web/c.html'].includes('<link'), true);
  assert.equal(result.inlined.length, 1);
  assert.deepEqual(result.removed, ['web/assets/css/a.css']);
});

test('资源阶段总入口：拷贝图片 + 按需 mermaid + 内联 CSS，组装后自检通过', async () => {
  const files = {
    'web/index.html': '<!doctype html><html><body>' +
      '<img src="assets/images/logo.png">' +
      '<pre class="mermaid">graph TD;A-->B</pre>' +
      '<link rel="stylesheet" href="assets/css/small.css">' +
      '<script src="assets/js/mermaid.min.js"></script>' +
      '</body></html>',
    'web/assets/css/small.css': 'body{margin:0}'
  };
  const assets = EA.planAssets({
    files,
    siteDir: 'web',
    assetSources: { 'assets/images/logo.png': Buffer.from('PNG') },
    conditionalSources: { 'vendor/mermaid.min.js': '/*! mermaid | MIT */\nconsole.log("mermaid");' }
  });

  assert.equal(assets.missing.length, 0);
  assert.equal(assets.warnings.length, 0);
  assert.equal(assets.copied.includes('web/assets/images/logo.png'), true);
  assert.equal(assets.inlined.length, 1);
  assert.equal(assets.bundledAssets.length, 1);

  const result = await EB.assemble(assembleInput(assets.files, {
    bundledAssets: assets.bundledAssets,
    warnings: assets.warnings
  }));

  assert.equal(result.ok, true);
  assert.equal(result.manifest.bundledAssets.length, 1);
  assert.equal(result.manifest.bundledAssets[0].sha256.length, 64);
  assert.equal(result.manifest.files.some((item) => item.path === 'web/assets/images/logo.png'), true);
  assert.equal(result.manifest.files.some((item) => item.path === 'web/assets/css/small.css'), false);
  assert.match(result.files['THIRD-PARTY-NOTICES.md'], /mermaid/);
});

test('站点资源缺失时给出警告，并在清单自检里以 vendor-sync 失败拦下', async () => {
  const files = { 'web/index.html': '<img src="assets/images/none.png">' };
  const assets = EA.planAssets({ files, siteDir: 'web', assetSources: {} });

  assert.equal(assets.missing.length, 1);
  assert.equal(assets.warnings.length, 1);
  assert.equal(assets.warnings[0].code, 'LC_W_ASSET_MISSING');

  const result = await EB.assemble(assembleInput(assets.files, { warnings: assets.warnings }));
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.id === 'vendor-sync').status, 'fail');
});

test('浏览器分支：先加载 export-bundle，再加载 export-assets，资源计划可用', async () => {
  const bundleSource = fs.readFileSync(new URL('../shared/export-bundle.js', import.meta.url), 'utf8');
  const assetsSource = fs.readFileSync(new URL('../shared/export-assets.js', import.meta.url), 'utf8');
  const sandbox = { TextEncoder, TextDecoder, crypto: globalThis.crypto, console };
  vm.createContext(sandbox);
  vm.runInContext(bundleSource, sandbox, { filename: 'shared/export-bundle.js' });
  vm.runInContext(assetsSource, sandbox, { filename: 'shared/export-assets.js' });

  const browserEA = sandbox.LC.ExportAssets;
  assert.equal(browserEA.CONDITIONAL_ASSETS.length, 1);

  const result = browserEA.planAssets({
    files: { 'web/index.html': '<img src="assets/images/logo.png">' },
    siteDir: 'web',
    assetSources: { 'assets/images/logo.png': Buffer.from('PNG') }
  });
  assert.equal(result.files['web/assets/images/logo.png'] != null, true);
  assert.equal(result.missing.length, 0);
});
