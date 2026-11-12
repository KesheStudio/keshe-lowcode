// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 两套配置并存：
// A. 内置中间件预设（PostgreSQL / MySQL / SQLite / Redis / 对象存储 / 消息队列 / 搜索 / 反向代理）
//    关闭的组完全不加载，残留配置键忽略。
// B. 自定义配置项（configCenter.definitions + values），任意键值，类型转换与缺省由骨架负责。
// 统一规则：来源可查（default/generated/user/env/cli），密钥只读环境变量，缺失时给人话提示。

export const BUILTIN_GROUPS = {
  postgres: {
    label: 'PostgreSQL',
    kind: 'database',
    fields: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 5432, min: 1, max: 65535 },
      database: { type: 'string', default: 'app' },
      user: { type: 'string', default: 'lc' },
      password: { type: 'string', default: '', secret: true, env: 'LC_CFG_POSTGRES_PASSWORD' },
      sslMode: { type: 'enum', default: 'disable', enum: ['disable', 'require'] },
      maxOpenConns: { type: 'number', default: 10, min: 1, max: 100 },
      connectTimeoutSeconds: { type: 'number', default: 5, min: 1, max: 60 }
    }
  },
  mysql: {
    label: 'MySQL / MariaDB',
    kind: 'database',
    fields: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 3306, min: 1, max: 65535 },
      database: { type: 'string', default: 'app' },
      user: { type: 'string', default: 'lc' },
      password: { type: 'string', default: '', secret: true, env: 'LC_CFG_MYSQL_PASSWORD' },
      maxOpenConns: { type: 'number', default: 10, min: 1, max: 100 },
      connectTimeoutSeconds: { type: 'number', default: 5, min: 1, max: 60 }
    }
  },
  sqlite: {
    label: 'SQLite',
    kind: 'database',
    fields: {
      file: { type: 'string', default: 'data/app.db' }
    }
  },
  redis: {
    label: 'Redis',
    kind: 'cache',
    fields: {
      url: { type: 'string', default: 'redis://127.0.0.1:16379/0' },
      ttlSeconds: { type: 'number', default: 30, min: 1, max: 86400 },
      keyPrefix: { type: 'string', default: 'lc:' },
      password: { type: 'string', default: '', secret: true, env: 'LC_CFG_REDIS_PASSWORD' }
    }
  },
  objectStorage: {
    label: '对象存储',
    kind: 'inject',
    fields: {
      driver: { type: 'string', default: 's3' },
      endpoint: { type: 'string', default: '' },
      bucket: { type: 'string', default: '' },
      region: { type: 'string', default: '' },
      accessKey: { type: 'string', default: '', secret: true, env: 'LC_CFG_OBJECT_STORAGE_ACCESS_KEY' },
      secretKey: { type: 'string', default: '', secret: true, env: 'LC_CFG_OBJECT_STORAGE_SECRET_KEY' }
    }
  },
  messageQueue: {
    label: '消息队列',
    kind: 'inject',
    fields: {
      driver: { type: 'string', default: 'redis' },
      url: { type: 'string', default: '' },
      queue: { type: 'string', default: 'lc' }
    }
  },
  search: {
    label: '搜索',
    kind: 'inject',
    fields: {
      driver: { type: 'string', default: 'opensearch' },
      url: { type: 'string', default: '' },
      index: { type: 'string', default: 'lc' }
    }
  },
  reverseProxy: {
    label: '反向代理',
    kind: 'inject',
    fields: {
      upstream: { type: 'string', default: 'http://127.0.0.1:8080' },
      clientMaxBodySize: { type: 'string', default: '1m' }
    }
  }
}

const CUSTOM_ENV_PREFIX = 'LC_CFG_'

function snake(text) {
  return String(text).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
}

/** 内置组字段的环境变量名：LC_CFG_<GROUP>_<FIELD>，例如 LC_CFG_POSTGRES_HOST。 */
export function envNameForBuiltin(group, field) {
  return CUSTOM_ENV_PREFIX + snake(group) + '_' + snake(field)
}

