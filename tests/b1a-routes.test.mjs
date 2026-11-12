import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function makeContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-b1a-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: 'B1a 测试', host: '127.0.0.1', port: 9781 },
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
    token: 'b1a-test-token',
    port: 9781,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, context, app: await createServer(context) };
}

const auth = { 'x-lc-token': 'b1a-test-token' };

test('B1a：鉴权、批量事务、改名、备份、占用与回收站', async () => {
  const { dataDir, app } = await makeContext();
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: 'B1a 站点' });
  try {
    const noToken = await app.inject({ method: 'GET', url: '/api/sites' });
    assert.equal(noToken.statusCode, 403);
    assert.equal(noToken.json().error.code, 'LC_E_AUTH');

    const list = await app.inject({ method: 'GET', url: '/api/sites', headers: auth });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data.length, 1);

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/batch`,
      headers: auth,
      payload: { expectedRev: 999, ops: [{ type: 'write', path: 'pages/extra.json', content: '{}' }] }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'LC_E_REV_CONFLICT');

    const batch = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/batch`,
      headers: auth,
      payload: {
        ops: [
          { type: 'write', path: 'pages/b1a-a.json', content: JSON.stringify({ id: 'b1a-a' }) },
          { type: 'write', path: 'pages/b1a-b.json', content: JSON.stringify({ id: 'b1a-b' }) }
        ]
      }
    });
    assert.equal(batch.statusCode, 200);
    assert.equal(batch.json().data.applied, 2);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/sites/${siteId}`,
      headers: auth,
      payload: { name: 'B1a 站点（改名）', slug: 'b1a-site' }
    });
    assert.equal(rename.statusCode, 200);
    assert.equal(rename.json().data.name, 'B1a 站点（改名）');
    assert.equal(rename.json().data.slug, 'b1a-site');
    const site = JSON.parse(await fs.readFile(path.join(dataDir, 'sites', siteId, 'site.json'), 'utf8'));
    assert.equal(site.name, 'B1a 站点（改名）');
    const project = JSON.parse(await fs.readFile(path.join(dataDir, 'sites', siteId, 'project.json'), 'utf8'));
    assert.equal(project.site.name, 'B1a 站点（改名）');

    const backup = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/backup`,
      headers: auth,
      payload: { reason: 'test' }
    });
    assert.equal(backup.statusCode, 200);
    assert.equal(backup.json().data.files >= 4, true);
    assert.equal(backup.json().data.bytes > 0, true);

    const usage = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/usage`, headers: auth });
    assert.equal(usage.statusCode, 200);
    const categories = usage.json().data.categories;
    assert.equal(categories.source > 0, true);
    assert.equal(categories.backups > 0, true);
    assert.equal(usage.json().data.total > categories.source, true);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/sites/${siteId}`, headers: auth });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().data.trashed, true);
    await assert.rejects(fs.stat(path.join(dataDir, 'sites', siteId)));
    const trashPath = path.join(dataDir, deleted.json().data.trashPath);
    assert.equal((await fs.stat(trashPath)).isDirectory(), true);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
