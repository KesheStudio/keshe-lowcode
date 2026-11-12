// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// 这是 items 接口的处理器扩展点。只改这个文件就能调整 /api/items 的入参校验与返回结构。
// 需要换存储实现时，改 ../services/items-store.js，不必动这里。
// 缓存是可选的：未配置 Redis 时 cache 会降级为进程内存，行为不变。
import { invalidArgument, notFound, okBody } from '../../generated/errors.js'
import { createItem, deleteItem, getItem, listItems, updateItem } from '../services/items-store.js'

const MAX_TITLE = 200
const MAX_BODY = 20000

const itemKey = (config, id) => `${config.cache.keyPrefix}items:${id}`

export async function list({ db, request }) {
  const limit = readInteger(request.query.limit, 20, 'limit', 1, 100)
  const offset = readInteger(request.query.offset, 0, 'offset', 0, Number.MAX_SAFE_INTEGER)
  const { items, total } = await listItems(db, { limit, offset })
  return okBody({ items, total, limit, offset })
}

export async function get({ db, cache, config, request }) {
  const cached = await cache.get(itemKey(config, request.params.id))
  if (cached) {
    try {
      return okBody(JSON.parse(cached))
    } catch {
      // 缓存内容损坏时忽略，回源查询
    }
  }
  const item = await getItem(db, request.params.id)
  if (!item) throw notFound('items 记录不存在')
  await cache.set(itemKey(config, request.params.id), JSON.stringify(item), config.cache.ttlSeconds)
  return okBody(item)
}

export async function create({ db, cache, config, request, reply }) {
  const input = readItemInput(request.body)
  const item = await createItem(db, input)
  await cache.del(itemKey(config, item.id))
  return reply.code(201).send(okBody(item))
}

export async function update({ db, cache, config, request }) {
  const input = readItemInput(request.body)
  const item = await updateItem(db, request.params.id, input)
  if (!item) throw notFound('items 记录不存在')
  await cache.del(itemKey(config, item.id))
  return okBody(item)
}

export async function remove({ db, cache, config, request }) {
  if (!(await deleteItem(db, request.params.id))) throw notFound('items 记录不存在')
  await cache.del(itemKey(config, request.params.id))
  return okBody({ id: request.params.id })
}

function readInteger(raw, fallback, field, min, max) {
  if (raw === undefined) return fallback
  if (Array.isArray(raw)) throw invalidArgument(field, `${field} 只能出现一次`)
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalidArgument(field, `${field} 必须是 ${min}-${max} 的整数`)
  }
  return value
}

function readItemInput(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidArgument('body', '请求体必须是 JSON 对象')
  }
  const title = body.title
  if (typeof title !== 'string' || title.trim() === '') {
    throw invalidArgument('title', 'title 必须是非空字符串')
  }
  if (title.trim().length > MAX_TITLE) {
    throw invalidArgument('title', `title 最长 ${MAX_TITLE} 个字符`)
  }
  const detail = body.body === undefined ? '' : body.body
  if (typeof detail !== 'string') throw invalidArgument('body', 'body 必须是字符串')
  if (detail.length > MAX_BODY) throw invalidArgument('body', `body 最长 ${MAX_BODY} 个字符`)
  return { title: title.trim(), body: detail }
}
