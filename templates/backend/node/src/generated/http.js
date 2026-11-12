// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 中间件装配：请求 ID、访问日志、超时、并发、限流、CORS、安全响应头、压缩。
// 每一项都受 config.middleware 开关控制；关闭时直接不挂对应的 hook，不产生额外开销。
import zlib from 'node:zlib'
import { errorBody } from './errors.js'

export function installHooks(app, config) {
  const cors = config.cors
  const middleware = config.middleware
  const concurrency = middleware.concurrency

  // ------------------------------------------------------------ 请求 ID
  app.addHook('onRequest', async (request, reply) => {
    if (!middleware.requestId) return
    // 只回显服务端生成的 ID，不接受客户端传值，避免日志注入
    reply.header('x-request-id', request.id)
  })

  // ------------------------------------------------------------ 请求超时
  if (middleware.timeout.enabled) {
    const limitMs = middleware.timeout.seconds * 1000
    app.addHook('onRequest', (request, reply, done) => {
      const timer = setTimeout(() => {
        if (reply.raw.headersSent || reply.raw.writableEnded) return
        reply.code(503).send(errorBody(
          'LC_E_TIMEOUT',
          `请求处理超过 ${middleware.timeout.seconds} 秒，已中止`,
          '可在 config.yaml 调大 middleware.timeout.seconds；持续超时请检查数据库与慢查询。'
        ))
      }, limitMs)
      timer.unref?.()
      const clear = () => clearTimeout(timer)
      reply.raw.once('finish', clear)
      reply.raw.once('close', clear)
      done()
    })
  }

  // ------------------------------------------------------------ 并发上限
  if (concurrency.enabled) {
    let inFlight = 0
    app.addHook('onRequest', async (request, reply) => {
      if (inFlight >= concurrency.maxInFlight) {
        reply.header('retry-after', '1')
        return reply.code(503).send(errorBody(
          'LC_E_CONCURRENCY_LIMITED',
          `在途请求已达上限 ${concurrency.maxInFlight}，请稍后重试`,
          '可调大 middleware.concurrency.maxInFlight，或检查是否有慢请求长期占用连接。'
        ))
      }
      inFlight += 1
      reply.raw.once('finish', () => { inFlight -= 1 })
      reply.raw.once('close', () => { inFlight -= 1 })
    })
  }

  // ------------------------------------------------------------ CORS
  if (cors.enabled) {
    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin
      if (!origin) return
      const wildcard = cors.origins.includes('*') && !cors.credentials
      const allowed = wildcard || cors.origins.includes(origin)

      if (!allowed) {
        if (request.method === 'OPTIONS') return reply.code(204).send()
        return
      }

      reply.header('access-control-allow-origin', wildcard ? '*' : origin)
      reply.header('vary', 'Origin')
      if (cors.credentials) reply.header('access-control-allow-credentials', 'true')

      if (request.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', cors.methods.join(', '))
        reply.header('access-control-allow-headers', cors.headers.join(', '))
        reply.header('access-control-max-age', String(cors.maxAge))
        return reply.code(204).send()
      }
    })
  }

  // ------------------------------------------------------------ 限流
  if (middleware.rateLimit.enabled) {
    const buckets = new Map()
    const windowMs = 1000
    const limit = middleware.rateLimit.rps

    app.addHook('onRequest', async (request, reply) => {
      const now = Date.now()
      const key = request.ip || 'unknown'
      let bucket = buckets.get(key)
      if (!bucket || now - bucket.start >= windowMs) {
        bucket = { start: now, count: 0 }
        buckets.set(key, bucket)
      }
      bucket.count += 1
      if (buckets.size > 10000) {
        for (const [k, b] of buckets) if (now - b.start >= windowMs * 2) buckets.delete(k)
      }
      if (bucket.count > limit) {
        reply.header('retry-after', '1')
        return reply.code(429).send(errorBody(
          'LC_E_RATE_LIMITED',
          '请求过于频繁，请稍后再试',
          `当前限制 ${limit} 次/秒；可在 config.yaml 调整 middleware.rateLimit.rps。`
        ))
      }
    })
  }

  // ------------------------------------------------------------ 响应头 + 压缩
  app.addHook('onSend', async (request, reply, payload) => {
    applySecurityHeaders(reply, middleware.securityHeaders)
    if (!middleware.compression.enabled) return payload

    const type = String(reply.getHeader('content-type') || '')
    if (!isCompressible(type)) return payload
    if (reply.getHeader('content-encoding')) return payload
    // 流式响应（静态大文件）不在内存里二次压缩，交给 nginx
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload

    const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
    if (buffer.length < middleware.compression.minBytes) return payload

    const accept = String(request.headers['accept-encoding'] || '')
    const useBrotli = middleware.compression.brotli && /\bbr\b/.test(accept)
    const useGzip = !useBrotli && middleware.compression.gzip && /\bgzip\b/.test(accept)
    if (!useBrotli && !useGzip) return payload

    const compressed = useBrotli ? zlib.brotliCompressSync(buffer) : zlib.gzipSync(buffer)
    const vary = reply.getHeader('vary')
    reply.header('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
    reply.header('content-encoding', useBrotli ? 'br' : 'gzip')
    reply.header('content-length', String(compressed.length))
    return compressed
  })
}

/** 安全头全部来自配置，留空表示不发送；HSTS 默认关闭，避免纯 HTTP 部署把浏览器锁死。 */
export function applySecurityHeaders(reply, headers) {
  if (!headers.enabled) return
  if (headers.contentTypeOptions && !reply.getHeader('x-content-type-options')) {
    reply.header('x-content-type-options', headers.contentTypeOptions)
  }
  if (headers.frameOptions && !reply.getHeader('x-frame-options')) {
    reply.header('x-frame-options', headers.frameOptions)
  }
  if (headers.referrerPolicy && !reply.getHeader('referrer-policy')) {
    reply.header('referrer-policy', headers.referrerPolicy)
  }
  if (headers.permissionsPolicy && !reply.getHeader('permissions-policy')) {
    reply.header('permissions-policy', headers.permissionsPolicy)
  }
  if (headers.crossOriginOpenerPolicy && !reply.getHeader('cross-origin-opener-policy')) {
    reply.header('cross-origin-opener-policy', headers.crossOriginOpenerPolicy)
  }
  if (headers.hsts.enabled) {
    let value = `max-age=${headers.hsts.maxAgeSeconds}`
    if (headers.hsts.includeSubdomains) value += '; includeSubDomains'
    if (headers.hsts.preload) value += '; preload'
    reply.header('strict-transport-security', value)
  }
}

/** 静态资源缓存头：带内容指纹的文件用 immutable 长缓存，其余用普通 max-age。 */
export function staticCacheHeaders(config) {
  const cache = config.middleware.staticCache
  if (!cache.enabled) return {}
  return { 'cache-control': `public, max-age=${cache.maxAgeSeconds}` }
}

export function staticCacheHeaderFor(config, filePath) {
  const cache = config.middleware.staticCache
  if (!cache.enabled) return {}
  const hashed = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i.test(String(filePath))
  if (hashed) {
    return { 'cache-control': `public, max-age=${cache.immutableMaxAgeSeconds}, immutable` }
  }
  return { 'cache-control': `public, max-age=${cache.maxAgeSeconds}` }
}

function isCompressible(contentType) {
  return /^(application\/json|text\/|image\/svg\+xml|application\/javascript|application\/xml)/.test(contentType)
}
