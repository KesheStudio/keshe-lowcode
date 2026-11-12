#!/usr/bin/env node
// 把后端程序复制/构建到 src-tauri/binaries/<name>-<target triple>[.exe]，
// 这是 Tauri `bundle.externalBin` 要求的文件名格式，缺了会直接打包失败。
//
// 用法：
//   node scripts/build-sidecar.mjs --from <已有二进制>
//   node scripts/build-sidecar.mjs --go <Go 工程目录>
// 可选：--config <path>、--allow-version-mismatch（不推荐，仅排障用）
//
// 版本：构建完成后跑一次 `<二进制> --version`，与应用 version 比对；
// 不一致会退出码 1——宁可构建失败，也不要交付「前端新版、后端旧版」的组合。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { allowVersionMismatch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--go') out.go = argv[++i];
    else if (a === '--config') out.config = argv[++i];
    else if (a === '--allow-version-mismatch') out.allowVersionMismatch = true;
  }
  return out;
}

function run(cmd, args, cwd) {
  // 不用 shell：Windows 下路径带空格会被截断（和 preflight.mjs 踩过的坑一样）。
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error) return { ok: false, out: r.error.message };
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), status: r.status };
}

function targetTriple() {
  const r = run('rustc', ['-vV']);
  if (!r.ok) {
    console.error('拿不到目标三元组：rustc -vV 执行失败。先装 Rust 工具链。');
    process.exit(1);
  }
  const m = r.out.match(/^host:\s*(\S+)$/m);
  if (!m) {
    console.error('rustc -vV 输出里没有 host: 行，无法确定目标平台。');
    process.exit(1);
  }
  return m[1];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configFile = path.resolve(root, args.config || 'config/desktop.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  const sidecar = config.sidecar;
  if (!sidecar || typeof sidecar.name !== 'string' || !sidecar.name) {
    console.error('config/desktop.json 里没有 sidecar.name，无法确定目标文件名。');
    process.exit(1);
  }

  const triple = targetTriple();
  const ext = triple.includes('windows') ? '.exe' : '';
  const destDir = path.join(root, 'src-tauri/binaries');
  const dest = path.join(destDir, `${sidecar.name}-${triple}${ext}`);

  let built = null;
  let temp = null;
  if (args.go) {
    const srcDir = path.resolve(root, args.go);
    if (!fs.existsSync(path.join(srcDir, 'go.mod'))) {
      console.error(`--go 目录里没有 go.mod：${srcDir}`);
      process.exit(1);
    }
    temp = path.join(os.tmpdir(), `lc-sidecar-build-${process.pid}${ext}`);
    const r = run('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.version=${config.version}`, '-o', temp, '.'], srcDir);
    if (!r.ok) {
      console.error(`go build 失败：\n${r.out}`);
      process.exit(1);
    }
    built = temp;
  } else if (args.from) {
    const src = path.resolve(root, args.from);
    if (!fs.existsSync(src)) {
      console.error(`--from 指向的文件不存在：${src}`);
      process.exit(1);
    }
    built = src;
  } else {
    console.error('需要 --from <二进制> 或 --go <目录>。');
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(built, dest);
  if (temp) fs.rmSync(temp, { force: true });
  if (process.platform !== 'win32') fs.chmodSync(dest, 0.755);

  // 版本一致性：构建期先拦一道，避免装完才发现前端后端版本对不上。
  const v = run(dest, ['--version']);
  const reported = v.ok ? v.out.trim().split(/\s+/).pop() : '';
  const size = fs.statSync(dest).size;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');

  console.log(`目标三元组：${triple}`);
  console.log(`已写入：${path.relative(root, dest)}（${(size / 1024).toFixed(1)} KiB，sha256 ${sha.slice(0, 16)}…）`);
  if (!v.ok) {
    console.warn(`[警告] 无法通过 --version 读取后端版本（${reported || v.out}）；运行时版本校验会失败，确认后端实现了该参数。`);
  } else if (reported !== config.version) {
    if (args.allowVersionMismatch) {
      console.warn(`[警告] 后端版本 ${reported} 与应用版本 ${config.version} 不一致（已按 --allow-version-mismatch 放行）。`);
    } else {
      console.error(`后端版本 ${reported} 与应用版本 ${config.version} 不一致：前端载体和应用外壳会一起更新，后端没跟上就会出现「界面新、接口旧」。`);
      console.error('重新用当前版本构建后端，或先把 desktop.json 的 version 与后端版本对齐；确需排障才加 --allow-version-mismatch。');
      process.exit(1);
    }
  }
  if (sidecar.enabled !== true) {
    console.warn('[提示] 当前 desktop.json 里 sidecar.enabled=false：文件已就位，但不会被打进安装包。');
  }
}

main();
