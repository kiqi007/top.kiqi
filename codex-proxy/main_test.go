package main

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

func TestBridgesStdio(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want bool
	}{
		{[]string{"app-server"}, true},
		{[]string{"-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled"}, true},
		{[]string{"app-server", "-c", `title="daemon"`}, true},
		{[]string{"app-server", "--listen=off"}, false},
		{[]string{"app-server", "--help"}, false},
		{[]string{"app-server", "--print-startup-config"}, false},
		{[]string{"app-server", "daemon", "version"}, false},
		{[]string{"app-server", "generate-json-schema", "--out", "schema"}, false},
		{[]string{"--version"}, false},
		{[]string{"exec", "app-server"}, false},
	} {
		if got := bridgesStdio(tc.args); got != tc.want {
			t.Errorf("bridgesStdio(%q) = %t, want %t", tc.args, got, tc.want)
		}
	}
}

func TestSharedAppServer(t *testing.T) {
	codex := os.Getenv("CODEX_PROXY_TEST_CODEX")
	if codex == "" {
		t.Skip("set CODEX_PROXY_TEST_CODEX to a compatible Codex CLI to run this test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("/tmp", "codex-proxy-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	home := filepath.Join(dir, "home")
	if err := os.Mkdir(home, 0o700); err != nil {
		t.Fatal(err)
	}
	socketDir := filepath.Join(dir, "socket")
	binary := filepath.Join(dir, "codex-proxy")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build helper: %v\n%s", err, output)
	}
	cmd := exec.CommandContext(ctx, binary, "-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled")
	cmd.Env = append(os.Environ(), "CODEX_HOME="+home, "CODEX_PROXY_SOCKET_DIR="+socketDir, "CODEX_PROXY_REAL_CODEX="+codex)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	log, err := os.Create(filepath.Join(dir, "stderr.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	cmd.Stderr = log
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Signal(syscall.SIGTERM)
			_ = cmd.Wait()
		}
		if t.Failed() {
			contents, _ := os.ReadFile(log.Name())
			t.Logf("helper stderr:\n%s", contents)
		}
	}()
	encoder, decoder := json.NewEncoder(stdin), json.NewDecoder(stdout)
	desktop := rpcClient{send: encoder.Encode, read: decoder.Decode}
	initialize := map[string]any{
		"clientInfo":   map[string]string{"name": "codex-proxy-test", "version": "1"},
		"capabilities": map[string]bool{"experimentalApi": true},
	}
	desktop.call(t, 1, "initialize", initialize, nil)
	desktop.notify(t, "initialized")
	var started struct{ Thread struct{ ID string } }
	desktop.call(t, 2, "thread/start", map[string]any{"cwd": dir}, &started)
	if started.Thread.ID == "" {
		t.Fatal("missing thread id")
	}

	conn, err := waitForSocket(ctx, filepath.Join(socketDir, "app.sock"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	external := rpcClient{
		send: func(v any) error { return wsjson.Write(ctx, conn, v) },
		read: func(v any) error { return wsjson.Read(ctx, conn, v) },
	}
	external.call(t, 1, "initialize", initialize, nil)
	external.notify(t, "initialized")
	var loaded struct{ Data []string }
	external.call(t, 2, "thread/loaded/list", struct{}{}, &loaded)
	if !slices.Contains(loaded.Data, started.Thread.ID) {
		t.Fatalf("external client cannot see desktop's loaded thread %q: %v", started.Thread.ID, loaded.Data)
	}
	external.call(t, 3, "thread/name/set", map[string]string{
		"threadId": started.Thread.ID,
		"name":     "Updated by the external client",
	}, nil)
	for {
		var event struct {
			Method string
			Params struct{ ThreadID, ThreadName string }
		}
		if err := desktop.read(&event); err != nil {
			t.Fatalf("wait for desktop notification: %v", err)
		}
		if event.Method == "thread/name/updated" {
			if event.Params.ThreadID != started.Thread.ID || event.Params.ThreadName != "Updated by the external client" {
				t.Fatalf("unexpected thread update: %+v", event.Params)
			}
			break
		}
	}
	if err := conn.CloseNow(); err != nil {
		t.Fatal(err)
	}
	desktop.call(t, 3, "thread/loaded/list", struct{}{}, &loaded)
	if !slices.Contains(loaded.Data, started.Thread.ID) {
		t.Fatal("desktop lost the thread after the external client disconnected")
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(socketDir); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("socket directory remained after shutdown: %v", err)
	}
}

type rpcClient struct {
	send func(any) error
	read func(any) error
}

func (c rpcClient) notify(t *testing.T, method string) {
	t.Helper()
	if err := c.send(map[string]any{"method": method}); err != nil {
		t.Fatal(err)
	}
}

func (c rpcClient) call(t *testing.T, id int, method string, params any, result any) {
	t.Helper()
	request := map[string]any{"id": id, "method": method}
	if params != nil {
		request["params"] = params
	}
	if err := c.send(request); err != nil {
		t.Fatalf("send %s: %v", method, err)
	}
	for {
		var message struct {
			ID     json.RawMessage
			Result json.RawMessage
			Error  json.RawMessage
		}
		if err := c.read(&message); err != nil {
			t.Fatalf("read %s: %v", method, err)
		}
		if string(message.ID) != strconv.Itoa(id) {
			continue
		}
		if len(message.Error) > 0 || len(message.Result) == 0 {
			t.Fatalf("%s: expected a result, got error %s", method, message.Error)
		}
		if result != nil {
			if err := json.Unmarshal(message.Result, result); err != nil {
				t.Fatalf("decode %s: %v", method, err)
			}
		}
		return
	}
}
