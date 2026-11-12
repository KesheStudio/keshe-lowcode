// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// /api/items 的处理器扩展点：改校验、改返回结构只改这个文件。
// 换存储实现请改 ./store.go。
package custom

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/httpx"
	"lowcode/server/internal/generated/models"
)

const (
	maxTitle        = 200
	maxBody         = 20000
	defaultPageSize = 20
	maxPageSize     = 100
	maxRequestBody  = 1 << 20
)

// ListItems 处理 GET /api/items?limit=&offset=。
func ListItems(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	limit, err := readInt(r.URL.Query().Get("limit"), defaultPageSize, "limit", 1, maxPageSize)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, err.Error(), "limit")
		return
	}
	offset, err := readInt(r.URL.Query().Get("offset"), 0, "offset", 0, 1<<31-1)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, err.Error(), "offset")
		return
	}

	items, total, err := listItems(deps.DB, limit, offset)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "读取数据失败", "")
		return
	}

	httpx.WriteOK(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetItem 处理 GET /api/items/{id}：先读缓存，未命中再查库并回填。
func GetItem(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	id := r.PathValue("id")
	if cached := readCachedItem(deps, id); cached != nil {
		httpx.WriteOK(w, http.StatusOK, cached)
		return
	}

	item, err := getItem(deps.DB, id)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "读取数据失败", "")
		return
	}
	if item == nil {
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "items 记录不存在", "")
		return
	}
	writeCachedItem(deps, item)
	httpx.WriteOK(w, http.StatusOK, item)
}

// CreateItem 处理 POST /api/items。
func CreateItem(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	title, body, ok := readItemInput(w, r)
	if !ok {
		return
	}

	item, err := createItem(deps.DB, title, body)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "写入数据失败", "")
		return
	}
	invalidateCachedItem(deps, item.ID)
	httpx.WriteOK(w, http.StatusCreated, item)
}

// UpdateItem 处理 PUT /api/items/{id}。
func UpdateItem(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	title, body, ok := readItemInput(w, r)
	if !ok {
		return
	}

	item, err := updateItem(deps.DB, r.PathValue("id"), title, body)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "更新数据失败", "")
		return
	}
	if item == nil {
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "items 记录不存在", "")
		return
	}
	invalidateCachedItem(deps, item.ID)
	httpx.WriteOK(w, http.StatusOK, item)
}

// DeleteItem 处理 DELETE /api/items/{id}。
func DeleteItem(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	id := r.PathValue("id")
	removed, err := deleteItem(deps.DB, id)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "删除数据失败", "")
		return
	}
	if !removed {
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "items 记录不存在", "")
		return
	}
	invalidateCachedItem(deps, id)
	httpx.WriteOK(w, http.StatusOK, map[string]any{"id": id})
}

// ---------------------------------------------------------------- 缓存读写

func itemCacheKey(deps *app.Deps, id string) string {
	return deps.Config.Cache.KeyPrefix + "items:" + id
}

func readCachedItem(deps *app.Deps, id string) *models.Item {
	if deps.Cache == nil {
		return nil
	}
	raw, ok := deps.Cache.Get(itemCacheKey(deps, id))
	if !ok {
		return nil
	}
	var item models.Item
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil
	}
	return &item
}

func writeCachedItem(deps *app.Deps, item *models.Item) {
	if deps.Cache == nil {
		return
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return
	}
	ttl := time.Duration(deps.Config.Cache.TTLSeconds) * time.Second
	_ = deps.Cache.Set(itemCacheKey(deps, item.ID), raw, ttl)
}

func invalidateCachedItem(deps *app.Deps, id string) {
	if deps.Cache == nil {
		return
	}
	_ = deps.Cache.Del(itemCacheKey(deps, id))
}

func readItemInput(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	var payload map[string]any
	if err := httpx.DecodeJSON(w, r, &payload, maxRequestBody); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, httpx.CodePayloadTooLarge, "请求体超过 1 MB 上限", "body")
			return "", "", false
		}
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "请求体必须是合法 JSON 对象", "body")
		return "", "", false
	}

	rawTitle, ok := payload["title"].(string)
	title := strings.TrimSpace(rawTitle)
	if !ok || title == "" {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "title 必须是非空字符串", "title")
		return "", "", false
	}
	if len([]rune(title)) > maxTitle {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "title 最长 200 个字符", "title")
		return "", "", false
	}

	detail := ""
	if rawBody, exists := payload["body"]; exists {
		text, isString := rawBody.(string)
		if !isString {
			httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "body 必须是字符串", "body")
			return "", "", false
		}
		detail = text
	}
	if len([]rune(detail)) > maxBody {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "body 最长 20000 个字符", "body")
		return "", "", false
	}
	return title, detail, true
}

func readInt(raw string, fallback int, field string, min, max int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < min || value > max {
		return 0, &fieldError{field: field, min: min, max: max}
	}
	return value, nil
}

type fieldError struct {
	field    string
	min, max int
}

func (e *fieldError) Error() string {
	return e.field + " 必须是 " + strconv.Itoa(e.min) + "-" + strconv.Itoa(e.max) + " 的整数"
}
