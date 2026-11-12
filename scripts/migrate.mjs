import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { PLATFORM_ROOT, MARK, loadConfigOrExplain, explainFailure } from './_shared.mjs';
import { SITE_DIRS, SITE_GITIGNORE, slugify } from '../server/src/sites.js';
import { sanitizeSiteId } from '../src/storage/path-safety.js';
import { copyDir, pathExists, writeFileAtomic } from '../src/storage/atomic.js';
import { pruneBackups } from '../src/storage/backups.js';

/**
 * 站点搬家：migrate.cmd <站点目录> / npm run migrate -- --from <站点目录>
 * 只导入同版本的站点目录（site.json + project.json + 各内容目录），
 * 用于换机器或换数据目录时搬站点。不解析任何旧格式。
 * 先预览 → 确认 → 备份 → 事务写 → 条数/关键字段校验 → 摘要。
 */
/* data/files 是用户上传内容，必须随备份一起保留，否则 --force 覆盖后无法找回。 */
const SOURCE_EXCLUDE = ['builds', 'versions', 'backups', 'certs', '.lowcode'];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.from) {
    explainFailure('缺少站点目录路径', '', [
      'migrate.cmd <站点目录>',
      'npm run migrate -- --from <站点目录>',
      '加 --dry-run 只预览不写入'
    ]);
    process.exit(1);
  }

  const { config, paths } = loadConfigOrExplain();

  const sourceAbs = path.resolve(options.from);
  const sources = await detectSources(sourceAbs);
  if (!sources.length) {
    explainFailure('没有识别到可导入的站点目录', sourceAbs, [
      '站点目录需要包含 site.json 与 project.json',
      '确认路径指向站点根目录，而不是它的上一级或页面目录'
    ]);
    process.exit(1);
  }

  await printPreview(sources, paths);

  if (options.dryRun) {
    console.log(`${MARK.info} --dry-run：未写入任何文件。`);
    return;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      explainFailure('当前不是交互终端', '', ['确认后加 --yes 执行', '或先加 --dry-run 预览']);
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('确认导入以上站点？输入 y 继续：')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y') {
      console.log('已取消，未写入任何文件。');
      return;
    }
  }

  let okCount = 0;
  let failCount = 0;
  for (const source of sources) {
    try {
      const result = await importOne(source, paths, options);
      if (result.status === 'skipped') {
        console.log(`${MARK.ok} 已导入，跳过：${result.name}（${result.siteId}）`);
        okCount += 1;
      } else if (result.status === 'conflict') {
        console.log(`${MARK.fail} 站点已存在且内容不同：${result.name}（${result.siteId}）`);
        console.log(`  → 加 --force 备份后覆盖；或换一个来源路径`);
        failCount += 1;
      } else {
        console.log(`${MARK.ok} ${result.name} → ${result.relativePath}`);
        console.log(
          `  页面 ${result.counts.pages} · 文章 ${result.counts.articles} · 组件 ${result.counts.components} · 主题 ${result.counts.themes} · 资源 ${result.counts.assets} · 集合 ${result.counts.collections} · 上传 ${result.counts.uploads}`
        );
        console.log(`  校验：通过（条数与关键字段一致）`);
        for (const warning of result.warnings || []) {
          console.log(`  ${MARK.warn} ${warning.field}：${warning.message}`);
        }
        okCount += 1;
      }
    } catch (error) {
      failCount += 1;
      console.error(`${MARK.fail} 导入失败：${source.name}`);
      console.error(`  位置：${source.label}`);
      console.error(`  原因：${error.message}`);
      if (error.detail) console.error(`  明细：${JSON.stringify(error.detail)}`);
      if (error.rollback) {
        if (error.rollback.ok) {
          if (error.rollback.mode === 'none') {
            console.error('  回滚：尚未写入目标目录，站点保持迁移前状态');
          } else {
            const where = error.rollback.mode === 'backup'
              ? `已从备份 ${error.rollback.backup} 恢复`
              : error.rollback.mode === 'removed' ? '已删除本次新建的半截站点' : '已清空本次写入内容';
            console.error(`  回滚：${where}，站点已回到迁移前状态`);
          }
        } else {
          console.error(`  回滚：失败（${error.rollback.reason}），请用目标站点 backups/ 下的备份手动恢复`);
        }
      }
    }
  }

  console.log('');
  console.log(`完成：成功 ${okCount} 个，失败 ${failCount} 个。`);
  console.log(`数据落盘位置：${config.paths.dataDir}/sites/`);
  if (failCount) process.exit(1);
}

