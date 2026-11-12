import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const fixture = path.join(root, 'data', '.fixtures', 'site-69fae0cc-e6e044c9');

async function makeSite(name) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-export-'));
  const siteDir = path.join(dataDir, 'sites', name);
  await fs.cp(fixture, siteDir, { recursive: true });
  return { dataDir, siteDir, paths: { dataDir, lockStaleMs: 60000 } };
}

test('服务端导出：渲染页面、装配资源与模板、生成 manifest、zip 与构建记录', async () => {
  const { dataDir, siteDir, paths } = await makeSite('site-69fae0cc-e6e044c9');
  const { exportSite } = await import('../server/src/export/pipeline.js');

  const result = await exportSite({
    platformRoot: root,
    paths,
    siteId: 'site-69fae0cc-e6e044c9',
    target: 'web-static',
    minify: true,
    version: '1.0.0',
    platform: { name: '低代码工作台', version: '0.1.0' }
  });

  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.status, 'success');
  assert.equal(result.record.minify.enabled, true);
  assert.equal(result.record.minify.html, false);
  assert.equal(result.record.minify.saved > 0, true);
  assert.equal(result.record.sourceRev >= 0, true);
  assert.equal(result.checks.find((item) => item.id === 'entry-exists').status, 'pass');

  const record = JSON.parse(await fs.readFile(path.join(siteDir, 'builds', result.buildId, 'build.json'), 'utf8'));
  assert.equal(record.buildRecordVersion, 1);
  assert.equal(record.manifest.checks.find((item) => item.id === 'offline-external').status, 'pass');
  assert.equal(record.minify.before > record.minify.after, true);

  const zipFile = path.join(siteDir, 'builds', result.buildId, 'artifact.zip');
  const zip = await JSZip.loadAsync(await fs.readFile(zipFile));
  assert.equal(zip.file('artifact-manifest.json') != null, true);

  const manifest = JSON.parse(await zip.file('artifact-manifest.json').async('string'));
  assert.equal(manifest.formatVersion, 4);
  assert.equal(manifest.target, 'web-static');
  assert.equal(manifest.entry, 'web/index.html');
  assert.equal(zip.file('README.txt') != null, true);
  assert.match(await zip.file('README.txt').async('string'), /http 访问/);

  const html = await zip.file('web/index.html').async('string');
  assert.match(html, /lc-http-required/);
  assert.match(html, /location\.protocol !== "file:"/);
  /* HTML 压缩默认关闭：不加构建头注释，正文按原样保留。 */
  assert.equal(html.includes('<!--site-'), false);
  assert.match(html, /^<!doctype html>\n<html/);
  assert.match(html, /assets\/css\/site\.css/);
  const runtime = await zip.file('web/assets/js/site.js').async('string');
  assert.match(runtime, /data-lc-mode/);

  await fs.rm(dataDir, { recursive: true, force: true });
});

test('导出前 Node 语法检查指出具体文件，坏文件阻断产物', async () => {
  const { checkUserCodeSyntax } = await import('../server/src/export/pipeline.js');
  const result = await checkUserCodeSyntax({
    'server/src/custom/bad.js': 'const a = ;',
    'server/src/custom/good.js': 'export const b = 1;'
  }, { language: 'none' });

  assert.equal(result.status, 'fail');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].file, 'server/src/custom/bad.js');
  assert.match(result.failures[0].message, /SyntaxError| Unexpected/);

  const ok = await checkUserCodeSyntax({ 'server/src/custom/good.js': 'export const b = 1;' }, { language: 'none' });
  assert.equal(ok.status, 'pass');
  assert.equal(ok.node.checked, 1);
});

test('同一站点构建期间再次导出被站点锁拒绝，不会并发写产物', async () => {
  const { dataDir, paths } = await makeSite('site-69fae0cc-e6e044c9');
  const { exportSite } = await import('../server/src/export/pipeline.js');
  const { SiteFileLock } = await import('../src/storage/locks.js');

  const lock = new SiteFileLock(
    path.join(dataDir, 'sites', 'site-69fae0cc-e6e044c9', '.lowcode', 'locks', 'builds', 'site.lock'),
    { siteId: 'site-69fae0cc-e6e044c9', staleMs: 60000 }
  );
  await lock.acquire();
  try {
    await assert.rejects(
      exportSite({ platformRoot: root, paths, siteId: 'site-69fae0cc-e6e044c9', target: 'web-static', minify: false }),
      /正在被另一个进程写入/
    );
  } finally {
    await lock.release();
  }

  await fs.rm(dataDir, { recursive: true, force: true });
});

