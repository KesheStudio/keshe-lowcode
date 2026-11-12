import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 并发验证：同时起两轮完整的 E2E（预检 + playwright test），每轮各自自动分配端口、
 * 各自建运行根目录、各自写报告与产物，跑完汇总两轮的通过数。
 *
 * 判定：两轮都通过 -> 互不干扰；任一轮失败或两轮使用了相同的端口 / 根目录 -> 验证不通过。
 */

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_ROOT = path.resolve(SUPPORT_DIR, '../../..');
const RUNTIME_DIR = path.join(PLATFORM_ROOT, 'tests', 'e2e', '.runtime', 'parallel-check');
const PREFLIGHT = path.join(SUPPORT_DIR, 'preflight.mjs');
const RUN_TIMEOUT_MS = 12 * 60 * 1000;

function resolvePlaywrightCli() {
  const candidates = [
    path.join(PLATFORM_ROOT, 'node_modules', 'playwright', 'cli.js'),
    path.join(PLATFORM_ROOT, 'node_modules', '@playwright', 'test', 'cli.js')
  ];
  const hit = candidates.find((file) => fs.existsSync(file));
  if (!hit) throw new Error('没有找到 Playwright CLI，请先在工程根目录执行 npm install');
  return hit;
}

/* 每轮独立环境：清掉上一轮/外部可能带进来的共享配置，只指定自己的报告与产物目录。 */
function runEnv(index) {
  const env = { ...process.env };
  delete env.LC_E2E_PORT;
  delete env.LC_E2E_RUN_ID;
  delete env.LC_E2E_RUN_ROOT;
  delete env.LC_E2E_BASE_URL;
  const dir = path.join(RUNTIME_DIR, 'run-' + index);
  env.LC_E2E_REPORT_DIR = path.join(dir, 'report');
  env.LC_E2E_ARTIFACTS_DIR = path.join(dir, 'artifacts');
  return env;
}

function runProcess(label, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: PLATFORM_ROOT, env, windowsHide: true });
    let output = '';
    const write = (chunk) => {
      const text = String(chunk);
      output += text;
      text.split(/\r?\n/).forEach((line) => {
        if (line.trim()) process.stdout.write('[' + label + '] ' + line + '\n');
      });
    };
    child.stdout.on('data', write);
    child.stderr.on('data', write);
    const timer = setTimeout(() => {
      process.stdout.write('[' + label + '] 超时 ' + Math.round(RUN_TIMEOUT_MS / 1000) + ' 秒，强制结束本轮\n');
      child.kill();
    }, RUN_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, output });
    });
  });
}

function readStats(index) {
  const file = path.join(RUNTIME_DIR, 'run-' + index, 'report', 'results.json');
  try {
    const stats = JSON.parse(fs.readFileSync(file, 'utf8')).stats || {};
    const passed = Number(stats.expected || 0);
    const failed = Number(stats.unexpected || 0) + Number(stats.flaky || 0);
    const skipped = Number(stats.skipped || 0);
    return { passed, failed, skipped, total: passed + failed + skipped };
  } catch (error) {
    return null;
  }
}

function parsePort(output) {
  const match = String(output || '').match(/\[E2E\]\s*测试服务端口：(\d+)/);
  return match ? match[1] : '';
}

function parseRoot(output) {
  const match = String(output || '').match(/lc-e2e-platform-[0-9]{8}-[0-9]{6}-[a-z0-9]+/);
  return match ? match[0] : '';
}

async function runOne(index, cli, extraArgs) {
  const label = 'run-' + index;
  const env = runEnv(index);

  const preflight = await runProcess(label, [PREFLIGHT], env);
  if (preflight.code !== 0) {
    return { index, label, stage: '预检', code: preflight.code, port: '', root: '', stats: readStats(index), output: preflight.output };
  }

  const test = await runProcess(label, [cli, 'test', ...extraArgs], env);
  return {
    index,
    label,
    stage: '用例',
    code: test.code,
    port: parsePort(preflight.output + test.output),
    root: parseRoot(preflight.output + test.output),
    stats: readStats(index),
    output: preflight.output + test.output
  };
}

function describe(run) {
  const parts = [];
  parts.push(run.port ? '端口 ' + run.port : '端口 未知');
  parts.push(run.root ? '根目录 ' + path.basename(run.root) : '根目录 未知');
  if (run.stats) {
    parts.push('用例 ' + run.stats.total + '，通过 ' + run.stats.passed + '，失败 ' + run.stats.failed +
      (run.stats.skipped ? '，跳过 ' + run.stats.skipped : ''));
  } else {
    parts.push('没有读到结果文件（' + run.stage + '阶段就可能结束了）');
  }
  return parts.join('  |  ');
}

async function main() {
  let cli = '';
  try {
    cli = resolvePlaywrightCli();
  } catch (error) {
    console.log('[并发验证] ' + error.message);
    return 1;
  }

  fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  console.log('');
  console.log('并发验证：同时启动两轮 E2E（各自自动分配端口、各自运行根目录）');
  console.log('工程目录：' + PLATFORM_ROOT);
  const extraArgs = process.argv.slice(2);
  if (extraArgs.length) console.log('本轮限定的用例范围：' + extraArgs.join(' '));
  console.log('');

  const runs = await Promise.all([runOne(1, cli, extraArgs), runOne(2, cli, extraArgs)]);

  const bothRan = runs.every((run) => run.port && run.root);
  const portsDistinct = bothRan && runs[0].port !== runs[1].port;
  const rootsDistinct = bothRan && runs[0].root !== runs[1].root;
  const allGreen = runs.every((run) => run.code === 0 && run.stats && run.stats.failed === 0);

  console.log('');
  console.log('──────── 并发验证结果 ────────');
  runs.forEach((run) => {
    console.log('  ' + run.label + '：' + describe(run) + '  |  退出码 ' + run.code);
  });
  console.log('  端口互不冲突：' + (portsDistinct ? '是' : '否（两轮共用了同一端口或没有取到端口）'));
  console.log('  运行根目录互不共用：' + (rootsDistinct ? '是' : '否（两轮共用了同一目录或没有取到目录）'));
  console.log('  全局状态文件：无（每轮按运行标识建目录，清理只删自己的目录）');
  console.log('  结论：' + (allGreen && portsDistinct && rootsDistinct
    ? '两轮互不干扰，全部通过'
    : '未通过，见上面每轮结果与原始日志'));
  console.log('──────────────────────────');
  console.log('');

  return allGreen && portsDistinct && rootsDistinct ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.log('[并发验证] 脚本自身出错：' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
