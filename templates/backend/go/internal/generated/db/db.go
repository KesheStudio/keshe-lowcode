// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 数据库连接（SQLite / MySQL / PostgreSQL）与可重复执行的迁移 runner。
// 迁移文件在 migrations/generated 与 migrations/custom 两个目录，回滚文件在 migrations/down。
package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/lib/pq"
	_ "modernc.org/sqlite"

	"lowcode/server/internal/generated/config"
)

const (
	DriverSQLite   = "sqlite"
	DriverMySQL    = "mysql"
	DriverPostgres = "postgres"
)

// Handle 包一层 *sql.DB：统一把 `?` 占位符按方言改写（PostgreSQL 用 $1..$n），用户区照常写 `?`。
type Handle struct {
	*sql.DB
	Driver string
}

// UnavailableError 是所有连接类失败的统一错误；错误文本不含账号密码。
type UnavailableError struct {
	Driver string
	Target string
	Reason string
	Hints  []string
}

func (e *UnavailableError) Error() string {
	return fmt.Sprintf("数据库不可用（driver=%s，target=%s）：%s", e.Driver, e.Target, e.Reason)
}

// Connect 打开数据库、探测连通性，然后执行所有未应用的迁移（服务启动路径）。
func Connect(cfg config.Config) (*Handle, error) {
	handle, err := Open(cfg)
	if err != nil {
		return nil, err
	}
	if _, err := handle.MigrateUp(); err != nil {
		_ = handle.Close()
		return nil, err
	}
	return handle, nil
}

// Open 只打开数据库并做连通性探测，不跑迁移（CLI 的迁移命令需要自己控制顺序）。
func Open(cfg config.Config) (*Handle, error) {
	spec, err := resolveSpec(cfg)
	if err != nil {
		return nil, err
	}

	handle, err := sql.Open(driverName(spec.Driver), spec.DSN)
	if err != nil {
		return nil, classifyUnavailable(spec.Driver, spec.Target, err)
	}

	maxOpen := cfg.Database.MaxOpenConns
	if maxOpen < 1 {
		maxOpen = 1
	}
	if spec.Driver == DriverSQLite && spec.Memory {
		maxOpen = 1
	}
	handle.SetMaxOpenConns(maxOpen)

	if spec.Driver == DriverSQLite {
		if _, err := handle.Exec("PRAGMA busy_timeout = 5000"); err != nil {
			_ = handle.Close()
			return nil, classifyUnavailable(spec.Driver, spec.Target, err)
		}
		if !spec.Memory {
			if _, err := handle.Exec("PRAGMA journal_mode = WAL"); err != nil {
				_ = handle.Close()
				return nil, classifyUnavailable(spec.Driver, spec.Target, err)
			}
		}
	}

	timeout := time.Duration(cfg.Database.ConnectTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := handle.PingContext(ctx); err != nil {
		_ = handle.Close()
		return nil, classifyUnavailable(spec.Driver, spec.Target, err)
	}

	return &Handle{DB: handle, Driver: spec.Driver}, nil
}

type spec struct {
	Driver string
	DSN    string
	Target string
	Memory bool
}

func resolveSpec(cfg config.Config) (spec, error) {
	rawURL := strings.TrimSpace(cfg.Database.URL)
	driver := cfg.Database.Driver
	if rawURL != "" {
		driver = driverFromURL(rawURL)
	}
	switch driver {
	case DriverSQLite:
		return sqliteSpec(cfg)
	case DriverMySQL:
		return mysqlSpec(cfg)
	case DriverPostgres:
		return postgresSpec(cfg)
	default:
		return spec{}, fmt.Errorf("不支持的 database.driver：%s", driver)
	}
}

func driverFromURL(raw string) string {
	switch {
	case strings.HasPrefix(raw, "sqlite://"):
		return DriverSQLite
	case strings.HasPrefix(raw, "mysql://"):
		return DriverMySQL
	case strings.HasPrefix(raw, "postgres://"), strings.HasPrefix(raw, "postgresql://"):
		return DriverPostgres
	default:
		return ""
	}
}

func driverName(driver string) string {
	if driver == DriverPostgres {
		return "postgres"
	}
	return driver
}

func sqliteSpec(cfg config.Config) (spec, error) {
	raw := strings.TrimSpace(cfg.Database.URL)
	if raw != "" {
		if !strings.HasPrefix(raw, "sqlite://") {
			return spec{}, fmt.Errorf("database.url 与 driver=sqlite 不匹配")
		}
		raw = strings.TrimSpace(strings.TrimPrefix(raw, "sqlite://"))
	}
	if raw == "" {
		name := strings.TrimSpace(cfg.Database.Name)
		if name == "" {
			name = "app"
		}
		raw = filepath.Join("data", name+".db")
	}
	if raw == "" {
		return spec{}, fmt.Errorf("database.url 缺少 SQLite 文件路径")
	}

	dsn := raw
	memory := raw == ":memory:" || raw == "file::memory:" || strings.HasPrefix(raw, "file::memory:?")
	if memory {
		dsn = "file::memory:?cache=shared"
	} else if dir := filepath.Dir(raw); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return spec{}, fmt.Errorf("创建 SQLite 数据目录失败：%w", err)
		}
	}

	return spec{Driver: DriverSQLite, DSN: dsn, Target: raw, Memory: memory}, nil
}

