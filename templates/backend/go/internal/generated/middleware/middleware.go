// Package middleware 汇报固定服务能力与内置中间件的生效清单，不按 id 动态加载。
package middleware

import (
	"fmt"
	"log/slog"
	"strings"

	"lowcode/server/internal/generated/config"
)

// MiddlewareEntry 是一项固定服务能力或内置中间件的生效状态。
type MiddlewareEntry struct {
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	Effective  string `json:"effective"`
	ConfigPath string `json:"configPath"`
	Kind       string `json:"kind"`
	Severity   string `json:"severity"`
}

// MiddlewareImpact 是关闭项的影响说明，必须能指导用户恢复。
type MiddlewareImpact struct {
	Name    string   `json:"name"`
	Routes  []string `json:"routes"`
	Message string   `json:"message"`
	Hint    string   `json:"hint"`
}

// Plan 是启动清单。
type Plan struct {
	Entries []MiddlewareEntry  `json:"entries"`
	Impacts []MiddlewareImpact `json:"impacts"`
}

// Build 生成中间件生效清单。
func Build(cfg *config.Config) *Plan {
	plan := &Plan{Entries: []MiddlewareEntry{}, Impacts: []MiddlewareImpact{}}
	mw := cfg.Middleware

	plan.add(entry("requestId", mw.RequestID, "服务",
		"每个请求注入 X-Request-Id 并回写响应头", "middleware.requestId", "warn"))
	plan.add(entry("logging", mw.Logging, "服务",
		"访问日志（方法/路径/状态/耗时/请求 ID）", "middleware.logging", "warn"))
	plan.add(entry("bodyLimit", mw.BodyLimit.Enabled, "服务",
		fmt.Sprintf("请求体上限 %d 字节，超限由 http.MaxBytesReader 拒绝", mw.BodyLimit.MaxBytes),
		"middleware.bodyLimit.enabled", "warn"))
	plan.add(entry("timeout", mw.Timeout.Enabled, "服务",
		fmt.Sprintf("请求处理超过 %d 秒返回 503 LC_E_TIMEOUT", mw.Timeout.Seconds),
		"middleware.timeout.enabled", "warn"))
	plan.add(entry("concurrency", mw.Concurrency.Enabled, "服务",
		fmt.Sprintf("在途请求上限 %d，超限返回 503 LC_E_CONCURRENCY_LIMITED", mw.Concurrency.MaxInFlight),
		"middleware.concurrency.enabled", "info"))
	plan.add(entry("compression", mw.Compression.Enabled, "服务",
		compressionEffective(cfg), "middleware.compression.enabled", "warn"))
	plan.add(entry("rateLimit", mw.RateLimit.Enabled, "服务",
		fmt.Sprintf("每 IP 每秒 %d 个请求，超限返回 429 LC_E_RATE_LIMITED", mw.RateLimit.RPS),
		"middleware.rateLimit.enabled", "info"))
	plan.add(entry("staticCache", mw.StaticCache.Enabled, "服务",
		fmt.Sprintf("静态资源 Cache-Control：普通 %ds，指纹文件 %ds + immutable", mw.StaticCache.MaxAgeSeconds, mw.StaticCache.ImmutableMaxAgeSeconds),
		"middleware.staticCache.enabled", "warn"))
	plan.add(entry("health", mw.Health.Enabled, "服务",
		healthEffective(cfg), "middleware.health.enabled", "warn"))
	plan.add(entry("securityHeaders", mw.SecurityHeaders.Enabled, "服务",
		securityHeadersEffective(cfg), "middleware.securityHeaders.enabled", "warn"))
	plan.add(entry("cache", cfg.Cache.Enabled, "服务",
		cacheEffective(cfg), "cache.enabled", "warn"))

	for _, name := range cfg.Builtin.Names() {
		if !cfg.Builtin.Present(name) {
			// 未在配置里出现的组按兼容模式处理，不计入生效清单。
			continue
		}
		group, _ := cfg.Builtin.Group(name)
		source := cfg.Builtin.GroupSource(name)
		effective := "未启用（配置已清空，不会连接）"
		if group.Enabled {
			switch name {
			case "postgres", "mysql", "sqlite":
				effective = fmt.Sprintf("已连接（来源=%s）", source)
			case "redis":
				effective = fmt.Sprintf("缓存使用 redis（来源=%s）", source)
			case "objectStorage", "messageQueue", "search", "reverseProxy":
				effective = fmt.Sprintf("配置已注入（连接由用户代码负责，来源=%s）", source)
			}
		}
		plan.add(entry(name, group.Enabled, "builtin", effective, "middleware.builtin."+name+".enabled", "warn"))
	}

	for _, item := range []struct {
		name   string
		routes []string
		msg    string
		hint   string
	}{
		{"bodyLimit", []string{"/api/*"}, "关闭后请求体不再受上限约束，超大请求会直接进入业务处理", "config.yaml：middleware.bodyLimit.enabled=true（或启动参数 --body-limit-bytes=N，会自动启用）"},
		{"timeout", []string{"/api/*", "静态资源"}, "关闭后单个请求可无限等待，慢查询会占满连接", "config.yaml：middleware.timeout.enabled=true（或 --timeout-seconds=N）"},
		{"compression", []string{"/api/*", "静态资源"}, "关闭后响应不压缩，带宽占用上升", "config.yaml：middleware.compression.enabled=true、gzip=true"},
		{"staticCache", []string{"/static/*", "/*.js", "/*.css"}, "关闭后静态资源不带 Cache-Control，浏览器每次回源", "config.yaml：middleware.staticCache.enabled=true"},
		{"health", []string{"/api/health", "/api/ready"}, "关闭后两个探针路径都返回 503 LC_E_MIDDLEWARE_DISABLED，不会静默 404", "config.yaml：middleware.health.enabled=true"},
		{"securityHeaders", []string{"全部响应"}, "关闭后不发送任何安全响应头（nosniff / frame / referrer 等）", "config.yaml：middleware.securityHeaders.enabled=true"},
		{"requestId", []string{"/api/*"}, "关闭后不注入请求 ID，访问日志中的 requestId 为空", "config.yaml：middleware.requestId=true"},
		{"logging", []string{"/api/*"}, "关闭后没有访问日志，但服务与业务不受影响", "config.yaml：middleware.logging=true"},
	} {
		enabled := true
		switch item.name {
		case "bodyLimit":
			enabled = mw.BodyLimit.Enabled
		case "timeout":
			enabled = mw.Timeout.Enabled
		case "compression":
			enabled = mw.Compression.Enabled && mw.Compression.Gzip
		case "staticCache":
			enabled = mw.StaticCache.Enabled
		case "health":
			enabled = mw.Health.Enabled
		case "securityHeaders":
			enabled = mw.SecurityHeaders.Enabled
		case "requestId":
			enabled = mw.RequestID
		case "logging":
			enabled = mw.Logging
		}
		if enabled {
			continue
		}
		plan.Impacts = append(plan.Impacts, MiddlewareImpact{
			Name: item.name, Routes: item.routes, Message: item.msg, Hint: item.hint,
		})
	}
	return plan
}

