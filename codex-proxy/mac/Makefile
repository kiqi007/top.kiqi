.DEFAULT_GOAL := help
PROXY ?= $(HOME)/Tools/Codex/codex-proxy
SOCKET ?= $(HOME)/data/codex/socket/app.sock
CLI ?= codex
.PHONY: help configure restore connect
help:
	@echo 'make configure REAL_CODEX=/absolute/path/to/codex [PROXY=...] [SOCKET=...]'
	@echo 'make restore [PREVIOUS_CLI=...]  |  make connect [CLI=...] [SOCKET=...]'

configure:
	@test -x "$(PROXY)" && test -x "$(REAL_CODEX)" || { echo 'Set PROXY and REAL_CODEX to the installed executable paths.'; exit 1; }
	launchctl setenv CODEX_PROXY_REAL_CODEX "$(REAL_CODEX)"
	launchctl setenv CODEX_PROXY_SOCKET_PATH "$(SOCKET)"
	launchctl setenv CODEX_CLI_PATH "$(PROXY)"

restore:
ifdef PREVIOUS_CLI
	launchctl setenv CODEX_CLI_PATH "$(PREVIOUS_CLI)"
else
	launchctl unsetenv CODEX_CLI_PATH
endif

connect:
	"$(CLI)" --remote "unix://$(SOCKET)"
