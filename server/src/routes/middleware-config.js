import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { readSite } from '../sites.js';

const require = createRequire(import.meta.url);
const Catalog = require('../../../shared/middleware-catalog.js');

const SECRET_FILE = path.join('.lowcode', 'middleware-secrets.json');
const EXPORT_SECRET_FILE = path.join('.lowcode', 'export-secrets.json');

function fail(message, field) {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = 'LC_E_VALIDATION';
  if (field) error.detail = { field };
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureBackend(project) {
  if (!isObject(project.export)) project.export = {};
  if (!isObject(project.export.backend)) project.export.backend = { language: 'none' };
  return project.export.backend;
}

function emptySecrets() {
  return {
    schemaVersion: 1,
    builtin: {},
    custom: {},
    config: {
      dev: { env: {}, cli: {} },
      prod: { env: {}, cli: {} }
    }
  };
}

function normalizeSecretEnv(input) {
  const source = isObject(input) ? input : {};
  return {
    env: isObject(source.env) ? source.env : {},
    cli: isObject(source.cli) ? source.cli : {}
  };
}

async function readSecrets(siteDir) {
  const result = emptySecrets();
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(siteDir, SECRET_FILE), 'utf8'));
    if (isObject(parsed.builtin)) result.builtin = parsed.builtin;
    if (isObject(parsed.custom)) result.custom = parsed.custom;
    if (isObject(parsed.config)) {
      result.config.dev = normalizeSecretEnv(parsed.config.dev);
      result.config.prod = normalizeSecretEnv(parsed.config.prod);
    }
  } catch {
    /* 没有密钥文件时按空处理 */
  }
  return result;
}

async function writeSecrets(siteDir, secrets) {
  const dir = path.join(siteDir, '.lowcode');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'middleware-secrets.json');
  await fs.writeFile(file, JSON.stringify(secrets, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(file, 0o600);
  } catch {
    /* Windows 上 chmod 不生效，忽略 */
  }
}

async function readExportSecrets(siteDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(siteDir, EXPORT_SECRET_FILE), 'utf8'));
    return {
      databasePassword: typeof parsed.databasePassword === 'string' ? parsed.databasePassword : '',
      redisPassword: typeof parsed.redisPassword === 'string' ? parsed.redisPassword : ''
    };
  } catch {
    return { databasePassword: '', redisPassword: '' };
  }
}