// Warnings 返回一条与运行现实相关的明确告警。
func Warnings(cfg *config.Config) []string {
	if cfg.Middleware.Compression.Enabled && cfg.Middleware.Compression.Brotli {
		return []string{"middleware.compression.brotli=true：Go 模板未编译 brotli，实际仅 gzip；可用 nginx 开 br"}
	}
	return nil
}

func entry(name string, enabled bool, kind, effective, configPath, severity string) MiddlewareEntry {
	return MiddlewareEntry{
		Name: name, Enabled: enabled, Effective: effective,
		ConfigPath: configPath, Kind: kind, Severity: severity,
	}
}

func (p *Plan) add(item MiddlewareEntry) {
	p.Entries = append(p.Entries, item)
}

// Print 输出启动清单：N/M 项开启，每项 ✓/✗，关闭项附影响与恢复提示。
func Print(plan *Plan) {
	if plan == nil {
		return
	}
	enabledCount := 0
	for _, item := range plan.Entries {
		if item.Enabled {
			enabledCount++
		}
	}
	slog.Info(fmt.Sprintf("[中间件] 本次生效清单：%d/%d 项开启", enabledCount, len(plan.Entries)))
	for _, item := range plan.Entries {
		label := "服务"
		if item.Kind == "builtin" {
			label = "内置"
		} else if item.Kind == "custom" {
			label = "自定义"
		}
		marker := "✗"
		if item.Enabled {
			marker = "✓"
		}
		line := fmt.Sprintf("[中间件][%s] %s %s %s", label, item.Name, marker, item.Effective)
		if !item.Enabled && item.Severity != "info" {
			slog.Warn(line)
			continue
		}
		slog.Info(line)
	}
	for _, impact := range plan.Impacts {
		slog.Warn(fmt.Sprintf("[中间件] 已关闭 %s：影响路由 %s；默认行为：%s；恢复：%s",
			impact.Name, strings.Join(impact.Routes, "、"), impact.Message, impact.Hint))
	}
}

