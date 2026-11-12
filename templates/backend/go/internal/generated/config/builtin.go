package config

import (
	"fmt"
	"strconv"
	"strings"
)

var builtinGroupNames = []string{
	"postgres", "mysql", "sqlite", "redis",
	"objectStorage", "messageQueue", "search", "reverseProxy",
}

type builtinField struct {
	Name   string
	Type   string
	Secret bool
	Env    string
}

var builtinFields = map[string][]builtinField{
	"postgres": {
		{Name: "host", Type: "string"},
		{Name: "port", Type: "number"},
		{Name: "database", Type: "string"},
		{Name: "user", Type: "string"},
		{Name: "password", Type: "string", Secret: true, Env: "LC_CFG_POSTGRES_PASSWORD"},
		{Name: "sslMode", Type: "string"},
		{Name: "maxOpenConns", Type: "number"},
		{Name: "connectTimeoutSeconds", Type: "number"},
	},
	"mysql": {
		{Name: "host", Type: "string"},
		{Name: "port", Type: "number"},
		{Name: "database", Type: "string"},
		{Name: "user", Type: "string"},
		{Name: "password", Type: "string", Secret: true, Env: "LC_CFG_MYSQL_PASSWORD"},
		{Name: "maxOpenConns", Type: "number"},
		{Name: "connectTimeoutSeconds", Type: "number"},
	},
	"sqlite": {
		{Name: "file", Type: "string"},
	},
	"redis": {
		{Name: "url", Type: "string"},
		{Name: "ttlSeconds", Type: "number"},
		{Name: "keyPrefix", Type: "string"},
		{Name: "password", Type: "string", Secret: true, Env: "LC_CFG_REDIS_PASSWORD"},
	},
	"objectStorage": {
		{Name: "driver", Type: "string"},
		{Name: "endpoint", Type: "string"},
		{Name: "bucket", Type: "string"},
		{Name: "region", Type: "string"},
		{Name: "accessKey", Type: "string", Secret: true, Env: "LC_CFG_OBJECT_STORAGE_ACCESS_KEY"},
		{Name: "secretKey", Type: "string", Secret: true, Env: "LC_CFG_OBJECT_STORAGE_SECRET_KEY"},
	},
	"messageQueue": {
		{Name: "driver", Type: "string"},
		{Name: "url", Type: "string"},
		{Name: "queue", Type: "string"},
	},
	"search": {
		{Name: "driver", Type: "string"},
		{Name: "url", Type: "string"},
		{Name: "index", Type: "string"},
	},
	"reverseProxy": {
		{Name: "upstream", Type: "string"},
		{Name: "clientMaxBodySize", Type: "string"},
	},
}

// BuiltinGroup 是一组内置中间件的运行时状态；关闭时 Config 为空。
type BuiltinGroup struct {
	Enabled bool
	Config  map[string]any
}

// BuiltinMiddleware 保存内置中间件各组的最终状态与字段来源。
type BuiltinMiddleware struct {
	groups       map[string]BuiltinGroup
	groupSources map[string]string
	fieldSources map[string]map[string]string
	// present 标记该组是否在任一配置层（生成/用户/环境变量/启动参数）显式出现。
	// 未出现的组保持顶层 database/cache 的兼容行为，不会被默认值强行接管。
	present map[string]bool
}

func (b *BuiltinMiddleware) Group(name string) (BuiltinGroup, bool) {
	group, ok := b.groups[name]
	return group, ok
}

func (b *BuiltinMiddleware) Names() []string {
	return append([]string(nil), builtinGroupNames...)
}

func (b *BuiltinMiddleware) GroupSource(name string) string {
	return b.groupSources[name]
}

// Present 表示该组在配置里显式出现（启用或关闭都算）；未出现的组按兼容模式处理。
func (b *BuiltinMiddleware) Present(name string) bool {
	return b.present[name]
}

