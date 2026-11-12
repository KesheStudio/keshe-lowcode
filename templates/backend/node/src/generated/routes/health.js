// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
import { checkDatabase, mapDatabaseError } from '../db.js'
import { errorBody, okBody } from '../errors.js'
import { disabledError, middlewareSnapshot } from '../middleware.js'

export async function healthRoutes(app, deps) {
  const { config, db, cache, startedAt, middleware } = deps
  const enabled = config.middleware.health.enabled

  const baseInfo = () => ({
    language: 'node',
    maturity: 'full',
    version: '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    database: db.driver,
    cache: cache.driver,
    cacheFallback: cache.fallback,
    cacheConfigured: config.cache.driver,
    static: config.static.enabled,
    middleware: middlewareSnapshot(middleware)
  })

  // 存活检查：进程活着就返回 200，不因依赖不可用而失败（依赖状态放在 databaseReachable）。
  app.get('/api/health', async (request, reply) => {
    if (!enabled) {
      const info = disabledError(
        'health',
        'middleware.health.enabled',
        '部署脚本与容器探针依赖 /api/health 与 /api/ready；改回 true 后重启即可恢复。'
      )
      return reply.code(503).send(errorBody(info.code, info.message, info.detail))
    }

    let databaseReachable = true
    let problem = ''
    try {
      await checkDatabase(db)
    } catch (err) {
      databaseReachable = false
      problem = mapDatabaseError(err, db.target, 'health').message
      request.log.error({ code: err.code, reason: err.reason }, 'liveness database probe failed')
    }

    return okBody({
      status: 'ok',
      ...baseInfo(),
      databaseReachable,
      databaseProblem: problem
    })
  })

  // 就绪检查：依赖不可用时返回 503，与存活检查明确区分。
  app.get('/api/ready', async (request, reply) => {
    if (!enabled) {
      const info = disabledError(
        'health',
        'middleware.health.enabled',
        '就绪检查已随健康检查中间件一起关闭；改回 true 后重启即可恢复。'
      )
      return reply.code(503).send(errorBody(info.code, info.message, info.detail))
    }

    const problems = []
    if (config.middleware.health.readinessRequiresDatabase) {
      try {
        await checkDatabase(db)
      } catch (err) {
        const mapped = mapDatabaseError(err, db.target, 'health')
        problems.push(`数据库不可用：${mapped.message}`)
      }
    }
    if (config.middleware.health.readinessRequiresCache && cache.driver === 'redis') {
      try {
        await cache.get('__lc_ready_probe__')
      } catch (err) {
        problems.push(`缓存不可用：${err.message}`)
      }
    }

    if (problems.length) {
      return reply.code(503).send(errorBody(
        'LC_E_NOT_READY',
        '服务尚未就绪',
        problems.join('；')
      ))
    }

    return okBody({ status: 'ready', ...baseInfo(), checked: {
      database: config.middleware.health.readinessRequiresDatabase,
      cache: config.middleware.health.readinessRequiresCache
    } })
  })
}
