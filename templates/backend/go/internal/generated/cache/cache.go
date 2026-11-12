// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 可选缓存：none / memory / redis。redis 用标准库 net 手写最小 RESP2 客户端。
// Redis 不可用时打印一条 warn 并降级为进程内存，服务必须照常启动。
package cache

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"lowcode/server/internal/generated/config"
)

// Cache 是缓存最小接口；Get 未命中或缓存不可用时返回 (nil, false)，不向外抛错。
type Cache interface {
	Get(key string) ([]byte, bool)
	Set(key string, value []byte, ttl time.Duration) error
	Del(key string) error
	Ping() error
	Close() error
}

// Result 描述实际生效的缓存，用于 /api/health 与 /api/meta。
type Result struct {
	Cache    Cache
	Driver   string // none / memory / redis，实际生效值
	Fallback bool   // 缓存关闭或 driver=redis 但连接失败时为 true
	Warning  string // 降级原因，已脱敏，可直接写日志
}

// Open 按配置打开缓存。缓存关闭或 Redis 故障都按 cache.fallback 回退，而不是阻断启动。
func Open(cfg config.Cache, timeout time.Duration) Result {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	fail := func(reason string) Result {
		if configFallback(cfg.Fallback) == "none" {
			return Result{
				Cache:    &noopCache{},
				Driver:   "none",
				Fallback: true,
				Warning:  reason + "，已回退为无缓存（cache.fallback=none）",
			}
		}
		return Result{
			Cache:    newMemoryCache(),
			Driver:   "memory",
			Fallback: true,
			Warning:  reason + "，已回退为进程内存缓存（cache.fallback=memory）",
		}
	}
	if !cfg.Enabled {
		return fail("缓存已关闭")
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Driver)) {
	case "none":
		return Result{Cache: &noopCache{}, Driver: "none"}
	case "redis":
		client, err := newRedisCache(cfg.URL, cfg.Password, timeout)
		if err != nil {
			return fail("Redis 不可用（" + sanitizeRedisURL(cfg.URL) + "）：" + err.Error())
		}
		return Result{Cache: client, Driver: "redis"}
	default:
		return Result{Cache: newMemoryCache(), Driver: "memory"}
	}
}

func configFallback(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "none") {
		return "none"
	}
	return "memory"
}

func sanitizeRedisURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "redis://<配置无效>"
	}
	path := parsed.Path
	if path == "" {
		path = "/0"
	}
	return "redis://" + parsed.Host + path
}

// ---------------------------------------------------------------- none

type noopCache struct{}

func (n *noopCache) Get(string) ([]byte, bool)               { return nil, false }
func (n *noopCache) Set(string, []byte, time.Duration) error { return nil }
func (n *noopCache) Del(string) error                        { return nil }
func (n *noopCache) Ping() error                             { return nil }
func (n *noopCache) Close() error                            { return nil }

// ---------------------------------------------------------------- memory

type memoryCache struct {
	mu    sync.Mutex
	items map[string]memoryEntry
}

type memoryEntry struct {
	value     []byte
	expiresAt time.Time
}

func newMemoryCache() Cache {
	return &memoryCache{items: map[string]memoryEntry{}}
}

func (m *memoryCache) Get(key string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.items[key]
	if !ok {
		return nil, false
	}
	if !entry.expiresAt.IsZero() && time.Now().After(entry.expiresAt) {
		delete(m.items, key)
		return nil, false
	}
	return append([]byte(nil), entry.value...), true
}

func (m *memoryCache) Set(key string, value []byte, ttl time.Duration) error {
	entry := memoryEntry{value: append([]byte(nil), value...)}
	if ttl > 0 {
		entry.expiresAt = time.Now().Add(ttl)
	}
	m.mu.Lock()
	m.items[key] = entry
	m.mu.Unlock()
	return nil
}

func (m *memoryCache) Del(key string) error {
	m.mu.Lock()
	delete(m.items, key)
	m.mu.Unlock()
	return nil
}

func (m *memoryCache) Ping() error { return nil }

func (m *memoryCache) Close() error {
	m.mu.Lock()
	m.items = map[string]memoryEntry{}
	m.mu.Unlock()
	return nil
}

// ---------------------------------------------------------------- redis（RESP2）

type redisCache struct {
	mu       sync.Mutex
	addr     string
	password string
	database int
	timeout  time.Duration
	conn     net.Conn
	reader   *bufio.Reader
}

func newRedisCache(raw, explicitPassword string, timeout time.Duration) (*redisCache, error) {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "rediss://") {
		return nil, fmt.Errorf("暂不支持 rediss://（只支持明文 redis://）")
	}
	if !strings.HasPrefix(trimmed, "redis://") {
		return nil, fmt.Errorf("cache.url 必须以 redis:// 开头")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("cache.url 不是合法 URL")
	}

	addr := parsed.Host
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	if _, _, err := net.SplitHostPort(addr); err != nil {
		addr = net.JoinHostPort(addr, "6379")
	}

	database := 0
	if path := strings.TrimPrefix(parsed.Path, "/"); path != "" {
		if value, err := strconv.Atoi(path); err == nil && value >= 0 {
			database = value
		}
	}

	password := strings.TrimSpace(explicitPassword)
	if password == "" {
		if info := parsed.User; info != nil {
			if pass, ok := info.Password(); ok {
				password = pass
			}
		}
	}

	client := &redisCache{addr: addr, password: password, database: database, timeout: timeout}
	if err := client.connect(); err != nil {
		return nil, err
	}
	return client, nil
}

