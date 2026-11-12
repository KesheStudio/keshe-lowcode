#!/usr/bin/env node
/* 命令行导出：node scripts/export.mjs <siteId> [--target=web-static] [--no-minify] [--minify-html] [--version=v1.0.0]
 *
 * 与服务端接口、浏览器导出共用 shared/export-*.js 的同一套逻辑。
 * 构建产物写入 <站点>/builds/<buildId>/，包含 artifact.zip、build.json、log.txt。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePlatformRoot, loadPlatformConfig } from '../server/src/config.js';
import { exportSite } from '../server/src/export/pipeline.js';

const platformRoot = resolvePlatformRoot(import.meta.url);
const argv = process.argv.slice(2);

let siteId = '';
let target = 'web-static';
let version = '';
let minify = true;
let minifyHtml = false;
for (let i = 0; i < argv.length; i += 1) {
  const item = argv[i];
  if (item === '--no-minify') { minify = false; continue; }
  if (item === '--minify-html') { minifyHtml = true; continue; }
  if (item === '--target') { target = argv[i + 1] || target; i += 1; continue; }
  if (item.startsWith('--target=')) { target = item.slice('--target='.length); continue; }
  if (item === '--version') { version = argv[i + 1] || version; i += 1; continue; }
  if (item.startsWith('--version=')) { version = item.slice('--version='.length); continue; }
  if (!item.startsWith('--') && !siteId) siteId = item;
}

if (!siteId) {
  console.error('用法：node scripts/export.mjs <siteId> [--target=web-static] [--no-minify] [--minify-html] [--version=v1.0.0]');
  process.exit(2);
}

const { config, paths } = loadPlatformConfig(platformRoot);
const pkg = JSON.parse(await fs.readFile(path.join(platformRoot, 'package.json'), 'utf8').catch(() => '{"version":"0.1.0"}'));

const result = await exportSite({
  platformRoot,
  paths,
  siteId,
  target,
  minify,
  minifyHtml,
  version,
  platform: { name: config.platform.name, version: pkg.version }
});

if (!result.ok) {
  console.error('导出未通过检查，产物没有生成：');
  for (const failure of result.failures || []) {
    console.error('  - ' + failure.id + '：' + failure.message);
  }
  console.error('构建记录：builds/' + result.buildId + '/build.json');
  process.exit(1);
}

const record = result.record;
console.log('');
console.log('导出完成');
console.log('  构建 ID：' + result.buildId);
console.log('  目标：' + record.target);
for (const line of (record.sizing && record.sizing.lines) || []) {
  console.log('  体积：' + line);
}
console.log('  产物：builds/' + result.buildId + '/artifact.zip');
for (const warning of result.warnings) {
  console.log('  警告 ' + warning.code + '：' + warning.message);
}
