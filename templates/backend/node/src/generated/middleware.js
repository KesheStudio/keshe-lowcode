// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 中间件清单一处定义：开关、关闭后的默认行为、受影响接口、启动期依赖校验。
// 启动日志会打印「本次生效的中间件清单」，被关闭且仍有接口依赖的项会在启动阶段报影响范围与提示。

const SPECS = [
  {
    name: 'requestId',
    enabled: (c) => c.middleware.requestId,
    on: () => '生成 x-request-id，日志与响应共用',
    off: '不生成请求 ID；日志无法把同一次请求的多条记录串起来',
    routes: ['全部接口']
  },
  {
    name: 'logging',
    enabled: (c) => c.middleware.logging,
    on: (c) => `访问日志（级别 ${c.logLevel}）`,
    off: '不记录访问日志，只保留启动与错误日志；排障时看不到请求耗时与状态码',
    routes: ['全部接口']
  },
  {
    name: 'bodyLimit',
    enabled: (c) => c.middleware.bodyLimit.enabled,
    on: (c) => `请求体上限 ${c.middleware.bodyLimit.maxBytes} 字节（超限返回 413 LC_E_PAYLOAD_TOO_LARGE）`,
    off: '不限制请求体大小，写接口可接收任意大小请求体，存在内存与磁盘风险',
    routes: ['POST /api/items', 'PUT /api/items/{id}', 'POST /api/data/{collection}', 'PUT /api/data/{collection}/{id}'],
    hint: '如需放开限制，建议同时设置 middleware.bodyLimit.maxBytes 与 nginx 的 client_max_body_size。'
  },
  {
    name: 'timeout',
    enabled: (c) => c.middleware.timeout.enabled,
    on: (c) => `请求处理上限 ${c.middleware.timeout.seconds} 秒（超时返回 503 LC_E_TIMEOUT）`,
    off: '不限制请求处理时长；慢请求会长期占用连接与数据库连接池',
    routes: ['全部接口', '数据库连接池'],
    hint: '排查慢请求时可临时关闭；长期关闭请同时调大 database.maxOpenConns 并监控连接占用。'
  },
  {
    name: 'concurrency',
    enabled: (c) => c.middleware.concurrency.enabled,
    on: (c) => `在途请求上限 ${c.middleware.concurrency.maxInFlight}（超限返回 503 LC_E_CONCURRENCY_LIMITED）`,
    off: '不限制并发在途请求数；突发流量会直接压到数据库',
    routes: ['全部接口'],
    defaultOff: true
  },
  {
    name: 'rateLimit',
    enabled: (c) => c.middleware.rateLimit.enabled,
    on: (c) => `按客户端 IP 固定窗口限流 ${c.middleware.rateLimit.rps} 次/秒（超限 429 LC_E_RATE_LIMITED）`,
    off: '不做 IP 级限流（默认策略：完全不限流）',
    routes: ['全部接口'],
    defaultOff: true
  },
  {
    name: 'cors',
    enabled: (c) => c.cors.enabled,
    on: (c) => `来源 ${c.cors.origins.length ? c.cors.origins.join(', ') : '[]（不放开跨域）'}；方法 ${c.cors.methods.join('/')}；凭据 ${c.cors.credentials ? '允许' : '不允许'}`,
    off: '不返回任何 CORS 头（默认策略：同源访问；浏览器会拦截所有跨域请求，服务端不会报错）',
    routes: ['全部 /api/*（浏览器跨域调用）'],
    hint: '前端与后端不同源时必须开启 cors.enabled 并把前端地址加入 cors.origins。'
  },
  {
    name: 'compression',
    enabled: (c) => c.middleware.compression.enabled,
    on: (c) => `响应压缩 ${[c.middleware.compression.gzip ? 'gzip' : '', c.middleware.compression.brotli ? 'br' : ''].filter(Boolean).join(' / ') || '未选择算法'}，小于 ${c.middleware.compression.minBytes} 字节不压`,
    off: '响应不压缩；JSON 与静态资源体积变大（可由 nginx 代压）',
    routes: ['JSON 接口', '静态资源']
  },
  {
    name: 'staticCache',
    enabled: (c) => c.middleware.staticCache.enabled,
    on: (c) => `静态资源 Cache-Control（普通资源 ${c.middleware.staticCache.maxAgeSeconds}s，带指纹资源 ${c.middleware.staticCache.immutableMaxAgeSeconds}s immutable）`,
    off: '静态资源不主动设置 Cache-Control，浏览器行为由默认启发式或 nginx 决定',
    routes: ['/（静态资源）']
  },
  {
    name: 'health',
    enabled: (c) => c.middleware.health.enabled,
    on: (c) => `GET /api/health（存活，始终 200）与 GET /api/ready（就绪，依赖不可用返回 503）；就绪检查数据库=${c.middleware.health.readinessRequiresDatabase ? '是' : '否'}，缓存=${c.middleware.health.readinessRequiresCache ? '是' : '否'}`,
    off: '不提供探活接口；两个路径都会返回 503 LC_E_MIDDLEWARE_DISABLED 并说明如何恢复，不会静默 404',
    routes: ['GET /api/health', 'GET /api/ready', 'deploy/scripts/health.sh|ps1'],
    hint: '部署脚本与容器探针依赖这两个路径；关闭后请改用外部探活或把 middleware.health.enabled 改回 true。'
  },
  {
    name: 'securityHeaders',
    enabled: (c) => c.middleware.securityHeaders.enabled,
    on: (c) => {
      const s = c.middleware.securityHeaders
      const items = [
        `X-Content-Type-Options=${s.contentTypeOptions || '未设置'}`,
        `X-Frame-Options=${s.frameOptions || '未设置'}`,
        `Referrer-Policy=${s.referrerPolicy || '未设置'}`,
        `HSTS=${s.hsts.enabled ? `${s.hsts.maxAgeSeconds}s` : '关闭'}`,
        `Permissions-Policy=${s.permissionsPolicy ? '已设置' : '未设置'}`,
        `COOP=${s.crossOriginOpenerPolicy || '未设置'}`
      ]
      return items.join('；')
    },
    off: '不返回安全响应头（默认策略：无 HSTS、无 nosniff、无 Referrer-Policy 等，浏览器按最宽松方式处理）',
    routes: ['全部响应', '静态站页面'],
    hint: '生产环境建议保持开启；只有在本机调试或由前置 nginx 统一注入时才关闭。'
  },
  {
    name: 'cache',
    enabled: (c) => c.cache.enabled,
    on: (c) => `缓存驱动 ${c.cache.driver}${c.cache.driver === 'redis' ? `（${c.cache.url}）` : ''}，TTL ${c.cache.ttlSeconds}s`,
    off: (c) => c.cache.fallback === 'none'
      ? '缓存已关闭且不回退：读接口每次都直读数据库，不会静默返回空数据'
      : '缓存已关闭，自动回退为进程内存缓存；接口继续可用，但多实例之间不共享，日志会写明已回退',
    routes: ['GET /api/items/{id}', 'GET /api/data/{collection}'],
    hint: '关缓存前请确认读流量可直压数据库；需要缓存时把 cache.enabled 改回 true 并配置 redis。'
  }
]

