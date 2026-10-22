# Windows 发布与更新

作者为 [996wuxian](https://github.com/996wuxian)，仓库为 [996wuxian/easygit](https://github.com/996wuxian/easygit)，安装包入口为 [GitHub Releases](https://github.com/996wuxian/easygit/releases)。应用内从“偏好设置 → 关于与更新”进入。

## 更新流程

桌面应用启动时检查一次 GitHub 最新正式 Release，之后可手动检查；不做周期轮询。检查失败会显示错误，尚未发布正式版本时不会误报“已是最新版本”。版本号使用语义化版本比较，忽略预发布版本和构建元数据差异，不建议降级。

有新版本时可在应用内下载安装包，显示进度，关闭关于窗口后仍继续下载。文件保存到系统下载目录的 `easygit` 子目录，不覆盖已有文件。下载校验文件大小，以及 GitHub 提供的 SHA-256（如果可用）；失败清理本次 `.part` 文件。完成后打开下载文件夹，从系统托盘退出 easygit，再手动运行安装包。应用不会自动执行下载的程序。

所有更新请求都由 Rust 执行，使用 HTTPS、系统代理和超时；前端不需要放宽 CSP。检查和下载仅使用固定仓库的 Release 信息。默认构建为 Windows x64 NSIS 中文 `.exe` 安装包，安装在当前用户下，并禁止静默降级。应用标识保持 `dev.esaygit.desktop`，升级沿用原有数据位置。

## 版本号

`package.json` 的 `version` 是唯一来源，前端直接读取该值。`scripts/sync-version.mjs` 同步 Tauri 配置、Rust 应用包版本、Cargo 锁文件中的应用版本和 npm 锁文件；不会修改依赖的版本。

```powershell
# 更新补丁版本；同步相关文件，不自动创建提交或标签
npm version patch --no-git-tag-version

# 手动修改 package.json 后同步，或只检查一致性
npm run sync:version
npm run sync:version -- --check
```

使用 Node.js 22.12 或更高版本。`npm run build` 和 `npm run tauri:build` 都会先同步版本；推荐提交同步后的全部文件。Tauri API、CLI 和 Rust 端已约束在 2.11 小版本内，避免 npm 与 pnpm 解析到不同的小版本后无法打包；升级时应一起调整并重新验证。

## GitHub Actions

`.github/workflows/ci.yml` 在 main 推送和 PR 时验证前端测试、版本同步脚本、构建、Rust 格式、Clippy 和真实 Git 工作流测试。

`.github/workflows/release.yml` 提供三种发布入口：

- main 分支的 `package.json` 或发布工作流变更。
- 推送与 `package.json` 版本一致的 `v*` 标签，例如 `v0.1.1`。
- 在 main 分支的 Actions 页面手动运行 **Release Windows**。

工作流安装 Node.js 22 和 Rust stable，验证测试后通过 [Tauri Action](https://github.com/tauri-apps/tauri-action) 构建 `x86_64-pc-windows-msvc` 的 NSIS 安装包。先上传到草稿 Release，成功后再公开；相同版本已有公开安装包时跳过，网络或权限错误不会被当成“没有 Release”。预发布版本会标记为 prerelease，应用的正式版检查不会提示这些版本。

使用 GitHub 自动提供的 `GITHUB_TOKEN`，发布 job 已声明 `contents: write`，无需在应用里填写 GitHub Token。仓库需要允许 Actions 运行；组织级策略如禁止写入 Release，需要由仓库管理员调整。配置文件提交并推送到 GitHub 后，云端流程才会运行。

## 本机打包

```powershell
npm ci
npm run check
npm run test:release
npm run tauri:build -- --bundles nsis
```

默认安装包位于 `src-tauri/target/release/bundle/nsis/easygit_<版本>_x64-setup.exe`。GitHub 的显式目标构建位于 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。安装包使用现有 easygit 图标及中文界面；项目未配置付费代码签名证书。

Windows 安装配置遵循 [Tauri Windows Installer 文档](https://v2.tauri.app/distribute/windows-installer/)。请先从托盘退出已运行的 easygit，再安装或升级。
