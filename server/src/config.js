import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRelPath, resolveWithin } from '../../src/storage/path-safety.js';
import { StorageError, STORAGE_ERRORS } from '../../src/storage/errors.js';

export const PLATFORM_CONFIG_SCHEMA_VERSION = 1;
export const CONTRACTS_VERSION = '2.0.0';
export const PROJECT_SCHEMA_VERSION = 2;

export const DEFAULT_CONFIG = {
  schemaVersion: PLATFORM_CONFIG_SCHEMA_VERSION,
  platform: { name: '低代码工作台', host: '127.0.0.1', port: 9780, openBrowser: true },
  paths: { dataDir: 'data', exportsDir: 'exports', logsDir: 'logs' },
  server: { bodyLimitBytes: 67108864, requestTimeoutMs: 30000, tokenTtlHours: 24 },
  storage: {
    backupKeepCount: 10,
    backupKeepDays: 30,
    versionKeepCount: 100,
    versionKeepDays: 30,
    buildKeepPerTarget: 10,
    siteQuotaBytes: 5368709120,
    lockStaleMs: 60000,
    tmpMaxAgeMs: 3600000
  },
  draftCache: { enabled: false },
  logging: { level: 'info' }
};

/** 由入口文件位置推导平台根（server/index.js → 上一级）。 */
export function resolvePlatformRoot(entryUrl) {
  return path.resolve(path.dirname(fileURLToPath(entryUrl)), '..');
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function collectUnknown(user, defaults, prefix, warnings) {
  if (!user || typeof user !== 'object') return;
  for (const key of Object.keys(user)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in defaults)) {
      warnings.push({ path: nextPath, message: '未知配置项，已保留但不生效' });
      continue;
    }
    const value = user[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && defaults[key] && typeof defaults[key] === 'object') {
      collectUnknown(value, defaults[key], nextPath, warnings);
    }
  }
}

function validatePathField(issues, fieldPath, value) {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push({ path: fieldPath, message: '必须是非空字符串（相对平台根的目录名）' });
    return;
  }
  try {
    normalizeRelPath(value);
  } catch (error) {
    issues.push({ path: fieldPath, message: error.message });
  }
}

function validateConfig(raw) {
  const issues = [];
  const warnings = [];
  const config = deepMerge(DEFAULT_CONFIG, raw || {});

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ path: '(root)', message: '配置必须是 JSON 对象' });
    return { config, issues, warnings };
  }
  if (raw.schemaVersion !== PLATFORM_CONFIG_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `必须为 ${PLATFORM_CONFIG_SCHEMA_VERSION}` });
  }

  const platform = config.platform || {};
  const allowedHosts = ['127.0.0.1', 'localhost', '::1'];
  if (!allowedHosts.includes(platform.host)) {
    issues.push({ path: 'platform.host', message: '只允许 127.0.0.1 / localhost / ::1，不对外监听' });
  }
  if (!Number.isInteger(platform.port) || platform.port < 1024 || platform.port > 65535) {
    issues.push({ path: 'platform.port', message: '必须是 1024–65535 的整数' });
  }
  if (typeof platform.openBrowser !== 'boolean') {
    issues.push({ path: 'platform.openBrowser', message: '必须是布尔值' });
  }

  validatePathField(issues, 'paths.dataDir', config.paths && config.paths.dataDir);
  validatePathField(issues, 'paths.exportsDir', config.paths && config.paths.exportsDir);
  validatePathField(issues, 'paths.logsDir', config.paths && config.paths.logsDir);

  const server = config.server || {};
  if (!Number.isInteger(server.bodyLimitBytes) || server.bodyLimitBytes < 1048576 || server.bodyLimitBytes > 268435456) {
    issues.push({ path: 'server.bodyLimitBytes', message: '必须是 1 MB–256 MB 的整数' });
  }
  if (!Number.isInteger(server.requestTimeoutMs) || server.requestTimeoutMs < 1000) {
    issues.push({ path: 'server.requestTimeoutMs', message: '必须是 ≥1000 的整数' });
  }
  if (!Number.isInteger(server.tokenTtlHours) || server.tokenTtlHours < 1 || server.tokenTtlHours > 168) {
    issues.push({ path: 'server.tokenTtlHours', message: '必须是 1–168 的整数' });
  }

  const storage = config.storage || {};
  if (!Number.isInteger(storage.lockStaleMs) || storage.lockStaleMs < 30000) {
    issues.push({ path: 'storage.lockStaleMs', message: '必须 ≥30000' });
  }
  if (!Number.isInteger(storage.tmpMaxAgeMs) || storage.tmpMaxAgeMs < 60000) {
    issues.push({ path: 'storage.tmpMaxAgeMs', message: '必须 ≥60000' });
  }
  for (const key of ['backupKeepCount', 'backupKeepDays', 'versionKeepCount', 'versionKeepDays', 'buildKeepPerTarget', 'siteQuotaBytes']) {
    if (!Number.isInteger(storage[key]) || storage[key] <= 0) {
      issues.push({ path: `storage.${key}`, message: '必须是正整数' });
    }
  }
  if (typeof config.draftCache?.enabled !== 'boolean') {
    issues.push({ path: 'draftCache.enabled', message: '必须是布尔值' });
  }

  collectUnknown(raw, DEFAULT_CONFIG, '', warnings);
  return { config, issues, warnings };
}

export class ConfigError extends StorageError {
  constructor(issues) {
    super(STORAGE_ERRORS.CONFIG_INVALID, 'platform.config.json 校验失败', { issues });
    this.issues = issues;
  }
}

/**
 * 读取并校验 platform.config.json。
 * 失败抛 ConfigError；调用方负责写 logs/boot-error.json 并以退出码 2 结束。
 */
export function loadPlatformConfig(platformRoot) {
  const file = path.join(platformRoot, 'platform.config.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ConfigError([
      { path: file, message: error.code === 'ENOENT' ? '配置文件不存在' : `无法读取：${error.message}` }
    ]);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError([{ path: file, message: `JSON 解析失败：${error.message}` }]);
  }

  const { config, issues, warnings } = validateConfig(raw);
  if (issues.length) throw new ConfigError(issues);

  // 解析成绝对路径，并确认仍在平台根内
  const paths = {
    platformRoot,
    dataDir: resolveWithin(platformRoot, config.paths.dataDir),
    exportsDir: resolveWithin(platformRoot, config.paths.exportsDir),
    logsDir: resolveWithin(platformRoot, config.paths.logsDir),
    lockStaleMs: config.storage.lockStaleMs,
    buildKeepPerTarget: config.storage.buildKeepPerTarget
  };

  return { config, paths, warnings, file };
}
