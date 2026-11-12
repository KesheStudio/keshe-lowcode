import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';
import { checkCode } from '../server/src/code/check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = { 'x-lc-token': 'code-test-token' };

async function makeContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-code-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '代码覆盖测试', host: '127.0.0.1', port: 9791 },
    server: { bodyLimitBytes: 8 * 1024 * 1024, requestTimeoutMs: 30000 },
    logging: { level: 'silent' },
    paths,
    migration: { enabled: true },
    draftCache: { enabled: false }
  };
  const context = {
    platformRoot: ROOT,
    config,
    paths,
    runtime: { readOnly: false, readOnlyReason: '' },
    token: 'code-test-token',
    port: 9791,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, paths, context, app: await createServer(context) };
}

function componentPayload(overrides) {
  const base = {
    id: 'note-card',
    name: '笔记卡',
    template: '<article class="note-card"><h3>{{title}}</h3><p>{{body}}</p></article>',
    css: '.note-card { padding: 12px; }',
    js: "root.addEventListener('click', function () { root.classList.toggle('is-open'); });",
    fields: [
      { id: 'title', label: '标题', type: 'string', default: '标题' },
      { id: 'body', label: '正文', type: 'string', default: '内容' }
    ]
  };
  return Object.assign(base, overrides || {});
}

test('代码检查：JS 语法 + 最小运行，Rust/Go 只做结构检查', () => {
  const ok = checkCode({ language: 'javascript', code: 'var items = []; root.setAttribute("data-x", "1");' });
  assert.equal(ok.ok, true);
  assert.equal(ok.checks[0].status, 'pass');
  assert.equal(ok.checks.some((item) => item.id === 'run' && item.status === 'pass'), true);

  const syntax = checkCode({ language: 'javascript', code: 'var broken = ' });
  assert.equal(syntax.ok, false);
  assert.equal(syntax.checks[0].status, 'fail');

  /* 语法通过、运行期抛错要能被抓到，而不是等导出才发现。 */
  const runtime = checkCode({ language: 'javascript', code: 'throw new Error("boom");' });
  assert.equal(runtime.ok, false);
  assert.equal(runtime.checks.some((item) => item.id === 'run' && item.status === 'fail'), true);

  /* vm 里没有 require / process，不能借检查执行服务端能力。 */
  const escaped = checkCode({ language: 'javascript', code: 'require("node:fs");' });
  assert.equal(escaped.ok, false);

  const rust = checkCode({ language: 'rust', code: 'pub fn add(a: i32) -> i32 { a + 1 }' });
  assert.equal(rust.ok, true);
  assert.equal(rust.checks.some((item) => item.id === 'compile' && item.status === 'skipped'), true);

  const brokenRust = checkCode({ language: 'rust', code: 'pub fn add(a: i32 -> i32 { a + 1 }' });
  assert.equal(brokenRust.ok, false);

  const css = checkCode({ language: 'css', code: '.x { color: red; }' });
  assert.equal(css.ok, true);
  const brokenCss = checkCode({ language: 'css', code: '.x { color: red;' });
  assert.equal(brokenCss.ok, false);
});