// 内置组的环境变量已被内置组消费，不能再当成自定义配置项重复注入。
const BUILTIN_ENV_NAMES = new Set(
  Object.entries(BUILTIN_GROUPS).flatMap(([group, preset]) =>
    Object.keys(preset.fields).map((field) => envNameForBuiltin(group, field))
  )
)

export function envNameForKey(key) {
  return CUSTOM_ENV_PREFIX + key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

function parseBoolValue(raw, field, ConfigError) {
  const text = String(raw).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off'].includes(text)) return false
  throw new ConfigError(`${field} 必须是 true/false，当前值：${raw}`, field)
}

/**
 * @param cfg          合并后的完整配置（已被 builtin 映射前的值）
 * @param layers       { generated, user } 两份原始配置，用于逐键追踪来源
 * @param env          环境变量对象
 * @param cliCfg       --cfg KEY=VALUE 集合
 * @param ConfigError  配置错误类
 * @param warnings     warning 数组
 */
export function createConfigCenter(cfg, layers, env, cliCfg, ConfigError, warnings) {
  const builtinConfig = cfg.middleware?.builtin ?? {}
  const groups = {}
  const missingSecrets = []

  for (const [name, preset] of Object.entries(BUILTIN_GROUPS)) {
    const raw = builtinConfig[name]
    const envEnabledKey = `LC_CFG_${snake(name)}_ENABLED`
    const cliEnabledKey = `${name}.enabled`
    const envPresent = Object.keys(env).some((key) => key.startsWith(`LC_CFG_${snake(name)}_`))
    const cliPresent = Object.keys(cliCfg).some((key) => key.startsWith(`${name}.`))
    if ((!raw || typeof raw !== 'object') && !envPresent && !cliPresent) {
      groups[name] = { name, label: preset.label, kind: preset.kind, enabled: false, present: false, config: {}, fields: [] }
      continue
    }
    if (raw && typeof raw.enabled !== 'boolean') {
      throw new ConfigError(`middleware.builtin.${name}.enabled 必须是 true/false`, `middleware.builtin.${name}.enabled`)
    }
    for (const key of Object.keys(raw?.config ?? {})) {
      if (!preset.fields[key]) {
        warnings.push(`内置中间件 ${name} 没有预设字段 ${key}，已忽略`)
      }
    }
    // 优先级：启动参数 <group>.enabled > 环境变量 LC_CFG_<GROUP>_ENABLED > 配置文件。
    let enabled = raw?.enabled === true
    let enabledSource = 'default'
    if (raw) enabledSource = layers.user?.middleware?.builtin?.[name] ? 'user' : 'generated'
    if (env[envEnabledKey] !== undefined && env[envEnabledKey] !== '') {
      enabled = parseBoolValue(env[envEnabledKey], envEnabledKey, ConfigError)
      enabledSource = 'env'
    }
    if (cliCfg[cliEnabledKey] !== undefined) {
      enabled = parseBoolValue(cliCfg[cliEnabledKey], cliEnabledKey, ConfigError)
      enabledSource = 'cli'
    }
    const group = { name, label: preset.label, kind: preset.kind, enabled, present: true, enabledSource, config: {}, fields: [] }
    groups[name] = group
    // 关闭的组完全不加载，残留键直接忽略（导出侧也不会生成这些键）。
    if (!enabled) continue

    for (const [field, rule] of Object.entries(preset.fields)) {
      if (rule.secret && raw?.config?.[field] !== undefined && raw.config[field] !== '' && raw.config[field] !== null) {
        warnings.push(`内置中间件 ${name}.${field} 是密钥，配置文件中的值已忽略（只读环境变量 ${rule.env || envNameForBuiltin(name, field)}）`)
      }
      const resolved = resolveField(name, field, rule, raw?.config ?? {}, layers, env, cliCfg, ConfigError)
      group.config[field] = resolved.value
      group.fields.push({
        group: name,
        field,
        type: rule.type,
        secret: rule.secret === true,
        source: resolved.source,
        hasValue: resolved.value !== '' && resolved.value !== null && resolved.value !== undefined
      })
      if (rule.secret && (!resolved.value || String(resolved.value).trim() === '')) {
        missingSecrets.push({ group: name, field, env: rule.env || envNameForBuiltin(name, field) })
      }
    }
  }

  const dbGroups = Object.values(groups).filter((g) => g.kind === 'database' && g.enabled)
  if (dbGroups.length > 1) {
    throw new ConfigError(
      `同时启用了多个数据库中间件：${dbGroups.map((g) => g.name).join('、')}；只能三选一`,
      'middleware.builtin'
    )
  }
  const cacheGroup = groups.redis?.present ? groups.redis : null

  // 密钥缺失：只对已启用的组报错，未启用组不打扰。
  if (missingSecrets.length) {
    const first = missingSecrets[0]
    throw new ConfigError(
      `已启用 ${first.group} 但缺少密钥 ${first.field}；请设置环境变量 ${first.env}（配置文件中的密钥会被忽略）`,
      `middleware.builtin.${first.group}.config.${first.field}`
    )
  }

  // 把内置组映射到现有数据库 / 缓存层；没有启用任何数据库组时保留顶层 database（兼容模式）。
  if (dbGroups.length === 1) {
    applyDatabaseGroup(dbGroups[0], cfg)
  } else if (Object.values(groups).some((g) => g.kind === 'database' && g.present)) {
    warnings.push('未启用内置数据库中间件，使用顶层 database（兼容模式）')
  }
  if (cacheGroup) {
    if (cacheGroup.enabled) {
      cfg.cache.enabled = true
      cfg.cache.driver = 'redis'
      cfg.cache.url = redisUrlWithPassword(cacheGroup.config.url, cacheGroup.config.password)
      cfg.cache.ttlSeconds = cacheGroup.config.ttlSeconds
      cfg.cache.keyPrefix = cacheGroup.config.keyPrefix
    } else {
      cfg.cache.enabled = false
    }
  }

  const custom = resolveCustom(cfg, layers, env, cliCfg, ConfigError, warnings)

  return {
    builtin: groups,
    custom,
    missingSecrets,
    get(path, fallback = null) {
      if (path.includes('.')) {
        const [group, field] = path.split('.', 2)
        if (!groups[group] || !groups[group].enabled) return fallback
        return groups[group].config[field] ?? fallback
      }
      return custom.get(path)?.value ?? fallback
    },
    group(name) {
      const g = groups[name]
      return g && g.enabled ? { ...g.config } : null
    },
    source(path) {
      if (path.includes('.')) {
        const [group, field] = path.split('.', 2)
        return groups[group]?.fields.find((f) => f.field === field)?.source ?? null
      }
      return custom.get(path)?.source ?? null
    },
    snapshot() {
      return {
        builtin: Object.values(groups).filter((g) => g.present).map((g) => ({
          group: g.name,
          label: g.label,
          kind: g.kind,
          enabled: g.enabled,
          source: g.enabledSource,
          effective: effectiveText(g),
          fields: g.fields
        })),
        custom: [...custom.values()].map((entry) => ({
          key: entry.key,
          type: entry.type,
          secret: entry.secret,
          source: entry.source,
          description: entry.description,
          enum: entry.enum
        }))
      }
    },
    printSummary(logger = console) {
      for (const g of Object.values(groups)) {
        if (!g.present) continue
        const mark = g.enabled ? '✓' : '✗'
        logger.log(`[中间件][内置] ${g.label.padEnd(14)} ${mark} ${effectiveText(g)}（来源=${g.enabledSource}）`)
        if (!g.enabled) continue
        const map = g.fields.map((f) => `${f.field}=${f.secret ? '***' : String(g.config[f.field])}(${f.source})`)
        logger.log(`[中间件][内置] ${g.label} 字段：${map.join('，')}`)
      }
      for (const entry of custom.values()) {
        logger.log(`[中间件][自定义] ${entry.key}=${entry.secret ? '***' : String(entry.value)}（来源=${entry.source}）`)
      }
    }
  }
}

function effectiveText(group) {
  if (!group.present) return '未启用（配置未加载）'
  if (!group.enabled) return '未启用（配置未加载）'
  if (group.kind === 'database') return '已启用（数据库连接已接管）'
  if (group.kind === 'cache') return '已启用（缓存连接已接管）'
  return '配置已注入（连接由用户代码负责）'
}

function resolveField(group, field, rule, rawConfig, layers, env, cliCfg, ConfigError) {
  const cliKey = `${group}.${field}`
  const envKey = rule.env || envNameForBuiltin(group, field)
  const candidates = []
  if (rule.secret) {
    const fileValue = rawConfig[field]
    if (fileValue !== undefined && fileValue !== '' && fileValue !== null) {
      // 不打印值，只提示忽略。
      candidates.push({ source: 'file-ignored', value: undefined })
    }
  } else {
    candidates.push({ source: 'default', value: rule.default })
    for (const [layerName, layer] of [['generated', layers.generated], ['user', layers.user]]) {
      const value = layer?.middleware?.builtin?.[group]?.config?.[field]
      if (value !== undefined) candidates.push({ source: layerName, value })
    }
  }
  if (env[envKey] !== undefined && env[envKey] !== '') candidates.push({ source: 'env', value: env[envKey] })
  if (cliCfg[cliKey] !== undefined) candidates.push({ source: 'cli', value: cliCfg[cliKey] })

  let picked = { source: 'default', value: rule.default }
  for (const candidate of candidates) {
    if (candidate.value !== undefined) picked = candidate
  }
  const value = convertValue(picked.value, rule, `${group}.${field}`, ConfigError)
  return { value, source: picked.source }
}

function resolveCustom(cfg, layers, env, cliCfg, ConfigError, warnings) {
  const definitions = Array.isArray(cfg.configCenter?.definitions) ? cfg.configCenter.definitions : []
  const mergedValues = cfg.configCenter?.values ?? {}
  const map = new Map()

  const seen = new Set()
  for (const def of definitions) {
    if (!def || typeof def.key !== 'string' || def.key === '') {
      throw new ConfigError('configCenter.definitions 每一项都必须有非空 key', 'configCenter.definitions')
    }
    if (seen.has(def.key)) throw new ConfigError(`configCenter.definitions 存在重复 key：${def.key}`, 'configCenter.definitions')
    seen.add(def.key)
    if (!['string', 'number', 'bool', 'enum'].includes(def.type)) {
      throw new ConfigError(`configCenter.definitions[${def.key}].type 只能是 string/number/bool/enum`, 'configCenter.definitions')
    }
  }

  for (const def of definitions) {
    const rule = { type: def.type, default: def.default, enum: def.enum, secret: def.secret === true }
    if (rule.type === 'enum' && (!Array.isArray(rule.enum) || rule.enum.length === 0)) {
      throw new ConfigError(`configCenter.definitions[${def.key}].enum 必须是非空列表`, 'configCenter.definitions')
    }
    if (rule.secret && def.default !== undefined && def.default !== '') {
      throw new ConfigError(`密钥配置项 ${def.key} 的 default 必须留空，值只能来自环境变量`, 'configCenter.definitions')
    }

    // 显式声明的密钥不读任何文件层，只读 env / cli。
    const fileValue = rule.secret ? undefined : mergedValues[def.key]
    const envValue = env[envNameForKey(def.key)]
    const cliValue = cliCfg[def.key]
    const hasFile = layers.generated?.configCenter?.values?.[def.key] !== undefined
      || layers.user?.configCenter?.values?.[def.key] !== undefined

    let picked = { source: 'default', value: def.default }
    if (!rule.secret && hasFile) {
      picked = {
        source: layers.user?.configCenter?.values?.[def.key] !== undefined ? 'user' : 'generated',
        value: fileValue
      }
    } else if (!rule.secret && def.default === undefined && fileValue === undefined) {
      warnings.push(`自定义配置项 ${def.key} 没有默认值也没有配置值，已按 ${rule.type} 的空值处理`)
    }
    if (envValue !== undefined && envValue !== '') picked = { source: 'env', value: envValue }
    if (cliValue !== undefined) picked = { source: 'cli', value: cliValue }

    if (rule.secret) {
      if (hasFile) warnings.push(`配置项 ${def.key} 标记为密钥，配置文件中的值已忽略（只读环境变量 ${envNameForKey(def.key)}）`)
      if (picked.value === undefined || picked.value === '' || picked.value === null) {
        throw new ConfigError(
          `缺少密钥配置 ${def.key}；请设置环境变量 ${envNameForKey(def.key)}（配置文件中的密钥会被忽略）`,
          `configCenter.${def.key}`
        )
      }
    }

    const value = convertValue(picked.value, rule, def.key, ConfigError)
    map.set(def.key, {
      key: def.key,
      type: rule.type,
      secret: rule.secret === true,
      value,
      source: picked.source,
      description: def.description ?? ''
    })
  }

  // 未在 definitions 中声明、但出现在 env / values 里的键：按字符串注入并提示，不阻断启动。
  const extra = new Set()
  for (const key of Object.keys(mergedValues)) if (!map.has(key)) extra.add(key)
  for (const name of Object.keys(env)) {
    if (!name.startsWith(CUSTOM_ENV_PREFIX)) continue
    if (BUILTIN_ENV_NAMES.has(name)) continue
    const key = name.slice(CUSTOM_ENV_PREFIX.length)
    if (!map.has(key)) extra.add(key)
  }
  for (const key of Object.keys(cliCfg)) if (!map.has(key)) extra.add(key)

  for (const key of extra) {
    const fromEnv = env[envNameForKey(key)]
    const fromCli = cliCfg[key]
    const value = fromCli ?? fromEnv ?? mergedValues[key]
    map.set(key, {
      key,
      type: inferType(value),
      secret: false,
      value,
      source: fromCli !== undefined ? 'cli' : fromEnv !== undefined ? 'env' : 'user',
      description: ''
    })
    warnings.push(`自定义配置项 ${key} 未在 configCenter.definitions 声明，已按 ${inferType(value)} 类型注入`)
  }

  return map
}

function convertValue(value, rule, field, ConfigError) {
  if (value === undefined || value === null) {
    if (rule.default !== undefined) return convertValue(rule.default, rule, field, ConfigError)
    return rule.type === 'bool' ? false : rule.type === 'number' ? 0 : ''
  }
  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') throw new ConfigError(`${field} 必须是字符串，收到 ${typeof value}`, field)
      return value
    case 'number': {
      const num = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(num)) throw new ConfigError(`${field} 必须是数字，收到：${String(value)}`, field)
      if (rule.min !== undefined && num < rule.min) throw new ConfigError(`${field} 不能小于 ${rule.min}`, field)
      if (rule.max !== undefined && num > rule.max) throw new ConfigError(`${field} 不能大于 ${rule.max}`, field)
      return num
    }
    case 'bool': {
      if (typeof value === 'boolean') return value
      const text = String(value).trim().toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(text)) return true
      if (['false', '0', 'no', 'off'].includes(text)) return false
      throw new ConfigError(`${field} 必须是 true/false，收到：${String(value)}`, field)
    }
    case 'enum':
      if (!rule.enum.includes(String(value))) {
        throw new ConfigError(`${field} 只能是 ${rule.enum.join(' / ')}，收到：${String(value)}`, field)
      }
      return String(value)
    default:
      throw new ConfigError(`${field} 的类型 ${rule.type} 不受支持`, field)
  }
}

function inferType(value) {
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return 'number'
  return 'string'
}

function applyDatabaseGroup(group, cfg) {
  const c = group.config
  cfg.database.host = c.host ?? cfg.database.host
  cfg.database.port = c.port ?? cfg.database.port
  cfg.database.name = c.database ?? cfg.database.name
  cfg.database.user = c.user ?? cfg.database.user
  cfg.database.password = c.password ?? ''
  if (group.name === 'sqlite') {
    cfg.database.driver = 'sqlite'
    cfg.database.url = c.file === ':memory:' ? 'sqlite::memory:' : `sqlite://${c.file}`
    return
  }
  if (group.name === 'postgres') {
    cfg.database.driver = 'postgres'
    cfg.database.sslMode = c.sslMode
    cfg.database.url = `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}?sslmode=${c.sslMode}`
  } else {
    cfg.database.driver = 'mysql'
    cfg.database.url = `mysql://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`
  }
  cfg.database.maxOpenConns = c.maxOpenConns
  cfg.database.connectTimeoutSeconds = c.connectTimeoutSeconds
}

function redisUrlWithPassword(url, password) {
  if (!password) return url
  if (url.includes('@')) return url
  return url.replace('redis://', `redis://:${encodeURIComponent(password)}@`)
}
