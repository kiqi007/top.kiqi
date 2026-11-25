package windows

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"
)

// Windows Node uses named pipes for net.connect(path). Give ws a raw stream to
// the same AF_UNIX socket, leaving all WebSocket and Codex protocol handling in ws.
func RelaySocket(path string) error {
	conn, err := net.DialTimeout("unix", path, 5*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	done := make(chan error, 2)
	go func() { _, err := io.Copy(conn, os.Stdin); done <- err }()
	go func() { _, err := io.Copy(os.Stdout, conn); done <- err }()
	return <-done
}

// Some Codex CLI builds only expose the loopback WebSocket on Windows. Offer
// the configured filesystem socket to clients and keep the upstream token in memory.
func (e Endpoint) serveSocket(path string) (func(), error) {
	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", e.Port)}
	transport := &http.Transport{}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) {
		r.SetURL(target)
		r.Out.Header.Set("Authorization", "Bearer "+e.Token)
	}}
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second}
	go server.Serve(listener)
	return func() { server.Close(); transport.CloseIdleConnections() }, nil
}
