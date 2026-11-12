/* 后端积木 · 构建产物
 *
 * 每次编译把模板 + 站点用户区 + 生成区组装成一份可运行的 Node 后端：
 *   data/sites/<siteId>/backend-build/node/
 *     server/   后端项目（模板副本 + custom 覆盖 + generated/flows）
 *     web/data/collections/  集合定义（后端默认从 ../web/data/collections 读取）
 * 该目录是构建产物，每次编译整体重建；它不是源码，不要在这里改东西。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateFlow } from './validation.js';
import { compileFlowToFiles } from './compile.js';
import { listUserFiles, readCollections } from './store.js';
import { allComponents } from './components.js';
import { USER_ZONES } from '../code/zones.js';

export class BuildError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'BuildError';
    this.issues = issues;
    this.statusCode = 422;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new BuildError(`构建路径越界：${target}`);
  }
  return resolvedTarget;
}

async function copyDirWithoutModules(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDirWithoutModules(from, to);
    else if (entry.isSymbolicLink()) await fs.copyFile(from, to).catch(() => {});
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

async function copyTemplate(platformRoot, language, serverDir) {
  const zone = USER_ZONES[language];
  if (!zone) throw new BuildError(`不支持的模板语言：${language}`);
  const templateDir = path.join(platformRoot, zone.templateRoot);
  const stat = await fs.stat(templateDir).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new BuildError(`后端模板不存在：${templateDir}`);
  // node_modules 不随每次构建复制：几十兆、上千个文件，会让预览启动慢到几十秒。
  // 首次构建时从模板复制一份放在构建目录里，后续构建保留复用。
  await copyDirWithoutModules(templateDir, serverDir);
  const modulesDir = path.join(templateDir, 'node_modules');
  const hasModules = await fs.stat(modulesDir).then((item) => item.isDirectory()).catch(() => false);
  if (hasModules) {
    const target = path.join(serverDir, 'node_modules');
    const lockText = await fs.readFile(path.join(templateDir, 'package-lock.json'), 'utf8').catch(() => '');
    const stamp = crypto.createHash('sha256').update(lockText).digest('hex').slice(0, 16);
    const markerPath = path.join(target, '.lc-template-deps.json');
    const marker = await fs.readFile(markerPath, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (!marker || marker.stamp !== stamp) {
      try {
        await fs.rm(target, { recursive: true, force: true });
        await fs.cp(modulesDir, target, { recursive: true });
        await fs.writeFile(markerPath, JSON.stringify({ stamp, at: new Date().toISOString() }) + '\n', 'utf8');
      } catch (error) {
        // 依赖目录被占时保留旧依赖继续构建；下次没有占用时会自动重试刷新。
        if (!isLockedError(error)) throw error;
      }
    }
  }
}

/* Windows 上正在运行的预览会占住部分运行时文件（SQLite、运行中的可执行文件）。
 * 重建构建目录时遇到这类占用只能跳过：让整个编译失败会把估算与导出一起拖垮。 */
function isLockedError(error) {
  return Boolean(error) && ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code);
}

async function removeTolerant(target, skipped) {
  try {
    await fs.rm(target, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (!isLockedError(error)) throw error;
    skipped.push(path.basename(target));
    return false;
  }
}

/**
 * 清理上一次构建，但保留 node_modules（首次构建时复制过来的依赖）。
 * 目录联接只在旧版本里出现过：失效的链接用 rmdir 摘掉，绝不在删除时递归进目标目录。
 * 被预览进程占用的文件跳过并记录，不影响其余文件重建。
 */
async function prepareBuildRoot(buildRoot, serverDir, skipped = []) {
  await fs.mkdir(serverDir, { recursive: true });
  const modules = path.join(serverDir, 'node_modules');
  const modulesOk = await fs.stat(modules).then((item) => item.isDirectory()).catch(() => false);
  if (!modulesOk) await fs.rmdir(modules).catch(() => {});
  const entries = await fs.readdir(buildRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === 'server' || entry.name === '.cache') continue;
    await removeTolerant(path.join(buildRoot, entry.name), skipped);
  }
  const serverEntries = await fs.readdir(serverDir, { withFileTypes: true }).catch(() => []);
  for (const entry of serverEntries) {
    if (entry.name === 'node_modules') continue;
    await removeTolerant(path.join(serverDir, entry.name), skipped);
  }
}

