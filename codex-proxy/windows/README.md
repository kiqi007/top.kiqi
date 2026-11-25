# Windows 手动接入本机 Codex 会话

## 放置文件

完全退出 Codex Desktop。解压 ZIP，根据 Windows 的「系统类型」选择启动器：Intel/AMD 64 位选 `bin\AMD64\codex-proxy.exe`，ARM64 选 `bin\ARM64\codex-proxy.exe`。将该 exe 复制到你选定的固定目录。将整个 `dsh-codex-plugin` 文件夹放到准备长期使用的位置，保留其中的 `node_modules`。

## 配置三个用户环境变量

打开 Windows「编辑帐户的环境变量」，在「用户变量」中填写以下三项。示例中的用户名和目录请替换成自己的实际绝对路径，变量值可以包含空格，输入时省略引号。

| 用户变量 | 示例值 | 用途 |
| --- | --- | --- |
| `CODEX_CLI_PATH` | `C:\Users\qi\Tools\Codex\codex-proxy.exe` | Desktop 通过它启动 proxy，dsh 插件也通过它接入 socket。 |
| `CODEX_PROXY_REAL_CODEX` | `C:\Users\qi\Tools\CodexCLI\codex.exe` | proxy 启动的真实 Codex CLI。可以沿用已验证的 exe 路径。 |
| `CODEX_PROXY_SOCKET_PATH` | `C:\Users\qi\codex-run\app.sock` | proxy 与插件共享的完整 socket 文件地址，可以自行指定文件名。 |

选择当前用户私有的短路径。proxy 会创建缺少的父目录并在启动时建立 socket，正常退出时释放它。已有 `CODEX_PROXY_SOCKET_DIR` 的配置也可以迁移：把所需 socket 的完整文件路径填入 `CODEX_PROXY_SOCKET_PATH`，新版两端优先使用该值。

## 接入 dsh Web

1. 以配置这些变量的同一用户重新启动 Codex Desktop 和 dsh Web。若从终端启动 dsh Web，请先重新打开终端。
2. 在 dsh Web 的「插件 → 安装第三方插件」中选择刚放置的 `dsh-codex-plugin` 目录，启用后刷新。已经从同一路径安装过的插件，更新目录内容并重新加载即可。
3. 将鼠标移到右上角的会话窗图标上。看到「已连接」后，点开选择要查看的 Desktop 会话。

## 运行模式

Windows 版 proxy 在配置的路径提供本机 AF_UNIX socket，并连接真实 Codex app-server 的认证回环 WebSocket。端口和令牌由 proxy 管理。此方式需要支持 AF_UNIX 的 Windows 和支持 `--ws-auth`、`--ws-token-sha256` 的原生 Codex CLI。若安装后显示未连接，先核对两个应用继承的变量、真实 CLI 版本以及 socket 路径。

需要恢复 Desktop 原来的运行模式时，退出 Desktop，将 `CODEX_CLI_PATH` 恢复为此前的值（原来未设置则删除），再启动 Desktop。以后将它重新指向 proxy，即可切回共享模式。
