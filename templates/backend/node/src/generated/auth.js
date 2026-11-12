// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 认证中心：注册 / 登录 / 刷新 / 登出 / 当前用户 / 最小 RBAC。
// 默认令牌方案是 JWT（短时 access）+ 数据库刷新令牌（可撤销）；auth.tokenMode=session 时改用服务端会话。
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { AppError } from './errors.js'

const scrypt = promisify(crypto.scrypt)

// 密码哈希参数：scrypt N=2^15, r=8, p=1, 64 字节输出。
// 前缀里的版本与参数用于升级：以后换 Argon2id 时按前缀分发，旧哈希在登录成功后可重算。
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 }
const SCRYPT_PREFIX = `scrypt$1$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`

const nowIso = () => new Date().toISOString()
const laterIso = (seconds) => new Date(Date.now() + seconds * 1000).toISOString()

// ---------------------------------------------------------------- 密码哈希

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT)
  return `${SCRYPT_PREFIX}${salt.toString('base64url')}$${Buffer.from(hash).toString('base64url')}`
}

function needsRehash(stored) {
  return !stored.startsWith(SCRYPT_PREFIX)
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return { ok: false, rehash: false }
  if (!stored.startsWith('scrypt$')) {
    // 未知算法前缀：拒绝而不是猜测，避免降级。
    return { ok: false, rehash: false }
  }
  const parts = stored.split('$')
  if (parts.length !== 7 || parts[1] !== '1') return { ok: false, rehash: false }
  const [, , n, r, p, saltB64, hashB64] = parts
  const params = { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem }
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return { ok: false, rehash: false }
  }
  const salt = Buffer.from(saltB64, 'base64url')
  const expected = Buffer.from(hashB64, 'base64url')
  const actual = Buffer.from(await scrypt(password, salt, expected.length, params))
  const ok = actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  return { ok, rehash: ok && needsRehash(stored) }
}

// 用户不存在时也做一次同成本校验，避免用响应时间判断账号是否存在。
let dummyHashPromise = null
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('lc-dummy-password-for-timing')
  return dummyHashPromise
}

// ---------------------------------------------------------------- 令牌

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex')
const randomToken = () => crypto.randomBytes(32).toString('base64url')

function signJwt(payload, secret) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyJwt(token, secret) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!header || header.alg !== 'HS256') return null
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest())
  const actual = Buffer.from(parts[2], 'base64url')
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload.sub !== 'string') return null
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null
  return payload
}

// ---------------------------------------------------------------- 数据访问

const findUserByUsername = async (db, username) =>
  (await db.query('SELECT * FROM users WHERE lower(username) = lower(?)', [username])).rows[0] || null

const findUserById = async (db, id) =>
  (await db.query('SELECT * FROM users WHERE id = ?', [id])).rows[0] || null

async function loadRoles(db, userId) {
  const { rows } = await db.query(
    `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
      ORDER BY r.name`,
    [userId]
  )
  return rows.map((row) => row.name)
}

