// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 可选缓存：memory（默认）/ redis / none。Redis 不可用时自动降级为进程内存，
// 不会因为没装 Redis 导致服务起不来。
import net from 'node:net'

export async function openCache(config, { logger = console, connectTimeoutSeconds = 5 } = {}) {
  // 缓存开关关闭时按 cache.fallback 回退；回退目标必须是可用状态，不能静默让接口 500。
  if (config.enabled === false) {
    if (config.fallback === 'none') {
      logger.warn?.('[warn] 缓存已关闭（cache.enabled=false），已回退为无缓存模式（读接口直读数据库）')
      return new NoopCache(true)
    }
    logger.warn?.('[warn] 缓存已关闭（cache.enabled=false），已回退为进程内存缓存（多实例不共享）')
    return new MemoryCache('memory', true)
  }

  if (config.driver === 'none') return new NoopCache(false)
  const memory = new MemoryCache('memory', false)
  if (config.driver === 'memory') return memory

  let redis
  try {
    redis = await RedisCache.connect(config, logger, connectTimeoutSeconds)
    return redis
  } catch (err) {
    const reason = `Redis 不可用（${err.message}）`
    if (config.fallback === 'none') {
      logger.warn?.(`[warn] ${reason}，已回退为无缓存模式（读接口直读数据库）`)
      return new NoopCache(true)
    }
    logger.warn?.(`[warn] ${reason}，已降级为进程内存缓存`)
    memory.fallback = true
    return memory
  }
}

class NoopCache {
  constructor(fallback) {
    this.driver = 'none'
    this.fallback = fallback
  }
  async get() { return null }
  async set() {}
  async del() {}
  async close() {}
}

class MemoryCache {
  constructor(driver, fallback) {
    this.driver = driver
    this.fallback = fallback
    this.map = new Map()
  }

  async get(key) {
    const entry = this.map.get(key)
    if (!entry) return null
    if (entry.expiresAt !== 0 && Date.now() >= entry.expiresAt) {
      this.map.delete(key)
      return null
    }
    return entry.value
  }

  async set(key, value, ttlSeconds) {
    this.map.set(key, { value, expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0 })
  }

  async del(key) {
    this.map.delete(key)
  }

  async close() {}
}

class RedisCache extends MemoryCache {
  constructor(socket, options, logger) {
    super('redis', false)
    this.socket = socket
    this.ttlSeconds = options.ttlSeconds
    this.queue = Promise.resolve()
    this.buffer = ''
    this.pending = null
    this.logger = logger
  }

  static async connect(config, logger, connectTimeoutSeconds) {
    const options = parseRedisUrl(config.url)
    if (!options) throw new Error('cache.url 必须是 redis://[:password@]host:port/db')
    const socket = await connectSocket(options, connectTimeoutSeconds)
    const client = new RedisCache(socket, { ...options, ttlSeconds: config.ttlSeconds }, logger)
    client.onClose = () => client.degrade('Redis 连接已断开')
    socket.on('close', client.onClose)
    socket.on('error', client.onClose)
    socket.on('data', (chunk) => client.onData(chunk))
    await client.command(['PING'])
    return client
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8')
    while (true) {
      const parsed = parseResp(this.buffer, 0)
      if (!parsed) return
      this.buffer = this.buffer.slice(parsed.next)
      const pending = this.pending
      this.pending = null
      if (!pending) continue
      if (parsed.error) pending.reject(new Error(parsed.error))
      else pending.resolve(parsed.value)
    }
  }

  command(args) {
    const run = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null
          this.degrade('Redis 命令超时')
          reject(new Error('Redis 命令超时'))
        }, 5000)
        this.pending = {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (err) => {
            clearTimeout(timer)
            reject(err)
          }
        }
        this.socket.write(encodeCommand(args))
      })
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  degrade(reason) {
    if (this.driver === 'memory') return
    this.driver = 'memory'
    this.fallback = true
    this.logger.warn?.(`[warn] ${reason}，已降级为进程内存缓存`)
    this.socket.destroy()
  }

  async get(key) {
    if (this.driver === 'redis') {
      try {
        return await this.command(['GET', key])
      } catch (err) {
        this.degrade(`Redis GET 失败（${err.message}）`)
      }
    }
    return super.get(key)
  }

  async set(key, value, ttlSeconds) {
    if (this.driver === 'redis') {
      try {
        await this.command(ttlSeconds > 0 ? ['SETEX', key, String(ttlSeconds), value] : ['SET', key, value])
        return
      } catch (err) {
        this.degrade(`Redis SET 失败（${err.message}）`)
      }
    }
    await super.set(key, value, ttlSeconds)
  }

  async del(key) {
    if (this.driver === 'redis') {
      try {
        await this.command(['DEL', key])
      } catch (err) {
        this.degrade(`Redis DEL 失败（${err.message}）`)
      }
    }
    await super.del(key)
  }

  async close() {
    this.socket.destroy()
  }
}

function parseRedisUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'redis:') return null
  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port) || 6379,
    password: decodeURIComponent(parsed.password || ''),
    db: Number(parsed.pathname.replace(/^\//, '')) || 0
  }
}

function connectSocket(options, timeoutSeconds = 5) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: options.host, port: options.port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`连接超时（${timeoutSeconds}s）`))
    }, timeoutSeconds * 1000)
    socket.setTimeout(0)
    socket.once('connect', async () => {
      clearTimeout(timer)
      try {
        if (options.password) awaitExchange(socket, ['AUTH', options.password])
        if (options.db) awaitExchange(socket, ['SELECT', String(options.db)])
        resolve(socket)
      } catch (err) {
        socket.destroy()
        reject(err)
      }
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// 建连阶段的一次性命令：等一个完整回复。
function awaitExchange(socket, args) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const parsed = parseResp(buffer, 0)
      if (!parsed) return
      socket.off('data', onData)
      if (parsed.error) reject(new Error(parsed.error))
      else resolve(parsed.value)
    }
    socket.on('data', onData)
    socket.write(encodeCommand(args))
  })
}

function encodeCommand(args) {
  let out = `*${args.length}\r\n`
  for (const arg of args) out += `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`
  return out
}

function parseResp(buffer, offset) {
  if (offset >= buffer.length) return null
  const type = buffer[offset]
  const end = buffer.indexOf('\r\n', offset + 1)
  if (end === -1) return null
  const line = buffer.slice(offset + 1, end)
  if (type === '+') return { value: line, next: end + 2 }
  if (type === '-') return { error: line, next: end + 2 }
  if (type === ':') return { value: Number(line), next: end + 2 }
  if (type === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, next: end + 2 }
    const start = end + 2
    const finish = start + length
    if (buffer.length < finish + 2) return null
    return { value: buffer.slice(start, finish), next: finish + 2 }
  }
  if (type === '*') {
    const count = Number(line)
    if (count === -1) return { value: null, next: end + 2 }
    const items = []
    let cursor = end + 2
    for (let i = 0; i < count; i++) {
      const item = parseResp(buffer, cursor)
      if (!item) return null
      items.push(item.error ? null : item.value)
      cursor = item.next
    }
    return { value: items, next: cursor }
  }
  return { error: `无法识别的 RESP 响应：${line}`, next: buffer.length }
}
