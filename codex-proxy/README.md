# codex-proxy

`codex-proxy` 是 Codex Desktop 的 Go 启动器。Desktop 向启动器的标准输入输出读写 JSONL，启动器启动真实的 `codex app-server --listen unix://…`，并在 JSONL 与 Unix socket 上的 WebSocket 文本帧之间双向转发消息。另一个本机客户端可以独立连接同一个 socket，由 app-server 管理连接、线程和消息订阅。

```text
Codex Desktop ── stdio / JSONL ── codex-proxy ── WebSocket over Unix socket ── codex app-server
本机外部客户端 ────────────────────────────────── WebSocket over Unix socket ────────┘
```

## 构建与启动

需要 Go 1.23+、macOS 或 Linux，以及支持 `app-server --listen unix://PATH` 的 Codex CLI。已在 macOS 使用 `codex-cli 0.171.0-alpha.13` 验证。

在项目目录执行 `go build -o bin/codex-proxy .`。在 macOS 完全退出正在运行的 Codex Desktop 后，执行下面的命令。`app` 填写本机的实际应用路径，`real_codex` 填写与 Desktop 配套的真实 CLI 的绝对路径。可以用 `command -v codex` 查找当前终端里的 CLI。

```sh
app='/Applications/ChatGPT.app'
real_codex='/absolute/path/to/real/codex'
socket_dir="/tmp/cp-$(id -u)"

open -a "$app" \
  --env "CODEX_CLI_PATH=$PWD/bin/codex-proxy" \
  --env "CODEX_PROXY_REAL_CODEX=$real_codex" \
  --env "CODEX_PROXY_SOCKET_DIR=$socket_dir"
```

`CODEX_CLI_PATH` 是 Desktop 进程的环境变量，值是可执行文件的路径。Desktop 自行传入 `app-server` 和启动参数。`CODEX_PROXY_REAL_CODEX` 缺省时，启动器在 `PATH` 中查找 `codex`。实际启动的 app-server 继承 Desktop 子进程的环境，读取自己的 Codex 配置和数据目录。

`CODEX_PROXY_SOCKET_DIR` 指定一个尚不存在的绝对目录。启动器会以 `0700` 创建目录，socket 文件名为 `app.sock`，并在退出时清理。省略该变量时，每次启动使用新的 `/tmp/codex-proxy-*` 目录，完整地址写到 stderr。若强制终止后旧目录残留，可以在确认旧进程已退出后使用一个新的目录路径。

启动器桥接 Desktop 默认的 stdio 启动方式。`--version`、`app-server --help`、`app-server daemon` 和显式传输参数交给真实 CLI 处理。

## 外部客户端

另一终端可以用支持 Unix socket 的 Codex TUI 连接。若使用了上面的固定目录，执行 `codex --remote "unix:///tmp/cp-$(id -u)/app.sock"`。自定义客户端应通过该 Unix socket 完成 HTTP Upgrade，再发送 `initialize` 请求和 `initialized` 通知。可以通过 `thread/loaded/list` 查询当前已加载的线程，通过 `thread/resume` 恢复有可用历史记录的线程。事件投递和审批行为由 app-server 的协议和订阅管理，连接成功只完成传输层握手。

## 飞书方案核对

| 方案表述 | 核对结果 |
| --- | --- |
| `CODEX_CLI_PATH` 指向 `codex app-server` | 应写为「`CODEX_CLI_PATH` 指向 Codex CLI 可执行文件，Desktop 以 `app-server` 子命令启动它」。本机 Desktop 的 CLI 启动分支默认使用 stdio。 |
| helper 启动 Unix socket app-server，代理 stdio 和 socket | 架构成立。具体传输方式是 stdio 上的 JSONL 与 Unix socket 上的 WebSocket 文本消息之间的桥接。 |
| 外部端用 socket 介入会话 | 外部端可新建连接并操作同一 app-server 中的线程。每条连接独立初始化，客户端按协议选择要操作或订阅的线程。 |
| 编译 helper 后修改 Codex 配置即可 | 应写明在 Desktop 进程的环境中设置 `CODEX_CLI_PATH` 并重新启动应用，同时确保 helper 能定位到兼容的真实 CLI，以及外部客户端知道 socket 路径。 |

协议参考 [OpenAI 的 Codex App Server 文档](https://learn.chatgpt.com/docs/app-server#protocol)。

## 验证

```sh
go test ./...
CODEX_PROXY_TEST_CODEX="$(command -v codex)" go test -v ./...
```

集成测试使用独立的 `CODEX_HOME`，按本机 Desktop 的参数启动 helper。stdio 客户端创建线程，另一个 Unix socket 客户端查询到同一线程并更新名称，stdio 客户端收到更新通知。测试也检查外部客户端断开后主连接仍可请求，以及 helper 退出后 socket 目录被清理。测试不发起模型请求。
