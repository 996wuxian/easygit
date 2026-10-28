use super::{
    command, error_text, optional_text, run, run_text, snapshot, with_repository,
    RepositorySnapshot,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

#[derive(Clone, Default)]
pub struct CloneState(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

pub struct CloneTask {
    state: CloneState,
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl CloneState {
    pub fn register(&self, id: String) -> Result<CloneTask, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("克隆任务标识无效。".into());
        }
        let mut tasks = self.0.lock().map_err(|_| "克隆任务不可用。")?;
        if !tasks.is_empty() {
            return Err("已有克隆任务正在进行，请等待完成或取消。".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        tasks.insert(id.clone(), cancelled.clone());
        Ok(CloneTask {
            state: self.clone(),
            id,
            cancelled,
        })
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        if let Some(flag) = self.0.lock().map_err(|_| "克隆任务不可用。")?.get(id) {
            flag.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
}

impl Drop for CloneTask {
    fn drop(&mut self) {
        if let Ok(mut tasks) = self.state.0.lock() {
            tasks.remove(&self.id);
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: String,
    pub percent: Option<u8>,
}

fn progress_line(line: &str) -> Option<CloneProgress> {
    let phase = [
        ("Enumerating objects:", "正在枚举对象"),
        ("Counting objects:", "正在统计对象"),
        ("Compressing objects:", "正在压缩对象"),
        ("Receiving objects:", "正在接收对象"),
        ("Resolving deltas:", "正在解析差异"),
        ("Updating files:", "正在检出文件"),
    ]
    .iter()
    .find(|(prefix, _)| line.trim_start().starts_with(prefix))?
    .1;
    let percent = line
        .split('%')
        .next()
        .and_then(|part| part.split_whitespace().last())
        .and_then(|number| number.parse::<u8>().ok())
        .filter(|number| *number <= 100);
    Some(CloneProgress {
        phase: phase.into(),
        percent,
    })
}

fn validate_url(url: &str) -> Result<&str, String> {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
        return Err("请输入有效的仓库地址。".into());
    }
    if url.contains("://") {
        let parsed = reqwest::Url::parse(url).map_err(|_| "仓库地址格式不正确。")?;
        if !["https", "http", "ssh", "git", "file"].contains(&parsed.scheme()) {
            return Err("请使用 HTTPS、SSH 或本地仓库地址。".into());
        }
        if parsed.password().is_some()
            || (["https", "http"].contains(&parsed.scheme()) && !parsed.username().is_empty())
        {
            return Err(
                "请使用不含账号、密码或令牌的地址，身份验证由 Git 凭据管理器或 SSH 密钥处理。"
                    .into(),
            );
        }
    } else if url.contains("::") {
        return Err("不支持自定义 Git 远程助手地址，请使用 HTTPS、SSH 或本地仓库地址。".into());
    }
    Ok(url)
}

fn target_directory(parent: &str, name: &str) -> Result<PathBuf, String> {
    let parent = Path::new(parent)
        .canonicalize()
        .map_err(|_| "保存位置不存在或无法访问。")?;
    if !parent.is_dir() {
        return Err("请选择一个文件夹作为保存位置。".into());
    }
    let name = name.trim();
    if name.is_empty()
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || !matches!(
            Path::new(name).components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        )
    {
        return Err("请输入有效的文件夹名称，不能包含路径分隔符。".into());
    }
    let target = parent.join(name);
    if target.try_exists().map_err(|e| e.to_string())? {
        return Err("目标文件夹已存在，请更换名称；已有仓库可直接打开。".into());
    }
    Ok(target)
}

pub fn clone_repository(
    url: &str,
    parent: &str,
    name: &str,
    task: CloneTask,
    mut progress: impl FnMut(CloneProgress),
) -> Result<RepositorySnapshot, String> {
    let url = validate_url(url)?;
    let target = target_directory(parent, name)?;
    // Git only writes into our private temporary directory. Existing projects
    // are never used as clone targets, and failed/cancelled clones can be retried.
    let staging = tempfile::Builder::new()
        .prefix(".easygit-clone-")
        .tempdir_in(target.parent().unwrap())
        .map_err(|e| format!("无法创建克隆目录：{e}"))?;
    let checkout = staging.path().join("repository");
    let mut process = command(None);
    process
        .args(["-c", "core.hooksPath=", "clone", "--progress", "--", url])
        .arg("repository")
        .current_dir(staging.path())
        .env("LC_ALL", "C")
        .env("LANG", "C");
    progress(CloneProgress {
        phase: "正在连接仓库".into(),
        percent: None,
    });
    let mut pending = String::new();
    let mut last = None;
    let result = crate::process::output_with_progress(
        &mut process,
        Duration::from_secs(30 * 60),
        &task.cancelled,
        &mut |bytes| {
            pending.push_str(&String::from_utf8_lossy(bytes));
            while let Some(index) = pending.find(['\r', '\n']) {
                let line: String = pending.drain(..=index).collect();
                if let Some(update) = progress_line(line.trim()) {
                    if last.as_ref() != Some(&update) {
                        progress(update.clone());
                        last = Some(update);
                    }
                }
            }
            if pending.len() > 8192 {
                pending.clear();
            }
        },
    )
    .map_err(|e| match e.kind() {
        std::io::ErrorKind::Interrupted => "克隆已取消，可以重新尝试。".into(),
        std::io::ErrorKind::NotFound => "未找到 Git，请安装 Git 并确认已加入 PATH。".into(),
        std::io::ErrorKind::TimedOut => "克隆超过 30 分钟，已停止。请检查网络后重试。".into(),
        _ => format!("无法完成克隆：{e}"),
    })?;
    if !result.status.success() {
        return Err(error_text(&result));
    }
    if task.cancelled.load(Ordering::Relaxed) {
        return Err("克隆已取消，可以重新尝试。".into());
    }
    if target.try_exists().map_err(|e| e.to_string())? {
        return Err("目标文件夹已被创建，请更换名称后重试。".into());
    }
    progress(CloneProgress {
        phase: "正在准备工作区".into(),
        percent: None,
    });
    std::fs::rename(&checkout, &target).map_err(|e| format!("无法保存克隆结果：{e}"))?;
    snapshot(&target).map_err(|e| {
        format!(
            "仓库已克隆至 {}，但读取状态失败，请直接打开此目录：{e}",
            target.display()
        )
    })
}

pub fn initialize_repository(path: &str, branch: &str) -> Result<RepositorySnapshot, String> {
    let root = Path::new(path)
        .canonicalize()
        .map_err(|_| "请选择一个已存在的项目文件夹。")?;
    if !root.is_dir() {
        return Err("项目目录不是文件夹。".into());
    }
    super::git_version()?;
    if root.join(".git").try_exists().map_err(|e| e.to_string())?
        || optional_text(&root, &["rev-parse", "--absolute-git-dir"])?.is_some()
    {
        return Err("此目录已经位于 Git 仓库中，请使用“打开本地仓库”。".into());
    }
    let branch = branch.trim();
    if branch.starts_with('-') || branch.is_empty() {
        return Err("请输入有效的初始分支名称。".into());
    }
    run(&root, &["check-ref-format", "--branch", branch])?;
    run(
        &root,
        &["check-ref-format", &format!("refs/heads/{branch}")],
    )?;
    run(&root, &["init", "--initial-branch", branch, "."])?;
    snapshot(&root)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    pub name: String,
    pub fetch_urls: Vec<String>,
    pub push_urls: Vec<String>,
}

fn remotes(root: &Path) -> Result<Vec<GitRemote>, String> {
    run_text(root, &["remote"])?
        .lines()
        .map(|name| {
            let fetch_urls = run_text(root, &["remote", "get-url", "--all", name])?
                .lines()
                .map(str::to_owned)
                .collect();
            let push_urls = run_text(root, &["remote", "get-url", "--push", "--all", name])?
                .lines()
                .map(str::to_owned)
                .collect();
            Ok(GitRemote {
                name: name.into(),
                fetch_urls,
                push_urls,
            })
        })
        .collect()
}

pub fn read_remotes(path: &str) -> Result<Vec<GitRemote>, String> {
    with_repository(path, remotes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRequest {
    pub name: String,
    pub url: Option<String>,
    pub expected: Option<GitRemote>,
}

pub fn configure_remote(path: &str, request: RemoteRequest) -> Result<RepositorySnapshot, String> {
    with_repository(path, |root| {
        let name = request.name.trim();
        if name.is_empty() || name.starts_with('-') || name.chars().any(char::is_control) {
            return Err("请输入有效的远程名称。".into());
        }
        run(
            root,
            &["check-ref-format", &format!("refs/remotes/{name}/branch")],
        )?;
        let current = remotes(root)?
            .into_iter()
            .find(|remote| remote.name == name);
        if current != request.expected {
            return Err("远程配置已变化，请刷新后重新操作。".into());
        }
        match (current, request.url) {
            (None, Some(url)) => {
                run(root, &["remote", "add", name, validate_url(&url)?])?;
            }
            (Some(remote), Some(url)) => {
                if remote.fetch_urls.len() != 1 {
                    return Err(
                        "此远程配置了多个获取地址，请使用 Git 命令调整，以保留现有地址。".into(),
                    );
                }
                run(root, &["remote", "set-url", name, validate_url(&url)?])?;
            }
            (Some(_), None) => {
                run(root, &["remote", "remove", name])?;
            }
            (None, None) => return Err("远程仓库不存在。".into()),
        }
        snapshot(root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        initialize_repository(path.to_str().unwrap(), "main").unwrap();
        run(path, &["config", "user.name", "Test Developer"]).unwrap();
        run(path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(path.join("hello.txt"), "hello\n").unwrap();
        run(path, &["add", "."]).unwrap();
        run(path, &["commit", "-m", "initial"]).unwrap();
        directory
    }

    #[test]
    fn initialization_preserves_files_and_rejects_existing_or_enclosing_repositories() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("existing.txt"), "keep me").unwrap();
        assert!(initialize_repository(root.to_str().unwrap(), "bad branch").is_err());
        assert!(!root.join(".git").exists());
        let state = initialize_repository(root.to_str().unwrap(), "develop").unwrap();
        assert_eq!(state.branch, "develop");
        assert!(state.head.is_none());
        assert_eq!(
            std::fs::read_to_string(root.join("existing.txt")).unwrap(),
            "keep me"
        );
        assert!(initialize_repository(root.to_str().unwrap(), "main")
            .unwrap_err()
            .contains("已经位于"));
        let nested = root.join("nested");
        std::fs::create_dir(&nested).unwrap();
        assert!(initialize_repository(nested.to_str().unwrap(), "main").is_err());
        assert!(!nested.join(".git").exists());
    }

    #[test]
    fn clone_opens_real_repository_and_never_overwrites_existing_directory() {
        let source = repo();
        let parent = tempfile::tempdir().unwrap();
        let state = CloneState::default();
        let mut progress = Vec::new();
        let snapshot = clone_repository(
            source.path().to_str().unwrap(),
            parent.path().to_str().unwrap(),
            "中文 project",
            state.register("first".into()).unwrap(),
            |update| progress.push(update),
        )
        .unwrap();
        assert!(Path::new(&snapshot.path).ends_with("中文 project"));
        assert_eq!(snapshot.branch, "main");
        assert!(snapshot.head.is_some());
        assert_eq!(
            std::fs::read_to_string(parent.path().join("中文 project/hello.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "hello\n"
        );
        assert!(!progress.is_empty());
        assert!(clone_repository(
            source.path().to_str().unwrap(),
            parent.path().to_str().unwrap(),
            "中文 project",
            state.register("second".into()).unwrap(),
            |_| {}
        )
        .unwrap_err()
        .contains("已存在"));
        assert_eq!(
            std::fs::read_to_string(parent.path().join("中文 project/hello.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "hello\n"
        );
    }

    #[test]
    fn failed_or_cancelled_clone_cleans_staging_and_can_retry_same_target() {
        let source = repo();
        let parent = tempfile::tempdir().unwrap();
        let state = CloneState::default();
        let args = (parent.path().to_str().unwrap(), "retry");
        assert!(clone_repository(
            parent.path().join("missing.git").to_str().unwrap(),
            args.0,
            args.1,
            state.register("failure".into()).unwrap(),
            |_| {}
        )
        .is_err());
        assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 0);
        let task = state.register("cancelled".into()).unwrap();
        assert!(state.register("duplicate".into()).is_err());
        let error = clone_repository(
            source.path().to_str().unwrap(),
            args.0,
            args.1,
            task,
            |_| {
                state.cancel("cancelled").unwrap();
            },
        )
        .unwrap_err();
        assert!(error.contains("克隆已取消"));
        assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 0);
        clone_repository(
            source.path().to_str().unwrap(),
            args.0,
            args.1,
            state.register("retry".into()).unwrap(),
            |_| {},
        )
        .unwrap();
        assert!(parent.path().join("retry/.git").exists());
    }

    #[test]
    fn clone_rejects_traversal_options_helpers_and_embedded_credentials() {
        let parent = tempfile::tempdir().unwrap();
        for name in ["../outside", "..", "a/b", "a\\b", "bad:name"] {
            assert!(target_directory(parent.path().to_str().unwrap(), name).is_err());
        }
        for url in [
            "--upload-pack=malicious",
            "ext::command",
            "https://token@host/repo",
            "https://user:password@host/repo",
            "ssh://user:password@host/repo",
            "repo\nother",
            "custom://host/repo",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
        for url in [
            "https://host/owner/repo.git",
            "git@host:owner/repo.git",
            "ssh://git@host/repo.git",
            "X:\\Projects\\repo.git",
        ] {
            assert!(validate_url(url).is_ok(), "{url}");
        }
        assert_eq!(
            progress_line("Receiving objects: 42% (42/100)")
                .unwrap()
                .percent,
            Some(42)
        );
        assert!(progress_line("remote: arbitrary message").is_none());
    }

    #[test]
    fn empty_repositories_can_be_cloned_and_configured_before_first_commit() {
        let source = tempfile::tempdir().unwrap();
        let source_path = source.path().to_str().unwrap();
        initialize_repository(source_path, "main").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let state = clone_repository(
            source_path,
            parent.path().to_str().unwrap(),
            "empty",
            CloneState::default().register("empty".into()).unwrap(),
            |_| {},
        )
        .unwrap();
        assert!(state.head.is_none());
        assert!(state.files.is_empty());
        let state = configure_remote(
            source_path,
            RemoteRequest {
                name: "origin".into(),
                url: Some("https://example.com/new.git".into()),
                expected: None,
            },
        )
        .unwrap();
        assert!(state.head.is_none());
        assert_eq!(state.remote.as_deref(), Some("https://example.com/new.git"));
    }

    #[test]
    fn remote_configuration_preserves_push_urls_and_rejects_stale_edits() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        configure_remote(
            path,
            RemoteRequest {
                name: "origin".into(),
                url: Some("https://example.com/old.git".into()),
                expected: None,
            },
        )
        .unwrap();
        run(
            directory.path(),
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                "git@example.com:push.git",
            ],
        )
        .unwrap();
        let original = read_remotes(path).unwrap().remove(0);
        configure_remote(
            path,
            RemoteRequest {
                name: "origin".into(),
                url: Some("https://example.com/new.git".into()),
                expected: Some(original.clone()),
            },
        )
        .unwrap();
        let current = read_remotes(path).unwrap().remove(0);
        assert_eq!(current.fetch_urls, ["https://example.com/new.git"]);
        assert_eq!(current.push_urls, ["git@example.com:push.git"]);
        assert!(configure_remote(
            path,
            RemoteRequest {
                name: "origin".into(),
                url: None,
                expected: Some(original)
            }
        )
        .unwrap_err()
        .contains("已变化"));
        assert!(configure_remote(
            path,
            RemoteRequest {
                name: "origin".into(),
                url: Some("https://example.com/duplicate.git".into()),
                expected: None
            }
        )
        .is_err());
        configure_remote(
            path,
            RemoteRequest {
                name: "upstream".into(),
                url: Some("https://example.com/upstream.git".into()),
                expected: None,
            },
        )
        .unwrap();
        configure_remote(
            path,
            RemoteRequest {
                name: "origin".into(),
                url: None,
                expected: Some(current),
            },
        )
        .unwrap();
        assert_eq!(read_remotes(path).unwrap()[0].name, "upstream");
        assert!(directory.path().join("hello.txt").exists());
    }
}
