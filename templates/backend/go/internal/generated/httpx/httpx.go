// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 统一响应包装 + 可配置中间件（请求 ID/日志、CORS、限流、gzip、安全响应头）。
package httpx

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"lowcode/server/internal/generated/config"
)

// 错误码与三语言模板保持一致。
const (
	CodeConfigInvalid      = "LC_E_CONFIG_INVALID"
	CodeInvalidArgument    = "LC_E_INVALID_ARGUMENT"
	CodeUnauthorized       = "LC_E_UNAUTHORIZED"
	CodeForbidden          = "LC_E_FORBIDDEN"
	CodeNotFound           = "LC_E_NOT_FOUND"
	CodePayloadTooLarge    = "LC_E_PAYLOAD_TOO_LARGE"
	CodeRateLimited        = "LC_E_RATE_LIMITED"
	CodeInternal           = "LC_E_INTERNAL"
	CodeDBUnavailable      = "LC_E_DB_UNAVAILABLE"
	CodeDataInvalidRow     = "LC_E_DATA_INVALID_ROW"
	CodeDataRowConflict    = "LC_E_DATA_ROW_CONFLICT"
	CodeTimeout            = "LC_E_TIMEOUT"
	CodeConcurrencyLimited = "LC_E_CONCURRENCY_LIMITED"
	CodeNotReady           = "LC_E_NOT_READY"
	CodeMiddlewareDisabled = "LC_E_MIDDLEWARE_DISABLED"
)

// FieldError 描述一个具体字段的校验错误，用于 error.fields 数组。
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorBody struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Detail  string       `json:"detail"`
	Field   string       `json:"field"`
	Fields  []FieldError `json:"fields,omitempty"`
}

type envelope struct {
	OK    bool       `json:"ok"`
	Data  any        `json:"data,omitempty"`
	Error *errorBody `json:"error,omitempty"`
}

// WriteOK 输出 { ok: true, data }。
func WriteOK(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{OK: true, Data: data})
}

// WriteError 输出 { ok: false, error }；detail 永远不返回内部细节。
func WriteError(w http.ResponseWriter, status int, code, message, field string) {
	WriteErrorWithFields(w, status, code, message, field, nil)
}

// WriteErrorWithFields 与 WriteError 相同，但带上 error.fields（逐字段校验错误）。
func WriteErrorWithFields(w http.ResponseWriter, status int, code, message, field string, fields []FieldError) {
	body := &errorBody{Code: code, Message: message, Detail: "", Field: field}
	if len(fields) > 0 {
		body.Fields = fields
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{OK: false, Error: body})
}

// WriteErrorWithDetail 与 WriteError 相同，额外给出可操作 detail（探针/禁用类错误使用）。
func WriteErrorWithDetail(w http.ResponseWriter, status int, code, message, detail, field string) {
	body := &errorBody{Code: code, Message: message, Detail: detail, Field: field}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{OK: false, Error: body})
}

// DecodeJSON 读请求体并限制大小；错误信息保持中性，避免回显请求内容。
func DecodeJSON(w http.ResponseWriter, r *http.Request, target any, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	return decoder.Decode(target)
}

// ---------------------------------------------------------------- 中间件装配

// Chain 按“由外向内”的顺序包装：
// 请求上下文 → 请求体上限 → 安全头 → CORS → 超时 → 并发 → 限流 → gzip → 业务。
func Chain(next http.Handler, cfg *config.Config, limiter *Limiter) http.Handler {
	handler := next

	if cfg.Middleware.Compression.Enabled && cfg.Middleware.Compression.Gzip {
		handler = gzipMiddleware(handler, cfg.Middleware.Compression.MinBytes)
	}
	if cfg.Middleware.RateLimit.Enabled && limiter != nil {
		handler = limiter.Middleware(handler)
	}
	if cfg.Middleware.Concurrency.Enabled {
		handler = concurrencyMiddleware(handler, cfg.Middleware.Concurrency.MaxInFlight)
	}
	if cfg.Middleware.Timeout.Enabled {
		handler = timeoutMiddleware(handler, cfg.Middleware.Timeout.Seconds)
	}
	if cfg.CORS.Enabled {
		handler = corsMiddleware(handler, cfg.CORS)
	}
	if cfg.Middleware.SecurityHeaders.Enabled {
		handler = securityHeaders(handler, cfg.Middleware.SecurityHeaders)
	}
	if cfg.Middleware.BodyLimit.Enabled {
		handler = bodyLimitMiddleware(handler, int64(cfg.Middleware.BodyLimit.MaxBytes))
	}
	if cfg.Middleware.RequestID || cfg.Middleware.Logging {
		handler = requestContext(handler, cfg)
	}
	return handler
}

