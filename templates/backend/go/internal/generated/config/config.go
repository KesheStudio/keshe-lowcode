// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 配置读取：默认值 → config.generated.yaml → config.yaml → 环境变量 → 启动参数。
// 只支持约定的 YAML 子集；以 { 开头的文件按 JSON 解析。
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type CORS struct {
	Enabled     bool     `json:"enabled"`
	Origins     []string `json:"origins"`
	Methods     []string `json:"methods"`
	Headers     []string `json:"headers"`
	Credentials bool     `json:"credentials"`
	MaxAge      int      `json:"maxAge"`
}

type Database struct {
	Driver                string `json:"driver"`
	URL                   string `json:"url"`
	Host                  string `json:"host"`
	Port                  int    `json:"port"`
	Name                  string `json:"name"`
	User                  string `json:"user"`
	Password              string `json:"password"`
	SSLMode               string `json:"sslMode"`
	MaxOpenConns          int    `json:"maxOpenConns"`
	ConnectTimeoutSeconds int    `json:"connectTimeoutSeconds"`
}

// Cache 配置：none / memory / redis。enabled=false 或 Redis 连接失败时按 fallback 回退。
type Cache struct {
	Enabled    bool   `json:"enabled"`
	Fallback   string `json:"fallback"`
	Driver     string `json:"driver"`
	URL        string `json:"url"`
	TTLSeconds int    `json:"ttlSeconds"`
	KeyPrefix  string `json:"keyPrefix"`
	Password   string `json:"-"`
}

type BodyLimit struct {
	Enabled  bool `json:"enabled"`
	MaxBytes int  `json:"maxBytes"`
}

type Timeout struct {
	Enabled bool `json:"enabled"`
	Seconds int  `json:"seconds"`
}

type Concurrency struct {
	Enabled     bool `json:"enabled"`
	MaxInFlight int  `json:"maxInFlight"`
}

type Compression struct {
	Enabled  bool `json:"enabled"`
	Gzip     bool `json:"gzip"`
	Brotli   bool `json:"brotli"`
	MinBytes int  `json:"minBytes"`
}

type RateLimit struct {
	Enabled bool `json:"enabled"`
	RPS     int  `json:"rps"`
}

type StaticCache struct {
	Enabled                bool `json:"enabled"`
	MaxAgeSeconds          int  `json:"maxAgeSeconds"`
	ImmutableMaxAgeSeconds int  `json:"immutableMaxAgeSeconds"`
}

type Health struct {
	Enabled                   bool `json:"enabled"`
	ReadinessRequiresDatabase bool `json:"readinessRequiresDatabase"`
	ReadinessRequiresCache    bool `json:"readinessRequiresCache"`
}

type HSTS struct {
	Enabled           bool `json:"enabled"`
	MaxAgeSeconds     int  `json:"maxAgeSeconds"`
	IncludeSubdomains bool `json:"includeSubdomains"`
	Preload           bool `json:"preload"`
}

type SecurityHeaders struct {
	Enabled                 bool   `json:"enabled"`
	HSTS                    HSTS   `json:"hsts"`
	ContentTypeOptions      string `json:"contentTypeOptions"`
	FrameOptions            string `json:"frameOptions"`
	ReferrerPolicy          string `json:"referrerPolicy"`
	PermissionsPolicy       string `json:"permissionsPolicy"`
	CrossOriginOpenerPolicy string `json:"crossOriginOpenerPolicy"`
}

type Middleware struct {
	RequestID       bool            `json:"requestId"`
	Logging         bool            `json:"logging"`
	BodyLimit       BodyLimit       `json:"bodyLimit"`
	Timeout         Timeout         `json:"timeout"`
	Concurrency     Concurrency     `json:"concurrency"`
	Compression     Compression     `json:"compression"`
	RateLimit       RateLimit       `json:"rateLimit"`
	StaticCache     StaticCache     `json:"staticCache"`
	Health          Health          `json:"health"`
	SecurityHeaders SecurityHeaders `json:"securityHeaders"`
}

type Static struct {
	Enabled bool   `json:"enabled"`
	Root    string `json:"root"`
}

// ConfigDefinition 描述配置中心的一个配置项；只有类型与默认值，不含业务规则。
type ConfigDefinition struct {
	Key         string
	Type        string
	Default     any
	Enum        []string
	Secret      bool
	// Builtin 表示该定义由内置中间件组注入，启动日志按「内置」归类。
	Builtin     bool
	Description string
}

// ConfigCenter 是解析后的配置中心：Get/Source/Snapshot 只读，可安全复制。
type ConfigCenter struct {
	definitions []ConfigDefinition
	values      map[string]any
	sources     map[string]string
}

// Get 返回配置项最终值；未定义的 key 返回 (nil, false)。
func (c *ConfigCenter) Get(key string) (any, bool) {
	value, ok := c.values[key]
	return value, ok
}

// Source 返回最终值来源：default / generated / user / env / cli。
func (c *ConfigCenter) Source(key string) string {
	return c.sources[key]
}

// Definitions 返回配置项描述，供启动摘要与用户区读取元信息。
func (c *ConfigCenter) Definitions() []ConfigDefinition {
	out := make([]ConfigDefinition, len(c.definitions))
	copy(out, c.definitions)
	return out
}

// Snapshot 给 /api/meta：只含 key/type/secret/source/description/enum，绝不含值。
func (c *ConfigCenter) Snapshot() []map[string]any {
	out := make([]map[string]any, 0, len(c.definitions))
	for _, def := range c.definitions {
		out = append(out, map[string]any{
			"key":         def.Key,
			"type":        def.Type,
			"secret":      def.Secret,
			"source":      c.Source(def.Key),
			"description": def.Description,
			"enum":        def.Enum,
		})
	}
	return out
}

// Bootstrap 是首次启动自动创建的管理员；留空则跳过。
type Bootstrap struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// Auth 配置：默认 JWT（短时 access + 可撤销 refresh），可切换为服务端会话。
type Auth struct {
	TokenMode              string    `json:"tokenMode"`
	JWTSecret              string    `json:"jwtSecret"`
	AccessTokenTTLSeconds  int       `json:"accessTokenTtlSeconds"`
	RefreshTokenTTLSeconds int       `json:"refreshTokenTtlSeconds"`
	SessionTTLSeconds      int       `json:"sessionTtlSeconds"`
	MaxLoginFailures       int       `json:"maxLoginFailures"`
	FailureWindowSeconds   int       `json:"failureWindowSeconds"`
	LockSeconds            int       `json:"lockSeconds"`
	Bootstrap              Bootstrap `json:"bootstrap"`
}

// DataAPI 配置：集合数据接口（读 ../web/data/collections/*.json，行数据存数据库）。
type DataAPI struct {
	Enabled           bool     `json:"enabled"`
	PublicRead        bool     `json:"publicRead"`
	WriteRequiresAuth bool     `json:"writeRequiresAuth"`
	WriteRoles        []string `json:"writeRoles"`
	MaxPageSize       int      `json:"maxPageSize"`
	CollectionsDir    string   `json:"collectionsDir"`
}

type Config struct {
	SchemaVersion int               `json:"schemaVersion"`
	Language      string            `json:"language"`
	Maturity      string            `json:"maturity"`
	Strict        bool              `json:"strict"`
	Override      bool              `json:"override"`
	Host          string            `json:"host"`
	Port          int               `json:"port"`
	LogLevel      string            `json:"logLevel"`
	CORS          CORS              `json:"cors"`
	Database      Database          `json:"database"`
	Cache         Cache             `json:"cache"`
	Auth          Auth              `json:"auth"`
	Middleware    Middleware        `json:"middleware"`
	Static        Static            `json:"static"`
	DataAPI       DataAPI           `json:"dataApi"`
	ConfigCenter  ConfigCenter      `json:"-"`
	Builtin       BuiltinMiddleware `json:"-"`
}

type Sources struct {
	Generated  *string  `json:"generated"`
	User       *string  `json:"user"`
	Overridden bool     `json:"override"`
	Env        []string `json:"env"`
	CLI        []string `json:"cli"`
}

type CLI struct {
	Host           *string
	Port           *string
	LogLevel       *string
	Config         *string
	BodyLimitBytes *string
	TimeoutSeconds *string
	CacheEnabled   *string
	Cfg            map[string]string
	Override       bool
	MigrateUp      bool
	MigrateDown    bool
}

// ParseCLI 供 main 在加载配置前识别迁移命令；错误与配置错误共用退出码 2。
func ParseCLI(args []string) (CLI, error) {
	return parseCLI(args)
}

