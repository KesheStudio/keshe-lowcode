// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 认证路由：只做参数解析、调用 auth.Service 与统一响应，不在这里写业务规则。
package routes

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"lowcode/server/internal/generated/app"
	"lowcode/server/internal/generated/auth"
	"lowcode/server/internal/generated/httpx"
)

const maxAuthBody = 64 * 1024

func writeAuthDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, httpx.CodePayloadTooLarge, "请求体超过上限", "")
		return
	}
	httpx.WriteError(w, http.StatusBadRequest, httpx.CodeInvalidArgument, "请求体不是合法 JSON", "")
}

func registerAuth(mux *http.ServeMux, deps *app.Deps) {
	mux.HandleFunc("POST /api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		authRegister(w, r, deps)
	})
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		authLogin(w, r, deps)
	})
	mux.HandleFunc("POST /api/auth/refresh", func(w http.ResponseWriter, r *http.Request) {
		authRefresh(w, r, deps)
	})
	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		authLogout(w, r, deps)
	})
	mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		authMe(w, r, deps)
	})
	mux.HandleFunc("GET /api/auth/mode", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteOK(w, http.StatusOK, map[string]any{"tokenMode": deps.Auth.Mode()})
	})
	mux.HandleFunc("GET /api/admin/users", func(w http.ResponseWriter, r *http.Request) {
		authAdminUsers(w, r, deps)
	})
}

type registerBody struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type loginBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type refreshBody struct {
	RefreshToken string `json:"refreshToken"`
}

type logoutBody struct {
	RefreshToken string `json:"refreshToken"`
}

func authRegister(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	var body registerBody
	if err := httpx.DecodeJSON(w, r, &body, maxAuthBody); err != nil {
		writeAuthDecodeError(w, err)
		return
	}
	data, status, err := deps.Auth.Register(r.Context(), body.Username, body.Password, body.DisplayName, r.UserAgent())
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.WriteOK(w, status, data)
}

func authLogin(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	var body loginBody
	if err := httpx.DecodeJSON(w, r, &body, maxAuthBody); err != nil {
		writeAuthDecodeError(w, err)
		return
	}
	data, err := deps.Auth.Login(r.Context(), body.Username, body.Password, r.UserAgent())
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.WriteOK(w, http.StatusOK, data)
}

func authRefresh(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	refreshToken := ""
	if deps.Auth.Mode() == auth.TokenModeJWT {
		var body refreshBody
		if err := httpx.DecodeJSON(w, r, &body, maxAuthBody); err != nil {
			writeAuthDecodeError(w, err)
			return
		}
		refreshToken = body.RefreshToken
	}
	data, err := deps.Auth.Refresh(r.Context(), refreshToken, bearerToken(r), r.UserAgent())
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.WriteOK(w, http.StatusOK, data)
}

func authLogout(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	current, err := deps.Auth.Authenticate(r.Context(), r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	refreshToken := ""
	if r.Body != nil {
		var body logoutBody
		if err := httpx.DecodeJSON(w, r, &body, maxAuthBody); err != nil && !errors.Is(err, io.EOF) {
			writeAuthDecodeError(w, err)
			return
		}
		refreshToken = body.RefreshToken
	}
	affected, err := deps.Auth.Logout(r.Context(), current, refreshToken)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.WriteOK(w, http.StatusOK, map[string]any{"revoked": affected})
}

func authMe(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	current, err := deps.Auth.Authenticate(r.Context(), r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.WriteOK(w, http.StatusOK, current.JSON())
}

func authAdminUsers(w http.ResponseWriter, r *http.Request, deps *app.Deps) {
	current, err := deps.Auth.Authenticate(r.Context(), r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	if err := deps.Auth.RequirePermission(current, "users:read"); err != nil {
		writeAuthError(w, err)
		return
	}
	items, err := deps.Auth.ListUsers(r.Context())
	if err != nil {
		writeAuthError(w, err)
		return
	}
	httpx.WriteOK(w, http.StatusOK, map[string]any{"items": items})
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}

func writeAuthError(w http.ResponseWriter, err error) {
	var authErr *auth.Error
	if errors.As(err, &authErr) {
		httpx.WriteError(w, authErr.Status, authErr.Code, authErr.Message, authErr.Field)
		return
	}
	// 内部错误只记日志，响应保持中性，不把数据库细节返回给客户端。
	slog.Error("认证接口内部错误", "error", err.Error())
	httpx.WriteError(w, http.StatusInternalServerError, httpx.CodeInternal, "服务端错误", "")
}
