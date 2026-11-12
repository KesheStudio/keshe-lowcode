#!/usr/bin/env node
// 平台可直接调用的非交互构建入口：一次校验 → 渲染 → 打包 → 收集产物。
//
// 用法：node scripts/build-app.mjs --project <生成的工程目录> --out <输出目录> --targets msi,nsis
//
// 约定：
// - 全程不读 stdin、不弹交互提示；进度写 stderr，最终结果只在 stdout 打一行 JSON。
// - 成功退出码 0；失败退出码非 0，JSON 里给 code / message / hint，不抛栈。
// - 不依赖当前工作目录：所有相对路径按调用者的 cwd 解析，构建子进程的 cwd 固定为 --project。
// - 并发策略：按（工程真实路径 + identifier）排队，每个工程一个独立 CARGO_TARGET_DIR，
//   同一工程的第二个构建等待锁，不会和第一个构建抢同一份缓存。
// - 失败时清理未完成的 bundle 与已复制的半成品，保留编译缓存与日志，日志路径见 JSON logs.path。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { buildTauriConf, buildRuntimeConfig, buildFrontendBridge, PLATFORM_TARGETS, pickTargets } from './render-config.mjs';
import { validateConfig } from './validate-config.mjs';

const START = Date.now();
const BUILD_ID = newBuildId();
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 60 * 60 * 1000;

const EXIT_CODES = {
  OK: 0,
  E_USAGE: 2,
  E_PROJECT_NOT_FOUND: 3,
  E_PROJECT_INVALID: 3,
  E_CONFIG_INVALID: 3,
  E_TARGET_UNSUPPORTED: 4,
  E_TARGET_EMPTY: 4,
  E_SIGNING_MISSING: 5,
  E_SIGNING_KEY_NOT_FOUND: 5,
  E_CERT_NOT_FOUND: 5,
  E_TOOLCHAIN_MISSING: 6,
  E_TAURI_CLI_MISSING: 6,
  E_OUT_DIR_INVALID: 6,
  E_CACHE_DIR_INVALID: 6,
  E_ICONS_MISSING: 6,
  E_RENDER_FAILED: 6,
  E_SIDECAR_BINARY: 6,
  E_SIDECAR_VERSION_MISMATCH: 6,
  E_BUILD_LOCK_TIMEOUT: 7,
  E_BUILD_FAILED: 8,
  E_ARTIFACT_MISSING: 8,
  E_ARTIFACT_COPY_FAILED: 8,
  E_TIMEOUT: 9,
  E_INTERRUPTED: 130,
  E_UNEXPECTED: 10,
};

const BUNDLE_DIRS = {
  msi: 'msi',
  nsis: 'nsis',
  appimage: 'appimage',
  deb: 'deb',
  rpm: 'rpm',
};

const ctx = {
  args: null,
  stage: 'init',
  platform: null,
  projectDir: null,
  outDir: null,
  logPath: null,
  config: null,
  targets: [],
  targetDir: null,
  cacheDir: null,
  lockPath: null,
  lockHeld: false,
  child: null,
  copied: [],
  warnings: [],
  keyFile: null,
  finished: false,
};

function newBuildId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `lc-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-`
    + `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-`
    + `${process.pid}-${crypto.randomBytes(2).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function appendRaw(text) {
  if (!ctx.logPath) return;
  try { fs.appendFileSync(ctx.logPath, text); } catch { /* 日志写失败不阻断构建 */ }
}

function appendLog(text) {
  appendRaw(text.endsWith('\n') ? text : `${text}\n`);
}

function log(message) {
  const line = `[${nowIso()}] ${message}`;
  appendLog(line);
  process.stderr.write(`${line}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sizeOf(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(path.join(target, entry.name));
  }
  return total;
}

function parseArgs(argv) {
  const out = { targets: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--targets') out.targets = argv[++i];
    else if (a === '--platform') out.platform = argv[++i];
    else if (a === '--android-targets') out.androidTargets = argv[++i];
    else if (a === '--log-dir') out.logDir = argv[++i];
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '--lock-timeout-ms') out.lockTimeoutMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!out.unknown) out.unknown = a;
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    '平台调用的非交互构建入口。',
    '',
    '用法：',
    '  node scripts/build-app.mjs --project <工程目录> --out <输出目录> [选项]',
    '',
    '参数：',
    '  --project <dir>         生成的工程目录（含 config/desktop.json 与 src-tauri/）',
    '  --out <dir>             安装包输出目录；日志默认写到 <out>/logs',
    '  --targets <list>        逗号分隔，如 msi,nsis；默认按 config.bundle.targets 裁剪到当前平台',
    '  --platform <name>       目标平台：win32 / linux / android；默认取构建机平台',
    '  --android-targets <list> Android ABI：aarch64,armv7,i686,x86_64；默认 aarch64,x86_64（产出 universal，手机与模拟器都能装）',
    '  --log-dir <dir>         日志目录（默认 <out>/logs，落盘失败时退回系统临时目录）',
    '  --timeout-ms <n>        打包超时，默认 1800000（30 分钟）',
    '  --lock-timeout-ms <n>   等待同工程其它构建释放缓存锁的上限，默认 3600000（60 分钟）',
    '  --help                  显示本说明',
    '',
    '成功/失败都会在 stdout 输出一行 JSON；失败退出码非 0。详见 docs/build-app.md。',
    '',
  ].join('\n'));
}

