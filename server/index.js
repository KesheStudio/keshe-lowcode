import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePlatformRoot, loadPlatformConfig, ConfigError, CONTRACTS_VERSION } from './src/config.js';
import { prepareRuntime, writeBootError, clearBootError, readBootError, openBrowser } from './src/bootstrap.js';
import { createServer } from './src/http.js';

const platformRoot = resolvePlatformRoot(import.meta.url);
const argv = process.argv.slice(2);

function flagValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

const portOverride = flagValue('--port');
const noOpen = argv.includes('--no-open');

let loaded;
try {
  loaded = loadPlatformConfig(platformRoot);
} catch (error) {
  const logsDir = path.join(platformRoot, 'logs');
  const payload = {
    code: error.code || 'LC_E_CONFIG_INVALID',
    message: error.message,
    issues: error instanceof ConfigError ? error.issues : null,
    next: [
      '检查 platform.config.json 是否存在且为合法 JSON',
      '对照 CONTRACTS 3.5 的字段规则修改',
      '改好后重新运行 npm start'
    ]
  };
  writeBootError({ logsDir }, payload);
  console.error('');
  console.error('启动失败：配置不可用');
  console.error(`  ${error.message}`);
  for (const issue of payload.issues || []) {
    console.error(`  - ${issue.path}：${issue.message}`);
  }
  console.error('  详细原因已写入 logs/boot-error.json；修好后重新运行 npm start。');
  process.exit(2);
}

const { config, paths, warnings } = loaded;
const port = portOverride ? Number(portOverride) : config.platform.port;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`启动失败：端口参数无效（${portOverride}）`);
  process.exit(2);
}

const runtime = await prepareRuntime(paths, config);
const token = crypto.randomBytes(24).toString('hex');
const startedAt = new Date().toISOString();
const pkg = readPackageVersion(platformRoot);

const app = await createServer({
  platformRoot,
  config,
  paths,
  runtime,
  token,
  port,
  startedAt,
  version: pkg,
  contractsVersion: CONTRACTS_VERSION,
  configWarnings: warnings,
  bootError: readBootError(paths)
});

try {
  await app.listen({ host: config.platform.host, port });
} catch (error) {
  if (error && error.code === 'EADDRINUSE') {
    console.error('');
    console.error(`启动失败：端口 ${port} 已被占用`);
    console.error('  处理方式：关闭占用该端口的程序，或改 platform.config.json 的 platform.port；');
    console.error('  也可以直接双击 start.cmd，它会自动换一个可用端口。');
    process.exit(1);
  }
  console.error('');
  console.error(`启动失败：无法监听 ${config.platform.host}:${port}`);
  console.error(`  原因：${error && error.message ? error.message : '未知错误'}`);
  console.error('  处理方式：运行 npm run doctor 查看自检结果。');
  process.exit(1);
}

clearBootError(paths);
await writeStartRecord(paths.logsDir, { requestedPort: config.platform.port, usedPort: port, pid: process.pid });

const url = `http://${formatHost(config.platform.host)}:${port}/`;
console.log('');
console.log(`  ${config.platform.name} 已启动`);
console.log(`  地址：${url}`);
console.log(`  数据：${config.paths.dataDir}/sites（相对平台根）`);
if (runtime.readOnly) {
  console.log(`  只读模式：${runtime.readOnlyReason}`);
  console.log('  编辑器可浏览，保存与构建已禁用。');
}
for (const warning of warnings) {
  console.log(`  配置提示：${warning.path} —— ${warning.message}`);
}
for (const report of runtime.siteReports) {
  if (!report.ok || report.transactions.length) {
    console.log(`  站点恢复：${report.siteId} 事务 ${report.transactions.length} 项，警告 ${report.warnings.length} 项`);
  }
}
console.log('  停止：Ctrl+C');
console.log('');

if (config.platform.openBrowser && !noOpen) openBrowser(url);

const shutdown = async (signal) => {
  console.log(`\n收到 ${signal}，正在关闭服务…`);
  await app.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function readPackageVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatHost(host) {
  return host === '::1' ? '[::1]' : host;
}

async function writeStartRecord(logsDir, payload) {
  try {
    const fsPromises = await import('node:fs/promises');
    await fsPromises.mkdir(logsDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(logsDir, 'start-port.json'),
      JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2),
      'utf8'
    );
  } catch {
    /* 记录失败不影响启动 */
  }
}
