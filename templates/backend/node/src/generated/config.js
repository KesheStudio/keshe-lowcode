// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 要改业务逻辑请去 src/custom/；要加接口请改 src/custom/routes.js。
import fs from 'node:fs'
import path from 'node:path'
import { createConfigCenter } from './config-center.js'

export class ConfigError extends Error {
  constructor(message, field = '') {
    super(message)
    this.name = 'ConfigError'
    this.code = 'LC_E_CONFIG_INVALID'
    this.field = field
  }
}

export const DEFAULTS = {
  schemaVersion: 1,
  language: 'node',
  maturity: 'full',
  strict: true,
  override: false,
  host: '127.0.0.1',
  port: 8080,
  logLevel: 'info',
  cors: {
    enabled: true,
    origins: [],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    headers: ['content-type', 'authorization', 'x-request-id'],
    credentials: false,
    maxAge: 600
  },
  database: {
    driver: 'sqlite',
    url: 'sqlite://data/app.db',
    host: '127.0.0.1',
    port: 0,
    name: 'app',
    user: '',
    password: '',
    sslMode: 'disable',
    maxOpenConns: 10,
    connectTimeoutSeconds: 5
  },
  cache: {
    enabled: true,
    fallback: 'memory',
    driver: 'memory',
    url: 'redis://127.0.0.1:16379/0',
    ttlSeconds: 30,
    keyPrefix: 'lc:'
  },
  middleware: {
    requestId: true,
    logging: true,
    bodyLimit: { enabled: true, maxBytes: 1048576 },
    timeout: { enabled: true, seconds: 30 },
    concurrency: { enabled: false, maxInFlight: 64 },
    compression: { enabled: true, gzip: true, brotli: true, minBytes: 1024 },
    rateLimit: { enabled: false, rps: 20 },
    staticCache: { enabled: true, maxAgeSeconds: 3600, immutableMaxAgeSeconds: 31536000 },
    health: { enabled: true, readinessRequiresDatabase: true, readinessRequiresCache: false },
    builtin: {},
    securityHeaders: {
      enabled: true,
      hsts: { enabled: false, maxAgeSeconds: 31536000, includeSubdomains: true, preload: false },
      contentTypeOptions: 'nosniff',
      frameOptions: 'SAMEORIGIN',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: 'geolocation=(), microphone=(), camera=()',
      crossOriginOpenerPolicy: 'same-origin'
    }
  },
  static: {
    enabled: false,
    root: '../web'
  },
  auth: {
    tokenMode: 'jwt',
    jwtSecret: '',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    sessionTtlSeconds: 28800,
    maxLoginFailures: 5,
    failureWindowSeconds: 300,
    lockSeconds: 900,
    bootstrap: { username: '', password: '', role: 'admin' }
  },
  dataApi: {
    enabled: true,
    publicRead: true,
    writeRequiresAuth: true,
    writeRoles: [],
    maxPageSize: 100,
    collectionsDir: '../web/data/collections'
  },
  configCenter: {
    definitions: [],
    values: {}
  }
}

const ALLOWED_KEYS = {
  '': ['schemaVersion', 'language', 'maturity', 'strict', 'override', 'host', 'port', 'logLevel', 'cors', 'database', 'cache', 'middleware', 'static', 'auth', 'dataApi', 'configCenter'],
  cors: ['enabled', 'origins', 'methods', 'headers', 'credentials', 'maxAge'],
  database: ['driver', 'url', 'host', 'port', 'name', 'user', 'password', 'sslMode', 'maxOpenConns', 'connectTimeoutSeconds'],
  cache: ['enabled', 'fallback', 'driver', 'url', 'ttlSeconds', 'keyPrefix'],
  middleware: [
    'requestId', 'logging', 'bodyLimit', 'timeout', 'concurrency', 'compression',
    'rateLimit', 'staticCache', 'health', 'securityHeaders', 'builtin'
  ],
  configCenter: ['definitions', 'values'],
  'middleware.bodyLimit': ['enabled', 'maxBytes'],
  'middleware.timeout': ['enabled', 'seconds'],
  'middleware.concurrency': ['enabled', 'maxInFlight'],
  'middleware.compression': ['enabled', 'gzip', 'brotli', 'minBytes'],
  'middleware.rateLimit': ['enabled', 'rps'],
  'middleware.staticCache': ['enabled', 'maxAgeSeconds', 'immutableMaxAgeSeconds'],
  'middleware.health': ['enabled', 'readinessRequiresDatabase', 'readinessRequiresCache'],
  'middleware.securityHeaders': [
    'enabled', 'hsts', 'contentTypeOptions', 'frameOptions', 'referrerPolicy',
    'permissionsPolicy', 'crossOriginOpenerPolicy'
  ],
  'middleware.securityHeaders.hsts': ['enabled', 'maxAgeSeconds', 'includeSubdomains', 'preload'],
  static: ['enabled', 'root'],
  auth: ['tokenMode', 'jwtSecret', 'accessTokenTtlSeconds', 'refreshTokenTtlSeconds', 'sessionTtlSeconds', 'maxLoginFailures', 'failureWindowSeconds', 'lockSeconds', 'bootstrap'],
  'auth.bootstrap': ['username', 'password', 'role'],
  dataApi: ['enabled', 'publicRead', 'writeRequiresAuth', 'writeRoles', 'maxPageSize', 'collectionsDir']
}