// Defaults 返回内置默认值；所有字段都在这一个地方定义。
func Defaults() Config {
	return Config{
		SchemaVersion: 1,
		Language:      "go",
		Maturity:      "usable",
		Strict:        true,
		Host:          "127.0.0.1",
		Port:          8080,
		LogLevel:      "info",
		CORS: CORS{
			Enabled:     true,
			Origins:     []string{},
			Methods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			Headers:     []string{"content-type", "authorization", "x-request-id"},
			Credentials: false,
			MaxAge:      600,
		},
		Database: Database{
			Driver:                "sqlite",
			URL:                   "sqlite://data/app.db",
			Host:                  "127.0.0.1",
			Port:                  0,
			Name:                  "app",
			User:                  "",
			Password:              "",
			SSLMode:               "disable",
			MaxOpenConns:          10,
			ConnectTimeoutSeconds: 5,
		},
		Cache: Cache{
			Enabled:    true,
			Fallback:   "memory",
			Driver:     "memory",
			URL:        "redis://127.0.0.1:16379/0",
			TTLSeconds: 30,
			KeyPrefix:  "lc:",
		},
		Auth: Auth{
			TokenMode:              "jwt",
			JWTSecret:              "",
			AccessTokenTTLSeconds:  900,
			RefreshTokenTTLSeconds: 604800,
			SessionTTLSeconds:      28800,
			MaxLoginFailures:       5,
			FailureWindowSeconds:   300,
			LockSeconds:            900,
			Bootstrap:              Bootstrap{Role: "admin"},
		},
		Middleware: Middleware{
			RequestID:   true,
			Logging:     true,
			BodyLimit:   BodyLimit{Enabled: true, MaxBytes: 1048576},
			Timeout:     Timeout{Enabled: true, Seconds: 30},
			Concurrency: Concurrency{Enabled: false, MaxInFlight: 64},
			Compression: Compression{Enabled: true, Gzip: true, Brotli: true, MinBytes: 1024},
			RateLimit:   RateLimit{Enabled: false, RPS: 20},
			StaticCache: StaticCache{Enabled: true, MaxAgeSeconds: 3600, ImmutableMaxAgeSeconds: 31536000},
			Health:      Health{Enabled: true, ReadinessRequiresDatabase: true, ReadinessRequiresCache: false},
			SecurityHeaders: SecurityHeaders{
				Enabled:                 true,
				HSTS:                    HSTS{Enabled: false, MaxAgeSeconds: 31536000, IncludeSubdomains: true, Preload: false},
				ContentTypeOptions:      "nosniff",
				FrameOptions:            "SAMEORIGIN",
				ReferrerPolicy:          "strict-origin-when-cross-origin",
				PermissionsPolicy:       "geolocation=(), microphone=(), camera=()",
				CrossOriginOpenerPolicy: "same-origin",
			},
		},
		Static: Static{Enabled: false, Root: "../web"},
		DataAPI: DataAPI{
			Enabled:           true,
			PublicRead:        true,
			WriteRequiresAuth: true,
			WriteRoles:        []string{},
			MaxPageSize:       100,
			CollectionsDir:    "../web/data/collections",
		},
	}
}

// Load 读取真实进程的启动参数与环境变量。
func Load() (Config, *Sources, []string, error) {
	return LoadWith(os.Args[1:], os.Environ(), ".")
}

// LoadWith 便于测试/生成器调用：显式传入参数、环境变量与工作目录。
func LoadWith(args []string, environ []string, cwd string) (Config, *Sources, []string, error) {
	cfg := Defaults()
	sources := &Sources{Env: []string{}, CLI: []string{}}
	var warnings []string

	cli, err := parseCLI(args)
	if err != nil {
		return cfg, sources, warnings, err
	}

	path, err := resolveConfigPath(cli, environ, cwd)
	if err != nil {
		return cfg, sources, warnings, err
	}

	userRaw, userExists, err := readIfExists(path)
	if err != nil {
		return cfg, sources, warnings, err
	}

	var userMap map[string]any
	if userExists {
		userMap, err = parseConfigText(userRaw, path)
		if err != nil {
			return cfg, sources, warnings, err
		}
	} else {
		userMap = map[string]any{}
	}

	envMap := envToMap(environ)
	envOverride, err := envBool(envMap, "LC_OVERRIDE")
	if err != nil {
		return cfg, sources, warnings, err
	}
	userOverride := boolField(userMap, "override")
	override := cli.Override || envOverride || userOverride
	sources.Overridden = override

	generatedPath := ""
	var generatedMap map[string]any
	if !override {
		candidate := filepath.Join(filepath.Dir(path), "config.generated.yaml")
		jsonCandidate := filepath.Join(filepath.Dir(path), "config.generated.json")
		if exists(candidate) {
			generatedPath = candidate
		} else if exists(jsonCandidate) {
			generatedPath = jsonCandidate
		}
	}
	if generatedPath != "" {
		raw, _, err := readIfExists(generatedPath)
		if err != nil {
			return cfg, sources, warnings, err
		}
		generatedMap, err = parseConfigText(raw, generatedPath)
		if err != nil {
			return cfg, sources, warnings, err
		}
		rel := generatedPath
		sources.Generated = &rel
	}
	if userExists {
		rel := path
		sources.User = &rel
	}

	// 默认值 → 生成 → 用户：按优先级顺序合并，后合并的覆盖先合并的。
	base := defaultsMap()
	if err := mergeMap(base, generatedMap); err != nil {
		return cfg, sources, warnings, err
	}
	if err := mergeMap(base, userMap); err != nil {
		return cfg, sources, warnings, err
	}
	warnings = append(warnings, normalizeMiddlewareShapes(base)...)
	strict, _ := base["strict"].(bool)
	if unknown := collectUnknown(base, ""); len(unknown) > 0 {
		if strict {
			return cfg, sources, warnings, fmt.Errorf("未知配置项：%s", strings.Join(unknown, "、"))
		}
		warnings = append(warnings, "未知配置项被忽略："+strings.Join(unknown, "、"))
	}
	if err := checkTypes(base); err != nil {
		return cfg, sources, warnings, err
	}

	cfg, err = decode(base)
	if err != nil {
		return cfg, sources, warnings, err
	}

	if err := applyEnv(&cfg, envMap, &sources.Env); err != nil {
		return cfg, sources, warnings, err
	}
	if err := applyCLI(&cfg, cli, &sources.CLI); err != nil {
		return cfg, sources, warnings, err
	}
	if err := validate(&cfg); err != nil {
		return cfg, sources, warnings, err
	}

	center, centerWarnings, err := buildConfigCenter(base, generatedMap, userMap, envMap, cli.Cfg)
	if err != nil {
		return cfg, sources, warnings, err
	}
	warnings = append(warnings, centerWarnings...)
	builtin, builtinWarnings, err := buildBuiltin(base, generatedMap, userMap, envMap, cli.Cfg, &center)
	if err != nil {
		return cfg, sources, warnings, err
	}
	warnings = append(warnings, builtinWarnings...)
	cfg.ConfigCenter = center
	cfg.Builtin = builtin
	if err := applyBuiltin(&cfg, builtin); err != nil {
		return cfg, sources, warnings, err
	}
	applyBuiltinCache(&cfg, builtin)

	if cfg.Language != "go" {
		warnings = append(warnings, fmt.Sprintf("配置文件声明 language=%s，与本模板 go 不一致；运行时以模板为准", cfg.Language))
	}
	cfg.Language = "go"
	cfg.Maturity = "usable"
	return cfg, sources, warnings, nil
}

func parseCLI(args []string) (CLI, error) {
	var cli CLI
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--override" {
			cli.Override = true
			continue
		}
		if arg == "--migrate" {
			cli.MigrateUp = true
			continue
		}
		if arg == "--migrate-down" {
			cli.MigrateDown = true
			continue
		}
		if !strings.HasPrefix(arg, "--") {
			return cli, fmt.Errorf("无法识别的启动参数：%s", arg)
		}
		key := strings.TrimPrefix(arg, "--")
		inline := false
		value := ""
		if idx := strings.Index(key, "="); idx >= 0 {
			value = key[idx+1:]
			key = key[:idx]
			inline = true
		}
		allowed := map[string]bool{
			"host": true, "port": true, "log-level": true, "config": true,
			"body-limit-bytes": true, "timeout-seconds": true, "cache-enabled": true,
			"cfg": true,
		}
		if !allowed[key] {
			return cli, fmt.Errorf("未知启动参数：%s，可用：--host --port --log-level --config --body-limit-bytes --timeout-seconds --cache-enabled --cfg KEY=VALUE --override --migrate --migrate-down", arg)
		}
		if !inline {
			if i+1 >= len(args) || strings.HasPrefix(args[i+1], "--") {
				return cli, fmt.Errorf("启动参数 %s 缺少值", arg)
			}
			value = args[i+1]
			i++
		}
		switch key {
		case "host":
			cli.Host = &value
		case "port":
			cli.Port = &value
		case "log-level":
			cli.LogLevel = &value
		case "config":
			cli.Config = &value
		case "body-limit-bytes":
			cli.BodyLimitBytes = &value
		case "timeout-seconds":
			cli.TimeoutSeconds = &value
		case "cache-enabled":
			cli.CacheEnabled = &value
		case "cfg":
			parts := strings.SplitN(value, "=", 2)
			if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
				return cli, fmt.Errorf("--cfg 需要 KEY=VALUE，收到：%s", value)
			}
			if cli.Cfg == nil {
				cli.Cfg = map[string]string{}
			}
			cli.Cfg[strings.TrimSpace(parts[0])] = parts[1]
		}
	}
	return cli, nil
}