async function writeExportSecrets(siteDir, values) {
  const dir = path.join(siteDir, '.lowcode');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'export-secrets.json');
  await fs.writeFile(file, JSON.stringify({ ...values, updatedAt: new Date().toISOString() }, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  try {
    await fs.chmod(file, 0o600);
  } catch {
    /* ignore */
  }
}

function databaseSelection(backend) {
  const selection = isObject(backend.middlewareSelection) ? backend.middlewareSelection : null;
  if (selection && typeof selection.database === 'string') return selection.database;
  const driver = String(backend.database?.driver || 'sqlite');
  if (driver === 'postgres') return 'postgres';
  if (driver === 'mysql') return 'mysql';
  return 'sqlite';
}

function databaseConfigFor(backend, id) {
  const db = isObject(backend.database) ? backend.database : {};
  if (id === 'sqlite') return { file: String(db.file || 'data/app.db') };
  if (id === 'postgres') {
    return {
      host: String(db.host || '127.0.0.1'),
      port: Number(db.port) || 15432,
      database: String(db.name || 'app'),
      user: String(db.user || 'lc'),
      sslMode: String(db.sslMode || 'disable'),
      maxOpenConns: Number(db.maxOpenConns) || 10,
      connectTimeoutSeconds: Number(db.connectTimeoutSeconds) || 5
    };
  }
  return {
    host: String(db.host || '127.0.0.1'),
    port: Number(db.port) || 13306,
    database: String(db.name || 'app'),
    user: String(db.user || 'lc'),
    maxOpenConns: Number(db.maxOpenConns) || 10,
    connectTimeoutSeconds: Number(db.connectTimeoutSeconds) || 5
  };
}

function cacheConfigFor(backend) {
  const cache = isObject(backend.cache) ? backend.cache : {};
  return {
    url: String(cache.url || 'redis://127.0.0.1:16379/0'),
    ttlSeconds: Number(cache.ttlSeconds) || 30,
    keyPrefix: String(cache.keyPrefix || 'lc:')
  };
}

function buildMiddlewareView(loaded) {
  const backend = ensureBackend(loaded.project || {});
  const selection = isObject(backend.middlewareSelection) ? backend.middlewareSelection : {};
  const selectedDatabase = databaseSelection(backend);
  const redisEnabled = typeof selection.redis === 'boolean'
    ? selection.redis
    : Boolean(backend.cache?.enabled && backend.cache?.driver === 'redis');
  const groups = {};

  Catalog.BUILTIN_GROUPS.forEach((group) => {
    let enabled = false;
    let config = Catalog.defaultConfig(group);
    if (group.kind === 'database') {
      enabled = selectedDatabase === group.id;
      if (enabled) config = { ...config, ...databaseConfigFor(backend, group.id) };
    } else if (group.id === 'redis') {
      enabled = redisEnabled;
      if (enabled) config = { ...config, ...cacheConfigFor(backend) };
    } else {
      const saved = backend.middlewareGroups?.[group.id];
      enabled = Boolean(saved && saved.enabled === true);
      if (enabled && isObject(saved.config)) config = { ...config, ...saved.config };
    }
    groups[group.id] = { enabled, config };
  });

  const secrets = loaded.secrets || emptySecrets();
  Catalog.BUILTIN_GROUPS.forEach((group) => {
    const stored = isObject(secrets.builtin[group.group]) ? secrets.builtin[group.group] : {};
    group.fields.forEach((item) => {
      if (!item.secret) return;
      if (stored[item.key] !== undefined) groups[group.id].config[item.key] = String(stored[item.key]);
    });
  });

  const custom = Array.isArray(backend.customMiddleware)
    ? backend.customMiddleware.map((item) => {
        const stored = isObject(secrets.custom[item.id]) ? secrets.custom[item.id] : {};
        return {
          id: String(item.id || ''),
          name: String(item.name || item.id || ''),
          description: String(item.description || ''),
          fields: (Array.isArray(item.fields) ? item.fields : []).map((field) => ({
            key: String(field.key || ''),
            label: String(field.label || field.key || ''),
            type: ['string', 'number', 'bool', 'enum'].includes(field.type) ? field.type : 'string',
            secret: field.secret === true,
            enum: Array.isArray(field.enum) ? field.enum.map(String) : undefined,
            value: field.secret === true
              ? String(stored[field.key] ?? '')
              : (field.value === undefined || field.value === null ? '' : field.value)
          }))
        };
      })
    : [];

  return {
    siteId: loaded.site?.siteId || '',
    selection: { database: selectedDatabase, redis: redisEnabled },
    groups,
    custom,
    environment: String(backend.environment || 'dev')
  };
}

function toNumberField(value, item) {
  if (value === '' || value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) fail(`${item.label} 必须是数字`, item.key);
  if (item.min !== undefined && number < item.min) fail(`${item.label} 不能小于 ${item.min}`, item.key);
  if (item.max !== undefined && number > item.max) fail(`${item.label} 不能大于 ${item.max}`, item.key);
  return number;
}

function normalizeBuiltinGroups(body, currentSecrets) {
  if (!isObject(body.groups)) fail('缺少 groups 对象', 'groups');
  const nextSecrets = { ...currentSecrets, builtin: clone(currentSecrets.builtin) };
  const normalized = {};
  const enabledDatabases = [];
  const enabledSecretGroups = new Set();

  Catalog.BUILTIN_GROUPS.forEach((group) => {
    const source = isObject(body.groups[group.id]) ? body.groups[group.id] : {};
    const enabled = source.enabled === true;
    const raw = isObject(source.config) ? source.config : {};
    const config = {};
    const secretValues = {};

    group.fields.forEach((item) => {
      if (item.secret) {
        const value = raw[item.key];
        if (!enabled) return;
        if (value === undefined || value === null) {
          const existing = currentSecrets.builtin?.[group.group]?.[item.key];
          if (existing !== undefined) secretValues[item.key] = String(existing);
          return;
        }
        const text = String(value);
        if (text === '') {
          secretValues[item.key] = '';
          return;
        }
        secretValues[item.key] = text;
        return;
      }

      if (!enabled) return;
      if (item.type === 'number') {
        const number = toNumberField(raw[item.key], item);
        if (number === null) {
          if (item.required) fail(`${item.label} 不能为空`, group.id + '.' + item.key);
          config[item.key] = item.default;
        } else {
          config[item.key] = number;
        }
        return;
      }
      const text = raw[item.key] === undefined || raw[item.key] === null
        ? String(item.default ?? '')
        : String(raw[item.key]);
      if (item.type === 'enum' && Array.isArray(item.enum) && !item.enum.includes(text)) {
        fail(`${item.label} 只能是 ${item.enum.join(' / ')}`, group.id + '.' + item.key);
      }
      if (item.required && text.trim() === '') fail(`${item.label} 不能为空`, group.id + '.' + item.key);
      config[item.key] = text;
    });

    if (enabled && group.kind === 'database') enabledDatabases.push(group.id);
    if (enabled) {
      enabledSecretGroups.add(group.group);
      const stored = {};
      Object.keys(secretValues).forEach((key) => {
        if (secretValues[key] !== '') stored[key] = secretValues[key];
      });
      if (Object.keys(stored).length) nextSecrets.builtin[group.group] = stored;
    }
    normalized[group.id] = { enabled, config };
  });

  /* mysql 和 mariadb 共用同一个导出组，只有该组全部关闭时才清空密钥。 */
  Object.keys(nextSecrets.builtin).forEach((group) => {
    if (!enabledSecretGroups.has(group)) delete nextSecrets.builtin[group];
  });

  if (enabledDatabases.length > 1) {
    fail(`同时启用了多个数据库中间件：${enabledDatabases.join('、')}；一次只能启用一个`, 'groups');
  }

  return { groups: normalized, secrets: nextSecrets, enabledDatabases };
}

function normalizeCustom(body, currentSecrets, reservedKeys) {
  if (body.custom === undefined) return { custom: undefined, secrets: { ...currentSecrets } };
  if (!Array.isArray(body.custom)) fail('custom 必须是数组', 'custom');
  if (body.custom.length > 64) fail('自定义中间件最多 64 个', 'custom');

  const ids = new Set();
  const keys = new Set();
  const nextSecrets = { ...currentSecrets, custom: {} };
  const custom = body.custom.map((raw, index) => {
    if (!isObject(raw)) fail(`custom[${index}] 必须是对象`, `custom[${index}]`);
    const id = String(raw.id || '').trim();
    if (!Catalog.CUSTOM_ID_RE.test(id)) fail(`自定义中间件 ID 不合法：${id || '(空)'}；小写字母开头，可含数字、下划线、短横线`, 'custom.id');
    if (ids.has(id)) fail(`自定义中间件 ID 重复：${id}`, 'custom.id');
    ids.add(id);
    const name = String(raw.name || '').trim();
    if (!name) fail(`自定义中间件 ${id} 缺少名称`, 'custom.name');
    if (!Array.isArray(raw.fields)) fail(`自定义中间件 ${id} 的 fields 必须是数组`, 'custom.fields');
    if (raw.fields.length > 64) fail(`自定义中间件 ${id} 最多 64 个字段`, 'custom.fields');

    const fieldKeys = new Set();
    const secretValues = {};
    const fields = raw.fields.map((field, fieldIndex) => {
      if (!isObject(field)) fail(`自定义中间件 ${id} 的字段 ${fieldIndex} 必须是对象`, 'custom.fields');
      const key = String(field.key || '').trim();
      if (!Catalog.CUSTOM_FIELD_RE.test(key)) fail(`字段键不合法：${key || '(空)'}`, 'custom.fields');
      const lowered = key.toLowerCase();
      if (fieldKeys.has(lowered)) fail(`自定义中间件 ${id} 的字段键重复：${key}`, 'custom.fields');
      fieldKeys.add(lowered);
      const derived = Catalog.customKey(id, key);
      if (reservedKeys.has(derived) || keys.has(derived)) fail(`配置键冲突：${derived}`, 'custom.fields');
      keys.add(derived);

      const type = ['string', 'number', 'bool', 'enum'].includes(field.type) ? field.type : 'string';
      const enumList = Array.isArray(field.enum) ? field.enum.map(String).filter(Boolean) : undefined;
      if (type === 'enum' && (!enumList || enumList.length === 0)) fail(`字段 ${key} 是枚举，必须提供可选值`, 'custom.fields');
      const secret = field.secret === true;

      if (secret) {
        const value = field.value;
        if (value !== undefined && value !== null) {
          const text = String(value);
          if (text !== '') secretValues[key] = text;
        }
        return { key, label: String(field.label || key), type, secret: true, enum: enumList };
      }

      let value = field.value;
      if (value === undefined || value === null) value = '';
      if (type === 'number') {
        const number = toNumberField(value, { label: key, key });
        value = number === null ? 0 : number;
      } else if (type === 'bool') {
        if (typeof value === 'boolean') value = value;
        else {
          const text = String(value).trim().toLowerCase();
          value = ['true', '1', 'yes', 'on'].includes(text);
        }
      } else if (type === 'enum') {
        const text = String(value);
        if (text && !enumList.includes(text)) fail(`字段 ${key} 只能是 ${enumList.join(' / ')}`, 'custom.fields');
        value = text || enumList[0];
      } else {
        value = String(value);
      }
      return { key, label: String(field.label || key), type, secret: false, enum: enumList, value };
    });

    if (Object.keys(secretValues).length) nextSecrets.custom[id] = secretValues;
    return { id, name, description: String(raw.description || '').slice(0, 512), fields };
  });

  return { custom, secrets: nextSecrets };
}

function syncDatabase(backend, groups) {
  const selected = groups.postgres?.enabled
    ? 'postgres'
    : groups.mysql?.enabled
      ? 'mysql'
      : groups.mariadb?.enabled
        ? 'mariadb'
        : groups.sqlite?.enabled
          ? 'sqlite'
          : '';
  if (selected === 'postgres' || selected === 'mysql' || selected === 'mariadb') {
    const config = groups[selected].config;
    backend.database = {
      driver: selected === 'postgres' ? 'postgres' : 'mysql',
      url: '',
      host: config.host,
      port: config.port,
      name: config.database,
      user: config.user,
      password: '',
      sslMode: config.sslMode || 'disable',
      maxOpenConns: config.maxOpenConns,
      connectTimeoutSeconds: config.connectTimeoutSeconds
    };
  } else if (selected === 'sqlite') {
    const file = groups.sqlite.config.file || 'data/app.db';
    backend.database = {
      driver: 'sqlite',
      url: 'sqlite://' + file,
      file,
      host: '127.0.0.1',
      port: 0,
      name: 'app',
      user: '',
      password: '',
      sslMode: 'disable',
      maxOpenConns: 10,
      connectTimeoutSeconds: 5
    };
  } else {
    /* 没有启用任何数据库组：保留 SQLite 兼容模式，避免导出后仍连旧的数据库。 */
    backend.database = {
      driver: 'sqlite',
      url: 'sqlite://data/app.db',
      file: 'data/app.db',
      host: '127.0.0.1',
      port: 0,
      name: 'app',
      user: '',
      password: '',
      sslMode: 'disable',
      maxOpenConns: 10,
      connectTimeoutSeconds: 5
    };
  }
  backend.middlewareSelection = {
    database: selected,
    redis: groups.redis?.enabled === true
  };
}

function syncCache(backend, groups) {
  if (groups.redis?.enabled) {
    backend.cache = {
      enabled: true,
      fallback: 'memory',
      driver: 'redis',
      url: groups.redis.config.url,
      ttlSeconds: groups.redis.config.ttlSeconds,
      keyPrefix: groups.redis.config.keyPrefix
    };
    return;
  }
  backend.cache = {
    enabled: false,
    fallback: 'memory',
    driver: 'memory',
    url: 'redis://127.0.0.1:16379/0',
    ttlSeconds: 30,
    keyPrefix: 'lc:'
  };
}

function syncMiddlewareGroups(backend, groups) {
  const next = {};
  ['objectStorage', 'messageQueue', 'search', 'reverseProxy'].forEach((name) => {
    if (groups[name]?.enabled) next[name] = { enabled: true, config: { ...groups[name].config } };
  });
  backend.middlewareGroups = next;
}

async function saveProject(ctx, loaded, project) {
  const adapter = createSiteAdapter(ctx.paths.dataDir, loaded.site.siteId || loaded.site.id, {
    lockStaleMs: ctx.paths.lockStaleMs
  });
  await adapter.transaction(adapter.siteId, async (tx) => {
    await tx.write('project.json', JSON.stringify(project, null, 2));
  });
}

/* ---------------- 配置中心 ---------------- */

function normalizeDefinitions(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) fail('definitions 必须是数组', 'definitions');
  if (input.length > 200) fail('配置项最多 200 个', 'definitions');
  const keys = new Set();
  return input.map((raw, index) => {
    if (!isObject(raw)) fail(`definitions[${index}] 必须是对象`, 'definitions');
    const key = String(raw.key || '').trim().toUpperCase();
    if (!Catalog.KEY_RE.test(key)) fail(`配置键不合法：${key || '(空)'}；需大写字母开头，只含 A-Z、0-9、下划线`, 'definitions.key');
    if (keys.has(key)) fail(`配置键重复：${key}`, 'definitions.key');
    keys.add(key);
    if (Catalog.isReservedKey(key)) fail(`配置键 ${key} 与内置中间件环境变量或 MW_ 前缀冲突`, 'definitions.key');
    const group = Catalog.configGroup(String(raw.group || 'backend')) ? String(raw.group || 'backend') : 'backend';
    const type = ['string', 'number', 'bool', 'enum'].includes(raw.type) ? raw.type : 'string';
    const secret = raw.secret === true;
    const enumList = Array.isArray(raw.enum) ? raw.enum.map(String).filter(Boolean) : undefined;
    if (type === 'enum' && (!enumList || enumList.length === 0)) fail(`配置项 ${key} 是枚举，必须提供可选值`, 'definitions.enum');
    let defaultValue = raw.default;
    if (secret) {
      if (defaultValue !== undefined && defaultValue !== null && String(defaultValue) !== '') {
        fail(`密钥配置项 ${key} 的默认值必须留空`, 'definitions.default');
      }
      defaultValue = undefined;
    } else if (defaultValue !== undefined && defaultValue !== null && String(defaultValue) !== '') {
      defaultValue = normalizeValue(type, defaultValue, key, enumList);
    } else {
      defaultValue = undefined;
    }
    return {
      key,
      group,
      type,
      default: defaultValue,
      enum: enumList,
      secret,
      description: String(raw.description || '').slice(0, 512)
    };
  });
}