const LANGUAGES = ['rust', 'node', 'go']
const MATURITIES = ['full', 'usable', 'minimal']
const LOG_LEVELS = ['debug', 'info', 'warn', 'error']

export function databaseUrlScheme(url) {
  if (typeof url !== 'string' || url === '') return null
  const match = /^(sqlite|mysql|postgres|postgresql):\/\//.exec(url)
  if (!match) return null
  return match[1] === 'postgresql' ? 'postgres' : match[1]
}

// ---------------------------------------------------------------- 配置加载

export function loadConfig({ argv = process.argv, env = process.env, cwd = process.cwd() } = {}) {
  const cli = parseCli(argv)
  const configPath = resolveConfigPath(cli, env, cwd)
  const sources = {
    generated: null,
    user: null,
    env: [],
    cli: []
  }
  const warnings = []

  const userRaw = readIfExists(configPath)
  const userCfg = userRaw ? parseConfigText(userRaw, configPath) : {}

  const override = cli.override === true || envFlag(env.LC_OVERRIDE, 'LC_OVERRIDE') === true || userCfg.override === true
  if (override) sources.override = true

  let cfg = structuredClone(DEFAULTS)
  cfg.language = DEFAULTS.language
  cfg.maturity = DEFAULTS.maturity

  const generatedPath = firstExisting([
    path.join(path.dirname(configPath), 'config.generated.yaml'),
    path.join(path.dirname(configPath), 'config.generated.json')
  ])
  let generatedCfg = {}
  if (!override && generatedPath) {
    generatedCfg = parseConfigText(readIfExists(generatedPath), generatedPath)
    cfg = merge(cfg, generatedCfg)
    sources.generated = generatedPath
  }
  if (userRaw) {
    cfg = merge(cfg, userCfg)
    sources.user = configPath
  }

  applyEnv(cfg, env, sources.env)
  applyCli(cfg, cli, sources.cli)
  normalizeMiddlewareShapes(cfg, warnings)

  // 两套配置：内置中间件预设组（按开关映射到数据库/缓存层）+ 自定义配置项。
  const configCenter = createConfigCenter(
    cfg,
    { generated: generatedCfg, user: userCfg },
    env,
    cli.cfg || {},
    ConfigError,
    warnings
  )

  // URL 的 scheme 决定实际驱动；与 database.driver 冲突时以 URL 为准并告警。
  const scheme = databaseUrlScheme(cfg.database.url)
  if (scheme && scheme !== cfg.database.driver) {
    warnings.push(`database.url 的 scheme=${scheme} 与 database.driver=${cfg.database.driver} 不一致；按 URL 使用 ${scheme}`)
    cfg.database.driver = scheme
  }

  validate(cfg, { strict: cfg.strict, warnings })
  if (cfg.language !== DEFAULTS.language) {
    warnings.push(`配置文件声明 language=${cfg.language}，与本模板 node 不一致；运行时以模板为准`)
  }
  cfg.language = DEFAULTS.language
  cfg.maturity = DEFAULTS.maturity

  return { config: cfg, warnings, sources, configCenter, command: cli.command || 'serve' }
}

// 兼容旧写法：compression / securityHeaders 允许直接写 true/false，
// 内部统一成 { enabled, ...默认参数 }，避免旧 config.yaml 直接报未知结构。
function normalizeMiddlewareShapes(cfg, warnings) {
  for (const key of ['compression', 'securityHeaders']) {
    if (typeof cfg.middleware[key] === 'boolean') {
      const enabled = cfg.middleware[key]
      cfg.middleware[key] = merge(structuredClone(DEFAULTS.middleware[key]), { enabled })
      warnings.push(`middleware.${key} 使用了简写布尔值，已按 ${enabled ? '开启' : '关闭'} 并套用默认参数`)
    }
  }
}