func resolveConfigPath(cli CLI, environ []string, cwd string) (string, error) {
	envMap := envToMap(environ)
	explicit := cli.Config
	if explicit == nil {
		if v, ok := envMap["LC_CONFIG_FILE"]; ok && v != "" {
			value := v
			explicit = &value
		}
	}
	if explicit != nil {
		resolved := *explicit
		if !filepath.IsAbs(resolved) {
			resolved = filepath.Join(cwd, resolved)
		}
		if !exists(resolved) {
			return "", fmt.Errorf("指定的配置文件不存在：%s", resolved)
		}
		return resolved, nil
	}
	deployDir := filepath.Join(cwd, "..", "deploy", "backend")
	if info, err := os.Stat(deployDir); err == nil && info.IsDir() {
		return filepath.Join(deployDir, "config.yaml"), nil
	}
	return filepath.Join(cwd, "config.yaml"), nil
}

func readIfExists(path string) (string, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("读取配置失败 %s：%w", path, err)
	}
	// 编辑器另存为 UTF-8 with BOM 时去掉 BOM，避免首行键被当成未知配置项。
	return strings.TrimPrefix(string(data), "\uFEFF"), true, nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func envToMap(environ []string) map[string]string {
	out := map[string]string{}
	for _, entry := range environ {
		if idx := strings.Index(entry, "="); idx >= 0 {
			out[entry[:idx]] = entry[idx+1:]
		}
	}
	return out
}

// ---------------------------------------------------------------- 环境变量 / 启动参数

func applyEnv(cfg *Config, env map[string]string, used *[]string) error {
	if v := env["LC_HOST"]; v != "" {
		cfg.Host = v
		*used = append(*used, "LC_HOST")
	}
	if v := env["LC_PORT"]; v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_PORT 必须是 1024-65535 的整数，收到：%s", v)
		}
		cfg.Port = port
		*used = append(*used, "LC_PORT")
	}
	if v := env["LC_LOG_LEVEL"]; v != "" {
		cfg.LogLevel = v
		*used = append(*used, "LC_LOG_LEVEL")
	}
	if v := env["LC_CORS_ORIGINS"]; v != "" {
		var origins []string
		for _, part := range strings.Split(v, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
		cfg.CORS.Origins = origins
		*used = append(*used, "LC_CORS_ORIGINS")
	}
	if v := env["DATABASE_URL"]; v != "" {
		cfg.Database.URL = v
		*used = append(*used, "DATABASE_URL")
	}
	if v := env["LC_DB_DRIVER"]; v != "" {
		cfg.Database.Driver = v
		*used = append(*used, "LC_DB_DRIVER")
	}
	if v := env["LC_DB_HOST"]; v != "" {
		cfg.Database.Host = v
		*used = append(*used, "LC_DB_HOST")
	}
	if v := env["LC_DB_PORT"]; v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_DB_PORT 必须是 0-65535 的整数，收到：%s", v)
		}
		cfg.Database.Port = port
		*used = append(*used, "LC_DB_PORT")
	}
	if v := env["LC_DB_NAME"]; v != "" {
		cfg.Database.Name = v
		*used = append(*used, "LC_DB_NAME")
	}
	if v := env["LC_DB_USER"]; v != "" {
		cfg.Database.User = v
		*used = append(*used, "LC_DB_USER")
	}
	if v := env["LC_DB_PASSWORD"]; v != "" {
		cfg.Database.Password = v
		*used = append(*used, "LC_DB_PASSWORD")
	}
	if v := env["LC_DB_SSL_MODE"]; v != "" {
		cfg.Database.SSLMode = v
		*used = append(*used, "LC_DB_SSL_MODE")
	}
	if v := env["LC_DB_MAX_OPEN_CONNS"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_DB_MAX_OPEN_CONNS 必须是 1-1000 的整数，收到：%s", v)
		}
		cfg.Database.MaxOpenConns = value
		*used = append(*used, "LC_DB_MAX_OPEN_CONNS")
	}
	if v := env["LC_DB_CONNECT_TIMEOUT"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_DB_CONNECT_TIMEOUT 必须是 1-60 的整数（秒），收到：%s", v)
		}
		cfg.Database.ConnectTimeoutSeconds = value
		*used = append(*used, "LC_DB_CONNECT_TIMEOUT")
	}
	if v := env["LC_CACHE_DRIVER"]; v != "" {
		cfg.Cache.Driver = v
		*used = append(*used, "LC_CACHE_DRIVER")
	}
	if v := env["REDIS_URL"]; v != "" {
		cfg.Cache.URL = v
		*used = append(*used, "REDIS_URL")
	}
	if v := env["LC_CACHE_TTL_SECONDS"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_CACHE_TTL_SECONDS 必须是 0-86400 的整数，收到：%s", v)
		}
		cfg.Cache.TTLSeconds = value
		*used = append(*used, "LC_CACHE_TTL_SECONDS")
	}
	if v, ok := env["LC_CACHE_ENABLED"]; ok && v != "" {
		parsed, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("LC_CACHE_ENABLED 只能是 true/false，收到：%s", v)
		}
		cfg.Cache.Enabled = parsed
		*used = append(*used, "LC_CACHE_ENABLED")
	}
	if v := env["LC_CACHE_FALLBACK"]; v != "" {
		cfg.Cache.Fallback = v
		*used = append(*used, "LC_CACHE_FALLBACK")
	}

	setEnvBool := func(key string, target *bool) error {
		v, ok := env[key]
		if !ok || v == "" {
			return nil
		}
		parsed, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("%s 只能是 true/false，收到：%s", key, v)
		}
		*target = parsed
		*used = append(*used, key)
		return nil
	}
	setEnvInt := func(key string, target *int) error {
		v, ok := env[key]
		if !ok || v == "" {
			return nil
		}
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("%s 必须是整数，收到：%s", key, v)
		}
		*target = value
		*used = append(*used, key)
		return nil
	}
	if err := setEnvBool("LC_MW_REQUEST_ID", &cfg.Middleware.RequestID); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_LOGGING", &cfg.Middleware.Logging); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_BODY_LIMIT_ENABLED", &cfg.Middleware.BodyLimit.Enabled); err != nil {
		return err
	}
	if err := setEnvInt("LC_MW_BODY_LIMIT_BYTES", &cfg.Middleware.BodyLimit.MaxBytes); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_TIMEOUT_ENABLED", &cfg.Middleware.Timeout.Enabled); err != nil {
		return err
	}
	if err := setEnvInt("LC_MW_TIMEOUT_SECONDS", &cfg.Middleware.Timeout.Seconds); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_CONCURRENCY_ENABLED", &cfg.Middleware.Concurrency.Enabled); err != nil {
		return err
	}
	if err := setEnvInt("LC_MW_MAX_IN_FLIGHT", &cfg.Middleware.Concurrency.MaxInFlight); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_COMPRESSION_ENABLED", &cfg.Middleware.Compression.Enabled); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_COMPRESSION_GZIP", &cfg.Middleware.Compression.Gzip); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_COMPRESSION_BROTLI", &cfg.Middleware.Compression.Brotli); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_RATE_LIMIT_ENABLED", &cfg.Middleware.RateLimit.Enabled); err != nil {
		return err
	}
	if err := setEnvInt("LC_MW_RATE_LIMIT_RPS", &cfg.Middleware.RateLimit.RPS); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_STATIC_CACHE_ENABLED", &cfg.Middleware.StaticCache.Enabled); err != nil {
		return err
	}
	if err := setEnvInt("LC_MW_STATIC_MAX_AGE", &cfg.Middleware.StaticCache.MaxAgeSeconds); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_HEALTH_ENABLED", &cfg.Middleware.Health.Enabled); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_SECURITY_HEADERS_ENABLED", &cfg.Middleware.SecurityHeaders.Enabled); err != nil {
		return err
	}
	if err := setEnvBool("LC_MW_HSTS_ENABLED", &cfg.Middleware.SecurityHeaders.HSTS.Enabled); err != nil {
		return err
	}
	if v, ok := env["LC_STATIC_ENABLED"]; ok && v != "" {
		parsed, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("LC_STATIC_ENABLED 只能是 true/false，收到：%s", v)
		}
		cfg.Static.Enabled = parsed
		*used = append(*used, "LC_STATIC_ENABLED")
	}

	if v := env["LC_AUTH_TOKEN_MODE"]; v != "" {
		cfg.Auth.TokenMode = v
		*used = append(*used, "LC_AUTH_TOKEN_MODE")
	}
	if v := env["LC_AUTH_JWT_SECRET"]; v != "" {
		cfg.Auth.JWTSecret = v
		*used = append(*used, "LC_AUTH_JWT_SECRET")
	}
	if v := env["LC_AUTH_ACCESS_TTL_SECONDS"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_AUTH_ACCESS_TTL_SECONDS 必须是整数，收到：%s", v)
		}
		cfg.Auth.AccessTokenTTLSeconds = value
		*used = append(*used, "LC_AUTH_ACCESS_TTL_SECONDS")
	}
	if v := env["LC_AUTH_REFRESH_TTL_SECONDS"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_AUTH_REFRESH_TTL_SECONDS 必须是整数，收到：%s", v)
		}
		cfg.Auth.RefreshTokenTTLSeconds = value
		*used = append(*used, "LC_AUTH_REFRESH_TTL_SECONDS")
	}
	if v := env["LC_AUTH_SESSION_TTL_SECONDS"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_AUTH_SESSION_TTL_SECONDS 必须是整数，收到：%s", v)
		}
		cfg.Auth.SessionTTLSeconds = value
		*used = append(*used, "LC_AUTH_SESSION_TTL_SECONDS")
	}
	if v := env["LC_AUTH_MAX_LOGIN_FAILURES"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_AUTH_MAX_LOGIN_FAILURES 必须是整数，收到：%s", v)
		}
		cfg.Auth.MaxLoginFailures = value
		*used = append(*used, "LC_AUTH_MAX_LOGIN_FAILURES")
	}
	if v := env["LC_AUTH_LOCK_SECONDS"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_AUTH_LOCK_SECONDS 必须是整数，收到：%s", v)
		}
		cfg.Auth.LockSeconds = value
		*used = append(*used, "LC_AUTH_LOCK_SECONDS")
	}
	if v := env["LC_AUTH_BOOTSTRAP_USERNAME"]; v != "" {
		cfg.Auth.Bootstrap.Username = v
		*used = append(*used, "LC_AUTH_BOOTSTRAP_USERNAME")
	}
	if v := env["LC_AUTH_BOOTSTRAP_PASSWORD"]; v != "" {
		cfg.Auth.Bootstrap.Password = v
		*used = append(*used, "LC_AUTH_BOOTSTRAP_PASSWORD")
	}
	if v := env["LC_AUTH_BOOTSTRAP_ROLE"]; v != "" {
		cfg.Auth.Bootstrap.Role = v
		*used = append(*used, "LC_AUTH_BOOTSTRAP_ROLE")
	}

	if v, ok := env["LC_DATA_API_ENABLED"]; ok && v != "" {
		parsed, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("LC_DATA_API_ENABLED 只能是 true/false，收到：%s", v)
		}
		cfg.DataAPI.Enabled = parsed
		*used = append(*used, "LC_DATA_API_ENABLED")
	}
	if v, ok := env["LC_DATA_PUBLIC_READ"]; ok && v != "" {
		parsed, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("LC_DATA_PUBLIC_READ 只能是 true/false，收到：%s", v)
		}
		cfg.DataAPI.PublicRead = parsed
		*used = append(*used, "LC_DATA_PUBLIC_READ")
	}
	if v, ok := env["LC_DATA_WRITE_REQUIRES_AUTH"]; ok && v != "" {
		parsed, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("LC_DATA_WRITE_REQUIRES_AUTH 只能是 true/false，收到：%s", v)
		}
		cfg.DataAPI.WriteRequiresAuth = parsed
		*used = append(*used, "LC_DATA_WRITE_REQUIRES_AUTH")
	}
	if v := env["LC_DATA_WRITE_ROLES"]; v != "" {
		roles := make([]string, 0, 8)
		for _, part := range strings.Split(v, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				roles = append(roles, trimmed)
			}
		}
		cfg.DataAPI.WriteRoles = roles
		*used = append(*used, "LC_DATA_WRITE_ROLES")
	}
	if v := env["LC_DATA_MAX_PAGE_SIZE"]; v != "" {
		value, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LC_DATA_MAX_PAGE_SIZE 必须是 1-1000 的整数，收到：%s", v)
		}
		cfg.DataAPI.MaxPageSize = value
		*used = append(*used, "LC_DATA_MAX_PAGE_SIZE")
	}
	if v := env["LC_DATA_COLLECTIONS_DIR"]; v != "" {
		cfg.DataAPI.CollectionsDir = v
		*used = append(*used, "LC_DATA_COLLECTIONS_DIR")
	}
	return nil
}

