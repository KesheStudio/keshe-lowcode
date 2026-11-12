import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = { 'x-lc-token': 'feature-test-token' };

async function makeContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-feature-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '功能测试', host: '127.0.0.1', port: 9782 },
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
    token: 'feature-test-token',
    port: 9782,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, paths, app: await createServer(context) };
}

async function addCollection(app, siteId, rows) {
  const created = await app.inject({
    method: 'POST',
    url: `/api/sites/${siteId}/data/collections`,
    headers: auth,
    payload: {
      id: 'items',
      name: '条目',
      fields: [
        { id: 'name', name: '名称', type: 'text' },
        { id: 'price', name: '价格', type: 'number' }
      ]
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  for (const row of rows) {
    const saved = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/collections/items/rows`,
      headers: auth,
      payload: { row }
    });
    assert.equal(saved.statusCode, 201, saved.body);
  }
}

/* 把另一个站点的目录搬到指定 siteId，用来构造“同名站点已存在”的真实冲突。 */
async function plantSite(paths, fromId, toId) {
  const fromDir = path.join(paths.dataDir, 'sites', fromId);
  const toDir = path.join(paths.dataDir, 'sites', toId);
  await fs.rename(fromDir, toDir);
  const metaPath = path.join(toDir, 'site.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.siteId = toId;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
}

async function listTrash(app) {
  const response = await app.inject({ method: 'GET', url: '/api/sites/trash', headers: auth });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.items;
}

async function trashOf(app, siteId) {
  const items = await listTrash(app);
  const item = items.find((entry) => entry.siteId === siteId);
  assert.ok(item, '回收站应包含 ' + siteId + '：' + JSON.stringify(items));
  return item;
}

test('回收站：列表可读、无冲突恢复、同名冲突必须显式选择改名或覆盖', async () => {
  const { dataDir, paths, app } = await makeContext();
  try {
    const a = await createSite(paths, { name: '回收站甲' });
    const removed = await app.inject({ method: 'DELETE', url: `/api/sites/${a.siteId}`, headers: auth });
    assert.equal(removed.statusCode, 200, removed.body);
    const item = await trashOf(app, a.siteId);
    assert.equal(item.conflict, null);
    assert.equal(item.pageCount >= 0, true);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/sites/trash/${encodeURIComponent(item.trashId)}/restore`,
      headers: auth,
      payload: {}
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.siteId, a.siteId);
    assert.equal(await fs.stat(path.join(dataDir, 'sites', a.siteId, 'site.json')).then(() => true), true);

    /* 构造同名冲突：删掉站点后再放一个同 siteId 的站点回去。 */
    await app.inject({ method: 'DELETE', url: `/api/sites/${a.siteId}`, headers: auth });
    const b = await createSite(paths, { name: '占位乙' });
    await plantSite(paths, b.siteId, a.siteId);

    const conflictItem = await trashOf(app, a.siteId);
    assert.ok(conflictItem.conflict);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/sites/trash/${encodeURIComponent(conflictItem.trashId)}/restore`,
      headers: auth,
      payload: {}
    });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().error.code, 'LC_E_SITE_EXISTS');
    assert.deepEqual(blocked.json().error.detail.options, ['rename', 'overwrite']);

    const renamed = await app.inject({
      method: 'POST',
      url: `/api/sites/trash/${encodeURIComponent(conflictItem.trashId)}/restore`,
      headers: auth,
      payload: { mode: 'rename' }
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.notEqual(renamed.json().data.siteId, a.siteId);
    assert.match(renamed.json().data.siteId, /^standin-|^a-restored|restored/);
    assert.equal(await fs.stat(path.join(dataDir, 'sites', a.siteId, 'site.json')).then(() => true), true);

    /* 覆盖必须显式确认，且旧站点整体移入回收站，可再次恢复。 */
    const c = await createSite(paths, { name: '回收站丙' });
    await app.inject({ method: 'DELETE', url: `/api/sites/${c.siteId}`, headers: auth });
    const d = await createSite(paths, { name: '占位丁' });
    await plantSite(paths, d.siteId, c.siteId);
    const overwriteItem = await trashOf(app, c.siteId);
    assert.ok(overwriteItem.conflict);
    const overwritten = await app.inject({
      method: 'POST',
      url: `/api/sites/trash/${encodeURIComponent(overwriteItem.trashId)}/restore`,
      headers: auth,
      payload: { mode: 'overwrite' }
    });
    assert.equal(overwritten.statusCode, 200, overwritten.body);
    assert.equal(overwritten.json().data.siteId, c.siteId);
    assert.ok(overwritten.json().data.replacedTrashId);
    const after = await listTrash(app);
    assert.ok(after.some((entry) => entry.trashId === overwritten.json().data.replacedTrashId));
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('备份恢复：列表、范围预览、恢复前安全备份、损坏备份不落盘', async () => {
  const { dataDir, paths, app } = await makeContext();
  try {
    const { siteId } = await createSite(paths, { name: '备份站点' });
    const siteDir = path.join(dataDir, 'sites', siteId);
    const target = path.join(siteDir, 'pages', 'audit-backup.json');
    await fs.writeFile(target, JSON.stringify({ version: 1, marker: 'before' }));
    await fs.writeFile(path.join(siteDir, '.gitignore'), 'node_modules\n');

    const created = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/backup`,
      headers: auth,
      payload: { reason: 'manual' }
    });
    assert.equal(created.statusCode, 200, created.body);
    const backupName = created.json().data.backup.split('/').pop();

    const list = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/backups`, headers: auth });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(list.json().data.items.some((item) => item.name === backupName));

    await fs.writeFile(target, JSON.stringify({ version: 1, marker: 'after' }));
    const detail = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/backups/${backupName}`, headers: auth });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.valid, true, detail.body);
    assert.equal(detail.json().data.scope.changed >= 1, true);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/backups/${backupName}/restore`,
      headers: auth,
      payload: {}
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).marker, 'before');
    assert.equal(JSON.parse(await fs.readFile(path.join(siteDir, 'site.json'), 'utf8')).siteId, siteId);
    assert.ok(restored.json().data.safetyBackup.startsWith('backups/'));
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).marker, 'before');

    const safety = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/backups/${restored.json().data.safetyBackup.split('/').pop()}`,
      headers: auth
    });
    assert.equal(safety.statusCode, 200, safety.body);
    assert.equal(safety.json().data.reason, 'pre-restore-' + backupName);

    /* 损坏备份：预览标记无效，恢复被拒绝且目标文件保持当前内容。 */
    const backupDir = path.join(siteDir, 'backups', backupName);
    const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
    const victim = manifest.files.find((file) => file.path === 'pages/audit-backup.json');
    assert.ok(victim);
    await fs.writeFile(path.join(backupDir, 'files', victim.path), '{"broken":true}');
    const badDetail = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/backups/${backupName}`, headers: auth });
    assert.equal(badDetail.json().data.valid, false);
    const badRestore = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/backups/${backupName}/restore`,
      headers: auth,
      payload: {}
    });
    assert.equal(badRestore.statusCode, 422, badRestore.body);
    assert.equal(badRestore.json().error.code, 'LC_E_BACKUP_CORRUPT');
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).marker, 'before');
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('备份恢复写入失败时自动退回恢复前状态', async () => {
  const { dataDir, paths, app } = await makeContext();
  try {
    const { siteId } = await createSite(paths, { name: '恢复失败站点' });
    const siteDir = path.join(dataDir, 'sites', siteId);
    await fs.mkdir(path.join(siteDir, 'pages', 'nested'), { recursive: true });
    await fs.writeFile(path.join(siteDir, 'pages', 'nested', 'x.json'), '{"v":1}');
    await fs.writeFile(path.join(siteDir, 'pages', 'stable.json'), '{"stable":true}');

    const created = await app.inject({
      method: 'POST', url: `/api/sites/${siteId}/backup`, headers: auth, payload: { reason: 'manual' }
    });
    const backupName = created.json().data.backup.split('/').pop();

    /* 把目标路径的父目录替换成文件：事务提交时 rename 必然失败。 */
    await fs.rm(path.join(siteDir, 'pages', 'nested'), { recursive: true, force: true });
    await fs.writeFile(path.join(siteDir, 'pages', 'nested'), 'blocked');
    await fs.writeFile(path.join(siteDir, 'pages', 'stable.json'), '{"stable":"changed"}');

    const failed = await app.inject({
      method: 'POST', url: `/api/sites/${siteId}/backups/${backupName}/restore`, headers: auth, payload: {}
    });
    assert.equal(failed.statusCode, 500, failed.body);
    assert.equal(failed.json().error.code, 'LC_E_BACKUP_RESTORE_FAILED');
    assert.equal(failed.json().error.detail.rolledBack, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(siteDir, 'pages', 'stable.json'), 'utf8')).stable, 'changed');
    assert.equal(await fs.stat(path.join(siteDir, 'pages', 'nested')).then((stat) => stat.isFile()), true);
    assert.equal(await fs.stat(path.join(siteDir, 'pages', 'nested', 'x.json')).then(() => true).catch(() => false), false);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('数据行：服务端排序与分页一致，筛选条件在翻页和排序时保留', async () => {
  const { dataDir, paths, app } = await makeContext();
  try {
    const { siteId } = await createSite(paths, { name: '排序站点' });
    await addCollection(app, siteId, [
      { name: 'b', price: 3 },
      { name: 'a', price: 1 },
      { name: 'c', price: 2 },
      { name: 'd' }
    ]);

    const asc = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/items/rows?sort=price&order=asc&limit=100&offset=0`,
      headers: auth
    });
    assert.equal(asc.statusCode, 200, asc.body);
    const ascRows = asc.json().data.rows;
    assert.deepEqual(ascRows.map((row) => row.price), [0, 1, 2, 3]);
    assert.equal(asc.json().data.total, 4);
    assert.equal(asc.json().data.sort, 'price');
    assert.equal(asc.json().data.order, 'asc');

    const desc = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/items/rows?sort=price&order=desc`,
      headers: auth
    });
    assert.deepEqual(desc.json().data.rows.map((row) => row.price), [3, 2, 1, 0]);

    const byName = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/items/rows?sort=name&order=asc`,
      headers: auth
    });
    assert.deepEqual(byName.json().data.rows.map((row) => row.name), ['a', 'b', 'c', 'd']);

    const paged = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/items/rows?sort=price&order=asc&offset=2&limit=1`,
      headers: auth
    });
    assert.equal(paged.json().data.rows.length, 1);
    assert.equal(paged.json().data.rows[0].price, 2);
    assert.equal(paged.json().data.total, 4);

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/items/rows?q=${encodeURIComponent('a')}&sort=price&order=desc&offset=0&limit=2`,
      headers: auth
    });
    assert.equal(filtered.statusCode, 200, filtered.body);
    assert.equal(filtered.json().data.total, 1);
    assert.deepEqual(filtered.json().data.rows.map((row) => row.name), ['a']);
    assert.equal(filtered.json().data.sort, 'price');
    assert.equal(filtered.json().data.order, 'desc');

    const invalid = await app.inject({
      method: 'GET',
      url: `/api/sites/${siteId}/data/collections/items/rows?sort=missing`,
      headers: auth
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error.code, 'LC_E_DATA_SORT_FIELD');
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
