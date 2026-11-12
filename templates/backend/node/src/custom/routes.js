// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// 新增接口的扩展点：平台每次启动都会调用 registerCustomRoutes，
// 生成的代码不会动这个文件，重新生成也不会覆盖。
export async function registerCustomRoutes(app, deps) {
  // 示例（取消注释即可暴露一个自定义接口）：
  // app.get('/api/custom/hello', async () => ({ ok: true, data: { hello: 'world' } }))
  void app
  void deps
}
