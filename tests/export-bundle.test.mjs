import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EB = require('../shared/export-bundle.js');

const createdAt = '2026-11-08T04:30:00.000Z';
const artifactId = 'site-20261108-0430';

function baseFiles() {
  return {
    'web/index.html': '<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"></head>' +
      '<body><main>示例</main><script src="assets/site.js" defer></script></body></html>',
    'web/assets/site.css': 'body{margin:0;color:#222}',
    'web/assets/site.js': 'console.log("site");',
    'data/articles.js': 'window.CZ_ARTICLES={articles:[]};'
  };
}

function baseInput(extra) {
  return Object.assign({
    target: 'web-static',
    artifactId,
    createdAt,
    platform: { name: 'lowcode', version: '0.1.0', contractsVersion: '2.0.0' },
    project: { id: 'site-1', name: '示例站点', config: { siteName: '示例站点' } },
    files: baseFiles(),
    backend: { language: 'none' }
  }, extra || {});
}

function checkOf(result, id) {
  return result.checks.find((item) => item.id === id);
}

test('目标目录约定与路径分类', () => {
  const web = EB.layoutFor('web-static');
  assert.equal(web.entry, 'web/index.html');
  assert.deepEqual(web.dirs, ['web', 'server', 'deploy', 'data', 'vendor']);

  const tauri = EB.layoutFor('tauri-desktop');
  assert.equal(tauri.entry, 'web/index.html');
  assert.equal(tauri.dirs.includes('desktop'), true);

  assert.equal(EB.categoryOf('artifact-manifest.json'), 'meta');
  assert.equal(EB.categoryOf('web/index.html'), 'web');
  assert.equal(EB.categoryOf('server/Cargo.toml'), 'server');
  assert.equal(EB.categoryOf('vendor/mermaid.min.js'), 'vendor');
  assert.equal(EB.categoryOf('misc.txt'), 'other');
});

test('web-static 最小产物：清单 v4、稳定排序、自检通过', async () => {
  const result = await EB.assemble(baseInput());
  const manifest = result.manifest;

  assert.equal(result.ok, true);
  assert.equal(manifest.formatVersion, 4);
  assert.equal(manifest.artifactId, artifactId);
  assert.equal(manifest.target, 'web-static');
  assert.equal(manifest.entry, 'web/index.html');
  assert.equal(manifest.secrets.included, false);

  const paths = manifest.files.map((item) => item.path);
  assert.deepEqual(paths, paths.slice().sort());
  assert.equal(paths.includes('artifact-manifest.json'), false);
  assert.equal(paths.includes('README.md'), true);
  assert.equal(paths.includes('README.txt'), true);
  assert.match(result.files['README.txt'], /http 访问/);
  assert.match(result.files['README.md'], /必须通过 http 访问/);
  assert.equal(EB.categoryOf('README.txt'), 'meta');
  assert.equal(paths.includes('THIRD-PARTY-NOTICES.md'), true);
  assert.equal(paths.includes('lowcode-project.json'), true);
  assert.equal(paths.includes('web/index.html'), true);

  for (const item of manifest.files) {
    assert.equal(item.sha256.length, 64, `${item.path} 的 sha256 长度`);
    assert.equal(item.size > 0, true, `${item.path} 的 size`);
  }

  assert.equal(checkOf(result, 'entry-exists').status, 'pass');
  assert.equal(checkOf(result, 'offline-external').status, 'pass');
  assert.equal(checkOf(result, 'secrets-scan').status, 'pass');
  assert.equal(checkOf(result, 'path-safety').status, 'pass');
  assert.equal(checkOf(result, 'vendor-sync').status, 'pass');
  assert.equal(checkOf(result, 'backend-config-valid').status, 'skip');
  assert.equal(checkOf(result, 'nginx-valid').status, 'skip');
  assert.equal(checkOf(result, 'cert-pair').status, 'skip');

  assert.equal(manifest.size.byCategory.web > 0, true);
  assert.equal(manifest.size.byCategory.meta > 0, true);
  assert.equal(manifest.size.total, manifest.files.reduce((sum, item) => sum + item.size, 0));
});