function parseCli(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--override') {
      out.override = true
      continue
    }
    if (arg === '--migrate') {
      out.command = 'migrate'
      continue
    }
    if (arg === '--migrate-down') {
      out.command = 'migrate-down'
      continue
    }
    if (arg === '--cfg') {
      const spec = argv[++i]
      if (!spec || spec.startsWith('--')) throw new ConfigError('启动参数 --cfg 缺少 KEY=VALUE', 'argv')
      const eq = spec.indexOf('=')
      if (eq <= 0) throw new ConfigError(`启动参数 --cfg 必须是 KEY=VALUE：${spec}`, 'argv')
      out.cfg = out.cfg || {}
      out.cfg[spec.slice(0, eq).trim()] = spec.slice(eq + 1)
      continue
    }
    if (!arg.startsWith('--')) throw new ConfigError(`无法识别的启动参数：${arg}`, 'argv')
    const key = arg.slice(2)
    if (!['host', 'port', 'log-level', 'config', 'body-limit-bytes', 'timeout-seconds', 'cache-enabled'].includes(key)) {
      throw new ConfigError(
        `未知启动参数：--${key}，可用：--host --port --log-level --config --body-limit-bytes --timeout-seconds --cache-enabled --cfg KEY=VALUE --override --migrate --migrate-down`,
        'argv'
      )
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new ConfigError(`启动参数 --${key} 缺少值`, 'argv')
    i++
    const mapped = {
      'log-level': 'logLevel',
      'body-limit-bytes': 'bodyLimitBytes',
      'timeout-seconds': 'timeoutSeconds',
      'cache-enabled': 'cacheEnabled'
    }[key] || key
    out[mapped] = value
  }
  return out
}