function prepareLog(outDir, logDir) {
  const dirs = [];
  if (logDir) dirs.push(path.resolve(process.cwd(), logDir));
  if (outDir) dirs.push(path.join(outDir, 'logs'));
  dirs.push(path.join(os.tmpdir(), 'lc-build-logs'));
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.lc-write-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      const file = path.join(dir, `${BUILD_ID}.log`);
      fs.writeFileSync(file, `[${nowIso()}] build ${BUILD_ID} started\n`);
      return file;
    } catch { /* 换下一个候选目录 */ }
  }
  return null;
}

function releaseLock() {
  if (!ctx.lockHeld || !ctx.lockPath) return;
  try { fs.unlinkSync(ctx.lockPath); } catch { /* 锁文件被清理过就算了 */ }
  ctx.lockHeld = false;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function acquireLock(lockPath, waitMs) {
  const started = Date.now();
  let lastNotice = 0;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        buildId: BUILD_ID,
        startedAt: nowIso(),
        host: os.hostname(),
      }), { flag: 'wx' });
      ctx.lockHeld = true;
      return { waitedMs: Date.now() - started };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { holder = null; }
      if (holder && typeof holder.pid === 'number' && !isProcessAlive(holder.pid)) {
        // 上一个构建进程已消失（崩溃/被杀），接管这把锁。
        try { fs.unlinkSync(lockPath); } catch { /* 并发下可能已被别人删掉 */ }
        continue;
      }
      if (!holder) {
        // 锁文件内容损坏：超过 2 小时视为陈旧，避免永久卡死。
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > 2 * 60 * 60 * 1000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch { /* 文件刚好消失，回到循环顶部 */ }
      }
      if (Date.now() - started >= waitMs) return null;
      if (Date.now() - lastNotice > 15000) {
        lastNotice = Date.now();
        log(`另一个构建正在使用同一工程的缓存，排队等待（${holder?.buildId || '未知构建'}，已等 ${Math.round((Date.now() - started) / 1000)} 秒）`);
      }
      await sleep(1000);
    }
  }
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ }
  }
}

function runCapture(cmd, args, timeout = 30000) {
  // 不用 shell：Windows 上 node/cargo 路径带空格会被截断。
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true });
  if (r.error) return { ok: false, out: r.error.message };
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), status: r.status };
}

function looksLikeKeyPath(value) {
  if (typeof value !== 'string' || !value) return false;
  // minisign 私钥内容首行是 "untrusted comment"，且含换行；内容不是路径。
  if (value.includes('\n') || value.includes('untrusted comment')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  if (/\.(key|pem)$/i.test(value)) return true;
  // base64 内容只在单行很长时才出现，且不带反斜杠；这里只看反斜杠，避免把 base64 误判成路径。
  return value.length < 260 && value.includes('\\');
}

function resolveKeyPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(ctx.projectDir, value);
}

function cacheRoot() {
  if (process.env.LC_BUILD_CACHE_DIR) return path.resolve(process.env.LC_BUILD_CACHE_DIR);
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : path.join(os.homedir(), '.cache');
  return path.join(base, 'lc-build-cache');
}

function cacheKey(projectDir, identifier) {
  return crypto.createHash('sha1').update(`${projectDir}|${identifier}`).digest('hex').slice(0, 12);
}

function resolveTauriCli(projectDir) {
  const jsEntry = path.join(projectDir, 'node_modules/@tauri-apps/cli/tauri.js');
  if (fs.existsSync(jsEntry)) return { kind: 'node', file: jsEntry };

  const binName = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
  const localBin = path.join(projectDir, 'node_modules/.bin', binName);
  if (fs.existsSync(localBin)) return { kind: 'bin', file: localBin };

  const probe = runCapture(process.platform === 'win32' ? 'where' : 'which', ['tauri'], 15000);
  if (probe.ok) {
    const first = probe.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return { kind: 'bin', file: first };
  }
  return null;
}

