.DEFAULT_GOAL := build
GO ?= go
ifeq ($(OS),Windows_NT)
PYTHON ?= python
EXE := .exe
else
PYTHON ?= python3
endif
export GO
PLUGIN_ARCHIVE := ../dsh-codex-plugin/bin/dsh-codex-plugin.zip

.PHONY: deps build test vet plugin-package package package-mac package-windows

deps:
	$(GO) mod download

build:
	$(GO) build -o bin/codex-proxy$(EXE) .

test:
	$(GO) test -count=1 ./...

vet:
	$(GO) vet ./...

plugin-package:
	$(MAKE) -C ../dsh-codex-plugin package

package: plugin-package
	$(PYTHON) package.py all --plugin-archive "$(PLUGIN_ARCHIVE)"

package-mac: plugin-package
	$(PYTHON) package.py mac --plugin-archive "$(PLUGIN_ARCHIVE)"

package-windows: plugin-package
	$(PYTHON) package.py windows --plugin-archive "$(PLUGIN_ARCHIVE)"
