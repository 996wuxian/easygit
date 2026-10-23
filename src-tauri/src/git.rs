use serde::Serialize;
mod branches;
mod commit_actions;
pub use branches::{manage_branch, read_branch_info, BranchInfo, BranchRequest};
mod comparison;
mod diff_blocks;
pub use diff_blocks::{discard_diff_block, DiffBlock};
mod conflicts;
#[cfg(test)]
mod conflicts_tests;
pub use commit_actions::{act_on_commit, CommitAction};
pub use conflicts::{read_conflict, resolve_conflict, ConflictFile, ConflictResolution};
#[cfg(test)]
mod checkout_tests;
mod history;
mod inspect;
mod merge;
mod merge_target;
mod operations;
mod stash;
#[cfg(test)]
mod workflow_tests;
pub use history::{history_page, HistoryPage, HistoryQuery};
pub use inspect::{
    commit_diff, compare_branches, compare_commits, comparison_diff, RevisionComparison,
};
pub use operations::{act_on_operation, OperationRequest};
pub use stash::{act_on_stash, list_stashes, save_stash, stash_diff, StashAction, StashEntry};
#[cfg(test)]
mod performance_tests;
mod revision;
pub use comparison::{read_file_comparison, FileComparison};
pub use merge::{
    commit_files, merge_branches, preview_merge, MergePreview, MergeRequest, MergeResult,
};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapInfo {
    pub git_available: bool,
    pub git_version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub last_commit_date: Option<String>,
}

#[derive(Debug, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitCommitRef>,
    pub local: bool,
    pub remote: bool,
}

#[derive(Debug, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRef {
    pub name: String,
    pub remote: bool,
}

#[derive(Debug, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpstream {
    pub name: String,
    pub hash: String,
}

#[derive(Debug, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub revision: String,
    pub path: String,
    pub name: String,
    pub branch: String,
    pub head: Option<String>,
    pub git_version: String,
    pub files: Vec<GitFile>,
    pub branches: Vec<GitBranch>,
    pub commits: Vec<GitCommit>,
    pub stash_count: usize,
    pub stash_revision: String,
    pub remote: Option<String>,
    pub has_upstream: bool,
    pub upstream: Option<GitUpstream>,
    pub ahead: usize,
    pub behind: usize,
    pub operation: Option<String>,
    pub operation_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub snapshot: RepositorySnapshot,
    pub conflicted: bool,
    pub error: Option<String>,
}

type RepoLocks = Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>;
static REPO_LOCKS: OnceLock<RepoLocks> = OnceLock::new();
static GIT_VERSION: OnceLock<String> = OnceLock::new();
#[cfg(test)]
thread_local! {
    static GIT_COMMAND_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn command(root: Option<&Path>) -> Command {
    let mut command = Command::new("git");
    command
        .arg("--literal-pathspecs")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null());
    if let Some(root) = root {
        command.arg("-C").arg(root);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn output(root: Option<&Path>, args: &[&str]) -> Result<Output, String> {
    #[cfg(test)]
    GIT_COMMAND_COUNT.with(|count| count.set(count.get() + 1));
    let mut command = command(root);
    command.args(args);
    crate::process::output_with_timeout(&mut command, Duration::from_secs(60)).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "未找到 Git，请安装 Git 并确认 git 已加入 PATH。".to_owned()
        } else if error.kind() == std::io::ErrorKind::TimedOut {
            format!("{error}（等待上限 60 秒）")
        } else {
            format!("无法启动 Git：{error}")
        }
    })
}

fn error_text(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if stderr.is_empty() {
        format!("Git 操作失败（退出码 {:?}）", output.status.code())
    } else {
        stderr
    }
}

fn run(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = output(Some(root), args)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(error_text(&output))
    }
}

fn run_text(root: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&run(root, args)?).trim().to_owned())
}

// Missing refs are expected for unborn branches and absent upstreams. Process
// failures (including timeouts) must still abort the operation.
fn optional_text(root: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let result = output(Some(root), args)?;
    Ok(result
        .status
        .success()
        .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned()))
}

fn git_version() -> Result<String, String> {
    if let Some(version) = GIT_VERSION.get() {
        return Ok(version.clone());
    }
    let result = output(None, &["--version"])?;
    if !result.status.success() {
        return Err(error_text(&result));
    }
    let version = String::from_utf8_lossy(&result.stdout).trim().to_owned();
    let _ = GIT_VERSION.set(version.clone());
    Ok(version)
}