func mysqlSpec(cfg config.Config) (spec, error) {
	host := strings.TrimSpace(cfg.Database.Host)
	port := cfg.Database.Port
	name := strings.TrimSpace(cfg.Database.Name)
	user := cfg.Database.User
	password := cfg.Database.Password

	if raw := strings.TrimSpace(cfg.Database.URL); raw != "" {
		parsed, err := url.Parse(raw)
		if err != nil {
			return spec{}, fmt.Errorf("database.url 不是合法 URL：%w", err)
		}
		if parsed.Hostname() != "" {
			host = parsed.Hostname()
		}
		if parsed.Port() != "" {
			if value, err := strconv.Atoi(parsed.Port()); err == nil {
				port = value
			}
		}
		if info := parsed.User; info != nil {
			user = info.Username()
			if pass, ok := info.Password(); ok {
				password = pass
			} else if cfg.Database.Password != "" {
				// URL 里不写密码时，允许用 LC_DB_PASSWORD / database.password 注入。
				password = cfg.Database.Password
			}
		}
		if value := strings.TrimPrefix(parsed.Path, "/"); value != "" {
			name = value
		}
	}

	if host == "" {
		host = "127.0.0.1"
	}
	if port == 0 {
		port = 3306
	}
	if name == "" {
		return spec{}, fmt.Errorf("database.name 不能为空（MySQL 需要目标库名）")
	}

	timeout := time.Duration(cfg.Database.ConnectTimeoutSeconds) * time.Second
	my := mysql.NewConfig()
	my.User = user
	my.Passwd = password
	my.Net = "tcp"
	my.Addr = net.JoinHostPort(host, strconv.Itoa(port))
	my.DBName = name
	my.ParseTime = false
	my.Timeout = timeout
	my.ReadTimeout = timeout
	my.WriteTimeout = timeout
	my.Params = map[string]string{"charset": "utf8mb4"}
	if cfg.Database.SSLMode == "require" {
		my.TLSConfig = "skip-verify"
	} else {
		my.TLSConfig = "false"
	}

	addr := my.Addr
	return spec{Driver: DriverMySQL, DSN: my.FormatDSN(), Target: addr + "/" + name}, nil
}