async function loadPermissions(db, userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
      ORDER BY p.code`,
    [userId]
  )
  return rows.map((row) => row.code)
}

async function roleIdByName(db, name) {
  const row = (await db.query('SELECT id FROM roles WHERE name = ?', [name])).rows[0]
  return row ? row.id : null
}

export const unauthorized = (message = '未认证或令牌已失效') =>
  new AppError(401, 'LC_E_UNAUTHORIZED', message)

export const forbidden = (message = '没有访问该接口的权限') =>
  new AppError(403, 'LC_E_FORBIDDEN', message)

const rateLimited = (message = '尝试次数过多，请稍后再试') =>
  new AppError(429, 'LC_E_RATE_LIMITED', message)

// ---------------------------------------------------------------- 认证服务

export function createAuthService(config, db, logger = console) {
  const auth = config.auth
  const mode = auth.tokenMode
  let secret = auth.jwtSecret
  if (mode === 'jwt' && secret === '') {
    secret = crypto.randomBytes(48).toString('hex')
    logger.warn('[auth] auth.jwtSecret 未配置，已生成进程内一次性密钥；重启后所有已签发令牌失效。生产请设置 LC_AUTH_JWT_SECRET。')
  }

  async function issueTokens(user, { familyId = null, userAgent = '' } = {}) {
    const roles = await loadRoles(db, user.id)
    const permissions = await loadPermissions(db, user.id)
    if (mode === 'session') {
      const token = randomToken()
      const expiresAt = laterIso(auth.sessionTtlSeconds)
      await db.query(
        'INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user.id, tokenHash(token), nowIso(), expiresAt, null, userAgent.slice(0, 255)]
      )
      await cleanupExpired()
      return {
        accessToken: token,
        refreshToken: null,
        tokenType: 'Bearer',
        expiresIn: auth.sessionTtlSeconds,
        refreshExpiresIn: 0,
        tokenMode: mode,
        user: publicUser(user, roles, permissions)
      }
    }
    const issuedAt = Math.floor(Date.now() / 1000)
    const accessToken = signJwt(
      {
        sub: user.id,
        name: user.username,
        roles,
        mode: 'jwt',
        iat: issuedAt,
        exp: issuedAt + auth.accessTokenTtlSeconds,
        jti: crypto.randomUUID()
      },
      secret
    )
    const refreshToken = randomToken()
    await db.query(
      'INSERT INTO auth_refresh_tokens (id, user_id, token_hash, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(),
        user.id,
        tokenHash(refreshToken),
        familyId || crypto.randomUUID(),
        nowIso(),
        laterIso(auth.refreshTokenTtlSeconds),
        null
      ]
    )
    await cleanupExpired()
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: auth.accessTokenTtlSeconds,
      refreshExpiresIn: auth.refreshTokenTtlSeconds,
      tokenMode: mode,
      user: publicUser(user, roles, permissions)
    }
  }

  async function cleanupExpired() {
    const now = nowIso()
    await db.query('DELETE FROM auth_refresh_tokens WHERE expires_at <= ?', [now])
    await db.query('DELETE FROM auth_sessions WHERE expires_at <= ?', [now])
    await db.query('DELETE FROM auth_login_attempts WHERE window_started_at <= ? AND locked_until IS NULL', [
      new Date(Date.now() - auth.failureWindowSeconds * 1000).toISOString()
    ])
  }

  async function assertNotLocked(identifier) {
    const row = (await db.query('SELECT * FROM auth_login_attempts WHERE identifier = ?', [identifier])).rows[0]
    if (!row) return
    if (row.locked_until && row.locked_until > nowIso()) throw rateLimited()
    if (row.locked_until && row.locked_until <= nowIso()) {
      await db.query('DELETE FROM auth_login_attempts WHERE identifier = ?', [identifier])
      return
    }
    if (row.window_started_at <= new Date(Date.now() - auth.failureWindowSeconds * 1000).toISOString()) {
      await db.query('DELETE FROM auth_login_attempts WHERE identifier = ?', [identifier])
    }
  }

  async function recordFailure(identifier) {
    const now = nowIso()
    const row = (await db.query('SELECT * FROM auth_login_attempts WHERE identifier = ?', [identifier])).rows[0]
    const inWindow = row
      ? row.window_started_at > new Date(Date.now() - auth.failureWindowSeconds * 1000).toISOString()
      : false
    const failures = inWindow ? row.failures + 1 : 1
    const windowStart = inWindow ? row.window_started_at : now
    const lockedUntil = failures >= auth.maxLoginFailures ? new Date(Date.now() + auth.lockSeconds * 1000).toISOString() : null
    if (row) {
      await db.query(
        'UPDATE auth_login_attempts SET failures = ?, window_started_at = ?, locked_until = ? WHERE identifier = ?',
        [failures, windowStart, lockedUntil, identifier]
      )
    } else {
      await db.query(
        'INSERT INTO auth_login_attempts (identifier, failures, window_started_at, locked_until) VALUES (?, ?, ?, ?)',
        [identifier, failures, now, lockedUntil]
      )
    }
  }

  async function clearFailures(identifier) {
    await db.query('DELETE FROM auth_login_attempts WHERE identifier = ?', [identifier])
  }

  function publicUser(user, roles = [], permissions = []) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name || '',
      status: user.status,
      roles,
      permissions
    }
  }

  async function userContext(user) {
    const roles = await loadRoles(db, user.id)
    const permissions = await loadPermissions(db, user.id)
    return { user: publicUser(user, roles, permissions), roles, permissions, tokenMode: mode }
  }

  async function register({ username, password, displayName }) {
    validateCredentials(username, password, displayName)
    const existing = await findUserByUsername(db, username)
    if (existing) throw new AppError(400, 'LC_E_INVALID_ARGUMENT', '用户名已存在', '', 'username')
    const passwordHash = await hashPassword(password)
    const userId = crypto.randomUUID()
    const roleId = await roleIdByName(db, 'user')
    if (!roleId) throw new AppError(500, 'LC_E_INTERNAL', '角色表缺少 user 角色，请重新执行迁移')
    const now = nowIso()
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, username, passwordHash, displayName || '', 'active', now, now]
      )
      await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
    })
    const user = await findUserById(db, userId)
    return { status: 201, tokens: await issueTokens(user) }
  }

  async function login({ username, password, userAgent = '' }) {
    validateLogin(username, password)
    const identifier = username.trim().toLowerCase()
    await assertNotLocked(identifier)
    const user = await findUserByUsername(db, identifier)
    let result = { ok: false, rehash: false }
    if (user && user.status === 'active') {
      result = await verifyPassword(password, user.password_hash)
    } else {
      await verifyPassword(password, await dummyHash())
    }
    if (!result.ok) {
      await recordFailure(identifier)
      throw unauthorized('用户名或密码错误')
    }
    await clearFailures(identifier)
    if (result.rehash) {
      await db.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
        await hashPassword(password),
        nowIso(),
        user.id
      ])
    }
    return await issueTokens(user, { userAgent })
  }

  async function refresh({ refreshToken, sessionToken, userAgent = '' }) {
    if (mode === 'session') {
      if (!sessionToken) throw unauthorized('缺少会话令牌')
      const row = (await db.query('SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL', [
        tokenHash(sessionToken)
      ])).rows[0]
      if (!row || row.expires_at <= nowIso()) throw unauthorized()
      const user = await findUserById(db, row.user_id)
      if (!user || user.status !== 'active') throw unauthorized()
      await db.query('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?', [nowIso(), row.id])
      return await issueTokens(user, { userAgent })
    }
    if (typeof refreshToken !== 'string' || refreshToken === '') throw unauthorized('缺少刷新令牌')
    const row = (await db.query('SELECT * FROM auth_refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL', [
      tokenHash(refreshToken)
    ])).rows[0]
    if (!row || row.expires_at <= nowIso()) throw unauthorized()
    const user = await findUserById(db, row.user_id)
    if (!user || user.status !== 'active') throw unauthorized()
    await db.query('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE id = ?', [nowIso(), row.id])
    return await issueTokens(user, { familyId: row.family_id, userAgent })
  }

  async function logout(context, { refreshToken } = {}) {
    if (mode === 'session') {
      if (context.tokenHash) {
        await db.query('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [
          nowIso(),
          context.tokenHash
        ])
      }
      return { revoked: 1 }
    }
    if (typeof refreshToken === 'string' && refreshToken !== '') {
      const result = await db.query('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [
        nowIso(),
        tokenHash(refreshToken)
      ])
      return { revoked: result.changes || 0 }
    }
    const result = await db.query('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
      nowIso(),
      context.user.id
    ])
    return { revoked: result.changes || 0 }
  }

  async function authenticate(request) {
    const header = request.headers.authorization || ''
    const match = /^Bearer\s+(.+)$/i.exec(header)
    if (!match) throw unauthorized('缺少 Authorization: Bearer 令牌')
    const token = match[1].trim()
    let user
    let tokenHashValue = null
    if (mode === 'session') {
      tokenHashValue = tokenHash(token)
      const row = (await db.query('SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL', [tokenHashValue])).rows[0]
      if (!row || row.expires_at <= nowIso()) throw unauthorized()
      user = await findUserById(db, row.user_id)
    } else {
      const payload = verifyJwt(token, secret)
      if (!payload) throw unauthorized()
      user = await findUserById(db, payload.sub)
    }
    if (!user || user.status !== 'active') throw unauthorized()
    const roles = await loadRoles(db, user.id)
    const permissions = await loadPermissions(db, user.id)
    return {
      user: publicUser(user, roles, permissions),
      roles,
      permissions,
      tokenMode: mode,
      tokenHash: tokenHashValue
    }
  }

  function requirePermission(context, code) {
    if (!context.permissions.includes(code)) throw forbidden()
    return context
  }

  async function bootstrap() {
    const name = auth.bootstrap.username.trim()
    const password = auth.bootstrap.password
    if (!name || !password) return
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(name)) {
      logger.warn('[auth] 引导管理员用户名不合法，已跳过创建')
      return
    }
    const existing = await findUserByUsername(db, name)
    if (existing) {
      logger.info(`[auth] 引导管理员已存在，跳过：${name}`)
      return
    }
    const roleName = auth.bootstrap.role || 'admin'
    const roleId = await roleIdByName(db, roleName)
    if (!roleId) {
      logger.warn(`[auth] 引导角色不存在，已跳过创建：${roleName}`)
      return
    }
    const passwordHash = await hashPassword(password)
    const userId = crypto.randomUUID()
    const now = nowIso()
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, name, passwordHash, name, 'active', now, now]
      )
      await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
    })
    logger.info(`[auth] 已创建引导用户：${name}（角色 ${roleName}）`)
  }

  async function listUsers() {
    const { rows } = await db.query(
      'SELECT id, username, display_name, status, created_at FROM users ORDER BY created_at DESC'
    )
    const out = []
    for (const row of rows) {
      out.push({
        id: row.id,
        username: row.username,
        displayName: row.display_name || '',
        status: row.status,
        createdAt: row.created_at,
        roles: await loadRoles(db, row.id)
      })
    }
    return out
  }

  return { mode, register, login, refresh, logout, authenticate, requirePermission, bootstrap, listUsers }
}

// ---------------------------------------------------------------- 校验

function validateCredentials(username, password, displayName) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new AppError(400, 'LC_E_INVALID_ARGUMENT', '用户名需为 3-32 位字母、数字、下划线、点或短横线', '', 'username')
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(400, 'LC_E_INVALID_ARGUMENT', '密码长度需为 8-128 位', '', 'password')
  }
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string' || displayName.length > 64) {
      throw new AppError(400, 'LC_E_INVALID_ARGUMENT', 'displayName 最多 64 个字符', '', 'displayName')
    }
  }
}

function validateLogin(username, password) {
  if (typeof username !== 'string' || username.trim() === '' || username.length > 64) {
    throw new AppError(400, 'LC_E_INVALID_ARGUMENT', 'username 不能为空且最多 64 个字符', '', 'username')
  }
  if (typeof password !== 'string' || password.length > 128) {
    throw new AppError(400, 'LC_E_INVALID_ARGUMENT', 'password 最多 128 个字符', '', 'password')
  }
}
