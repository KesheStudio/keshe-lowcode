import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { E2E_PORT, E2E_PORT_EXPLICIT, E2E_RUN_ID, E2E_RUN_ROOT, PLATFORM_ROOT, detectBrowser } from './config.mjs';
import { cleanupStaleRoots } from './temp-root.mjs';

const problems = [];
const notes = [];

function pass(label, detail) {
  console.log('  [通过] ' + label + (detail ? '：' + detail : ''));
}

function fail(label, detail, fix) {
  problems.push({ label, detail, fix });
  console.log('  [需修复] ' + label + (detail ? '：' + detail : ''));
}

function warn(label, detail) {
  console.log('  [提醒] ' + label + (detail ? '：' + detail : ''));
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  await cleanupStaleRoots(E2E_RUN_ROOT).catch(() => {});

  console.log('');
  console.log('低代码平台 E2E 环境预检');
  console.log('工程目录：' + PLATFORM_ROOT);
  console.log('本轮运行标识：' + E2E_RUN_ID);
  console.log('');

  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (major >= 20) pass('Node 版本', 'v' + nodeVersion);
  else fail('Node 版本', 'v' + nodeVersion + ' 偏低', '安装 Node 20 或更高版本后重跑。');

  let playwrightVersion = '';
  try {
    const require = createRequire(import.meta.url);
    playwrightVersion = require('@playwright/test/package.json').version;
  } catch (error) {
    playwrightVersion = '';
  }
  if (playwrightVersion) pass('Playwright 测试库', '@playwright/test ' + playwrightVersion);
  else fail('Playwright 测试库', '没有找到 @playwright/test', '在低代码工程根目录执行：npm install --save-dev @playwright/test');

  const browser = detectBrowser();
  if (browser.source) {
    pass('浏览器', browser.label + (browser.channel ? '（channel: ' + browser.channel + '）' : ''));
    notes.push(browser.channel
      ? '使用本机已安装的浏览器，不需要下载浏览器二进制。'
      : '使用 Playwright 自带 Chromium；如果启动失败，执行 npx playwright install chromium。');
  } else {
    fail('浏览器', '没有找到可用的本机浏览器，也没有 Playwright 自带 Chromium',
      '安装 Microsoft Edge / Google Chrome，或执行 npx playwright install chromium（只需一次）。');
  }

  const configFile = path.join(PLATFORM_ROOT, 'platform.config.json');
  if (fs.existsSync(configFile)) pass('平台配置', 'platform.config.json');
  else fail('平台配置', '缺少 platform.config.json', '确认当前工程目录是 c:\\project\\docs\\lowcode。');

  const templatesDir = path.join(PLATFORM_ROOT, 'templates');
  if (fs.existsSync(templatesDir)) pass('导出模板目录', 'templates/');
  else fail('导出模板目录', '缺少 templates/', '导出用例会失败；请恢复 templates/ 目录。');

  if (fs.existsSync(path.join(PLATFORM_ROOT, 'node_modules'))) pass('依赖目录', 'node_modules/');
  else fail('依赖目录', '缺少 node_modules/', '在低代码工程根目录执行：npm install');

  const runtimeDir = path.join(PLATFORM_ROOT, 'tests', 'e2e', '.runtime');
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const probe = path.join(runtimeDir, '.write-probe-' + process.pid);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    pass('隔离运行目录可写', runtimeDir);
  } catch (error) {
    fail('隔离运行目录不可写', runtimeDir, '测试服务要在这里建独立数据目录，请检查磁盘权限或空间。');
  }

  if (E2E_PORT_EXPLICIT) {
    const free = await portIsFree(E2E_PORT);
    if (free) pass('测试端口', String(E2E_PORT) + ' 空闲（来自 LC_E2E_PORT）');
    else fail('测试端口被占用', String(E2E_PORT),
      '换一个空闲端口（如 LC_E2E_PORT=9888），或去掉 LC_E2E_PORT 让每轮自动分配端口。');
  } else {
    pass('测试端口', '每轮自动分配空闲端口，并行跑多轮不会互抢');
    notes.push('多轮并行：直接同时起两个 npm run e2e，每轮自带运行根目录和端口，互不影响。');
  }

  if (!problems.length) {
    console.log('');
    for (const note of notes) console.log('  ' + note);
    console.log('');
    console.log('预检完成，可以开始跑用例。');
    return 0;
  }

  console.log('');
  console.log('预检没有通过，按下面逐条处理：');
  problems.forEach((item, index) => {
    console.log('  ' + (index + 1) + '. ' + item.label + '：' + (item.detail || '') + ' -> ' + (item.fix || ''));
  });
  console.log('');
  return 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.log('');
    console.log('预检脚本自身出错：' + (error && error.message ? error.message : String(error)));
    console.log('如果是缺少依赖，先在低代码工程根目录执行：npm install');
    process.exitCode = 1;
  });
