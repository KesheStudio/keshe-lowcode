// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
import { okBody } from '../errors.js'

function bearer(request) {
  const header = request.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

export async function authRoutes(app, deps) {
  const auth = deps.auth

  // 刷新与登出在 session 模式下不需要请求体；把「带 JSON 头但 body 为空」当 {}，
  // 避免客户端为了发一个空请求被迫构造 {}。
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (!body || body.trim() === '') {
      done(null, {})
      return
    }
    try {
      done(null, JSON.parse(body))
    } catch (err) {
      done(err)
    }
  })

  app.post('/api/auth/register', async (request, reply) => {
    const body = request.body || {}
    const result = await auth.register({
      username: body.username,
      password: body.password,
      displayName: body.displayName,
      userAgent: request.headers['user-agent'] || ''
    })
    return reply.code(201).send(okBody(result.tokens))
  })

  app.post('/api/auth/login', async (request) => {
    const body = request.body || {}
    const tokens = await auth.login({
      username: body.username,
      password: body.password,
      userAgent: request.headers['user-agent'] || ''
    })
    return okBody(tokens)
  })

  app.post('/api/auth/refresh', async (request) => {
    const body = request.body || {}
    const tokens = await auth.refresh({
      refreshToken: body.refreshToken,
      sessionToken: bearer(request),
      userAgent: request.headers['user-agent'] || ''
    })
    return okBody(tokens)
  })

  app.post('/api/auth/logout', async (request) => {
    const context = await auth.authenticate(request)
    const body = request.body || {}
    return okBody(await auth.logout(context, { refreshToken: body.refreshToken }))
  })

  app.get('/api/auth/me', async (request) => {
    const context = await auth.authenticate(request)
    return okBody(context)
  })

  // 最小 RBAC 示例：只有拥有 users:read 权限的角色（默认 admin）才能访问。
  app.get('/api/admin/users', async (request) => {
    const context = await auth.authenticate(request)
    auth.requirePermission(context, 'users:read')
    return okBody({ items: await auth.listUsers() })
  })

  app.get('/api/auth/mode', async () => okBody({ tokenMode: auth.mode }))
}

// 供 custom/routes.js 复用：在自定义接口里保护路由。
export function guard(auth, permission) {
  return async (request) => {
    const context = await auth.authenticate(request)
    if (permission) auth.requirePermission(context, permission)
    return context
  }
}
