// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 支持 sqlite / mysql / postgres 三种驱动，连接信息全部来自 config.database。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_ROOT = fileURLToPath(new URL('../../migrations/', import.meta.url))

export class DatabaseError extends Error {
  constructor(message, hints = [], reason = '') {
    super(message)
    this.name = 'DatabaseError'
    this.code = 'LC_E_DB_UNAVAILABLE'
    this.hints = hints
    this.reason = reason
  }
}

/**
 * 打开数据库、探测连接并执行未应用的迁移。
 * 连接失败抛出 DatabaseError（含排查提示），由启动入口统一打印。
 */
export async function openDatabase(config, { cwd = process.cwd(), migrate = true } = {}) {
  const target = resolveTarget(config.database, cwd)
  const adapter = await createAdapter(target)
  try {
    await adapter.ping()
  } catch (err) {
    await adapter.close()
    throw mapDatabaseError(err, target, 'connect')
  }
  if (migrate) await runMigrations(adapter, target)
  return adapter
}

export async function checkDatabase(adapter) {
  await adapter.ping()
}

export function describeTarget(db) {
  if (db.driver === 'sqlite') return `sqlite ${db.database}`
  return `${db.driver} ${db.host}:${db.port}/${db.database}`
}

// ---------------------------------------------------------------- 连接目标解析

function resolveTarget(db, cwd) {
  const scheme = db.url === '' ? null : db.url.split('://')[0]
  const driver = scheme === 'postgresql' ? 'postgres' : scheme || db.driver
  if (driver === 'sqlite') {
    const raw = db.url === '' ? `data/${db.name}.db` : db.url.slice('sqlite://'.length).split('?')[0]
    if (raw === '') throw new DatabaseError('database.url 缺少 SQLite 文件路径', ['把 database.url 改成 sqlite://data/app.db 或留空用 database.name'])
    const file = raw === ':memory:' ? raw : path.resolve(cwd, raw)
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    return {
      driver,
      file,
      database: file,
      maxOpenConns: db.maxOpenConns,
      connectTimeoutSeconds: db.connectTimeoutSeconds
    }
  }

  const defaultPort = driver === 'mysql' ? 3306 : 5432
  let host = db.host
  let port = db.port || defaultPort
  let name = db.name
  let user = db.user
  let password = db.password
  if (db.url !== '') {
    let parsed
    try {
      parsed = new URL(db.url.replace(/^postgresql:/, 'postgres:'))
    } catch {
      throw new DatabaseError('database.url 格式不合法', ['示例：mysql://user:pass@db.example.com:13306/app 或 postgres://user:pass@db.example.com:15432/app'], 'invalid url')
    }
    host = parsed.hostname || host
    port = Number(parsed.port) || defaultPort
    name = parsed.pathname.replace(/^\//, '') || name
    user = decodeURIComponent(parsed.username || user)
    password = decodeURIComponent(parsed.password || password)
  }
  if (!name) throw new DatabaseError('database.name 不能为空', ['设置 database.name，或把 DATABASE_URL 写全'])
  return {
    driver,
    host,
    port,
    database: name,
    user,
    password,
    sslMode: db.sslMode,
    maxOpenConns: db.maxOpenConns,
    connectTimeoutSeconds: db.connectTimeoutSeconds
  }
}

// ---------------------------------------------------------------- 驱动适配

async function createAdapter(target) {
  if (target.driver === 'sqlite') return createSqliteAdapter(target)
  if (target.driver === 'mysql') return createMysqlAdapter(target)
  if (target.driver === 'postgres') return createPostgresAdapter(target)
  throw new DatabaseError(`不支持的数据库驱动：${target.driver}`, ['database.driver 只能是 sqlite / mysql / postgres'])
}

function createSqliteAdapter(target) {
  const db = new DatabaseSync(target.file)
  if (target.file !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL')
    } catch {
      // 某些文件系统不支持 WAL，回退默认模式，不影响正确性
    }
  }
  db.exec('PRAGMA foreign_keys = ON')

  const isSelect = (sql) => /^\s*(select|with)\b/i.test(sql)
  return {
    driver: 'sqlite',
    target,
    query(sql, params = []) {
      if (isSelect(sql)) {
        const rows = db.prepare(sql).all(...params)
        return { rows, rowCount: rows.length, changes: 0 }
      }
      const result = db.prepare(sql).run(...params)
      return { rows: [], rowCount: result.changes, changes: result.changes }
    },
    async exec(sql) {
      db.exec(sql)
    },
    async ping() {
      db.prepare('SELECT 1 AS ok').get()
    },
    async transaction(fn) {
      db.exec('BEGIN')
      try {
        const result = await fn(this)
        db.exec('COMMIT')
        return result
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // 回滚失败时保留原始错误
        }
        throw err
      }
    },
    async close() {
      db.close()
    }
  }
}