func applyCLI(cfg *Config, cli CLI, used *[]string) error {
	if cli.Host != nil {
		cfg.Host = *cli.Host
		*used = append(*used, "--host")
	}
	if cli.Port != nil {
		port, err := strconv.Atoi(*cli.Port)
		if err != nil {
			return fmt.Errorf("--port 必须是 1024-65535 的整数，收到：%s", *cli.Port)
		}
		cfg.Port = port
		*used = append(*used, "--port")
	}
	if cli.LogLevel != nil {
		cfg.LogLevel = *cli.LogLevel
		*used = append(*used, "--log-level")
	}
	if cli.BodyLimitBytes != nil {
		value, err := strconv.Atoi(*cli.BodyLimitBytes)
		if err != nil {
			return fmt.Errorf("--body-limit-bytes 必须是正整数，收到：%s", *cli.BodyLimitBytes)
		}
		cfg.Middleware.BodyLimit.Enabled = true
		cfg.Middleware.BodyLimit.MaxBytes = value
		*used = append(*used, "--body-limit-bytes")
	}
	if cli.TimeoutSeconds != nil {
		value, err := strconv.Atoi(*cli.TimeoutSeconds)
		if err != nil {
			return fmt.Errorf("--timeout-seconds 必须是正整数，收到：%s", *cli.TimeoutSeconds)
		}
		cfg.Middleware.Timeout.Enabled = true
		cfg.Middleware.Timeout.Seconds = value
		*used = append(*used, "--timeout-seconds")
	}
	if cli.CacheEnabled != nil {
		parsed, err := parseBool(*cli.CacheEnabled)
		if err != nil {
			return fmt.Errorf("--cache-enabled 只能是 true/false，收到：%s", *cli.CacheEnabled)
		}
		cfg.Cache.Enabled = parsed
		*used = append(*used, "--cache-enabled")
	}
	if cli.Override {
		cfg.Override = true
		*used = append(*used, "--override")
	}
	return nil
}

func envBool(env map[string]string, key string) (bool, error) {
	v := env[key]
	if v == "" {
		return false, nil
	}
	parsed, err := parseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s 只能是 true/false，收到：%s", key, v)
	}
	return parsed, nil
}

func parseBool(v string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	}
	return false, fmt.Errorf("不是合法布尔值：%s", v)
}

