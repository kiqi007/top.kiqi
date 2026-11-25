package windows

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/coder/websocket"
)

type Transport struct {
	Dir, Path string
	listener  listenerAnnouncement
	endpoint  Endpoint
	remove    func()
}

func (t *Transport) Configure(cmd *exec.Cmd) error {
	token, digest, err := newToken()
	if err != nil {
		return err
	}
	t.endpoint.Token = token
	t.listener.port = make(chan int, 1)
	cmd.Args = append(cmd.Args, "--listen", "ws://127.0.0.1:0", "--ws-auth", "capability-token", "--ws-token-sha256", digest)
	cmd.Stderr = io.MultiWriter(os.Stderr, &t.listener)
	return nil
}

func (t *Transport) Connect(ctx context.Context) (*websocket.Conn, error) {
	select {
	case t.endpoint.Port = <-t.listener.port:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	conn, err := t.endpoint.Dial(ctx)
	if err != nil {
		return nil, err
	}
	if t.Path != "" {
		t.remove, err = t.endpoint.serveSocket(t.Path)
	} else {
		t.remove, err = t.endpoint.publish(t.Dir)
	}
	if err != nil {
		conn.CloseNow()
		return nil, fmt.Errorf("publish local Codex connection: %w", err)
	}
	return conn, nil
}

func (t *Transport) Close() {
	if t.remove != nil {
		t.remove()
	}
}

// The app-server selects the port itself. Consume only its startup announcement,
// including when stderr splits the line across multiple writes.
type listenerAnnouncement struct {
	port     chan int
	buf      []byte
	finished bool
}

func (a *listenerAnnouncement) Write(p []byte) (int, error) {
	if a.finished {
		return len(p), nil
	}
	a.buf = append(a.buf, p...)
	for {
		n := bytes.IndexByte(a.buf, '\n')
		if n < 0 {
			break
		}
		line := strings.TrimSpace(string(a.buf[:n]))
		a.buf = a.buf[n+1:]
		if value, ok := strings.CutPrefix(line, "listening on: ws://127.0.0.1:"); ok {
			port, err := strconv.Atoi(value)
			if err == nil && port > 0 && port <= 65535 {
				a.port <- port
				a.finished = true
				a.buf = nil
				break
			}
		}
	}
	if len(a.buf) > 65536 {
		a.buf = nil
	}
	return len(p), nil
}

type Endpoint struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func newToken() (string, string, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(secret[:])
	return token, fmt.Sprintf("%x", sha256.Sum256([]byte(token))), nil
}

func (e Endpoint) Dial(ctx context.Context) (*websocket.Conn, error) {
	client := &http.Client{Transport: &http.Transport{}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	conn, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/", e.Port), &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Authorization": {"Bearer " + e.Token}}})
	return conn, err
}

func (e Endpoint) publish(dir string) (func(), error) {
	if dir == "" {
		cache, err := os.UserCacheDir()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(cache, "dsh-codex", "connections")
	}
	if !filepath.IsAbs(dir) {
		return nil, errors.New("connection directory must be absolute")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(dir, ".pending-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	err = json.NewEncoder(file).Encode(e)
	closeErr := file.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	name := filepath.Join(dir, fmt.Sprintf("desktop-%d.json", os.Getpid()))
	if err = os.Rename(file.Name(), name); err != nil {
		return nil, err
	}
	return func() { os.Remove(name) }, nil
}
