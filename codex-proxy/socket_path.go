package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func prepareSocketPath(path string) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("CODEX_PROXY_SOCKET_PATH must be an absolute file path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		if err != nil {
			return err
		}
		return fmt.Errorf("socket path already exists: %s", path)
	}
	return nil
}
