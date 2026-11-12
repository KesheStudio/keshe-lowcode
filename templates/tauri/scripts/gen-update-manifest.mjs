#!/usr/bin/env node
// 生成 Tauri v2 更新清单（latest.json）。不联网、不下载、不签名：
// 签名由 `tauri build`（createUpdaterArtifacts: true）产出 .sig，本脚本只读取并写进清单。
//
// 用法：
//   node scripts/gen-update-manifest.mjs --version 0.2.0 --base-url https://updates.example.com/desktop \
//     --artifact dist/App_0.2.0_x64_en-US.msi --target windows-x86_64 --artifact dist/App_0.2.0.apk --target android
// 可选：--notes "修复说明"、--out latest.json、--allow-http（仅内网调试）、
//       --current 0.1.0（低于当前版本时报错，防误发降级清单）、--verify-only（只校验不写盘）

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const TARGETS = new Set([
  'linux-x86_64', 'linux-aarch64',
  'windows-x86_64', 'windows-x86_64-msi', 'windows-aarch64',
  'android',
]);

function parseSemver(version) {
  const match = version.match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

// semver 优先级比较：正式版 > 同号预发布版；预发布按标识逐段比，数字段按数值，其余按字典序。
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`不是合法 semver：${!pa ? a : b}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i += 1) {
    if (pa.pre[i] === undefined) return -1;
    if (pb.pre[i] === undefined) return 1;
    const na = /^\d+$/.test(pa.pre[i]);
    const nb = /^\d+$/.test(pb.pre[i]);
    if (na && nb) {
      if (Number(pa.pre[i]) !== Number(pb.pre[i])) return Number(pa.pre[i]) > Number(pb.pre[i]) ? 1 : -1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (pa.pre[i] !== pb.pre[i]) {
      return pa.pre[i] > pb.pre[i] ? 1 : -1;
    }
  }
  return 0;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseArgs(argv) {
  const out = { artifacts: [], out: 'latest.json', allowHttp: false, verifyOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '--artifact') out.artifacts.push({ file: argv[++i], target: null });
    else if (a === '--target') {
      if (!out.artifacts.length) throw new Error('--target 必须跟在 --artifact 之后');
      out.artifacts[out.artifacts.length - 1].target = argv[++i];
    } else if (a === '--notes') out.notes = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--current') out.current = argv[++i];
    else if (a === '--allow-http') out.allowHttp = true;
    else if (a === '--verify-only') out.verifyOnly = true;
  }
  return out;
}

function fail(message) {
  console.error(`[错误] ${message}`);
  process.exit(1);
}

function buildManifest(args) {
  if (!args.version) fail('缺少 --version');
  if (!parseSemver(args.version)) fail(`--version 不是合法 semver：${args.version}`);
  if (!args.baseUrl) fail('缺少 --base-url（更新包所在的公开目录）');
  let base;
  try { base = new URL(args.baseUrl); } catch { fail(`--base-url 不是合法 URL：${args.baseUrl}`); }
  if (base.protocol !== 'https:' && !args.allowHttp) {
    fail('更新走明文 http 会被插件拒绝（或需要 dangerousInsecureTransportProtocol）；确认是内网调试请加 --allow-http。');
  }
  if (args.artifacts.length === 0) fail('至少要给一个 --artifact');

  if (args.current) {
    if (!parseSemver(args.current)) fail(`--current 不是合法 semver：${args.current}`);
    if (compareSemver(args.version, args.current) <= 0) {
      fail(`新版本 ${args.version} 不高于当前版本 ${args.current}：Tauri 只在清单版本更高时才更新，写进清单等于空转。改版本号，或确认要发预发布再调整。`);
    }
  }

  const platforms = {};
  const entries = [];
  for (const item of args.artifacts) {
    if (!item.target) fail(`--artifact ${item.file} 后面缺 --target（例如 windows-x86_64）`);
    if (!TARGETS.has(item.target)) fail(`不认识的 target：${item.target}`);
    if (platforms[item.target]) fail(`target ${item.target} 重复，一个平台只能对应一个产物`);
    const file = path.resolve(item.file);
    if (!fs.existsSync(file)) fail(`产物不存在：${item.file}`);
    const sigFile = `${file}.sig`;
    if (!fs.existsSync(sigFile)) {
      fail(`找不到 ${path.basename(sigFile)}：更新包必须由 createUpdaterArtifacts: true 构建产出签名，否则客户端会因验签失败拒绝安装。`);
    }
    const signature = fs.readFileSync(sigFile, 'utf8').trim();
    if (!signature) fail(`${sigFile} 是空的，签名没写进去。`);
    const url = new URL(path.basename(file), `${base.href.replace(/\/?$/, '/')}`).href;
    // 严格按 Tauri 的清单结构写：每个平台只有 url + signature。
    // 多塞字段虽然能被忽略，但一旦上游收紧解析就会整份清单失效，不值得。
    platforms[item.target] = { signature, url };
    entries.push({ target: item.target, size: fs.statSync(file).size, sha256: sha256(file) });
  }

  return {
    manifest: {
      version: args.version,
      notes: args.notes || '',
      pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      platforms,
    },
    entries,
  };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArgs(process.argv.slice(2));
  const { manifest, entries } = buildManifest(args);
  const outFile = path.resolve(root, args.out);

  if (args.verifyOnly) {
    console.log(`校验通过：${Object.keys(manifest.platforms).length} 个平台条目，版本 ${manifest.version}`);
    return;
  }
  fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const rel = path.relative(root, outFile);
  console.log(`已写入 ${rel.startsWith('..') ? outFile : rel}：版本 ${manifest.version}，平台 ${Object.keys(manifest.platforms).join(', ')}`);
  for (const entry of entries) {
    console.log(`  ${entry.target}：${(entry.size / 1048).toFixed(1)} KiB，sha256 ${entry.sha256.slice(0, 12)}…，签名已随行`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
