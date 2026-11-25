package mac

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

type Transport struct {
	Dir, Path  string
	createdDir string
}

func (t *Transport) Configure(cmd *exec.Cmd) error {
	if t.Path == "" {
		dir, err := makeSocketDir(t.Dir)
		if err != nil {
			return fmt.Errorf("create socket directory: %w", err)
		}
		t.createdDir = dir
		t.Path = filepath.Join(dir, "app.sock")
	}
	cmd.Args = append(cmd.Args, "--listen", "unix://"+t.Path)
	return nil
}

func (t *Transport) Connect(ctx context.Context) (*websocket.Conn, error) {
	conn, err := DialSocket(ctx, t.Path)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", t.Path, err)
	}
	fmt.Fprintln(os.Stderr, "codex-proxy: listening at unix://"+t.Path)
	return conn, nil
}

func (t *Transport) Close() {
	if t.createdDir != "" {
		os.Remove(t.Path)
		os.Remove(t.createdDir)
	}
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

func DialSocket(ctx context.Context, path string) (*websocket.Conn, error) {
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
