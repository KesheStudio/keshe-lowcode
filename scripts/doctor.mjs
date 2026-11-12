import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PLATFORM_ROOT,
  MARK,
  checkNodeVersion,
  dependenciesInstalled,
  isPortFree
} from './_shared.mjs';
import { loadPlatformConfig, ConfigError } from '../server/src/config.js';
import { writeFileAtomic } from '../src/storage/atomic.js';

const checks = [];

function record(name, ok, detail, hint) {
  checks.push({ name, ok, detail, hint });
}

async function main() {
  const node = checkNodeVersion(20);
  record('Node 版本', node.ok, `v${node.current}`, '安装 Node 20 LTS 或更高版本');

  let loaded = null;
  try {
    loaded = loadPlatformConfig(PLATFORM_ROOT);
    record('platform.config.json', true, '校验通过');
  } catch (error) {
    const detail = error instanceof ConfigError ? error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('；') : error.message;
    record('platform.config.json', false, detail, '按 CONTRACTS 3.5 修改');
  }

  record('依赖已安装', dependenciesInstalled(), dependenciesInstalled() ? 'node_modules 就绪' : '缺少 node_modules', '运行 npm install');
  const lock = await fs.stat(path.join(PLATFORM_ROOT, 'package-lock.json')).then(() => true).catch(() => false);
  record('锁文件', lock, lock ? 'package-lock.json 存在' : '缺少 package-lock.json', '运行 npm install 后提交锁文件');

  const jszip = await fs.stat(path.join(PLATFORM_ROOT, 'vendor', 'jszip.min.js')).then(() => true).catch(() => false);
  record('vendor/jszip.min.js', jszip, jszip ? '本地存在' : '缺失', '运行 npm run vendor:sync');

  record('无 CDN 引用', await noCdnReferences(), '扫描 index.html、assets/** 与 src/theme/**', '删除 CDN 回退，改为本地 vendor 文件');

  if (loaded) {
    const { config, paths } = loaded;
    const writable = await probeWritable(paths.dataDir);
    record('数据目录可写', writable.ok, writable.ok ? config.paths.dataDir : writable.message, '检查目录权限或换可写目录');

    record('产物无外链', await noExternalArtifactRefs(paths), '扫描 exports/**、data/sites/*/builds/** 与 vendor/**', '把外链脚本/样式/字体改为本地 vendor 副本');

    const atomic = await probeAtomic(paths.dataDir);
    record('原子写自检', atomic.ok, atomic.ok ? 'temp + rename 通过' : atomic.message, '确认磁盘未满、未被安全软件拦截');

    const free = await isPortFree(config.platform.host, config.platform.port);
    record(
      '端口可用',
      free,
      free ? `${config.platform.port} 可用` : `${config.platform.port} 被占用（start 会自动回退）`,
      '关闭占用程序，或改 platform.port'
    );

    const bootError = await fs
      .readFile(path.join(paths.logsDir, 'boot-error.json'), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (bootError) {
      record('上次启动错误', false, `${bootError.message || '见 logs/boot-error.json'}`, '修复后重新 npm start');
    }
  }

  const failed = checks.filter((item) => !item.ok);
  console.log('');
  console.log('低代码工作台 · 自检');
  console.log('');
  for (const item of checks) {
    const mark = item.ok ? MARK.ok : MARK.fail;
    console.log(`  ${mark} ${item.name}：${item.detail}`);
    if (!item.ok && item.hint) console.log(`      → ${item.hint}`);
  }
  console.log('');
  if (failed.length) {
    console.log(`  ${failed.length} 项未通过，先处理后再说。`);
    process.exit(1);
  }
  console.log('  全部通过。npm start 可启动编辑器。');
}

async function probeWritable(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-probe-${process.pid}`);
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.unlink(probe);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `不可写：${error.code || error.message}` };
  }
}

async function probeAtomic(dir) {
  try {
    const target = path.join(dir, '.doctor-atomic.json');
    await writeFileAtomic(target, JSON.stringify({ ok: true }));
    const text = await fs.readFile(target, 'utf8');
    await fs.unlink(target);
    return JSON.parse(text).ok ? { ok: true } : { ok: false, message: '读回内容不一致' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function collectScanFiles(dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await collectScanFiles(full, files);
    } else if (/\.(js|mjs|cjs|html|css)$/i.test(entry.name)) {
      files.push(full);
    }
  }
}

/* 产物离线检查：外链脚本、外链样式、外链字体（含 CSS url() 与 @import）。
   只认真正的引用语法，避免误伤 schema.org、XML 命名空间和许可证注释里的 URL。 */
const EXTERNAL_REF = [
  /<script[^>]+src\s*=\s*["'](?:https?:)?\/\//i,
  /<link[^>]+href\s*=\s*["'](?:https?:)?\/\//i,
  /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i,
  /url\(\s*["']?(?:https?:)?\/\//i
];

async function collectArtifactFiles(dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await collectArtifactFiles(full, files);
    } else if (/\.(html?|css|js|mjs|cjs|svg|json|xml|txt)$/i.test(entry.name)) {
      files.push(full);
    }
  }
}

async function noExternalArtifactRefs(paths) {
  const files = [];
  await collectArtifactFiles(path.join(PLATFORM_ROOT, 'vendor'), files);
  await collectArtifactFiles(paths.exportsDir, files);

  const sitesRoot = path.join(paths.dataDir, 'sites');
  const sites = await fs.readdir(sitesRoot, { withFileTypes: true }).catch(() => []);
  for (const site of sites) {
    if (site.isDirectory() && !site.name.startsWith('.')) {
      await collectArtifactFiles(path.join(sitesRoot, site.name, 'builds'), files);
    }
  }

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    const hit = EXTERNAL_REF.find((re) => re.test(text));
    if (hit) {
      console.error(`  · 外链命中：${path.relative(PLATFORM_ROOT, file)}`);
      return false;
    }
  }
  return true;
}

async function noCdnReferences() {
  const files = [
    path.join(PLATFORM_ROOT, 'index.html'),
    path.join(PLATFORM_ROOT, 'diagnostics.html')
  ];
  await collectScanFiles(path.join(PLATFORM_ROOT, 'assets'), files);
  await collectScanFiles(path.join(PLATFORM_ROOT, 'src', 'theme'), files);
  const pattern = /cdnjs|jsdelivr|unpkg\.com|cdn\.js|cdn\.css/i;
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    if (pattern.test(text)) return false;
  }
  return true;
}

main().catch((error) => {
  console.error(`${MARK.fail} 自检执行失败：${error.message}`);
  process.exit(1);
});