function configPathFor(name) {
  return {
    requestId: 'middleware.requestId',
    logging: 'middleware.logging',
    bodyLimit: 'middleware.bodyLimit.enabled',
    timeout: 'middleware.timeout.enabled',
    concurrency: 'middleware.concurrency.enabled',
    rateLimit: 'middleware.rateLimit.enabled',
    cors: 'cors.enabled',
    compression: 'middleware.compression.enabled',
    staticCache: 'middleware.staticCache.enabled',
    health: 'middleware.health.enabled',
    securityHeaders: 'middleware.securityHeaders.enabled',
    cache: 'cache.enabled'
  }[name]
}

/** 生成生效清单 + 关闭项的影响范围。dataApi/static 关闭时对应接口不会注册，不再计入影响。 */
export function buildMiddlewarePlan(config) {
  const entries = []
  const impacts = []

  for (const spec of SPECS) {
    const enabled = Boolean(spec.enabled(config))
    const offText = typeof spec.off === 'function' ? spec.off(config) : spec.off
    const entry = {
      name: spec.name,
      enabled,
      source: 'builtin',
      effective: enabled ? spec.on(config) : offText,
      configPath: configPathFor(spec.name)
    }
    entries.push(entry)

    if (enabled) continue
    // 默认关闭的限流/并发属于正常配置，只记录清单，不当作故障告警。
    if (spec.defaultOff) {
      entry.severity = 'info'
      continue
    }
    const routes = spec.routes.filter((route) => {
      if (!config.dataApi.enabled && route.includes('/api/data/')) return false
      if (!config.static.enabled && (route.includes('静态') || route === '/（静态资源）')) return false
      return true
    })
    if (routes.length === 0 && spec.name !== 'health') {
      entry.severity = 'info'
      continue
    }
    entry.severity = 'warn'
    impacts.push({
      name: spec.name,
      severity: 'warn',
      routes,
      message: offText,
      hint: spec.hint || `如需恢复，把 ${configPathFor(spec.name)} 改为 true 后重启。`
    })
  }

  return { entries, impacts }
}

/** 启动日志：一份清单 + 所有关闭项的影响与可操作提示。 */
export function printMiddlewarePlan(plan, logger = console) {
  const on = plan.entries.filter((e) => e.enabled).length
  logger.log(`[中间件] 本次生效清单：${on}/${plan.entries.length} 项开启`)
  for (const entry of plan.entries) {
    const mark = entry.enabled ? '✓' : '✗'
    logger.log(`[中间件] ${mark} ${entry.name.padEnd(15)} ${entry.effective}`)
  }
  for (const impact of plan.impacts) {
    logger.warn(`[中间件][影响] ${impact.name} 已关闭：${impact.message}`)
    logger.warn(`[中间件][影响] ${impact.name} 受影响：${impact.routes.join('、')}`)
    logger.warn(`[中间件][建议] ${impact.hint}`)
  }
}

/** 给 /api/meta 与 /api/health 用的稳定快照。 */
export function middlewareSnapshot(plan) {
  return plan.entries.map((entry) => ({
    name: entry.name,
    enabled: entry.enabled,
    effective: entry.effective,
    configPath: entry.configPath
  }))
}

/** 中间件被关闭且接口无法降级时，返回统一的显式说明，而不是静默 404/500。 */
export function disabledError(name, configPath, detail = '') {
  return {
    code: 'LC_E_MIDDLEWARE_DISABLED',
    message: `中间件 ${name} 已关闭，该接口不可用`,
    detail: detail || `在 config.yaml 把 ${configPath} 改为 true 后重启即可恢复。`
  }
}
