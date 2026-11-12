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
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-data-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '数据源测试', host: '127.0.0.1', port: 9782 },
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
    token: 'data-test-token',
    port: 9782,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, context, app: await createServer(context) };
}

const auth = { 'x-lc-token': 'data-test-token' };

function collectionPayload(overrides) {
  return Object.assign({
    id: 'products',
    name: '商品',
    description: '示例集合',
    fields: [
      { id: 'name', name: '名称', type: 'text', required: true, unique: true },
      { id: 'price', name: '价格', type: 'number' },
      { id: 'active', name: '在售', type: 'boolean' },
      { id: 'launched', name: '上架日期', type: 'date' },
      { id: 'status', name: '状态', type: 'enum', enumValues: ['draft', 'live'] },
      { id: 'owner', name: '负责人', type: 'reference', refCollection: 'staff' },
      { id: 'meta', name: '扩展', type: 'json' }
    ],
    indexes: [{ id: 'idx-status', name: '状态索引', fields: ['status'], unique: false }]
  }, overrides || {});
}

test('数据源：集合 CRUD、行操作、示例数据与引用保护', async () => {
  const { dataDir, app } = await makeContext();
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '数据源站点' });
  try {
    const created = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections`,
      headers: auth,
      payload: collectionPayload()
    });
    assert.equal(created.statusCode, 201, created.body);
    const collection = created.json().data;
    assert.equal(collection.fields.length, 7);
    assert.equal(collection.fields.find((item) => item.id === 'status').enumValues[0], 'draft');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections`,
      headers: auth,
      payload: collectionPayload({ name: '商品二号' })
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, 'LC_E_COLLECTION_EXISTS');

    const list = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/data/collections`, headers: auth });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data.length, 1);

    const added = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections/products/rows`,
      headers: auth,
      payload: {
        row: {
          id: 'row-test-0001',
          name: '咖啡豆',
          price: 39.5,
          active: true,
          launched: '2025-01-01',
          status: 'live',
          owner: 'staff-1',
          meta: { origin: 'Ethiopia' }
        }
      }
    });
    assert.equal(added.statusCode, 201, added.body);
    const rowId = added.json().data.rows[0].id;

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections/products/rows`,
      headers: auth,
      payload: { row: { name: '咖啡豆', price: 20 } }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'LC_E_DATA_ROW_CONFLICT');

    const badType = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections/products/rows`,
      headers: auth,
      payload: { row: { name: '茶', price: 'abc' } }
    });
    assert.equal(badType.statusCode, 409);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/data/collections/products/rows/${rowId}`,
      headers: auth,
      payload: { row: { name: '咖啡豆（改）', price: 41, active: false, status: 'draft', meta: '{"x":1}' } }
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.row.meta.x, 1);

    const queried = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/products/rows?q=咖啡&limit=10`,
      headers: auth
    });
    assert.equal(queried.statusCode, 200);
    assert.equal(queried.json().data.total, 1);

    const sample = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections/products/sample`,
      headers: auth,
      payload: { count: 5 }
    });
    assert.equal(sample.statusCode, 200, sample.body);
    assert.equal(sample.json().data.added, 5);

    /* 页面引用 price 字段后，改类型必须被拦下。 */
    await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/file?path=pages/usage.json`,
      headers: auth,
      payload: { content: JSON.stringify({ id: 'usage', blocks: [{ type: 'chart', collection: 'products', field: 'price' }] }) }
    });

    const retype = collectionPayload({
      fields: collectionPayload().fields.map((field) => field.id === 'price' ? { ...field, type: 'text' } : field)
    });
    const blocked = await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/data/collections/products`,
      headers: auth,
      payload: retype
    });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().error.code, 'LC_E_DATA_SCHEMA_IN_USE');
    assert.equal(blocked.json().error.detail.usage.some((item) => item.file === 'pages/usage.json'), true);

    const confirmed = await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/data/collections/products`,
      headers: auth,
      payload: Object.assign({}, retype, { confirmBreaking: true })
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().data.collection.fields.find((item) => item.id === 'price').type, 'text');
    assert.equal(confirmed.json().data.warnings.length, 1);

    const deleteBlocked = await app.inject({
      method: 'DELETE',
      url: `/api/sites/${siteId}/data/collections/products`,
      headers: auth
    });
    assert.equal(deleteBlocked.statusCode, 409);

    const deleteConfirmed = await app.inject({
      method: 'DELETE',
      url: `/api/sites/${siteId}/data/collections/products?confirm=1`,
      headers: auth
    });
    assert.equal(deleteConfirmed.statusCode, 200, deleteConfirmed.body);
    assert.equal(deleteConfirmed.json().data.usage > 0, true);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/products`,
      headers: auth
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
