// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 业务逻辑在 src/custom/，新增接口在 src/custom/routes.js。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'

import { createAuthService } from './generated/auth.js'
import { createDataService } from './generated/data/collections.js'
import { ConfigError, loadConfig } from './generated/config.js'
import {
  formatDatabaseError,
  openDatabase,
  rollbackLastMigration,
  runMigrations
} from './generated/db.js'
import { openCache } from './generated/cache.js'
import { AppError, errorBody } from './generated/errors.js'
import { installHooks, staticCacheHeaderFor } from './generated/http.js'
import { buildMiddlewarePlan, printMiddlewarePlan } from './generated/middleware.js'
import { registerRoutes } from './generated/routes/index.js'
import { registerCustomRoutes } from './custom/routes.js'

const startedAt = Date.now()

async function main() {
  let loaded
  try {
    loaded = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[${err.code}] ${err.message}`)
      process.exit(2)
    }
    throw err
  }

  const { config, warnings, sources, command, configCenter } = loaded
  for (const warning of warnings) console.warn(`[warn] ${warning}`)

  // 先打印生效清单与关闭项影响，任何后续启动失败时也能从日志看到本次装配结果。
  const middlewarePlan = buildMiddlewarePlan(config)
  printMiddlewarePlan(middlewarePlan)
  configCenter.printSummary(console)

  let db
  try {
    db = await openDatabase(config, { migrate: command !== 'serve' ? false : true })
  } catch (err) {
    console.error(formatDatabaseError(err))
    process.exit(1)
  }

  if (command === 'migrate' || command === 'migrate-down') {
    try {
      if (command === 'migrate') {
        const result = await runMigrations(db, db.target)
        console.log(result.applied.length
          ? `已执行迁移：${result.applied.join('、')}（跳过 ${result.skipped} 个）`
          : '无待执行迁移')
      } else {
        const result = await rollbackLastMigration(db, db.target)
        console.log(result.rolledBack ? `已回滚迁移：${result.rolledBack}` : '没有可回滚的迁移')
      }
      await db.close()
      process.exit(0)
    } catch (err) {
      console.error(formatDatabaseError(err))
      await db.close()
      process.exit(1)
    }
  }

  const cache = await openCache(config.cache, {
    logger: console,
    connectTimeoutSeconds: config.database.connectTimeoutSeconds
  })

  const app = Fastify({
    logger: config.middleware.logging ? { level: config.logLevel } : false,
    genReqId: () => crypto.randomUUID(),
    // 关闭请求体限制时给一个足够大的上限，避免沿用框架默认 1 MB 却声称已关闭。
    bodyLimit: config.middleware.bodyLimit.enabled
      ? config.middleware.bodyLimit.maxBytes
      : Number.MAX_SAFE_INTEGER
  })

  if (config.middleware.timeout.enabled) {
    const limitMs = config.middleware.timeout.seconds * 1000
    app.server.requestTimeout = limitMs
    app.server.headersTimeout = Math.min(limitMs, 60_000)
  }

  const auth = createAuthService(config, db, console)
  await auth.bootstrap()

  const deps = { config, db, cache, auth, sources, startedAt, middleware: middlewarePlan, configCenter }
  deps.data = createDataService(config, db, auth, console)

  installHooks(app, config)
  await registerRoutes(app, deps)
  await registerCustomRoutes(app, deps)

  if (config.static.enabled) {
    const root = path.resolve(process.cwd(), config.static.root)
    if (!fs.existsSync(root)) {
      console.error(`[LC_E_CONFIG_INVALID] static.root 不存在：${root}`)
      process.exit(2)
    }
    await app.register(fastifyStatic, {
      root,
      index: ['index.html'],
      wildcard: true,
      setHeaders: (res, filePath) => {
        for (const [name, value] of Object.entries(staticCacheHeaderFor(config, filePath))) {
          res.setHeader(name, value)
        }
      }
    })
  }

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(errorBody('LC_E_NOT_FOUND', `路径不存在：${request.method} ${request.url}`))
  })

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, err.detail, err.field, err.fields))
    }
    const status = err.statusCode || 500
    if (status === 413) {
      const limit = config.middleware.bodyLimit.enabled
        ? `${config.middleware.bodyLimit.maxBytes} 字节`
        : '当前未启用（请检查配置）'
      return reply.code(413).send(errorBody('LC_E_PAYLOAD_TOO_LARGE', `请求体超过上限：${limit}`))
    }
    if (status === 400) {
      return reply.code(400).send(errorBody('LC_E_INVALID_ARGUMENT', '请求格式不合法', err.message))
    }
    if (status === 415) {
      return reply.code(415).send(errorBody('LC_E_INVALID_ARGUMENT', 'Content-Type 必须为 application/json'))
    }
    request.log.error({ code: err.code, message: err.message }, 'request failed')
    return reply.code(500).send(errorBody('LC_E_INTERNAL', '服务端处理失败'))
  })

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${config.port} 已被占用；用 --port 或改配置文件换一个端口。`)
      process.exit(1)
    }
    throw err
  }

  const displayHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host
  console.log(`[低代码后端] 已启动：http://${displayHost}:${config.port}`)
  console.log(`[低代码后端] 存活检查：http://${displayHost}:${config.port}/api/health`)
  console.log(`[低代码后端] 就绪检查：http://${displayHost}:${config.port}/api/ready`)
  console.log(`[低代码后端] 静态站：${config.static.enabled ? '由本进程服务' : '关闭（交给 nginx）'}`)
  console.log(`[低代码后端] 数据库：${db.driver}（${db.driver === 'sqlite' ? db.target.database : `${db.target.host}:${db.target.port}/${db.target.database}`}）`)
  console.log(`[低代码后端] 缓存：${cache.driver}${cache.fallback ? '（已回退，原因见上方日志）' : ''}`)
  console.log(`[低代码后端] 配置来源：${sources.user || sources.generated || '内置默认值'}`)

  let closing = false
  const shutdown = async (signal) => {
    if (closing) return
    closing = true
    console.log(`收到 ${signal}，正在关闭…`)
    try {
      await app.close()
      await cache.close()
      await db.close()
    } catch (err) {
      console.error(`关闭时出错：${err.message}`)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error(`[LC_E_INTERNAL] 启动失败：${err.message}`)
  process.exit(1)
})