func (b *BuiltinMiddleware) EnabledGroups() []string {
	out := []string{}
	for _, name := range builtinGroupNames {
		if group, ok := b.groups[name]; ok && group.Enabled {
			out = append(out, name)
		}
	}
	return out
}

// Snapshot 给 /api/meta：只含 group/field/source/secret/type，不含值。
// 关闭组不输出任何字段，避免残留配置键被误认为生效。
func (b *BuiltinMiddleware) Snapshot() []map[string]any {
	out := []map[string]any{}
	for _, name := range builtinGroupNames {
		group, ok := b.groups[name]
		if !ok || !group.Enabled {
			continue
		}
		for _, field := range builtinFields[name] {
			out = append(out, map[string]any{
				"group":  name,
				"field":  field.Name,
				"source": b.fieldSources[name][field.Name],
				"secret": field.Secret,
				"type":   field.Type,
			})
		}
	}
	return out
}

func builtinDefaultConfigs() map[string]map[string]any {
	return map[string]map[string]any{
		"postgres": {
			"host": "127.0.0.1", "port": 5432, "database": "app", "user": "lc",
			"password": "", "sslMode": "disable", "maxOpenConns": 10, "connectTimeoutSeconds": 5,
		},
		"mysql": {
			"host": "127.0.0.1", "port": 3306, "database": "app", "user": "lc",
			"password": "", "maxOpenConns": 10, "connectTimeoutSeconds": 5,
		},
		"sqlite": {
			"file": "data/app.db",
		},
		"redis": {
			"url": "redis://127.0.0.1:16379/0", "ttlSeconds": 30, "keyPrefix": "lc:", "password": "",
		},
		"objectStorage": {
			"driver": "s3", "endpoint": "", "bucket": "", "region": "", "accessKey": "", "secretKey": "",
		},
		"messageQueue": {
			"driver": "redis", "url": "", "queue": "lc",
		},
		"search": {
			"driver": "opensearch", "url": "", "index": "lc",
		},
		"reverseProxy": {
			"upstream": "http://127.0.0.1:8080", "clientMaxBodySize": "1m",
		},
	}
}

func builtinDefaultsMap() map[string]any {
	out := map[string]any{}
	for name, fields := range builtinDefaultConfigs() {
		out[name] = map[string]any{
			"enabled": false,
			"config":  cloneMap(fields),
		}
	}
	return out
}

func buildBuiltin(base, generated, user map[string]any, env, cli map[string]string, center *ConfigCenter) (BuiltinMiddleware, []string, error) {
	result := BuiltinMiddleware{
		groups:       map[string]BuiltinGroup{},
		groupSources: map[string]string{},
		fieldSources: map[string]map[string]string{},
		present:      map[string]bool{},
	}
	var warnings []string
	defaults := builtinDefaultConfigs()
	genGroups := nestedMap(generated, "middleware", "builtin")
	userGroups := nestedMap(user, "middleware", "builtin")

	dbEnabled := []string{}
	for _, name := range builtinGroupNames {
		result.fieldSources[name] = map[string]string{}
		result.present[name] = builtinPresent(name, genGroups, userGroups, env, cli)
		enabled, enabledSource, err := builtinEnabled(name, genGroups, userGroups, env, cli)
		if err != nil {
			return result, warnings, err
		}
		result.groupSources[name] = enabledSource
		group := BuiltinGroup{Enabled: enabled, Config: map[string]any{}}
		result.groups[name] = group
		if !enabled {
			// 关闭组不保留任何配置键，也不会参与任何连接。
			continue
		}
		if name == "postgres" || name == "mysql" || name == "sqlite" {
			dbEnabled = append(dbEnabled, name)
		}
		for _, field := range builtinFields[name] {
			value, source, err := builtinFieldValue(name, field, defaults[name], genGroups, userGroups, env, cli, &warnings)
			if err != nil {
				return result, warnings, err
			}
			result.fieldSources[name][field.Name] = source
			group.Config[field.Name] = value
			result.groupSources[name] = maxSource(result.groupSources[name], source)
		}
		result.groups[name] = group
		if name == "objectStorage" || name == "messageQueue" || name == "search" || name == "reverseProxy" {
			for _, field := range builtinFields[name] {
				def := ConfigDefinition{
					Key: name + "." + field.Name, Type: field.Type, Secret: field.Secret,
					Enum:        []string{},
					Description: fmt.Sprintf("内置中间件 %s.%s（配置已注入，连接由用户代码负责）", name, field.Name),
				}
				if err := center.inject(def, group.Config[field.Name], result.fieldSources[name][field.Name]); err != nil {
					return result, warnings, err
				}
			}
		}
	}
	if len(dbEnabled) > 1 {
		return result, warnings, fmt.Errorf("内置数据库中间件只能启用一个，当前启用了：%s", strings.Join(dbEnabled, "、"))
	}
	if len(dbEnabled) == 0 {
		warnings = append(warnings, "未启用内置数据库中间件，使用顶层 database（兼容模式）")
	}
	return result, warnings, nil
}