// Snapshot 给 /api/meta 的 middleware 字段，不含敏感值。
func Snapshot(plan *Plan) []map[string]any {
	out := []map[string]any{}
	if plan == nil {
		return out
	}
	for _, item := range plan.Entries {
		out = append(out, map[string]any{
			"name":       item.Name,
			"enabled":    item.Enabled,
			"effective":  item.Effective,
			"configPath": item.ConfigPath,
			"kind":       item.Kind,
		})
	}
	return out
}

// DisabledError 是中间件关闭时统一返回的错误，避免静默 404。
type DisabledError struct {
	Code    string
	Message string
	Detail  string
}

// Disabled 构造禁用错误；detail 必须给出恢复配置键。
func Disabled(name, configPath, detail string) *DisabledError {
	return &DisabledError{
		Code:    "LC_E_MIDDLEWARE_DISABLED",
		Message: fmt.Sprintf("中间件 %s 已关闭", name),
		Detail:  fmt.Sprintf("%s；恢复配置：config.yaml 设置 %s=true 后重启", detail, configPath),
	}
}

func compressionEffective(cfg *config.Config) string {
	compression := cfg.Middleware.Compression
	if !compression.Enabled {
		return "未启用（响应不压缩）"
	}
	parts := []string{}
	if compression.Gzip {
		parts = append(parts, fmt.Sprintf("gzip（minBytes=%d）", compression.MinBytes))
	}
	if compression.Brotli {
		parts = append(parts, "brotli 配置已开启但 Go 未支持，实际不生效")
	}
	if len(parts) == 0 {
		return "未启用（gzip/brotli 均关闭）"
	}
	return strings.Join(parts, "；")
}

func healthEffective(cfg *config.Config) string {
	requirements := []string{}
	if cfg.Middleware.Health.ReadinessRequiresDatabase {
		requirements = append(requirements, "数据库")
	}
	if cfg.Middleware.Health.ReadinessRequiresCache {
		requirements = append(requirements, "缓存")
	}
	if len(requirements) == 0 {
		return "/api/health 存活检查；/api/ready 就绪检查（无依赖要求）"
	}
	return "/api/health 存活检查；/api/ready 依赖：" + strings.Join(requirements, "、")
}

func securityHeadersEffective(cfg *config.Config) string {
	headers := cfg.Middleware.SecurityHeaders
	parts := []string{}
	for _, value := range []string{
		headers.ContentTypeOptions, headers.FrameOptions, headers.ReferrerPolicy,
		headers.PermissionsPolicy, headers.CrossOriginOpenerPolicy,
	} {
		if value != "" {
			parts = append(parts, value)
		}
	}
	if headers.HSTS.Enabled {
		parts = append(parts, fmt.Sprintf("HSTS=%ds", headers.HSTS.MaxAgeSeconds))
	}
	if len(parts) == 0 {
		return "未启用（所有安全头为空）"
	}
	return strings.Join(parts, "；")
}

func cacheEffective(cfg *config.Config) string {
	if !cfg.Cache.Enabled {
		return fmt.Sprintf("已关闭，按 cache.fallback=%s 回退", cfg.Cache.Fallback)
	}
	return fmt.Sprintf("%s（ttl=%ds，keyPrefix=%s）", cfg.Cache.Driver, cfg.Cache.TTLSeconds, cfg.Cache.KeyPrefix)
}
