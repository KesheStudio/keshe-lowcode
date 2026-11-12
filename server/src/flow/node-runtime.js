// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 积木流程运行时：表达式求值、集合读写、文件与外部 HTTP、中间件 hooks。
// 说明：这个文件是编译器的模板，编辑 lowcode/server/src/flow/node-runtime.js 即可影响所有生成结果。
import fs from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

const exprCache = new Map()
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i
]
const MAX_FILE_BYTES = 1024 * 1024
const MAX_HTTP_BYTES = 1024 * 1024

export function createScope(ctx) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'request') return ctx.request
      return ctx.vars[prop]
    },
    has() {
      return true
    }
  })
}

export function evaluateCompiled(source, ctx) {
  let fn = exprCache.get(source)
  if (!fn) {
    fn = new Function('scope', '"use strict"; return (' + source + ');')
    exprCache.set(source, fn)
  }
  return fn(createScope(ctx))
}

export function toInt(value, fallback, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const int = Math.trunc(num)
  if (int < min) return min
  if (int > max) return max
  return int
}

export function toArray(value) {
  return Array.isArray(value) ? value : []
}

function collectionRequest(request, query) {
  return { headers: request.headers, query }
}

export async function readCollection(deps, request, collectionId, options = {}) {
  const maxPageSize = Number(deps.config && deps.config.dataApi && deps.config.dataApi.maxPageSize) || 100
  const page = toInt(options.page, 1, 1, 1000000)
  const pageSize = toInt(options.pageSize, 20, 1, maxPageSize)
  const query = { page, pageSize }
  if (options.q !== undefined && options.q !== null && String(options.q) !== '') query.q = String(options.q)
  if (options.filter && typeof options.filter === 'object' && !Array.isArray(options.filter)) {
    const filter = {}
    for (const key of Object.keys(options.filter)) {
      const value = options.filter[key]
      if (value !== undefined && value !== null && String(value) !== '') filter[key] = value
    }
    if (Object.keys(filter).length) query.filter = JSON.stringify(filter)
  }
  if (options.sort) query.sort = String(options.sort)
  if (options.fields) query.fields = String(options.fields)
  return deps.data.list(collectionId, collectionRequest(request, query))
}

export async function insertCollection(deps, request, collectionId, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'LC_E_FLOW_BODY', '写入集合的内容必须是对象')
  }
  return deps.data.create(collectionId, { headers: request.headers, body })
}

function dataFilesRoot() {
  return path.resolve(process.cwd(), 'data/files')
}

function safeDataPath(relative) {
  const text = String(relative || '')
  if (!text || path.isAbsolute(text)) {
    throw new AppError(400, 'LC_E_FLOW_FILE', '文件路径必须是 data/files 下的相对路径')
  }
  const root = dataFilesRoot()
  const target = path.resolve(root, text)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new AppError(400, 'LC_E_FLOW_FILE', '文件路径越界：' + text)
  }
  return target
}

export async function readDataFile(relative, encoding = 'utf8') {
  const target = safeDataPath(relative)
  const stat = await fs.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) {
    throw new AppError(404, 'LC_E_FLOW_FILE', '文件不存在：' + relative)
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new AppError(413, 'LC_E_FLOW_FILE', '文件超过 1 MB 上限：' + relative)
  }
  const buffer = await fs.readFile(target)
  return encoding === 'base64' ? buffer.toString('base64') : buffer.toString('utf8')
}

export async function writeDataFile(relative, content, options = {}) {
  const target = safeDataPath(relative)
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new AppError(413, 'LC_E_FLOW_FILE', '写入内容超过 1 MB 上限：' + relative)
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (options.append) {
    await fs.appendFile(target, text, 'utf8')
  } else {
    await fs.writeFile(target, text, 'utf8')
  }
  return { path: relative, bytes: Buffer.byteLength(text, 'utf8') }
}

function blockedHost(hostname) {
  return BLOCKED_HOSTS.some((re) => re.test(String(hostname || '')))
}

export async function requestJson(url, options = {}) {
  let target
  try {
    target = new URL(String(url))
  } catch {
    throw new AppError(400, 'LC_E_FLOW_HTTP', '外部 HTTP 地址不合法')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new AppError(400, 'LC_E_FLOW_HTTP', '外部 HTTP 只允许 http / https')
  }
  if (blockedHost(target.hostname)) {
    throw new AppError(400, 'LC_E_FLOW_HTTP', '流程不允许访问本机或内网地址：' + target.hostname)
  }

  const controller = new AbortController()
  const timeoutMs = toInt(options.timeoutMs, 8000, 100, 60000)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const method = String(options.method || 'GET').toUpperCase()
  const headers = options.headers && typeof options.headers === 'object' ? options.headers : {}
  let body
  if (options.body !== undefined && options.body !== null && options.body !== '' && method !== 'GET' && method !== 'HEAD') {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json'
  }

  try {
    const response = await fetch(target, { method, headers, body, signal: controller.signal })
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_HTTP_BYTES) {
      throw new AppError(413, 'LC_E_FLOW_HTTP', '外部响应超过 1 MB 上限')
    }
    const text = buffer.toString('utf8')
    let data = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      data
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    if (err && err.name === 'AbortError') {
      throw new AppError(504, 'LC_E_FLOW_HTTP', `外部 HTTP 超时（${timeoutMs}ms）`)
    }
    throw new AppError(502, 'LC_E_FLOW_HTTP', '外部 HTTP 请求失败：' + (err && err.message ? err.message : String(err)))
  } finally {
    clearTimeout(timer)
  }
}