function cliSpec(cli) {
  if (cli.kind === 'node') return { cmd: process.execPath, args: [cli.file] };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli.file)) {
    // Node 18+ 不允许直接 spawn .cmd/.bat；走 cmd.exe，参数逐个加引号。
    const quote = (s) => (/[ \t"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
    return {
      cmd: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [cli.file, ...cli.args || []].map(quote).join(' ')],
    };
  }
  return { cmd: cli.file, args: [] };
}

function runTauri(cli, commandArgs, cwd, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const spec = cliSpec(cli);
    const args = [...spec.args, ...commandArgs];
    let child;
    try {
      child = spawn(spec.cmd, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // POSIX 上建独立进程组，超时能整组杀掉；Windows 用 taskkill /T。
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      reject(e);
      return;
    }
    ctx.child = child;
    let tail = '';
    const onData = (buf) => {
      const text = buf.toString();
      appendRaw(text);
      tail = (tail + text).slice(-4000);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      appendLog(`[${nowIso()}] 构建超过 ${timeoutMs} ms，终止进程树（pid ${child.pid}）`);
      killTree(child.pid);
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      ctx.child = null;
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      ctx.child = null;
      resolve({ code, signal, timedOut, tail });
    });
  });
}

function isArtifact(target, name) {
  if (/\.sig$/i.test(name)) return false;
  switch (target) {
    case 'msi': return /\.msi$/i.test(name);
    case 'nsis': return /\.exe$/i.test(name);
    case 'appimage': return /\.AppImage$/i.test(name);
    case 'deb': return /\.deb$/i.test(name);
    case 'rpm': return /\.rpm$/i.test(name);
    default: return false;
  }
}

