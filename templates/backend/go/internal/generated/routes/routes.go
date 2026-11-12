// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 只做路由装配：health/meta 在这里实现，items 薄委派到 internal/custom。
// 新增接口请去 internal/custom/routes.go。
package routes

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"lowcode/server/internal/custom"
	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/db"
	"lowcode/server/internal/generated/httpx"
	"lowcode/server/internal/generated/middleware"
)

// Version 出现在 /api/health 与 /api/meta，方便确认部署的是哪一版模板。
const Version = "0.1.0"

// Register 把所有内置路由挂到 mux 上。
func Register(mux *http.ServeMux, deps *app.Deps) {
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		health(w, r, deps)
	})
	mux.HandleFunc("GET /api/ready", func(w http.ResponseWriter, r *http.Request) {
		ready(w, r, deps)
	})
	mux.HandleFunc("GET /api/meta", func(w http.ResponseWriter, r *http.Request) {
		meta(w, r, deps)
	})
	mux.HandleFunc("GET /api/items", func(w http.ResponseWriter, r *http.Request) {
		custom.ListItems(w, r, deps)
	})
	mux.HandleFunc("POST /api/items", func(w http.ResponseWriter, r *http.Request) {
		custom.CreateItem(w, r, deps)
	})
	mux.HandleFunc("GET /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		custom.GetItem(w, r, deps)
	})
	mux.HandleFunc("PUT /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		custom.UpdateItem(w, r, deps)
	})
	mux.HandleFunc("DELETE /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		custom.DeleteItem(w, r, deps)
	})
	registerAuth(mux, deps)
	registerCollections(mux, deps)
}

func health(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	if healthDisabled(w, deps) {
		return
	}
	databaseReachable, databaseProblem := probeDatabase(r, deps)
	httpx.WriteOK(w, http.StatusOK, map[string]any{
		"status":            "ok",
		"language":          deps.Config.Language,
		"maturity":          deps.Config.Maturity,
		"version":           Version,
		"uptimeSeconds":     deps.UptimeSeconds(),
		"database":          deps.DB.Driver,
		"databaseReachable": databaseReachable,
		"databaseProblem":   databaseProblem,
		"cache":             deps.CacheDriver,
		"cacheFallback":     deps.CacheFallback,
		"static":            deps.Config.Static.Enabled,
		"middleware":        middleware.Snapshot(deps.Middleware),
	})
}

func ready(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	if healthDisabled(w, deps) {
		return
	}
	problems := []string{}
	if deps.Config.Middleware.Health.ReadinessRequiresDatabase {
		if reachable, problem := probeDatabase(r, deps); !reachable {
			problems = append(problems, "数据库（database）："+problem)
		}
	}
	if deps.Config.Middleware.Health.ReadinessRequiresCache && deps.Config.Cache.Enabled && deps.Config.Cache.Driver == "redis" {
		switch {
		case deps.Cache == nil:
			problems = append(problems, "缓存（redis）：缓存实例未初始化")
		case deps.CacheDriver != "redis":
			problems = append(problems, "缓存（redis）：配置为 redis 但连接不可用，已回退为 "+deps.CacheDriver)
		default:
			if err := deps.Cache.Ping(); err != nil {
				problems = append(problems, "缓存（redis）：PING 失败")
			}
		}
	}
	if len(problems) > 0 {
		httpx.WriteErrorWithDetail(w, http.StatusServiceUnavailable, httpx.CodeNotReady,
			"服务尚未就绪", "依赖不可用："+strings.Join(problems, "；"), "")
		return
	}
	httpx.WriteOK(w, http.StatusOK, map[string]any{
		"status":        "ready",
		"version":       Version,
		"uptimeSeconds": deps.UptimeSeconds(),
		"database":      deps.DB.Driver,
		"cache":         deps.CacheDriver,
	})
}

func healthDisabled(w http.ResponseWriter, deps *app.Deps) bool {
	if deps.Config.Middleware.Health.Enabled {
		return false
	}
	disabled := middleware.Disabled("health", "middleware.health.enabled",
		"/api/health 与 /api/ready 都已关闭")
	httpx.WriteErrorWithDetail(w, http.StatusServiceUnavailable, disabled.Code, disabled.Message, disabled.Detail, "")
	return true
}

func probeDatabase(r *http.Request, deps *app.Deps) (bool, string) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if deps.DB == nil {
		return false, "数据库实例未初始化"
	}
	if err := deps.DB.PingContext(ctx); err != nil {
		var unavailable *db.UnavailableError
		if errors.As(err, &unavailable) {
			return false, unavailable.Reason
		}
		return false, "数据库不可用"
	}
	return true, ""
}

func meta(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	siteName := "低代码站点"
	if value := os.Getenv("LC_SITE_NAME"); value != "" {
		siteName = value
	}

	impacts := []middleware.MiddlewareImpact{}
	if deps.Middleware != nil {
		impacts = deps.Middleware.Impacts
	}
	httpx.WriteOK(w, http.StatusOK, map[string]any{
		"siteName":      siteName,
		"language":      deps.Config.Language,
		"maturity":      deps.Config.Maturity,
		"version":       Version,
		"configVersion": deps.Config.SchemaVersion,
		"static":        deps.Config.Static.Enabled,
		"database": map[string]any{
			"driver": deps.DB.Driver,
			"pool": map[string]any{
				"maxOpenConns":          deps.Config.Database.MaxOpenConns,
				"connectTimeoutSeconds": deps.Config.Database.ConnectTimeoutSeconds,
			},
		},
		"cache": map[string]any{
			"enabled":        deps.Config.Cache.Enabled,
			"driver":         deps.CacheDriver,
			"configured":     deps.Config.Cache.Driver,
			"fallback":       deps.CacheFallback,
			"fallbackTarget": deps.Config.Cache.Fallback,
		},
		"middleware":        middleware.Snapshot(deps.Middleware),
		"middlewareImpacts": impacts,
		"builtinMiddleware": deps.Config.Builtin.Snapshot(),
		"configCenter": map[string]any{
			"sources": deps.Config.ConfigCenter.Snapshot(),
		},
		"startedAt": deps.Started.UTC().Format(time.RFC3339),
		// 让用户能从接口确认配置来自哪一层，排查“改了不生效”。
		"configSources": map[string]any{
			"generated": deps.Sources.Generated,
			"user":      deps.Sources.User,
			"override":  deps.Sources.Overridden,
			"env":       deps.Sources.Env,
			"cli":       deps.Sources.CLI,
		},
		"ignoredMiddleware": []string{},
	})
}