pub fn bootstrap() -> BootstrapInfo {
    match git_version() {
        Ok(version) => BootstrapInfo {
            git_available: true,
            git_version: Some(version),
            error: None,
        },
        Err(error) => BootstrapInfo {
            git_available: false,
            git_version: None,
            error: Some(error),
        },
    }
}

pub(crate) fn repository_root(path: &str) -> Result<PathBuf, String> {
    let input = Path::new(path);
    if !input.is_dir() {
        return Err("仓库路径不存在，或不是一个文件夹。".to_owned());
    }
    let root = run_text(input, &["rev-parse", "--show-toplevel"])
        .map_err(|error| format!("无法打开 Git 仓库：{error}"))?;
    PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("无法访问仓库路径：{error}"))
}

fn with_repository<T>(
    path: &str,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let root = repository_root(path)?;
    let lock = REPO_LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "仓库锁不可用，请重新启动应用。".to_owned())?
        .entry(root.clone())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _guard = lock
        .lock()
        .map_err(|_| "仓库操作未正常结束，请重新打开仓库。".to_owned())?;
    action(&root)
}

fn parse_status(bytes: &[u8]) -> Result<Vec<GitFile>, String> {
    let mut records = bytes.split(|byte| *byte == 0);
    let mut files = Vec::new();
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if record.len() < 4 || record[2] != b' ' {
            return Err("Git 返回了无法识别的文件状态。".to_owned());
        }
        let index = record[0] as char;
        let worktree = record[1] as char;
        let path = std::str::from_utf8(&record[3..])
            .map_err(|_| "当前版本暂不支持非 UTF-8 编码的文件名。".to_owned())?
            .to_owned();
        let old_path = if index == 'R' || index == 'C' || worktree == 'R' || worktree == 'C' {
            let old = records
                .next()
                .ok_or_else(|| "Git 重命名状态缺少原路径。".to_owned())?;
            Some(
                std::str::from_utf8(old)
                    .map_err(|_| "当前版本暂不支持非 UTF-8 编码的文件名。".to_owned())?
                    .to_owned(),
            )
        } else {
            None
        };
        let untracked = index == '?' && worktree == '?';
        let conflicted = index == 'U'
            || worktree == 'U'
            || (index == 'A' && worktree == 'A')
            || (index == 'D' && worktree == 'D');
        files.push(GitFile {
            path,
            old_path,
            index_status: index.to_string(),
            worktree_status: worktree.to_string(),
            staged: !untracked && !conflicted && index != ' ',
            unstaged: untracked || conflicted || worktree != ' ',
            untracked,
            conflicted,
        });
    }
    Ok(files)
}

