// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
package app

import (
	"time"

	"lowcode/server/internal/generated/auth"
	"lowcode/server/internal/generated/cache"
	"lowcode/server/internal/generated/config"
	"lowcode/server/internal/generated/data"
	"lowcode/server/internal/generated/db"
	"lowcode/server/internal/generated/middleware"
)

// Deps 是运行时依赖集合，用户区处理器通过它拿到配置、数据库、缓存与认证服务。
type Deps struct {
	Config  *config.Config
	Sources *config.Sources
	DB      *db.Handle
	Cache   cache.Cache
	Auth    *auth.Service
	Data    *data.Service
	// Middleware 是本次生效清单；ConfigCenter 供用户区直接读取配置中心。
	Middleware   *middleware.Plan
	ConfigCenter *config.ConfigCenter
	// CacheDriver / CacheFallback 是实际生效值，供 health / meta 暴露。
	CacheDriver   string
	CacheFallback bool
	Started       time.Time
}

// UptimeSeconds 给 health/meta 共用。
func (d *Deps) UptimeSeconds() int64 {
	return int64(time.Since(d.Started).Seconds())
}