function copyAtomic(src, dst) {
  const tmp = `${dst}.${BUILD_ID}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(src, tmp, { recursive: true });
  fs.rmSync(dst, { recursive: true, force: true });
  fs.renameSync(tmp, dst);
}

function artifactError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.extra = extra;
  return err;
}

function collectArtifacts(bundleBase, targets, outDir) {
  const records = [];
  for (const target of targets) {
    const dir = path.join(bundleBase, BUNDLE_DIRS[target]);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    let candidates = entries
      .filter((e) => isArtifact(target, e.name))
      .map((e) => path.join(dir, e.name));
    if (candidates.length === 0) {
      throw artifactError('E_ARTIFACT_MISSING', `构建成功但没有找到 ${target} 产物（应位于 ${dir}）`, { target, dir });
    }
    candidates = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (candidates.length > 1) {
      ctx.warnings.push(`${target}: 目录里有多个产物，取最新的一个（${path.basename(candidates[0])}）`);
    }
    const src = candidates[0];
    const dst = path.join(outDir, path.basename(src));
    try {
      copyAtomic(src, dst);
    } catch (e) {
      throw artifactError('E_ARTIFACT_COPY_FAILED', `复制 ${src} 到 ${dst} 失败：${e.message}`, { target, src, dst });
    }
    ctx.copied.push(dst);

    const sigSrc = `${src}.sig`;
    const signed = fs.existsSync(sigSrc);
    let sigDst = null;
    if (signed) {
      sigDst = `${dst}.sig`;
      try {
        copyAtomic(sigSrc, sigDst);
        ctx.copied.push(sigDst);
      } catch (e) {
        throw artifactError('E_ARTIFACT_COPY_FAILED', `复制签名 ${sigSrc} 失败：${e.message}`, { target });
      }
    }
    records.push({
      target,
      path: dst,
      file: path.basename(dst),
      sizeBytes: sizeOf(dst),
      updateSigned: signed,
      signaturePath: sigDst,
    });
  }
  return records;
}

function walkFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function collectAndroidArtifacts(outputsDir, targets, outDir) {
  const ext = { apk: '.apk', aab: '.aab' };
  const records = [];
  for (const target of targets) {
    const suffix = ext[target];
    if (!suffix) throw artifactError('E_TARGET_UNSUPPORTED', `Android 不支持目标 ${target}`, { target });
    const candidates = walkFiles(outputsDir)
      .filter((f) => f.toLowerCase().endsWith(suffix) && !/\.idsig$/i.test(f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!candidates.length) {
      throw artifactError('E_ARTIFACT_MISSING', `构建成功但没有找到 ${target} 产物（应位于 ${outputsDir}）`, { target, dir: outputsDir });
    }
    if (candidates.length > 1) ctx.warnings.push(`${target}: 找到多个产物，取最新的一个（${path.basename(candidates[0])}）`);
    const src = candidates[0];
    const dst = path.join(outDir, path.basename(src));
    try {
      copyAtomic(src, dst);
    } catch (e) {
      throw artifactError('E_ARTIFACT_COPY_FAILED', `复制 ${src} 到 ${dst} 失败：${e.message}`, { target, src, dst });
    }
    ctx.copied.push(dst);
    records.push({
      target,
      path: dst,
      file: path.basename(dst),
      sizeBytes: sizeOf(dst),
      updateSigned: false,
      signaturePath: null,
    });
  }
  return records;
}

function buildFailureHint(tail) {
  if (/TAURI_SIGNING_PRIVATE_KEY|signing private key|signing key/i.test(tail)) {
    return '更新签名材料不可用：检查 TAURI_SIGNING_PRIVATE_KEY（内容或文件路径）与 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。';
  }
  if (/os error 5|Access is denied|拒绝访问/i.test(tail)) {
    return '打包工具缓存写入被拒：检查 %LOCALAPPDATA%\\tauri 的权限与杀毒软件拦截。';
  }
  if (/__TAURI_BUNDLE_TYPE/.test(tail)) {
    return '二进制残留了上次中断的包类型标记：先 cargo clean -p <crate> 再重试。';
  }
  if (/no space left|磁盘空间/i.test(tail)) {
    return '磁盘空间不足，清理后重试。';
  }
  return '查看 logs.path 的完整构建输出；常见原因是打包工具缓存缺失、签名材料不可用或 Rust 工具链被裁剪。';
}

function cleanupFailure() {
  const removed = [];
  if (ctx.child?.pid) killTree(ctx.child.pid);
  if (ctx.targetDir) {
    const bundle = path.join(ctx.targetDir, 'release', 'bundle');
    try {
      if (fs.existsSync(bundle)) {
        fs.rmSync(bundle, { recursive: true, force: true });
        removed.push(bundle);
      }
    } catch { /* 清不掉也要继续释放锁 */ }
  }
  for (const file of ctx.copied) {
    try { fs.rmSync(file, { recursive: true, force: true }); removed.push(file); } catch { /* 忽略 */ }
  }
  ctx.copied = [];
  releaseLock();
  appendLog(`[${nowIso()}] cleanup: ${removed.length ? removed.join(', ') : '没有需要清理的临时产物'}`);
  return removed;
}

function projectInfo() {
  if (!ctx.projectDir) return null;
  if (!ctx.config) return { dir: ctx.projectDir };
  return {
    dir: ctx.projectDir,
    productName: ctx.config.productName,
    identifier: ctx.config.identifier,
    version: ctx.config.version,
  };
}

function failAndExit(code, message, hint, extra = {}) {
  if (ctx.finished) return;
  ctx.finished = true;
  const removed = cleanupFailure();
  const result = {
    ok: false,
    code,
    message,
    ...(hint ? { hint } : {}),
    ...extra,
    buildId: BUILD_ID,
    stage: ctx.stage,
    platform: ctx.platform || process.platform,
    project: projectInfo(),
    targets: ctx.targets,
    durationMs: Date.now() - START,
    logs: { path: ctx.logPath },
    warnings: ctx.warnings,
    cleanup: { tempRemoved: removed, logsKept: true },
  };
  appendLog(`[${nowIso()}] FAILED ${code}: ${message}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(EXIT_CODES[code] ?? 1);
}

