// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 集合 CRUD 的 HTTP 接线：路径与前端 rowsPath 契约对齐（列表行固定在 data.items）。
package routes

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/data"
	"lowcode/server/internal/generated/httpx"
)

const maxCollectionRowBody = 1 << 20

func registerCollections(mux *http.ServeMux, deps *app.Deps) {
	if deps.Config == nil || !deps.Config.DataAPI.Enabled || deps.Data == nil {
		return
	}

	mux.HandleFunc("GET /api/collections/{collectionId}/rows", func(w http.ResponseWriter, r *http.Request) {
		result, err := deps.Data.List(r.Context(), r.PathValue("collectionId"), r)
		if err != nil {
			writeDataError(w, err)
			return
		}
		httpx.WriteOK(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /api/collections/{collectionId}/rows/{rowId}", func(w http.ResponseWriter, r *http.Request) {
		result, err := deps.Data.Get(r.Context(), r.PathValue("collectionId"), r.PathValue("rowId"), r)
		if err != nil {
			writeDataError(w, err)
			return
		}
		httpx.WriteOK(w, http.StatusOK, result)
	})

	mux.HandleFunc("POST /api/collections/{collectionId}/rows", func(w http.ResponseWriter, r *http.Request) {
		body, ok := readCollectionRowBody(w, r)
		if !ok {
			return
		}
		result, err := deps.Data.Create(r.Context(), r.PathValue("collectionId"), body, r)
		if err != nil {
			writeDataError(w, err)
			return
		}
		httpx.WriteOK(w, http.StatusCreated, result)
	})

	mux.HandleFunc("PUT /api/collections/{collectionId}/rows/{rowId}", func(w http.ResponseWriter, r *http.Request) {
		body, ok := readCollectionRowBody(w, r)
		if !ok {
			return
		}
		result, err := deps.Data.Update(r.Context(), r.PathValue("collectionId"), r.PathValue("rowId"), body, r)
		if err != nil {
			writeDataError(w, err)
			return
		}
		httpx.WriteOK(w, http.StatusOK, result)
	})

	mux.HandleFunc("DELETE /api/collections/{collectionId}/rows/{rowId}", func(w http.ResponseWriter, r *http.Request) {
		result, err := deps.Data.Remove(r.Context(), r.PathValue("collectionId"), r.PathValue("rowId"), r)
		if err != nil {
			writeDataError(w, err)
			return
		}
		httpx.WriteOK(w, http.StatusOK, result)
	})
}

// readCollectionRowBody 读取任意 JSON 值；空请求体按 {} 处理（与 Node 的 request.body || {} 一致）。
func readCollectionRowBody(w http.ResponseWriter, r *http.Request) (any, bool) {
	var body any
	if err := httpx.DecodeJSON(w, r, &body, maxCollectionRowBody); err != nil {
		if errors.Is(err, io.EOF) && !strings.Contains(r.Header.Get("Content-Type"), "application/json") {
			return map[string]any{}, true
		}
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, httpx.CodePayloadTooLarge, "请求体超过 1 MB 上限", "")
			return nil, false
		}
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "请求格式不合法", "")
		return nil, false
	}
	return body, true
}

func writeDataError(w http.ResponseWriter, err error) {
	var dataErr *data.Error
	if errors.As(err, &dataErr) {
		if len(dataErr.Fields) > 0 {
			fields := make([]httpx.FieldError, 0, len(dataErr.Fields))
			for _, item := range dataErr.Fields {
				fields = append(fields, httpx.FieldError{Field: item.Field, Code: item.Code, Message: item.Message})
			}
			httpx.WriteErrorWithFields(w, dataErr.Status, dataErr.Code, dataErr.Message, dataErr.Field, fields)
			return
		}
		httpx.WriteError(w, dataErr.Status, dataErr.Code, dataErr.Message, dataErr.Field)
		return
	}
	slog.Error("集合数据接口内部错误", "error", err.Error())
	httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "服务端处理失败", "")
}
