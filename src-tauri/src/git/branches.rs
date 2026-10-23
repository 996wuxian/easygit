use super::{
    merge::branch_head, optional_text, output, run, run_text, snapshot, with_repository,
    RepositorySnapshot,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub head: String,
    pub upstream: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BranchAction {
    Rename { name: String },
    Delete,
    Upstream { upstream: String },
    UnsetUpstream,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRequest {
    pub branch: String,
    pub expected_head: String,
    pub expected_upstream: Option<String>,
    pub expected_branch: String,
    pub expected_current_head: Option<String>,
    pub action: BranchAction,
}

fn info(root: &Path, branch: &str) -> Result<BranchInfo, String> {
    let head = branch_head(root, branch, false)?;
    let reference = format!("refs/heads/{branch}");
    let refs = run_text(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(upstream)",
            &reference,
        ],
    )?;
    let upstream = refs
        .lines()
        .filter_map(|line| line.split_once('\0'))
        .find(|(name, _)| *name == reference)
        .and_then(|(_, upstream)| (!upstream.is_empty()).then(|| upstream.to_owned()));
    Ok(BranchInfo { head, upstream })
}

pub fn read_branch_info(path: &str, branch: &str) -> Result<BranchInfo, String> {
    with_repository(path, |root| info(root, branch))
}

pub fn manage_branch(path: &str, request: BranchRequest) -> Result<RepositorySnapshot, String> {
    with_repository(path, |root| {
        let state = snapshot(root)?;
        if state.operation.is_some() || state.files.iter().any(|file| file.conflicted) {
            return Err("请先完成当前 Git 操作和冲突处理，再管理分支。".to_owned());
        }
        if state.branch != request.expected_branch || state.head != request.expected_current_head {
            return Err("当前分支或提交已变化，请重新打开分支操作。".to_owned());
        }
        let current = info(root, &request.branch)?;
        if current.head != request.expected_head || current.upstream != request.expected_upstream {
            return Err("目标分支或上游已变化，请重新打开分支操作。".to_owned());
        }
        let reference = format!("refs/heads/{}", request.branch);
        let worktrees = run_text(root, &["worktree", "list", "--porcelain", "-z"])?;
        let occupied = worktrees
            .split('\0')
            .filter(|field| *field == format!("branch {reference}"))
            .count();
        if occupied > usize::from(state.branch == request.branch) {
            return Err("此分支正在其他 worktree 中使用，请在对应工作区操作。".to_owned());
        }
        match request.action {
            BranchAction::Rename { name } => {
                let name = name.trim();
                if name == request.branch {
                    return Err("新分支名称与原名称相同。".to_owned());
                }
                run(root, &["check-ref-format", "--branch", name])?;
                run(root, &["check-ref-format", &format!("refs/heads/{name}")])?;
                run(root, &["branch", "-m", "--", &request.branch, name])?;
            }
            BranchAction::Delete => {
                if state.branch == request.branch {
                    return Err("不能删除当前分支，请先切换到其他分支。".to_owned());
                }
                let merged = output(
                    Some(root),
                    &["merge-base", "--is-ancestor", &current.head, "HEAD"],
                )?;
                if !merged.status.success() {
                    return Err("此分支尚未完全合并到当前分支，不能删除。".to_owned());
                }
                run(root, &["branch", "-d", "--", &request.branch])?;
            }
            BranchAction::Upstream { upstream } => {
                let reference = super::merge::branch_reference(root, &upstream, true)?;
                branch_head(root, &upstream, true)?;
                if optional_text(root, &["symbolic-ref", "--quiet", &reference])?.is_some() {
                    return Err("请选择实际的远程分支，不能使用远程 HEAD 别名。".to_owned());
                }
                run(
                    root,
                    &[
                        "branch",
                        "--set-upstream-to",
                        &reference,
                        "--",
                        &request.branch,
                    ],
                )?;
            }
            BranchAction::UnsetUpstream => {
                if current.upstream.is_none() {
                    return Err("此分支尚未设置上游。".to_owned());
                }
                run(root, &["branch", "--unset-upstream", "--", &request.branch])?;
            }
        }
        snapshot(root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::repo;
    use std::fs;

    fn setup() -> tempfile::TempDir {
        let directory = repo();
        let root = directory.path();
        fs::write(root.join("file.txt"), "base\n").unwrap();
        run(root, &["add", "."]).unwrap();
        run(root, &["commit", "-m", "base"]).unwrap();
        run(root, &["branch", "topic"]).unwrap();
        directory
    }

    fn request(root: &Path, branch: &str, action: BranchAction) -> BranchRequest {
        let current = info(root, branch).unwrap();
        let state = snapshot(root).unwrap();
        BranchRequest {
            branch: branch.into(),
            expected_head: current.head,
            expected_upstream: current.upstream,
            expected_branch: state.branch,
            expected_current_head: state.head,
            action,
        }
    }

    #[test]
    fn branch_management_rename_preserves_work_and_refuses_overwrite() {
        let directory = setup();
        let root = directory.path();
        let path = root.to_str().unwrap();
        fs::write(root.join("file.txt"), "unfinished\n").unwrap();
        let next = manage_branch(
            path,
            request(
                root,
                "main",
                BranchAction::Rename {
                    name: "renamed".into(),
                },
            ),
        )
        .unwrap();
        assert_eq!(next.branch, "renamed");
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "unfinished\n"
        );
        assert!(manage_branch(
            path,
            request(
                root,
                "renamed",
                BranchAction::Rename {
                    name: "topic".into()
                }
            )
        )
        .is_err());
        assert_eq!(snapshot(root).unwrap().branch, "renamed");
        assert!(manage_branch(
            path,
            request(
                root,
                "renamed",
                BranchAction::Rename {
                    name: "@{-1}".into()
                }
            )
        )
        .is_err());
    }

    #[test]
    fn branch_management_delete_rejects_current_and_unmerged_branches() {
        let directory = setup();
        let root = directory.path();
        let path = root.to_str().unwrap();
        assert!(manage_branch(path, request(root, "main", BranchAction::Delete)).is_err());
        run(root, &["switch", "topic"]).unwrap();
        run(root, &["commit", "--allow-empty", "-m", "unmerged"]).unwrap();
        run(root, &["switch", "main"]).unwrap();
        assert!(
            manage_branch(path, request(root, "topic", BranchAction::Delete))
                .unwrap_err()
                .contains("尚未完全合并")
        );
        run(root, &["merge", "--ff-only", "topic"]).unwrap();
        let next = manage_branch(path, request(root, "topic", BranchAction::Delete)).unwrap();
        assert!(!next.branches.iter().any(|branch| branch.name == "topic"));
    }

    #[test]
    fn branch_management_sets_and_unsets_upstream_without_switching() {
        let directory = setup();
        let root = directory.path();
        let path = root.to_str().unwrap();
        run(root, &["remote", "add", "origin", "."]).unwrap();
        run(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        let next = manage_branch(
            path,
            request(
                root,
                "topic",
                BranchAction::Upstream {
                    upstream: "origin/main".into(),
                },
            ),
        )
        .unwrap();
        assert_eq!(next.branch, "main");
        assert_eq!(
            info(root, "topic").unwrap().upstream.as_deref(),
            Some("refs/remotes/origin/main")
        );
        manage_branch(path, request(root, "topic", BranchAction::UnsetUpstream)).unwrap();
        assert!(info(root, "topic").unwrap().upstream.is_none());
        assert!(manage_branch(
            path,
            request(
                root,
                "topic",
                BranchAction::Upstream {
                    upstream: "origin/missing".into()
                }
            )
        )
        .is_err());
        run(
            root,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        )
        .unwrap();
        assert!(manage_branch(
            path,
            request(
                root,
                "topic",
                BranchAction::Upstream {
                    upstream: "origin/HEAD".into()
                }
            )
        )
        .is_err());
        assert!(info(root, "topic").unwrap().upstream.is_none());
    }

    #[test]
    fn branch_management_rejects_stale_tip_and_upstream() {
        let directory = setup();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let pending = request(root, "topic", BranchAction::Delete);
        run(root, &["switch", "topic"]).unwrap();
        run(root, &["commit", "--allow-empty", "-m", "later"]).unwrap();
        run(root, &["switch", "main"]).unwrap();
        assert!(manage_branch(path, pending)
            .unwrap_err()
            .contains("目标分支"));
        let pending = request(root, "topic", BranchAction::Delete);
        run(root, &["remote", "add", "origin", "."]).unwrap();
        run(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        run(root, &["branch", "--set-upstream-to=origin/main", "topic"]).unwrap();
        assert!(manage_branch(path, pending)
            .unwrap_err()
            .contains("上游已变化"));
        assert!(info(root, "topic").is_ok());
    }

    #[test]
    fn branch_management_rejects_other_worktree_and_git_operations() {
        let directory = setup();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let linked = tempfile::tempdir().unwrap();
        let location = linked.path().join("linked");
        run(
            root,
            &["worktree", "add", location.to_str().unwrap(), "topic"],
        )
        .unwrap();
        assert!(manage_branch(
            path,
            request(root, "topic", BranchAction::Rename { name: "new".into() })
        )
        .unwrap_err()
        .contains("worktree"));
        assert!(manage_branch(path, request(root, "topic", BranchAction::Delete)).is_err());
        fs::write(
            root.join(".git/MERGE_HEAD"),
            run_text(root, &["rev-parse", "HEAD"]).unwrap(),
        )
        .unwrap();
        assert!(manage_branch(
            path,
            request(root, "main", BranchAction::Rename { name: "new".into() })
        )
        .unwrap_err()
        .contains("Git 操作"));
    }
}