func builtinEnabled(name string, generated, user map[string]any, env, cli map[string]string) (bool, string, error) {
	cliKey := "middleware.builtin." + name + ".enabled"
	value, ok := cli[cliKey]
	if !ok {
		// 兼容更短的写法：--cfg postgres.enabled=true
		if alt, altOK := cli[name+".enabled"]; altOK {
			cliKey, value, ok = name+".enabled", alt, true
		}
	}
	if ok {
		parsed, err := parseBool(strings.TrimSpace(value))
		if err != nil {
			return false, "", fmt.Errorf("内置中间件 %s.enabled 的值不是合法布尔值（--cfg %s=true/false）", name, cliKey)
		}
		return parsed, "cli", nil
	}
	envKey := builtinEnvName(name, "enabled")
	if value, ok := env[envKey]; ok {
		parsed, err := parseBool(strings.TrimSpace(value))
		if err != nil {
			return false, "", fmt.Errorf("内置中间件 %s.enabled 的环境变量 %s 不是合法布尔值（true/false）", name, envKey)
		}
		return parsed, "env", nil
	}
	for _, entry := range []struct {
		source string
		groups map[string]any
	}{{"user", user}, {"generated", generated}} {
		group, ok := entry.groups[name].(map[string]any)
		if !ok {
			continue
		}
		if raw, ok := group["enabled"]; ok {
			parsed, err := parseBool(strings.TrimSpace(fmt.Sprint(raw)))
			if err != nil {
				return false, "", fmt.Errorf("内置中间件 %s.enabled 必须是 true/false（来源=%s）", name, entry.source)
			}
			return parsed, entry.source, nil
		}
	}
	return false, "default", nil
}

// builtinPresent 判断某组是否在任一配置层出现：
// 生成/用户文件里有该组键，或环境变量/启动参数设置了该组的 enabled/字段。
func builtinPresent(name string, generated, user map[string]any, env, cli map[string]string) bool {
	if _, ok := user[name]; ok {
		return true
	}
	if _, ok := generated[name]; ok {
		return true
	}
	envPrefix := "LC_CFG_" + snakeUpper(name) + "_"
	for key := range env {
		if strings.HasPrefix(key, envPrefix) {
			return true
		}
	}
	for key := range cli {
		if strings.HasPrefix(key, "middleware.builtin."+name+".") || strings.HasPrefix(key, name+".") {
			return true
		}
	}
	return false
}

