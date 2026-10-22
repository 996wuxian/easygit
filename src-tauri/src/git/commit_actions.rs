use super::{
    error_text, optional_text, output, run, run_text, snapshot, with_repository, RepositorySnapshot,
};
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommitAction {
    Soft,
    Mixed,
    Revert,
}

pub fn act_on_commit(
    path: &str,
    commit: &str,
    expected_head: &str,
    expected_branch: &str,
    action: CommitAction,
) -> Result<RepositorySnapshot, String> {
    if [commit, expected_head].iter().any(|hash| {
        !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Err("提交标识无效，请刷新提交记录。".to_owned());
    }
    with_repository(path, |root| {
        let state = snapshot(root)?;
        if state.head.as_deref() != Some(expected_head) || state.branch != expected_branch {
            return Err("当前分支或提交已变化，请刷新记录后重新操作。".to_owned());
        }
        let branch_ref = optional_text(root, &["symbolic-ref", "--quiet", "HEAD"])?
            .ok_or("游离 HEAD 状态下不能撤回提交，请先切换到本地分支。")?;
        if state.operation.is_some() || state.files.iter().any(|file| file.conflicted) {
            return Err("请先完成当前合并、变基或冲突处理，再撤回提交。".to_owned());
        }
        let ancestry = output(
            Some(root),
            &["merge-base", "--is-ancestor", commit, expected_head],
        )?;
        match ancestry.status.code() {
            Some(0) => {}
            Some(1) => return Err("所选提交不属于当前本地分支。".to_owned()),
            _ => return Err(error_text(&ancestry)),
        }
        if !matches!(action, CommitAction::Revert)
            && !run_text(
                root,
                &[
                    "for-each-ref",
                    "--format=%(refname)",
                    "--contains",
                    commit,
                    "refs/remotes",
                ],
            )?
            .is_empty()
        {
            return Err("该提交已包含在远端跟踪分支中，不能通过此菜单撤回。".to_owned());
        }
        match action {
            CommitAction::Soft | CommitAction::Mixed => {
                if commit != expected_head {
                    return Err(
                        "仅支持将当前分支最新提交撤回到暂存区或工作区；较早提交请使用反向提交。"
                            .to_owned(),
                    );
                }
                let parent = optional_text(root, &["rev-parse", "--verify", "HEAD^1"])?;
                if let Some(parent) = parent {
                    let mode = if matches!(action, CommitAction::Soft) {
                        "--soft"
                    } else {
                        "--mixed"
                    };
                    run(root, &["reset", mode, &parent])?;
                } else {
                    // Undoing the first commit returns to an unborn branch without deleting files.
                    run(root, &["update-ref", "ORIG_HEAD", expected_head])?;
                    run(root, &["update-ref", "-d", &branch_ref, expected_head])?;
                    if matches!(action, CommitAction::Mixed) {
                        if let Err(error) = run(root, &["read-tree", "--empty"]) {
                            let absent = "0".repeat(expected_head.len());
                            if run(root, &["update-ref", &branch_ref, expected_head, &absent])
                                .is_err()
                            {
                                return Err(format!(
                                    "撤回未完成且分支恢复失败，原提交保存在 ORIG_HEAD。{error}"
                                ));
                            }
                            return Err(format!("暂存区无法更新，已恢复原提交。{error}"));
                        }
                    }
                }
            }
            CommitAction::Revert => {
                if !state.files.is_empty() {
                    return Err("反向提交需要干净的工作区，请先处理未提交更改。".to_owned());
                }
                let parents = run_text(root, &["rev-list", "--parents", "-n", "1", commit])?;
                if parents.split_whitespace().count() > 2 {
                    return Err("合并提交需要选择主线父提交，暂不支持从此菜单反向提交。".to_owned());
                }
                let result = output(Some(root), &["revert", "--no-edit", commit])?;
                if !result.status.success() {
                    let detail = error_text(&result);
                    if optional_text(root, &["rev-parse", "--verify", "REVERT_HEAD"])?.as_deref()
                        == Some(commit)
                    {
                        if run(root, &["revert", "--abort"]).is_ok() {
                            return Err(format!("反向提交发生冲突，已取消并恢复原状态。{detail}"));
                        }
                        return Err(format!(
                            "反向提交发生冲突且自动取消失败，请先处理当前 revert 状态。{detail}"
                        ));
                    }
                    return Err(detail);
                }
            }
        }
        snapshot(root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{run_text, tests::repo};
    use std::{fs, path::Path};

    fn commit_file(root: &Path, file: &str, text: &str, message: &str) -> String {
        fs::write(root.join(file), text).unwrap();
        run(root, &["add", "--", file]).unwrap();
        run(root, &["commit", "-m", message]).unwrap();
        run_text(root, &["rev-parse", "HEAD"]).unwrap()
    }

    #[test]
    fn soft_undo_preserves_index_worktree_and_untracked_files() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let base = commit_file(root, "file.txt", "base\n", "base");
        let tip = commit_file(root, "file.txt", "committed\n", "feature");
        fs::write(root.join("file.txt"), "unstaged\n").unwrap();
        fs::write(root.join("extra.txt"), "staged extra\n").unwrap();
        run(root, &["add", "extra.txt"]).unwrap();
        fs::write(root.join("untracked.txt"), "keep me\n").unwrap();
        let state = act_on_commit(path, &tip, &tip, "main", CommitAction::Soft).unwrap();
        assert_eq!(state.head.as_deref(), Some(base.as_str()));
        assert_eq!(run_text(root, &["show", ":file.txt"]).unwrap(), "committed");
        assert_eq!(
            run_text(root, &["show", ":extra.txt"]).unwrap(),
            "staged extra"
        );
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "unstaged\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("untracked.txt")).unwrap(),
            "keep me\n"
        );
        assert_eq!(run_text(root, &["rev-parse", "ORIG_HEAD"]).unwrap(), tip);
    }

    #[test]
    fn mixed_undo_unstages_changes_without_changing_working_files() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let base = commit_file(root, "file.txt", "base\n", "base");
        let tip = commit_file(root, "file.txt", "committed\n", "feature");
        fs::write(root.join("extra.txt"), "extra\n").unwrap();
        run(root, &["add", "extra.txt"]).unwrap();
        let state = act_on_commit(path, &tip, &tip, "main", CommitAction::Mixed).unwrap();
        assert_eq!(state.head.as_deref(), Some(base.as_str()));
        assert!(state.files.iter().all(|file| !file.staged));
        assert_eq!(run_text(root, &["show", ":file.txt"]).unwrap(), "base");
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "committed\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("extra.txt")).unwrap(),
            "extra\n"
        );
    }

    #[test]
    fn undoing_the_first_commit_keeps_files_and_a_recovery_reference() {
        for action in [CommitAction::Soft, CommitAction::Mixed] {
            let directory = repo();
            let root = directory.path();
            let path = root.to_str().unwrap();
            let tip = commit_file(root, "file.txt", "initial\n", "initial");
            let state = act_on_commit(path, &tip, &tip, "main", action).unwrap();
            assert!(state.head.is_none());
            assert_eq!(state.branch, "main");
            assert_eq!(state.files[0].staged, matches!(action, CommitAction::Soft));
            assert_eq!(
                fs::read_to_string(root.join("file.txt")).unwrap(),
                "initial\n"
            );
            assert_eq!(run_text(root, &["rev-parse", "ORIG_HEAD"]).unwrap(), tip);
        }
    }

    #[test]
    fn first_commit_mixed_undo_restores_the_branch_when_the_index_is_locked() {
        let directory = repo();
        let root = directory.path();
        let tip = commit_file(root, "file.txt", "initial\n", "initial");
        fs::write(root.join(".git/index.lock"), "another operation").unwrap();
        let error = act_on_commit(
            root.to_str().unwrap(),
            &tip,
            &tip,
            "main",
            CommitAction::Mixed,
        )
        .unwrap_err();
        assert!(error.contains("已恢复原提交"));
        assert_eq!(run_text(root, &["rev-parse", "HEAD"]).unwrap(), tip);
        assert_eq!(run_text(root, &["show", ":file.txt"]).unwrap(), "initial");
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "initial\n"
        );
    }

    #[test]
    fn rejects_stale_published_and_non_tip_undo_requests() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let base = commit_file(root, "file.txt", "base\n", "base");
        let tip = commit_file(root, "file.txt", "feature\n", "feature");
        assert!(act_on_commit(path, &tip, &base, "main", CommitAction::Soft)
            .unwrap_err()
            .contains("已变化"));
        assert!(
            act_on_commit(path, &tip, &tip, "another", CommitAction::Soft)
                .unwrap_err()
                .contains("已变化")
        );
        assert!(act_on_commit(path, &base, &tip, "main", CommitAction::Soft)
            .unwrap_err()
            .contains("最新"));
        run(root, &["update-ref", "refs/remotes/other/published", &tip]).unwrap();
        assert!(act_on_commit(path, &tip, &tip, "main", CommitAction::Mixed)
            .unwrap_err()
            .contains("远端"));
        assert_eq!(run_text(root, &["rev-parse", "HEAD"]).unwrap(), tip);
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "feature\n"
        );
        let reverted = act_on_commit(path, &tip, &tip, "main", CommitAction::Revert).unwrap();
        assert_eq!(reverted.commits[0].parents, vec![tip]);
        assert_eq!(fs::read_to_string(root.join("file.txt")).unwrap(), "base\n");
    }

    #[test]
    fn reverting_an_older_commit_preserves_later_commits_and_work() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        commit_file(root, "file.txt", "base\n", "base");
        let feature = commit_file(root, "file.txt", "feature\n", "feature");
        let later = commit_file(root, "later.txt", "later work\n", "later");
        let state = act_on_commit(path, &feature, &later, "main", CommitAction::Revert).unwrap();
        assert_ne!(state.head.as_deref(), Some(later.as_str()));
        assert_eq!(state.commits[0].parents, vec![later]);
        assert!(state.commits.iter().any(|commit| commit.hash == feature));
        assert!(state.files.is_empty());
        assert_eq!(fs::read_to_string(root.join("file.txt")).unwrap(), "base\n");
        assert_eq!(
            fs::read_to_string(root.join("later.txt")).unwrap(),
            "later work\n"
        );
    }

    #[test]
    fn revert_rejects_dirty_work_and_aborts_conflicts_without_losing_changes() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        commit_file(root, "file.txt", "base\n", "base");
        let feature = commit_file(root, "file.txt", "feature\n", "feature");
        let later = commit_file(root, "file.txt", "later\n", "later");
        fs::write(root.join("untracked.txt"), "keep\n").unwrap();
        assert!(
            act_on_commit(path, &feature, &later, "main", CommitAction::Revert)
                .unwrap_err()
                .contains("干净")
        );
        fs::remove_file(root.join("untracked.txt")).unwrap();
        assert!(
            act_on_commit(path, &feature, &later, "main", CommitAction::Revert)
                .unwrap_err()
                .contains("已取消并恢复")
        );
        assert_eq!(run_text(root, &["rev-parse", "HEAD"]).unwrap(), later);
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "later\n"
        );
        assert!(run_text(root, &["status", "--porcelain"])
            .unwrap()
            .is_empty());
        assert!(
            optional_text(root, &["rev-parse", "--verify", "REVERT_HEAD"])
                .unwrap()
                .is_none()
        );
    }
}
