import fs from 'node:fs/promises';
import path from 'node:path';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { normalizeSiteAddress } from '../export/site-address.js';

const DATABASE_DRIVERS = new Set(['none', 'sqlite', 'mysql', 'postgres', 'files']);
const BACKEND_LANGUAGES = new Set(['none', 'rust', 'node', 'go']);
const CACHE_DRIVERS = new Set(['none', 'memory', 'redis']);
const SECRET_FILE = path.join('.lowcode', 'export-secrets.json');
const NGINX_FILE = path.join('config', 'nginx.conf');
/* 与 templates/tauri/scripts/validate-config.mjs 保持一致：向导保存阶段就拦住明显非法值，
   不要等到最后一步导出才报错。 */
const TAURI_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const TAURI_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TAURI_KEYS = new Set([
  'schemaVersion', 'productName', 'identifier', 'version', 'description', 'platform',
  'window', 'icon', 'protocol', 'delivery', 'https', 'backend', 'runtime', 'sidecar',
  'update', 'bundle', 'android', 'dev'
]);

function validateTauriInput(tauri) {
  for (const key of Object.keys(tauri)) {
    if (!TAURI_KEYS.has(key)) throw fail(422, 'LC_E_CONFIG', '桌面配置不认识的字段：' + key);
  }
  if (tauri.productName !== undefined) {
    const name = String(tauri.productName || '').trim();
    if (!name) throw fail(422, 'LC_E_CONFIG', '桌面应用名不能为空');
    if (name.length > 80) throw fail(422, 'LC_E_CONFIG', '桌面应用名最长 80 字符');
    if (/[\\/:*?"<>|]/.test(name)) throw fail(422, 'LC_E_CONFIG', '桌面应用名不能包含 \\ / : * ? " < > |');
  }
  if (tauri.identifier !== undefined) {
    const identifier = String(tauri.identifier || '').trim();
    if (!TAURI_IDENTIFIER_RE.test(identifier)) {
      throw fail(422, 'LC_E_CONFIG', '桌面应用标识符必须是反向域名，例如 com.example.app');
    }
  }
  if (tauri.version !== undefined) {
    const version = String(tauri.version || '').trim();
    if (!TAURI_SEMVER_RE.test(version)) {
      throw fail(422, 'LC_E_CONFIG', '桌面应用版本必须是 semver，例如 0.1.0');
    }
  }
  if (tauri.protocol !== undefined && !['http', 'https'].includes(String(tauri.protocol))) {
    throw fail(422, 'LC_E_CONFIG', '桌面协议只能是 http 或 https');
  }
  if (tauri.https !== undefined) {
    const mode = String((tauri.https && tauri.https.mode) || '');
    if (mode && !['generated', 'imported', 'none'].includes(mode)) {
      throw fail(422, 'LC_E_CONFIG', 'HTTPS 模式只能是 generated / imported / none');
    }
  }
}

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function adapterFor(ctx, siteId) {
  return createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
}

function cleanText(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

function cleanPort(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 65535) return fallback;
  return number;
}

const SECRET_FIELD_RE = /(pass(word|wd)?|pwd|secret|token|credential|private|api[_-]?key|access[_-]?key|dsn)/i;

/* 递归剥离密钥字段，但保留其它字段：包括当前界面还没暴露的 database.file 等配置。
   只读接口本来就不该回显明文密码，其余信息不应在保存/读取链路里被静默吃掉。 */
function stripSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecrets(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    /* 中间件字段用 { key/name, value } 表达：字段名命中密钥名时只保留结构，丢掉值。 */
    const fieldName = typeof value.key === 'string' ? value.key : typeof value.name === 'string' ? value.name : '';
    if (fieldName && SECRET_FIELD_RE.test(fieldName) && 'value' in value) {
      const redacted = stripSecrets(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'value')));
      return Object.assign({}, redacted, { secret: true, value: '' });
    }
    if (value.secret === true && 'value' in value) {
      const redacted = stripSecrets(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'value')));
      return Object.assign({}, redacted, { value: '' });
    }
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_FIELD_RE.test(key)) continue;
      const cleaned = stripSecrets(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

/* 只读回可公开的字段；密码永不经过这里，避免任何接口回显明文。 */
function sanitizeBackend(backend) {
  const src = backend && typeof backend === 'object' ? backend : {};
  const database = src.database && typeof src.database === 'object' ? src.database : {};
  const cache = src.cache && typeof src.cache === 'object' ? src.cache : {};
  const cors = src.cors && typeof src.cors === 'object' ? src.cors : {};
  const extras = stripSecrets(src);
  const rawLanguage = String(src.language || 'none');
  return Object.assign(extras, {
    language: rawLanguage,
    host: String(src.host || '127.0.0.1'),
    port: cleanPort(src.port, 8080),
    cors: Object.assign(stripSecrets(cors), {
      enabled: cors.enabled !== false,
      origins: Array.isArray(cors.origins) ? cors.origins.map((item) => String(item)).slice(0, 20) : [],
      credentials: cors.credentials === true
    }),
    database: Object.assign(stripSecrets(database), {
      driver: DATABASE_DRIVERS.has(String(database.driver || '')) ? String(database.driver) : 'sqlite',
      file: cleanText(database.file, 512),
      url: cleanText(database.url, 512),
      host: String(database.host || '127.0.0.1'),
      port: cleanPort(database.port, 0),
      name: cleanText(database.name, 128) || 'app',
      user: cleanText(database.user, 128),
      sslMode: String(database.sslMode || 'disable'),
      maxOpenConns: Number.isInteger(Number(database.maxOpenConns)) ? Number(database.maxOpenConns) : 5,
      connectTimeoutSeconds: Number.isInteger(Number(database.connectTimeoutSeconds))
        ? Number(database.connectTimeoutSeconds)
        : 10
    }),
    cache: Object.assign(stripSecrets(cache), {
      driver: CACHE_DRIVERS.has(String(cache.driver || '')) ? String(cache.driver) : 'memory',
      host: String(cache.host || '127.0.0.1'),
      port: cleanPort(cache.port, 16379),
      db: cleanPort(cache.db, 0),
      url: cleanText(cache.url, 512),
      keyPrefix: cleanText(cache.keyPrefix, 64) || 'lc:',
      ttlSeconds: Number.isInteger(Number(cache.ttlSeconds)) ? Number(cache.ttlSeconds) : 30
    })
  });
}

async function readSecrets(siteDir) {
  const file = path.join(siteDir, SECRET_FILE);
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (!text) return { databasePassword: '', redisPassword: '', updatedAt: '' };
  try {
    const parsed = JSON.parse(text);
    return {
      databasePassword: typeof parsed.databasePassword === 'string' ? parsed.databasePassword : '',
      redisPassword: typeof parsed.redisPassword === 'string' ? parsed.redisPassword : '',
      updatedAt: String(parsed.updatedAt || '')
    };
  } catch {
    return { databasePassword: '', redisPassword: '', updatedAt: '' };
  }
}

async function writeSecrets(siteDir, secrets) {
  const file = path.join(siteDir, SECRET_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload = {
    databasePassword: secrets.databasePassword || '',
    redisPassword: secrets.redisPassword || '',
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

async function readProject(adapter) {
  try {
    return JSON.parse(await adapter.read('project.json'));
  } catch {
    throw fail(404, 'LC_E_PROJECT_MISSING', '站点缺少 project.json');
  }
}

function buildView(input) {
  const { project, secrets, nginxText, defaultNginx, rev } = input;
  const options = (project.export && typeof project.export === 'object') ? project.export : {};
  const web = options.web || {};
  const warnings = [];
  let address = null;
  let addressError = '';
  try {
    address = normalizeSiteAddress({ domain: web.domain, basePath: web.basePath });
  } catch (error) {
    addressError = error.message;
  }
  return {
    schemaVersion: 1,
    rev,
    warnings,
    target: String(options.target || 'web-static'),
    web: {
      domain: String(web.domain || ''),
      basePath: String(web.basePath || '/'),
      normalized: address ? {
        domain: address.domain,
        origin: address.origin,
        basePath: address.basePath,
        publicBaseUrl: address.publicBaseUrl,
        configured: address.configured,
        serverNames: address.serverNames,
        corsOrigins: address.corsOrigins
      } : null,
      error: addressError
    },
    tauri: options.tauri || null,
    backend: sanitizeBackend(options.backend),
    nginx: {
      enabled: Boolean(web.nginx && web.nginx.enabled),
      customized: Boolean(nginxText),
      text: nginxText || defaultNginx,
      defaultText: defaultNginx
    },
    secrets: {
      database: { hasPassword: Boolean(secrets.databasePassword) },
      redis: { hasPassword: Boolean(secrets.redisPassword) },
      updatedAt: secrets.updatedAt || ''
    }
  };
}

/**
 * 导出前的站点级配置（不含任何密码明文）：
 * GET /api/sites/:siteId/export/config
 * PUT /api/sites/:siteId/export/config
 *
 * 密码只保存在站点 .lowcode/export-secrets.json（不随产物、不可经文件接口读取）；
 * PUT 时字段缺省表示保留原值，传空字符串表示清除。
 */
export function registerExportConfigRoutes(app, ctx) {
  async function view(siteId) {
    const adapter = adapterFor(ctx, siteId);
    const project = await readProject(adapter);
    const secrets = await readSecrets(adapter.siteDir);
    const nginxText = await fs.readFile(path.join(adapter.siteDir, NGINX_FILE), 'utf8').catch(() => null);
    const defaultNginx = await fs.readFile(path.join(ctx.platformRoot, 'templates', 'deploy', 'nginx', 'nginx.conf'), 'utf8').catch(() => '');
    return buildView({ project, secrets, nginxText, defaultNginx, rev: await adapter.rev() });
  }

  app.get('/api/sites/:siteId/export/config', async (request, reply) => {
    let siteId;
    try { siteId = sanitizeSiteId(request.params.siteId); } catch (error) {
      return reply.code(400).send({ ok: false, error: { code: error.code || 'LC_E_SITE_ID', message: '站点 ID 非法' } });
    }
    try {
      return { ok: true, data: await view(siteId) };
    } catch (error) {
      return reply.code(Number(error.statusCode) || 500).send({
        ok: false,
        error: { code: error.code || 'LC_E_EXPORT_CONFIG', message: error.message }
      });
    }
  });

  app.put('/api/sites/:siteId/export/config', async (request, reply) => {
    let siteId;
    let adapter;
    try {
      siteId = sanitizeSiteId(request.params.siteId);
      adapter = adapterFor(ctx, siteId);
    } catch (error) {
      return reply.code(400).send({ ok: false, error: { code: error.code || 'LC_E_SITE_ID', message: '站点 ID 非法' } });
    }
    const body = request.body || {};
    try {
      const project = await readProject(adapter);
      const options = (project.export && typeof project.export === 'object') ? project.export : {};

      if (body.backend !== undefined) {
        const backend = body.backend;
        if (!backend || typeof backend !== 'object') throw fail(422, 'LC_E_CONFIG', 'backend 必须是对象');
        const language = String(backend.language || 'none');
        if (!BACKEND_LANGUAGES.has(language)) {
          throw fail(422, 'LC_E_CONFIG', '后端语言只支持 none / rust / node / go');
        }
        const database = backend.database && typeof backend.database === 'object' ? backend.database : {};
        if (database.driver !== undefined && !DATABASE_DRIVERS.has(String(database.driver))) {
          throw fail(422, 'LC_E_CONFIG', '数据库驱动只支持 none / sqlite / mysql / postgres / files');
        }
        const cache = backend.cache && typeof backend.cache === 'object' ? backend.cache : {};
        if (cache.driver !== undefined && !CACHE_DRIVERS.has(String(cache.driver))) {
          throw fail(422, 'LC_E_CONFIG', '缓存驱动只支持 none / memory / redis');
        }
        options.backend = Object.assign(
          {},
          options.backend || {},
          sanitizeBackend(Object.assign({}, options.backend || {}, backend))
        );
        options.backend.language = language;
        /* 旧版本可能把明文密码写进 project.json，保存时顺手剔除。 */
        delete options.backend.password;
        if (options.backend.database) delete options.backend.database.password;
        if (options.backend.cache) delete options.backend.cache.password;
      }

      if (body.web !== undefined) {
        const web = body.web && typeof body.web === 'object' ? body.web : {};
        const domainText = cleanText(web.domain, 300);
        const basePathText = cleanText(web.basePath, 200);
        /* 与导出管线共用同一份归一化口径：缺协议/尾斜杠自动修正，带路径等非法值直接 422。 */
        const address = normalizeSiteAddress({ domain: domainText, basePath: basePathText });
        const nextWeb = Object.assign({}, options.web || {});
        nextWeb.domain = address.configured ? address.origin : '';
        nextWeb.basePath = address.basePath;
        options.web = nextWeb;
      }

      if (body.tauri !== undefined) {
        if (body.tauri !== null && typeof body.tauri !== 'object') throw fail(422, 'LC_E_CONFIG', 'tauri 必须是对象');
        const tauri = body.tauri || {};
        validateTauriInput(tauri);
        options.tauri = Object.assign({}, options.tauri || {}, tauri);
      }

      if (body.nginx !== undefined) {
        const nginx = body.nginx && typeof body.nginx === 'object' ? body.nginx : {};
        const text = cleanText(nginx.text, 200000);
        const web = Object.assign({}, options.web || {});
        web.nginx = Object.assign({}, web.nginx || {}, { enabled: nginx.enabled !== false });
        options.web = web;
        if (text.trim()) await adapter.write(NGINX_FILE, text.replace(/\r\n/g, '\n'));
        else await fs.rm(path.join(adapter.siteDir, NGINX_FILE), { force: true }).catch(() => {});
      }

      const nextProject = Object.assign({}, project, { export: options });
      await adapter.write('project.json', JSON.stringify(nextProject, null, 2) + '\n');

      const secrets = await readSecrets(adapter.siteDir);
      const input = body.secrets && typeof body.secrets === 'object' ? body.secrets : null;
      if (input) {
        if (typeof input.databasePassword === 'string') {
          const password = cleanText(input.databasePassword, 512);
          secrets.databasePassword = password;
        }
        if (typeof input.redisPassword === 'string') {
          const password = cleanText(input.redisPassword, 512);
          secrets.redisPassword = password;
        }
        await writeSecrets(adapter.siteDir, secrets);
      }

      return { ok: true, data: await view(siteId) };
    } catch (error) {
      return reply.code(Number(error.statusCode) || 500).send({
        ok: false,
        error: { code: error.code || 'LC_E_EXPORT_CONFIG', message: error.message }
      });
    }
  });
}