func validate(cfg *Config) error {
	if cfg.SchemaVersion != 1 {
		return fmt.Errorf("schemaVersion 必须为 1，收到：%d", cfg.SchemaVersion)
	}
	if !sliceContains([]string{"rust", "node", "go"}, cfg.Language) {
		return fmt.Errorf("language 只能是 rust / node / go")
	}
	if !sliceContains([]string{"full", "usable", "minimal"}, cfg.Maturity) {
		return fmt.Errorf("maturity 只能是 full / usable / minimal")
	}
	if strings.TrimSpace(cfg.Host) == "" {
		return fmt.Errorf("host 必须是非空字符串")
	}
	if cfg.Port < 1024 || cfg.Port > 65535 {
		return fmt.Errorf("port 必须是 1024-65535 的整数，收到：%d", cfg.Port)
	}
	if !sliceContains([]string{"debug", "info", "warn", "error"}, cfg.LogLevel) {
		return fmt.Errorf("logLevel 只能是 debug / info / warn / error")
	}
	if cfg.CORS.MaxAge < 0 || cfg.CORS.MaxAge > 86400 {
		return fmt.Errorf("cors.maxAge 必须是 0-86400 的整数")
	}
	if cfg.CORS.Credentials && sliceContains(cfg.CORS.Origins, "*") {
		return fmt.Errorf("cors.credentials 为 true 时 origins 不能包含 *")
	}
	if cfg.Database.Driver != "sqlite" && cfg.Database.Driver != "mysql" && cfg.Database.Driver != "postgres" {
		return fmt.Errorf("database.driver 只能是 sqlite / mysql / postgres")
	}
	if url := strings.TrimSpace(cfg.Database.URL); url != "" {
		switch {
		case strings.HasPrefix(url, "sqlite://"):
		case strings.HasPrefix(url, "mysql://"):
		case strings.HasPrefix(url, "postgres://"), strings.HasPrefix(url, "postgresql://"):
		default:
			return fmt.Errorf("database.url 必须以 sqlite://、mysql:// 或 postgres:// 开头")
		}
	}
	if cfg.Database.Port < 0 || cfg.Database.Port > 65535 {
		return fmt.Errorf("database.port 必须是 0-65535 的整数（0 表示默认端口）")
	}
	if !sliceContains([]string{"disable", "require"}, cfg.Database.SSLMode) {
		return fmt.Errorf("database.sslMode 只能是 disable / require")
	}
	if cfg.Database.MaxOpenConns < 1 || cfg.Database.MaxOpenConns > 1000 {
		return fmt.Errorf("database.maxOpenConns 必须是 1-1000 的整数")
	}
	if cfg.Database.ConnectTimeoutSeconds < 1 || cfg.Database.ConnectTimeoutSeconds > 60 {
		return fmt.Errorf("database.connectTimeoutSeconds 必须是 1-60 的整数")
	}
	if !sliceContains([]string{"none", "memory", "redis"}, cfg.Cache.Driver) {
		return fmt.Errorf("cache.driver 只能是 none / memory / redis")
	}
	if !sliceContains([]string{"memory", "none"}, cfg.Cache.Fallback) {
		return fmt.Errorf("cache.fallback 只能是 memory / none（缓存关闭或 Redis 不可用时的回退目标）")
	}
	if cfg.Cache.TTLSeconds < 0 || cfg.Cache.TTLSeconds > 86400 {
		return fmt.Errorf("cache.ttlSeconds 必须是 0-86400 的整数")
	}
	if strings.TrimSpace(cfg.Cache.KeyPrefix) == "" {
		return fmt.Errorf("cache.keyPrefix 必须是非空字符串")
	}
	if cfg.Middleware.BodyLimit.MaxBytes < 1024 || cfg.Middleware.BodyLimit.MaxBytes > 268435456 {
		return fmt.Errorf("middleware.bodyLimit.maxBytes 必须是 1024-268435456 的整数")
	}
	if cfg.Middleware.Timeout.Seconds < 1 || cfg.Middleware.Timeout.Seconds > 600 {
		return fmt.Errorf("middleware.timeout.seconds 必须是 1-600 的整数")
	}
	if cfg.Middleware.Concurrency.MaxInFlight < 1 || cfg.Middleware.Concurrency.MaxInFlight > 10000 {
		return fmt.Errorf("middleware.concurrency.maxInFlight 必须是 1-10000 的整数")
	}
	if cfg.Middleware.Compression.MinBytes < 0 || cfg.Middleware.Compression.MinBytes > 1048576 {
		return fmt.Errorf("middleware.compression.minBytes 必须是 0-1048576 的整数")
	}
	if cfg.Middleware.Compression.Enabled && !cfg.Middleware.Compression.Gzip && !cfg.Middleware.Compression.Brotli {
		return fmt.Errorf("middleware.compression 开启时 gzip / brotli 至少要选一种")
	}
	if cfg.Middleware.StaticCache.MaxAgeSeconds < 0 || cfg.Middleware.StaticCache.MaxAgeSeconds > 31536000 {
		return fmt.Errorf("middleware.staticCache.maxAgeSeconds 必须是 0-31536000 的整数")
	}
	if cfg.Middleware.StaticCache.ImmutableMaxAgeSeconds < 0 || cfg.Middleware.StaticCache.ImmutableMaxAgeSeconds > 31536000 {
		return fmt.Errorf("middleware.staticCache.immutableMaxAgeSeconds 必须是 0-31536000 的整数")
	}
	if cfg.Middleware.SecurityHeaders.HSTS.MaxAgeSeconds < 0 || cfg.Middleware.SecurityHeaders.HSTS.MaxAgeSeconds > 31536000 {
		return fmt.Errorf("middleware.securityHeaders.hsts.maxAgeSeconds 必须是 0-31536000 的整数")
	}
	if cfg.Middleware.RateLimit.RPS < 1 || cfg.Middleware.RateLimit.RPS > 10000 {
		return fmt.Errorf("middleware.rateLimit.rps 必须是 1-10000 的整数")
	}
	if strings.TrimSpace(cfg.Static.Root) == "" {
		return fmt.Errorf("static.root 必须是非空字符串")
	}
	if !sliceContains([]string{"jwt", "session"}, cfg.Auth.TokenMode) {
		return fmt.Errorf("auth.tokenMode 只能是 jwt / session")
	}
	if cfg.Auth.AccessTokenTTLSeconds < 60 || cfg.Auth.AccessTokenTTLSeconds > 86400 {
		return fmt.Errorf("auth.accessTokenTtlSeconds 必须是 60-86400 的整数")
	}
	if cfg.Auth.RefreshTokenTTLSeconds < 3600 || cfg.Auth.RefreshTokenTTLSeconds > 2592000 {
		return fmt.Errorf("auth.refreshTokenTtlSeconds 必须是 3600-2592000 的整数")
	}
	if cfg.Auth.SessionTTLSeconds < 60 || cfg.Auth.SessionTTLSeconds > 2592000 {
		return fmt.Errorf("auth.sessionTtlSeconds 必须是 60-2592000 的整数")
	}
	if cfg.Auth.MaxLoginFailures < 1 || cfg.Auth.MaxLoginFailures > 100 {
		return fmt.Errorf("auth.maxLoginFailures 必须是 1-100 的整数")
	}
	if cfg.Auth.FailureWindowSeconds < 10 || cfg.Auth.FailureWindowSeconds > 86400 {
		return fmt.Errorf("auth.failureWindowSeconds 必须是 10-86400 的整数")
	}
	if cfg.Auth.LockSeconds < 10 || cfg.Auth.LockSeconds > 86400 {
		return fmt.Errorf("auth.lockSeconds 必须是 10-86400 的整数")
	}
	if cfg.DataAPI.MaxPageSize < 1 || cfg.DataAPI.MaxPageSize > 1000 {
		return fmt.Errorf("dataApi.maxPageSize 必须是 1-1000 的整数")
	}
	if strings.TrimSpace(cfg.DataAPI.CollectionsDir) == "" {
		return fmt.Errorf("dataApi.collectionsDir 必须是非空字符串")
	}
	return nil
}

// ---------------------------------------------------------------- map 与结构体互转

func defaultsMap() map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"language":      "go",
		"maturity":      "usable",
		"strict":        true,
		"override":      false,
		"host":          "127.0.0.1",
		"port":          8080,
		"logLevel":      "info",
		"cors": map[string]any{
			"enabled":     true,
			"origins":     []any{},
			"methods":     []any{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			"headers":     []any{"content-type", "authorization", "x-request-id"},
			"credentials": false,
			"maxAge":      600,
		},
		"database": map[string]any{
			"driver":                "sqlite",
			"url":                   "sqlite://data/app.db",
			"host":                  "127.0.0.1",
			"port":                  0,
			"name":                  "app",
			"user":                  "",
			"password":              "",
			"sslMode":               "disable",
			"maxOpenConns":          10,
			"connectTimeoutSeconds": 5,
		},
		"cache": map[string]any{
			"enabled":    true,
			"fallback":   "memory",
			"driver":     "memory",
			"url":        "redis://127.0.0.1:16379/0",
			"ttlSeconds": 30,
			"keyPrefix":  "lc:",
		},
		"auth": map[string]any{
			"tokenMode":              "jwt",
			"jwtSecret":              "",
			"accessTokenTtlSeconds":  900,
			"refreshTokenTtlSeconds": 604800,
			"sessionTtlSeconds":      28800,
			"maxLoginFailures":       5,
			"failureWindowSeconds":   300,
			"lockSeconds":            900,
			"bootstrap": map[string]any{
				"username": "",
				"password": "",
				"role":     "admin",
			},
		},
		"middleware": map[string]any{
			"requestId": true,
			"logging":   true,
			"bodyLimit": map[string]any{"enabled": true, "maxBytes": 1048576},
			"timeout":   map[string]any{"enabled": true, "seconds": 30},
			"concurrency": map[string]any{
				"enabled": false, "maxInFlight": 64,
			},
			"compression": map[string]any{
				"enabled": true, "gzip": true, "brotli": true, "minBytes": 1024,
			},
			"rateLimit": map[string]any{"enabled": false, "rps": 20},
			"staticCache": map[string]any{
				"enabled": true, "maxAgeSeconds": 3600, "immutableMaxAgeSeconds": 31536000,
			},
			"health": map[string]any{
				"enabled": true, "readinessRequiresDatabase": true, "readinessRequiresCache": false,
			},
			"securityHeaders": map[string]any{
				"enabled": true,
				"hsts": map[string]any{
					"enabled": false, "maxAgeSeconds": 31536000, "includeSubdomains": true, "preload": false,
				},
				"contentTypeOptions":      "nosniff",
				"frameOptions":            "SAMEORIGIN",
				"referrerPolicy":          "strict-origin-when-cross-origin",
				"permissionsPolicy":       "geolocation=(), microphone=(), camera=()",
				"crossOriginOpenerPolicy": "same-origin",
			},
			"builtin": builtinDefaultsMap(),
		},
		"static": map[string]any{"enabled": false, "root": "../web"},
		"configCenter": map[string]any{
			"definitions": []any{},
			"values":      map[string]any{},
		},
		"dataApi": map[string]any{
			"enabled":           true,
			"publicRead":        true,
			"writeRequiresAuth": true,
			"writeRoles":        []any{},
			"maxPageSize":       100,
			"collectionsDir":    "../web/data/collections",
		},
	}
}

// normalizeMiddlewareShapes 兼容旧写法：compression / securityHeaders 允许直接写 true/false，
// 在 decode 前统一规范化为 { enabled, ...默认参数 }，避免旧 config.yaml 报结构错误。
func normalizeMiddlewareShapes(base map[string]any) []string {
	mw, ok := base["middleware"].(map[string]any)
	if !ok {
		return nil
	}
	defaults := defaultsMap()["middleware"].(map[string]any)
	var warnings []string
	for _, key := range []string{"compression", "securityHeaders"} {
		flag, ok := mw[key].(bool)
		if !ok {
			continue
		}
		normalized := cloneMap(defaults[key].(map[string]any))
		normalized["enabled"] = flag
		mw[key] = normalized
		state := "关闭"
		if flag {
			state = "开启"
		}
		warnings = append(warnings, fmt.Sprintf("middleware.%s 使用了简写布尔值，已按%s并套用默认参数", key, state))
	}
	return warnings
}

