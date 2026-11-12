import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { E2E_PORT, E2E_RUN_ID, E2E_RUN_ROOT } from './config.mjs';
import { createIsolatedRoot } from './temp-root.mjs';

/* 先确认端口没被别人占：显式 LC_E2E_PORT 且被占用时给一条明确可执行的提示，
   而不是让 Playwright 等到 webServer 超时。自动分配端口的轮次几乎不会走到这里。 */
function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

const free = await portIsFree(E2E_PORT);
if (!free) {
  console.error('[E2E] 端口 ' + E2E_PORT + ' 已被占用，本轮无法启动测试服务。');
  console.error('[E2E] 处理办法：去掉 LC_E2E_PORT 让每轮自动分配端口，或换一个空闲端口（如 LC_E2E_PORT=9888）。');
  process.exit(1);
}

const root = await createIsolatedRoot(E2E_PORT, E2E_RUN_ROOT);

function syncRemove() {
  if (!root || !path.basename(root).startsWith('lc-e2e-platform-')) return;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    // 退出阶段删不掉就交给下一次预检/teardown 处理
  }
}

process.on('exit', syncRemove);
process.on('SIGINT', syncRemove);
process.on('SIGTERM', syncRemove);

console.log('[E2E] 本轮运行标识：' + E2E_RUN_ID);
console.log('[E2E] 测试服务端口：' + E2E_PORT);
console.log('[E2E] 使用隔离平台根目录：' + root);
console.log('[E2E] 数据目录：' + path.join(root, 'data') + '（跑完只删本轮目录）');

process.argv = [process.execPath, path.join(root, 'server', 'index.js'), '--no-open', '--port', String(E2E_PORT)];

try {
  await import(pathToFileURL(path.join(root, 'server', 'index.js')).href);
} catch (error) {
  console.error('[E2E] 测试服务启动失败：' + (error && error.message ? error.message : error));
  syncRemove();
  process.exitCode = 1;
}