func postgresSpec(cfg config.Config) (spec, error) {
	var target *url.URL
	if raw := strings.TrimSpace(cfg.Database.URL); raw != "" {
		parsed, err := url.Parse(raw)
		if err != nil {
			return spec{}, fmt.Errorf("database.url 不是合法 URL：%w", err)
		}
		if parsed.Scheme == "postgresql" {
			parsed.Scheme = DriverPostgres
		}
		if info := parsed.User; info != nil {
			if _, hasPassword := info.Password(); !hasPassword && cfg.Database.Password != "" {
				// URL 里不写密码时，允许用 LC_DB_PASSWORD / database.password 注入。
				parsed.User = url.UserPassword(info.Username(), cfg.Database.Password)
			}
		}
		target = parsed
	} else {
		host := strings.TrimSpace(cfg.Database.Host)
		if host == "" {
			host = "127.0.0.1"
		}
		port := cfg.Database.Port
		if port == 0 {
			port = 5432
		}
		name := strings.TrimSpace(cfg.Database.Name)
		if name == "" {
			name = "app"
		}
		target = &url.URL{
			Scheme: DriverPostgres,
			Host:   net.JoinHostPort(host, strconv.Itoa(port)),
			Path:   "/" + name,
		}
		if cfg.Database.User != "" {
			target.User = url.UserPassword(cfg.Database.User, cfg.Database.Password)
		} else if cfg.Database.Password != "" {
			target.User = url.User(cfg.Database.Password)
		}
	}

	query := target.Query()
	if query.Get("sslmode") == "" {
		query.Set("sslmode", cfg.Database.SSLMode)
	}
	if query.Get("connect_timeout") == "" {
		query.Set("connect_timeout", strconv.Itoa(cfg.Database.ConnectTimeoutSeconds))
	}
	target.RawQuery = query.Encode()

	targetText := target.Host + target.Path
	if targetText == "" {
		targetText = "postgres"
	}
	return spec{Driver: DriverPostgres, DSN: target.String(), Target: targetText}, nil
}

// ---------------------------------------------------------------- 错误映射

func classifyUnavailable(driver, target string, err error) error {
	return &UnavailableError{
		Driver: driver,
		Target: target,
		Reason: reasonFor(driver, err),
		Hints:  hintsFor(driver),
	}
}

func reasonFor(driver string, err error) string {
	var myErr *mysql.MySQLError
	if errors.As(err, &myErr) {
		switch myErr.Number {
		case 1049:
			return "目标数据库不存在（MySQL 1049）"
		case 1045:
			return "账号或密码不正确，或该账号无权访问目标库（MySQL 1045）"
		case 1044:
			return "账号无权访问目标数据库（MySQL 1044）"
		case 2002, 2003:
			return "无法建立连接，数据库服务可能未启动或端口不通（MySQL " + strconv.Itoa(int(myErr.Number)) + "）"
		case 2005:
			return "主机名无法解析，请检查 host（MySQL 2005）"
		case 2013:
			return "连接在握手阶段中断（MySQL 2013）"
		}
	}

	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		switch string(pqErr.Code) {
		case "3D000":
			return "目标数据库不存在（PostgreSQL 3D000）"
		case "28P01", "28000":
			return "账号或密码不正确，或认证配置不允许该连接（PostgreSQL " + string(pqErr.Code) + "）"
		case "08001", "08006":
			return "无法建立连接，数据库服务可能未启动或端口不通（PostgreSQL " + string(pqErr.Code) + "）"
		case "57P03":
			return "数据库正在启动或暂不接受连接（PostgreSQL 57P03）"
		}
	}

	lower := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lower, "connection refused"), strings.Contains(lower, "refused"),
		strings.Contains(lower, "no connection could be made"), strings.Contains(lower, "actively refused"):
		return "连接被拒绝，数据库服务可能未启动或端口不匹配"
	case strings.Contains(lower, "no such host"), strings.Contains(lower, "unknown host"):
		return "主机名无法解析，请检查 host"
	case strings.Contains(lower, "i/o timeout"), strings.Contains(lower, "deadline exceeded"),
		strings.Contains(lower, "timeout"), strings.Contains(lower, "timed out"):
		return "连接超时，请检查网络、防火墙与 connectTimeoutSeconds"
	case strings.Contains(lower, "access denied"), strings.Contains(lower, "authentication failed"),
		strings.Contains(lower, "password authentication"):
		return "账号或密码不正确，或该账号无权访问目标库"
	case strings.Contains(lower, "unknown database"), strings.Contains(lower, "does not exist"):
		return "目标数据库不存在，请先创建数据库"
	case strings.Contains(lower, "unable to open database file"), strings.Contains(lower, "readonly"):
		return "无法打开或写入 SQLite 数据库文件，请检查目录权限"
	case driver == DriverSQLite:
		return "SQLite 数据库初始化失败"
	default:
		return "连接数据库失败"
	}
}