async function createMysqlAdapter(target) {
  let mysql
  try {
    mysql = await import('mysql2/promise')
  } catch {
    throw new DatabaseError('缺少 MySQL 驱动依赖 mysql2', ['在 server/ 目录执行 npm ci --omit=dev 后重试'])
  }
  const pool = mysql.createPool({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    connectionLimit: target.maxOpenConns || 10,
    connectTimeout: (target.connectTimeoutSeconds || 5) * 1000,
    ssl: target.sslMode === 'require' ? {} : undefined,
    charset: 'utf8mb4'
  })
  return {
    driver: 'mysql',
    target,
    async query(sql, params = []) {
      const [rows] = await pool.query(sql, params)
      if (Array.isArray(rows)) return { rows, rowCount: rows.length, changes: 0 }
      return { rows: [], rowCount: rows.affectedRows || 0, changes: rows.affectedRows || 0 }
    },
    async exec(sql) {
      await pool.query(sql)
    },
    async ping() {
      await pool.query('SELECT 1 AS ok')
    },
    async transaction(fn) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const tx = {
          ...this,
          query: async (sql, params = []) => {
            const [rows] = await conn.query(sql, params)
            if (Array.isArray(rows)) return { rows, rowCount: rows.length, changes: 0 }
            return { rows: [], rowCount: rows.affectedRows || 0, changes: rows.affectedRows || 0 }
          },
          exec: async (sql) => conn.query(sql)
        }
        const result = await fn(tx)
        await conn.commit()
        return result
      } catch (err) {
        try {
          await conn.rollback()
        } catch {
          // MySQL 的 DDL 会隐式提交，回滚只能覆盖 DML
        }
        throw err
      } finally {
        conn.release()
      }
    },
    async close() {
      await pool.end()
    }
  }
}

async function createPostgresAdapter(target) {
  let pg
  try {
    pg = await import('pg')
  } catch {
    throw new DatabaseError('缺少 PostgreSQL 驱动依赖 pg', ['在 server/ 目录执行 npm ci --omit=dev 后重试'])
  }
  const pool = new pg.Pool({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    max: target.maxOpenConns || 10,
    connectionTimeoutMillis: (target.connectTimeoutSeconds || 5) * 1000,
    ssl: target.sslMode === 'require' ? { rejectUnauthorized: false } : undefined
  })
  // 空闲连接被数据库断开时 pg 会向 Pool 发 error 事件；没有监听器会直接终止进程。
  // 请求期间的失败由 query 抛错，统一映射成 LC_E_DB_UNAVAILABLE。
  pool.on('error', (err) => {
    console.warn(`[db] 空闲连接断开：${err.message}`)
  })
  return {
    driver: 'postgres',
    target,
    async query(sql, params = []) {
      const result = await pool.query(toPgPlaceholders(sql), params)
      return { rows: result.rows, rowCount: result.rowCount || 0, changes: result.rowCount || 0 }
    },
    async exec(sql) {
      await pool.query(toPgPlaceholders(sql))
    },
    async ping() {
      await pool.query('SELECT 1 AS ok')
    },
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tx = {
          ...this,
          query: async (sql, params = []) => {
            const result = await client.query(toPgPlaceholders(sql), params)
            return { rows: result.rows, rowCount: result.rowCount || 0, changes: result.rowCount || 0 }
          },
          exec: async (sql) => client.query(toPgPlaceholders(sql))
        }
        const result = await fn(tx)
        await client.query('COMMIT')
        return result
      } catch (err) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // 保留原始错误
        }
        throw err
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    }
  }
}

function toPgPlaceholders(sql) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

// ---------------------------------------------------------------- 迁移

export async function runMigrations(adapter, target = adapter.target) {
  try {
    await adapter.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)')
    const { rows } = await adapter.query('SELECT version FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.version))
    const result = { applied: [], skipped: 0 }

    for (const migration of collectMigrations('up')) {
      if (applied.has(migration.version)) {
        result.skipped++
        continue
      }
      await adapter.transaction(async (tx) => {
        for (const statement of splitStatements(migration.sql)) await tx.exec(statement)
        await tx.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
          migration.version,
          new Date().toISOString()
        ])
      })
      result.applied.push(migration.version)
    }
    return result
  } catch (err) {
    throw mapDatabaseError(err, target, 'migrate')
  }
}

