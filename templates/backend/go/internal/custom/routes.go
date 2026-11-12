// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// 新增接口的扩展点：在这里注册，不影响 internal/generated 里的路由。
// 配置中心与内置中间件配置都通过 Deps 读取：
//
//	value, ok := deps.ConfigCenter.Get("APP_MODE")
//	source := deps.ConfigCenter.Source("APP_MODE")
//	objDriver, _ := deps.ConfigCenter.Get("objectStorage.driver")
//
// 内置中间件自身连接（postgres/mysql/sqlite/redis）由平台负责；objectStorage、
// messageQueue、search、reverseProxy 只注入配置，连接由用户代码自行实现。
package custom

import (
	"net/http"

	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/httpx"
)

// Register 把用户自定义路由挂到 mux 上。
func Register(mux *http.ServeMux, deps *app.Deps) {
	mux.HandleFunc("GET /api/custom/example", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteOK(w, http.StatusOK, map[string]any{
			"message":       "这是用户区自定义接口",
			"uptimeSeconds": deps.UptimeSeconds(),
		})
	})
}