function resolveConfigPath(cli, env, cwd) {
  const explicit = cli.config || env.LC_CONFIG_FILE
  if (explicit) {
    const resolved = path.resolve(cwd, explicit)
    if (!fs.existsSync(resolved)) throw new ConfigError(`指定的配置文件不存在：${resolved}`, 'config')
    return resolved
  }
  const deployDir = path.resolve(cwd, '..', 'deploy', 'backend')
  if (fs.existsSync(deployDir)) {
    // 目录存在但用户文件还没写时，仍然从这个目录读 config.generated.yaml
    return path.join(deployDir, 'config.yaml')
  }
  return path.resolve(cwd, 'config.yaml')
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

function firstExisting(list) {
  return list.find((p) => fs.existsSync(p)) || null
}

function applyEnv(cfg, env, used) {
  const set = (key, fn) => {
    if (env[key] === undefined || env[key] === '') return
    fn(env[key])
    used.push(key)
  }
  set('LC_HOST', (v) => { cfg.host = v })
  set('LC_PORT', (v) => { cfg.port = integer(v, 'LC_PORT') })
  set('LC_LOG_LEVEL', (v) => { cfg.logLevel = v })
  set('LC_CORS_ORIGINS', (v) => {
    cfg.cors.origins = v.split(',').map((s) => s.trim()).filter(Boolean)
  })
  set('DATABASE_URL', (v) => { cfg.database.url = v })
  set('LC_DB_DRIVER', (v) => { cfg.database.driver = v })
  set('LC_DB_HOST', (v) => { cfg.database.host = v })
  set('LC_DB_PORT', (v) => { cfg.database.port = integer(v, 'LC_DB_PORT') })
  set('LC_DB_NAME', (v) => { cfg.database.name = v })
  set('LC_DB_USER', (v) => { cfg.database.user = v })
  set('LC_DB_PASSWORD', (v) => { cfg.database.password = v })
  set('LC_DB_SSL_MODE', (v) => { cfg.database.sslMode = v })
  set('LC_DB_MAX_OPEN_CONNS', (v) => { cfg.database.maxOpenConns = integer(v, 'LC_DB_MAX_OPEN_CONNS') })
  set('LC_DB_CONNECT_TIMEOUT', (v) => { cfg.database.connectTimeoutSeconds = integer(v, 'LC_DB_CONNECT_TIMEOUT') })
  set('LC_CACHE_ENABLED', (v) => { cfg.cache.enabled = envFlag(v, 'LC_CACHE_ENABLED') })
  set('LC_CACHE_FALLBACK', (v) => { cfg.cache.fallback = v })
  set('LC_CACHE_DRIVER', (v) => { cfg.cache.driver = v })
  set('REDIS_URL', (v) => { cfg.cache.url = v })
  set('LC_CACHE_TTL_SECONDS', (v) => { cfg.cache.ttlSeconds = integer(v, 'LC_CACHE_TTL_SECONDS') })
  set('LC_MW_REQUEST_ID', (v) => { cfg.middleware.requestId = envFlag(v, 'LC_MW_REQUEST_ID') })
  set('LC_MW_LOGGING', (v) => { cfg.middleware.logging = envFlag(v, 'LC_MW_LOGGING') })
  set('LC_MW_BODY_LIMIT_ENABLED', (v) => { cfg.middleware.bodyLimit.enabled = envFlag(v, 'LC_MW_BODY_LIMIT_ENABLED') })
  set('LC_MW_BODY_LIMIT_BYTES', (v) => { cfg.middleware.bodyLimit.maxBytes = integer(v, 'LC_MW_BODY_LIMIT_BYTES') })
  set('LC_MW_TIMEOUT_ENABLED', (v) => { cfg.middleware.timeout.enabled = envFlag(v, 'LC_MW_TIMEOUT_ENABLED') })
  set('LC_MW_TIMEOUT_SECONDS', (v) => { cfg.middleware.timeout.seconds = integer(v, 'LC_MW_TIMEOUT_SECONDS') })
  set('LC_MW_CONCURRENCY_ENABLED', (v) => { cfg.middleware.concurrency.enabled = envFlag(v, 'LC_MW_CONCURRENCY_ENABLED') })
  set('LC_MW_MAX_IN_FLIGHT', (v) => { cfg.middleware.concurrency.maxInFlight = integer(v, 'LC_MW_MAX_IN_FLIGHT') })
  set('LC_MW_COMPRESSION_ENABLED', (v) => { cfg.middleware.compression.enabled = envFlag(v, 'LC_MW_COMPRESSION_ENABLED') })
  set('LC_MW_COMPRESSION_GZIP', (v) => { cfg.middleware.compression.gzip = envFlag(v, 'LC_MW_COMPRESSION_GZIP') })
  set('LC_MW_COMPRESSION_BROTLI', (v) => { cfg.middleware.compression.brotli = envFlag(v, 'LC_MW_COMPRESSION_BROTLI') })
  set('LC_MW_RATE_LIMIT_ENABLED', (v) => { cfg.middleware.rateLimit.enabled = envFlag(v, 'LC_MW_RATE_LIMIT_ENABLED') })
  set('LC_MW_RATE_LIMIT_RPS', (v) => { cfg.middleware.rateLimit.rps = integer(v, 'LC_MW_RATE_LIMIT_RPS') })
  set('LC_MW_STATIC_CACHE_ENABLED', (v) => { cfg.middleware.staticCache.enabled = envFlag(v, 'LC_MW_STATIC_CACHE_ENABLED') })
  set('LC_MW_STATIC_MAX_AGE', (v) => { cfg.middleware.staticCache.maxAgeSeconds = integer(v, 'LC_MW_STATIC_MAX_AGE') })
  set('LC_MW_HEALTH_ENABLED', (v) => { cfg.middleware.health.enabled = envFlag(v, 'LC_MW_HEALTH_ENABLED') })
  set('LC_MW_SECURITY_HEADERS_ENABLED', (v) => { cfg.middleware.securityHeaders.enabled = envFlag(v, 'LC_MW_SECURITY_HEADERS_ENABLED') })
  set('LC_MW_HSTS_ENABLED', (v) => { cfg.middleware.securityHeaders.hsts.enabled = envFlag(v, 'LC_MW_HSTS_ENABLED') })
  set('LC_STATIC_ENABLED', (v) => { cfg.static.enabled = envFlag(v, 'LC_STATIC_ENABLED') })
  set('LC_AUTH_TOKEN_MODE', (v) => { cfg.auth.tokenMode = v })
  set('LC_AUTH_JWT_SECRET', (v) => { cfg.auth.jwtSecret = v })
  set('LC_AUTH_ACCESS_TTL_SECONDS', (v) => { cfg.auth.accessTokenTtlSeconds = integer(v, 'LC_AUTH_ACCESS_TTL_SECONDS') })
  set('LC_AUTH_REFRESH_TTL_SECONDS', (v) => { cfg.auth.refreshTokenTtlSeconds = integer(v, 'LC_AUTH_REFRESH_TTL_SECONDS') })
  set('LC_AUTH_SESSION_TTL_SECONDS', (v) => { cfg.auth.sessionTtlSeconds = integer(v, 'LC_AUTH_SESSION_TTL_SECONDS') })
  set('LC_AUTH_MAX_LOGIN_FAILURES', (v) => { cfg.auth.maxLoginFailures = integer(v, 'LC_AUTH_MAX_LOGIN_FAILURES') })
  set('LC_AUTH_LOCK_SECONDS', (v) => { cfg.auth.lockSeconds = integer(v, 'LC_AUTH_LOCK_SECONDS') })
  set('LC_AUTH_BOOTSTRAP_USERNAME', (v) => { cfg.auth.bootstrap.username = v })
  set('LC_AUTH_BOOTSTRAP_PASSWORD', (v) => { cfg.auth.bootstrap.password = v })
  set('LC_AUTH_BOOTSTRAP_ROLE', (v) => { cfg.auth.bootstrap.role = v })
  set('LC_DATA_API_ENABLED', (v) => { cfg.dataApi.enabled = envFlag(v, 'LC_DATA_API_ENABLED') })
  set('LC_DATA_PUBLIC_READ', (v) => { cfg.dataApi.publicRead = envFlag(v, 'LC_DATA_PUBLIC_READ') })
  set('LC_DATA_WRITE_REQUIRES_AUTH', (v) => { cfg.dataApi.writeRequiresAuth = envFlag(v, 'LC_DATA_WRITE_REQUIRES_AUTH') })
  set('LC_DATA_WRITE_ROLES', (v) => {
    cfg.dataApi.writeRoles = v.split(',').map((s) => s.trim()).filter(Boolean)
  })
  set('LC_DATA_MAX_PAGE_SIZE', (v) => { cfg.dataApi.maxPageSize = integer(v, 'LC_DATA_MAX_PAGE_SIZE') })
  set('LC_DATA_COLLECTIONS_DIR', (v) => { cfg.dataApi.collectionsDir = v })
}

function applyCli(cfg, cli, used) {
  if (cli.host !== undefined) cfg.host = cli.host
  if (cli.port !== undefined) cfg.port = integer(cli.port, '--port')
  if (cli.logLevel !== undefined) cfg.logLevel = cli.logLevel
  if (cli.bodyLimitBytes !== undefined) {
    cfg.middleware.bodyLimit.enabled = true
    cfg.middleware.bodyLimit.maxBytes = integer(cli.bodyLimitBytes, '--body-limit-bytes')
  }
  if (cli.timeoutSeconds !== undefined) {
    cfg.middleware.timeout.enabled = true
    cfg.middleware.timeout.seconds = integer(cli.timeoutSeconds, '--timeout-seconds')
  }
  if (cli.cacheEnabled !== undefined) {
    cfg.cache.enabled = envFlag(cli.cacheEnabled, '--cache-enabled')
  }
  if (cli.override === true) cfg.override = true
  const display = {
    host: '--host',
    port: '--port',
    logLevel: '--log-level',
    bodyLimitBytes: '--body-limit-bytes',
    timeoutSeconds: '--timeout-seconds',
    cacheEnabled: '--cache-enabled'
  }
  for (const [key, name] of Object.entries(display)) {
    if (cli[key] !== undefined && !used.includes(name)) used.push(name)
  }
  for (const key of Object.keys(cli.cfg || {})) {
    const name = `cfg:${key}`
    if (!used.includes(name)) used.push(name)
  }
}

function envFlag(value, name) {
  if (value === undefined || value === '') return undefined
  const v = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  throw new ConfigError(`${name} 只能是 true/false，收到：${value}`, name)
}

function integer(value, name) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new ConfigError(`${name} 必须是整数，收到：${value}`, name)
  return n
}

