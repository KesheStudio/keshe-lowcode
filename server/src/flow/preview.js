/* 后端积木 · 预览运行
 *
 * 预览只在本机 127.0.0.1 上跑，端口随机；数据库用站点 preview-data/ 下的 SQLite 临时文件，
 * 绝不读取站点配置里的 MySQL / PostgreSQL / Redis，也不会碰 3306 / 6379 / 5432。
 * 运行时数据放在构建目录之外，重新生成不会碰到正在运行的预览；停止预览时清掉。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildFlowProject } from './build.js';

const active = new Map();

function keyOf(siteId, target = 'node') {
  return `${siteId}:${String(target || 'node')}`;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('无法分配预览端口'))));
    });
  });
}

function pushLog(entry, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    entry.logs.push(line.slice(0, 500));
  }
  if (entry.logs.length > 300) entry.logs.splice(0, entry.logs.length - 300);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 预览 SQLite 在站点 preview-data/<language>/ 下；停止后连同 wal/shm 一起删掉。 */
async function removePreviewDatabase(entry) {
  if (!entry || !entry.build || !entry.build.databaseFile) return;
  const base = path.join(entry.build.serverDir, entry.build.databaseFile);
  await Promise.all(['', '-wal', '-shm'].map((suffix) =>
    fs.rm(base + suffix, { force: true }).catch(() => {})
  ));
}

/* 上次预览异常退出可能留下临时库；新预览启动前清掉同语言的旧文件。 */
async function cleanStalePreviewData(siteDir, language, keepAbs) {
  const dir = path.join(siteDir, 'preview-data', language);
  const entries = await fs.readdir(dir).catch(() => []);
  for (const name of entries) {
    if (!/^preview-[0-9a-f]+\.db(-wal|-shm)?$/.test(name)) continue;
    const full = path.join(dir, name);
    if (keepAbs && path.resolve(full) === path.resolve(keepAbs)) continue;
    await fs.rm(full, { force: true }).catch(() => {});
  }
}

/** 结束预览子进程：先杀，再等真正的 exit；Windows 上目录被占用多半是进程还没退干净。 */
async function stopChild(child, timeoutMs = 3000) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    child.kill('SIGKILL');
  } catch {
    // 进程已经退出
  }
  await Promise.race([exited, sleep(timeoutMs)]);
}

function runCommand(command, args, cwd, { timeout = 600000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    let output = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 进程已经退出
      }
    }, timeout);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${command} 启动失败：${err.message}`));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} 失败（退出码 ${code}）：${output.trim().slice(-800)}`));
        return;
      }
      resolve(output.trim());
    });
  });
}

/** Rust / Go 需要先编译出可执行文件；Node 直接跑源码。 */
async function buildRuntime(serverDir, language) {
  if (language === 'rust') {
    const targetDir = path.join(serverDir, '..', '.cache', 'rust-target');
    await runCommand('cargo', ['build'], serverDir, {
      timeout: 900000,
      env: { CARGO_TARGET_DIR: targetDir }
    });
    const binary = process.platform === 'win32' ? 'lowcode-server.exe' : 'lowcode-server';
    return path.join(targetDir, 'debug', binary);
  }
  if (language === 'go') {
    const binary = path.join(serverDir, process.platform === 'win32' ? '.lc-preview-server.exe' : '.lc-preview-server');
    await runCommand('go', ['build', '-o', binary, '.'], serverDir, { timeout: 600000 });
    return binary;
  }
  return process.execPath;
}

async function runMigrations(serverDir, language, runtime) {
  const args = language === 'node'
    ? ['src/main.js', '--config', 'config.preview.json', '--migrate']
    : ['--config', 'config.preview.json', '--migrate'];
  const child = spawn(runtime, args, {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.once('exit', (value) => resolve(value)));
  if (code !== 0) {
    throw new Error(`预览数据库迁移失败（退出码 ${code}）：${output.trim().slice(-800)}`);
  }
  return output.trim();
}

async function seedCollections(serverDir, databaseFile, collections) {
  const rows = [];
  for (const collection of collections) {
    for (const raw of collection.rows || []) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.id || `row-${crypto.randomUUID()}`);
      const data = { ...raw };
      delete data.id;
      delete data.createdAt;
      delete data.updatedAt;
      rows.push({
        collection: collection.id,
        id,
        data: JSON.stringify(data),
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
      });
    }
  }
  if (!rows.length) return 0;

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(serverDir, databaseFile));
  try {
    db.exec('BEGIN');
    const stmt = db.prepare('INSERT OR REPLACE INTO collection_rows (collection_id, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) stmt.run(row.collection, row.id, row.data, row.createdAt, row.updatedAt);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误
    }
    throw err;
  } finally {
    db.close();
  }
  return rows.length;
}

