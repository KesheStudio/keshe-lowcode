import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { E2E_RUN_ID, E2E_RUNTIME_DIR, E2E_RUN_ROOT, PLATFORM_ROOT, readPlatformConfig } from './config.mjs';

const ROOT_PREFIX = 'lc-e2e-platform-';
const COPY_DIRS = ['server', 'src', 'shared', 'assets', 'vendor', 'templates'];

/**
 * 隔离平台根目录按「本轮运行」建：目录名带 runId，每轮自己一份代码副本和数据目录。
 * 不再写任何全局状态文件（如 .current-root.json）——并行时一方清理不会删到另一方。
 */
export function makeRootPath() {
  return path.join(E2E_RUNTIME_DIR, ROOT_PREFIX + E2E_RUN_ID);
}

/**
 * 建一个独立的平台根目录：
 * - 代码目录复制（server/src/shared/assets/vendor + templates + 根目录 HTML + package.json）
 * - templates 里的 node_modules 不复制（35MB 且导出用不到），其余模板文件照常复制
 * - node_modules 依赖靠 Node 从子目录向上查找到真实工程的依赖
 * - data / exports / logs 全在新目录里，用例不会碰到 data/sites 下任何已有站点
 */
export async function createIsolatedRoot(port, rootPath) {
  await fs.mkdir(E2E_RUNTIME_DIR, { recursive: true });
  const requested = String(rootPath || '').trim();
  const root = requested && path.basename(requested).startsWith(ROOT_PREFIX) ? requested : makeRootPath();
  await fs.mkdir(root, { recursive: true });

  for (const dir of COPY_DIRS) {
    await fs.cp(path.join(PLATFORM_ROOT, dir), path.join(root, dir), {
      recursive: true,
      /* 跳过模板自带的 node_modules：体积大且导出流程不依赖它们。
         不用 junction/symlink —— 部分环境下创建后不可见，反而让导出缺模板。 */
      filter: (src) => path.basename(src) !== 'node_modules'
    });
  }

  const rootFiles = (await fs.readdir(PLATFORM_ROOT)).filter((name) => name.endsWith('.html') || name === 'package.json');
  for (const name of rootFiles) {
    await fs.copyFile(path.join(PLATFORM_ROOT, name), path.join(root, name));
  }

  const config = readPlatformConfig();
  config.platform.port = port;
  config.platform.openBrowser = false;
  config.platform.host = '127.0.0.1';
  await fs.writeFile(path.join(root, 'platform.config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');

  await fs.writeFile(
    path.join(root, '.e2e-owner.json'),
    JSON.stringify({ runId: E2E_RUN_ID, pid: process.pid, createdAt: new Date().toISOString(), platformRoot: PLATFORM_ROOT }, null, 2),
    'utf8'
  );
  return root;
}

export async function removeRoot(root) {
  if (!root || !path.basename(root).startsWith(ROOT_PREFIX)) return;
  try {
    // Windows 下 templates 是 junction，异步 fs.rm 容易报 ENOTEMPTY；同步删除 + 重试更稳。
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 120 });
  } catch (error) {
    // 删不掉就留给下一次预检/teardown
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * 清掉已退出轮次留下的临时根目录；正在使用的（本轮的 / 归属进程还活着的）一律跳过。
 * 判断依据是目录内的 .e2e-owner.json（pid）+ 本轮的 E2E_RUN_ROOT，不依赖任何共享状态文件。
 */
export async function cleanupStaleRoots(keepRoot) {
  const entries = await fs.readdir(E2E_RUNTIME_DIR).catch(() => []);
  const keep = String(keepRoot || E2E_RUN_ROOT || '');
  for (const name of entries) {
    if (!name.startsWith(ROOT_PREFIX)) continue;
    const root = path.join(E2E_RUNTIME_DIR, name);
    if (root === keep) continue;
    let owner = null;
    try {
      owner = JSON.parse(await fs.readFile(path.join(root, '.e2e-owner.json'), 'utf8'));
    } catch (error) {
      owner = null;
    }
    if (owner && pidAlive(Number(owner.pid))) continue;
    if (!owner) {
      // 没有归属文件：创建过程中断的目录。给 60 秒窗口避免误删其他轮次正在初始化的目录。
      const stat = await fs.stat(root).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs < 60 * 1000) continue;
    }
    await removeRoot(root);
  }
}
