// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
import { authRoutes } from './auth.js'
import { collectionsRoutes } from './collections.js'
import { healthRoutes } from './health.js'
import { itemsRoutes } from './items.js'
import { metaRoutes } from './meta.js'

export async function registerRoutes(app, deps) {
  await healthRoutes(app, deps)
  await metaRoutes(app, deps)
  await authRoutes(app, deps)
  await collectionsRoutes(app, deps)
  await itemsRoutes(app, deps)
}
