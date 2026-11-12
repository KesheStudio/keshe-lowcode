#!/usr/bin/env node
// 密钥泄漏扫描：按文件名 + 内容查私钥、keystore、以及密码字段。
// 用法：node scripts/scan-secrets.mjs --dir <导出包目录> [--json] [--allow <相对路径前缀>]
// 退出码：0 干净，1 有命中（命中项只报路径/行号/规则，绝不打印内容）。
//
// 设计原则：扫描工具本身不能变成泄漏点，所以所有输出都只到「文件名 + 位置 + 规则」为止。

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', '.svn', '__pycache__']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif', '.woff', '.woff2', '.ttf', '.otf', '.exe', '.dll', '.msi', '.zip', '.gz', '.pdf', '.jks', '.p12', '.pfx', '.keystore']);
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

const FILENAME_RULES = [
  { id: 'private-key-file', re: /\.(pem|key)$/i, why: '私钥/证书文件名后缀，需人工确认是私钥还是公钥' },
  { id: 'pkcs12', re: /\.(p12|pfx)$/i, why: 'PKCS#12 里含私钥' },
  { id: 'java-keystore', re: /\.(jks|keystore)$/i, why: 'Android/JDK keystore，含签名私钥' },
  { id: 'keystore-properties', re: /^keystore\.properties$/i, why: 'Android 签名属性文件，含密码' },
  { id: 'ssh-private-key', re: /^id_(rsa|dsa|ecdsa|ed25519)$/i, why: 'SSH 私钥' },
  { id: 'gpg-private-key', re: /^(secring\.gpg|private\.asc)$/i, why: 'GPG 私钥' },
];

// 私钥标记拆开拼：否则本文件里的规则定义会被自己的正则命中（扫描器不该把自己报成泄漏）。
const PEM_BEGIN = `${'-'.repeat(5)}BEGIN `;

const CONTENT_RULES = [
  { id: 'pem-private-key', re: new RegExp(`${PEM_BEGIN}(?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----`), why: 'PEM 私钥块' },
  { id: 'pkcs12-blob', re: new RegExp(`${PEM_BEGIN}PKCS12-----`), why: 'PEM 包装的 PKCS#12' },
  { id: 'android-keystore-password', re: /^\s*(storePassword|keyPassword|password)\s*=\s*(\S+)\s*$/i, fileHint: /(keystore\.properties|\.properties)$/i, why: '签名属性文件里的密码', checkValue: true },
  { id: 'tauri-signing-key-env', re: /TAURI_SIGNING_PRIVATE_KEY\s*[=:]\s*[A-Za-z0-9+/=]{40,}/, why: '环境变量 dump 里的更新签名私钥' },
  { id: 'signtool-password-arg', re: /\bsigntool\b[^\n]*\s\/p\s+\S+/, why: '把证书密码写进命令行的痕迹（会留在日志/历史里）', checkValue: true },
];

function isPlaceholder(value) {
  const v = value.trim();
  if (!v) return true;
  if (/^(CHANGE_ME|changeme|placeholder|your[-_]?password|YOUR_PASSWORD|<.*>|\$\{.*\}|replaced.*)$/i.test(v)) return true;
  if (/^(x{4,}|\*{4,}|\.{3,})$/.test(v)) return true;
  if (v.length < 6) return true;
  return false;
}

function parseArgs(argv) {
  const out = { dir: null, json: false, allow: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--allow') out.allow.push(argv[++i].replace(/\\/g, '/'));
  }
  return out;
}

function walk(root, dir, findings, allow, options = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (options.allow && allow.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, abs, findings, allow, options);
      continue;
    }
    if (!entry.isFile()) continue;

    for (const rule of FILENAME_RULES) {
      if (rule.re.test(entry.name)) {
        findings.push({ rule: rule.id, path: rel, line: null, why: rule.why });
      }
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (BINARY_EXT.has(ext)) continue;
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.size > MAX_CONTENT_BYTES) continue;

    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;

    const lines = text.split(/\r?\n/);
    for (const rule of CONTENT_RULES) {
      if (rule.fileHint && !rule.fileHint.test(entry.name)) continue;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!rule.re.test(line)) continue;
        if (rule.checkValue) {
          const match = line.match(rule.re);
          const value = match && match[match.length - 1];
          if (value && isPlaceholder(value)) continue;
        }
        findings.push({ rule: rule.id, path: rel, line: i + 1, why: rule.why });
        break;
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error('用法：node scripts/scan-secrets.mjs --dir <目录> [--json] [--allow <相对路径前缀>]');
    process.exit(2);
  }
  const root = path.resolve(args.dir);
  if (!fs.existsSync(root)) {
    console.error(`目录不存在：${root}`);
    process.exit(2);
  }

  const findings = [];
  walk(root, root, findings, args.allow, { allow: args.allow });

  if (args.json) {
    console.log(JSON.stringify({ dir: root, clean: findings.length === 0, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(`扫描通过：${root}（未发现私钥、keystore 或密码字段）`);
  } else {
    for (const f of findings) {
      console.log(`[命中] ${f.rule}  ${f.path}${f.line ? `:${f.line}` : ''}  — ${f.why}`);
    }
    console.log(`发现 ${findings.length} 处可疑内容。按 POLICY.md 处理，不要把这些文件打进导出包。`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

main();
