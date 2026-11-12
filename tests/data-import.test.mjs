import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = { 'x-lc-token': 'data-import-token' };

async function bootstrap() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-import-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '导入测试', host: '127.0.0.1', port: 9784 },
    server: { bodyLimitBytes: 8 * 1024 * 1024, requestTimeoutMs: 30000 },
    logging: { level: 'silent' },
    paths,
    migration: { enabled: true },
    draftCache: { enabled: false }
  };
  const app = await createServer({
    platformRoot: ROOT, config, paths,
    runtime: { readOnly: false, readOnlyReason: '' },
    token: auth['x-lc-token'], port: 9784,
    startedAt: new Date().toISOString(), version: '0.0.0', contractsVersion: '2.0.0',
    configWarnings: [], bootError: null
  });
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '导入站点' });
  const created = await app.inject({
    method: 'POST', url: `/api/sites/${siteId}/data/collections`, headers: auth,
    payload: {
      id: 'products', name: '商品',
      fields: [
        { id: 'name', name: '名称', type: 'text', required: true, unique: true },
        { id: 'price', name: '价格', type: 'number' },
        { id: 'status', name: '状态', type: 'text' }
      ]
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  return { dataDir, app, siteId };
}

function preview(app, siteId, content, format) {
  return app.inject({
    method: 'POST', url: `/api/sites/${siteId}/data/import/preview`, headers: auth,
    payload: { collectionId: 'products', content, format }
  });
}

function runImport(app, siteId, content, options) {
  return app.inject({
    method: 'POST', url: `/api/sites/${siteId}/data/import`, headers: auth,
    payload: Object.assign({ collectionId: 'products', content }, options || {})
  });
}

test('导入：CSV 预览、类型推断、三种冲突策略与上限', async () => {
  const { dataDir, app, siteId } = await bootstrap();
  try {
    const csv = '\uFEFFname,price,status\r\n"咖啡, 豆",39.5,实售\r\n红茶,20,停售\r\n';
    const previewRes = await preview(app, siteId, csv, 'csv');
    assert.equal(previewRes.statusCode, 200, previewRes.body);
    const data = previewRes.json().data;
    assert.equal(data.format, 'csv');
    assert.equal(data.totalRows, 2);
    assert.equal(data.columns.find((item) => item.name === 'name').mappedTo, 'name');
    assert.equal(data.columns.find((item) => item.name === 'price').inferredType, 'number');
    assert.equal(data.columns.find((item) => item.name === 'status').inferredType, 'text');
    assert.equal(data.limitBytes, 5 * 1024 * 1024);
    assert.equal(data.rows[0].name, '咖啡, 豆');

    const append = await runImport(app, siteId, csv, {
      format: 'csv', mode: 'append',
      mapping: { name: 'name', price: 'price' }
    });
    assert.equal(append.statusCode, 200, append.body);
    assert.equal(append.json().data.added, 2);

    const again = await runImport(app, siteId, csv, {
      format: 'csv', mode: 'append',
      mapping: { name: 'name', price: 'price' }
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().data.added, 0);
    assert.equal(again.json().data.skipped, 2);

    const overwrite = await runImport(app, siteId, 'name,price\n红茶,25\n', {
      format: 'csv', mode: 'overwrite',
      mapping: { name: 'name', price: 'price' }
    });
    assert.equal(overwrite.statusCode, 200, overwrite.body);
    assert.equal(overwrite.json().data.updated, 1);
    assert.equal(overwrite.json().data.added, 0);

    const rows = await app.inject({
      method: 'GET', url: `/api/sites/${siteId}/data/collections/products/rows?limit=100`, headers: auth
    });
    const red = rows.json().data.rows.find((row) => row.name === '红茶');
    assert.equal(red.price, 25);

    const skip = await runImport(app, siteId, 'name,price\n红茶,25\n绿茶,18\n', {
      format: 'csv', mode: 'skipDuplicates',
      mapping: { name: 'name', price: 'price' }
    });
    assert.equal(skip.statusCode, 200, skip.body);
    assert.equal(skip.json().data.skipped, 1);
    assert.equal(skip.json().data.added, 1);

    const jsonImport = await runImport(app, siteId, JSON.stringify([
      { 名称: '乌龙', 价格: '30', 状态: '在售' }
    ]), {
      format: 'json', mode: 'append',
      mapping: { 名称: 'name', 价格: 'price', 状态: 'status' }
    });
    assert.equal(jsonImport.statusCode, 200, jsonImport.body);
    assert.equal(jsonImport.json().data.added, 1);

    const badJson = await runImport(app, siteId, 'not json', { format: 'json', mode: 'append' });
    assert.equal(badJson.statusCode, 422);
    assert.equal(badJson.json().error.code, 'LC_E_IMPORT_FORMAT');

    const tooLarge = await preview(app, siteId, 'a'.repeat(5 * 1024 * 1024 + 1), 'csv');
    assert.equal(tooLarge.statusCode, 422);
    assert.equal(tooLarge.json().error.code, 'LC_E_IMPORT_TOO_LARGE');
    assert.equal(tooLarge.json().error.detail.limitBytes, 5 * 1024 * 1024);

    const manyRows = 'name,price\n' + Array.from({ length: 20001 }, (_, i) => 'n' + i + ',1').join('\n');
    const tooMany = await preview(app, siteId, manyRows, 'csv');
    assert.equal(tooMany.statusCode, 422);
    assert.equal(tooMany.json().error.code, 'LC_E_IMPORT_TOO_MANY_ROWS');

    const noMapping = await runImport(app, siteId, 'a,b\n1,2\n', {
      format: 'csv', mode: 'append', mapping: {}
    });
    assert.equal(noMapping.statusCode, 400);
    assert.equal(noMapping.json().error.code, 'LC_E_IMPORT_MAPPING');
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
