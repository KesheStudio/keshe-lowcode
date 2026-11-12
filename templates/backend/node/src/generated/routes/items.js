// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 这里只负责“把 URL 接到用户区处理器”，具体业务在 src/custom/handlers/items.js。
// 改接口行为不用动本文件；新增接口写 src/custom/routes.js。
import * as handlers from '../../custom/handlers/items.js'

export async function itemsRoutes(app, deps) {
  app.get('/api/items', (request, reply) => handlers.list({ ...deps, request, reply }))
  app.get('/api/items/:id', (request, reply) => handlers.get({ ...deps, request, reply }))
  app.post('/api/items', (request, reply) => handlers.create({ ...deps, request, reply }))
  app.put('/api/items/:id', (request, reply) => handlers.update({ ...deps, request, reply }))
  app.delete('/api/items/:id', (request, reply) => handlers.remove({ ...deps, request, reply }))
}