async function overlayUserFiles(siteDir, language, serverDir) {
  const files = await listUserFiles(siteDir, language);
  for (const file of files) {
    const target = assertInside(serverDir, path.join(serverDir, file.rel));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file.abs, target);
  }
  return files;
}

async function copyCollections(siteDir, buildRoot) {
  const collections = await readCollections(siteDir);
  const targetDir = path.join(buildRoot, 'web', 'data', 'collections');
  await fs.mkdir(targetDir, { recursive: true });
  for (const item of collections) {
    await fs.writeFile(path.join(targetDir, item.fileName), JSON.stringify(item.json, null, 2) + '\n', 'utf8');
  }
  return collections;
}

function previewConfig(flowDoc, { port, databaseFile, language }) {
  const center = flowDoc.settings && flowDoc.settings.configCenter ? flowDoc.settings.configCenter : {};
  const definitions = (Array.isArray(center.definitions) ? center.definitions : [])
    .filter((item) => item && item.key)
    .map((item) => {
      const out = { key: String(item.key), type: String(item.type || 'string') };
      if (!item.secret && item.default !== undefined && item.default !== '') out.default = item.default;
      if (Array.isArray(item.enum) && item.enum.length) out.enum = item.enum;
      // Rust/Go 的配置校验要求 secret 显式是布尔值；Node 允许省略。
      if (language !== 'node') out.secret = item.secret === true;
      else if (item.secret === true) out.secret = true;
      if (item.description) out.description = String(item.description).slice(0, 120);
      return out;
    });
  const values = center.values && typeof center.values === 'object' ? { ...center.values } : {};
  for (const item of definitions) {
    if (item.secret) delete values[item.key];
  }

  const config = {
    schemaVersion: 1,
    language,
    maturity: 'full',
    strict: true,
    host: '127.0.0.1',
    port,
    logLevel: 'info',
    // 预览时由流程里的 CORS 节点接管跨域头，避免和全局 CORS 叠加。
    cors: { enabled: false, origins: [] },
    database: { driver: 'sqlite', url: `sqlite://${databaseFile.split(path.sep).join('/')}` },
    cache: { enabled: true, driver: 'memory', fallback: 'memory' },
    middleware: { logging: true, rateLimit: { enabled: false } },
    static: { enabled: false },
    dataApi: {
      enabled: true,
      publicRead: true,
      writeRequiresAuth: true,
      collectionsDir: '../web/data/collections'
    },
    configCenter: { definitions, values }
  };

  // 用 JSON：模板自带的 YAML 子集解析器不支持行内空映射（values: {}），
  // 而 config.js 的 parseConfigText 对 JSON 是无损的。
  return JSON.stringify(config, null, 2) + '\n';
}

