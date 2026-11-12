import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPlatformConfig, ConfigError } from '../server/src/config.js';

export const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_ENTRY = path.join(PLATFORM_ROOT, 'server', 'index.js');
export const MARK = { ok: '✓', fail: '✗', info: '·', warn: '!' };

export function checkNodeVersion(minMajor = 20) {
  const current = process.versions.node;
  const major = Number(current.split('.')[0]);
  return { ok: major >= minMajor, current, minMajor };
}

export function nodeVersionMessage(check) {
  return `需要 Node ${check.minMajor} 或更高版本，当前是 v${check.current}。请安装 Node LTS（nodejs.org）后重试。`;
}

export function loadConfigOrExplain({ exitCode = 2 } = {}) {
  try {
    return loadPlatformConfig(PLATFORM_ROOT);
  } catch (error) {
    console.error('');
    console.error(`${MARK.fail} 配置不可用：${error.message}`);
    if (error instanceof ConfigError) {
      for (const issue of error.issues) console.error(`  - ${issue.path}：${issue.message}`);
    }
    console.error('  处理方式：按 CONTRACTS 3.5 修改 platform.config.json，或运行 npm run doctor 查看细节。');
    process.exit(exitCode);
  }
}

export function dependenciesInstalled() {
  return fs.existsSync(path.join(PLATFORM_ROOT, 'node_modules', 'fastify', 'package.json'));
}

export function lockNewerThanInstall() {
  const lock = path.join(PLATFORM_ROOT, 'package-lock.json');
  const installed = path.join(PLATFORM_ROOT, 'node_modules', '.package-lock.json');
  try {
    return fs.statSync(lock).mtimeMs > fs.statSync(installed).mtimeMs;
  } catch {
    return true;
  }
}

export function runNpmInstall() {
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['install', '--no-audit', '--no-fund'], {
      cwd: PLATFORM_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
    child.on('error', (error) => resolve({ ok: false, message: error.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, code }));
  });
}

export function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen({ host, port, exclusive: true });
  });
}

export async function findAvailablePort(host, startPort, attempts = 20) {
  for (let offset = 0; offset <= attempts; offset += 1) {
    const candidate = startPort + offset;
    if (candidate > 65535) break;
    if (await isPortFree(host, candidate)) return candidate;
  }
  return null;
}

export async function ensureLogsDir(paths) {
  await fsp.mkdir(paths.logsDir, { recursive: true });
}

export async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

/** 友好错误输出：只给可执行下一步，不打印原始堆栈。 */
export function explainFailure(title, detail, nextSteps = []) {
  console.error('');
  console.error(`${MARK.fail} ${title}`);
  if (detail) console.error(`  ${detail}`);
  for (const step of nextSteps) console.error(`  → ${step}`);
}
