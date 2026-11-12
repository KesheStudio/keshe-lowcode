package config

import (
	"fmt"
	"strconv"
	"strings"
)

// buildConfigCenter 解析 configCenter.definitions / values：
// 覆盖链为 默认 < 生成 < 用户文件 < 环境变量 LC_CFG_<KEY> < --cfg KEY=VALUE。
// 只做类型转换、enum 校验与默认值填充，不做业务判断。
func buildConfigCenter(base, generated, user map[string]any, env map[string]string, cli map[string]string) (ConfigCenter, []string, error) {
	center := ConfigCenter{
		values:  map[string]any{},
		sources: map[string]string{},
	}
	var warnings []string

	centerRaw := mapMap(base, "configCenter")
	defsRaw, _ := centerRaw["definitions"].([]any)
	for index, item := range defsRaw {
		defMap, ok := item.(map[string]any)
		if !ok {
			return center, warnings, fmt.Errorf("configCenter.definitions[%d] 必须是对象（包含 key/type/secret）", index)
		}
		key := strings.TrimSpace(mapString(defMap, "key", ""))
		if key == "" {
			return center, warnings, fmt.Errorf("configCenter.definitions[%d] 缺少 key", index)
		}
		if _, dup := center.sources[key]; dup {
			return center, warnings, fmt.Errorf("configCenter.definitions 中 key 重复：%s", key)
		}
		defType := mapString(defMap, "type", "")
		if !sliceContains([]string{"string", "number", "bool", "enum"}, defType) {
			return center, warnings, fmt.Errorf("configCenter 项 %s 的 type=%q 不合法，只允许 string/number/bool/enum", key, defType)
		}
		secret, ok := defMap["secret"].(bool)
		if !ok {
			return center, warnings, fmt.Errorf("configCenter 项 %s 的 secret 必须是 true/false", key)
		}
		enum := mapStrings(defMap, "enum")
		if defType == "enum" && len(enum) == 0 {
			return center, warnings, fmt.Errorf("configCenter 项 %s 类型为 enum，必须提供非空 enum 列表", key)
		}
		def := ConfigDefinition{
			Key:         key,
			Type:        defType,
			Default:     defMap["default"],
			Enum:        enum,
			Secret:      secret,
			Description: mapString(defMap, "description", ""),
		}
		center.definitions = append(center.definitions, def)
		center.sources[key] = "" // 占位，稍后覆盖为真实来源
	}

	genValues := nestedMap(generated, "configCenter", "values")
	userValues := nestedMap(user, "configCenter", "values")

	defined := map[string]bool{}
	for _, def := range center.definitions {
		defined[def.Key] = true
	}
	for key := range genValues {
		if !defined[key] && !strings.HasPrefix(key, "middleware.builtin.") {
			return center, warnings, fmt.Errorf("configCenter.values 中的 %s 未在 configCenter.definitions 中声明", key)
		}
	}
	for key := range userValues {
		if !defined[key] && !strings.HasPrefix(key, "middleware.builtin.") {
			return center, warnings, fmt.Errorf("configCenter.values 中的 %s 未在 configCenter.definitions 中声明", key)
		}
	}
	for key := range cli {
		if !defined[key] && !isBuiltinCLIKey(key) {
			return center, warnings, fmt.Errorf("启动参数 --cfg 的 key %s 未在 configCenter.definitions 中声明", key)
		}
	}

	for _, def := range center.definitions {
		envName := cfgEnvName(def.Key)
		var raw any
		source := ""
		cliRaw, cliOK := cli[def.Key]
		switch {
		case cliOK:
			if def.Secret && strings.TrimSpace(cliRaw) == "" {
				break
			}
			raw = cliRaw
			source = "cli"
		case envHas(env, envName):
			value := env[envName]
			if def.Secret && strings.TrimSpace(value) == "" {
				break
			}
			raw = value
			source = "env"
		default:
			if def.Secret {
				for _, fileValues := range []map[string]any{userValues, genValues} {
					if value, ok := fileValues[def.Key]; ok && !emptyConfigValue(value) {
						warnings = append(warnings, fmt.Sprintf("configCenter.values.%s：已忽略配置文件中的密钥值（secret 只从环境变量 %s 或 --cfg 读取）", def.Key, envName))
					}
				}
			} else if value, ok := userValues[def.Key]; ok {
				raw = value
				source = "user"
			} else if value, ok := genValues[def.Key]; ok {
				raw = value
				source = "generated"
			} else {
				raw = def.Default
				source = "default"
			}
		}
		if source == "" {
			return center, warnings, fmt.Errorf("配置中心缺少 secret 项 %s（期望类型 %s）：请设置环境变量 %s 或启动参数 --cfg %s=...", def.Key, def.Type, envName, def.Key)
		}
		value, err := convertConfigValue(def, raw, source, envName)
		if err != nil {
			return center, warnings, err
		}
		center.values[def.Key] = value
		center.sources[def.Key] = source
	}
	return center, warnings, nil
}