test('同输入两次组装，manifest 完全一致（时间戳由调用方固定）', async () => {
  const first = await EB.assemble(baseInput());
  const second = await EB.assemble(baseInput());
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
  assert.equal(JSON.stringify(first.files), JSON.stringify(second.files));
});

test('外链脚本会让离线检查失败，但不影响路径与密钥检查', async () => {
  const files = baseFiles();
  files['web/index.html'] = files['web/index.html'].replace(
    '<script src="assets/site.js" defer></script>',
    '<script src="https://cdn.example.com/lib.js"></script>'
  );
  const result = await EB.assemble(baseInput({ files }));

  assert.equal(result.ok, false);
  assert.equal(checkOf(result, 'offline-external').status, 'fail');
  assert.match(checkOf(result, 'offline-external').message, /外链脚本/);
  assert.equal(checkOf(result, 'secrets-scan').status, 'pass');
});

test('私钥内容与私钥文件名都会被拦下，secrets 永远标记为未包含', async () => {
  const files = baseFiles();
  files['web/notes.txt'] = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
  files['web/id_rsa'] = 'secret material';
  const result = await EB.assemble(baseInput({ files }));

  assert.equal(result.ok, false);
  assert.equal(result.manifest.secrets.included, false);
  const scan = checkOf(result, 'secrets-scan');
  assert.equal(scan.status, 'fail');
  assert.match(scan.message, /LC_E_SECRET_LEAK/);
  assert.match(scan.message, /web\/notes.txt/);
  assert.match(scan.message, /web\/id_rsa/);
});

test('越界路径被 path-safety 拦下', async () => {
  const files = baseFiles();
  files['../evil.js'] = 'x';
  files['C:/tmp/a.js'] = 'x';
  const result = await EB.assemble(baseInput({ files }));

  assert.equal(result.ok, false);
  const safety = checkOf(result, 'path-safety');
  assert.equal(safety.status, 'fail');
  assert.match(safety.message, /越界/);
  assert.match(safety.message, /..\/evil.js/);
  assert.match(safety.message, /盘符/);
});

test('本地引用缺文件时 vendor-sync 失败，列出页面与引用', async () => {
  const files = baseFiles();
  delete files['web/assets/site.css'];
  const result = await EB.assemble(baseInput({ files }));

  assert.equal(result.ok, false);
  const sync = checkOf(result, 'vendor-sync');
  assert.equal(sync.status, 'fail');
  assert.match(sync.message, /web\/index.html/);
  assert.match(sync.message, /assets\/site.css/);
});

test('按引用打包的第三方库进入 bundledAssets、许可证清单与体积警告', async () => {
  const files = baseFiles();
  files['web/assets/js/mermaid.min.js'] = '/*! mermaid 12.3.0 | MIT */\nconsole.log("mermaid");';
  const bundledAssets = [{
    path: 'web/assets/js/mermaid.min.js',
    package: 'mermaid@12.3.0',
    license: 'MIT',
    bytes: EB.byteSize(files['web/assets/js/mermaid.min.js'])
  }];
  const result = await EB.assemble(baseInput({ files, bundledAssets }));

  assert.equal(result.manifest.bundledAssets.length, 1);
  assert.equal(result.manifest.bundledAssets[0].package, 'mermaid@12.3.0');
  assert.equal(result.manifest.bundledAssets[0].sha256.length, 64);
  assert.match(result.files['THIRD-PARTY-NOTICES.md'], /mermaid/);
  assert.match(result.files['THIRD-PARTY-NOTICES.md'], /MIT/);
  assert.equal(result.warnings.some((item) => item.code === 'LC_W_ASSET_BYTES'), false);

  const heavyResult = await EB.assemble(baseInput({
    bundledAssets: [{
      path: 'web/assets/js/mermaid.min.js',
      package: 'mermaid@12.3.0',
      license: 'MIT',
      bytes: EB.EXPORT_WARN_BYTES + 1
    }]
  }));
  assert.equal(heavyResult.warnings.some((item) => item.code === 'LC_W_ASSET_BYTES'), true);
});