function normalizeValue(type, value, key, enumList) {
  if (value === undefined || value === null || value === '') return undefined;
  if (type === 'number') {
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number)) fail(`${key} 必须是数字`, key);
    return number;
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    fail(`${key} 必须是 true/false`, key);
  }
  if (type === 'enum') {
    const text = String(value);
    if (!Array.isArray(enumList) || !enumList.includes(text)) fail(`${key} 只能是 ${(enumList || []).join(' / ')}`, key);
    return text;
  }
  return String(value);
}

function normalizeEnvironmentLayers(definitions, input, environment, secrets) {
  const layers = { values: {}, site: {}, env: {}, cli: {} };
  const current = normalizeSecretEnv(secrets.config[environment]);
  const nextSecrets = { env: { ...current.env }, cli: { ...current.cli } };
  const source = isObject(input) ? input : {};
  const definitionMap = new Map(definitions.map((def) => [def.key, def]));

  for (const layerName of ['values', 'site', 'env', 'cli']) {
    const layer = isObject(source[layerName]) ? source[layerName] : {};
    for (const [key, rawValue] of Object.entries(layer)) {
      const def = definitionMap.get(key);
      if (!def) fail(`配置键 ${key} 没有定义，不能写值`, key);
      if (def.secret && (layerName === 'values' || layerName === 'site')) {
        if (rawValue !== undefined && rawValue !== null && String(rawValue) !== '') {
          fail(`密钥配置项 ${key} 只能放在环境变量或启动参数层`, key);
        }
        continue;
      }
      const value = normalizeValue(def.type, rawValue, key, def.enum);
      if (value === undefined) {
        delete nextSecrets.env[key];
        delete nextSecrets.cli[key];
        continue;
      }
      if (def.secret) {
        nextSecrets[layerName][key] = value;
        layers[layerName][key] = '';
      } else {
        layers[layerName][key] = value;
      }
    }
  }

  definitions.forEach((def) => {
    if (!def.secret) return;
    for (const layerName of ['env', 'cli']) {
      if (layers[layerName][def.key] === undefined) continue;
      const stored = nextSecrets[layerName][def.key];
      if (stored !== undefined) {
        layers[layerName][def.key] = stored;
      } else {
        delete layers[layerName][def.key];
      }
    }
  });

  return { layers, secrets: nextSecrets };
}