func bodyLimitMiddleware(next http.Handler, maxBytes int64) http.Handler {
	if maxBytes <= 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func concurrencyMiddleware(next http.Handler, maxInFlight int) http.Handler {
	if maxInFlight <= 0 {
		maxInFlight = 1
	}
	semaphore := make(chan struct{}, maxInFlight)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case semaphore <- struct{}{}:
			defer func() { <-semaphore }()
		default:
			w.Header().Set("Retry-After", "1")
			WriteError(w, http.StatusServiceUnavailable, CodeConcurrencyLimited,
				fmt.Sprintf("在途请求已达上限 %d，请稍后重试", maxInFlight), "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// timeoutWriter 先缓冲 handler 的响应，只有 handler 在超时前完成才提交，
// 从而保证超时返回的 JSON 头不会被 http.TimeoutHandler 覆盖成 text/plain。
type timeoutWriter struct {
	mu        sync.Mutex
	target    http.ResponseWriter
	header    http.Header
	status    int
	body      bytes.Buffer
	committed bool
	aborted   bool
}

func newTimeoutWriter(target http.ResponseWriter) *timeoutWriter {
	return &timeoutWriter{target: target, header: make(http.Header)}
}

func (t *timeoutWriter) Header() http.Header {
	return t.header
}

func (t *timeoutWriter) WriteHeader(status int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.committed || t.aborted || t.status != 0 {
		return
	}
	t.status = status
}

func (t *timeoutWriter) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.committed || t.aborted {
		return 0, http.ErrHandlerTimeout
	}
	if t.status == 0 {
		t.status = http.StatusOK
	}
	return t.body.Write(p)
}

func (t *timeoutWriter) commit() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.committed || t.aborted {
		return
	}
	t.committed = true
	for key, values := range t.header {
		for _, value := range values {
			t.target.Header().Add(key, value)
		}
	}
	status := t.status
	if status == 0 {
		status = http.StatusOK
	}
	t.target.WriteHeader(status)
	if t.body.Len() > 0 {
		_, _ = t.target.Write(t.body.Bytes())
	}
}

func (t *timeoutWriter) abort() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.committed {
		return
	}
	t.aborted = true
}

func timeoutMiddleware(next http.Handler, seconds int) http.Handler {
	if seconds <= 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(seconds)*time.Second)
		defer cancel()
		buffered := newTimeoutWriter(w)
		finished := make(chan struct{})
		panicCh := make(chan any, 1)
		go func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					panicCh <- recovered
				}
				close(finished)
			}()
			next.ServeHTTP(buffered, r.WithContext(ctx))
		}()
		select {
		case <-finished:
			select {
			case recovered := <-panicCh:
				panic(recovered)
			default:
			}
			buffered.commit()
		case <-ctx.Done():
			buffered.abort()
			WriteError(w, http.StatusServiceUnavailable, CodeTimeout,
				fmt.Sprintf("请求处理超过 %d 秒", seconds), "")
		}
	})
}

func securityHeaders(next http.Handler, headers config.SecurityHeaders) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setHeaderIfNotEmpty(w, "X-Content-Type-Options", headers.ContentTypeOptions)
		setHeaderIfNotEmpty(w, "X-Frame-Options", headers.FrameOptions)
		setHeaderIfNotEmpty(w, "Referrer-Policy", headers.ReferrerPolicy)
		setHeaderIfNotEmpty(w, "Permissions-Policy", headers.PermissionsPolicy)
		setHeaderIfNotEmpty(w, "Cross-Origin-Opener-Policy", headers.CrossOriginOpenerPolicy)
		if headers.HSTS.Enabled {
			value := fmt.Sprintf("max-age=%d", headers.HSTS.MaxAgeSeconds)
			if headers.HSTS.IncludeSubdomains {
				value += "; includeSubDomains"
			}
			if headers.HSTS.Preload {
				value += "; preload"
			}
			w.Header().Set("Strict-Transport-Security", value)
		}
		next.ServeHTTP(w, r)
	})
}

func setHeaderIfNotEmpty(w http.ResponseWriter, name, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	w.Header().Set(name, value)
}