test('lowcode-project.json 不携带密钥类字段，但保留设计令牌', async () => {
  const project = {
    id: 'site-1',
    name: '示例站点',
    config: {
      siteName: '示例站点',
      theme: { shared: { tokens: { 'color-ink': '#222' } } },
      deploy: { backend: { password: 'super-secret', privateKey: '-----BEGIN PRIVATE KEY-----' } },
      api: { accessToken: 'tok', publicTokenName: 'ok-name' }
    }
  };
  const result = await EB.assemble(baseInput({ project }));
  const snapshot = JSON.parse(result.files['lowcode-project.json']);
  const text = result.files['lowcode-project.json'];

  assert.equal(snapshot.format, 'lowcode-project');
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.project.id, 'site-1');
  assert.deepEqual(snapshot.project.config.theme.shared.tokens, { 'color-ink': '#222' });
  assert.equal(text.includes('super-secret'), false);
  assert.equal(text.includes('BEGIN PRIVATE KEY'), false);
  assert.equal(text.includes('"accessToken"'), false);
  assert.equal(text.includes('publicTokenName'), true);
});

test('不支持的目标抛 LC_E_TARGET_INVALID', async () => {
  await assert.rejects(
    () => EB.assemble(baseInput({ target: 'unknown-target' })),
    (error) => error && error.code === 'LC_E_TARGET_INVALID'
  );
});

test('浏览器分支（无 module / 无 node:crypto）用 WebCrypto 产出同一份清单', async () => {
  const source = fs.readFileSync(new URL('../shared/export-bundle.js', import.meta.url), 'utf8');
  const sandbox = { TextEncoder, TextDecoder, crypto: globalThis.crypto, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'shared/export-bundle.js' });

  const browserEB = sandbox.LC && sandbox.LC.ExportBundle;
  assert.equal(typeof browserEB.assemble, 'function');

  const result = await browserEB.assemble(baseInput());
  assert.equal(result.ok, true);
  assert.equal(result.manifest.formatVersion, 4);
  assert.equal(result.manifest.files[0].sha256.length, 64);
  assert.equal(result.files['README.md'].includes('安全说明'), true);
});

test('上传目标配置随产物带走：保留目标、请求头与字段名，剔除私钥字段并记警告', async () => {
  const project = {
    id: 'site-1',
    name: '示例站点',
    config: {
      upload: {
        enabled: true,
        targetType: 'absolute',
        target: 'https://upload.example.com/api/v1/files',
        method: 'POST',
        fileField: 'attachment',
        headers: {
          Authorization: 'Bearer upload-token',
          'X-Api-Key': 'upload-key',
          'X-Trace-Id': 'lc-upload'
        },
        fields: { bucket: 'site-assets', visibility: 'public' },
        privateKey: '-----BEGIN PRIVATE KEY-----',
        maxBytes: 33554432
      }
    }
  };
  const result = await EB.assemble(baseInput({ project }));
  const snapshot = JSON.parse(result.files['lowcode-project.json']);
  const upload = snapshot.project.config.upload;

  assert.equal(upload.targetType, 'absolute');
  assert.equal(upload.target, 'https://upload.example.com/api/v1/files');
  assert.equal(upload.fileField, 'attachment');
  assert.equal(upload.headers.Authorization, 'Bearer upload-token');
  assert.equal(upload.headers['X-Api-Key'], 'upload-key');
  assert.equal(upload.fields.bucket, 'site-assets');
  assert.equal(upload.privateKey, undefined);
  assert.equal(result.files['lowcode-project.json'].includes('BEGIN PRIVATE KEY'), false);
  assert.equal(result.warnings.some((item) => item.code === 'LC_W_UPLOAD_HEADERS'), true);
});

test('tauri-desktop 使用同一套清单，入口仍是 web/index.html', async () => {
  const result = await EB.assemble(baseInput({
    target: 'tauri-desktop',
    runtime: 'tauri-desktop',
    signing: { status: 'unsigned' }
  }));

  assert.equal(result.manifest.target, 'tauri-desktop');
  assert.equal(result.manifest.entry, 'web/index.html');
  assert.equal(result.manifest.signing.status, 'unsigned');
  assert.match(result.files['README.md'], /desktop\//);
  assert.equal(result.files['README.txt'], undefined);
  assert.equal(result.ok, true);
});