// ---------------------------------------------------------------- 校验

function validate(cfg, { strict, warnings }) {
  if (!isPlainObject(cfg)) throw new ConfigError('配置根节点必须是映射（key: value）', '')

  const unknown = []
  collectUnknown(cfg, '', ALLOWED_KEYS, unknown)
  if (unknown.length) {
    if (strict) throw new ConfigError(`未知配置项：${unknown.join('、')}`, unknown[0])
    warnings.push(`未知配置项被忽略：${unknown.join('、')}`)
    for (const key of unknown) deleteByPath(cfg, key)
  }

  if (cfg.schemaVersion !== 1) throw new ConfigError(`schemaVersion 必须为 1，收到：${cfg.schemaVersion}`, 'schemaVersion')
  if (!LANGUAGES.includes(cfg.language)) throw new ConfigError(`language 只能是 ${LANGUAGES.join(' / ')}`, 'language')
  if (!MATURITIES.includes(cfg.maturity)) throw new ConfigError(`maturity 只能是 ${MATURITIES.join(' / ')}`, 'maturity')
  expectBool(cfg, 'strict', 'strict')
  expectBool(cfg, 'override', 'override')
  if (typeof cfg.host !== 'string' || cfg.host.trim() === '') throw new ConfigError('host 必须是非空字符串', 'host')
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) {
    throw new ConfigError(`port 必须是 1024-65535 的整数，收到：${cfg.port}`, 'port')
  }
  if (!LOG_LEVELS.includes(cfg.logLevel)) throw new ConfigError(`logLevel 只能是 ${LOG_LEVELS.join(' / ')}`, 'logLevel')

  const integerRange = (value, field, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ConfigError(`${field} 必须是 ${min}-${max} 的整数`, field)
    }
  }

  expectObject(cfg, 'cors', 'cors')
  expectBool(cfg.cors, 'enabled', 'cors.enabled')
  expectBool(cfg.cors, 'credentials', 'cors.credentials')
  const origins = expectStringArray(cfg.cors, 'origins', 'cors.origins')
  expectStringArray(cfg.cors, 'methods', 'cors.methods')
  expectStringArray(cfg.cors, 'headers', 'cors.headers')
  if (!Number.isInteger(cfg.cors.maxAge) || cfg.cors.maxAge < 0 || cfg.cors.maxAge > 86400) {
    throw new ConfigError('cors.maxAge 必须是 0-86400 的整数', 'cors.maxAge')
  }
  if (cfg.cors.credentials && origins.includes('*')) {
    throw new ConfigError('cors.credentials 为 true 时 origins 不能包含 *', 'cors.origins')
  }

  expectObject(cfg, 'database', 'database')
  const db = cfg.database
  if (!['sqlite', 'mysql', 'postgres'].includes(db.driver)) {
    throw new ConfigError('database.driver 只能是 sqlite / mysql / postgres', 'database.driver')
  }
  if (typeof db.url !== 'string') throw new ConfigError('database.url 必须是字符串（留空表示用分项字段拼装）', 'database.url')
  if (db.url !== '' && !/^(sqlite|mysql|postgres|postgresql):\/\//.test(db.url)) {
    throw new ConfigError('database.url 必须以 sqlite:// / mysql:// / postgres:// 开头，或留空', 'database.url')
  }
  if (typeof db.host !== 'string' || db.host.trim() === '') throw new ConfigError('database.host 必须是非空字符串', 'database.host')
  if (!Number.isInteger(db.port) || db.port < 0 || db.port > 65535) {
    throw new ConfigError('database.port 必须是 0-65535 的整数（0 表示按驱动默认）', 'database.port')
  }
  if (typeof db.name !== 'string' || db.name.trim() === '') throw new ConfigError('database.name 必须是非空字符串', 'database.name')
  if (typeof db.user !== 'string') throw new ConfigError('database.user 必须是字符串', 'database.user')
  if (typeof db.password !== 'string') throw new ConfigError('database.password 必须是字符串（建议改用 LC_DB_PASSWORD）', 'database.password')
  if (!['disable', 'require'].includes(db.sslMode)) {
    throw new ConfigError('database.sslMode 只能是 disable / require', 'database.sslMode')
  }
  if (!Number.isInteger(db.maxOpenConns) || db.maxOpenConns < 1 || db.maxOpenConns > 100) {
    throw new ConfigError('database.maxOpenConns 必须是 1-100 的整数', 'database.maxOpenConns')
  }
  if (!Number.isInteger(db.connectTimeoutSeconds) || db.connectTimeoutSeconds < 1 || db.connectTimeoutSeconds > 60) {
    throw new ConfigError('database.connectTimeoutSeconds 必须是 1-60 的整数', 'database.connectTimeoutSeconds')
  }

  expectObject(cfg, 'cache', 'cache')
  expectBool(cfg.cache, 'enabled', 'cache.enabled')
  if (!['memory', 'none'].includes(cfg.cache.fallback)) {
    throw new ConfigError('cache.fallback 只能是 memory / none（缓存关闭或 Redis 不可用时的回退目标）', 'cache.fallback')
  }
  if (!['none', 'memory', 'redis'].includes(cfg.cache.driver)) {
    throw new ConfigError('cache.driver 只能是 none / memory / redis', 'cache.driver')
  }
  if (typeof cfg.cache.url !== 'string') {
    throw new ConfigError('cache.url 必须是字符串', 'cache.url')
  }
  if (cfg.cache.driver === 'redis' && cfg.cache.url.trim() === '') {
    throw new ConfigError('cache.driver=redis 时 cache.url 不能为空，例如 redis://127.0.0.1:16379/0', 'cache.url')
  }
  if (!Number.isInteger(cfg.cache.ttlSeconds) || cfg.cache.ttlSeconds < 1 || cfg.cache.ttlSeconds > 86400) {
    throw new ConfigError('cache.ttlSeconds 必须是 1-86400 的整数', 'cache.ttlSeconds')
  }
  if (typeof cfg.cache.keyPrefix !== 'string' || cfg.cache.keyPrefix.trim() === '') {
    throw new ConfigError('cache.keyPrefix 必须是非空字符串', 'cache.keyPrefix')
  }

  expectObject(cfg, 'middleware', 'middleware')
  for (const key of ['requestId', 'logging']) {
    expectBool(cfg.middleware, key, `middleware.${key}`)
  }
  for (const key of ['bodyLimit', 'timeout', 'concurrency', 'compression', 'rateLimit', 'staticCache', 'health', 'securityHeaders']) {
    expectObject(cfg.middleware, key, `middleware.${key}`)
  }
  for (const key of ['bodyLimit', 'timeout', 'concurrency', 'compression', 'rateLimit', 'staticCache', 'health', 'securityHeaders']) {
    expectBool(cfg.middleware[key], 'enabled', `middleware.${key}.enabled`)
  }

  const mw = cfg.middleware
  integerRange(mw.bodyLimit.maxBytes, 'middleware.bodyLimit.maxBytes', 1024, 268435456)
  integerRange(mw.timeout.seconds, 'middleware.timeout.seconds', 1, 600)
  integerRange(mw.concurrency.maxInFlight, 'middleware.concurrency.maxInFlight', 1, 10000)
  integerRange(mw.rateLimit.rps, 'middleware.rateLimit.rps', 1, 10000)
  integerRange(mw.compression.minBytes, 'middleware.compression.minBytes', 0, 1048576)
  for (const key of ['gzip', 'brotli']) expectBool(mw.compression, key, `middleware.compression.${key}`)
  if (mw.compression.enabled && !mw.compression.gzip && !mw.compression.brotli) {
    throw new ConfigError('middleware.compression 开启时 gzip / brotli 至少要选一种', 'middleware.compression')
  }
  integerRange(mw.staticCache.maxAgeSeconds, 'middleware.staticCache.maxAgeSeconds', 0, 31536000)
  integerRange(mw.staticCache.immutableMaxAgeSeconds, 'middleware.staticCache.immutableMaxAgeSeconds', 0, 31536000)
  expectBool(mw.health, 'readinessRequiresDatabase', 'middleware.health.readinessRequiresDatabase')
  expectBool(mw.health, 'readinessRequiresCache', 'middleware.health.readinessRequiresCache')

  expectObject(mw.securityHeaders, 'hsts', 'middleware.securityHeaders.hsts')
  expectBool(mw.securityHeaders.hsts, 'enabled', 'middleware.securityHeaders.hsts.enabled')
  integerRange(mw.securityHeaders.hsts.maxAgeSeconds, 'middleware.securityHeaders.hsts.maxAgeSeconds', 0, 31536000)
  expectBool(mw.securityHeaders.hsts, 'includeSubdomains', 'middleware.securityHeaders.hsts.includeSubdomains')
  expectBool(mw.securityHeaders.hsts, 'preload', 'middleware.securityHeaders.hsts.preload')
  for (const key of ['contentTypeOptions', 'frameOptions', 'referrerPolicy', 'permissionsPolicy', 'crossOriginOpenerPolicy']) {
    if (typeof mw.securityHeaders[key] !== 'string') {
      throw new ConfigError(`middleware.securityHeaders.${key} 必须是字符串（留空表示不发送该头）`, `middleware.securityHeaders.${key}`)
    }
  }

  expectObject(cfg, 'static', 'static')
  expectBool(cfg.static, 'enabled', 'static.enabled')
  if (typeof cfg.static.root !== 'string' || cfg.static.root.trim() === '') {
    throw new ConfigError('static.root 必须是非空字符串', 'static.root')
  }

  expectObject(cfg, 'auth', 'auth')
  const auth = cfg.auth
  if (!['jwt', 'session'].includes(auth.tokenMode)) {
    throw new ConfigError('auth.tokenMode 只能是 jwt / session', 'auth.tokenMode')
  }
  if (typeof auth.jwtSecret !== 'string') throw new ConfigError('auth.jwtSecret 必须是字符串', 'auth.jwtSecret')
  integerRange(auth.accessTokenTtlSeconds, 'auth.accessTokenTtlSeconds', 60, 86400)
  integerRange(auth.refreshTokenTtlSeconds, 'auth.refreshTokenTtlSeconds', 3600, 2592000)
  integerRange(auth.sessionTtlSeconds, 'auth.sessionTtlSeconds', 60, 2592000)
  integerRange(auth.maxLoginFailures, 'auth.maxLoginFailures', 1, 100)
  integerRange(auth.failureWindowSeconds, 'auth.failureWindowSeconds', 10, 86400)
  integerRange(auth.lockSeconds, 'auth.lockSeconds', 10, 86400)
  expectObject(auth, 'bootstrap', 'auth.bootstrap')
  for (const key of ['username', 'password', 'role']) {
    if (typeof auth.bootstrap[key] !== 'string') {
      throw new ConfigError(`auth.bootstrap.${key} 必须是字符串`, `auth.bootstrap.${key}`)
    }
  }

  expectObject(cfg, 'dataApi', 'dataApi')
  const dataApi = cfg.dataApi
  for (const key of ['enabled', 'publicRead', 'writeRequiresAuth']) {
    expectBool(dataApi, key, `dataApi.${key}`)
  }
  expectStringArray(dataApi, 'writeRoles', 'dataApi.writeRoles')
  integerRange(dataApi.maxPageSize, 'dataApi.maxPageSize', 1, 1000)
  if (typeof dataApi.collectionsDir !== 'string' || dataApi.collectionsDir.trim() === '') {
    throw new ConfigError('dataApi.collectionsDir 必须是非空字符串', 'dataApi.collectionsDir')
  }

  expectObject(cfg.middleware, 'builtin', 'middleware.builtin')
  expectObject(cfg, 'configCenter', 'configCenter')
  if (!Array.isArray(cfg.configCenter.definitions)) {
    throw new ConfigError('configCenter.definitions 必须是列表', 'configCenter.definitions')
  }
  expectObject(cfg.configCenter, 'values', 'configCenter.values')
}

