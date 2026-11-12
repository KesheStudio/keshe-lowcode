import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSiteAdapter } from '../../src/storage/index.js';
import { sanitizeSiteId } from '../../src/storage/path-safety.js';
import { DEFAULT_SEEDS } from '../../src/theme/tokens.mjs';

export const SITE_GITIGNORE = `.lowcode/
builds/
backend-build/
preview-data/
backups/
certs/
versions/
data/files/
trash/
*.tmp
*.corrupt
`;

export function slugify(name) {
  const text = String(name || '');
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const ascii = base.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
  if (ascii && /[a-z]/.test(ascii)) return ascii;
  // 中文/非 ASCII 或只剩数字的名称：用名称哈希做稳定 slug，保证迁移幂等
  return `site-${crypto.createHash('sha1').update(text || 'site').digest('hex').slice(0, 8)}`;
}

export function defaultProject(name) {
  return {
    schemaVersion: 2,
    configVersion: 5,
    site: {
      name,
      description: '',
      language: 'zh-CN',
      logo: '',
      copyright: ''
    },
    template: { id: 'docs' },
    theme: { activeId: 'ink-green' },
    navigation: {
      items: [{ id: 'home', label: '首页', pageId: 'home' }]
    },
    footer: { text: '' },
    export: {
      target: 'web-static',
      web: {
        delivery: 'static',
        domain: '',
        basePath: '/',
        cleanUrls: true,
        nginx: { enabled: false }
      },
      tauri: {
        productName: name,
        identifier: 'com.keshestudio.lowcode',
        version: '0.1.0',
        window: { width: 1024, height: 720, minWidth: 800, minHeight: 600, resizable: true },
        icon: 'assets/icons/app.png',
        protocol: 'https',
        https: { mode: 'generated' },
        update: { enabled: false, endpoint: '', pubkey: '' },
        bundle: { targets: ['msi'] }
      },
      backend: {
        language: 'none',
        host: '127.0.0.1',
        port: 8080,
        cors: { enabled: true, origins: [], credentials: false },
        env: {},
        middleware: [],
        database: { driver: 'sqlite', file: 'data/app.db' },
        configFile: 'deploy/backend/config.yaml'
      }
    }
  };
}

export function defaultPage() {
  return {
    schemaVersion: 2,
    id: 'home',
    title: '首页',
    slug: 'home',
    path: 'index.html',
    nav: true,
    blocks: []
  };
}

export const SITE_DIRS = [
  'pages',
  'articles',
  'components',
  'themes',
  'templates',
  'data/collections',
  'data/originals',
  'data/files',
  'data/mocks',
  'assets/images',
  'assets/fonts',
  'assets/icons',
  'certs',
  'deploy/nginx',
  'deploy/backend',
  'deploy/scripts',
  'builds',
  'versions',
  'backups',
  'trash/components',
  'trash/templates',
  '.lowcode/locks',
  '.lowcode/tmp',
  '.lowcode/txn'
];

export async function listSites(paths) {
  const root = path.join(paths.dataDir, 'sites');
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const sites = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    try {
      const text = await fs.readFile(path.join(dir, 'site.json'), 'utf8');
      const meta = JSON.parse(text);
      const project = await fs.readFile(path.join(dir, 'project.json'), 'utf8')
        .then((raw) => JSON.parse(raw))
        .catch(() => null);
      const backendLanguage = String((project && project.export && project.export.backend && project.export.backend.language) || 'none');
      const pageFiles = await fs.readdir(path.join(dir, 'pages')).catch(() => []);
      const pages = pageFiles.filter((file) => file.endsWith('.json'));
      const touched = await Promise.all(
        ['site.json', 'project.json'].map((file) => fs.stat(path.join(dir, file)).then((stat) => stat.mtimeMs).catch(() => 0))
          .concat(pages.map((file) => fs.stat(path.join(dir, 'pages', file)).then((stat) => stat.mtimeMs).catch(() => 0)))
      );
      const lastModified = touched.reduce((max, value) => Math.max(max, value), 0);
      sites.push({
        siteId: entry.name,
        name: meta.name || entry.name,
        slug: meta.slug || entry.name,
        status: meta.status === 'needs-repair' ? 'needs-repair' : 'ready',
        type: backendLanguage === 'none' ? 'static' : 'backend',
        backendLanguage,
        pageCount: pages.length,
        createdAt: meta.createdAt || '',
        updatedAt: meta.updatedAt || '',
        lastModified: lastModified ? new Date(lastModified).toISOString() : (meta.updatedAt || '')
      });
    } catch {
      sites.push({ siteId: entry.name, name: entry.name, slug: entry.name, status: 'needs-repair', type: 'static', backendLanguage: 'none', pageCount: 0, createdAt: '', updatedAt: '', lastModified: '' });
    }
  }
  sites.sort((a, b) => String(b.lastModified || '').localeCompare(String(a.lastModified || '')) || (a.name || '').localeCompare(b.name || '', 'zh-CN'));
  return sites;
}