func (r *redisCache) connect() error {
	conn, err := net.DialTimeout("tcp", r.addr, r.timeout)
	if err != nil {
		return fmt.Errorf("连接 Redis 失败：%w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(r.timeout))
	reader := bufio.NewReader(conn)

	if r.password != "" {
		if _, _, err := r.command(conn, reader, "AUTH", r.password); err != nil {
			_ = conn.Close()
			return fmt.Errorf("Redis AUTH 失败：%w", err)
		}
	}
	if r.database > 0 {
		if _, _, err := r.command(conn, reader, "SELECT", strconv.Itoa(r.database)); err != nil {
			_ = conn.Close()
			return fmt.Errorf("Redis SELECT %d 失败：%w", r.database, err)
		}
	}
	if _, _, err := r.command(conn, reader, "PING"); err != nil {
		_ = conn.Close()
		return fmt.Errorf("Redis PING 失败：%w", err)
	}

	r.conn = conn
	r.reader = reader
	return nil
}

func (r *redisCache) ensureConn() error {
	if r.conn != nil {
		return nil
	}
	return r.connect()
}

func (r *redisCache) Get(key string) ([]byte, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ensureConn(); err != nil {
		return nil, false
	}
	kind, value, err := r.command(r.conn, r.reader, "GET", key)
	if err != nil || kind == kindNil {
		return nil, false
	}
	return []byte(value), true
}

func (r *redisCache) Set(key string, value []byte, ttl time.Duration) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ensureConn(); err != nil {
		return err
	}
	if ttl > 0 {
		seconds := int64(ttl.Seconds())
		if seconds < 1 {
			seconds = 1
		}
		_, _, err := r.command(r.conn, r.reader, "SETEX", key, strconv.FormatInt(seconds, 10), string(value))
		return err
	}
	_, _, err := r.command(r.conn, r.reader, "SET", key, string(value))
	return err
}

func (r *redisCache) Del(key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ensureConn(); err != nil {
		return err
	}
	_, _, err := r.command(r.conn, r.reader, "DEL", key)
	return err
}

func (r *redisCache) Ping() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ensureConn(); err != nil {
		return err
	}
	_, _, err := r.command(r.conn, r.reader, "PING")
	return err
}

func (r *redisCache) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn == nil {
		return nil
	}
	err := r.conn.Close()
	r.conn = nil
	r.reader = nil
	return err
}

const (
	kindNil = iota
	kindValue
)

func (r *redisCache) command(conn net.Conn, reader *bufio.Reader, args ...string) (int, string, error) {
	_ = conn.SetDeadline(time.Now().Add(r.timeout))
	if err := writeCommand(conn, args); err != nil {
		_ = conn.Close()
		r.conn = nil
		r.reader = nil
		return kindNil, "", err
	}
	kind, value, err := readReply(reader)
	if err != nil {
		_ = conn.Close()
		r.conn = nil
		r.reader = nil
		return kindNil, "", err
	}
	return kind, value, nil
}

func writeCommand(w io.Writer, args []string) error {
	var builder strings.Builder
	builder.WriteString("*")
	builder.WriteString(strconv.Itoa(len(args)))
	builder.WriteString("\r\n")
	for _, arg := range args {
		builder.WriteString("$")
		builder.WriteString(strconv.Itoa(len(arg)))
		builder.WriteString("\r\n")
		builder.WriteString(arg)
		builder.WriteString("\r\n")
	}
	_, err := io.WriteString(w, builder.String())
	return err
}

func readReply(reader *bufio.Reader) (int, string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return kindNil, "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return kindNil, "", fmt.Errorf("Redis 返回空响应")
	}
	switch line[0] {
	case '+':
		return kindValue, line[1:], nil
	case '-':
		return kindNil, "", fmt.Errorf("Redis 错误：%s", line[1:])
	case ':':
		return kindValue, line[1:], nil
	case '$':
		length, err := strconv.Atoi(line[1:])
		if err != nil {
			return kindNil, "", fmt.Errorf("Redis 响应长度非法")
		}
		if length < 0 {
			return kindNil, "", nil
		}
		buf := make([]byte, length)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return kindNil, "", err
		}
		if _, err := reader.ReadString('\n'); err != nil {
			return kindNil, "", err
		}
		return kindValue, string(buf), nil
	case '*':
		// 只用于容错：数组响应逐项读完，取最后一个文本值。
		count, err := strconv.Atoi(line[1:])
		if err != nil || count < 0 {
			return kindNil, "", nil
		}
		last := kindNil
		value := ""
		for i := 0; i < count; i++ {
			kind, item, err := readReply(reader)
			if err != nil {
				return kindNil, "", err
			}
			last, value = kind, item
		}
		return last, value, nil
	default:
		return kindNil, "", fmt.Errorf("Redis 响应无法识别")
	}
}