func builtinFieldValue(name string, field builtinField, defaults map[string]any, generated, user map[string]any, env, cli map[string]string, warnings *[]string) (any, string, error) {
	cliKey := "middleware.builtin." + name + "." + field.Name
	cliRaw, cliOK := cli[cliKey]
	if !cliOK {
		// 兼容更短的写法：--cfg postgres.host=...
		if alt, altOK := cli[name+"."+field.Name]; altOK {
			cliKey, cliRaw, cliOK = name+"."+field.Name, alt, true
		}
	}
	envKey := builtinEnvName(name, field.Name)
	makeMissing := func() error {
		return fmt.Errorf("内置中间件 %s 已启用但缺少密钥 %s：请设置环境变量 %s 或启动参数 --cfg %s=...", name, field.Name, envKey, cliKey)
	}
	if cliOK {
		raw := cliRaw
		if field.Secret && strings.TrimSpace(raw) == "" {
			return nil, "", makeMissing()
		}
		value, err := convertBuiltinValue(name, field, raw, "cli")
		return value, "cli", err
	}
	if raw, ok := env[envKey]; ok {
		if field.Secret && strings.TrimSpace(raw) == "" {
			return nil, "", makeMissing()
		}
		value, err := convertBuiltinValue(name, field, raw, "env")
		return value, "env", err
	}
	for _, entry := range []struct {
		source string
		groups map[string]any
	}{{"user", user}, {"generated", generated}} {
		group, ok := entry.groups[name].(map[string]any)
		if !ok {
			continue
		}
		configMap, ok := group["config"].(map[string]any)
		if !ok {
			continue
		}
		raw, ok := configMap[field.Name]
		if !ok {
			continue
		}
		if field.Secret {
			if !emptyConfigValue(raw) {
				*warnings = append(*warnings, fmt.Sprintf("内置中间件 %s.%s：已忽略配置文件中的密钥值（只从环境变量 %s 或 --cfg %s 读取）", name, field.Name, envKey, cliKey))
			}
			continue
		}
		value, err := convertBuiltinValue(name, field, raw, entry.source)
		return value, entry.source, err
	}
	if field.Secret {
		return nil, "", makeMissing()
	}
	return defaults[field.Name], "default", nil
}

func convertBuiltinValue(name string, field builtinField, raw any, source string) (any, error) {
	where := fmt.Sprintf("内置中间件 %s.%s（来源=%s，期望类型=%s）", name, field.Name, source, field.Type)
	switch field.Type {
	case "string":
		switch value := raw.(type) {
		case nil:
			return "", nil
		case string:
			return value, nil
		case bool, int, int64, float64:
			return fmt.Sprint(value), nil
		}
	case "number":
		switch value := raw.(type) {
		case int:
			return value, nil
		case int64:
			return int(value), nil
		case float64:
			return value, nil
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("%s 的值 %q 不是整数", where, value)
			}
			return parsed, nil
		case nil:
			return 0, nil
		}
	}
	return nil, fmt.Errorf("%s 的值类型不匹配", where)
}

// builtinEnvName 生成内置字段环境变量：LC_CFG_<GROUP>_<FIELD>，驼峰转 snake 大写。
func builtinEnvName(group, field string) string {
	return "LC_CFG_" + snakeUpper(group) + "_" + snakeUpper(field)
}

func snakeUpper(value string) string {
	var builder strings.Builder
	previousLower := false
	for index, r := range value {
		switch {
		case r >= 'A' && r <= 'Z':
			if index > 0 && previousLower {
				builder.WriteByte('_')
			}
			builder.WriteRune(r)
			previousLower = false
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r - 32)
			previousLower = true
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			previousLower = false
		default:
			builder.WriteByte('_')
			previousLower = false
		}
	}
	return builder.String()
}

func maxSource(a, b string) string {
	rank := func(source string) int {
		switch source {
		case "cli":
			return 4
		case "env":
			return 3
		case "user":
			return 2
		case "generated":
			return 1
		default:
			return 0
		}
	}
	if rank(b) > rank(a) {
		return b
	}
	return a
}

func (c *ConfigCenter) inject(def ConfigDefinition, value any, source string) error {
	for _, existing := range c.definitions {
		if existing.Key == def.Key {
			return fmt.Errorf("内置中间件注入的配置 key %s 与 configCenter.definitions 冲突", def.Key)
		}
	}
	def.Builtin = true
	c.definitions = append(c.definitions, def)
	c.values[def.Key] = value
	c.sources[def.Key] = source
	return nil
}

