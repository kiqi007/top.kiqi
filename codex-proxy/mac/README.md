# macOS 手动接入本机 Codex 会话

1. 解压 macOS 包。Apple 芯片选 `bin/ARM64/codex-proxy`，Intel 芯片选 `bin/AMD64/codex-proxy`。将启动器和整个 `dsh-codex-plugin` 目录放到各自的固定位置。
2. 按 ⌘Q 完全退出 Codex Desktop。按实际路径设置三个环境变量，在解压目录（源码布局中为 `codex-proxy/mac/`）运行下列 Make 目标，配置从 Dock 或访达启动的应用。

   ```sh
   make configure PROXY="$HOME/Tools/Codex/codex-proxy" REAL_CODEX="/absolute/path/to/real/codex" SOCKET="$HOME/data/codex/socket/app.sock"
   ```

3. 重新启动 Codex Desktop 和 dsh Web。在 dsh Web 的第三方插件设置中安装并启用刚解压的插件目录。已有同路径安装可重新加载插件。
4. 鼠标移到右上角的会话图标，看到「已连接」即可打开会话。Desktop 和 dsh Web 应以同一用户运行，并继承相同的 socket 路径。从终端启动 dsh 时，可在该终端用 `export` 设置相同的变量。

需要支持 `app-server --listen unix://PATH` 的真实 Codex CLI。选择当前用户私有的短 socket 路径；父目录会自动创建。上述配置适用于当前登录会话。需要恢复原模式时，完全退出 Desktop，恢复原来的 `CODEX_CLI_PATH`（原来未设置则运行 `make restore`，原来有值则运行 `make restore PREVIOUS_CLI="/原来的路径"`），再启动 Desktop。