async function waitHealthy(entry, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (entry.child.exitCode !== null) return false;
    try {
      const response = await fetch(`${entry.url}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function startOnce({ paths, siteId, siteDir, flowDoc, port, target }) {
  const build = await buildFlowProject({ paths, siteId, siteDir, flowDoc, previewPort: port, target });
  await cleanStalePreviewData(siteDir, target, path.join(build.serverDir, build.databaseFile));
  const runtime = await buildRuntime(build.serverDir, target);
  const migrationLog = await runMigrations(build.serverDir, target, runtime);
  const seeded = await seedCollections(build.serverDir, build.databaseFile, build.collections);

  const args = target === 'node'
    ? ['src/main.js', '--config', 'config.preview.json']
    : ['--config', 'config.preview.json'];
  const child = spawn(runtime, args, {
    cwd: build.serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development', LC_FLOW_PREVIEW: '1' }
  });
  const entry = {
    siteId,
    target,
    port,
    url: `http://127.0.0.1:${port}`,
    child,
    logs: [],
    build,
    migrationLog,
    seeded,
    startedAt: new Date().toISOString()
  };
  child.stdout.on('data', (chunk) => pushLog(entry, chunk));
  child.stderr.on('data', (chunk) => pushLog(entry, chunk));

  const healthy = await waitHealthy(entry);
  if (!healthy) {
    await stopChild(child, 1500);
    await removePreviewDatabase(entry);
    const tail = entry.logs.slice(-20).join('\n');
    throw new Error(`预览服务启动失败：${tail || '没有日志输出'}`);
  }
  return entry;
}

export async function startPreview({ paths, siteId, siteDir, flowDoc, target = 'node' }) {
  const language = String(target || 'node');
  await stopPreview(siteId, language);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const port = await freePort();
    try {
      const entry = await startOnce({ paths, siteId, siteDir, flowDoc, port, target: language });
      active.set(keyOf(siteId, language), entry);
      return {
        siteId,
        target: language,
        url: entry.url,
        port: entry.port,
        pid: entry.child.pid,
        seeded: entry.seeded,
        treeVersion: entry.build.meta.treeVersion,
        treeHash: entry.build.meta.treeHash,
        buildDir: entry.build.serverDir,
        logs: entry.logs.slice(-40)
      };
    } catch (err) {
      lastError = err;
      // 端口刚被别的进程抢走时换一个再试一次。
      if (!/EADDRINUSE/.test(String(err.message))) break;
    }
  }
  throw lastError || new Error('预览启动失败');
}

export async function stopPreview(siteId, target = 'node') {
  const key = keyOf(siteId, target);
  const entry = active.get(key);
  if (!entry) return { stopped: false };
  active.delete(key);
  await stopChild(entry.child, 3000);
  await removePreviewDatabase(entry);
  return { stopped: true };
}

export function previewInfo(siteId, target = 'node') {
  const entry = active.get(keyOf(siteId, target));
  if (!entry) return null;
  return {
    target: entry.target,
    url: entry.url,
    port: entry.port,
    pid: entry.child.pid,
    running: entry.child.exitCode === null,
    startedAt: entry.startedAt,
    treeVersion: entry.build.meta.treeVersion,
    seeded: entry.seeded,
    logs: entry.logs.slice(-60)
  };
}

export async function requestPreview(siteId, { method = 'GET', path: requestPath = '/', headers = {}, body, target: previewTarget = 'node' } = {}) {
  const entry = active.get(keyOf(siteId, previewTarget));
  if (!entry || entry.child.exitCode !== null) {
    throw new Error('预览服务没有在运行，请先启动预览');
  }
  const target = String(requestPath || '/');
  if (!target.startsWith('/') || target.startsWith('//')) {
    throw new Error('预览请求路径必须以 / 开头');
  }
  const verb = String(method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) {
    throw new Error('不支持的请求方法：' + verb);
  }
  const started = Date.now();
  const init = {
    method: verb,
    headers: headers && typeof headers === 'object' ? headers : {},
    signal: AbortSignal.timeout(10000)
  };
  if (body !== undefined && verb !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers['content-type'] && !init.headers['Content-Type']) init.headers['content-type'] = 'application/json';
  }
  const response = await fetch(entry.url + target, init);
  const text = await response.text();
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    url: entry.url + target,
    status: response.status,
    ms: Date.now() - started,
    headers: Object.fromEntries(response.headers.entries()),
    body: bytes > 200 * 1024 ? text.slice(0, 200 * 1024) + '\n…（已截断）' : text,
    truncated: bytes > 200 * 1024
  };
}

export async function stopAllPreviews() {
  const ids = [...active.keys()];
  await Promise.all(ids.map((key) => {
    const entry = active.get(key);
    active.delete(key);
    return entry ? stopChild(entry.child, 2500).then(() => removePreviewDatabase(entry)) : Promise.resolve();
  }));
}
