#!/usr/bin/env node
// 把站点产物放进桌面工程，并写入前端桥接文件 desktop-config.js。
// 用法：
//   node scripts/prepare-frontend.mjs --from <站点产物目录> --web web [--clean]
//   node scripts/prepare-frontend.mjs --web web            # 只重写 desktop-config.js
// 说明：--from 是合并复制，不删目标里的既有文件；要彻底替换加 --clean（会先删空目标目录）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { buildFrontendBridge } from './render-config.mjs';

function parseArgs(argv) {
  const out = { web: 'web', clean: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--web') out.web = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--clean') out.clean = true;
    else if (a === '--config') out.config = argv[++i];
  }
  return out;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(path.resolve(root, args.config || 'config/desktop.json'), 'utf8').replace(/^\uFEFF/, ''));
  const { errors } = validateConfig(config, { platform: process.platform, root, skipFileChecks: true });
  if (errors.length) {
    for (const e of errors) console.error(`[错误] ${e.field} ${e.message}`);
    process.exit(1);
  }

  const webDir = path.resolve(root, args.web);
  if (args.clean && fs.existsSync(webDir)) {
    if (path.basename(webDir).toLowerCase() === 'web' || webDir.startsWith(root)) {
      fs.rmSync(webDir, { recursive: true, force: true });
    } else {
      console.error('拒绝清空：目标看起来不是工程内的 web 目录。');
      process.exit(1);
    }
  }
  fs.mkdirSync(webDir, { recursive: true });

  if (args.from) {
    const from = path.resolve(process.cwd(), args.from);
    if (!fs.existsSync(path.join(from, 'index.html')) && !fs.existsSync(from)) {
      console.error(`来源目录不存在：${from}`);
      process.exit(1);
    }
    fs.cpSync(from, webDir, { recursive: true, force: true });
    console.log(`已复制前端产物：${from} → ${webDir}`);
  }

  fs.writeFileSync(path.join(webDir, 'desktop-config.js'), buildFrontendBridge(config), 'utf8');
  console.log(`已写入 ${path.relative(root, path.join(webDir, 'desktop-config.js'))}（前端通过 window.__LC_DESKTOP__ 读取后端地址）`);
}

main();