function buildEffective(def, environment) {
  const layers = {
    default: def.default,
    generated: environment.values[def.key],
    site: environment.site[def.key],
    env: environment.env[def.key],
    cli: environment.cli[def.key]
  };
  let source = 'missing';
  if (def.secret) {
    /* 密钥只认 env / cli。 */
    layers.default = undefined;
    layers.generated = undefined;
    layers.site = undefined;
    if (layers.env !== undefined && layers.env !== '') source = 'env';
    else if (layers.cli !== undefined && layers.cli !== '') source = 'cli';
  } else {
    if (layers.default !== undefined) source = 'default';
    if (layers.generated !== undefined) source = 'generated';
    if (layers.site !== undefined) source = 'site';
    if (layers.env !== undefined) source = 'env';
    if (layers.cli !== undefined) source = 'cli';
  }
  return {
    source,
    effective: source === 'missing' ? undefined : layers[source],
    layers
  };
}

function derivedDefinitions(backend, secrets) {
  const list = [];
  const custom = Array.isArray(backend.customMiddleware) ? backend.customMiddleware : [];
  custom.forEach((middleware) => {
    const stored = isObject(secrets.custom[middleware.id]) ? secrets.custom[middleware.id] : {};
    (Array.isArray(middleware.fields) ? middleware.fields : []).forEach((field) => {
      const key = Catalog.customKey(middleware.id, field.key);
      const secret = field.secret === true;
      list.push({
        key,
        group: 'middleware',
        type: ['string', 'number', 'bool', 'enum'].includes(field.type) ? field.type : 'string',
        default: secret ? undefined : field.value,
        enum: Array.isArray(field.enum) ? field.enum.map(String) : undefined,
        secret,
        description: `${middleware.name || middleware.id} · ${field.label || field.key}`,
        derived: true,
        middlewareId: middleware.id,
        fieldKey: field.key,
        generatedValue: secret ? stored[field.key] : field.value
      });
    });
  });
  return list;
}

