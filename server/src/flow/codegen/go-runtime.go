// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 流程运行时：解释 IR 指令，提供表达式求值、集合/文件/HTTP 调用与 CORS/鉴权/限流/日志。
// 积木是否支持 Go 由 IR 构建阶段按能力矩阵判定，这里只执行已经声明支持 Go 的节点。
package flows

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/auth"
)

const maxFileBytes = 1024 * 1024

type flowResponse struct {
	status  int
	headers map[string]string
	body    any
}

type flowError struct {
	status  int
	code    string
	message string
	field   string
}

func (err *flowError) Error() string { return err.message }

type flowCtx struct {
	ctx        context.Context
	request    *http.Request
	requestMap map[string]any
	vars       map[string]any
}

type rateBucket struct {
	tokens float64
	last   time.Time
}

var (
	rateMu      sync.Mutex
	rateBuckets = map[string]*rateBucket{}
)

// Execute 执行一棵流程树的 IR，并把结果写回 HTTP 响应。
func Execute(w http.ResponseWriter, r *http.Request, deps *app.Deps, irJSON string) {
	started := time.Now()
	var ir map[string]any
	if err := json.Unmarshal([]byte(irJSON), &ir); err != nil {
		writeFlowResponse(w, &flowResponse{status: http.StatusInternalServerError, body: errorPayload("LC_E_FLOW_IR", "流程 IR 解析失败："+err.Error(), "")})
		return
	}
	middleware, _ := ir["middleware"].([]any)
	cors := findMiddleware(middleware, "middleware.cors")
	corsHeaders := map[string]string{}
	if cors != nil {
		corsHeaders = corsHeadersOf(cors, r.Header)
	}
	if r.Method == http.MethodOptions && cors != nil {
		for key, value := range corsHeaders {
			w.Header().Set(key, value)
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	response, failure := runFlow(r.Context(), deps, ir, r, middleware, started)
	if failure != nil {
		response = &flowResponse{
			status: failure.status,
			body:   errorPayload(failure.code, failure.message, failure.field),
		}
	}
	if response.headers == nil {
		response.headers = map[string]string{}
	}
	for key, value := range corsHeaders {
		response.headers[key] = value
	}
	writeFlowResponse(w, response)
}

func runFlow(ctx context.Context, deps *app.Deps, ir map[string]any, r *http.Request, middleware []any, started time.Time) (*flowResponse, *flowError) {
	body, _ := readBody(r)
	flow := &flowCtx{
		ctx:        ctx,
		request:    r,
		requestMap: buildRequestMap(r, body),
		vars:       map[string]any{},
	}

	if entry, ok := ir["entry"].(map[string]any); ok {
		if failure := validateEntry(entry, flow); failure != nil {
			return nil, failure
		}
	}

	if item := findMiddleware(middleware, "middleware.auth"); item != nil {
		params, _ := item["params"].(map[string]any)
		roles := splitRoles(strOption(params["roles"], ""))
		identity, err := deps.Auth.Authenticate(ctx, r)
		if err != nil {
			var authErr *auth.Error
			if errors.As(err, &authErr) {
				return nil, &flowError{status: authErr.Status, code: authErr.Code, message: authErr.Message, field: authErr.Field}
			}
			return nil, &flowError{status: http.StatusUnauthorized, code: "LC_E_UNAUTHORIZED", message: "未认证或令牌已失效"}
		}
		if len(roles) > 0 && !hasAnyRole(identity.Roles, roles) {
			return nil, &flowError{status: http.StatusForbidden, code: "LC_E_FORBIDDEN", message: "当前账号没有访问该接口的角色"}
		}
	}

	if item := findMiddleware(middleware, "middleware.rateLimit"); item != nil {
		params, _ := item["params"].(map[string]any)
		rps := floatOption(params["rps"], 20)
		burst := floatOption(params["burst"], 40)
		key := rateKey(strOption(params["keyBy"], "ip"), r.Header)
		if !takeToken(key, rps, burst) {
			return nil, &flowError{status: http.StatusTooManyRequests, code: "LC_E_RATE_LIMITED", message: "请求过于频繁，请稍后再试"}
		}
	}

	list, _ := ir["body"].([]any)
	response, failure := runInstructions(deps, list, flow)
	if failure != nil {
		return nil, failure
	}
	if response == nil {
		return nil, &flowError{status: http.StatusInternalServerError, code: "LC_E_FLOW_NO_RESPONSE", message: "流程没有返回响应"}
	}

	if item := findMiddleware(middleware, "middleware.log"); item != nil {
		params, _ := item["params"].(map[string]any)
		skipHealth := boolOption(params["skipHealth"], true)
		path, _ := flow.requestMap["path"].(string)
		if !(skipHealth && strings.HasPrefix(path, "/api/health")) {
			slog.Info("flow request",
				"method", r.Method,
				"path", path,
				"status", response.status,
				"elapsedMs", time.Since(started).Milliseconds(),
			)
		}
	}

	return response, nil
}

func findMiddleware(list []any, op string) map[string]any {
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strOption(entry["op"], "") == op {
			return entry
		}
	}
	return nil
}

func runInstructions(deps *app.Deps, list []any, flow *flowCtx) (*flowResponse, *flowError) {
	for _, raw := range list {
		ins, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		response, failure := runInstruction(deps, ins, flow)
		if failure != nil {
			return nil, failure
		}
		if response != nil {
			return response, nil
		}
	}
	return nil, nil
}

func runInstruction(deps *app.Deps, ins map[string]any, flow *flowCtx) (*flowResponse, *flowError) {
	switch strOption(ins["kind"], "") {
	case "op":
		return nil, runOp(deps, ins, flow)
	case "branch":
		condition := evalValue(ins["cond"], flow)
		var branch any
		if truthy(condition) {
			branch = ins["then"]
		} else {
			branch = ins["else"]
		}
		list, _ := branch.([]any)
		return runInstructions(deps, list, flow)
	case "loop":
		args, _ := ins["args"].(map[string]any)
		source := toAnySlice(evalValue(args["source"], flow))
		limit := intOption(args["limit"], 100)
		itemVar := strOption(args["itemVar"], "item")
		body, _ := ins["body"].([]any)
		collected := []any{}
		for index, item := range source {
			if index >= limit {
				break
			}
			flow.vars[itemVar] = item
			flow.vars["itemIndex"] = float64(index)
			response, failure := runInstructions(deps, body, flow)
			if failure != nil {
				return nil, failure
			}
			if response != nil {
				return response, nil
			}
			collected = append(collected, evalValue(args["collect"], flow))
		}
		if out := strOption(ins["out"], ""); out != "" {
			flow.vars[out] = collected
		}
		return nil, nil
	case "return":
		args, _ := ins["args"].(map[string]any)
		status := intOption(args["status"], 200)
		headers := evalValue(args["headers"], flow)
		return &flowResponse{
			status:  status,
			headers: headerMap(headers),
			body:    evalValue(args["body"], flow),
		}, nil
	default:
		return nil, &flowError{status: http.StatusInternalServerError, code: "LC_E_FLOW_IR", message: "未知流程指令"}
	}
}

func runOp(deps *app.Deps, ins map[string]any, flow *flowCtx) *flowError {
	op := strOption(ins["op"], "")
	out := strOption(ins["out"], "")
	args, _ := ins["args"].(map[string]any)

	switch op {
	case "db.read":
		collection := strOption(args["collection"], "")
		page := toInt(evalValue(args["page"], flow), 1, 1, 1000000)
		pageSize := toInt(evalValue(args["pageSize"], flow), 20, 1, 1000000)
		params := map[string]string{"page": strconv.Itoa(page), "pageSize": strconv.Itoa(pageSize)}
		if q := optionalText(evalValue(args["q"], flow)); q != "" {
			params["q"] = q
		}
		if filter := evalValue(args["filter"], flow); filter != nil {
			if object, ok := filter.(map[string]any); ok && len(object) > 0 {
				encoded, err := json.Marshal(object)
				if err != nil {
					return &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "过滤条件不是合法对象", field: "filter"}
				}
				params["filter"] = string(encoded)
			}
		}
		if sort := strings.TrimSpace(strOption(args["sort"], "")); sort != "" {
			params["sort"] = sort
		}
		if fields := strings.TrimSpace(strOption(args["fields"], "")); fields != "" {
			params["fields"] = fields
		}
		value, derr := deps.Data.List(flow.ctx, collection, withQuery(flow.request, params))
		if derr != nil {
			return &flowError{status: derr.Status, code: derr.Code, message: derr.Message, field: derr.Field}
		}
		flow.vars[out] = value
	case "db.insert":
		collection := strOption(args["collection"], "")
		body := evalValue(args["body"], flow)
		object, ok := body.(map[string]any)
		if !ok {
			return &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "写入内容必须是对象", field: "body"}
		}
		value, derr := deps.Data.Create(flow.ctx, collection, object, flow.request)
		if derr != nil {
			return &flowError{status: derr.Status, code: derr.Code, message: derr.Message, field: derr.Field}
		}
		flow.vars[out] = value
	case "file.read":
		encoding := strOption(args["encoding"], "utf8")
		target, failure := safeFilePath(strOption(args["path"], ""))
		if failure != nil {
			return failure
		}
		bytes, err := os.ReadFile(target)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return &flowError{status: http.StatusNotFound, code: "LC_E_NOT_FOUND", message: "文件不存在"}
			}
			return &flowError{status: http.StatusInternalServerError, code: "LC_E_INTERNAL", message: "读取文件失败"}
		}
		if len(bytes) > maxFileBytes {
			return &flowError{status: http.StatusRequestEntityTooLarge, code: "LC_E_PAYLOAD_TOO_LARGE", message: "文件超过 1 MB"}
		}
		if encoding == "base64" {
			flow.vars[out] = base64.StdEncoding.EncodeToString(bytes)
		} else {
			flow.vars[out] = string(bytes)
		}
	case "file.write":
		target, failure := safeFilePath(strOption(args["path"], ""))
		if failure != nil {
			return failure
		}
		content := evalValue(args["content"], flow)
		text := ""
		if value, ok := content.(string); ok {
			text = value
		} else {
			encoded, err := json.MarshalIndent(content, "", "  ")
			if err != nil {
				return &flowError{status: http.StatusInternalServerError, code: "LC_E_INTERNAL", message: "写入内容无法序列化"}
			}
			text = string(encoded)
		}
		if len([]byte(text)) > maxFileBytes {
			return &flowError{status: http.StatusRequestEntityTooLarge, code: "LC_E_PAYLOAD_TOO_LARGE", message: "写入内容超过 1 MB"}
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return &flowError{status: http.StatusInternalServerError, code: "LC_E_INTERNAL", message: "创建目录失败"}
		}
		flags := os.O_CREATE | os.O_WRONLY
		if boolOption(args["append"], false) {
			flags |= os.O_APPEND
		} else {
			flags |= os.O_TRUNC
		}
		file, err := os.OpenFile(target, flags, 0o644)
		if err != nil {
			return &flowError{status: http.StatusInternalServerError, code: "LC_E_INTERNAL", message: "打开文件失败"}
		}
		_, writeErr := file.WriteString(text)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			return &flowError{status: http.StatusInternalServerError, code: "LC_E_INTERNAL", message: "写入文件失败"}
		}
	case "http.request":
		value, failure := requestJSON(flow.ctx, strOption(args["url"], ""), args)
		if failure != nil {
			return failure
		}
		flow.vars[out] = value
	case "data.pick":
		input := evalValue(args["input"], flow)
		fields := stringList(args["fields"])
		flow.vars[out] = pickFields(input, fields)
	case "data.template":
		flow.vars[out] = evalValue(args["template"], flow)
	case "code.run", "component.run":
		return &flowError{status: http.StatusInternalServerError, code: "LC_E_FLOW_IR", message: op + " 不支持 Go 目标，请改用通用积木"}
	default:
		return &flowError{status: http.StatusInternalServerError, code: "LC_E_FLOW_IR", message: "未知流程操作：" + op}
	}
	return nil
}