test('后端用户区代码：白名单、保存/恢复、导出覆盖模板同名文件', async () => {
  const { dataDir, paths, app } = await makeContext();
  const { siteId, siteDir } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '代码站点' });
  const base = `/api/sites/${siteId}`;

  try {
    const listed = await app.inject({ method: 'GET', url: `${base}/code/backend?language=node`, headers: auth });
    assert.equal(listed.statusCode, 200, listed.body);
    const data = listed.json().data;
    assert.equal(data.language, 'node');
    assert.equal(data.files.some((item) => item.path === 'src/custom/routes.js'), true);
    assert.equal(data.files.every((item) => item.saved === false), true);

    const code = "export function guard(value) {\n  return String(value || '').trim();\n}\n";
    const saved = await app.inject({
      method: 'PUT',
      url: `${base}/code/backend`,
      headers: auth,
      payload: { language: 'node', path: 'src/custom/handlers/items.js', code }
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.file.saved, true);

    const stored = await fs.readFile(path.join(siteDir, 'backend', 'node', 'src', 'custom', 'handlers', 'items.js'), 'utf8');
    assert.equal(stored, code);

    const outside = await app.inject({
      method: 'PUT',
      url: `${base}/code/backend`,
      headers: auth,
      payload: { language: 'node', path: 'src/generated/routes/index.js', code: 'export {};' }
    });
    assert.equal(outside.statusCode, 400, outside.body);
    assert.equal(outside.json().error.code, 'LC_E_CODE_PATH');

    /* 打开后端语言并导出：站点用户区文件要覆盖模板同名文件。 */
    const config = await app.inject({
      method: 'PUT',
      url: `${base}/export/config`,
      headers: auth,
      payload: { backend: { language: 'node' } }
    });
    assert.equal(config.statusCode, 200, config.body);

    const { exportSite } = await import('../server/src/export/pipeline.js');
    const result = await exportSite({
      platformRoot: ROOT,
      paths,
      siteId,
      target: 'web-static',
      minify: false,
      version: '1.0.0',
      platform: { name: '低代码工作台', version: '0.1.0' }
    });
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.equal(result.checks.some((item) => item.id === 'user-code-syntax' && item.status === 'pass'), true);

    const zip = await JSZip.loadAsync(await fs.readFile(path.join(siteDir, 'builds', result.buildId, 'artifact.zip')));
    assert.equal(zip.file('server/src/custom/handlers/items.js') != null, true);
    assert.match(await zip.file('server/src/custom/handlers/items.js').async('string'), /guard/);
    const manifest = JSON.parse(await zip.file('artifact-manifest.json').async('string'));
    assert.equal(manifest.ownership.user.includes('server/src/custom/handlers/items.js'), true);

    /* 恢复模板：站点文件删除后回到模板默认内容。 */
    const removed = await app.inject({
      method: 'DELETE',
      url: `${base}/code/backend`,
      headers: auth,
      payload: { language: 'node', path: 'src/custom/handlers/items.js' }
    });
    assert.equal(removed.statusCode, 200, removed.body);
    const after = await app.inject({ method: 'GET', url: `${base}/code/backend?language=node`, headers: auth });
    const item = after.json().data.files.find((file) => file.path === 'src/custom/handlers/items.js');
    assert.equal(item.saved, false);
    assert.equal(item.code, item.template);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('页面级与实例级覆盖进入画布渲染，且不写生成区', async () => {
  const { dataDir, app } = await makeContext();
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '覆盖渲染' });
  const base = `/api/sites/${siteId}`;

  try {
    const created = await app.inject({
      method: 'POST',
      url: `${base}/components`,
      headers: auth,
      payload: componentPayload()
    });
    assert.equal(created.statusCode, 201, created.body);

    const page = {
      id: 'home',
      title: '首页',
      path: 'index.html',
      overrides: {
        html: '<div class="lc-page-extra">页面级 HTML</div>',
        css: '.lc-page-extra { color: red; }',
        js: 'console.log("page override");'
      },
      apiOverrides: [
        { id: 'api-a', method: 'GET', path: '/api/items', code: 'return new Response("{}");', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'api-b', method: 'GET', path: '/api/items', code: 'return new Response("{}");', updatedAt: '2026-02-01T00:00:00.000Z' }
      ],
      blocks: [
        {
          id: 'b-card',
          type: 'component',
          componentId: 'note-card',
          overrides: {
            js: 'console.log("instance override");',
            data: { mode: 'custom', url: '/api/notes', method: 'GET', transform: 'return payload.items;' }
          }
        }
      ]
    };

    const rendered = await app.inject({
      method: 'POST',
      url: `${base}/builder/render`,
      headers: auth,
      payload: { page }
    });
    assert.equal(rendered.statusCode, 200, rendered.body);
    const html = rendered.json().data.document;

    /* 页面级 HTML / CSS / JS 都落到该页面，CSS 作用域到页面容器。 */
    assert.match(html, /lc-page-extra/);
    assert.match(html, /[data-lc-page=][^\n]*\.lc-page-extra/);
    assert.match(html, /page override/);

    /* 实例数据来源：属性、拉取脚本、transform 都要在产物里。 */
    assert.match(html, /data-lc-data-url="\/api\/notes"/);
    assert.match(html, /lc:instance-data/);
    assert.match(html, /payload\.items/);

    /* 同一页面同一接口两段覆盖：页面标记最终只有 1 段生效、1 段被覆盖。 */
    assert.match(html, /data-lc-api-overrides="1"/);
    assert.match(html, /data-lc-api-shadowed="1"/);

    /* 生成区没有被站点文件弄脏：站点目录里只有 backend/ 下的用户区。 */
    await assert.rejects(fs.readFile(path.join(dataDir, 'sites', siteId, 'src', 'custom', 'handlers', 'items.js'), 'utf8'));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