export function validateEntryParams(rules) {
  const list = Array.isArray(rules) ? rules : []
  return async function validateFlowEntry(request) {
    for (const rule of list) {
      const source = rule.in === 'body'
        ? (request.body && typeof request.body === 'object' ? request.body : {})
        : rule.in === 'header'
          ? (request.headers || {})
          : rule.in === 'params'
            ? (request.params || {})
            : (request.query || {})
      const raw = source[rule.name]
      if (raw === undefined || raw === null || raw === '') {
        if (rule.required) {
          throw new AppError(400, 'LC_E_INVALID_ARGUMENT', `缺少必填参数：${rule.name}`, '', rule.name)
        }
        continue
      }
      if (rule.type === 'number' && !Number.isFinite(Number(raw))) {
        throw new AppError(400, 'LC_E_INVALID_ARGUMENT', `参数 ${rule.name} 必须是数字`, '', rule.name)
      }
      if (rule.type === 'boolean' && !['true', 'false', '1', '0'].includes(String(raw))) {
        throw new AppError(400, 'LC_E_INVALID_ARGUMENT', `参数 ${rule.name} 必须是布尔值`, '', rule.name)
      }
    }
  }
}

export function applyCors(options = {}) {
  const origins = Array.isArray(options.origins) ? options.origins : []
  const credentials = options.credentials === true
  const maxAge = toInt(options.maxAgeSeconds, 600, 0, 86400)
  const wildcard = origins.includes('*')
  return {
    onRequest: async (request, reply) => {
      const origin = request.headers.origin
      let allowOrigin = ''
      if (wildcard && !credentials) allowOrigin = '*'
      else if (origin && origins.includes(origin)) allowOrigin = origin
      else if (!origin && origins.length === 1) allowOrigin = origins[0]
      if (!allowOrigin) {
        if (request.method === 'OPTIONS') return reply.code(204).send()
        return
      }
      reply.header('access-control-allow-origin', allowOrigin)
      reply.header('vary', 'Origin')
      if (credentials) reply.header('access-control-allow-credentials', 'true')
      if (request.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        reply.header('access-control-allow-headers', request.headers['access-control-request-headers'] || 'content-type,authorization')
        reply.header('access-control-max-age', String(maxAge))
        return reply.code(204).send()
      }
    }
  }
}

export function createRequestLog(options = {}) {
  const level = ['debug', 'info', 'warn'].includes(options.level) ? options.level : 'info'
  const skipHealth = options.skipHealth !== false
  return {
    onRequest: async (request) => {
      request.__lcFlowStart = Date.now()
    },
    onResponse: async (request, reply) => {
      if (skipHealth && (request.url || '').startsWith('/api/health')) return
      const ms = Date.now() - (request.__lcFlowStart || Date.now())
      const record = { method: request.method, url: request.url, status: reply.statusCode, ms }
      if (request.log && typeof request.log[level] === 'function') {
        request.log[level](record, 'flow request')
      } else {
        const write = console[level] || console.log
        write.call(console, JSON.stringify(record))
      }
    }
  }
}

export function createRateLimiter(options = {}) {
  const rps = Math.max(1, Number(options.rps) || 20)
  const capacity = Math.max(rps, Number(options.burst) || rps)
  const keyBy = options.keyBy === 'token' ? 'token' : 'ip'
  const buckets = new Map()
  return async function rateLimitFlow(request, reply) {
    const now = Date.now()
    let key = request.ip || 'unknown'
    if (keyBy === 'token') {
      const authorization = String(request.headers.authorization || '')
      key = authorization ? authorization.slice(-24) : key
    }
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { tokens: capacity, last: now }
      buckets.set(key, bucket)
    }
    const elapsed = (now - bucket.last) / 1000
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * rps)
    bucket.last = now
    if (bucket.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / rps))
      reply.header('retry-after', String(retryAfter))
      throw new AppError(429, 'LC_E_RATE_LIMIT', '请求过于频繁，请稍后再试')
    }
    bucket.tokens -= 1
    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (now - v.last > 60000) buckets.delete(k)
      }
    }
  }
}

export function requireAuth(deps, roles = []) {
  const allowed = Array.isArray(roles) ? roles : []
  return async function authGuard(request) {
    const context = await deps.auth.authenticate(request)
    if (allowed.length && !(context.roles || []).some((role) => allowed.includes(role))) {
      throw new AppError(403, 'LC_E_FORBIDDEN', '当前角色不能访问该接口')
    }
  }
}

export function pickFields(source, fields) {
  const keys = Array.isArray(fields) ? fields.filter(Boolean) : []
  const pick = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError(422, 'LC_E_FLOW_TRANSFORM', '数据变换需要对象或对象数组')
    }
    const out = {}
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key]
    }
    return out
  }
  if (Array.isArray(source)) return source.map(pick)
  return pick(source)
}

export function sendJson(reply, status, body, headers) {
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, String(value))
    }
  }
  return reply.code(toInt(status, 200, 100, 599)).send(body === undefined ? null : body)
}

export function wrapNodeError(nodeId, label, err) {
  if (err instanceof AppError) {
    if (!err.nodeId) {
      err.nodeId = nodeId
      err.detail = err.detail ? `${err.detail}；节点 ${label}（${nodeId}）` : `节点 ${label}（${nodeId}）`
    }
    return err
  }
  const wrapped = new AppError(
    500,
    'LC_E_FLOW_NODE',
    `节点执行失败：${label}`,
    `${err && err.message ? err.message : String(err)}（节点 ${nodeId}）`
  )
  wrapped.nodeId = nodeId
  return wrapped
}