/* ------------------------------------------------------------------ 参数校验 */

func validateEntry(entry map[string]any, flow *flowCtx) *flowError {
	rules, _ := entry["params"].([]any)
	for _, raw := range rules {
		rule, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := strOption(rule["name"], "")
		if name == "" {
			continue
		}
		location := strOption(rule["in"], "query")
		kind := strOption(rule["type"], "string")
		required := boolOption(rule["required"], false)
		value := paramValue(flow, location, name)
		present := value != nil && value != ""
		if !present {
			if required {
				return &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "缺少必填参数 " + name, field: name}
			}
			continue
		}
		valid := true
		switch kind {
		case "number":
			_, number := value.(float64)
			_, text := value.(string)
			valid = number || text && isNumber(value)
		case "boolean":
			_, boolean := value.(bool)
			valid = boolean || value == "true" || value == "false" || value == "1" || value == "0"
		}
		if !valid {
			return &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: fmt.Sprintf("参数 %s 类型应为 %s", name, kind), field: name}
		}
	}
	return nil
}

func paramValue(flow *flowCtx, location, name string) any {
	switch location {
	case "header":
		return flow.requestMap["headers"].(map[string]any)[strings.ToLower(name)]
	case "body":
		if body, ok := flow.requestMap["body"].(map[string]any); ok {
			return body[name]
		}
		return nil
	case "params":
		return flow.requestMap["params"].(map[string]any)[name]
	default:
		return flow.requestMap["query"].(map[string]any)[name]
	}
}