function collectUnknown(node, prefix, schema, out) {
  // 这两处是开放命名空间：内置中间件按预设组校验，自定义配置项由配置中心校验。
  if (prefix === 'middleware.builtin' || prefix === 'configCenter.values' || prefix === 'configCenter.definitions') return
  const allowed = schema[prefix]
  if (!allowed) return
  for (const key of Object.keys(node)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (!allowed.includes(key)) {
      out.push(full)
      continue
    }
    if (isPlainObject(node[key]) && schema[full]) collectUnknown(node[key], full, schema, out)
  }
}

function deleteByPath(obj, dotted) {
  const parts = dotted.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) return
    cur = cur[parts[i]]
  }
  delete cur[parts[parts.length - 1]]
}

function expectBool(obj, key, field) {
  if (typeof obj[key] !== 'boolean') throw new ConfigError(`${field} 必须是 true/false`, field)
}

function expectObject(obj, key, field) {
  if (!isPlainObject(obj[key])) throw new ConfigError(`${field} 必须是映射`, field)
}

function expectStringArray(obj, key, field) {
  const value = obj[key]
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ConfigError(`${field} 必须是字符串列表`, field)
  }
  return value
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function merge(base, over) {
  for (const [key, value] of Object.entries(over)) {
    if (isPlainObject(value) && isPlainObject(base[key])) base[key] = merge(base[key], value)
    else base[key] = structuredClone(value)
  }
  return base
}

