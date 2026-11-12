// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
import { okBody } from '../errors.js'
import { middlewareSnapshot } from '../middleware.js'

export async function metaRoutes(app, { config, sources, db, cache, startedAt, middleware, configCenter }) {
  app.get('/api/meta', async () => {
    return okBody({
      siteName: process.env.LC_SITE_NAME || '低代码站点',
      language: 'node',
      maturity: 'full',
      version: '0.1.0',
      configVersion: config.schemaVersion,
      static: config.static.enabled,
      startedAt: new Date(startedAt).toISOString(),
      database: {
        driver: db.driver,
        // 只暴露连接目标，不含账号与密码
        target: db.driver === 'sqlite' ? db.target.database : `${db.target.host}:${db.target.port}/${db.target.database}`,
        pool: {
          maxOpenConns: config.database.maxOpenConns,
          connectTimeoutSeconds: config.database.connectTimeoutSeconds
        }
      },
      cache: {
        enabled: config.cache.enabled,
        driver: cache.driver,
        configured: config.cache.driver,
        fallback: cache.fallback,
        fallbackTarget: config.cache.fallback,
        keyPrefix: config.cache.keyPrefix
      },
      middleware: middlewareSnapshot(middleware),
      middlewareImpacts: middleware.impacts.map((impact) => ({
        name: impact.name,
        routes: impact.routes,
        message: impact.message,
        hint: impact.hint
      })),
      // 只暴露键名、类型与来源，绝不返回值；密钥字段在这里同样只有 hasValue。
      middlewareBuiltin: configCenter.snapshot().builtin,
      configCenter: configCenter.snapshot().custom,
      configSources: {
        generated: sources.generated,
        user: sources.user,
        override: sources.override === true,
        env: sources.env,
        cli: sources.cli
      },
      ignoredMiddleware: []
    })
  })
}