async function buildConfigCenterView(loaded, secrets) {
  const backend = ensureBackend(loaded.project || {});
  const center = isObject(backend.configCenter) ? backend.configCenter : {};
  const definitions = Array.isArray(center.definitions)
    ? center.definitions.map((def) => ({
        key: String(def.key || ''),
        group: Catalog.configGroup(String(def.group || 'backend')) ? String(def.group || 'backend') : 'backend',
        type: ['string', 'number', 'bool', 'enum'].includes(def.type) ? def.type : 'string',
        default: def.default,
        enum: Array.isArray(def.enum) ? def.enum.map(String) : undefined,
        secret: def.secret === true,
        description: String(def.description || '')
      }))
    : [];

  const environments = { dev: { values: {}, site: {}, env: {}, cli: {} }, prod: { values: {}, site: {}, env: {}, cli: {} } };
  if (isObject(center.environments)) {
    ['dev', 'prod'].forEach((name) => {
      const source = isObject(center.environments[name]) ? center.environments[name] : {};
      ['values', 'site', 'env', 'cli'].forEach((layer) => {
        if (isObject(source[layer])) environments[name][layer] = source[layer];
      });
    });
  } else if (isObject(center.values)) {
    environments.dev.values = center.values;
  }

  /* 密钥值从独立文件回填；项目里只保留空占位。 */
  ['dev', 'prod'].forEach((name) => {
    const stored = normalizeSecretEnv(secrets.config[name]);
    ['env', 'cli'].forEach((layerName) => {
      Object.keys(stored[layerName]).forEach((key) => {
        if (environments[name][layerName][key] !== undefined) {
          environments[name][layerName][key] = stored[layerName][key];
        }
      });
    });
  });

  const derived = derivedDefinitions(backend, secrets);
  const all = definitions.concat(derived);
  const current = String(backend.environment || 'dev') === 'prod' ? 'prod' : 'dev';
  const view = all.map((def) => {
    const result = { ...def };
    ['dev', 'prod'].forEach((name) => {
      const environment = environments[name];
      if (def.derived) {
        const layers = {
          default: def.default,
          generated: def.generatedValue,
          site: undefined,
          env: undefined,
          cli: undefined
        };
        const hasGenerated = layers.generated !== undefined && layers.generated !== '';
        result[name] = {
          source: hasGenerated ? 'generated' : (layers.default !== undefined ? 'default' : 'missing'),
          effective: hasGenerated ? layers.generated : layers.default,
          layers
        };
        return;
      }
      result[name] = buildEffective(def, environment);
    });
    return result;
  });

  const middlewareView = buildMiddlewareView({ ...loaded, secrets });
  const builtinSummary = Catalog.BUILTIN_GROUPS.map((group) => {
    const item = middlewareView.groups[group.id];
    return {
      id: group.id,
      label: group.label,
      group: group.group,
      kind: group.kind,
      enabled: item.enabled,
      source: item.enabled ? 'generated' : 'default',
      fields: group.fields.map((field) => ({
        key: field.key,
        label: field.label,
        secret: field.secret === true,
        env: field.secret ? (field.env || Catalog.envNameForBuiltin(group.group, field.key)) : null,
        value: item.enabled ? item.config[field.key] : field.default
      }))
    };
  }).filter((group) => group.enabled);

  return {
    siteId: loaded.site?.siteId || '',
    environment: current,
    groups: Catalog.CONFIG_GROUPS,
    definitions: view,
    environments,
    builtin: builtinSummary
  };
}

