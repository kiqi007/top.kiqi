package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"codex-proxy/mac"
	"codex-proxy/windows"

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

// A transport configures the child and connects Desktop to the same instance as dsh.
type transport interface {
	Configure(*exec.Cmd) error
	Connect(context.Context) (*websocket.Conn, error)
	Close()
}

func run(ctx context.Context, args []string) error {
	if len(args) == 2 && args[0] == "--dsh-socket-relay" {
		return windows.RelaySocket(args[1])
	}
	codex, err := findCodex()
	if err != nil {
		return err
	}
	serverArgs, shared := sharedServerArgs(args)
	if !shared {
		cmd := exec.CommandContext(ctx, codex, args...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		return cmd.Run()
	}

	dir, path := os.Getenv("CODEX_PROXY_SOCKET_DIR"), os.Getenv("CODEX_PROXY_SOCKET_PATH")
	if path != "" {
		if err := prepareSocketPath(path); err != nil {
			return err
		}
	}
	var link transport
	if runtime.GOOS == "windows" || os.Getenv("CODEX_PROXY_TRANSPORT") == "websocket" {
		link = &windows.Transport{Dir: dir, Path: path}
	} else {
		link = &mac.Transport{Dir: dir, Path: path}
	}
	defer link.Close()
	serverCtx, stopServer := context.WithCancel(ctx)
	defer stopServer()
	cmd := exec.CommandContext(serverCtx, codex, serverArgs...)
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := link.Configure(cmd); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	}
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Start(); err != nil {
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
	conn, err := link.Connect(startupCtx)
	cancelStartup()
	if err == nil {
		defer conn.CloseNow()
		err = bridge(sessionCtx, conn, os.Stdin, os.Stdout)
	} else {
		err = fmt.Errorf("connect to Codex app-server: %w", err)
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

func sharedServerArgs(args []string) ([]string, bool) {
	result := make([]string, 0, len(args))
	appServer := false
	for i := 0; i < len(args); i++ {
		start := i
		arg, _, hasValue := strings.Cut(args[i], "=")
		switch arg {
		case "-c", "--config", "-p", "--profile", "--enable", "--disable",
			"--startup-client-info", "--cloud-skills-snapshot", "--code-mode-host":
			if !hasValue {
				i++
				if i >= len(args) {
					return nil, false
				}
			}
		case "app-server":
			if appServer {
				return nil, false
			}
			appServer = true
		case "--analytics-default-enabled", "--startup-sign-out", "--strict-config":
		case "--stdio":
			continue
		case "--listen":
			_, value, inline := strings.Cut(args[i], "=")
			if !inline {
				i++
				if i >= len(args) {
					return nil, false
				}
				value = args[i]
			}
			if value != "stdio://" {
				return nil, false
			}
			continue
		default:
			if !strings.HasPrefix(arg, "-c") || strings.HasPrefix(arg, "--") {
				return nil, false
			}
		}
		result = append(result, args[start:i+1]...)
	}
	return result, appServer
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
