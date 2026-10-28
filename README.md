# easygit

你的 Git，你的工作空间。

easygit 是一款面向日常开发的桌面 Git 客户端。把查看改动、提交代码、管理分支和解决冲突放进同一个工作台，也可以按自己的习惯调整面板位置与大小。

[下载安装](https://github.com/996wuxian/easygit/releases) · [使用指南](docs/getting-started.md) · [反馈问题](https://github.com/996wuxian/easygit/issues)

![easygit 工作台](docs/workspace-redesign-light.png)

## 下载与安装

目前提供 **Windows x64 中文安装包**。

1. 从 [Releases](https://github.com/996wuxian/easygit/releases) 下载 `easygit_*_x64-setup.exe` 并安装。
2. 确保本机已经安装 [Git](https://git-scm.com/downloads)，且 `git` 已加入 PATH。
3. 启动 easygit，打开本地仓库，或选择“克隆仓库”“初始化仓库”开始使用。

安装版使用 Windows WebView2。应用内的“偏好设置 → 关于与更新”可以检查新版本并下载安装包；升级前请从系统托盘退出 easygit。

## 从一个项目开始

| 你现在的情况 | 使用方式 |
| --- | --- |
| 本机已有 Git 项目 | 点击“打开仓库”，选择项目文件夹；也支持已有 worktree。 |
| 项目在远程服务器 | 点击“克隆仓库”，填写 HTTPS 或 SSH 地址、保存位置和新文件夹名称；完成后自动打开。 |
| 本机项目还没用 Git | 点击“初始化仓库”，选择已有项目文件夹和初始分支；文件会保留，由你选择首次提交的内容。 |
| 需要连接或更换远程仓库 | 点击分支面板的“配置远程仓库”，或在偏好设置中打开“远程仓库”。 |

克隆支持阶段进度、取消和失败后重试，已有同名目录不会被覆盖。私有仓库沿用本机 Git 凭据管理器或 SSH 密钥；仓库地址中无需填写密码或令牌。

## 主要功能

- **检查改动与提交**：工作区／暂存区差异、文件多选、批量暂存、提交草稿、提交与推送。支持统一差异和全屏左右比对，以及按文件或变更块预览后撤回未暂存修改。
- **管理分支与同步**：创建、切换、重命名和删除本地分支，配置上游，获取和拉取更新；支持远程分支跟踪、分支对比和预览后拖拽合并。
- **查看与整理历史**：提交图、分支筛选、提交信息搜索和分页；查看提交详情、跨分支比较两个提交、拣选普通提交、反向提交，以及撤回尚未推送的末次提交。
- **解决冲突**：按块保留当前版本、传入版本或双方，手动编辑合并结果；完成暂存后可继续或取消当前合并、rebase、cherry-pick、revert 操作。
- **临时保存工作**：stash 支持包含未跟踪文件、查看差异、恢复、恢复后删除和确认删除；发生冲突时保留 stash 记录。
- **浏览项目与运行脚本**：项目文件树、文件名／内容搜索、文本编辑器，以及根目录 `package.json` 脚本入口；脚本在项目终端中执行。
- **组织自己的工作台**：八种业务面板，可显示、隐藏、交换位置、调整尺寸和最大化；侧栏导航会直接显示并定位对应面板，布局自动保存。
- **多项目与本机数据**：最近项目切换、项目笔记、按仓库隔离的提交草稿、浅色／深色主题和系统托盘。关闭窗口会收起到托盘，退出请使用托盘菜单。
- **AI 提交信息**：可配置兼容服务，根据已暂存差异生成提交信息；生成时会将差异发送到你配置的服务，API Key 在 Windows 上由系统加密保存。

打开项目时先展示本地内容，再后台获取远程更新；获取操作不会自动拉取或合并代码。仓库状态在窗口有焦点时自动检查，回到窗口会立即刷新，也可随时手动刷新。

## 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl + O` | 打开仓库 |
| `Ctrl + K` | 搜索命令，包括克隆、初始化和远程配置 |
| `Ctrl + R` | 刷新仓库状态 |
| `Ctrl + Enter` | 提交已暂存更改 |
| `/` | 聚焦变更文件筛选 |
| `Ctrl + S` | 保存编辑器中的文件 |
| `Escape` | 关闭对话框或还原最大化面板 |

## 当前边界

- 暂存目前以文件为单位，尚不支持分块／选行暂存和交互式 rebase 编排。
- 差异预览和文本编辑主要支持 2 MiB 以内的 UTF-8 文件。较大文件、其他编码，以及符号链接和子模块的冲突需使用外部工具处理。
- 远程配置支持多个远程名称，查看获取／推送地址，新增、修改单个获取地址和确认移除；已有独立推送地址会保留，多获取地址的调整使用 Git 命令。
- 文件编辑草稿在正常切换和退出时有未保存提示，尚不支持异常退出后的自动恢复。

更多操作说明与常见问题见 [使用指南](docs/getting-started.md)。

## 本地开发

技术栈：Tauri 2、React 19、TypeScript、Vite、Rust、CodeMirror 和 Tabler Icons。

需要 Node.js 22.12 或更高版本、Rust 和 Git；Windows 构建还需要 C++ Build Tools 与 WebView2。

```powershell
npm ci
npm run tauri:dev
```

仅预览界面：

```powershell
npm run dev
```

浏览器地址为 `http://127.0.0.1:1437`。本地 Git 操作、目录选择和文件编辑需要桌面运行环境。

验证与打包：

```powershell
npm run check
npm run test:release
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --offline --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri:build
```

[架构说明](docs/architecture.md) · [性能与测量](docs/performance.md) · [发布与更新](docs/releasing.md)

## 反馈

欢迎通过 [Issues](https://github.com/996wuxian/easygit/issues) 提交问题或建议。报告问题时请附上应用版本、Git 版本、操作步骤和错误信息，并隐藏仓库地址中的凭据及其他私人内容。

作者：[996wuxian](https://github.com/996wuxian)
