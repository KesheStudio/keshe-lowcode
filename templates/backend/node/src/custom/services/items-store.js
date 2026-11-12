// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// items 的存储服务扩展点。默认用 SQLite / MySQL / PostgreSQL 的 items 表；
// 换成别的存储只改这个文件，只要保持下面导出的函数签名不变，处理器和其他模块都不用动。
import crypto from 'node:crypto'

const SELECT_COLUMNS = 'id, title, body, created_at, updated_at'

export async function listItems(db, { limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM items ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  )
  const { rows: countRows } = await db.query('SELECT COUNT(*) AS n FROM items')
  return { items: rows.map(rowToItem), total: Number(countRows[0].n) }
}

export async function getItem(db, id) {
  const { rows } = await db.query(`SELECT ${SELECT_COLUMNS} FROM items WHERE id = ?`, [id])
  return rows.length > 0 ? rowToItem(rows[0]) : null
}

export async function createItem(db, { title, body }) {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await db.query('INSERT INTO items (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    title,
    body,
    now,
    now
  ])
  return getItem(db, id)
}

export async function updateItem(db, id, { title, body }) {
  const now = new Date().toISOString()
  const result = await db.query('UPDATE items SET title = ?, body = ?, updated_at = ? WHERE id = ?', [
    title,
    body,
    now,
    id
  ])
  if (result.changes === 0) return null
  return getItem(db, id)
}

export async function deleteItem(db, id) {
  const result = await db.query('DELETE FROM items WHERE id = ?', [id])
  return result.changes > 0
}

function rowToItem(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