async function updateManifest(serverDir, flowDoc, files, meta) {
  const manifestPath = path.join(serverDir, 'GENERATED-MANIFEST.json');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (err) {
    throw new BuildError(`读取生成区清单失败：${manifestPath}（${err.message}）`);
  }
  const entry = (flowDoc.flow.root.children || []).find((node) => node && node.enabled !== false && node.type === 'entry.request');
  const manifestFile = meta.target === 'rust'
    ? 'src/generated/flows/manifest.json'
    : meta.target === 'go'
      ? 'internal/generated/flows/manifest.json'
      : 'src/generated/flows/manifest.json';
  manifest.files = manifest.files || {};
  for (const file of files) manifest.files[file.path] = sha256(file.content);
  manifest.flows = {
    schemaVersion: 2,
    flowId: flowDoc.flow.id,
    flowName: flowDoc.flow.name || '',
    treeVersion: meta.treeVersion,
    treeHash: meta.treeHash,
    irVersion: meta.irVersion,
    irHash: meta.irHash,
    targetLanguages: [meta.target || 'node'],
    components: meta.components || [],
    generatedAt: meta.generatedAt,
    generator: 'lowcode-backend-flow',
    entry: entry ? { method: entry.params.method, path: entry.params.path } : null,
    manifest: manifestFile
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

/** 各语言的“路由装配文件”，流程入口要追加到这上面。 */
async function routeAssembly(serverDir, language) {
  if (language === 'rust') {
    return {
      routesPath: path.join(serverDir, 'src', 'generated', 'routes', 'mod.rs'),
      extra: {
        generatedModSource: await fs.readFile(path.join(serverDir, 'src', 'generated', 'mod.rs'), 'utf8')
      }
    };
  }
  if (language === 'go') {
    return {
      routesPath: path.join(serverDir, 'internal', 'generated', 'routes', 'routes.go'),
      extra: {}
    };
  }
  return { routesPath: path.join(serverDir, 'src', 'generated', 'routes', 'index.js'), extra: {} };
}

/**
 * 编译并组装构建产物。
 * @param {{ paths: object, siteId: string, siteDir: string, flowDoc: object, previewPort?: number, target?: string }} input
 */
export async function buildFlowProject({ paths, siteId, siteDir, flowDoc, previewPort, target = 'node' }) {
  const language = String(target || 'node');
  const collections = await readCollections(siteDir);
  const userFiles = await listUserFiles(siteDir, language);
  const components = await allComponents({ paths, siteDir });
  const validation = validateFlow(flowDoc, {
    collections: collections.map((item) => item.id),
    userFiles: new Set(userFiles.map((item) => item.rel)),
    components,
    target: language
  });
  if (!validation.ok) {
    throw new BuildError('流程校验未通过，已停止生成', validation.issues);
  }

  const buildRoot = assertInside(siteDir, path.join(siteDir, 'backend-build', language));
  const serverDir = path.join(buildRoot, 'server');
  const skipped = [];
  await prepareBuildRoot(buildRoot, serverDir, skipped);

  await copyTemplate(paths.platformRoot, language, serverDir);
  await overlayUserFiles(siteDir, language, serverDir);
  const collectionDefs = await copyCollections(siteDir, buildRoot);

  const routes = await routeAssembly(serverDir, language);
  const routesIndexSource = await fs.readFile(routes.routesPath, 'utf8');
  const treeVersion = (Number(flowDoc.flow.treeVersion) || 0) + 1;
  const { files, meta } = compileFlowToFiles(flowDoc, {
    routesIndexSource,
    ...routes.extra,
    treeVersion,
    generatedAt: new Date().toISOString(),
    target: language,
    components,
    userFiles: new Set(userFiles.map((item) => item.rel))
  });

  for (const file of files) {
    const targetFile = assertInside(serverDir, path.join(serverDir, file.path));
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, file.content, 'utf8');
  }

  const manifest = await updateManifest(serverDir, flowDoc, files, meta);
  const issues = [...validation.issues, ...(meta.warnings || [])];
  if (skipped.length) {
    issues.push({
      level: 'warning',
      code: 'LC_W_BUILD_LOCKED',
      message: `有 ${skipped.length} 个文件正被运行中的预览占用，已跳过清理并继续生成（不影响本次产物）`,
      detail: skipped.slice(0, 8)
    });
  }

  let configFile = '';
  let databaseFile = '';
  if (previewPort) {
    /* 预览 SQLite 必须放在构建目录之外：构建会整体重建 backend-build，
     * 正在运行的预览实例仍持有该文件，Windows 下删除会直接 EBUSY。 */
    const previewDir = path.join(siteDir, 'preview-data', language);
    await fs.mkdir(previewDir, { recursive: true });
    const databaseAbs = path.join(previewDir, `preview-${crypto.randomBytes(4).toString('hex')}.db`);
    databaseFile = path.relative(serverDir, databaseAbs);
    configFile = path.join(serverDir, 'config.preview.json');
    await fs.writeFile(configFile, previewConfig(flowDoc, { port: previewPort, databaseFile, language }), 'utf8');
  }

  return {
    buildRoot,
    serverDir,
    files,
    meta,
    manifest,
    collections: collectionDefs,
    configFile,
    databaseFile,
    issues,
    userFiles,
    skipped
  };
}