func convertConfigValue(def ConfigDefinition, raw any, source, envName string) (any, error) {
	where := fmt.Sprintf("配置中心项 %s（来源=%s，期望类型=%s，环境变量=%s，启动参数 --cfg %s=...）", def.Key, source, def.Type, envName, def.Key)
	switch def.Type {
	case "string":
		switch value := raw.(type) {
		case nil:
			return "", nil
		case string:
			return value, nil
		case bool, int, int64, float64:
			return fmt.Sprint(value), nil
		default:
			return nil, fmt.Errorf("%s 的值类型不匹配", where)
		}
	case "number":
		switch value := raw.(type) {
		case nil:
			return 0, nil
		case int:
			return value, nil
		case int64:
			return int(value), nil
		case float64:
			return value, nil
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				return nil, fmt.Errorf("%s 的值不是合法数字", where)
			}
			return parsed, nil
		default:
			return nil, fmt.Errorf("%s 的值类型不匹配", where)
		}
	case "bool":
		switch value := raw.(type) {
		case nil:
			return false, nil
		case bool:
			return value, nil
		case string:
			parsed, err := parseBool(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("%s 的值不是合法布尔值（true/false）", where)
			}
			return parsed, nil
		default:
			return nil, fmt.Errorf("%s 的值类型不匹配", where)
		}
	case "enum":
		var text string
		switch value := raw.(type) {
		case nil:
			if len(def.Enum) > 0 {
				return def.Enum[0], nil
			}
			return nil, fmt.Errorf("%s 缺少默认值且 enum 为空", where)
		case string:
			text = value
		case bool, int, int64, float64:
			text = fmt.Sprint(value)
		default:
			return nil, fmt.Errorf("%s 的值类型不匹配", where)
		}
		for _, allowed := range def.Enum {
			if allowed == text {
				return text, nil
			}
		}
		if def.Secret {
			return nil, fmt.Errorf("%s 的值不在 enum 允许范围（%s）", where, strings.Join(def.Enum, "、"))
		}
		return nil, fmt.Errorf("%s 的值 %q 不在 enum 允许范围（%s）", where, text, strings.Join(def.Enum, "、"))
	}
	return nil, fmt.Errorf("%s 的类型 %s 不受支持", where, def.Type)
}

// cfgEnvName 把配置中心 key 转成 LC_CFG_<KEY>：大写，非字母数字转下划线。
func cfgEnvName(key string) string {
	var builder strings.Builder
	builder.WriteString("LC_CFG_")
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r - 32)
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			builder.WriteRune(r)
		default:
			builder.WriteByte('_')
		}
	}
	return builder.String()
}

func envHas(env map[string]string, key string) bool {
	_, ok := env[key]
	return ok
}

func nestedMap(root map[string]any, keys ...string) map[string]any {
	current := root
	for _, key := range keys {
		next, ok := current[key].(map[string]any)
		if !ok {
			return map[string]any{}
		}
		current = next
	}
	return current
}

func emptyConfigValue(value any) bool {
	if value == nil {
		return true
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) == ""
	}
	return false
}

func isBuiltinCLIKey(key string) bool {
	if strings.HasPrefix(key, "middleware.builtin.") {
		return true
	}
	// 兼容更短的写法：--cfg postgres.host=...
	for _, name := range builtinGroupNames {
		if strings.HasPrefix(key, name+".") {
			return true
		}
	}
	return false
}