func hintsFor(driver string) []string {
	if driver == DriverSQLite {
		return []string{
			"确认 database.url 指向的文件路径可写，父目录已存在或可自动创建",
			"确认磁盘未满、文件没有被其它进程独占（SQLite 单写多读）",
			"相对路径以启动目录为准，请在模板根目录启动",
			"如使用 :memory:，注意进程重启后数据会丢失",
		}
	}
	return []string{
		"确认数据库服务已启动（systemctl status / docker ps / 服务管理器）",
		"核对 host 与 port（MySQL 默认 3306，PostgreSQL 默认 5432）及防火墙放行",
		"核对账号密码与权限；密码优先用环境变量注入，不要写进配置文件",
		"目标库需先创建（MySQL: CREATE DATABASE；PostgreSQL: createdb）",
		"若服务器要求加密，把 database.sslMode 改为 require，并确认证书链可被信任",
	}
}

// ---------------------------------------------------------------- 占位符

// RewriteQuery 把 `?` 顺序替换成 PostgreSQL 的 $1..$n；引号内的问号不替换。
func RewriteQuery(driver, query string) string {
	if driver != DriverPostgres {
		return query
	}
	var out strings.Builder
	out.Grow(len(query) + 8)
	counter := 0
	inSingle := false
	inDouble := false
	for i := 0; i < len(query); i++ {
		ch := query[i]
		switch {
		case inSingle:
			out.WriteByte(ch)
			if ch == '\'' {
				if i+1 < len(query) && query[i+1] == '\'' {
					i++
					out.WriteByte(query[i])
				} else {
					inSingle = false
				}
			}
		case inDouble:
			out.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(query) && query[i+1] == '"' {
					i++
					out.WriteByte(query[i])
				} else {
					inDouble = false
				}
			}
		case ch == '\'':
			inSingle = true
			out.WriteByte(ch)
		case ch == '"':
			inDouble = true
			out.WriteByte(ch)
		case ch == '?':
			counter++
			out.WriteString("$")
			out.WriteString(strconv.Itoa(counter))
		default:
			out.WriteByte(ch)
		}
	}
	return out.String()
}

// Query / QueryRow / Exec 统一走占位符改写；不做改写的调用可直接用内嵌的 *sql.DB。
func (h *Handle) Query(query string, args ...any) (*sql.Rows, error) {
	return h.DB.Query(RewriteQuery(h.Driver, query), args...)
}

func (h *Handle) QueryRow(query string, args ...any) *sql.Row {
	return h.DB.QueryRow(RewriteQuery(h.Driver, query), args...)
}

func (h *Handle) Exec(query string, args ...any) (sql.Result, error) {
	return h.DB.Exec(RewriteQuery(h.Driver, query), args...)
}

// ---------------------------------------------------------------- 迁移

type migration struct {
	version string
	path    string
}

func (h *Handle) MigrateUp() ([]string, error) {
	if err := h.ensureSchemaTable(); err != nil {
		return nil, err
	}
	applied, err := h.appliedVersions()
	if err != nil {
		return nil, err
	}
	files, err := collectMigrations()
	if err != nil {
		return nil, err
	}

	var executed []string
	for _, file := range files {
		if applied[file.version] {
			continue
		}
		if err := h.applyUp(file); err != nil {
			return executed, err
		}
		executed = append(executed, file.version)
	}
	return executed, nil
}

// MigrateDown 回滚最新一个有对应 down 文件的已应用版本；返回被回滚的版本。
func (h *Handle) MigrateDown() (string, bool, error) {
	if err := h.ensureSchemaTable(); err != nil {
		return "", false, err
	}
	versions, err := h.appliedVersionsOrdered()
	if err != nil {
		return "", false, err
	}
	for _, version := range versions {
		path := filepath.Join("migrations", "down", filepath.Base(version))
		if _, err := os.Stat(path); err != nil {
			continue
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return "", false, fmt.Errorf("读取回滚文件失败 %s：%w", path, err)
		}
		if err := h.applyDown(version, body); err != nil {
			return "", false, err
		}
		return version, true, nil
	}
	return "", false, nil
}