test('同一分钟内连续导出使用不同 buildId，不覆盖上一条构建记录', async () => {
  const { dataDir, siteDir, paths } = await makeSite('site-69fae0cc-e6e044c9');
  const { exportSite } = await import('../server/src/export/pipeline.js');

  const first = await exportSite({ platformRoot: root, paths, siteId: 'site-69fae0cc-e6e044c9', target: 'web-static', minify: false });
  const second = await exportSite({ platformRoot: root, paths, siteId: 'site-69fae0cc-e6e044c9', target: 'web-static', minify: false });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.buildId, second.buildId);
  assert.equal(await fs.stat(path.join(siteDir, 'builds', first.buildId, 'build.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(siteDir, 'builds', second.buildId, 'build.json')).then(() => true), true);

  await fs.rm(dataDir, { recursive: true, force: true });
});

test('导出快照写清 capturedAt 与各集合条数，密钥文件不进包', async () => {
  const { dataDir, siteDir, paths } = await makeSite('site-69fae0cc-e6e044c9');
  const { exportSite } = await import('../server/src/export/pipeline.js');
  const siteId = 'site-69fae0cc-e6e044c9';

  const sources = {
    schemaVersion: 1,
    sources: [
      { id: 'api-orders', name: '订单接口', request: { method: 'GET', url: 'https://example.com/orders' } },
      { id: 'api-users', name: '用户接口', request: { method: 'GET', url: 'https://example.com/users' } }
    ]
  };
  const collection = {
    id: 'orders',
    name: '订单',
    fields: [
      { id: 'id', name: '编号', type: 'text' },
      { id: 'amount', name: '金额', type: 'number' }
    ],
    rows: [{ id: 'o1', amount: 10 }, { id: 'o2', amount: 20 }, { id: 'o3', amount: 30 }]
  };
  await fs.writeFile(path.join(siteDir, 'data', 'sources.json'), JSON.stringify(sources, null, 2));
  await fs.mkdir(path.join(siteDir, 'data', 'collections'), { recursive: true });
  await fs.writeFile(path.join(siteDir, 'data', 'collections', 'orders.json'), JSON.stringify(collection, null, 2));
  await fs.mkdir(path.join(siteDir, '.lowcode'), { recursive: true });
  await fs.writeFile(
    path.join(siteDir, '.lowcode', 'data-secrets.json'),
    JSON.stringify({ 'header:Authorization': 'Bearer secret-123' }, null, 2)
  );

  const result = await exportSite({
    platformRoot: root,
    paths,
    siteId,
    target: 'web-static',
    version: '1.0.0',
    platform: { name: '低代码工作台', version: '0.1.0' }
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));

  const zip = await JSZip.loadAsync(await fs.readFile(path.join(siteDir, 'builds', result.buildId, 'artifact.zip')));
  const snapshot = JSON.parse(await zip.file('web/data/snapshot.json').async('string'));
  assert.equal(Number.isNaN(Date.parse(snapshot.capturedAt)), false, 'capturedAt 必须是可解析时间');
  assert.deepEqual(snapshot.counts, { sources: 2, collections: 1, mocks: 0 });
  assert.deepEqual(snapshot.collections, [{ id: 'orders', name: '订单', rows: 3, fields: 2 }]);
  assert.equal(result.record.snapshot.enabled, true);
  assert.equal(result.record.snapshot.capturedAt, snapshot.capturedAt);
  assert.deepEqual(result.record.snapshot.collections, snapshot.collections);

  /* 密钥文件不在产物里，产物任何文件都不含密钥明文。 */
  const names = Object.keys(zip.files);
  assert.equal(names.some((name) => name.includes('.lowcode')), false);
  assert.equal(names.some((name) => name.includes('data-secrets')), false);
  for (const name of names) {
    if (zip.files[name].dir) continue;
    const text = await zip.file(name).async('string');
    assert.equal(text.includes('secret-123'), false, '产物文件不应包含密钥明文：' + name);
  }

  /* 关闭快照：不产出 web/data 快照文件。 */
  const second = await exportSite({
    platformRoot: root,
    paths,
    siteId,
    target: 'web-static',
    snapshotSources: false,
    version: '1.0.0',
    platform: { name: '低代码工作台', version: '0.1.0' }
  });
  assert.equal(second.ok, true, JSON.stringify(second.failures));
  assert.equal(second.record.snapshot.enabled, false);
  const secondZip = await JSZip.loadAsync(await fs.readFile(path.join(siteDir, 'builds', second.buildId, 'artifact.zip')));
  assert.equal(secondZip.file('web/data/snapshot.json'), null);
  assert.equal(secondZip.file('web/data/sources.json'), null);

  await fs.rm(dataDir, { recursive: true, force: true });
});

test('服务端导出可关闭压缩，报告与实际内容一致', async () => {
  const { dataDir, siteDir, paths } = await makeSite('site-69fae0cc-e6e044c9');
  const { exportSite } = await import('../server/src/export/pipeline.js');

  const result = await exportSite({
    platformRoot: root,
    paths,
    siteId: 'site-69fae0cc-e6e044c9',
    target: 'web-static',
    minify: false,
    version: '1.0.0'
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.record.minify.enabled, false);
  assert.equal(result.record.minify.before, 0);

  const zip = await JSZip.loadAsync(await fs.readFile(path.join(siteDir, 'builds', result.buildId, 'artifact.zip')));
  const html = await zip.file('web/index.html').async('string');
  assert.equal(html.includes('<!--site-'), false);
  assert.match(html, /<title>首页<\/title>/);

  await fs.rm(dataDir, { recursive: true, force: true });
});

test('组件模板内联脚本错误阻断导出，并写入构建日志与清单', async () => {
  const { dataDir, siteDir, paths } = await makeSite('site-69fae0cc-e6e044c9');
  const siteId = 'site-69fae0cc-e6e044c9';
  const homePath = path.join(siteDir, 'pages', 'home.json');
  const home = JSON.parse(await fs.readFile(homePath, 'utf8'));
  home.blocks.push({ type: 'component', componentId: 'custom-bad' });
  await fs.writeFile(homePath, JSON.stringify(home, null, 2));
  await fs.mkdir(path.join(siteDir, 'components'), { recursive: true });
  await fs.writeFile(path.join(siteDir, 'components', 'custom-bad.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'custom-bad',
    name: '坏脚本组件',
    category: 'content',
    icon: 'box',
    tags: [],
    description: '',
    fields: [],
    template: '<div>bad</div><script>this is not js</script>',
    css: '',
    js: ''
  }, null, 2));

  const { exportSite } = await import('../server/src/export/pipeline.js');
  const result = await exportSite({
    platformRoot: root,
    paths,
    siteId,
    target: 'web-static',
    minify: false,
    version: '1.0.0'
  });

  assert.equal(result.ok, false);
  const check = result.checks.find((item) => item.id === 'component-scripts');
  assert.equal(check.status, 'fail');
  assert.match(check.message, /custom-bad/);
  assert.equal(result.record.manifest.checks.find((item) => item.id === 'component-scripts').status, 'fail');
  const warning = result.record.manifest.warnings.find((item) => item.code === 'LC_W_COMPONENT_SCRIPT');
  assert.equal(warning.componentId, 'custom-bad');
  assert.match(warning.message, /内联脚本/);

  const log = await fs.readFile(path.join(siteDir, 'builds', result.buildId, 'log.txt'), 'utf8');
  assert.match(log, /LC_W_COMPONENT_SCRIPT/);
  assert.match(log, /custom-bad/);

  const zipFile = path.join(siteDir, 'builds', result.buildId, 'artifact.zip');
  assert.equal(await fs.stat(zipFile).then(() => true, () => false), false);

  await fs.rm(dataDir, { recursive: true, force: true });
});