export function registerMiddlewareConfigRoutes(app, ctx) {
  app.get('/api/sites/:id/middleware', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    loaded.secrets = await readSecrets(loaded.siteDir);
    return { ok: true, data: buildMiddlewareView(loaded) };
  });

  app.put('/api/sites/:id/middleware', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    const secrets = await readSecrets(loaded.siteDir);
    const body = request.body || {};
    const builtin = normalizeBuiltinGroups(body, secrets);
    const reservedKeys = new Set(
      (Array.isArray(loaded.project?.export?.backend?.configCenter?.definitions)
        ? loaded.project.export.backend.configCenter.definitions
        : []
      ).map((def) => String(def.key || '').toUpperCase())
    );
    const custom = normalizeCustom(body, builtin.secrets, reservedKeys);
    const project = clone(loaded.project || {});
    const backend = ensureBackend(project);

    backend.environment = String(body.environment || backend.environment || 'dev') === 'prod' ? 'prod' : 'dev';
    syncDatabase(backend, builtin.groups);
    syncCache(backend, builtin.groups);
    syncMiddlewareGroups(backend, builtin.groups);
    if (custom.custom !== undefined) backend.customMiddleware = custom.custom;

    await saveProject(ctx, loaded, project);
    await writeSecrets(loaded.siteDir, custom.secrets);

    const exportSecrets = await readExportSecrets(loaded.siteDir);
    const databasePassword = builtin.groups.postgres?.enabled
      ? custom.secrets.builtin.postgres?.password || ''
      : builtin.groups.mysql?.enabled
        ? custom.secrets.builtin.mysql?.password || ''
        : builtin.groups.mariadb?.enabled
          ? custom.secrets.builtin.mysql?.password || ''
          : '';
    await writeExportSecrets(loaded.siteDir, {
      databasePassword: databasePassword || exportSecrets.databasePassword,
      redisPassword: builtin.groups.redis?.enabled
        ? custom.secrets.builtin.redis?.password || ''
        : ''
    });

    loaded.project = project;
    loaded.secrets = custom.secrets;
    return { ok: true, data: buildMiddlewareView(loaded) };
  });

  app.get('/api/sites/:id/config-center', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    const secrets = await readSecrets(loaded.siteDir);
    return { ok: true, data: await buildConfigCenterView(loaded, secrets) };
  });

  app.put('/api/sites/:id/config-center', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    const secrets = await readSecrets(loaded.siteDir);
    const body = request.body || {};
    const environment = String(body.environment || 'dev') === 'prod' ? 'prod' : 'dev';
    const definitions = normalizeDefinitions(body.definitions);

    const existingDerived = derivedDefinitions(
      ensureBackend(loaded.project || {}),
      secrets
    );
    const reserved = new Set(existingDerived.map((def) => def.key));
    definitions.forEach((def) => {
      if (reserved.has(def.key)) fail(`配置键 ${def.key} 与自定义中间件生成的键冲突`, def.key);
    });

    const environments = {};
    const nextConfigSecrets = { ...secrets.config };
    ['dev', 'prod'].forEach((name) => {
      const source = isObject(body.environments) && isObject(body.environments[name])
        ? body.environments[name]
        : {};
      const normalized = normalizeEnvironmentLayers(definitions, source, name, secrets);
      environments[name] = normalized.layers;
      nextConfigSecrets[name] = normalized.secrets;
    });

    const project = clone(loaded.project || {});
    const backend = ensureBackend(project);
    backend.environment = environment;
    backend.configCenter = {
      definitions,
      environments,
      /* 旧代码仍读 values：同步为当前环境的生成层。 */
      values: environments[environment].values
    };

    await saveProject(ctx, loaded, project);
    const nextSecrets = { ...secrets, config: nextConfigSecrets };
    await writeSecrets(loaded.siteDir, nextSecrets);

    loaded.project = project;
    loaded.secrets = nextSecrets;
    return { ok: true, data: await buildConfigCenterView(loaded, nextSecrets) };
  });
}
