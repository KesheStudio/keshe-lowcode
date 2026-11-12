// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 集合 CRUD 的 HTTP 接线：路径与前端 rowsPath 契约对齐（列表行固定在 data.items）。
import { okBody } from '../errors.js'

export async function collectionsRoutes(app, deps) {
  if (!deps.config.dataApi.enabled) return
  const data = deps.data

  app.get('/api/collections/:collectionId/rows', async (request) => {
    return okBody(await data.list(request.params.collectionId, request))
  })

  app.get('/api/collections/:collectionId/rows/:rowId', async (request) => {
    return okBody(await data.getOne(request.params.collectionId, request.params.rowId, request))
  })

  app.post('/api/collections/:collectionId/rows', async (request, reply) => {
    const row = await data.create(request.params.collectionId, request)
    return reply.code(201).send(okBody(row))
  })

  app.put('/api/collections/:collectionId/rows/:rowId', async (request) => {
    return okBody(await data.update(request.params.collectionId, request.params.rowId, request))
  })

  app.delete('/api/collections/:collectionId/rows/:rowId', async (request) => {
    return okBody(await data.remove(request.params.collectionId, request.params.rowId, request))
  })
}
