// 示例本地后端（Tauri sidecar）。只用标准库，方便交叉验证「单文件二进制」这条路线。
//
// 约定（外壳侧，见 src-tauri/src/lib.rs）：
//   - 端口由外壳挑好后通过 --port 传入，绝不能写死；绑定失败时退回系统随机端口。
//   - --version 输出纯版本号（不含前缀 v），外壳用它和应用版本比对。
//   - /health 返回 200 + JSON，外壳据此判定就绪；超时则显示失败页。
//   - 只监听 127.0.0.1，不对外暴露。
//   - 数据库密码只从环境变量（默认 LC_DB_PASSWORD）读，绝不打印、不写文件。
//   - stdin 被关闭（外壳崩溃/被杀）时主动退出，避免留下孤儿进程。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// 由构建脚本通过 -ldflags "-X main.version=<应用版本>" 注入，保证与应用版本一致。
var version = "0.1.0"

type fileConfig struct {
	SchemaVersion int    `json:"schemaVersion"`
	Listen        string `json:"listen"`
	Database      struct {
		Host        string `json:"host"`
		Port        int    `json:"port"`
		Name        string `json:"name"`
		User        string `json:"user"`
		PasswordEnv string `json:"passwordEnv"`
	} `json:"database"`
}

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	var (
		port       = flag.Int("port", 0, "监听端口；0 表示由系统分配（外壳正常会传非 0）")
		portFile   = flag.String("port-file", "", "就绪后把实际端口写入该文件（测试与排障用）")
		configPath = flag.String("config", "", "随包的非敏感配置文件路径")
		showVer    = flag.Bool("version", false, "输出版本号后退出")
	)
	flag.Parse()

	if *showVer {
		fmt.Println(version)
		return
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Printf("[sidecar] 配置读取失败：%v", err)
		os.Exit(2)
	}
	passwordEnv := cfg.Database.PasswordEnv
	if passwordEnv == "" {
		passwordEnv = "LC_DB_PASSWORD"
	}
	// 只判断是否存在，绝不打印值。
	dbConfigured := strings.TrimSpace(os.Getenv(passwordEnv)) != ""

	ln, actualPort, err := listen(*port)
	if err != nil {
		if *port != 0 {
			// 外壳挑好端口后瞬间被别的进程抢占：直接失败并退出，
			// 不要偷偷换端口——外壳会按旧端口拼地址，前端拿到的是一个连不上的 URL。
			log.Printf("[sidecar] 端口 %d 绑定失败：%v", *port, err)
			os.Exit(3)
		}
		log.Printf("[sidecar] 无法监听回环地址：%v", err)
		os.Exit(1)
	}

	if *portFile != "" {
		if err := os.MkdirAll(filepath.Dir(*portFile), 0o700); err != nil {
			log.Printf("[sidecar] 创建端口文件目录失败：%v", err)
		} else if err := os.WriteFile(*portFile, []byte(strconv.Itoa(actualPort)+"\n"), 0o600); err != nil {
			log.Printf("[sidecar] 写端口文件失败：%v", err)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "ok",
			"version":      version,
			"pid":          os.Getpid(),
			"dbConfigured": dbConfigured,
		})
	})
	mux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"message":      "hello from sidecar",
			"version":      version,
			"dbConfigured": dbConfigured,
		})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
	})

	srv := &http.Server{Handler: mux}
	done := make(chan struct{})
	// 信号与 stdin 看门狗可能同时触发，shutdown 必须幂等（重复 close(done) 会 panic）。
	var once sync.Once
	shutdown := func(reason string) {
		once.Do(func() {
			log.Printf("[sidecar] 退出：%s", reason)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = srv.Shutdown(ctx)
			close(done)
		})
	}

	// 父进程退出（外壳崩溃、被任务管理器杀掉）后 stdin 会 EOF：这是兜底的孤儿进程清理。
	// 手工在终端里跑时 stdin 是终端，跳过看门狗，避免把终端读空后自己退出。
	if stdinIsPipe() {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			shutdown("stdin 已关闭（父进程退出）")
		}()
	} else {
		log.Printf("[sidecar] stdin 是终端，跳过父进程看门狗（仅手工调试会出现）")
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		s := <-sig
		shutdown(fmt.Sprintf("收到信号 %s", s))
	}()

	log.Printf("[sidecar] version=%s listen=127.0.0.1:%d dbConfigured=%t", version, actualPort, dbConfigured)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Printf("[sidecar] HTTP 服务异常：%v", err)
		os.Exit(1)
	}
	<-done
}

func listen(port int) (net.Listener, int, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, 0, err
	}
	return ln, ln.Addr().(*net.TCPAddr).Port, nil
}

func stdinIsPipe() bool {
	st, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return st.Mode()&os.ModeCharDevice == 0
}

func loadConfig(file string) (*fileConfig, error) {
	cfg := &fileConfig{}
	if file == "" {
		return cfg, nil
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, cfg); err != nil {
		return nil, err
	}
	// 硬要求：随包配置里不能有密码字段。见到就直接拒绝启动，避免把带密码的配置发出去还「看起来能跑」。
	if hasSecretKey(raw) {
		return nil, fmt.Errorf("配置 %s 含疑似密码/密钥字段，已拒绝启动", file)
	}
	return cfg, nil
}

func hasSecretKey(raw []byte) bool {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	for k := range m {
		if secretKey(k) {
			return true
		}
	}
	if db, ok := m["database"].(map[string]any); ok {
		for k := range db {
			if secretKey(k) {
				return true
			}
		}
	}
	return false
}

func secretKey(k string) bool {
	k = strings.ToLower(k)
	for _, bad := range []string{"password", "passwd", "pwd", "secret", "token", "credential", "private"} {
		if strings.Contains(k, bad) && k != "passwordenv" {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