func isNumber(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	_, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	return err == nil
}

/* ------------------------------------------------------------------ 值 / 表达式 */

func buildRequestMap(r *http.Request, body any) map[string]any {
	query := map[string]any{}
	for key, values := range r.URL.Query() {
		if len(values) > 0 {
			query[key] = values[len(values)-1]
		}
	}
	headers := map[string]any{}
	for key, values := range r.Header {
		if len(values) > 0 {
			headers[strings.ToLower(key)] = values[len(values)-1]
		}
	}
	return map[string]any{
		"method":  r.Method,
		"path":    r.URL.Path,
		"url":     r.URL.RequestURI(),
		"query":   query,
		"params":  map[string]any{},
		"headers": headers,
		"body":    body,
	}
}

func readBody(r *http.Request) (any, error) {
	if r.Body == nil {
		return nil, nil
	}
	payload, err := io.ReadAll(io.LimitReader(r.Body, maxFileBytes+1))
	if err != nil || len(payload) == 0 {
		return nil, err
	}
	var body any
	if json.Unmarshal(payload, &body) != nil {
		return nil, nil
	}
	return body, nil
}

func evalValue(value any, flow *flowCtx) any {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	switch strOption(raw["kind"], "undefined") {
	case "undefined":
		return nil
	case "literal":
		return raw["value"]
	case "expr":
		ast, _ := raw["ast"].(map[string]any)
		return evalAST(ast, flow)
	case "template":
		parts, _ := raw["parts"].([]any)
		if len(parts) == 0 {
			return ""
		}
		if len(parts) == 1 {
			if _, isText := parts[0].(string); !isText {
				return evalValue(parts[0], flow)
			}
		}
		var builder strings.Builder
		for _, part := range parts {
			if text, isText := part.(string); isText {
				builder.WriteString(text)
			} else {
				builder.WriteString(toText(evalValue(part, flow)))
			}
		}
		return builder.String()
	case "array":
		items, _ := raw["items"].([]any)
		out := make([]any, 0, len(items))
		for _, item := range items {
			out = append(out, evalValue(item, flow))
		}
		return out
	case "object":
		entries, _ := raw["entries"].([]any)
		out := map[string]any{}
		for _, raw := range entries {
			entry, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			out[strOption(entry["key"], "")] = evalValue(entry["value"], flow)
		}
		return out
	default:
		return nil
	}
}

