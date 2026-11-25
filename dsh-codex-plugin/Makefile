.DEFAULT_GOAL := build
NODE ?= node
PNPM ?= pnpm
ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

.PHONY: deps build test package

deps:
	$(PNPM) install --frozen-lockfile

build:
	$(NODE) build.js

test:
	$(NODE) --test host.test.js

package: build
	$(PYTHON) package.py