export async function createSite(paths, options = {}) {
  const name = String(options.name || '未命名站点').trim() || '未命名站点';
  const type = options.type === 'backend' ? 'backend' : 'static';
  const backendLanguage = type === 'backend'
    ? (['rust', 'node', 'go'].includes(options.backendLanguage) ? options.backendLanguage : 'rust')
    : 'none';
  const siteId = sanitizeSiteId(options.siteId || (await uniqueSiteId(paths, slugify(name))));

  const siteDir = path.join(paths.dataDir, 'sites', siteId);
  const adapter = createSiteAdapter(paths.dataDir, siteId, { lockStaleMs: paths.lockStaleMs });

  for (const dir of SITE_DIRS) {
    await fs.mkdir(path.join(siteDir, dir), { recursive: true });
  }

  const now = new Date().toISOString();
  const siteMeta = {
    schemaVersion: 1,
    siteId,
    name,
    slug: slugify(name),
    layoutVersion: 2,
    storage: 'files',
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    migration: options.migration || null
  };

  const project = defaultProject(name);
  project.export.backend.language = backendLanguage;
  project.export.web.delivery = type === 'backend' ? 'backend' : 'static';

  await adapter.transaction(siteId, async (tx) => {
    await tx.write('site.json', JSON.stringify(siteMeta, null, 2));
    await tx.write('.gitignore', SITE_GITIGNORE);
    await tx.write('project.json', JSON.stringify(project, null, 2));
    await tx.write('pages/home.json', JSON.stringify(defaultPage(), null, 2));
    await tx.write('themes/ink-green.json', JSON.stringify(defaultTheme(), null, 2));
    await tx.write('data/sources.json', JSON.stringify({ schemaVersion: 1, sources: [] }, null, 2));
  });

  return { siteId, name, siteDir, type, backendLanguage };
}

export async function uniqueSiteId(paths, base) {
  const root = path.join(paths.dataDir, 'sites');
  let candidate = base;
  let index = 2;
  // 最多尝试 50 次，避免极端情况下死循环
  while (index < 52) {
    const exists = await fs
      .stat(path.join(root, candidate))
      .then(() => true)
      .catch(() => false);
    if (!exists) return candidate;
    candidate = `${base}-${index}`;
    index += 1;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

export function defaultTheme() {
  return {
    schemaVersion: 2,
    id: 'ink-green',
    name: '纸墨 · 松绿',
    tone: 'paper',
    description: '主站默认配色，米色纸面配墨绿。',
    modes: {
      light: { seeds: { ...DEFAULT_SEEDS.light }, overrides: {} },
      dark: { seeds: { ...DEFAULT_SEEDS.dark }, overrides: {} }
    },
    shared: { tokens: {} }
  };
}

export async function readSite(paths, siteId) {
  const id = sanitizeSiteId(siteId);
  const dir = path.join(paths.dataDir, 'sites', id);
  let text;
  try {
    text = await fs.readFile(path.join(dir, 'site.json'), 'utf8');
  } catch (error) {
    /* 站点不存在是业务错误，不能把 ENOENT 的绝对路径抛给前端（ERR-01）。 */
    if (error && error.code === 'ENOENT') {
      const missing = new Error('站点不存在：' + id);
      missing.statusCode = 404;
      missing.code = 'LC_E_SITE_NOT_FOUND';
      throw missing;
    }
    throw error;
  }
  let meta;
  try {
    meta = JSON.parse(text);
  } catch {
    const corrupt = new Error('站点元数据损坏：site.json 不是合法 JSON');
    corrupt.statusCode = 500;
    corrupt.code = 'LC_E_SITE_CORRUPT';
    throw corrupt;
  }
  let project = null;
  try {
    project = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
  } catch {
    project = null;
  }
  return { site: meta, project, siteDir: dir };
}

export async function siteTree(paths, siteId) {
  const id = sanitizeSiteId(siteId);
  const adapter = createSiteAdapter(paths.dataDir, id, { lockStaleMs: paths.lockStaleMs });
  const entries = await adapter.list('', { recursive: true, depth: 2 });
  return {
    entries,
    rev: await adapter.rev()
  };
}
