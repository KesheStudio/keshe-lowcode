import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  PLATFORM_ROOT,
  SERVER_ENTRY,
  MARK,
  checkNodeVersion,
  nodeVersionMessage,
  dependenciesInstalled,
  lockNewerThanInstall,
  runNpmInstall,
  findAvailablePort,
  loadConfigOrExplain,
  explainFailure,
  writeJson,
  isPortFree
} from './_shared.mjs';

/**
 * 一键启动（Windows 双击 start.cmd 或 npm start）：
 * 版本检查 → 依赖补齐 → 配置校验 → 端口回退 → 起服务（服务自己打印地址并开浏览器）。
 * 失败一律给下一步，而不是把堆栈甩给用户。
 */
async function main() {
  const node = checkNodeVersion(20);
  if (!node.ok) {
    explainFailure('Node 版本过低', nodeVersionMessage(node), [
      '安装 Node 20 LTS 或更高版本',
      '重开终端后运行 node -v 确认'
    ]);
    process.exit(1);
  }

  const needInstall = !dependenciesInstalled() || lockNewerThanInstall();
  if (needInstall) {
    console.log(`${MARK.info} 正在安装本地依赖（首次启动或锁文件有更新）…`);
    const result = await runNpmInstall();
    if (!result.ok || !dependenciesInstalled()) {
      explainFailure('依赖安装失败', result.message || `npm install 退出码 ${result.code}`, [
        '确认本机 npm 源可用：npm config get registry',
        '手动执行 npm install 查看完整输出',
        '若公司网络需要代理，配置 npm 代理后重试'
      ]);
      process.exit(1);
    }
    console.log(`${MARK.ok} 依赖已就绪`);
  }

  const loaded = loadConfigOrExplain();
  const { config, paths } = loaded;

  let port = config.platform.port;
  if (!(await isPortFree(config.platform.host, port))) {
    const fallback = await findAvailablePort(config.platform.host, port);
    if (!fallback) {
      explainFailure(`端口 ${port} 及后续 20 个端口都被占用`, '', [
        '关闭占用端口的程序，或改 platform.config.json 的 platform.port'
      ]);
      process.exit(1);
    }
    console.log(`${MARK.warn} 端口 ${port} 被占用，改用 ${fallback}`);
    console.log('  地址以服务打印为准；需要固定端口请关闭占用程序。');
    port = fallback;
  }

  await writeJson(path.join(paths.logsDir, 'start-port.json'), {
    at: new Date().toISOString(),
    requestedPort: config.platform.port,
    usedPort: port,
    pid: process.pid
  });

  if (!(await fs.stat(SERVER_ENTRY).then(() => true).catch(() => false))) {
    explainFailure('服务入口缺失', path.relative(PLATFORM_ROOT, SERVER_ENTRY), [
      '确认 server/index.js 存在',
      '若删改过目录，恢复后再运行 npm start'
    ]);
    process.exit(1);
  }

  const child = spawn(process.execPath, [SERVER_ENTRY, '--port', String(port)], {
    cwd: PLATFORM_ROOT,
    stdio: 'inherit'
  });

  child.on('error', (error) => {
    explainFailure('无法启动本地服务', error.message, ['运行 npm run doctor 检查环境']);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      explainFailure('本地服务退出', `退出码 ${code}`, [
        '查看 logs/boot-error.json',
        '运行 npm run doctor',
        '确认数据目录可写、端口未被占用'
      ]);
      process.exit(code);
    }
    process.exit(0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
}

main().catch((error) => {
  explainFailure('启动过程出错', error && error.message ? error.message : '未知错误', ['运行 npm run doctor 检查环境']);
  process.exit(1);
});