fn snapshot(root: &Path) -> Result<RepositorySnapshot, String> {
    let files = parse_status(&run(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?)?;
    let branch_data = run_text(
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%00%(HEAD)%00%(refname)%00%(committerdate:iso-strict)%00%(objectname)%00%(upstream)%00%(upstream:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let branch_refs: Vec<Vec<&str>> = branch_data
        .lines()
        .map(|line| line.split('\0').collect::<Vec<_>>())
        .filter(|fields| fields.len() == 7)
        .collect();
    let current = branch_refs.iter().find(|fields| fields[1] == "*");
    let (head, branch) = match current {
        Some(fields) => (
            Some(fields[4].to_owned()),
            fields[2]
                .strip_prefix("refs/heads/")
                .unwrap_or(fields[0])
                .to_owned(),
        ),
        None => {
            // Detached and unborn HEADs do not appear as a current branch ref.
            let head = optional_text(root, &["rev-parse", "--verify", "HEAD"])?;
            let branch = optional_text(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?
                .unwrap_or_else(|| {
                    head.as_ref()
                        .map(|hash| format!("detached@{}", &hash[..7]))
                        .unwrap_or_else(|| "HEAD".to_owned())
                });
            (head, branch)
        }
    };
    let mut branches: Vec<GitBranch> = branch_refs
        .iter()
        .filter_map(|fields| {
            let name = fields[0];
            if name.ends_with("/HEAD") {
                return None;
            }
            Some(GitBranch {
                name: name.to_owned(),
                current: fields[1] == "*",
                remote: fields[2].starts_with("refs/remotes/"),
                last_commit_date: (!fields[3].is_empty()).then(|| fields[3].to_owned()),
            })
        })
        .collect();
    if head.is_none() && !branches.iter().any(|entry| entry.current) {
        branches.insert(
            0,
            GitBranch {
                name: branch.clone(),
                current: true,
                remote: false,
                last_commit_date: None,
            },
        );
    }
    let upstream = match current.filter(|fields| !fields[5].is_empty()) {
        Some(fields) => {
            let hash = match branch_refs.iter().find(|entry| entry[2] == fields[5]) {
                Some(reference) => Some(reference[4].to_owned()),
                // Preserve support for custom fetch mappings outside refs/remotes.
                None => optional_text(
                    root,
                    &[
                        "rev-parse",
                        "--verify",
                        &format!("{}^{{commit}}", fields[5]),
                    ],
                )?,
            };
            hash.map(|hash| GitUpstream {
                name: fields[6].to_owned(),
                hash,
            })
        }
        None => None,
    };
    let has_upstream = upstream.is_some();
    let commits = history::read_history(root, head.as_deref(), &branch, upstream.as_ref())?;
    let counts = if has_upstream {
        optional_text(
            root,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        )?
        .unwrap_or_default()
    } else {
        String::new()
    };
    let mut counts = counts.split_whitespace();
    let ahead = counts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = counts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let remote_names = run_text(root, &["remote"])?;
    let remote_name = remote_names
        .lines()
        .find(|name| *name == "origin")
        .or_else(|| remote_names.lines().next());
    let remote = match remote_name {
        Some(name) => optional_text(root, &["remote", "get-url", name])?,
        None => None,
    };
    let stash_data = run_text(root, &["stash", "list", "--format=%H"])?;
    let stash_count = stash_data.lines().count();
    let git_dir = PathBuf::from(run_text(root, &["rev-parse", "--absolute-git-dir"])?);
    let operation = [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
        ("BISECT_LOG", "bisect"),
    ]
    .iter()
    .find(|(file, _)| git_dir.join(file).exists())
    .map(|(_, name)| (*name).to_owned());
    let operation_token = operation
        .as_deref()
        .map(|kind| operations::token(&git_dir, kind));
    let display_path = root
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_owned();
    let mut snapshot = RepositorySnapshot {
        revision: String::new(),
        name: root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| display_path.clone()),
        path: display_path,
        branch,
        head,
        git_version: git_version()?,
        files,
        branches,
        commits,
        stash_count,
        stash_revision: revision::hash(&stash_data),
        remote,
        has_upstream,
        upstream,
        ahead,
        behind,
        operation,
        operation_token,
    };
    snapshot.revision = revision::fingerprint(root, &git_dir, &snapshot);
    Ok(snapshot)
}

pub fn open_repository(path: &str) -> Result<RepositorySnapshot, String> {
    with_repository(path, snapshot)
}

fn validate_files(files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Err("请先选择文件。".to_owned());
    }
    for file in files {
        if file.is_empty()
            || Path::new(file).components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err("文件路径必须是仓库中的相对路径。".to_owned());
        }
    }
    Ok(())
}

pub fn open_repository_directory(path: &str) -> Result<(), String> {
    let root = repository_root(path)?;
    #[cfg(windows)]
    let mut opener = {
        use std::os::windows::process::CommandExt;
        let display = root.to_string_lossy();
        let directory = if let Some(unc) = display.strip_prefix("\\\\?\\UNC\\") {
            format!("\\\\{unc}")
        } else {
            display
                .strip_prefix("\\\\?\\")
                .unwrap_or(&display)
                .to_owned()
        };
        let mut command = Command::new("explorer.exe");
        command.arg(directory).creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut opener = {
        let mut command = Command::new("open");
        command.arg(&root);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut opener = {
        let mut command = Command::new("xdg-open");
        command.arg(&root);
        command
    };
    opener
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开系统文件管理器：{error}"))
}

pub fn read_diff(path: &str, file: &str, staged: bool) -> Result<String, String> {
    validate_files(&[file.to_owned()])?;
    with_repository(path, |root| {
        let status = parse_status(&run(
            root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?)?;
        let selected = status.iter().find(|entry| entry.path == file);
        if !staged && selected.is_some_and(|entry| entry.untracked) {
            let null_file = if cfg!(windows) { "NUL" } else { "/dev/null" };
            let result = output(
                Some(root),
                &[
                    "diff",
                    "--no-index",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--diff-algorithm=myers",
                    "--no-indent-heuristic",
                    "--",
                    null_file,
                    file,
                ],
            )?;
            if result.status.success() || result.status.code() == Some(1) {
                return Ok(String::from_utf8_lossy(&result.stdout).into_owned());
            }
            return Err(error_text(&result));
        }
        let mut args = vec![
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--diff-algorithm=myers",
            "--no-indent-heuristic",
        ];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", file]);
        if let Some(old_path) = selected.and_then(|entry| entry.old_path.as_deref()) {
            args.push(old_path);
        }
        let bytes = run(root, &args)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    })
}

pub fn read_staged_diff(path: &str) -> Result<String, String> {
    const MAX_DIFF_CHARS: usize = 30_000;
    with_repository(path, |root| {
        let bytes = run(
            root,
            &[
                "diff",
                "--cached",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--unified=3",
            ],
        )?;
        let diff = String::from_utf8_lossy(&bytes).into_owned();
        if diff.chars().count() <= MAX_DIFF_CHARS {
            return Ok(diff);
        }

        let mut bounded: String = diff.chars().take(MAX_DIFF_CHARS).collect();
        bounded.push_str("\n\n[差异内容过长，后续部分已省略]");
        Ok(bounded)
    })
}

pub fn stage_files(path: &str, files: &[String]) -> Result<RepositorySnapshot, String> {
    validate_files(files)?;
    with_repository(path, |root| {
        let mut args = vec!["add", "--"];
        args.extend(files.iter().map(String::as_str));
        run(root, &args)?;
        snapshot(root)
    })
}

pub fn unstage_files(path: &str, files: &[String]) -> Result<RepositorySnapshot, String> {
    validate_files(files)?;
    with_repository(path, |root| {
        let status = parse_status(&run(root, &["status", "--porcelain=v1", "-z"])?)?;
        let mut paths = files.to_vec();
        for entry in &status {
            if entry.index_status == "R" && files.contains(&entry.path) {
                if let Some(old_path) = &entry.old_path {
                    if !paths.contains(old_path) {
                        paths.push(old_path.clone());
                    }
                }
            }
        }
        let has_head = optional_text(root, &["rev-parse", "--verify", "HEAD"])?.is_some();
        let mut args = if has_head {
            vec!["reset", "--quiet", "HEAD", "--"]
        } else {
            vec!["rm", "--cached", "--quiet", "--force", "--"]
        };
        args.extend(paths.iter().map(String::as_str));
        run(root, &args)?;
        snapshot(root)
    })
}

pub fn discard_changes(path: &str, files: &[String]) -> Result<RepositorySnapshot, String> {
    validate_files(files)?;
    with_repository(path, |root| {
        let status = parse_status(&run(
            root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?)?;
        let mut tracked = Vec::new();
        let mut untracked = Vec::new();

        for file in files {
            let entry = status
                .iter()
                .find(|entry| entry.path == *file)
                .ok_or_else(|| format!("{file} 已没有未暂存更改，请刷新后重试。"))?;
            if entry.conflicted {
                return Err(format!("{file} 存在合并冲突，请先解决冲突后再撤回。"));
            }
            if !entry.unstaged && !entry.untracked {
                return Err(format!("{file} 已没有未暂存更改，请刷新后重试。"));
            }
            if entry.untracked {
                untracked.push(file.as_str());
            } else if entry.unstaged {
                tracked.push(file.as_str());
            }
        }

        if !tracked.is_empty() {
            let mut args = vec!["restore", "--worktree", "--"];
            args.extend(tracked);
            run(root, &args)?;
        }
        if !untracked.is_empty() {
            let mut args = vec!["clean", "-f", "--"];
            args.extend(untracked);
            run(root, &args)?;
        }
        snapshot(root)
    })
}

pub fn create_commit(path: &str, message: &str) -> Result<RepositorySnapshot, String> {
    if message.trim().is_empty() {
        return Err("请输入提交信息。".to_owned());
    }
    with_repository(path, |root| {
        run(root, &["commit", "-m", message])?;
        snapshot(root)
    })
}

pub fn checkout_branch(
    path: &str,
    branch: &str,
    remote: bool,
) -> Result<RepositorySnapshot, String> {
    with_repository(path, |root| {
        let current = snapshot(root)?;
        if current.operation.is_some() || current.files.iter().any(|file| file.conflicted) {
            return Err("请先完成当前 Git 操作和冲突处理，再切换分支。".to_owned());
        }
        if remote {
            let target = merge_target::resolve_remote_branch(root, branch)?;
            merge_target::prepare_target(root, &current.branch, &target)?;
        } else {
            run(root, &["check-ref-format", "--branch", branch])?;
            run(root, &["switch", "--", branch])?;
        }
        snapshot(root)
    })
}

pub fn create_branch(path: &str, branch: &str) -> Result<RepositorySnapshot, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("请输入新分支名称。".to_owned());
    }
    with_repository(path, |root| {
        run(root, &["check-ref-format", "--branch", branch])?;
        let current = snapshot(root)?;
        if current.operation.is_some() || current.files.iter().any(|file| file.conflicted) {
            return Err("请先完成当前 Git 操作和冲突处理，再创建分支。".to_owned());
        }
        run(root, &["switch", "-c", branch])?;
        snapshot(root)
    })
}

pub fn fetch_repository(path: &str) -> Result<RepositorySnapshot, String> {
    with_repository(path, |root| {
        let remotes = run_text(root, &["remote"])?;
        if remotes.is_empty() {
            return Err("此仓库尚未配置远程仓库。".to_owned());
        }
        run(root, &["fetch", "--all", "--prune"])?;
        snapshot(root)
    })
}

pub fn pull_repository(path: &str) -> Result<PullResult, String> {
    with_repository(path, |root| {
        let current = snapshot(root)?;
        if current.operation.is_some() || current.files.iter().any(|file| file.conflicted) {
            return Err("请先完成当前 Git 操作和冲突处理，再拉取更新。".to_owned());
        }
        if current.branch.starts_with("detached@") {
            return Err("游离 HEAD 状态无法拉取，请先切换到本地分支。".to_owned());
        }
        if !current.has_upstream {
            return Err("当前分支尚未设置上游分支，无法拉取更新。".to_owned());
        }

        let result = output(Some(root), &["pull", "--no-rebase", "--no-edit"])?;
        if result.status.success() {
            return Ok(PullResult {
                snapshot: snapshot(root)?,
                conflicted: false,
                error: None,
            });
        }

        let message = error_text(&result);
        let state = snapshot(root)?;
        let conflicted = state.operation.as_deref() == Some("merge")
            && state.files.iter().any(|file| file.conflicted);
        Ok(PullResult {
            snapshot: state,
            conflicted,
            error: (!conflicted).then_some(message),
        })
    })
}

pub fn push_repository(path: &str) -> Result<RepositorySnapshot, String> {
    with_repository(path, |root| {
        let remotes = run_text(root, &["remote"])?;
        let remote = remotes
            .lines()
            .find(|name| *name == "origin")
            .or_else(|| remotes.lines().next())
            .ok_or_else(|| "此仓库尚未配置远程仓库。".to_owned())?;
        if optional_text(root, &["rev-parse", "--verify", "HEAD"])?.is_none() {
            return Err("当前分支还没有提交，无法推送。".to_owned());
        }
        if optional_text(root, &["symbolic-ref", "--quiet", "HEAD"])?.is_none() {
            return Err("游离 HEAD 状态无法推送，请先切换到本地分支。".to_owned());
        }
        let has_upstream = optional_text(
            root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )?
        .is_some();
        if has_upstream {
            run(root, &["push"])?;
        } else {
            run(root, &["push", "--set-upstream", remote, "HEAD"])?;
        }
        snapshot(root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    pub(super) fn repo() -> TempDir {
        let directory = tempfile::tempdir().unwrap();
        run(directory.path(), &["init", "-b", "main"]).unwrap();
        // Fixtures use LF unless a test explicitly exercises CRLF conversion.
        run(directory.path(), &["config", "core.autocrlf", "false"]).unwrap();
        run(directory.path(), &["config", "user.name", "esaygit test"]).unwrap();
        run(
            directory.path(),
            &["config", "user.email", "test@esaygit.local"],
        )
        .unwrap();
        run(directory.path(), &["config", "commit.gpgsign", "false"]).unwrap();
        directory
    }

    #[test]
    fn branch_snapshots_include_tip_commit_dates_for_local_and_remote_branches() {
        let directory = repo();
        let root = directory.path();
        assert!(snapshot(root).unwrap().branches[0]
            .last_commit_date
            .is_none());
        for (date, message) in [
            ("2025-01-15T10:00:00+08:00", "old"),
            ("2026-10-20T10:00:00+08:00", "recent"),
        ] {
            let mut process = command(Some(root));
            process
                .args(["commit", "--allow-empty", "-m", message])
                .env("GIT_AUTHOR_DATE", date)
                .env("GIT_COMMITTER_DATE", date);
            let result =
                crate::process::output_with_timeout(&mut process, Duration::from_secs(30)).unwrap();
            assert!(result.status.success(), "{}", error_text(&result));
            if message == "old" {
                run(root, &["branch", "legacy"]).unwrap();
                run(root, &["update-ref", "refs/remotes/origin/legacy", "HEAD"]).unwrap();
            }
        }
        run(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        let state = snapshot(root).unwrap();
        for name in ["legacy", "origin/legacy"] {
            let branch = state
                .branches
                .iter()
                .find(|branch| branch.name == name)
                .unwrap();
            assert!(branch
                .last_commit_date
                .as_deref()
                .unwrap()
                .starts_with("2025-01-15T10:00:00+08:00"));
            assert_eq!(branch.remote, name.starts_with("origin/"));
        }
        assert_eq!(
            state.branches[0].last_commit_date.as_deref(),
            Some("2026-10-20T10:00:00+08:00")
        );
        assert!(
            state
                .branches
                .iter()
                .find(|branch| branch.name == "main")
                .unwrap()
                .current
        );
    }

    #[test]
    fn unicode_paths_and_unborn_stage_unstage_commit() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        let filename = "中文 file.txt";
        fs::write(directory.path().join(filename), "first line\n").unwrap();
        let initial = open_repository(path).unwrap();
        assert!(initial.head.is_none());
        assert_eq!(initial.branch, "main");
        assert_eq!(initial.files[0].path, filename);
        assert!(initial.files[0].untracked);
        assert!(read_diff(path, filename, false)
            .unwrap()
            .contains("+first line"));
        let staged = stage_files(path, &[filename.to_owned()]).unwrap();
        assert!(staged.files[0].staged);
        assert!(read_diff(path, filename, true)
            .unwrap()
            .contains("+first line"));
        let unstaged = unstage_files(path, &[filename.to_owned()]).unwrap();
        assert!(unstaged.files[0].untracked);
        assert!(directory.path().join(filename).exists());
        stage_files(path, &[filename.to_owned()]).unwrap();
        let committed = create_commit(path, "first commit").unwrap();
        assert!(committed.head.is_some());
        assert!(committed.files.is_empty());
        assert_eq!(committed.commits[0].subject, "first commit");
        fs::write(directory.path().join(filename), "second line\n").unwrap();
        assert!(read_diff(path, filename, false)
            .unwrap()
            .contains("+second line"));
        stage_files(path, &[filename.to_owned()]).unwrap();
        let restored = unstage_files(path, &[filename.to_owned()]).unwrap();
        assert!(!restored.files[0].staged);
        assert!(restored.files[0].unstaged);
        assert_eq!(
            fs::read_to_string(directory.path().join(filename)).unwrap(),
            "second line\n"
        );
    }

    #[test]
    fn staged_diff_excludes_unstaged_worktree_changes() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        let filename = "tracked.txt";
        fs::write(directory.path().join(filename), "base\n").unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();

        fs::write(directory.path().join(filename), "staged content\n").unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        fs::write(directory.path().join(filename), "unstaged content\n").unwrap();
        fs::write(directory.path().join("unstaged.txt"), "untracked content\n").unwrap();

        let diff = read_staged_diff(path).unwrap();

        assert!(diff.contains("+staged content"));
        assert!(!diff.contains("unstaged content"));
        assert!(!diff.contains("unstaged.txt"));
    }

    #[test]
    fn renamed_paths_do_not_create_phantom_files() {
        let files = parse_status(b"R  new name.txt\0old name.txt\0?? other.txt\0").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "new name.txt");
        assert_eq!(files[0].old_path.as_deref(), Some("old name.txt"));
        assert!(files[0].staged);
        assert!(files[1].untracked);
    }

    #[test]
    fn conflicted_files_remain_visible_in_working_changes() {
        let files = parse_status(b"UU conflict.txt\0AA added.txt\0DD deleted.txt\0").unwrap();
        assert!(files
            .iter()
            .all(|file| file.conflicted && file.unstaged && !file.staged));
    }

    #[test]
    fn rejects_outside_paths_and_empty_commits() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        assert!(stage_files(path, &["../outside.txt".to_owned()]).is_err());
        assert!(create_commit(path, " ").is_err());
        assert!(fetch_repository(path).unwrap_err().contains("远程"));
        assert!(push_repository(path).unwrap_err().contains("远程"));
    }

    #[test]
    fn fetch_updates_remote_history_and_branches_without_changing_local_work() {
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "--bare", "-b", "main"]).unwrap();
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        run(
            root,
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        )
        .unwrap();
        fs::write(root.join("README.md"), "base\n").unwrap();
        stage_files(path, &["README.md".to_owned()]).unwrap();
        let base = create_commit(path, "shared base").unwrap().head.unwrap();
        push_repository(path).unwrap();

        let contributor = repo();
        let contributor_root = contributor.path();
        run(
            contributor_root,
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        )
        .unwrap();
        fetch_repository(contributor_root.to_str().unwrap()).unwrap();
        run(contributor_root, &["reset", "--hard", "origin/main"]).unwrap();
        run(
            contributor_root,
            &["commit", "--allow-empty", "-m", "remote update"],
        )
        .unwrap();
        let remote_tip = run_text(contributor_root, &["rev-parse", "HEAD"]).unwrap();
        run(
            contributor_root,
            &["push", "origin", "HEAD:main", "HEAD:feature/new"],
        )
        .unwrap();

        fs::write(root.join("README.md"), "staged work\n").unwrap();
        stage_files(path, &["README.md".to_owned()]).unwrap();
        fs::write(root.join("README.md"), "working changes\n").unwrap();
        let index_before = run_text(root, &["rev-parse", ":README.md"]).unwrap();
        let before = open_repository(path).unwrap();
        assert_eq!(before.behind, 0);
        assert!(!before
            .commits
            .iter()
            .any(|commit| commit.hash == remote_tip));

        let after = fetch_repository(path).unwrap();
        assert_eq!(after.head.as_deref(), Some(base.as_str()));
        assert_eq!((after.ahead, after.behind), (0, 1));
        assert_eq!(after.upstream.unwrap().hash, remote_tip);
        assert!(after
            .branches
            .iter()
            .any(|branch| branch.name == "origin/feature/new" && branch.remote));
        let incoming = after
            .commits
            .iter()
            .find(|commit| commit.hash == remote_tip)
            .unwrap();
        assert_eq!(incoming.subject, "remote update");
        assert!(incoming.remote && !incoming.local);
        assert_eq!(
            run_text(root, &["rev-parse", ":README.md"]).unwrap(),
            index_before
        );
        assert_eq!(
            fs::read_to_string(root.join("README.md")).unwrap(),
            "working changes\n"
        );
        assert!(after.files[0].staged && after.files[0].unstaged);
    }

    #[test]
    fn push_sets_upstream_then_sends_later_commits() {
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "--bare", "-b", "main"]).unwrap();
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        let remote_path = remote.path().to_str().unwrap();
        run(directory.path(), &["remote", "add", "origin", remote_path]).unwrap();
        fs::write(directory.path().join("README.md"), "first\n").unwrap();
        stage_files(path, &["README.md".to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();

        let first_push = push_repository(path).unwrap();
        assert!(first_push.has_upstream);
        assert_eq!(first_push.ahead, 0);
        assert_eq!(
            run_text(remote.path(), &["rev-parse", "refs/heads/main"]).unwrap(),
            first_push.head.unwrap()
        );

        fs::write(directory.path().join("README.md"), "second\n").unwrap();
        stage_files(path, &["README.md".to_owned()]).unwrap();
        create_commit(path, "second commit").unwrap();
        assert_eq!(open_repository(path).unwrap().ahead, 1);

        let second_push = push_repository(path).unwrap();
        assert_eq!(second_push.ahead, 0);
        assert_eq!(
            run_text(remote.path(), &["rev-parse", "refs/heads/main"]).unwrap(),
            second_push.head.unwrap()
        );
    }

    #[test]
    fn unstaging_modified_unborn_file_keeps_working_contents() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        let filename = "draft.txt";
        fs::write(directory.path().join(filename), "staged\n").unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        fs::write(directory.path().join(filename), "new working content\n").unwrap();
        let result = unstage_files(path, &[filename.to_owned()]).unwrap();
        assert!(result.files[0].untracked);
        assert_eq!(
            fs::read_to_string(directory.path().join(filename)).unwrap(),
            "new working content\n"
        );
    }

    #[test]
    fn discarding_worktree_changes_keeps_staged_contents() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        let filename = "tracked.txt";
        fs::write(directory.path().join(filename), "base\n").unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();
        fs::write(directory.path().join(filename), "staged contents\n").unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        fs::write(directory.path().join(filename), "unstaged contents\n").unwrap();

        let restored = discard_changes(path, &[filename.to_owned()]).unwrap();

        assert_eq!(
            fs::read_to_string(directory.path().join(filename)).unwrap(),
            "staged contents\n"
        );
        assert_eq!(restored.files.len(), 1);
        assert!(restored.files[0].staged);
        assert!(!restored.files[0].unstaged);
        assert!(read_diff(path, filename, true)
            .unwrap()
            .contains("+staged contents"));
        assert!(read_diff(path, filename, false).unwrap().is_empty());
    }

    #[test]
    fn discarding_untracked_file_removes_only_that_file() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        fs::write(directory.path().join("remove.txt"), "remove me\n").unwrap();
        fs::write(directory.path().join("keep.txt"), "keep me\n").unwrap();

        let restored = discard_changes(path, &["remove.txt".to_owned()]).unwrap();

        assert!(!directory.path().join("remove.txt").exists());
        assert!(directory.path().join("keep.txt").exists());
        assert_eq!(restored.files.len(), 1);
        assert_eq!(restored.files[0].path, "keep.txt");
    }

    #[test]
    fn bulk_discard_rejects_conflicts_before_restoring_any_file() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        fs::write(directory.path().join("conflict.txt"), "base\n").unwrap();
        fs::write(directory.path().join("other.txt"), "base\n").unwrap();
        stage_files(path, &["conflict.txt".to_owned(), "other.txt".to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();
        run(directory.path(), &["branch", "feature"]).unwrap();
        fs::write(directory.path().join("conflict.txt"), "main change\n").unwrap();
        stage_files(path, &["conflict.txt".to_owned()]).unwrap();
        create_commit(path, "main change").unwrap();
        run(directory.path(), &["switch", "feature"]).unwrap();
        fs::write(directory.path().join("conflict.txt"), "feature change\n").unwrap();
        stage_files(path, &["conflict.txt".to_owned()]).unwrap();
        create_commit(path, "feature change").unwrap();
        run(directory.path(), &["switch", "main"]).unwrap();
        assert!(run(directory.path(), &["merge", "feature"]).is_err());
        fs::write(directory.path().join("other.txt"), "keep this change\n").unwrap();

        let result = discard_changes(path, &["other.txt".to_owned(), "conflict.txt".to_owned()]);

        assert!(result.unwrap_err().contains("合并冲突"));
        assert_eq!(
            fs::read_to_string(directory.path().join("other.txt")).unwrap(),
            "keep this change\n"
        );
    }

    #[test]
    fn unstaging_rename_restores_both_index_paths() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        fs::write(directory.path().join("old.txt"), "hello\n").unwrap();
        stage_files(path, &["old.txt".to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();
        run(directory.path(), &["mv", "old.txt", "new.txt"]).unwrap();
        let before = open_repository(path).unwrap();
        assert_eq!(before.files[0].index_status, "R");
        let after = unstage_files(path, &["new.txt".to_owned()]).unwrap();
        assert!(after.files.iter().all(|file| !file.staged));
        assert!(directory.path().join("new.txt").exists());
        assert!(!directory.path().join("old.txt").exists());
    }

    #[test]
    fn worktree_snapshot_and_branch_switch() {
        let directory = repo();
        let path = directory.path().to_str().unwrap();
        fs::write(directory.path().join("README.md"), "hello\n").unwrap();
        stage_files(path, &["README.md".to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();
        run(directory.path(), &["branch", "feature"]).unwrap();
        assert_eq!(
            checkout_branch(path, "feature", false).unwrap().branch,
            "feature"
        );
        let worktree = tempfile::tempdir().unwrap();
        let worktree_path = worktree.path().join("linked");
        run(
            directory.path(),
            &["worktree", "add", worktree_path.to_str().unwrap(), "main"],
        )
        .unwrap();
        let snapshot = open_repository(worktree_path.to_str().unwrap()).unwrap();
        assert_eq!(snapshot.branch, "main");
        assert_eq!(snapshot.commits[0].subject, "initial");
    }
}
