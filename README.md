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
- 七个独立面板：工作区变更、代码差异、分支、提交记录、暂存架、操作记录、项目脚本。
- 项目脚本面板读取根目录 `package.json` 的 `scripts`，识别 `packageManager` 或锁文件中的 npm / pnpm / yarn / bun，点击运行图标在项目目录打开终端执行；终端保留输出，可在终端中按 Ctrl + C 停止。
- 拖动面板标题右侧手柄交换位置；选中手柄后按 Alt + 方向键也可移动；Escape 取消拖动。
- 面板显示/隐藏、恢复默认布局、版本化本地布局保存；至少保留一个面板。
- Ctrl + K 命令面板、Ctrl + O 打开仓库、Ctrl + R 刷新仓库、`/` 筛选文件。
- 通过目录路径打开真实 Git 仓库，支持最近打开记录及 worktree。
- 侧栏和打开仓库弹窗均可移除工作区，统一二次确认；移除当前项目后回到起始页，仅清理应用记录，保留本地项目和 Git 数据。
- 真实仓库状态、统一 diff 与全屏左右比对；差异页支持整文件或单个变更块撤回（预览确认后执行），保留其他修改与已暂存内容；支持暂存与取消暂存。
- 冲突文件可查看当前/传入版本，逐块保留一方或双方、手动编辑合并结果，保存后标记已解决并暂存；修改/删除与二进制冲突支持整文件选边。
- 提交、切换与创建本地分支、fetch 和 pull；pull 遇到冲突时可从工作区打开冲突解决工具。
- 提交信息中按 Ctrl + Enter 提交；提交草稿按仓库隔离，隐藏面板不会丢失草稿。
- 同一仓库操作串行执行；Git 子进程有超时和 Windows 进程树清理。
- 真实仓库每 8 秒刷新，并在应用重新获得焦点时刷新。
- 打开或切换项目后先展示本地内容，再自动后台 fetch，更新远程分支、提交记录和领先/落后数量；网络失败保留本地内容，可点击“获取更新”重试。此过程不拉取或合并代码。

这一版聚焦应用骨架与基础流程。暂未包含逐行暂存、交互式 rebase、stash 的创建/恢复，以及原生目录选择器。暂存架当前显示真实记录数量。应用内冲突编辑支持 2 MB 以内的 UTF-8 文本；符号链接、子模块与更大文件需在外部工具中处理。解决冲突后仍需提交或继续当前 Git 操作。

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