func evalAST(ast map[string]any, flow *flowCtx) any {
	if ast == nil {
		return nil
	}
	switch strOption(ast["kind"], "undefined") {
	case "number":
		switch value := ast["value"].(type) {
		case float64:
			return value
		case string:
			if number, err := strconv.ParseFloat(value, 64); err == nil {
				return number
			}
		}
		return nil
	case "string":
		return unquote(strOption(ast["value"], ""))
	case "boolean":
		return boolOption(ast["value"], false)
	case "null", "undefined":
		return nil
	case "ref":
		root := strOption(ast["root"], "")
		if root == "request" {
			return flow.requestMap
		}
		return flow.vars[root]
	case "member":
		object, _ := ast["object"].(map[string]any)
		return member(evalAST(object, flow), strOption(ast["property"], ""))
	case "index":
		object, _ := ast["object"].(map[string]any)
		index, _ := ast["index"].(map[string]any)
		return indexValue(evalAST(object, flow), evalAST(index, flow))
	case "unary":
		operand := evalAST(mustMap(ast["operand"]), flow)
		switch strOption(ast["op"], "") {
		case "!":
			return !truthy(operand)
		case "-":
			return -toNumber(operand)
		}
		return nil
	case "binary":
		return evalBinary(ast, flow)
	case "ternary":
		if truthy(evalAST(mustMap(ast["test"]), flow)) {
			return evalAST(mustMap(ast["consequent"]), flow)
		}
		return evalAST(mustMap(ast["alternate"]), flow)
	default:
		return nil
	}
}

