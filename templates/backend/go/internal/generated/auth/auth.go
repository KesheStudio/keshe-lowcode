// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 认证中心：注册 / 登录 / 刷新 / 登出 / 当前用户 / 最小 RBAC。
// 默认令牌方案是 JWT（短时 access）+ 数据库刷新令牌（可撤销）；auth.tokenMode=session 时改用服务端会话。
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/argon2"

	"lowcode/server/internal/generated/config"
	"lowcode/server/internal/generated/db"
)

const (
	TokenModeJWT     = "jwt"
	TokenModeSession = "session"

	// 密码哈希参数：Argon2id，m=19456 KiB（19 MiB）、t=2、p=1，16 字节盐，32 字节输出。
	// 参数写进存储串，验证时按串里参数重算；升级基线后老哈希在登录成功那一次重算。
	argonMemory      = 19456
	argonIterations  = 2
	argonParallelism = 1
	argonSaltLength  = 16
	argonKeyLength   = 32
	argonPrefix      = "argon2id$v=19$"
)

var (
	usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,32}$`)
	timeFormat      = "2006-01-02T15:04:05Z"
)

// Error 是认证层的业务错误；路由层按 Status / Code 输出统一响应。
type Error struct {
	Status  int
	Code    string
	Message string
	Field   string
}

func (e *Error) Error() string { return e.Message }

func newError(status int, code, message, field string) *Error {
	return &Error{Status: status, Code: code, Message: message, Field: field}
}

// Unauthorized 统一使用中性文案，不泄漏用户是否存在。
func Unauthorized(message string) *Error {
	if message == "" {
		message = "未认证或令牌已失效"
	}
	return newError(http.StatusUnauthorized, "LC_E_UNAUTHORIZED", message, "")
}

// Forbidden 表示已登录但缺少权限点。
func Forbidden(message string) *Error {
	if message == "" {
		message = "没有访问该接口的权限"
	}
	return newError(http.StatusForbidden, "LC_E_FORBIDDEN", message, "")
}

func rateLimited() *Error {
	return newError(http.StatusTooManyRequests, "LC_E_RATE_LIMITED", "尝试次数过多，请稍后再试", "")
}

func invalidArgument(message, field string) *Error {
	return newError(http.StatusBadRequest, "LC_E_INVALID_ARGUMENT", message, field)
}

// Context 是一次已认证请求的用户上下文。
type Context struct {
	UserID      string
	Username    string
	DisplayName string
	Status      string
	Roles       []string
	Permissions []string
	TokenMode   string
	TokenHash   string
}

// JSON 是 /api/auth/me 的响应体。
func (c *Context) JSON() map[string]any {
	return map[string]any{
		"user": map[string]any{
			"id":          c.UserID,
			"username":    c.Username,
			"displayName": c.DisplayName,
			"status":      c.Status,
			"roles":       c.Roles,
			"permissions": c.Permissions,
		},
		"roles":       c.Roles,
		"permissions": c.Permissions,
		"tokenMode":   c.TokenMode,
	}
}

// Service 持有配置、数据库与 JWT 密钥。
type Service struct {
	cfg       config.Auth
	db        *db.Handle
	mode      string
	secret    []byte
	dummyHash string
}

// New 初始化认证服务；JWT 模式未配置密钥时生成进程内一次性密钥并 warn。
func New(cfg config.Auth, handle *db.Handle) (*Service, error) {
	mode := cfg.TokenMode
	if mode == "" {
		mode = TokenModeJWT
	}
	secret := cfg.JWTSecret
	if mode == TokenModeJWT && secret == "" {
		buf := make([]byte, 48)
		if _, err := rand.Read(buf); err != nil {
			return nil, fmt.Errorf("生成 JWT 密钥失败：%w", err)
		}
		secret = hex.EncodeToString(buf)
		slog.Warn("[auth] auth.jwtSecret 未配置，已生成进程内一次性密钥；重启后所有已签发令牌失效。生产请设置 LC_AUTH_JWT_SECRET。")
	}
	dummy, err := HashPassword("lc-dummy-password-for-timing")
	if err != nil {
		return nil, fmt.Errorf("初始化认证失败：%w", err)
	}
	return &Service{
		cfg:       cfg,
		db:        handle,
		mode:      mode,
		secret:    []byte(secret),
		dummyHash: dummy,
	}, nil
}

// Mode 返回当前令牌方案。
func (s *Service) Mode() string { return s.mode }

// ---------------------------------------------------------------- 密码哈希

// HashPassword 生成 Argon2id 哈希，格式：argon2id$v=19$m=..,t=..,p=..$salt$hash。
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("生成密码盐失败：%w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	params := fmt.Sprintf("m=%d,t=%d,p=%d", argonMemory, argonIterations, argonParallelism)
	return fmt.Sprintf("%s%s$%s$%s", argonPrefix, params,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword 按存储串里的算法与参数校验；返回是否需要按当前基线重算。
func VerifyPassword(password, encoded string) (bool, bool) {
	if !strings.HasPrefix(encoded, "argon2id$") {
		// 不认识的算法前缀直接拒绝，不做降级猜测。
		return false, false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != "v=19" {
		return false, false
	}
	params, err := parseArgonParams(parts[2])
	if err != nil {
		return false, false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(salt) == 0 {
		return false, false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(expected) == 0 {
		return false, false
	}
	actual := argon2.IDKey([]byte(password), salt, params.iterations, params.memory, params.parallelism, uint32(len(expected)))
	if subtle.ConstantTimeCompare(actual, expected) != 1 {
		return false, false
	}
	rehash := params.memory != argonMemory || params.iterations != argonIterations ||
		params.parallelism != argonParallelism || len(salt) != argonSaltLength || len(expected) != argonKeyLength
	return true, rehash
}

type argonParams struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
}

func parseArgonParams(text string) (argonParams, error) {
	var out argonParams
	for _, part := range strings.Split(text, ",") {
		pair := strings.SplitN(part, "=", 2)
		if len(pair) != 2 {
			return out, errors.New("参数格式错误")
		}
		value, err := strconv.Atoi(pair[1])
		if err != nil || value <= 0 {
			return out, errors.New("参数值错误")
		}
		switch pair[0] {
		case "m":
			out.memory = uint32(value)
		case "t":
			out.iterations = uint32(value)
		case "p":
			out.parallelism = uint8(value)
		default:
			return out, errors.New("未知参数")
		}
	}
	if out.memory == 0 || out.iterations == 0 || out.parallelism == 0 {
		return out, errors.New("参数缺失")
	}
	return out, nil
}

// ---------------------------------------------------------------- 令牌

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func randomID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

type jwtClaims struct {
	Name  string   `json:"name"`
	Roles []string `json:"roles"`
	Mode  string   `json:"mode"`
	jwt.RegisteredClaims
}

func (s *Service) signJWT(user *userRow, roles []string) (string, error) {
	now := time.Now().UTC()
	expires := now.Add(time.Duration(s.cfg.AccessTokenTTLSeconds) * time.Second)
	id, err := randomID()
	if err != nil {
		return "", err
	}
	claims := jwtClaims{
		Name:  user.Username,
		Roles: roles,
		Mode:  TokenModeJWT,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
			ID:        id,
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}

func (s *Service) verifyJWT(token string) (*jwtClaims, error) {
	parsed, err := jwt.ParseWithClaims(token, &jwtClaims{}, func(t *jwt.Token) (any, error) {
		return s.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*jwtClaims)
	if !ok || !parsed.Valid || claims.Subject == "" {
		return nil, errors.New("令牌无效")
	}
	return claims, nil
}

// ---------------------------------------------------------------- 数据访问

type userRow struct {
	ID           string
	Username     string
	PasswordHash string
	DisplayName  string
	Status       string
}

func (s *Service) findUserByUsername(ctx context.Context, username string) (*userRow, error) {
	row := s.db.QueryRow(`SELECT id, username, password_hash, display_name, status FROM users WHERE lower(username) = lower(?)`, username)
	return scanUser(row)
}

func (s *Service) findUserByID(ctx context.Context, id string) (*userRow, error) {
	row := s.db.QueryRow(`SELECT id, username, password_hash, display_name, status FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func scanUser(row *sql.Row) (*userRow, error) {
	var user userRow
	err := row.Scan(&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName, &user.Status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Service) loadRoles(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT r.name FROM roles r
		   JOIN user_roles ur ON ur.role_id = r.id
		  WHERE ur.user_id = ?
		  ORDER BY r.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (s *Service) loadPermissions(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT DISTINCT p.code FROM permissions p
		   JOIN role_permissions rp ON rp.permission_id = p.id
		   JOIN user_roles ur ON ur.role_id = rp.role_id
		  WHERE ur.user_id = ?
		  ORDER BY p.code`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, rows.Err()
}

func (s *Service) roleID(ctx context.Context, name string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM roles WHERE name = ?`, name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// ---------------------------------------------------------------- 令牌签发

func (s *Service) issueTokens(ctx context.Context, user *userRow, familyID, userAgent string) (map[string]any, error) {
	roles, err := s.loadRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	permissions, err := s.loadPermissions(ctx, user.ID)
	if err != nil {
		return nil, err
	}

	if s.mode == TokenModeSession {
		token, err := randomToken()
		if err != nil {
			return nil, err
		}
		id, err := randomID()
		if err != nil {
			return nil, err
		}
		now := nowISO()
		if err := exec(ctx, s.db, `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, user.ID, tokenHash(token), now, laterISO(s.cfg.SessionTTLSeconds), nil, truncate(userAgent, 255)); err != nil {
			return nil, err
		}
		s.cleanupExpired(ctx)
		return map[string]any{
			"accessToken":      token,
			"refreshToken":     nil,
			"tokenType":        "Bearer",
			"expiresIn":        s.cfg.SessionTTLSeconds,
			"refreshExpiresIn": 0,
			"tokenMode":        s.mode,
			"user":             publicUser(user, roles, permissions),
		}, nil
	}

	access, err := s.signJWT(user, roles)
	if err != nil {
		return nil, err
	}
	refresh, err := randomToken()
	if err != nil {
		return nil, err
	}
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	if familyID == "" {
		familyID, err = randomID()
		if err != nil {
			return nil, err
		}
	}
	if err := exec(ctx, s.db, `INSERT INTO auth_refresh_tokens (id, user_id, token_hash, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, user.ID, tokenHash(refresh), familyID, nowISO(), laterISO(s.cfg.RefreshTokenTTLSeconds), nil); err != nil {
		return nil, err
	}
	s.cleanupExpired(ctx)
	return map[string]any{
		"accessToken":      access,
		"refreshToken":     refresh,
		"tokenType":        "Bearer",
		"expiresIn":        s.cfg.AccessTokenTTLSeconds,
		"refreshExpiresIn": s.cfg.RefreshTokenTTLSeconds,
		"tokenMode":        s.mode,
		"user":             publicUser(user, roles, permissions),
	}, nil
}

func (s *Service) cleanupExpired(ctx context.Context) {
	now := nowISO()
	_, _ = s.db.Exec(`DELETE FROM auth_refresh_tokens WHERE expires_at <= ?`, now)
	_, _ = s.db.Exec(`DELETE FROM auth_sessions WHERE expires_at <= ?`, now)
	cutoff := time.Now().UTC().Add(-time.Duration(s.cfg.FailureWindowSeconds) * time.Second).Format(timeFormat)
	_, _ = s.db.Exec(`DELETE FROM auth_login_attempts WHERE window_started_at <= ? AND locked_until IS NULL`, cutoff)
}

func publicUser(user *userRow, roles, permissions []string) map[string]any {
	return map[string]any{
		"id":          user.ID,
		"username":    user.Username,
		"displayName": user.DisplayName,
		"status":      user.Status,
		"roles":       roles,
		"permissions": permissions,
	}
}

// ---------------------------------------------------------------- 公开流程

// Register 创建用户并直接签发令牌；重复用户名返回 400。
func (s *Service) Register(ctx context.Context, username, password, displayName, userAgent string) (map[string]any, int, error) {
	if err := validateCredentials(username, password, displayName); err != nil {
		return nil, 0, err
	}
	existing, err := s.findUserByUsername(ctx, username)
	if err != nil {
		return nil, 0, err
	}
	if existing != nil {
		return nil, 0, invalidArgument("用户名已存在", "username")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, 0, err
	}
	userID, err := randomID()
	if err != nil {
		return nil, 0, err
	}
	roleID, err := s.roleID(ctx, "user")
	if err != nil {
		return nil, 0, err
	}
	if roleID == "" {
		return nil, 0, fmt.Errorf("角色表缺少 user 角色，请重新执行迁移")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	now := nowISO()
	if err := execTx(tx, s.db.Driver, `INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, username, hash, displayName, "active", now, now); err != nil {
		return nil, 0, err
	}
	if err := execTx(tx, s.db.Driver, `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, userID, roleID); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}

	user, err := s.findUserByID(ctx, userID)
	if err != nil || user == nil {
		return nil, 0, fmt.Errorf("注册后读取用户失败")
	}
	tokens, err := s.issueTokens(ctx, user, "", userAgent)
	if err != nil {
		return nil, 0, err
	}
	return tokens, http.StatusCreated, nil
}

// Login 校验用户名密码；失败统一 401，达到阈值后 429。
func (s *Service) Login(ctx context.Context, username, password, userAgent string) (map[string]any, error) {
	if err := validateLogin(username, password); err != nil {
		return nil, err
	}
	identifier := strings.ToLower(strings.TrimSpace(username))
	if err := s.assertNotLocked(ctx, identifier); err != nil {
		return nil, err
	}

	user, err := s.findUserByUsername(ctx, identifier)
	if err != nil {
		return nil, err
	}
	ok := false
	rehash := false
	if user != nil && user.Status == "active" {
		ok, rehash = VerifyPassword(password, user.PasswordHash)
	} else {
		// 不存在 / 非活跃用户也做一次等价成本校验，避免用时间差判断账号是否存在。
		ok, _ = VerifyPassword(password, s.dummyHash)
	}
	if !ok {
		if err := s.recordFailure(ctx, identifier); err != nil {
			return nil, err
		}
		return nil, Unauthorized("用户名或密码错误")
	}
	if err := s.clearFailures(ctx, identifier); err != nil {
		return nil, err
	}
	if rehash {
		if hash, err := HashPassword(password); err == nil {
			_, _ = s.db.Exec(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, hash, nowISO(), user.ID)
		}
	}
	return s.issueTokens(ctx, user, "", userAgent)
}

// Refresh 轮换令牌：JWT 模式用 refreshToken，session 模式用 Bearer 会话令牌。
func (s *Service) Refresh(ctx context.Context, refreshToken, sessionToken, userAgent string) (map[string]any, error) {
	if s.mode == TokenModeSession {
		if sessionToken == "" {
			return nil, Unauthorized("缺少会话令牌")
		}
		var userID, expiresAt string
		var revoked sql.NullString
		err := s.db.QueryRow(`SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE token_hash = ?`, tokenHash(sessionToken)).Scan(&userID, &expiresAt, &revoked)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, Unauthorized("")
		}
		if err != nil {
			return nil, err
		}
		if revoked.Valid || expiresAt <= nowISO() {
			return nil, Unauthorized("")
		}
		user, err := s.findUserByID(ctx, userID)
		if err != nil || user == nil || user.Status != "active" {
			return nil, Unauthorized("")
		}
		if _, err := s.db.Exec(`UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, nowISO(), tokenHash(sessionToken)); err != nil {
			return nil, err
		}
		return s.issueTokens(ctx, user, "", userAgent)
	}

	if refreshToken == "" {
		return nil, Unauthorized("缺少刷新令牌")
	}
	var userID, familyID, expiresAt string
	var revoked sql.NullString
	err := s.db.QueryRow(`SELECT user_id, family_id, expires_at, revoked_at FROM auth_refresh_tokens WHERE token_hash = ?`, tokenHash(refreshToken)).Scan(&userID, &familyID, &expiresAt, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, Unauthorized("")
	}
	if err != nil {
		return nil, err
	}
	if revoked.Valid || expiresAt <= nowISO() {
		return nil, Unauthorized("")
	}
	user, err := s.findUserByID(ctx, userID)
	if err != nil || user == nil || user.Status != "active" {
		return nil, Unauthorized("")
	}
	if _, err := s.db.Exec(`UPDATE auth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, nowISO(), tokenHash(refreshToken)); err != nil {
		return nil, err
	}
	return s.issueTokens(ctx, user, familyID, userAgent)
}

// Logout 撤销当前会话 / 刷新令牌；JWT 模式不传 refreshToken 时撤销该用户全部刷新令牌。
func (s *Service) Logout(ctx context.Context, current *Context, refreshToken string) (int64, error) {
	if s.mode == TokenModeSession {
		result, err := s.db.Exec(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, nowISO(), current.UserID)
		if err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		return affected, nil
	}
	if refreshToken != "" {
		result, err := s.db.Exec(`UPDATE auth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, nowISO(), tokenHash(refreshToken))
		if err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		return affected, nil
	}
	result, err := s.db.Exec(`UPDATE auth_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, nowISO(), current.UserID)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

// Authenticate 解析 Bearer 令牌并加载用户、角色与权限点。
func (s *Service) Authenticate(ctx context.Context, r *http.Request) (*Context, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return nil, Unauthorized("缺少 Authorization: Bearer 令牌")
	}
	token := strings.TrimSpace(header[len("Bearer "):])
	if token == "" {
		return nil, Unauthorized("缺少 Authorization: Bearer 令牌")
	}

	var user *userRow
	tokenHashValue := ""
	if s.mode == TokenModeSession {
		tokenHashValue = tokenHash(token)
		var userID, expiresAt string
		var revoked sql.NullString
		err := s.db.QueryRow(`SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE token_hash = ?`, tokenHashValue).Scan(&userID, &expiresAt, &revoked)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, Unauthorized("")
		}
		if err != nil {
			return nil, err
		}
		if revoked.Valid || expiresAt <= nowISO() {
			return nil, Unauthorized("")
		}
		user, err = s.findUserByID(ctx, userID)
		if err != nil {
			return nil, err
		}
	} else {
		claims, err := s.verifyJWT(token)
		if err != nil {
			return nil, Unauthorized("")
		}
		user, err = s.findUserByID(ctx, claims.Subject)
		if err != nil {
			return nil, err
		}
	}
	if user == nil || user.Status != "active" {
		return nil, Unauthorized("")
	}
	roles, err := s.loadRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	permissions, err := s.loadPermissions(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &Context{
		UserID:      user.ID,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		Status:      user.Status,
		Roles:       roles,
		Permissions: permissions,
		TokenMode:   s.mode,
		TokenHash:   tokenHashValue,
	}, nil
}

// RequirePermission 校验权限点；缺权限返回 403。
func (s *Service) RequirePermission(ctx *Context, code string) error {
	for _, item := range ctx.Permissions {
		if item == code {
			return nil
		}
	}
	return Forbidden("")
}

// ListUsers 返回最小用户列表（不含密码哈希）。
func (s *Service) ListUsers(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT id, username, display_name, status, created_at FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, username, displayName, status, createdAt string
		if err := rows.Scan(&id, &username, &displayName, &status, &createdAt); err != nil {
			return nil, err
		}
		roles, err := s.loadRoles(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id":          id,
			"username":    username,
			"displayName": displayName,
			"status":      status,
			"createdAt":   createdAt,
			"roles":       roles,
		})
	}
	return out, rows.Err()
}

// Bootstrap 按配置创建首个管理员；已存在或未配置时跳过。
func (s *Service) Bootstrap(ctx context.Context) error {
	name := strings.TrimSpace(s.cfg.Bootstrap.Username)
	password := s.cfg.Bootstrap.Password
	if name == "" || password == "" {
		return nil
	}
	if !usernamePattern.MatchString(name) {
		slog.Warn("[auth] 引导管理员用户名不合法，已跳过创建")
		return nil
	}
	existing, err := s.findUserByUsername(ctx, name)
	if err != nil {
		return err
	}
	if existing != nil {
		slog.Info("[auth] 引导管理员已存在，跳过", "username", name)
		return nil
	}
	roleName := s.cfg.Bootstrap.Role
	if roleName == "" {
		roleName = "admin"
	}
	roleID, err := s.roleID(ctx, roleName)
	if err != nil {
		return err
	}
	if roleID == "" {
		slog.Warn("[auth] 引导角色不存在，已跳过创建", "role", roleName)
		return nil
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	userID, err := randomID()
	if err != nil {
		return err
	}
	now := nowISO()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := execTx(tx, s.db.Driver, `INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, name, hash, name, "active", now, now); err != nil {
		return err
	}
	if err := execTx(tx, s.db.Driver, `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, userID, roleID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	slog.Info("[auth] 已创建引导用户", "username", name, "role", roleName)
	return nil
}

// ---------------------------------------------------------------- 失败计数

func (s *Service) assertNotLocked(ctx context.Context, identifier string) error {
	var failures int
	var windowStarted string
	var lockedUntil sql.NullString
	err := s.db.QueryRow(`SELECT failures, window_started_at, locked_until FROM auth_login_attempts WHERE identifier = ?`, identifier).
		Scan(&failures, &windowStarted, &lockedUntil)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	now := nowISO()
	if lockedUntil.Valid && lockedUntil.String > now {
		return rateLimited()
	}
	windowCutoff := time.Now().UTC().Add(-time.Duration(s.cfg.FailureWindowSeconds) * time.Second).Format(timeFormat)
	if (lockedUntil.Valid && lockedUntil.String <= now) || windowStarted <= windowCutoff {
		_, err := s.db.Exec(`DELETE FROM auth_login_attempts WHERE identifier = ?`, identifier)
		return err
	}
	return nil
}

func (s *Service) recordFailure(ctx context.Context, identifier string) error {
	var failures int
	var windowStarted string
	var lockedUntil sql.NullString
	err := s.db.QueryRow(`SELECT failures, window_started_at, locked_until FROM auth_login_attempts WHERE identifier = ?`, identifier).
		Scan(&failures, &windowStarted, &lockedUntil)
	inWindow := false
	if err == nil {
		cutoff := time.Now().UTC().Add(-time.Duration(s.cfg.FailureWindowSeconds) * time.Second).Format(timeFormat)
		inWindow = windowStarted > cutoff
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if !inWindow {
		failures = 0
		windowStarted = nowISO()
	}
	failures++
	var lock any
	if failures >= s.cfg.MaxLoginFailures {
		lock = laterISO(s.cfg.LockSeconds)
	}
	if errors.Is(err, sql.ErrNoRows) {
		_, err = s.db.Exec(`INSERT INTO auth_login_attempts (identifier, failures, window_started_at, locked_until) VALUES (?, ?, ?, ?)`,
			identifier, failures, windowStarted, lock)
		return err
	}
	_, err = s.db.Exec(`UPDATE auth_login_attempts SET failures = ?, window_started_at = ?, locked_until = ? WHERE identifier = ?`,
		failures, windowStarted, lock, identifier)
	return err
}

func (s *Service) clearFailures(ctx context.Context, identifier string) error {
	_, err := s.db.Exec(`DELETE FROM auth_login_attempts WHERE identifier = ?`, identifier)
	return err
}

// ---------------------------------------------------------------- 小工具

func exec(ctx context.Context, handle *db.Handle, query string, args ...any) error {
	_, err := handle.Exec(query, args...)
	return err
}

func execTx(tx *sql.Tx, driver, query string, args ...any) error {
	_, err := tx.Exec(db.RewriteQuery(driver, query), args...)
	return err
}

func nowISO() string {
	return time.Now().UTC().Format(timeFormat)
}

func laterISO(seconds int) string {
	return time.Now().UTC().Add(time.Duration(seconds) * time.Second).Format(timeFormat)
}

func truncate(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	runes := []rune(text)
	return string(runes[:limit])
}

func validateCredentials(username, password, displayName string) error {
	if !usernamePattern.MatchString(username) {
		return invalidArgument("用户名需为 3-32 位字母、数字、下划线、点或短横线", "username")
	}
	if len(password) < 8 || len(password) > 128 {
		return invalidArgument("密码长度需为 8-128 位", "password")
	}
	if utf8.RuneCountInString(displayName) > 64 {
		return invalidArgument("displayName 最多 64 个字符", "displayName")
	}
	return nil
}

func validateLogin(username, password string) error {
	if strings.TrimSpace(username) == "" || len(username) > 64 {
		return invalidArgument("username 不能为空且最多 64 个字符", "username")
	}
	if len(password) > 128 {
		return invalidArgument("password 最多 128 个字符", "password")
	}
	return nil
}