func (h *Handle) ensureSchemaTable() error {
	if _, err := h.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)`); err != nil {
		return fmt.Errorf("创建 schema_migrations 表失败：%w", err)
	}
	return nil
}

func (h *Handle) appliedVersions() (map[string]bool, error) {
	rows, err := h.DB.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("读取迁移记录失败：%w", err)
	}
	defer rows.Close()

	applied := map[string]bool{}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("读取迁移记录失败：%w", err)
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("读取迁移记录失败：%w", err)
	}
	return applied, nil
}

func (h *Handle) appliedVersionsOrdered() ([]string, error) {
	rows, err := h.DB.Query(`SELECT version FROM schema_migrations ORDER BY applied_at DESC, version DESC`)
	if err != nil {
		return nil, fmt.Errorf("读取迁移记录失败：%w", err)
	}
	defer rows.Close()

	var versions []string
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("读取迁移记录失败：%w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("读取迁移记录失败：%w", err)
	}
	return versions, nil
}

func collectMigrations() ([]migration, error) {
	root := "migrations"
	if _, err := os.Stat(root); err != nil {
		return nil, fmt.Errorf("找不到 migrations 目录：请在本模板目录启动服务")
	}
	var out []migration
	for _, zone := range []string{"generated", "custom"} {
		dir := filepath.Join(root, zone)
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("读取迁移目录失败 %s：%w", dir, err)
		}
		var names []string
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
				continue
			}
			names = append(names, entry.Name())
		}
		sort.Strings(names)
		for _, name := range names {
			out = append(out, migration{version: zone + "/" + name, path: filepath.Join(dir, name)})
		}
	}
	return out, nil
}

func (h *Handle) applyUp(file migration) error {
	body, err := os.ReadFile(file.path)
	if err != nil {
		return fmt.Errorf("读取迁移文件失败 %s：%w", file.path, err)
	}

	tx, err := h.DB.Begin()
	if err != nil {
		return fmt.Errorf("开启迁移事务失败：%w", err)
	}
	for _, statement := range splitStatements(string(body)) {
		if _, err := tx.Exec(RewriteQuery(h.Driver, statement)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("迁移 %s 执行失败：%w", file.version, err)
		}
	}
	if _, err := tx.Exec(RewriteQuery(h.Driver, `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`), file.version, nowISO()); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("记录迁移失败：%w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交迁移失败：%w", err)
	}
	return nil
}

func (h *Handle) applyDown(version string, body []byte) error {
	tx, err := h.DB.Begin()
	if err != nil {
		return fmt.Errorf("开启回滚事务失败：%w", err)
	}
	for _, statement := range splitStatements(string(body)) {
		if _, err := tx.Exec(RewriteQuery(h.Driver, statement)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("回滚 %s 执行失败：%w", version, err)
		}
	}
	if _, err := tx.Exec(RewriteQuery(h.Driver, `DELETE FROM schema_migrations WHERE version = ?`), version); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("删除迁移记录失败：%w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交回滚失败：%w", err)
	}
	return nil
}

func splitStatements(sqlText string) []string {
	body := strings.TrimPrefix(sqlText, "\ufeff")
	var out []string
	for _, part := range strings.Split(body, ";") {
		statement := strings.TrimSpace(part)
		if statement == "" {
			continue
		}
		onlyComments := true
		for _, line := range strings.Split(statement, "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "--") {
				onlyComments = false
				break
			}
		}
		if onlyComments {
			continue
		}
		out = append(out, statement)
	}
	return out
}

func nowISO() string {
	// UTC + 纳秒精度，长度 ≤30，能放进 VARCHAR(32)，也让 applied_at 排序更可靠。
	return time.Now().UTC().Format(time.RFC3339Nano)
}