function parseArgs(argv) {
  const options = { from: '', dryRun: false, force: false, yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from' || arg === '-f') {
      options.from = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (!arg.startsWith('-') && !options.from) {
      options.from = arg;
    }
  }
  return options;
}

/* ----------------------------- 来源识别 ----------------------------- */

async function detectSources(target) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return [];

  if (stat.isDirectory()) {
    const direct = await readSiteDir(target);
    if (direct) return [direct];
  } else {
    return [];
  }

  const results = [];
  const children = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    if (!child.isDirectory() || child.name.startsWith('.')) continue;
    const childPath = path.join(target, child.name);
    const site = await readSiteDir(childPath);
    if (site) {
      results.push(site);
      continue;
    }
    const grandchildren = await fs.readdir(childPath, { withFileTypes: true }).catch(() => []);
    for (const grand of grandchildren) {
      if (!grand.isDirectory() || grand.name.startsWith('.')) continue;
      const nested = await readSiteDir(path.join(childPath, grand.name));
      if (nested) results.push(nested);
    }
  }
  return results;
}

async function readSiteDir(dir) {
  const siteFile = path.join(dir, 'site.json');
  const projectFile = path.join(dir, 'project.json');
  if (!(await pathExists(siteFile)) || !(await pathExists(projectFile))) return null;
  let site;
  let project;
  try {
    site = JSON.parse(await fs.readFile(siteFile, 'utf8'));
    project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  } catch (error) {
    throw new Error(`${dir} 的 site.json / project.json 无法解析：${error.message}`);
  }
  const counts = await countSiteDir(dir);
  const fingerprint = await fingerprintSiteDir(dir, site, project, counts);
  return {
    label: dir,
    dir,
    sourceSiteId: String(site.siteId || path.basename(dir)),
    name: String(site.name || project.site?.name || path.basename(dir)),
    site,
    project,
    counts,
    fingerprint
  };
}

async function countSiteDir(dir) {
  return {
    pages: await countJsonFiles(path.join(dir, 'pages')),
    articles: await countJsonFiles(path.join(dir, 'articles')),
    components: await countJsonFiles(path.join(dir, 'components')),
    themes: await countJsonFiles(path.join(dir, 'themes')),
    assets: await countFilesRecursive(path.join(dir, 'assets')),
    collections: await countJsonFiles(path.join(dir, 'data', 'collections')),
    uploads: await countFilesRecursive(path.join(dir, 'data', 'files'))
  };
}

async function countJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
}

async function countFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countFilesRecursive(path.join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}