func evalBinary(ast map[string]any, flow *flowCtx) any {
	op := strOption(ast["op"], "")
	leftNode := mustMap(ast["left"])
	rightNode := mustMap(ast["right"])
	if op == "&&" {
		left := evalAST(leftNode, flow)
		if truthy(left) {
			return evalAST(rightNode, flow)
		}
		return left
	}
	if op == "||" {
		left := evalAST(leftNode, flow)
		if truthy(left) {
			return left
		}
		return evalAST(rightNode, flow)
	}
	left := evalAST(leftNode, flow)
	right := evalAST(rightNode, flow)
	switch op {
	case "+":
		if _, ok := left.(string); ok {
			return toText(left) + toText(right)
		}
		if _, ok := right.(string); ok {
			return toText(left) + toText(right)
		}
		return toNumber(left) + toNumber(right)
	case "-":
		return toNumber(left) - toNumber(right)
	case "*":
		return toNumber(left) * toNumber(right)
	case "/":
		if toNumber(right) == 0 {
			return nil
		}
		return toNumber(left) / toNumber(right)
	case "%":
		if toNumber(right) == 0 {
			return nil
		}
		return float64(int64(toNumber(left)) % int64(toNumber(right)))
	case "===":
		return strictEqual(left, right)
	case "!==":
		return !strictEqual(left, right)
	case "==":
		return looseEqual(left, right)
	case "!=":
		return !looseEqual(left, right)
	case "<":
		return compareValues(left, right) < 0
	case ">":
		return compareValues(left, right) > 0
	case "<=":
		return compareValues(left, right) <= 0
	case ">=":
		return compareValues(left, right) >= 0
	default:
		return nil
	}
}

func mustMap(value any) map[string]any {
	raw, _ := value.(map[string]any)
	return raw
}

func member(object any, name string) any {
	if raw, ok := object.(map[string]any); ok {
		return raw[name]
	}
	return nil
}

func indexValue(object, index any) any {
	switch target := object.(type) {
	case map[string]any:
		return target[toText(index)]
	}
	if list := toAnySlice(object); list != nil {
		position := int(toNumber(index))
		if position >= 0 && position < len(list) {
			return list[position]
		}
	}
	return nil
}

func toAnySlice(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	reflected := reflect.ValueOf(value)
	if !reflected.IsValid() || reflected.Kind() != reflect.Slice {
		return nil
	}
	out := make([]any, reflected.Len())
	for index := range out {
		out[index] = reflected.Index(index).Interface()
	}
	return out
}

func pickFields(input any, fields []string) any {
	if list := toAnySlice(input); list != nil {
		out := make([]any, 0, len(list))
		for _, item := range list {
			out = append(out, pickObject(item, fields))
		}
		return out
	}
	return pickObject(input, fields)
}

func pickObject(input any, fields []string) any {
	source, ok := input.(map[string]any)
	if !ok {
		return input
	}
	out := map[string]any{}
	for _, field := range fields {
		if value, ok := source[field]; ok {
			out[field] = value
		}
	}
	return out
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case float64:
		return typed != 0
	case string:
		return typed != ""
	default:
		return true
	}
}

func toNumber(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0
		}
		if number, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return number
		}
		return 0
	case bool:
		if typed {
			return 1
		}
		return 0
	case nil:
		return 0
	}
	// 数据服务可能返回 int/int64 等原生数字，统一按 float64 参与表达式运算。
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return float64(reflected.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return float64(reflected.Uint())
	case reflect.Float32, reflect.Float64:
		return reflected.Float()
	}
	return 0
}

func toText(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}

func toInt(value any, fallback, min, max int) int {
	number := float64(fallback)
	switch typed := value.(type) {
	case nil:
		// 缺失引用等价于 JS 的 undefined，用默认值而不是 0。
	case string:
		if strings.TrimSpace(typed) != "" {
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
				number = parsed
			}
		}
	default:
		number = toNumber(value)
		if number != number {
			number = float64(fallback)
		}
	}
	result := int(number)
	if result < min {
		return min
	}
	if result > max {
		return max
	}
	return result
}