function finishOk(extra) {
  if (ctx.finished) return;
  ctx.finished = true;
  releaseLock();
  const result = {
    ok: true,
    code: 'OK',
    buildId: BUILD_ID,
    platform: ctx.platform || process.platform,
    project: projectInfo(),
    outDir: ctx.outDir,
    targets: ctx.targets,
    durationMs: Date.now() - START,
    ...extra,
    logs: { path: ctx.logPath },
    warnings: ctx.warnings,
    cleanup: { tempRemoved: [], logsKept: true, note: '成功构建保留编译缓存用于下次增量；失败构建会删除未完成的 bundle' },
  };
  appendLog(`[${nowIso()}] SUCCESS ${BUILD_ID} (${result.durationMs} ms)`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

function mapConfigCode(errors) {
  const codes = new Set(errors.map((e) => e.code));
  if (codes.size === 1 && codes.has('E_SIDECAR_BINARY')) return 'E_SIDECAR_BINARY';
  return 'E_CONFIG_INVALID';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ctx.args = args;

  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.unknown) {
    failAndExit('E_USAGE', `不认识的参数：${args.unknown}`, '运行 node scripts/build-app.mjs --help 查看支持的参数。');
    return;
  }
  if (!args.project) {
    failAndExit('E_USAGE', '缺少 --project <生成的工程目录>', '至少提供 --project 与 --out。');
    return;
  }
  if (!args.out) {
    failAndExit('E_USAGE', '缺少 --out <输出目录>', '至少提供 --project 与 --out。');
    return;
  }
  ctx.platform = args.platform || process.platform;
  if (!PLATFORM_TARGETS[ctx.platform]) {
    failAndExit('E_TARGET_UNSUPPORTED', `不支持的目标平台：${ctx.platform}`, '可取值：win32、linux、android。');
    return;
  }
  for (const key of ['timeoutMs', 'lockTimeoutMs']) {
    if (args[key] !== undefined && (!Number.isFinite(args[key]) || args[key] <= 0)) {
      failAndExit('E_USAGE', `${key === 'timeoutMs' ? '--timeout-ms' : '--lock-timeout-ms'} 必须是正整数（毫秒）`);
      return;
    }
  }

  ctx.projectDir = path.resolve(process.cwd(), args.project);
  ctx.outDir = path.resolve(process.cwd(), args.out);
  ctx.logPath = prepareLog(ctx.outDir, args.logDir);
  log(`构建入口启动 ${BUILD_ID}：${ctx.projectDir} → ${ctx.outDir}`);

  // ---- 1. 工程目录 ----
  ctx.stage = 'preflight';
  let projectStat;
  try { projectStat = fs.statSync(ctx.projectDir); } catch { projectStat = null; }
  if (!projectStat || !projectStat.isDirectory()) {
    failAndExit('E_PROJECT_NOT_FOUND', `工程目录不存在或不是目录：${ctx.projectDir}`, '确认导出管线已把工程落盘，再传入 --project。');
    return;
  }
  ctx.projectDir = fs.realpathSync(ctx.projectDir);
  const required = ['config/desktop.json', 'src-tauri/Cargo.toml'];
  const missing = required.filter((rel) => !fs.existsSync(path.join(ctx.projectDir, rel)));
  if (missing.length) {
    failAndExit('E_PROJECT_INVALID', `工程目录缺少必要文件：${missing.join('、')}`, '导出管线应完整复制模板（config/、src-tauri/、web/、scripts/）。');
    return;
  }

  let configRaw;
  try {
    configRaw = fs.readFileSync(path.join(ctx.projectDir, 'config/desktop.json'), 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    failAndExit('E_PROJECT_INVALID', `配置读取失败：${e.message}`, '检查 config/desktop.json 是否存在且可读。');
    return;
  }
  try {
    ctx.config = JSON.parse(configRaw);
  } catch (e) {
    failAndExit('E_PROJECT_INVALID', `config/desktop.json 不是合法 JSON：${e.message}`, '去掉注释与 BOM，确保导出管线写的是标准 JSON。');
    return;
  }

  const { errors, warnings } = validateConfig(ctx.config, { platform: ctx.platform, root: ctx.projectDir });
  for (const w of warnings) ctx.warnings.push(`${w.field || '(根)'}: ${w.message}`);
  if (errors.length) {
    const code = mapConfigCode(errors);
    failAndExit(
      code,
      `配置校验不通过（${errors.length} 个错误）：${errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`).join('；')}`,
      '先修 config/desktop.json（或运行 npm run validate 看完整清单）。',
      { details: { errors } },
    );
    return;
  }

  // ---- 2. 打包目标 ----
  const supported = PLATFORM_TARGETS[ctx.platform] || [];
  if (supported.length === 0) {
    failAndExit('E_TARGET_UNSUPPORTED', `当前构建平台（${ctx.platform}）不支持打包安装包`, '安装包必须在目标系统上原生构建（Tauri 不做交叉打包）。');
    return;
  }
  if (args.targets !== undefined) {
    const list = String(args.targets).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) {
      failAndExit('E_TARGET_EMPTY', '--targets 是空列表', `可取值：${supported.join(', ')}`);
      return;
    }
    ctx.targets = [...new Set(list)];
  } else {
    ctx.targets = [...new Set(pickTargets(ctx.config, ctx.platform))];
  }
  const unsupported = ctx.targets.filter((t) => !supported.includes(t));
  if (unsupported.length) {
    failAndExit(
      'E_TARGET_UNSUPPORTED',
      `目标 ${unsupported.join(', ')} 不能在 ${ctx.platform} 上构建；本机支持：${supported.join(', ')}`,
      '按构建机平台选择目标：Windows 用 msi/nsis，Linux 用 appimage/deb/rpm，Android 用 apk/aab（需 --platform android）。',
      { details: { requested: ctx.targets, supported } },
    );
    return;
  }

  // ---- 3. 签名材料 ----
  const updaterEnabled = ctx.config.update?.active === true || ctx.config.bundle?.createUpdaterArtifacts === true;
  if (updaterEnabled) {
    const key = process.env.TAURI_SIGNING_PRIVATE_KEY;
    if (!key) {
      failAndExit(
        'E_SIGNING_MISSING',
        '需要更新包签名，但没有 TAURI_SIGNING_PRIVATE_KEY',
        '在构建机环境变量里放私钥内容或私钥文件路径（配 TAURI_SIGNING_PRIVATE_KEY_PASSWORD）；私钥不要写进工程。',
      );
      return;
    }
    if (looksLikeKeyPath(key)) {
      const file = resolveKeyPath(key);
      if (!fs.existsSync(file)) {
        failAndExit(
          'E_SIGNING_KEY_NOT_FOUND',
          `TAURI_SIGNING_PRIVATE_KEY 指向的私钥文件不存在：${file}`,
          '把私钥放到构建机可读路径，或改为直接传私钥内容；相对路径按 --project 目录解析。',
          { details: { keyPath: file } },
        );
        return;
      }
      ctx.keyFile = file;
    }
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
      ctx.warnings.push('未设置 TAURI_SIGNING_PRIVATE_KEY_PASSWORD：若私钥带密码，构建会因无法交互输入而失败');
    }
  }

  // ---- 4. 站点证书（server 接入 + 本地生成 HTTPS）----
  const needsSiteCert = ctx.config.delivery?.mode === 'server'
    && ctx.config.protocol === 'https'
    && ctx.config.https?.mode === 'generated';
  if (needsSiteCert) {
    const crt = path.join(ctx.projectDir, 'certs/site.crt');
    const key = path.join(ctx.projectDir, 'certs/site.key');
    const missingCert = [crt, key].filter((p) => !fs.existsSync(p));
    if (missingCert.length) {
      failAndExit(
        'E_CERT_NOT_FOUND',
        `server + https 构建缺少证书文件：${missingCert.join('、')}`,
        '先执行 npm run gen:cert，或按 docs/https.md 把自有证书放到 certs/site.crt 与 certs/site.key。',
        { details: { expected: [crt, key] } },
      );
      return;
    }
  }

  // ---- 5. 工具链与 sidecar ----
  const rustc = runCapture('rustc', ['-vV']);
  if (!rustc.ok) {
    failAndExit('E_TOOLCHAIN_MISSING', 'rustc 不可用', '安装 Rust 工具链（rustup），并把 %USERPROFILE%\\.cargo\\bin 加进 PATH。');
    return;
  }
  const hostTriple = (rustc.out.match(/^host:\s*(\S+)$/m) || [])[1];
  if (!hostTriple) {
    failAndExit('E_TOOLCHAIN_MISSING', 'rustc -vV 里没有 host 行，无法确定目标三元组', '重装 Rust 工具链。');
    return;
  }
  const cargo = runCapture('cargo', ['--version']);
  if (!cargo.ok) {
    failAndExit('E_TOOLCHAIN_MISSING', 'cargo 不可用', '安装 Rust 工具链（rustup）。');
    return;
  }
  const cli = resolveTauriCli(ctx.projectDir);
  if (!cli) {
    failAndExit(
      'E_TAURI_CLI_MISSING',
      '找不到 Tauri CLI（工程 node_modules 与 PATH 都没有）',
      '在工程目录执行 npm ci（或把 @tauri-apps/cli 装到构建机 PATH）。',
    );
    return;
  }

  if (ctx.config.sidecar?.enabled === true) {
    const ext = hostTriple.includes('windows') ? '.exe' : '';
    const bin = path.join(ctx.projectDir, 'src-tauri/binaries', `${ctx.config.sidecar.name}-${hostTriple}${ext}`);
    if (!fs.existsSync(bin)) {
      failAndExit(
        'E_SIDECAR_BINARY',
        `sidecar.enabled=true 但二进制不存在：${bin}`,
        '导出管线先执行 build-sidecar.mjs（--from 或 --go）把二进制落到 src-tauri/binaries，再调用本入口。',
        { details: { expected: bin } },
      );
      return;
    }
    if (ctx.config.sidecar.versionCheck === true && ctx.config.version) {
      const v = runCapture(bin, ['--version'], 15000);
      const reported = v.ok ? v.out.trim().split(/\s+/).pop() : '';
      if (v.ok && reported && reported !== ctx.config.version) {
        failAndExit(
          'E_SIDECAR_VERSION_MISMATCH',
          `sidecar 版本 ${reported} 与应用版本 ${ctx.config.version} 不一致`,
          '用当前 desktop.json 的 version 重新构建 sidecar，避免交付「界面新、后端旧」的组合。',
          { details: { expected: ctx.config.version, reported } },
        );
        return;
      }
      if (!v.ok) {
        ctx.warnings.push(`sidecar 无法执行 --version（${v.out || '无输出'}）：运行时版本校验会失败`);
      }
    }
  }

  // ---- 6. 输出目录与图标 ----
  try {
    fs.mkdirSync(ctx.outDir, { recursive: true });
    const probe = path.join(ctx.outDir, `.lc-write-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch (e) {
    failAndExit('E_OUT_DIR_INVALID', `输出目录不可写：${ctx.outDir}（${e.message}）`, '换一个可写目录，或检查目录是否被其它进程占用。');
    return;
  }

  const tauriConf = buildTauriConf(ctx.config, { platform: ctx.platform });
  const iconMissing = tauriConf.bundle.icon
    .map((rel) => path.join(ctx.projectDir, 'src-tauri', rel))
    .filter((p) => !fs.existsSync(p));
  if (iconMissing.length) {
    failAndExit(
      'E_ICONS_MISSING',
      `图标文件缺失：${iconMissing.map((p) => path.relative(ctx.projectDir, p)).join('、')}`,
      '在工程目录执行 node scripts/gen-icons.mjs（或 npm run icons）生成图标后再打包。',
      { details: { missing: iconMissing } },
    );
    return;
  }

  // ---- 7. 缓存与排队 ----
  ctx.cacheDir = path.join(cacheRoot(), String(ctx.config.identifier).replace(/[^\w.-]+/g, '_'), cacheKey(ctx.projectDir, ctx.config.identifier));
  ctx.targetDir = path.join(ctx.cacheDir, 'target');
  ctx.lockPath = path.join(ctx.cacheDir, 'build.lock');
  try {
    fs.mkdirSync(ctx.cacheDir, { recursive: true });
    fs.mkdirSync(ctx.targetDir, { recursive: true });
  } catch (e) {
    failAndExit('E_CACHE_DIR_INVALID', `构建缓存目录不可创建：${ctx.cacheDir}（${e.message}）`, '设置 LC_BUILD_CACHE_DIR 指向可写目录。');
    return;
  }
  const lock = await acquireLock(ctx.lockPath, args.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  if (!lock) {
    failAndExit(
      'E_BUILD_LOCK_TIMEOUT',
      '等待同工程其它构建释放缓存锁超时',
      '同一工程的构建会排队；确认没有卡住的构建，或调大 --lock-timeout-ms。陈旧锁（进程已消失）会被自动接管。',
    );
    return;
  }

  // ---- 8. 渲染配置（直接写工程目录，不依赖 cwd）----
  ctx.stage = 'render';
  // Android 的 apk/aab 不是 bundle.targets 的合法取值，由 android build 单独产出。
  if (ctx.platform !== 'android') tauriConf.bundle.targets = ctx.targets;
  const outputs = [
    [path.join(ctx.projectDir, 'src-tauri/tauri.conf.json'), `${JSON.stringify(tauriConf, null, 2)}\n`],
    [path.join(ctx.projectDir, 'src-tauri/desktop.runtime.json'), `${JSON.stringify(buildRuntimeConfig(ctx.config), null, 2)}\n`],
    [path.join(ctx.projectDir, 'web/desktop-config.js'), buildFrontendBridge(ctx.config)],
  ];
  try {
    for (const [file, content] of outputs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
  } catch (e) {
    failAndExit('E_RENDER_FAILED', `渲染配置失败：${e.message}`, '检查工程目录的 src-tauri/ 与 web/ 是否可写。');
    return;
  }

  // ---- 9. 打包 ----
  ctx.stage = 'build';
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  log(`开始打包（${ctx.targets.join(', ')}），target 目录：${ctx.targetDir}`);
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: ctx.targetDir,
    // 避免 CLI 在非 TTY 下仍尝试交互确认。
    CI: 'true',
  };
  let buildResult;
  try {
    if (ctx.platform === 'android') {
      const genAndroid = path.join(ctx.projectDir, 'src-tauri/gen/android');
      if (!fs.existsSync(genAndroid)) {
        log('Android 工程不存在，先执行 tauri android init --ci');
        const init = await runTauri(cli, ['android', 'init', '--ci'], ctx.projectDir, env, timeoutMs);
        if (init.timedOut || init.code !== 0) {
          failAndExit(
            init.timedOut ? 'E_TIMEOUT' : 'E_BUILD_FAILED',
            init.timedOut
              ? `android init 超过 ${timeoutMs} ms 未完成`
              : `tauri android init 失败（退出码 ${init.code}）：${init.tail.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || ''}`,
            '检查 ANDROID_HOME、NDK 与 JDK；先跑 npm run preflight -- --platform android。',
            { details: { tail: init.tail.slice(-1200) } },
          );
          return;
        }
      }
      // 默认同时编 arm64 与 x86_64：Tauri 传多个 --target 时会出 universal APK，
      // 避免只出 x86_64 包、真机提示「指令集与设备 ABI 不匹配」。
      const abiList = args.androidTargets || (ctx.platform === 'android' ? 'aarch64,x86_64' : '');
      const abis = String(abiList).split(',').map((s) => s.trim()).filter(Boolean);
      const commandArgs = ['android', 'build'];
      if (ctx.targets.includes('apk')) commandArgs.push('--apk');
      if (ctx.targets.includes('aab')) commandArgs.push('--aab');
      if (abis.length) commandArgs.push('--target', ...abis);
      commandArgs.push('--ci');
      buildResult = await runTauri(cli, commandArgs, ctx.projectDir, env, timeoutMs);
    } else {
      buildResult = await runTauri(cli, ['build', '--bundles', ctx.targets.join(',')], ctx.projectDir, env, timeoutMs);
    }
  } catch (e) {
    failAndExit('E_TAURI_CLI_MISSING', `Tauri CLI 无法启动：${e.message}`, '检查 node_modules/@tauri-apps/cli 是否完整，或 PATH 里的 tauri 是否可执行。');
    return;
  }
  if (buildResult.timedOut) {
    failAndExit(
      'E_TIMEOUT',
      `打包超过 ${timeoutMs} ms 未完成，已终止进程树`,
      '调大 --timeout-ms，或先排查 cargo 编译是否卡在下载依赖。',
      { details: { timeoutMs, tail: buildResult.tail.slice(-1200) } },
    );
    return;
  }
  if (buildResult.code !== 0) {
    const tail = buildResult.tail.trim();
    const lastLine = tail.split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
    failAndExit(
      'E_BUILD_FAILED',
      `tauri build 失败（退出码 ${buildResult.code}${buildResult.signal ? `，信号 ${buildResult.signal}` : ''}）${lastLine ? `：${lastLine}` : ''}`,
      buildFailureHint(tail),
      { details: { exitCode: buildResult.code, signal: buildResult.signal, tail: tail.slice(-1200) } },
    );
    return;
  }

  // ---- 10. 收集产物 ----
  ctx.stage = 'collect';
  const bundleBase = path.join(ctx.targetDir, 'release', 'bundle');
  const androidOut = path.join(ctx.projectDir, 'src-tauri/gen/android/app/build/outputs');
  let artifacts;
  try {
    artifacts = ctx.platform === 'android'
      ? collectAndroidArtifacts(androidOut, ctx.targets, ctx.outDir)
      : collectArtifacts(bundleBase, ctx.targets, ctx.outDir);
  } catch (e) {
    failAndExit(e.code || 'E_ARTIFACT_MISSING', e.message, '构建日志里搜 bundle 目录；确认对应打包工具（WiX/NSIS）没有被跳过。', { details: e.extra });
    return;
  }
  const allSigned = artifacts.every((a) => a.updateSigned);
  if (updaterEnabled && !allSigned) ctx.warnings.push('更新签名已开启，但有产物没有找到 .sig 文件');

  finishOk({
    signing: {
      updater: updaterEnabled,
      mode: updaterEnabled ? 'minisign' : 'none',
      keySource: updaterEnabled ? (ctx.keyFile ? 'file' : 'env') : null,
      keyFile: ctx.keyFile,
      artifactsSigned: updaterEnabled ? allSigned : null,
    },
    artifacts,
    cache: {
      mode: 'queue-per-project',
      cacheDir: ctx.cacheDir,
      targetDir: ctx.targetDir,
      waitedMs: lock.waitedMs,
      sharedToolsCache: '打包工具（WiX/NSIS）缓存由 Tauri CLI 共享，只读复用',
    },
  });
}

const onSignal = (signal) => {
  if (ctx.finished) return;
  if (ctx.child?.pid) killTree(ctx.child.pid);
  failAndExit('E_INTERRUPTED', `收到 ${signal}，已终止构建并释放缓存锁`, '可重新调用；本次日志保留。');
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

main().catch((e) => {
  appendLog(String((e && e.stack) || e));
  failAndExit('E_UNEXPECTED', `构建入口内部错误：${e && e.message ? e.message : e}`, '这是入口脚本缺陷；把 logs.path 的日志和入参一起反馈。');
});