// ---------------------------------------------------------------- YAML 子集 / JSON

export function parseConfigText(text, file) {
  const body = text.replace(/^\uFEFF/, '').trim()
  if (body === '') return {}
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      return JSON.parse(body)
    } catch (err) {
      throw new ConfigError(`${file} 不是合法 JSON：${err.message}`, 'config')
    }
  }
  try {
    return parseYaml(text, file)
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(`${file} 解析失败：${err.message}`, 'config')
  }
}

function parseYaml(text, file) {
  const lines = []
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')
  rawLines.forEach((raw, index) => {
    const lineNo = index + 1
    const indentRaw = (raw.match(/^[ \t]*/) || [''])[0]
    if (indentRaw.includes('\t')) throw new ConfigError(`${file}:${lineNo} 缩进只能用空格`, 'config')
    const indent = indentRaw.length
    const content = stripComment(raw.slice(indent)).trimEnd()
    if (content === '') return
    lines.push({ indent, text: content, lineNo })
  })
  if (lines.length === 0) return null

  let i = 0
  const fail = (line, message) => new ConfigError(`${file}:${line.lineNo} ${message}`, 'config')

  function parseBlock(indent) {
    if (i >= lines.length) return null
    if (lines[i].indent !== indent) throw fail(lines[i], `缩进不一致，期望 ${indent} 个空格`)
    return lines[i].text === '-' || lines[i].text.startsWith('- ') ? parseSeq(indent) : parseMap(indent)
  }

  function parseMap(indent) {
    const obj = {}
    while (i < lines.length && lines[i].indent === indent) {
      const line = lines[i]
      if (line.text === '-' || line.text.startsWith('- ')) throw fail(line, '同一层级不能混用列表和映射')
      const colon = line.text.indexOf(':')
      if (colon <= 0) throw fail(line, '缺少“键: 值”结构')
      const key = line.text.slice(0, colon).trim()
      const rest = line.text.slice(colon + 1).trim()
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw fail(line, `重复的键：${key}`)
      i++
      if (rest === '') {
        if (i < lines.length && lines[i].indent > indent) obj[key] = parseBlock(lines[i].indent)
        else obj[key] = null
      } else {
        obj[key] = parseScalar(rest, line)
      }
    }
    return obj
  }

  function parseSeq(indent) {
    const arr = []
    while (i < lines.length && lines[i].indent === indent) {
      const line = lines[i]
      if (!(line.text === '-' || line.text.startsWith('- '))) throw fail(line, '列表项必须以“- ”开头')
      const rest = line.text.slice(1).trim()
      i++
      if (rest === '') {
        if (i < lines.length && lines[i].indent > indent) arr.push(parseBlock(lines[i].indent))
        else arr.push(null)
      } else if (/^[^:\s]+:(\s|$)/.test(rest)) {
        // 支持 YAML 常见的列表块映射：
        //   - key: value
        //     type: string
        const colon = rest.indexOf(':')
        const item = {}
        const mapIndent = indent + 2
        const key = rest.slice(0, colon).trim()
        const value = rest.slice(colon + 1).trim()
        if (value === '') {
          if (i < lines.length && lines[i].indent > mapIndent) item[key] = parseBlock(lines[i].indent)
          else item[key] = null
        } else {
          item[key] = parseScalar(value, line)
        }
        if (i < lines.length && lines[i].indent === mapIndent) {
          Object.assign(item, parseMap(mapIndent))
        }
        arr.push(item)
      } else {
        arr.push(parseScalar(rest, line))
      }
    }
    return arr
  }

  function parseScalar(raw, line) {
    const t = raw.trim()
    if (t.startsWith('[')) {
      if (!t.endsWith(']')) throw fail(line, '行内列表缺少右括号 ]')
      return splitInline(t.slice(1, -1)).map((item) => parseScalar(item, line))
    }
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
      return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
      return t.slice(1, -1).replace(/''/g, "'")
    }
    if (t === 'true') return true
    if (t === 'false') return false
    if (t === 'null' || t === '~') return null
    if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10)
    if (/^-?\d+\.\d+$/.test(t)) return Number.parseFloat(t)
    return t
  }

  const value = parseBlock(lines[0].indent)
  if (i < lines.length) throw fail(lines[i], '缩进层级无法识别')
  return value
}

function stripComment(text) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && inDouble) {
      i++
      continue
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i)
    }
  }
  return text
}

function splitInline(text) {
  const items = []
  let current = ''
  let quote = null
  for (const ch of text) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ',') {
      items.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  items.push(current.trim())
  return items.filter((item) => item !== '')
}
