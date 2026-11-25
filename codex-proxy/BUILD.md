# 组件与构建

[代理](./README.md)和 [dsh Web 插件](../dsh-codex-plugin/README.md)是仓库顶层的两个独立组件。macOS 和 Windows 的代理实现分别在 [mac/](./mac/) 和 [windows/](./windows/)。

以下示例从仓库顶层执行。进入对应组件目录后，可以省略 `-C` 和目录名。

| 操作 | Make 命令 |
| --- | --- |
| 安装代理依赖 | `make -C codex-proxy deps` |
| 构建当前平台的代理 | `make -C codex-proxy build` |
| 运行代理测试或静态检查 | `make -C codex-proxy test`、`make -C codex-proxy vet` |
| 包含真实 Codex 的集成测试 | `make -C codex-proxy test CODEX_PROXY_TEST_CODEX="/实际的/codex"` |
| 安装插件构建依赖 | `make -C dsh-codex-plugin deps` |
| 构建或测试插件 | `make -C dsh-codex-plugin build`、`make -C dsh-codex-plugin test` |
| 单独打包插件 | `make -C dsh-codex-plugin package` |
| 同时生成两个平台的离线整包 | `make -C codex-proxy package` |
| 仅生成一个平台的整包 | `make -C codex-proxy package-mac`、`make -C codex-proxy package-windows` |

构建代理需要 GNU Make 和 Go 1.23 或更新版本。构建插件需要 GNU Make、Node.js 和 pnpm；生成 ZIP 还需要 Python 3。在 Windows 构建机上，若使用 Python 启动器，可给 Make 传入 `PYTHON="py -3"`。

首次构建前运行相应的依赖安装目标。插件 ZIP 输出到 `dsh-codex-plugin/bin/`。平台整包输出到 `codex-proxy/bin/`，各自包含 AMD64 和 ARM64 启动器、平台说明以及由插件自身 Makefile 生成的同一份离线插件。