async function fingerprintSiteDir(dir, site, project, counts) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(site));
  hash.update(JSON.stringify(project));
  for (const sub of ['pages', 'articles', 'components', 'themes', 'templates']) {
    const subDir = path.join(dir, sub);
    const files = (await fs.readdir(subDir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    for (const name of files) {
      hash.update(sub + '/' + name);
      hash.update(await fs.readFile(path.join(subDir, name), 'utf8').catch(() => ''));
    }
  }
  /* 只把原有计数进入指纹，新增的集合/上传计数不改变既有站点指纹。 */
  hash.update(JSON.stringify({
    pages: counts.pages,
    articles: counts.articles,
    components: counts.components,
    themes: counts.themes,
    assets: counts.assets
  }));
  return hash.digest('hex');
}

/* ----------------------------- 预览 ----------------------------- */

async function printPreview(sources, paths) {
  console.log('');
  console.log(`发现 ${sources.length} 个可导入的站点：`);
  sources.forEach((source, index) => {
    const counts = source.counts;
    console.log(
      `  ${index + 1}. 「${source.name}」同版本站点目录 · 页面 ${counts.pages} · 文章 ${counts.articles} · 组件 ${counts.components} · 主题 ${counts.themes} · 资源 ${counts.assets} · 集合 ${counts.collections} · 上传 ${counts.uploads}`
    );
    console.log(`     来源：${source.label}`);
  });
  console.log(`  目标：${relativeToRoot(paths.dataDir)}/sites/（相对平台根）`);
  console.log('');
}

function relativeToRoot(target) {
  return path.relative(PLATFORM_ROOT, target).split(path.sep).join('/') || '.';
}

/* ----------------------------- 执行 ----------------------------- */

async function importOne(source, paths, options) {
  const sourceDir = path.resolve(source.dir);
  /* 覆盖前先确认来源完整，避免删掉目标站点后才发现来源缺文件。 */
  if (!source.project) throw new Error('来源站点缺少可解析的 project.json');
  if (!(await pathExists(path.join(sourceDir, 'pages'))) && !(await pathExists(path.join(sourceDir, 'articles')))) {
    throw new Error('来源站点缺少 pages/ 或 articles/ 目录');
  }
  let targetId;
  try {
    targetId = sanitizeSiteId(source.sourceSiteId);
  } catch {
    targetId = sanitizeSiteId(`${slugify(source.name)}-${source.fingerprint.slice(0, 8)}`);
  }
  const targetDir = path.join(paths.dataDir, 'sites', targetId);

  if (path.resolve(targetDir) === sourceDir) {
    return { status: 'skipped', name: source.name, siteId: targetId };
  }

  const targetExistedBefore = await pathExists(targetDir);
  let backupDir = '';
  let mutationStarted = false;
  try {
    const existing = await readExistingSite(targetDir);
    if (existing) {
      if (existing.migration?.fingerprint === source.fingerprint) {
        return { status: 'skipped', name: source.name, siteId: targetId };
      }
      if (!options.force) return { status: 'conflict', name: source.name, siteId: targetId };
      backupDir = await backupSite(targetDir, 'pre-import');
      /* 备份成功后才开始破坏目标目录；备份失败时目标仍是原样，不需要回滚。 */
      mutationStarted = true;
      for (const sub of ['pages', 'articles', 'components', 'themes', 'templates', 'data', 'assets']) {
        await fs.rm(path.join(targetDir, sub), { recursive: true, force: true });
      }
    }

    mutationStarted = true;
    for (const dir of SITE_DIRS) await fs.mkdir(path.join(targetDir, dir), { recursive: true });

    for (const sub of ['pages', 'articles', 'components', 'themes', 'templates', 'data', 'assets']) {
      if (await pathExists(path.join(sourceDir, sub))) {
        await copyDir(path.join(sourceDir, sub), path.join(targetDir, sub));
      }
    }

    const now = new Date().toISOString();
    const siteMeta = {
      ...source.site,
      schemaVersion: 1,
      siteId: targetId,
      layoutVersion: 2,
      storage: 'files',
      status: 'ready',
      updatedAt: now,
      migration: {
        sourceType: 'site-import',
        sourceLabel: path.basename(source.label),
        fingerprint: source.fingerprint,
        counts: source.counts,
        migratedAt: now
      }
    };
    await writeFileAtomic(path.join(targetDir, 'site.json'), JSON.stringify(siteMeta, null, 2));
    await writeFileAtomic(path.join(targetDir, 'project.json'), JSON.stringify(source.project, null, 2));
    if (!(await pathExists(path.join(targetDir, '.gitignore')))) {
      await writeFileAtomic(path.join(targetDir, '.gitignore'), SITE_GITIGNORE);
    }

    await verifySite(targetDir, source.counts);
  } catch (error) {
    /* 任何一步写入失败都退回迁移前状态，不留下半截站点或半截数据。 */
    const rollback = mutationStarted
      ? await rollbackImport(targetDir, backupDir, targetExistedBefore)
      : { ok: true, mode: 'none' };
    error.rollback = rollback;
    throw error;
  }

  return {
    status: 'created',
    name: source.name,
    siteId: targetId,
    relativePath: `${path.relative(PLATFORM_ROOT, targetDir).split(path.sep).join('/')}/`,
    counts: source.counts,
    warnings: [{ field: 'certs', message: '证书目录不随站点导入（密钥不进入搬家流程）' }]
  };
}

/**
 * 迁移失败回滚：
 * - 覆盖迁移：用 pre-import 备份整体写回（备份目录本身保留在 backups/ 下）。
 * - 新建站点：直接删除本次新建的站点目录。
 * - 迁移前已有空目录：清空本次写入内容，恢复为空目录。
 */
const IMPORT_MANAGED = [
  'pages', 'articles', 'components', 'themes', 'templates', 'data', 'assets',
  'site.json', 'project.json', '.gitignore'
];

async function rollbackImport(targetDir, backupDir, existedBefore) {
  try {
    if (!existedBefore) {
      await fs.rm(targetDir, { recursive: true, force: true });
      return { ok: true, mode: 'removed' };
    }
    /* 只清迁移会写的部分；builds/versions/trash/certs/.lowcode 等保持原样。 */
    await clearManagedSiteContent(targetDir);
    if (backupDir) {
      await copyDir(backupDir, targetDir, { exclude: ['manifest.json'] });
      return {
        ok: true,
        mode: 'backup',
        backup: path.relative(targetDir, backupDir).split(path.sep).join('/')
      };
    }
    return { ok: true, mode: 'cleared' };
  } catch (error) {
    return { ok: false, mode: backupDir ? 'backup' : 'remove', reason: error.message };
  }
}

async function clearManagedSiteContent(targetDir) {
  for (const name of IMPORT_MANAGED) {
    await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
  }
}

async function readExistingSite(siteDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(siteDir, 'site.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function backupSite(siteDir, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(siteDir, 'backups', `${stamp}-${reason}`);
  await copyDir(siteDir, backupDir, { exclude: SOURCE_EXCLUDE });
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const buffer = await fs.readFile(abs);
      files.push({
        path: path.relative(backupDir, abs).split(path.sep).join('/'),
        hash: crypto.createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.length
      });
    }
  }
  await walk(backupDir);
  await writeFileAtomic(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      siteId: path.basename(siteDir),
      createdAt: new Date().toISOString(),
      reason,
      kind: 'site',
      files
    }, null, 2)
  );
  await pruneBackups(siteDir);
  return backupDir;
}

async function verifySite(siteDir, expected) {
  const actual = await countSiteDir(siteDir);
  const problems = [];
  for (const key of ['pages', 'articles', 'components', 'themes', 'assets', 'collections', 'uploads']) {
    if (Number(expected[key] || 0) !== Number(actual[key] || 0)) {
      problems.push({ field: key, expected: Number(expected[key] || 0), actual: Number(actual[key] || 0) });
    }
  }
  for (const file of ['site.json', 'project.json']) {
    try {
      JSON.parse(await fs.readFile(path.join(siteDir, file), 'utf8'));
    } catch {
      problems.push({ field: file, message: '缺失或无法解析' });
    }
  }
  if (problems.length) {
    const error = new Error('导入后校验未通过');
    error.detail = problems;
    throw error;
  }
}

main().catch((error) => {
  explainFailure('站点导入脚本异常', error && error.message ? error.message : '未知错误', ['先加 --dry-run 预览', '确认路径存在且可读']);
  process.exit(1);
});
