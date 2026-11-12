// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 启动顺序：读配置 → 初始化日志 → 连库并跑迁移 → 装配路由/中间件 → 监听。
// 业务代码请改 internal/custom/，新增接口写 internal/custom/routes.go。
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"time"

	"lowcode/server/internal/custom"
	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/auth"
	"lowcode/server/internal/generated/cache"
	"lowcode/server/internal/generated/config"
	"lowcode/server/internal/generated/data"
	"lowcode/server/internal/generated/db"
	"lowcode/server/internal/generated/httpx"
	"lowcode/server/internal/generated/middleware"
	"lowcode/server/internal/generated/routes"
)

func main() {
	cli, err := config.ParseCLI(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "[LC_E_CONFIG_INVALID] 配置无效：%v\n", err)
		fmt.Fprintln(os.Stderr, "提示：检查 config.yaml，或用 --config 指定其它文件。")
		os.Exit(2)
	}

	cfg, sources, warnings, err := config.Load()
	if err != nil {
		// 配置错误统一用退出码 2，方便部署脚本区分。
		fmt.Fprintf(os.Stderr, "[LC_E_CONFIG_INVALID] 配置无效：%v\n", err)
		fmt.Fprintln(os.Stderr, "提示：检查 config.yaml，或用 --config 指定其它文件。")
		os.Exit(2)
	}

	setupLogger(cfg.LogLevel)
	for _, warning := range warnings {
		slog.Warn(warning)
	}
	slog.Info("配置加载完成",
		"generated", sourceText(sources.Generated),
		"user", sourceText(sources.User),
		"override", sources.Overridden,
	)

	printConfigCenter(&cfg)
	plan := middleware.Build(&cfg)
	middleware.Print(plan)
	for _, warning := range middleware.Warnings(&cfg) {
		slog.Warn(warning)
	}

	if cli.MigrateUp || cli.MigrateDown {
		runMigrationCommand(cfg, cli.MigrateDown)
		return
	}

	cacheResult := cache.Open(cfg.Cache, time.Duration(cfg.Database.ConnectTimeoutSeconds)*time.Second)
	if cacheResult.Warning != "" {
		slog.Warn(cacheResult.Warning)
	}
	slog.Info("缓存初始化完成", "driver", cacheResult.Driver, "fallback", cacheResult.Fallback)
	defer func() { _ = cacheResult.Cache.Close() }()

	handle, err := db.Connect(cfg)
	if err != nil {
		reportDatabaseFailure(err)
		os.Exit(1)
	}
	defer handle.Close()

	authService, err := auth.New(cfg.Auth, handle)
	if err != nil {
		slog.Error("初始化认证服务失败", "error", err.Error())
		os.Exit(1)
	}
	if err := authService.Bootstrap(context.Background()); err != nil {
		slog.Warn("引导管理员创建失败，服务继续启动", "error", err.Error())
	}

	deps := &app.Deps{
		Config:        &cfg,
		Sources:       sources,
		DB:            handle,
		Cache:         cacheResult.Cache,
		Auth:          authService,
		Data:          data.New(&cfg, handle, authService),
		Middleware:    plan,
		ConfigCenter:  &cfg.ConfigCenter,
		CacheDriver:   cacheResult.Driver,
		CacheFallback: cacheResult.Fallback,
		Started:       time.Now(),
	}

	mux := http.NewServeMux()
	routes.Register(mux, deps)
	custom.Register(mux, deps)
	mux.HandleFunc("/", fallback)

	var handler http.Handler = mux
	if cfg.Static.Enabled {
		slog.Info("静态资源已启用", "root", cfg.Static.Root)
		handler = staticHandler(mux, cfg.Static.Root, &cfg)
	}

	var limiter *httpx.Limiter
	if cfg.Middleware.RateLimit.Enabled {
		limiter = httpx.NewLimiter(cfg.Middleware.RateLimit.RPS)
	}
	handler = httpx.Chain(handler, &cfg, limiter)

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		slog.Error("监听失败，端口可能已被占用；改 config.yaml 的 port 或用 --port 换一个",
			"address", addr, "error", err.Error())
		os.Exit(1)
	}

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		slog.Info("收到退出信号，正在关闭服务")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	slog.Info("服务已启动", "address", addr, "database", handle.Driver,
		"cache", cacheResult.Driver,
		"health", "http://"+addr+"/api/health",
		"ready", "http://"+addr+"/api/ready")

	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		slog.Error("HTTP 服务异常退出", "error", err.Error())
		os.Exit(1)
	}
}