func cloneMap(source map[string]any) map[string]any {
	out := make(map[string]any, len(source))
	for key, value := range source {
		if child, ok := value.(map[string]any); ok {
			out[key] = cloneMap(child)
			continue
		}
		out[key] = value
	}
	return out
}

func decode(base map[string]any) (Config, error) {
	cfg := Defaults()

	cfg.SchemaVersion = mustInt(base, "schemaVersion", 0)
	cfg.Language = mustString(base, "language", "go")
	cfg.Maturity = mustString(base, "maturity", "usable")
	cfg.Strict = mustBool(base, "strict", true)
	cfg.Override = mustBool(base, "override", false)
	cfg.Host = mustString(base, "host", "127.0.0.1")
	cfg.Port = mustInt(base, "port", 8080)
	cfg.LogLevel = mustString(base, "logLevel", "info")

	cors := mustMap(base, "cors")
	cfg.CORS = CORS{
		Enabled:     mapBool(cors, "enabled", true),
		Origins:     mapStrings(cors, "origins"),
		Methods:     mapStrings(cors, "methods"),
		Headers:     mapStrings(cors, "headers"),
		Credentials: mapBool(cors, "credentials", false),
		MaxAge:      mapInt(cors, "maxAge", 600),
	}

	database := mustMap(base, "database")
	cfg.Database = Database{
		Driver:                mapString(database, "driver", "sqlite"),
		URL:                   mapString(database, "url", "sqlite://data/app.db"),
		Host:                  mapString(database, "host", "127.0.0.1"),
		Port:                  mapInt(database, "port", 0),
		Name:                  mapString(database, "name", "app"),
		User:                  mapString(database, "user", ""),
		Password:              mapString(database, "password", ""),
		SSLMode:               mapString(database, "sslMode", "disable"),
		MaxOpenConns:          mapInt(database, "maxOpenConns", 10),
		ConnectTimeoutSeconds: mapInt(database, "connectTimeoutSeconds", 5),
	}

	cacheCfg := mustMap(base, "cache")
	cfg.Cache = Cache{
		Enabled:    mapBool(cacheCfg, "enabled", true),
		Fallback:   mapString(cacheCfg, "fallback", "memory"),
		Driver:     mapString(cacheCfg, "driver", "memory"),
		URL:        mapString(cacheCfg, "url", "redis://127.0.0.1:16379/0"),
		TTLSeconds: mapInt(cacheCfg, "ttlSeconds", 30),
		KeyPrefix:  mapString(cacheCfg, "keyPrefix", "lc:"),
	}

	authCfg := mustMap(base, "auth")
	bootstrapCfg := mapMap(authCfg, "bootstrap")
	cfg.Auth = Auth{
		TokenMode:              mapString(authCfg, "tokenMode", "jwt"),
		JWTSecret:              mapString(authCfg, "jwtSecret", ""),
		AccessTokenTTLSeconds:  mapInt(authCfg, "accessTokenTtlSeconds", 900),
		RefreshTokenTTLSeconds: mapInt(authCfg, "refreshTokenTtlSeconds", 604800),
		SessionTTLSeconds:      mapInt(authCfg, "sessionTtlSeconds", 28800),
		MaxLoginFailures:       mapInt(authCfg, "maxLoginFailures", 5),
		FailureWindowSeconds:   mapInt(authCfg, "failureWindowSeconds", 300),
		LockSeconds:            mapInt(authCfg, "lockSeconds", 900),
		Bootstrap: Bootstrap{
			Username: mapString(bootstrapCfg, "username", ""),
			Password: mapString(bootstrapCfg, "password", ""),
			Role:     mapString(bootstrapCfg, "role", "admin"),
		},
	}

	mw := mustMap(base, "middleware")
	bodyLimit := mapMap(mw, "bodyLimit")
	timeoutCfg := mapMap(mw, "timeout")
	concurrencyCfg := mapMap(mw, "concurrency")
	compressionCfg := mapMap(mw, "compression")
	rate := mapMap(mw, "rateLimit")
	staticCacheCfg := mapMap(mw, "staticCache")
	healthCfg := mapMap(mw, "health")
	securityCfg := mapMap(mw, "securityHeaders")
	hstsCfg := mapMap(securityCfg, "hsts")
	cfg.Middleware = Middleware{
		RequestID: mapBool(mw, "requestId", true),
		Logging:   mapBool(mw, "logging", true),
		BodyLimit: BodyLimit{
			Enabled:  mapBool(bodyLimit, "enabled", true),
			MaxBytes: mapInt(bodyLimit, "maxBytes", 1048576),
		},
		Timeout: Timeout{
			Enabled: mapBool(timeoutCfg, "enabled", true),
			Seconds: mapInt(timeoutCfg, "seconds", 30),
		},
		Concurrency: Concurrency{
			Enabled:     mapBool(concurrencyCfg, "enabled", false),
			MaxInFlight: mapInt(concurrencyCfg, "maxInFlight", 64),
		},
		Compression: Compression{
			Enabled:  mapBool(compressionCfg, "enabled", true),
			Gzip:     mapBool(compressionCfg, "gzip", true),
			Brotli:   mapBool(compressionCfg, "brotli", true),
			MinBytes: mapInt(compressionCfg, "minBytes", 1024),
		},
		RateLimit: RateLimit{
			Enabled: mapBool(rate, "enabled", false),
			RPS:     mapInt(rate, "rps", 20),
		},
		StaticCache: StaticCache{
			Enabled:                mapBool(staticCacheCfg, "enabled", true),
			MaxAgeSeconds:          mapInt(staticCacheCfg, "maxAgeSeconds", 3600),
			ImmutableMaxAgeSeconds: mapInt(staticCacheCfg, "immutableMaxAgeSeconds", 31536000),
		},
		Health: Health{
			Enabled:                   mapBool(healthCfg, "enabled", true),
			ReadinessRequiresDatabase: mapBool(healthCfg, "readinessRequiresDatabase", true),
			ReadinessRequiresCache:    mapBool(healthCfg, "readinessRequiresCache", false),
		},
		SecurityHeaders: SecurityHeaders{
			Enabled: mapBool(securityCfg, "enabled", true),
			HSTS: HSTS{
				Enabled:           mapBool(hstsCfg, "enabled", false),
				MaxAgeSeconds:     mapInt(hstsCfg, "maxAgeSeconds", 31536000),
				IncludeSubdomains: mapBool(hstsCfg, "includeSubdomains", true),
				Preload:           mapBool(hstsCfg, "preload", false),
			},
			ContentTypeOptions:      mapString(securityCfg, "contentTypeOptions", "nosniff"),
			FrameOptions:            mapString(securityCfg, "frameOptions", "SAMEORIGIN"),
			ReferrerPolicy:          mapString(securityCfg, "referrerPolicy", "strict-origin-when-cross-origin"),
			PermissionsPolicy:       mapString(securityCfg, "permissionsPolicy", "geolocation=(), microphone=(), camera=()"),
			CrossOriginOpenerPolicy: mapString(securityCfg, "crossOriginOpenerPolicy", "same-origin"),
		},
	}

	static := mustMap(base, "static")
	cfg.Static = Static{
		Enabled: mapBool(static, "enabled", false),
		Root:    mapString(static, "root", "../web"),
	}

	dataAPI := mustMap(base, "dataApi")
	cfg.DataAPI = DataAPI{
		Enabled:           mapBool(dataAPI, "enabled", true),
		PublicRead:        mapBool(dataAPI, "publicRead", true),
		WriteRequiresAuth: mapBool(dataAPI, "writeRequiresAuth", true),
		WriteRoles:        mapStrings(dataAPI, "writeRoles"),
		MaxPageSize:       mapInt(dataAPI, "maxPageSize", 100),
		CollectionsDir:    mapString(dataAPI, "collectionsDir", "../web/data/collections"),
	}

	return cfg, nil
}