export async function rollbackLastMigration(adapter, target = adapter.target) {
  try {
    await adapter.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)')
    const { rows } = await adapter.query('SELECT version FROM schema_migrations ORDER BY version DESC')
    for (const row of rows) {
      const down = collectMigrations('down').find((migration) => migration.version === row.version)
      if (!down) {
        throw new DatabaseError(
          `迁移 ${row.version} 没有对应的 down 脚本`,
          [`在 migrations/down/${row.version}.sql 写回滚 SQL 后重试`],
          'missing down'
        )
      }
      await adapter.transaction(async (tx) => {
        for (const statement of splitStatements(down.sql)) await tx.exec(statement)
        await tx.query('DELETE FROM schema_migrations WHERE version = ?', [row.version])
      })
      return { rolledBack: row.version }
    }
    return { rolledBack: null }
  } catch (err) {
    if (err instanceof DatabaseError) throw err
    throw mapDatabaseError(err, target, 'migrate-down')
  }
}

function collectMigrations(direction) {
  const zone = direction === 'down' ? 'down' : null
  const dirs = zone
    ? [[zone, path.join(MIGRATIONS_ROOT, zone)]]
    : [['generated', path.join(MIGRATIONS_ROOT, 'generated')], ['custom', path.join(MIGRATIONS_ROOT, 'custom')]]
  const out = []
  const seen = new Set()
  for (const [name, dir] of dirs) {
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()
    for (const file of files) {
      const version = file.slice(0, -4)
      if (direction === 'down' && !/^\d/.test(version)) continue
      if (seen.has(version)) throw new DatabaseError(`迁移版本重复：${version}`, ['generated 与 custom 目录里的迁移文件名不能重复'])
      seen.add(version)
      out.push({ version, zone: name, sql: fs.readFileSync(path.join(dir, file), 'utf8') })
    }
  }
  return out
}

function splitStatements(sql) {
  const withoutLineComments = sql
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*--.*$/, ''))
    .join('\n')
  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

// ---------------------------------------------------------------- 错误映射

export function mapDatabaseError(err, target, action = 'connect') {
  const code = String(err.code || '')
  const reason = code || String(err.errno || '')
  const where = describeTarget({ ...target, driver: target.driver })
  const timeout = target.connectTimeoutSeconds || 5
  const common = [
    '确认数据库服务已启动，且 host/port 可从本机访问',
    '确认 database.name 已创建（MySQL: CREATE DATABASE ...；PostgreSQL: CREATE DATABASE ...）',
    '确认 database.user / LC_DB_PASSWORD 有该库的权限',
    '确认防火墙、VPN、SSL 配置没有拦截连接'
  ]

  if (code === 'ER_BAD_DB_ERROR' || code === '3D000' || code === '1049') {
    return new DatabaseError(`数据库不存在（${where}）`, [
      `先创建数据库：${target.driver === 'postgres' ? 'CREATE DATABASE ' + target.database + ';' : 'CREATE DATABASE ' + target.database + ';'}`,
      ...common
    ], reason)
  }
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === '28P01' || code === '1045') {
    return new DatabaseError(`数据库认证失败（${where}）`, [
      '检查 database.user 与 LC_DB_PASSWORD 是否匹配',
      ...common
    ], reason)
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new DatabaseError(`无法连接数据库（${where}）`, [
      '确认数据库服务监听在 database.host:database.port',
      ...common
    ], reason)
  }
  if (code === 'ETIMEDOUT' || code === 'ETIMEDOUT ') {
    return new DatabaseError(`数据库连接超时（${where}，${timeout}s）`, [
      '检查网络与防火墙；本机数据库可把 database.connectTimeoutSeconds 调大后重试',
      ...common
    ], reason)
  }
  if (target.driver === 'sqlite' && /unable to open|CANTOPEN/i.test(String(err.message || ''))) {
    return new DatabaseError(`SQLite 文件无法打开（${where}）`, [
      '确认 database.url 的目录存在且当前用户可写',
      '确认没有其他进程以只读方式占用该文件'
    ], reason)
  }
  return new DatabaseError(`数据库操作失败（${where}，阶段：${action}）`, [
    '查看服务日志里的驱动错误码，再按码排查',
    ...common
  ], reason)
}

export function formatDatabaseError(err) {
  const lines = [`[${err.code}] ${err.message}`]
  if (err.reason) lines.push(`  驱动错误码：${err.reason}`)
  for (const hint of err.hints || []) lines.push(`  - ${hint}`)
  return lines.join('\n')
}
