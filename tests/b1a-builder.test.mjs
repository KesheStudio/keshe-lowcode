import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'builder-test-token';
const auth = { 'x-lc-token': TOKEN };

async function makeContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-builder-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: 'Builder 测试', host: '127.0.0.1', port: 9782 },
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
    token: TOKEN,
    port: 9782,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, app: await createServer(context) };
}

function pageJson(blocks) {
  return {
    schemaVersion: 2,
    id: 'home',
    title: '首页',
    slug: 'home',
    path: 'index.html',
    nav: true,
    blocks: blocks
  };
}

test('Builder：站点信息、渲染引擎画布、带 expectedRev 的保存闭环', async () => {
  const { dataDir, app } = await makeContext();
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: 'Builder 站点' });
  try {
    const info = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/builder/site`, headers: auth });
    assert.equal(info.statusCode, 200);
    const data = info.json().data;
    assert.equal(data.pages.length >= 1, true);
    assert.equal(data.pages[0].id, 'home');
    assert.equal(typeof data.rev, 'number');
    const heading = data.blockSchemas.find((schema) => schema.type === 'heading');
    assert.ok(heading, '基础区块 heading 的 schema 必须出现在 Builder');
    assert.equal(heading.props.text.type, 'string');
    assert.equal(heading.store, 'block');

    const pageInfo = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/builder/page?pageId=home`,
      headers: auth
    });
    assert.equal(pageInfo.statusCode, 200);
    assert.equal(pageInfo.json().data.page.id, 'home');
    const rev = pageInfo.json().data.rev;

    const edited = pageJson([
      { id: 'blk-1', type: 'heading', text: '闭环标题', level: 2 },
      { id: 'blk-2', type: 'paragraph', md: '这一段来自 Builder 编辑。' }
    ]);

    const rendered = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/builder/render`,
      headers: auth,
      payload: { page: edited, mode: 'light' }
    });
    assert.equal(rendered.statusCode, 200);
    const doc = rendered.json().data.document;
    assert.match(doc, /data-lc-block="blk-1"/);
    assert.match(doc, /闭环标题/);
    assert.match(doc, /<base href="\/preview\//);
    assert.match(doc, /lc-preview-builder/);
    assert.equal(rendered.json().data.blockCount, 2);

    /* 保存闭环：PUT 带 expectedRev → 再读页面 → 改动仍在 */
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/file?path=${encodeURIComponent('pages/home.json')}`,
      headers: auth,
      payload: { content: JSON.stringify(edited, null, 2), expectedRev: rev }
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(typeof saved.json().data.rev, 'number');

    const after = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/builder/page?pageId=home`,
      headers: auth
    });
    assert.equal(after.json().data.page.blocks[0].text, '闭环标题');
    assert.notEqual(after.json().data.rev, rev);
  } finally {
    await app.close();
  }
});

test('Builder：冲突返回 409 供界面翻译成人话；画布资源走 token 路径', async () => {
  const { dataDir, app } = await makeContext();
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: 'Builder 资源站点' });
  try {
    const pageInfo = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/builder/page?pageId=home`,
      headers: auth
    });
    const rev = pageInfo.json().data.rev;

    const conflict = await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/file?path=${encodeURIComponent('pages/home.json')}`,
      headers: auth,
      payload: { content: JSON.stringify(pageJson([])), expectedRev: rev - 1 }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'LC_E_REV_CONFLICT');

    await fs.mkdir(path.join(dataDir, 'sites', siteId, 'assets'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'sites', siteId, 'assets', 'probe.txt'), 'preview-asset-ok');

    const asset = await app.inject({
      method: 'GET',
      url: `/preview/${siteId}/${TOKEN}/assets/probe.txt`
    });
    assert.equal(asset.statusCode, 200);
    assert.equal(asset.body, 'preview-asset-ok');

    const bad = await app.inject({ method: 'GET', url: `/preview/${siteId}/wrong-token/assets/probe.txt` });
    assert.equal(bad.statusCode, 403);

    const escape = await app.inject({
      method: 'GET',
      url: `/preview/${siteId}/${TOKEN}/..%2F..%2Fproject.json`
    });
    assert.equal(escape.statusCode, 400);
  } finally {
    await app.close();
  }
});