func requestContext(next http.Handler, cfg *config.Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := newRequestID()
		started := time.Now()
		if cfg.Middleware.RequestID {
			w.Header().Set("X-Request-Id", requestID)
		}
		next.ServeHTTP(w, r)
		if cfg.Middleware.Logging {
			slog.Info("request",
				"request_id", requestID,
				"method", r.Method,
				"path", r.URL.Path,
				"elapsed_ms", time.Since(started).Milliseconds(),
			)
		}
	})
}

func newRequestID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf)
}

func corsMiddleware(next http.Handler, cors config.CORS) http.Handler {
	allowed := map[string]bool{}
	wildcard := false
	for _, origin := range cors.Origins {
		if origin == "*" && !cors.Credentials {
			wildcard = true
			continue
		}
		allowed[origin] = true
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (wildcard || allowed[origin]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			if cors.Credentials {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", strings.Join(cors.Methods, ", "))
				w.Header().Set("Access-Control-Allow-Headers", strings.Join(cors.Headers, ", "))
				w.Header().Set("Access-Control-Max-Age", strconv.Itoa(cors.MaxAge))
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Limiter 是进程内固定窗口限流器，重启清零；多实例部署时不共享。
type Limiter struct {
	mu      sync.Mutex
	rps     int
	buckets map[string]bucket
}

type bucket struct {
	start time.Time
	count int
}

func NewLimiter(rps int) *Limiter {
	return &Limiter{rps: rps, buckets: map[string]bucket{}}
}

func (l *Limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	if len(l.buckets) > 10000 {
		for k, b := range l.buckets {
			if now.Sub(b.start) >= time.Second {
				delete(l.buckets, k)
			}
		}
	}

	entry := l.buckets[key]
	if now.Sub(entry.start) >= time.Second {
		entry = bucket{start: now, count: 0}
	}
	entry.count++
	l.buckets[key] = entry
	return entry.count <= l.rps
}

func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientIP(r)
		if !l.allow(key) {
			w.Header().Set("Retry-After", "1")
			WriteError(w, http.StatusTooManyRequests, CodeRateLimited, "请求过于频繁，请稍后再试", "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ---------------------------------------------------------------- gzip

const maxCompressBytes = 1 << 20

func gzipMiddleware(next http.Handler, minBytes int) http.Handler {
	if minBytes <= 0 {
		minBytes = 1024
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		buffered := &gzipBuffer{ResponseWriter: w, minBytes: minBytes}
		next.ServeHTTP(buffered, r)
		buffered.finish()
	})
}

type gzipBuffer struct {
	http.ResponseWriter
	minBytes int
	status   int
	body     bytes.Buffer
	overflow bool
	written  bool
}

func (g *gzipBuffer) WriteHeader(status int) {
	if g.written {
		return
	}
	g.status = status
}

func (g *gzipBuffer) Write(p []byte) (int, error) {
	if g.overflow {
		return g.ResponseWriter.Write(p)
	}
	if g.body.Len()+len(p) > maxCompressBytes {
		g.overflow = true
		g.flushRaw()
		return g.ResponseWriter.Write(p)
	}
	return g.body.Write(p)
}

func (g *gzipBuffer) flushRaw() {
	if g.written {
		return
	}
	if g.status == 0 {
		g.status = http.StatusOK
	}
	g.ResponseWriter.WriteHeader(g.status)
	g.written = true
	if g.body.Len() > 0 {
		_, _ = g.ResponseWriter.Write(g.body.Bytes())
	}
}

func (g *gzipBuffer) finish() {
	if g.written {
		return
	}
	if g.status == 0 {
		g.status = http.StatusOK
	}
	contentType := g.Header().Get("Content-Type")
	compressible := strings.HasPrefix(contentType, "application/json") ||
		strings.HasPrefix(contentType, "text/") ||
		strings.HasPrefix(contentType, "application/javascript")
	if !compressible || g.body.Len() < g.minBytes {
		g.flushRaw()
		return
	}

	g.Header().Del("Content-Length")
	g.Header().Set("Content-Encoding", "gzip")
	g.Header().Add("Vary", "Accept-Encoding")
	g.ResponseWriter.WriteHeader(g.status)
	g.written = true

	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	if _, err := writer.Write(g.body.Bytes()); err != nil {
		_ = writer.Close()
		return
	}
	_ = writer.Close()
	_, _ = g.ResponseWriter.Write(buf.Bytes())
}

// Flush 让需要流式输出的处理器（静态文件）保持可用。
func (g *gzipBuffer) Flush() {
	if flusher, ok := g.ResponseWriter.(http.Flusher); ok {
		g.flushRaw()
		flusher.Flush()
	}
}
