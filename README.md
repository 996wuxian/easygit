# easygit

你的 Git，你的工作空间。参考 doTime 的 **Tauri 2 + React 19 + TypeScript + Vite + Tabler Icons** 骨架，为桌面 Git 工作流提供可以自由组合的面板。

![工作台预览](docs/workspace-redesign-light.png)

## 运行

需要 Node.js 22、Rust、Git，以及 Tauri 在 Windows 上所需的 C++ Build Tools 和 WebView2。

```powershell
npm ci
npm run tauri:dev
```

浏览器预览：

```powershell
npm run dev
```

访问 http://127.0.0.1:1437 。未打开仓库时显示空白起始页；打开本地仓库需要运行桌面版。

## 当前版本

- React 加载前即显示品牌 loading，完成启动检查后淡出。
- 自定义无边框标题栏、浅色/深色主题、Tabler 图标。
- 六个独立面板：工作区变更、代码差异、分支、提交记录、暂存架、操作记录。
- 拖动面板标题右侧手柄交换位置；选中手柄后按 Alt + 方向键也可移动；Escape 取消拖动。
- 面板显示/隐藏、恢复默认布局、版本化本地布局保存；至少保留一个面板。
- Ctrl + K 命令面板、Ctrl + O 打开仓库、Ctrl + R 刷新仓库、`/` 筛选文件。
- 通过目录路径打开真实 Git 仓库，支持最近打开记录及 worktree。
- 侧栏和打开仓库弹窗均可移除工作区，统一二次确认；移除当前项目后回到起始页，仅清理应用记录，保留本地项目和 Git 数据。
- 真实仓库状态、统一 diff、整文件暂存/取消暂存、提交、切换本地分支、fetch。
- 提交信息中按 Ctrl + Enter 提交；提交草稿按仓库隔离，隐藏面板不会丢失草稿。
- 同一仓库操作串行执行；Git 子进程有超时和 Windows 进程树清理。
- 真实仓库每 8 秒刷新，并在应用重新获得焦点时刷新。

这一版聚焦应用骨架与基础流程。暂未包含逐行暂存、push/pull、交互式 rebase、图形冲突解决、stash 的创建/恢复，以及原生目录选择器。暂存架当前显示真实记录数量；冲突文件展示原始差异，需要通过编辑器/Git 解决并暂存。

## 验证与打包

```powershell
npm run check
cd src-tauri
cargo fmt --check
cargo test --offline
cargo clippy --offline --all-targets -- -D warnings
```

在项目根目录打包：

```powershell
npm run tauri:build
```

生成不含安装包的独立调试程序（嵌入前端资源，无需 Vite）：

```powershell
npm run tauri -- build --debug --no-bundle
```

## 项目组织

```text
src/
  components/      # 业务面板、对话框、窗口控制
  layout/          # 布局模型、持久化、Pointer Events 拖动
  services/        # Git 接口、统一仓库状态与操作
src-tauri/src/
  git.rs           # Git 执行器、仓库状态、工作流
  lib.rs           # 类型化 Tauri commands
```

添加或替换面板的步骤见 [架构说明](docs/architecture.md)。