// applyBuiltin 把启用的内置数据库映射到现有数据库层；关闭组不产生任何连接参数。
func applyBuiltin(cfg *Config, b BuiltinMiddleware) error {
	enabledDB := []string{}
	for _, name := range []string{"postgres", "mysql", "sqlite"} {
		group, ok := b.Group(name)
		if ok && group.Enabled {
			enabledDB = append(enabledDB, name)
		}
	}
	if len(enabledDB) > 1 {
		return fmt.Errorf("内置数据库中间件只能启用一个，当前启用了：%s", strings.Join(enabledDB, "、"))
	}
	if len(enabledDB) == 0 {
		return nil
	}
	switch enabledDB[0] {
	case "postgres":
		group, _ := b.Group("postgres")
		cfg.Database.Driver = "postgres"
		cfg.Database.URL = ""
		cfg.Database.Host = builtinString(group, "host")
		cfg.Database.Port = builtinInt(group, "port")
		cfg.Database.Name = builtinString(group, "database")
		cfg.Database.User = builtinString(group, "user")
		cfg.Database.Password = builtinString(group, "password")
		cfg.Database.SSLMode = builtinString(group, "sslMode")
		cfg.Database.MaxOpenConns = builtinInt(group, "maxOpenConns")
		cfg.Database.ConnectTimeoutSeconds = builtinInt(group, "connectTimeoutSeconds")
	case "mysql":
		group, _ := b.Group("mysql")
		cfg.Database.Driver = "mysql"
		cfg.Database.URL = ""
		cfg.Database.Host = builtinString(group, "host")
		cfg.Database.Port = builtinInt(group, "port")
		cfg.Database.Name = builtinString(group, "database")
		cfg.Database.User = builtinString(group, "user")
		cfg.Database.Password = builtinString(group, "password")
		cfg.Database.SSLMode = ""
		cfg.Database.MaxOpenConns = builtinInt(group, "maxOpenConns")
		cfg.Database.ConnectTimeoutSeconds = builtinInt(group, "connectTimeoutSeconds")
	case "sqlite":
		group, _ := b.Group("sqlite")
		file := builtinString(group, "file")
		if strings.TrimSpace(file) == "" {
			return fmt.Errorf("内置中间件 sqlite 已启用，但 file 为空（environment=无，配置键 middleware.builtin.sqlite.config.file）")
		}
		cfg.Database.Driver = "sqlite"
		cfg.Database.URL = "sqlite://" + file
		cfg.Database.Host = ""
		cfg.Database.Port = 0
		cfg.Database.Name = ""
		cfg.Database.User = ""
		cfg.Database.Password = ""
	}
	return nil
}

// applyBuiltinCache：redis 组启用即强制走 redis；redis 组关闭则关闭缓存并按 fallback 回退。
func applyBuiltinCache(cfg *Config, b BuiltinMiddleware) {
	group, ok := b.Group("redis")
	if !ok || !b.Present("redis") {
		// 没有显式配置 redis 组时，保持顶层 cache.driver（memory 等）的兼容行为。
		return
	}
	if !group.Enabled {
		cfg.Cache.Enabled = false
		cfg.Cache.Password = ""
		return
	}
	cfg.Cache.Enabled = true
	cfg.Cache.Driver = "redis"
	cfg.Cache.URL = builtinString(group, "url")
	if ttl := builtinInt(group, "ttlSeconds"); ttl > 0 {
		cfg.Cache.TTLSeconds = ttl
	}
	if prefix := builtinString(group, "keyPrefix"); prefix != "" {
		cfg.Cache.KeyPrefix = prefix
	}
	cfg.Cache.Password = builtinString(group, "password")
}

func builtinString(group BuiltinGroup, field string) string {
	value, _ := group.Config[field].(string)
	return value
}

func builtinInt(group BuiltinGroup, field string) int {
	switch value := group.Config[field].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}
