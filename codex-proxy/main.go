package main

import (
	"bufio"

	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		if ctx.Err() != nil {
			return
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() > 0 {
			fmt.Fprintln(os.Stderr, "codex-proxy:", err)
			os.Exit(exit.ExitCode())
		}
		fmt.Fprintln(os.Stderr, "codex-proxy:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	codex, err := findCodex()
	if err != nil {
		return err
	}
	if !bridgesStdio(args) {
		cmd := exec.CommandContext(ctx, codex, args...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		return cmd.Run()
	}

	dir, err := makeSocketDir(os.Getenv("CODEX_PROXY_SOCKET_DIR"))
	if err != nil {
		return fmt.Errorf("create socket directory: %w", err)
	}
	path := filepath.Join(dir, "app.sock")
	defer func() {
		os.Remove(path)
		os.Remove(dir)
	}()

	serverCtx, stopServer := context.WithCancel(ctx)
	cmd := exec.CommandContext(serverCtx, codex, append(args, "--listen", "unix://"+path)...)
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Start(); err != nil {
		stopServer()
		return fmt.Errorf("start Codex app-server: %w", err)
	}
	done := make(chan struct{})
	var serverErr error
	go func() {
		serverErr = cmd.Wait()
		close(done)
	}()
	defer func() {
		stopServer()
		<-done
	}()

	sessionCtx, stopSession := context.WithCancel(ctx)
	defer stopSession()
	go func() {
		select {
		case <-done:
			stopSession()
		case <-sessionCtx.Done():
		}
	}()

	startupCtx, cancelStartup := context.WithTimeout(sessionCtx, 15*time.Second)
	conn, err := waitForSocket(startupCtx, path)
	cancelStartup()
	if err == nil {
		defer conn.CloseNow()
		fmt.Fprintln(os.Stderr, "codex-proxy: listening at unix://"+path)
		err = bridge(sessionCtx, conn, os.Stdin, os.Stdout)
	} else {
		err = fmt.Errorf("connect to Codex app-server at %s: %w", path, err)
	}
	select {
	case <-done:
		if serverErr != nil {
			return fmt.Errorf("Codex app-server: %w", serverErr)
		}
		if err != nil && errors.Is(err, context.Canceled) && ctx.Err() == nil {
			return errors.New("Codex app-server exited before the proxy session could continue")
		}
	default:
	}
	return err
}

func findCodex() (string, error) {
	name := os.Getenv("CODEX_PROXY_REAL_CODEX")
	if name == "" {
		name = "codex"
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("find real Codex CLI (set CODEX_PROXY_REAL_CODEX): %w", err)
	}
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	selfInfo, err := os.Stat(self)
	if err != nil {
		return "", err
	}
	codexInfo, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if os.SameFile(selfInfo, codexInfo) {
		return "", errors.New("CODEX_PROXY_REAL_CODEX resolves to the proxy itself")
	}
	return path, nil
}

func bridgesStdio(args []string) bool {
	appServer := false
	for i := 0; i < len(args); i++ {
		arg, _, hasValue := strings.Cut(args[i], "=")
		switch arg {
		case "-c", "--config", "-p", "--profile", "--enable", "--disable",
			"--startup-client-info", "--cloud-skills-snapshot", "--code-mode-host":
			if !hasValue {
				i++
			}
		case "app-server":
			if appServer {
				return false
			}
			appServer = true
		case "--analytics-default-enabled", "--startup-sign-out", "--strict-config":
		case "--stdio":
			// The CLI accepts an explicit stdio flag as well as its default.
			// Preserve explicit transport selections by passing the command through.
			return false
		default:
			if !strings.HasPrefix(arg, "-c") || strings.HasPrefix(arg, "--") {
				return false
			}
		}
	}
	return appServer
}

func makeSocketDir(dir string) (string, error) {
	if dir == "" {
		// macOS TMPDIR paths can exceed the Unix socket path length limit.
		return os.MkdirTemp("/tmp", "codex-proxy-")
	}
	if !filepath.IsAbs(dir) {
		return "", errors.New("CODEX_PROXY_SOCKET_DIR must be an absolute path")
	}
	dir = filepath.Clean(dir)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func waitForSocket(ctx context.Context, path string) (*websocket.Conn, error) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", path)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		conn, _, err := websocket.Dial(ctx, "ws://localhost/", &websocket.DialOptions{HTTPClient: client})
		if err == nil {
			return conn, nil
		}
		if !errors.Is(err, syscall.ENOENT) && !errors.Is(err, syscall.ECONNREFUSED) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func bridge(ctx context.Context, conn *websocket.Conn, input io.Reader, output io.Writer) error {
	const maxMessageSize = 128 << 20
	conn.SetReadLimit(maxMessageSize)
	done := make(chan error, 2)
	go func() { done <- sendStdin(ctx, conn, input, maxMessageSize) }()
	go func() { done <- receiveStdout(ctx, conn, output) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func sendStdin(ctx context.Context, conn *websocket.Conn, input io.Reader, limit int) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64<<10), limit)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		if err := conn.Write(ctx, websocket.MessageText, line); err != nil {
			return fmt.Errorf("forward stdin: %w", err)
		}
	}
	return scanner.Err()
}

func receiveStdout(ctx context.Context, conn *websocket.Conn, output io.Writer) error {
	for {
		kind, message, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				return nil
			}
			return fmt.Errorf("read app-server message: %w", err)
		}
		if kind != websocket.MessageText {
			return errors.New("app-server returned a non-text WebSocket message")
		}
		if _, err := output.Write(append(message, '\n')); err != nil {
			return fmt.Errorf("write stdout: %w", err)
		}
	}
}
