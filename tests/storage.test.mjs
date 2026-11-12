import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeRelPath } from '../src/storage/path-safety.js';
import { PathUnsafeError } from '../src/storage/errors.js';
import { writeFileAtomic } from '../src/storage/atomic.js';
import { StorageTx, recoverTransactions } from '../src/storage/txn.js';
import { createSiteAdapter } from '../src/storage/index.js';
import { VersionStore } from '../src/storage/versions.js';
import { createBackup, pruneBackups } from '../src/storage/backups.js';
import { slugify } from '../server/src/sites.js';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lc-test-'));
}

test('路径安全：拒绝绝对路径、盘符与越界', () => {
  assert.equal(normalizeRelPath('pages/home.json'), 'pages/home.json');
  for (const bad of ['..\\secret', '../etc/passwd', '/etc/passwd', 'C:\\Windows', 'pages/../../x']) {
    assert.throws(() => normalizeRelPath(bad), PathUnsafeError, bad);
  }
});

test('原子写：写入后可读回，且不残留临时文件', async () => {
  const dir = await makeTempDir();
  const target = path.join(dir, 'demo.json');
  await writeFileAtomic(target, JSON.stringify({ ok: true }));
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { ok: true });
  assert.deepEqual(await fs.readdir(dir), ['demo.json']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('事务：提交后落盘，回滚保留原文件', async () => {
  const siteDir = await makeTempDir();
  await fs.mkdir(path.join(siteDir, 'pages'), { recursive: true });
  await fs.writeFile(path.join(siteDir, 'pages', 'home.json'), 'before');

  const tx = new StorageTx(siteDir);
  await tx.prepare();
  await tx.write('pages/home.json', 'after');
  await tx.write('pages/new.json', 'created');
  await tx.commit();
  assert.equal(await fs.readFile(path.join(siteDir, 'pages', 'home.json'), 'utf8'), 'after');
  assert.equal(await fs.readFile(path.join(siteDir, 'pages', 'new.json'), 'utf8'), 'created');
  assert.deepEqual(await fs.readdir(path.join(siteDir, '.lowcode', 'txn')), []);
  await fs.rm(siteDir, { recursive: true, force: true });
});

test('事务：提交中途失败按逆序还原', async () => {
  const siteDir = await makeTempDir();
  await fs.mkdir(path.join(siteDir, 'pages'), { recursive: true });
  await fs.writeFile(path.join(siteDir, 'pages', 'home.json'), 'before');

  const tx = new StorageTx(siteDir);
  await tx.prepare();
  await tx.write('pages/home.json', 'after');
  tx.ops.push({ type: 'write', target: 'pages/missing-temp.json', temp: '.lowcode/tmp/none/files/9', backup: null, hash: '', bytes: 0 });
  await assert.rejects(() => tx.commit());
  assert.equal(await fs.readFile(path.join(siteDir, 'pages', 'home.json'), 'utf8'), 'before');
  await fs.rm(siteDir, { recursive: true, force: true });
});

test('崩溃恢复：committing 清单半途写入回滚、已落盘写入保留', async () => {
  const siteDir = await makeTempDir();
  const txnId = 'test-txn';
  const tmp = path.join(siteDir, '.lowcode', 'tmp', txnId);
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  await fs.mkdir(path.join(siteDir, 'pages'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'backup'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'backup', '0'), 'old');
  await fs.writeFile(path.join(siteDir, 'pages', 'forward.json'), 'landed');
  await fs.writeFile(path.join(tmp, 'backup', '1'), 'old-forward');
  await fs.mkdir(path.join(siteDir, '.lowcode', 'txn'), { recursive: true });
  await fs.writeFile(
    path.join(siteDir, '.lowcode', 'txn', `${txnId}.json`),
    JSON.stringify({
      txnId,
      state: 'committing',
      ops: [
        { type: 'write', target: 'pages/rollback.json', temp: `.lowcode/tmp/${txnId}/files/0`, backup: `.lowcode/tmp/${txnId}/backup/0`, hash: hash('new'), bytes: 3 },
        { type: 'write', target: 'pages/forward.json', temp: `.lowcode/tmp/${txnId}/files/1`, backup: `.lowcode/tmp/${txnId}/backup/1`, hash: hash('landed'), bytes: 6 }
      ]
    })
  );

  const reports = await recoverTransactions(siteDir);
  assert.deepEqual(reports, [{ txnId, action: 'rolled-back', restored: 1 }]);
  assert.equal(await fs.readFile(path.join(siteDir, 'pages', 'rollback.json'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(siteDir, 'pages', 'forward.json'), 'utf8'), 'landed');
  assert.deepEqual(await fs.readdir(path.join(siteDir, '.lowcode', 'txn')), []);
  await fs.rm(siteDir, { recursive: true, force: true });
});

test('站点 slug：中文名确定性且可读', () => {
  assert.equal(slugify('旧版示例站'), slugify('旧版示例站'));
  assert.match(slugify('旧版示例站'), /^[a-z0-9-]{6,}$/);
  // 中文 + 数字（如带时间戳的测试站名）不能退化成非法 id
  assert.match(slugify('回归测试站 1794073274769'), /^[a-z0-9-]+$/);
  assert.doesNotMatch(slugify('回归测试站 1794073274769'), /^-/);
});

test('版本快照：每次写入一条，内容可回读，删除记为 deleted', async () => {
  const dataRoot = await makeTempDir();
  const adapter = createSiteAdapter(dataRoot, 'site-version');
  await fs.mkdir(adapter.siteDir, { recursive: true });
  await adapter.write('pages/home.json', 'v1');
  await adapter.write('pages/home.json', 'v2');
  await adapter.delete('pages/home.json');

  const store = new VersionStore(adapter.siteDir);
  const entries = await store.list();
  assert.equal(entries.length, 3);

  const first = await store.get(entries[entries.length - 1].rev);
  assert.equal(first.files[0].path, 'pages/home.json');
  assert.equal(first.files[0].content, 'v1');

  const latest = await store.get(entries[0].rev);
  assert.equal(latest.files[0].encoding, 'deleted');
  await fs.rm(dataRoot, { recursive: true, force: true });
});

test('备份：manifest 记录文件 hash，且只保留最近 10 份', async () => {
  const dataRoot = await makeTempDir();
  const siteDir = path.join(dataRoot, 'sites', 'site-backup');
  await fs.mkdir(path.join(siteDir, 'pages'), { recursive: true });
  await fs.writeFile(path.join(siteDir, 'pages', 'home.json'), 'content');

  const backup = await createBackup(siteDir, { siteId: 'site-backup', reason: 'delete', paths: ['pages/home.json'] });
  const manifest = JSON.parse(await fs.readFile(path.join(backup.dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 1);
  assert.match(manifest.files[0].hash, /^[a-f0-9]{64}$/);

  const now = Date.now();
  for (let index = 0; index < 12; index += 1) {
    const name = `${new Date(now - index * 1000).toISOString().replace(/[:.]/g, '-')}-x`;
    await fs.mkdir(path.join(siteDir, 'backups', name), { recursive: true });
  }
  const pruned = await pruneBackups(siteDir);
  const remaining = (await fs.readdir(path.join(siteDir, 'backups'), { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.equal(remaining.length, 10);
  assert.equal(pruned.removed, 3);
  await fs.rm(dataRoot, { recursive: true, force: true });
});

test('版本保留：超 100 条或 30 天删除旧快照，最新一条始终保留', async () => {
  const siteDir = await makeTempDir();
  const store = new VersionStore(siteDir);
  const versionsDir = path.join(siteDir, 'versions');
  await fs.mkdir(versionsDir, { recursive: true });

  const now = Date.now();
  const entries = [];
  for (let rev = 1; rev <= 101; rev += 1) {
    entries.push({
      rev,
      parent: rev - 1,
      at: new Date(rev === 1 ? now - 40 * 24 * 60 * 60 * 1000 : now).toISOString(),
      kind: 'full',
      files: [],
      bytes: 0
    });
    await fs.writeFile(path.join(versionsDir, `${rev}.json`), '{}');
  }

  const kept = await store.prune(entries);
  assert.equal(kept.length, 100);
  assert.equal(kept[kept.length - 1].rev, 101);
  assert.equal(await fs.stat(path.join(versionsDir, '1.json')).catch(() => null), null);
  assert.ok(await fs.stat(path.join(versionsDir, '101.json')));

  await fs.rm(siteDir, { recursive: true, force: true });
});