// fallback 处理未匹配路径：/api 下返回 JSON 404，其它返回纯文本。
func fallback(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "接口不存在", "")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte("404 Not Found"))
}

// staticHandler 让 /api 继续走接口，其余路径交给静态文件服务器。
// 静态缓存只加 Cache-Control；是否 immutable 用文件名中的长十六进制指纹判断。
func staticHandler(api http.Handler, root string, cfg *config.Config) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			api.ServeHTTP(w, r)
			return
		}
		if cfg.Middleware.StaticCache.Enabled {
			maxAge := cfg.Middleware.StaticCache.MaxAgeSeconds
			if fingerprintedName.MatchString(r.URL.Path) {
				w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", cfg.Middleware.StaticCache.ImmutableMaxAgeSeconds))
			} else {
				w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
			}
		}
		files.ServeHTTP(w, r)
	})
}

// 文件名中 8 位以上连续十六进制，且带点/横线分隔，视为带内容指纹。
var fingerprintedName = regexp.MustCompile(`[.-][0-9a-f]{8,}\.[a-z0-9]+$`)

func printConfigCenter(cfg *config.Config) {
	for _, def := range cfg.ConfigCenter.Definitions() {
		if def.Builtin {
			// 内置组字段已由 [中间件][内置] 清单逐组打印，这里不重复。
			continue
		}
		value, ok := cfg.ConfigCenter.Get(def.Key)
		shown := "***"
		if !def.Secret {
			if ok {
				shown = fmt.Sprint(value)
			} else {
				shown = "<未设置>"
			}
		}
		slog.Info(fmt.Sprintf("[中间件][自定义] %s=%s（来源=%s）", def.Key, shown, cfg.ConfigCenter.Source(def.Key)))
	}
}

func setupLogger(level string) {
	var minLevel slog.Level
	switch level {
	case "debug":
		minLevel = slog.LevelDebug
	case "warn":
		minLevel = slog.LevelWarn
	case "error":
		minLevel = slog.LevelError
	default:
		minLevel = slog.LevelInfo
	}
	handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: minLevel})
	slog.SetDefault(slog.New(handler))
}

func sourceText(value *string) string {
	if value == nil {
		return "-"
	}
	return *value
}

// runMigrationCommand 处理 --migrate / --migrate-down：只做数据库操作，不监听端口。
func runMigrationCommand(cfg config.Config, down bool) {
	handle, err := db.Open(cfg)
	if err != nil {
		reportDatabaseFailure(err)
		os.Exit(1)
	}
	defer handle.Close()

	if down {
		version, rolledBack, err := handle.MigrateDown()
		if err != nil {
			slog.Error("回滚迁移失败", "error", err.Error())
			os.Exit(1)
		}
		if !rolledBack {
			fmt.Println("没有可回滚的迁移：未找到对应 migrations/down 文件，或没有已应用版本")
			return
		}
		fmt.Printf("已回滚迁移：%s\n", version)
		return
	}

	applied, err := handle.MigrateUp()
	if err != nil {
		slog.Error("执行迁移失败", "error", err.Error())
		os.Exit(1)
	}
	if len(applied) == 0 {
		fmt.Println("无待执行迁移")
		return
	}
	for _, version := range applied {
		fmt.Printf("已执行迁移：%s\n", version)
	}
}

// reportDatabaseFailure 只打印脱敏后的中文原因与排查提示，绝不回显连接串/密码。
func reportDatabaseFailure(err error) {
	var unavailable *db.UnavailableError
	if errors.As(err, &unavailable) {
		fmt.Fprintf(os.Stderr, "[LC_E_DB_UNAVAILABLE] %s\n", unavailable.Error())
		fmt.Fprintln(os.Stderr, "排查提示：")
		for index, hint := range unavailable.Hints {
			fmt.Fprintf(os.Stderr, "  %d. %s\n", index+1, hint)
		}
		return
	}
	fmt.Fprintf(os.Stderr, "[LC_E_INTERNAL] 数据库初始化失败：%v\n", err)
}