func optionalText(value any) string {
	return strings.TrimSpace(toText(value))
}

func strictEqual(left, right any) bool {
	switch typed := left.(type) {
	case nil:
		return right == nil
	case bool:
		other, ok := right.(bool)
		return ok && typed == other
	case float64:
		other, ok := right.(float64)
		return ok && typed == other
	case string:
		other, ok := right.(string)
		return ok && typed == other
	}
	return false
}

func looseEqual(left, right any) bool {
	if strictEqual(left, right) {
		return true
	}
	switch left.(type) {
	case string, bool, float64:
		switch right.(type) {
		case string, bool, float64:
			return toNumber(left) == toNumber(right)
		}
	}
	return false
}

func compareValues(left, right any) int {
	if a, ok := left.(string); ok {
		if b, ok := right.(string); ok {
			return strings.Compare(a, b)
		}
	}
	a := toNumber(left)
	b := toNumber(right)
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

func unquote(raw string) string {
	if strings.HasPrefix(raw, "\"") {
		if value, err := strconv.Unquote(raw); err == nil {
			return value
		}
	}
	if len(raw) >= 2 && strings.HasPrefix(raw, "'") && strings.HasSuffix(raw, "'") {
		inner := raw[1 : len(raw)-1]
		inner = strings.ReplaceAll(inner, `\'`, "'")
		return strings.ReplaceAll(inner, `\\`, `\`)
	}
	return raw
}

/* ------------------------------------------------------------------ 中间件 */

func corsHeadersOf(item map[string]any, requestHeaders http.Header) map[string]string {
	params, _ := item["params"].(map[string]any)
	origins := []string{}
	for _, value := range strings.Split(strOption(params["origins"], "*"), ",") {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	credentials := boolOption(params["credentials"], false)
	maxAge := intOption(params["maxAgeSeconds"], 600)
	origin := requestHeaders.Get("Origin")
	allowOrigin := ""
	wildcard := len(origins) > 0
	for _, value := range origins {
		if value != "*" {
			wildcard = false
		}
	}
	switch {
	case wildcard && !credentials:
		allowOrigin = "*"
	case origin != "" && contains(origins, origin):
		allowOrigin = origin
	case len(origins) == 1:
		allowOrigin = origins[0]
	}
	if allowOrigin == "" {
		return map[string]string{}
	}
	headers := map[string]string{
		"Access-Control-Allow-Origin":  allowOrigin,
		"Vary":                         "Origin",
		"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type,Authorization",
		"Access-Control-Max-Age":       strconv.Itoa(maxAge),
	}
	if credentials {
		headers["Access-Control-Allow-Credentials"] = "true"
	}
	return headers
}

func contains(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

func hasAnyRole(roles, allowed []string) bool {
	for _, role := range roles {
		if contains(allowed, role) {
			return true
		}
	}
	return false
}

func splitRoles(raw string) []string {
	out := []string{}
	for _, value := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func rateKey(keyBy string, headers http.Header) string {
	if keyBy == "token" {
		raw := headers.Get("Authorization")
		if raw == "" {
			return "token:anonymous"
		}
		sum := sha256.Sum256([]byte(raw))
		return fmt.Sprintf("token:%x", sum[:8])
	}
	if forwarded := headers.Get("X-Forwarded-For"); forwarded != "" {
		if first := strings.TrimSpace(strings.Split(forwarded, ",")[0]); first != "" {
			return first
		}
	}
	return "local"
}

func takeToken(key string, rps, burst float64) bool {
	rateMu.Lock()
	defer rateMu.Unlock()
	now := time.Now()
	bucket, ok := rateBuckets[key]
	if !ok {
		bucket = &rateBucket{tokens: burst, last: now}
		rateBuckets[key] = bucket
	}
	bucket.tokens += now.Sub(bucket.last).Seconds() * rps
	if bucket.tokens > burst {
		bucket.tokens = burst
	}
	bucket.last = now
	if bucket.tokens >= 1 {
		bucket.tokens -= 1
		return true
	}
	return false
}

/* ------------------------------------------------------------------ 文件 / HTTP / 响应 */

func safeFilePath(rel string) (string, *flowError) {
	trimmed := strings.TrimSpace(rel)
	if trimmed == "" {
		return "", &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "文件路径不能为空", field: "path"}
	}
	if filepath.IsAbs(trimmed) {
		return "", &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "文件路径必须是 data/files 下的相对路径", field: "path"}
	}
	cleaned := filepath.Clean(trimmed)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "文件路径不能包含 ..", field: "path"}
	}
	root, err := os.Getwd()
	if err != nil {
		return "", &flowError{status: http.StatusInternalServerError, code: "LC_E_INTERNAL", message: "无法定位工作目录"}
	}
	return filepath.Join(root, "data", "files", cleaned), nil
}

func requestJSON(ctx context.Context, rawURL string, args map[string]any) (any, *flowError) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "外部请求地址只允许 http/https", field: "url"}
	}
	if privateHost(parsed.Hostname()) {
		return nil, &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "外部请求不允许访问本机或内网地址", field: "url"}
	}
	method := strings.ToUpper(strOption(args["method"], "GET"))
	bodyText := ""
	if value, ok := args["body"]; ok && value != nil {
		if text, ok := value.(string); ok {
			bodyText = text
		} else if encoded, err := json.Marshal(value); err == nil {
			bodyText = string(encoded)
		}
	}
	var reader io.Reader
	if bodyText != "" && method != "GET" && method != "HEAD" {
		reader = strings.NewReader(bodyText)
	}
	timeout := time.Duration(intOption(args["timeoutMs"], 8000)) * time.Millisecond
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, method, parsed.String(), reader)
	if err != nil {
		return nil, &flowError{status: http.StatusBadRequest, code: "LC_E_INVALID_ARGUMENT", message: "无法构造外部请求", field: "url"}
	}
	if headers, ok := args["headers"].(map[string]any); ok {
		for key, value := range headers {
			request.Header.Set(key, toText(value))
		}
	}
	if reader != nil && request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := (&http.Client{Timeout: timeout}).Do(request)
	if err != nil {
		return nil, &flowError{status: http.StatusBadGateway, code: "LC_E_UPSTREAM", message: "外部请求失败：" + err.Error()}
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxFileBytes+1))
	if err != nil {
		return nil, &flowError{status: http.StatusBadGateway, code: "LC_E_UPSTREAM", message: "读取外部响应失败"}
	}
	if len(payload) > maxFileBytes {
		return nil, &flowError{status: http.StatusBadGateway, code: "LC_E_UPSTREAM", message: "外部响应超过 1 MB"}
	}
	var data any
	if json.Unmarshal(payload, &data) != nil {
		data = string(payload)
	}
	return map[string]any{
		"status": response.StatusCode,
		"ok":     response.StatusCode < 400,
		"data":   data,
	}, nil
}

func privateHost(host string) bool {
	if host == "" || strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

func writeFlowResponse(w http.ResponseWriter, response *flowResponse) {
	for key, value := range response.headers {
		w.Header().Set(key, value)
	}
	status := response.status
	if status == 0 {
		status = http.StatusOK
	}
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if response.body != nil {
		_ = json.NewEncoder(w).Encode(response.body)
	}
}

func errorPayload(code, message, field string) map[string]any {
	return map[string]any{
		"ok": false,
		"error": map[string]any{
			"code":    code,
			"message": message,
			"field":   field,
		},
	}
}

func headerMap(value any) map[string]string {
	out := map[string]string{}
	raw, ok := value.(map[string]any)
	if !ok {
		return out
	}
	for key, item := range raw {
		out[key] = toText(item)
	}
	return out
}

func withQuery(r *http.Request, params map[string]string) *http.Request {
	clone := r.Clone(r.Context())
	urlCopy := *r.URL
	query := urlCopy.Query()
	for key, value := range params {
		query.Set(key, value)
	}
	urlCopy.RawQuery = query.Encode()
	clone.URL = &urlCopy
	return clone
}

func stringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func strOption(value any, fallback string) string {
	if text, ok := value.(string); ok {
		return text
	}
	return fallback
}

func boolOption(value any, fallback bool) bool {
	if flag, ok := value.(bool); ok {
		return flag
	}
	return fallback
}

func floatOption(value any, fallback float64) float64 {
	if number, ok := value.(float64); ok {
		return number
	}
	return fallback
}

func intOption(value any, fallback int) int {
	if number, ok := value.(float64); ok {
		return int(number)
	}
	return fallback
}