var allowedKeys = map[string][]string{
	"": {
		"schemaVersion", "language", "maturity", "strict", "override",
		"host", "port", "logLevel", "cors", "database", "cache", "auth", "middleware", "static", "dataApi", "configCenter",
	},
	"cors": {"enabled", "origins", "methods", "headers", "credentials", "maxAge"},
	"database": {
		"driver", "url", "host", "port", "name", "user", "password", "sslMode",
		"maxOpenConns", "connectTimeoutSeconds",
	},
	"cache": {"enabled", "fallback", "driver", "url", "ttlSeconds", "keyPrefix"},
	"auth": {
		"tokenMode", "jwtSecret", "accessTokenTtlSeconds", "refreshTokenTtlSeconds",
		"sessionTtlSeconds", "maxLoginFailures", "failureWindowSeconds", "lockSeconds", "bootstrap",
	},
	"auth.bootstrap": {"username", "password", "role"},
	"middleware": {
		"requestId", "logging", "bodyLimit", "timeout", "concurrency", "compression",
		"rateLimit", "staticCache", "health", "securityHeaders", "builtin",
	},
	"configCenter":           {"definitions", "values"},
	"middleware.bodyLimit":   {"enabled", "maxBytes"},
	"middleware.timeout":     {"enabled", "seconds"},
	"middleware.concurrency": {"enabled", "maxInFlight"},
	"middleware.compression": {"enabled", "gzip", "brotli", "minBytes"},
	"middleware.rateLimit":   {"enabled", "rps"},
	"middleware.staticCache": {"enabled", "maxAgeSeconds", "immutableMaxAgeSeconds"},
	"middleware.health": {
		"enabled", "readinessRequiresDatabase", "readinessRequiresCache",
	},
	"middleware.securityHeaders": {
		"enabled", "hsts", "contentTypeOptions", "frameOptions", "referrerPolicy",
		"permissionsPolicy", "crossOriginOpenerPolicy",
	},
	"middleware.securityHeaders.hsts": {"enabled", "maxAgeSeconds", "includeSubdomains", "preload"},
	"middleware.builtin": {
		"postgres", "mysql", "sqlite", "redis",
		"objectStorage", "messageQueue", "search", "reverseProxy",
	},
	"middleware.builtin.postgres": {
		"enabled", "config",
	},
	"middleware.builtin.postgres.config": {
		"host", "port", "database", "user", "password", "sslMode", "maxOpenConns", "connectTimeoutSeconds",
	},
	"middleware.builtin.mysql": {"enabled", "config"},
	"middleware.builtin.mysql.config": {
		"host", "port", "database", "user", "password", "maxOpenConns", "connectTimeoutSeconds",
	},
	"middleware.builtin.sqlite":        {"enabled", "config"},
	"middleware.builtin.sqlite.config": {"file"},
	"middleware.builtin.redis":         {"enabled", "config"},
	"middleware.builtin.redis.config": {
		"url", "ttlSeconds", "keyPrefix", "password",
	},
	"middleware.builtin.objectStorage": {"enabled", "config"},
	"middleware.builtin.objectStorage.config": {
		"driver", "endpoint", "bucket", "region", "accessKey", "secretKey",
	},
	"middleware.builtin.messageQueue":        {"enabled", "config"},
	"middleware.builtin.messageQueue.config": {"driver", "url", "queue"},
	"middleware.builtin.search":              {"enabled", "config"},
	"middleware.builtin.search.config":       {"driver", "url", "index"},
	"middleware.builtin.reverseProxy":        {"enabled", "config"},
	"middleware.builtin.reverseProxy.config": {
		"upstream", "clientMaxBodySize",
	},
	"static": {"enabled", "root"},
	"dataApi": {
		"enabled", "publicRead", "writeRequiresAuth", "writeRoles", "maxPageSize", "collectionsDir",
	},
}

func collectUnknown(value map[string]any, prefix string) []string {
	keys, ok := allowedKeys[prefix]
	if !ok {
		return nil
	}
	var out []string
	names := make([]string, 0, len(value))
	for key := range value {
		names = append(names, key)
	}
	sort.Strings(names)
	for _, key := range names {
		child := value[key]
		childMap, isMap := child.(map[string]any)
		if !sliceContains(keys, key) {
			out = append(out, joinKey(prefix, key))
			continue
		}
		if isMap {
			out = append(out, collectUnknown(childMap, joinKey(prefix, key))...)
		}
	}
	return out
}

func joinKey(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + "." + key
}

// checkTypes 保证字段类型正确，避免把 "port: abc" 这种配置默默当成默认值。
func checkTypes(base map[string]any) error {
	ints := []string{
		"schemaVersion", "port", "cors.maxAge",
		"middleware.bodyLimit.maxBytes", "middleware.timeout.seconds",
		"middleware.concurrency.maxInFlight", "middleware.compression.minBytes",
		"middleware.rateLimit.rps", "middleware.staticCache.maxAgeSeconds",
		"middleware.staticCache.immutableMaxAgeSeconds",
		"middleware.securityHeaders.hsts.maxAgeSeconds",
		"middleware.builtin.postgres.config.port", "middleware.builtin.postgres.config.maxOpenConns",
		"middleware.builtin.postgres.config.connectTimeoutSeconds",
		"middleware.builtin.mysql.config.port", "middleware.builtin.mysql.config.maxOpenConns",
		"middleware.builtin.mysql.config.connectTimeoutSeconds",
		"middleware.builtin.redis.config.ttlSeconds",
		"database.port", "database.maxOpenConns", "database.connectTimeoutSeconds",
		"cache.ttlSeconds",
		"auth.accessTokenTtlSeconds", "auth.refreshTokenTtlSeconds", "auth.sessionTtlSeconds",
		"auth.maxLoginFailures", "auth.failureWindowSeconds", "auth.lockSeconds",
		"dataApi.maxPageSize",
	}
	bools := []string{
		"strict", "override",
		"cors.enabled", "cors.credentials",
		"cache.enabled",
		"middleware.requestId", "middleware.logging",
		"middleware.bodyLimit.enabled", "middleware.timeout.enabled",
		"middleware.concurrency.enabled",
		"middleware.compression.enabled", "middleware.compression.gzip", "middleware.compression.brotli",
		"middleware.rateLimit.enabled",
		"middleware.staticCache.enabled",
		"middleware.health.enabled", "middleware.health.readinessRequiresDatabase",
		"middleware.health.readinessRequiresCache",
		"middleware.securityHeaders.enabled",
		"middleware.securityHeaders.hsts.enabled", "middleware.securityHeaders.hsts.includeSubdomains",
		"middleware.securityHeaders.hsts.preload",
		"middleware.builtin.postgres.enabled", "middleware.builtin.mysql.enabled",
		"middleware.builtin.sqlite.enabled", "middleware.builtin.redis.enabled",
		"middleware.builtin.objectStorage.enabled", "middleware.builtin.messageQueue.enabled",
		"middleware.builtin.search.enabled", "middleware.builtin.reverseProxy.enabled",
		"static.enabled",
		"dataApi.enabled", "dataApi.publicRead", "dataApi.writeRequiresAuth",
	}
	stringsList := []string{
		"language", "maturity", "host", "logLevel",
		"database.driver", "database.url", "database.host", "database.name",
		"database.user", "database.password", "database.sslMode",
		"cache.fallback", "cache.driver", "cache.url", "cache.keyPrefix",
		"middleware.securityHeaders.contentTypeOptions", "middleware.securityHeaders.frameOptions",
		"middleware.securityHeaders.referrerPolicy", "middleware.securityHeaders.permissionsPolicy",
		"middleware.securityHeaders.crossOriginOpenerPolicy",
		"middleware.builtin.postgres.config.host", "middleware.builtin.postgres.config.database",
		"middleware.builtin.postgres.config.user", "middleware.builtin.postgres.config.password",
		"middleware.builtin.postgres.config.sslMode",
		"middleware.builtin.mysql.config.host", "middleware.builtin.mysql.config.database",
		"middleware.builtin.mysql.config.user", "middleware.builtin.mysql.config.password",
		"middleware.builtin.sqlite.config.file",
		"middleware.builtin.redis.config.url", "middleware.builtin.redis.config.keyPrefix",
		"middleware.builtin.redis.config.password",
		"middleware.builtin.objectStorage.config.driver", "middleware.builtin.objectStorage.config.endpoint",
		"middleware.builtin.objectStorage.config.bucket", "middleware.builtin.objectStorage.config.region",
		"middleware.builtin.objectStorage.config.accessKey", "middleware.builtin.objectStorage.config.secretKey",
		"middleware.builtin.messageQueue.config.driver", "middleware.builtin.messageQueue.config.url",
		"middleware.builtin.messageQueue.config.queue",
		"middleware.builtin.search.config.driver", "middleware.builtin.search.config.url",
		"middleware.builtin.search.config.index",
		"middleware.builtin.reverseProxy.config.upstream", "middleware.builtin.reverseProxy.config.clientMaxBodySize",
		"auth.tokenMode", "auth.jwtSecret", "auth.bootstrap.username", "auth.bootstrap.password", "auth.bootstrap.role",
		"static.root",
		"dataApi.collectionsDir",
	}
	arrays := []string{"cors.origins", "cors.methods", "cors.headers", "dataApi.writeRoles"}

	for _, path := range ints {
		if !isInt(valueAt(base, path)) {
			return fmt.Errorf("%s 必须是整数", path)
		}
	}
	for _, path := range bools {
		if _, ok := valueAt(base, path).(bool); !ok {
			return fmt.Errorf("%s 必须是 true/false", path)
		}
	}
	for _, path := range stringsList {
		if _, ok := valueAt(base, path).(string); !ok {
			return fmt.Errorf("%s 必须是字符串", path)
		}
	}
	for _, path := range arrays {
		if !isStringArray(valueAt(base, path)) {
			return fmt.Errorf("%s 必须是字符串列表", path)
		}
	}
	return nil
}

func valueAt(root map[string]any, path string) any {
	var current any = root
	for _, part := range strings.Split(path, ".") {
		asMap, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = asMap[part]
	}
	return current
}

func isInt(value any) bool {
	switch value.(type) {
	case int, int64, float64:
		return true
	}
	return false
}

