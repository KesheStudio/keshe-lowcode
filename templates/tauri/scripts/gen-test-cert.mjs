#!/usr/bin/env node
// 生成自签测试证书（仅本地测试用）。需要本机有 openssl。
// 用法：node scripts/gen-test-cert.mjs [--out certs] [--host localhost] [--days 365] [--force]
// 产物：site.crt / site.key / cert-info.txt（只含指纹与有效期，不含私钥内容）。
// 私钥只留在构建机，绝不进导出包、日志与构建输出。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function findOpenssl() {
  const candidates = [
    process.env.OPENSSL_PATH,
    'openssl',
    'C:/msys64/usr/bin/openssl.exe',
    'C:/msys64/mingw64/bin/openssl.exe',
    'C:/Program Files/Git/usr/bin/openssl.exe',
    '/usr/bin/openssl',
    '/usr/local/bin/openssl',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const res = spawnSync(candidate, ['version'], { encoding: 'utf8' });
    if (!res.error && res.status === 0 && /OpenSSL|LibreSSL/.test(res.stdout || '')) {
      return { cmd: candidate, version: (res.stdout || '').trim() };
    }
  }
  return null;
}

function parseArgs(argv) {
  const out = { out: 'certs', host: 'localhost', days: 365, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--days') out.days = Number.parseInt(argv[++i], 10);
    else if (a === '--force') out.force = true;
  }
  return out;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`openssl 执行失败：${args.join(' ')}\n${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(root, args.out);
  const crt = path.join(outDir, 'site.crt');
  const key = path.join(outDir, 'site.key');

  if ((fs.existsSync(crt) || fs.existsSync(key)) && !args.force) {
    console.error(`已存在 ${path.relative(root, crt)} 或 ${path.relative(root, key)}；确认要覆盖请加 --force。`);
    process.exit(1);
  }

  const openssl = findOpenssl();
  if (!openssl) {
    console.error('没找到 openssl。Windows 可装 Git for Windows（自带 openssl）或 MSYS2，然后重试；');
    console.error('也可以在任意 Linux 机器上执行 scripts/gen-test-cert.sh，再把 site.crt 带回构建机。');
    process.exit(2);
  }
  console.log(`使用 ${openssl.cmd}（${openssl.version}）`);

  fs.mkdirSync(outDir, { recursive: true });
  const sanEntries = [`DNS:${args.host}`, 'DNS:localhost', 'IP:127.0.0.1', 'IP:::1'];
  const san = sanEntries.filter((entry, i) => sanEntries.indexOf(entry) === i).join(',');
  run(openssl.cmd, [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256',
    '-days', String(args.days), '-nodes',
    '-keyout', key, '-out', crt,
    '-subj', `/CN=${args.host}/O=Lowcode Test Only`,
    '-addext', `subjectAltName=${san}`,
    '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext', 'extendedKeyUsage=serverAuth',
  ]);

  try { fs.chmodSync(key, 0o600); } catch { /* Windows 上 chmod 基本无效，权限靠目录 ACL */ }

  const info = run(openssl.cmd, ['x509', '-in', crt, '-noout', '-subject', '-dates', '-fingerprint', '-sha256']);
  const note = [
    '自签测试证书 · 只能在本地测试使用',
    `生成时间：${new Date().toISOString()}`,
    `有效期：${args.days} 天`,
    `主机名：${args.host}（SAN: ${san}）`,
    '',
    info,
    '',
    '私钥 site.key 只留在构建机；不要提交、不要放进导出包、不要贴进日志。',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'cert-info.txt'), `${note}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'TEST-ONLY.txt'), '这是自签测试证书，系统默认不信任它。不要用于对外提供服务。\n', 'utf8');

  const label = (file) => {
    const rel = path.relative(root, file);
    return rel.startsWith('..') ? file : rel;
  };
  console.log(note);
  console.log(`\n已写入：${label(crt)}、${label(key)}、${label(path.join(outDir, 'cert-info.txt'))}`);
}

main();