func isStringArray(value any) bool {
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if _, ok := item.(string); !ok {
			return false
		}
	}
	return true
}

func mergeMap(base, over map[string]any) error {
	for key, value := range over {
		if child, ok := value.(map[string]any); ok {
			if existing, ok := base[key].(map[string]any); ok {
				if err := mergeMap(existing, child); err != nil {
					return err
				}
				continue
			}
		}
		base[key] = value
	}
	return nil
}

func boolField(m map[string]any, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

// ---------------------------------------------------------------- YAML 子集 / JSON

func parseConfigText(text, file string) (map[string]any, error) {
	body := strings.TrimSpace(strings.TrimPrefix(text, "\ufeff"))
	if body == "" {
		return map[string]any{}, nil
	}
	if strings.HasPrefix(body, "{") {
		var out map[string]any
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			return nil, fmt.Errorf("%s 不是合法 JSON：%w", file, err)
		}
		return out, nil
	}
	return parseYAML(text, file)
}

type yamlLine struct {
	indent int
	text   string
	lineNo int
}

func parseYAML(text, file string) (map[string]any, error) {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	var lines []yamlLine
	for i, raw := range strings.Split(normalized, "\n") {
		lead := len(raw) - len(strings.TrimLeft(raw, " \t"))
		if strings.Contains(raw[:lead], "\t") {
			return nil, fmt.Errorf("%s:%d 缩进只能用空格", file, i+1)
		}
		content := strings.TrimRight(stripComment(raw[lead:]), " ")
		if strings.TrimSpace(content) == "" {
			continue
		}
		lines = append(lines, yamlLine{indent: lead, text: content, lineNo: i + 1})
	}
	if len(lines) == 0 {
		return map[string]any{}, nil
	}
	pos := 0
	node, err := parseNode(lines, &pos, lines[0].indent, file)
	if err != nil {
		return nil, err
	}
	asMap, ok := node.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s 顶层必须是映射", file)
	}
	return asMap, nil
}

func parseNode(lines []yamlLine, pos *int, indent int, file string) (any, error) {
	if *pos >= len(lines) {
		return nil, nil
	}
	if strings.HasPrefix(lines[*pos].text, "- ") || lines[*pos].text == "-" {
		return parseSequence(lines, pos, indent, file)
	}
	return parseMapping(lines, pos, indent, file)
}

func parseMapping(lines []yamlLine, pos *int, indent int, file string) (map[string]any, error) {
	out := map[string]any{}
	for *pos < len(lines) && lines[*pos].indent >= indent {
		line := lines[*pos]
		if line.indent > indent {
			return nil, fmt.Errorf("%s:%d 缩进层级不匹配", file, line.lineNo)
		}
		idx := strings.Index(line.text, ":")
		if idx < 0 {
			return nil, fmt.Errorf("%s:%d 缺少冒号", file, line.lineNo)
		}
		key := strings.TrimSpace(line.text[:idx])
		rest := strings.TrimSpace(line.text[idx+1:])
		*pos++
		if rest == "" {
			if *pos < len(lines) && lines[*pos].indent > indent {
				child, err := parseNode(lines, pos, lines[*pos].indent, file)
				if err != nil {
					return nil, err
				}
				out[key] = child
			} else {
				out[key] = nil
			}
			continue
		}
		value, err := parseInline(rest)
		if err != nil {
			return nil, fmt.Errorf("%s:%d %w", file, line.lineNo, err)
		}
		out[key] = value
	}
	return out, nil
}

func parseSequence(lines []yamlLine, pos *int, indent int, file string) ([]any, error) {
	out := []any{}
	for *pos < len(lines) && lines[*pos].indent == indent &&
		(strings.HasPrefix(lines[*pos].text, "- ") || lines[*pos].text == "-") {
		line := lines[*pos]
		item := strings.TrimSpace(strings.TrimPrefix(line.text, "-"))
		*pos++
		if item == "" {
			if *pos < len(lines) && lines[*pos].indent > indent {
				child, err := parseNode(lines, pos, lines[*pos].indent, file)
				if err != nil {
					return nil, err
				}
				out = append(out, child)
			} else {
				out = append(out, nil)
			}
			continue
		}
		// 支持 `- key: value` 形式的映射序列（例如 configCenter.definitions），
		// 后续同级字段的缩进为 dash 缩进 + 2。URL 这类 "http://..." 只在冒号后无空格，
		// 不会被误判为映射。
		if strings.Contains(item, ": ") || strings.HasSuffix(item, ":") {
			itemIndent := indent + 2
			mapping := map[string]any{}
			if err := assignMappingEntry(mapping, item, line.lineNo, lines, pos, itemIndent, file, false); err != nil {
				return nil, err
			}
			for *pos < len(lines) && lines[*pos].indent > indent {
				next := lines[*pos]
				if next.indent != itemIndent {
					return nil, fmt.Errorf("%s:%d 缩进层级不匹配", file, next.lineNo)
				}
				if strings.HasPrefix(next.text, "- ") || next.text == "-" {
					break
				}
				if err := assignMappingEntry(mapping, next.text, next.lineNo, lines, pos, itemIndent, file, true); err != nil {
					return nil, err
				}
			}
			out = append(out, mapping)
			continue
		}
		value, err := parseInline(item)
		if err != nil {
			return nil, fmt.Errorf("%s:%d %w", file, line.lineNo, err)
		}
		out = append(out, value)
	}
	return out, nil
}

// assignMappingEntry 解析一行 `key: value` 并写入 mapping。consumed=true 表示该行尚未被调用方消费。
func assignMappingEntry(mapping map[string]any, text string, lineNo int, lines []yamlLine, pos *int, indent int, file string, consumed bool) error {
	if consumed {
		*pos++
	}
	idx := strings.Index(text, ":")
	if idx < 0 {
		return fmt.Errorf("%s:%d 缺少冒号", file, lineNo)
	}
	key := strings.TrimSpace(text[:idx])
	rest := strings.TrimSpace(text[idx+1:])
	if rest == "" {
		if *pos < len(lines) && lines[*pos].indent > indent {
			child, err := parseNode(lines, pos, lines[*pos].indent, file)
			if err != nil {
				return err
			}
			mapping[key] = child
		} else {
			mapping[key] = nil
		}
		return nil
	}
	value, err := parseInline(rest)
	if err != nil {
		return fmt.Errorf("%s:%d %w", file, lineNo, err)
	}
	mapping[key] = value
	return nil
}

func parseInline(raw string) (any, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]") {
		inner := strings.TrimSpace(raw[1 : len(raw)-1])
		items := []any{}
		if inner == "" {
			return items, nil
		}
		for _, part := range splitTopLevel(inner, ',') {
			value, err := parseScalar(strings.TrimSpace(part))
			if err != nil {
				return nil, err
			}
			items = append(items, value)
		}
		return items, nil
	}
	return parseScalar(raw)
}

func splitTopLevel(text string, sep rune) []string {
	var out []string
	var current strings.Builder
	var quote rune
	for _, ch := range text {
		switch {
		case quote != 0:
			current.WriteRune(ch)
			if ch == quote {
				quote = 0
			}
		case ch == '"' || ch == '\'':
			quote = ch
			current.WriteRune(ch)
		case ch == sep:
			out = append(out, current.String())
			current.Reset()
		default:
			current.WriteRune(ch)
		}
	}
	out = append(out, current.String())
	return out
}

func parseScalar(raw string) (any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "~" || raw == "null" {
		return nil, nil
	}
	if len(raw) >= 2 {
		if (raw[0] == '"' && raw[len(raw)-1] == '"') || (raw[0] == '\'' && raw[len(raw)-1] == '\'') {
			return raw[1 : len(raw)-1], nil
		}
	}
	switch strings.ToLower(raw) {
	case "true", "yes", "on":
		return true, nil
	case "false", "no", "off":
		return false, nil
	}
	if n, err := strconv.Atoi(raw); err == nil {
		return n, nil
	}
	return raw, nil
}

func stripComment(line string) string {
	var quote rune
	for i, ch := range line {
		switch {
		case quote != 0:
			if ch == quote {
				quote = 0
			}
		case ch == '"' || ch == '\'':
			quote = ch
		case ch == '#':
			return line[:i]
		}
	}
	return line
}

// ---------------------------------------------------------------- 类型读取小工具

func mustMap(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return map[string]any{}
}

func mapMap(m map[string]any, key string) map[string]any {
	return mustMap(m, key)
}

func mustString(m map[string]any, key, fallback string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return fallback
}

func mapString(m map[string]any, key, fallback string) string {
	return mustString(m, key, fallback)
}

func mustBool(m map[string]any, key string, fallback bool) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return fallback
}

func mapBool(m map[string]any, key string, fallback bool) bool {
	return mustBool(m, key, fallback)
}

func mustInt(m map[string]any, key string, fallback int) int {
	return mapInt(m, key, fallback)
}

func mapInt(m map[string]any, key string, fallback int) int {
	switch v := m[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return fallback
}

func mapStrings(m map[string]any, key string) []string {
	raw, ok := m[key].([]any)
	if !ok {
		if values, ok := m[key].([]string); ok {
			return values
		}
		return []string{}
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func sliceContains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
