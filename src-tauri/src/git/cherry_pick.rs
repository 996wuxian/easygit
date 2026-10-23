use super::{
    inspect::commit_hash,
    operations::{ensure_idle, outcome},
    optional_text, output, run_text, snapshot, with_repository, PullResult,
};

pub fn cherry_pick(
    path: &str,
    commit: &str,
    expected_head: &str,
    expected_branch: &str,
) -> Result<PullResult, String> {
    with_repository(path, |root| {
        let state = snapshot(root)?;
        if state.head.as_deref() != Some(expected_head) || state.branch != expected_branch {
            return Err("目标分支或提交已变化，请重新选择后拣选。".into());
        }
        ensure_idle(&state)?;
        if optional_text(root, &["symbolic-ref", "--quiet", "HEAD"])?.is_none() {
            return Err("请先切换到本地分支，再拣选提交。".into());
        }
        if !state.files.is_empty() {
            return Err("拣选提交需要干净的工作区，请先提交或保存未提交更改。".into());
        }
        let commit = commit_hash(root, commit)?;
        let parents = run_text(root, &["rev-list", "--parents", "-n", "1", &commit])?;
        if parents.split_whitespace().count() > 2 {
            return Err("合并提交需要指定主线父提交，暂不支持拣选。".into());
        }
        let ancestor = output(
            Some(root),
            &["merge-base", "--is-ancestor", &commit, "HEAD"],
        )?;
        match ancestor.status.code() {
            Some(0) => return Err("当前分支已包含此提交，无需重复拣选。".into()),
            Some(1) => {}
            _ => return Err(super::error_text(&ancestor)),
        }
        // Preserve conflicts and empty-pick state for the existing continue/skip/abort workflow.
        let result = output(Some(root), &["cherry-pick", "-x", &commit])?;
        outcome(root, result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{
        act_on_operation,
        operations::{OperationAction, OperationRequest},
        read_conflict, resolve_conflict, run,
        tests::repo,
        ConflictResolution, RepositorySnapshot,
    };
    use std::{fs, path::Path};

    fn commit(root: &Path, file: &str, text: &str) -> String {
        fs::write(root.join(file), text).unwrap();
        run(root, &["add", "."]).unwrap();
        run(root, &["commit", "-m", text]).unwrap();
        run_text(root, &["rev-parse", "HEAD"]).unwrap()
    }
    fn operation(state: &RepositorySnapshot, action: OperationAction) -> OperationRequest {
        OperationRequest {
            operation: "cherry-pick".into(),
            token: state.operation_token.clone().unwrap(),
            revision: state.revision.clone(),
            head: state.head.clone(),
            branch: state.branch.clone(),
            action,
        }
    }
    fn fixture() -> (tempfile::TempDir, String, String) {
        let directory = repo();
        let root = directory.path();
        let base = commit(root, "file.txt", "base\n");
        run(root, &["switch", "-c", "source"]).unwrap();
        let source = commit(root, "file.txt", "source\n");
        run(root, &["switch", "main"]).unwrap();
        (directory, base, source)
    }

    #[test]
    fn cherry_pick_applies_only_selected_commit_and_preserves_source_history() {
        let (directory, _, source) = fixture();
        let root = directory.path();
        run(root, &["switch", "source"]).unwrap();
        let later = commit(root, "later.txt", "not selected\n");
        run(root, &["switch", "main"]).unwrap();
        let target = commit(root, "target.txt", "target work\n");
        let result = cherry_pick(root.to_str().unwrap(), &source, &target, "main").unwrap();
        assert!(result.error.is_none());
        assert!(!result.conflicted);
        assert!(result.snapshot.operation.is_none());
        assert_eq!(result.snapshot.branch, "main");
        assert_eq!(result.snapshot.commits[0].parents, vec![target]);
        assert_ne!(result.snapshot.head.as_deref(), Some(source.as_str()));
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).unwrap(),
            "source\n"
        );
        assert!(!root.join("later.txt").exists());
        assert_eq!(run_text(root, &["rev-parse", "source"]).unwrap(), later);
        assert!(run_text(root, &["log", "-1", "--format=%B"])
            .unwrap()
            .contains(&format!("cherry picked from commit {source}")));
    }

    #[test]
    fn cherry_pick_rejects_dirty_stale_contained_and_invalid_sources_without_writing() {
        let (directory, base, source) = fixture();
        let root = directory.path();
        let path = root.to_str().unwrap();
        fs::write(root.join("untracked.txt"), "keep").unwrap();
        assert!(cherry_pick(path, &source, &base, "main")
            .unwrap_err()
            .contains("干净"));
        assert_eq!(
            fs::read_to_string(root.join("untracked.txt")).unwrap(),
            "keep"
        );
        fs::remove_file(root.join("untracked.txt")).unwrap();
        assert!(cherry_pick(path, &source, &source, "main")
            .unwrap_err()
            .contains("已变化"));
        assert!(cherry_pick(path, &source, &base, "wrong")
            .unwrap_err()
            .contains("已变化"));
        assert!(cherry_pick(path, &base, &base, "main")
            .unwrap_err()
            .contains("已包含"));
        assert!(cherry_pick(path, "HEAD", &base, "main").is_err());
        assert!(cherry_pick(path, &"0".repeat(40), &base, "main").is_err());
        run(root, &["checkout", "--detach"]).unwrap();
        let state = snapshot(root).unwrap();
        assert!(cherry_pick(path, &source, &base, &state.branch)
            .unwrap_err()
            .contains("本地分支"));
        assert_eq!(run_text(root, &["rev-parse", "HEAD"]).unwrap(), base);
    }

    #[test]
    fn cherry_pick_conflicts_can_continue_skip_or_abort() {
        for action in [
            OperationAction::Continue,
            OperationAction::Skip,
            OperationAction::Abort,
        ] {
            let (directory, _, source) = fixture();
            let root = directory.path();
            let path = root.to_str().unwrap();
            let target = commit(root, "file.txt", "target\n");
            let result = cherry_pick(path, &source, &target, "main").unwrap();
            assert!(result.conflicted);
            assert!(result.error.is_some());
            assert_eq!(result.snapshot.operation.as_deref(), Some("cherry-pick"));
            assert!(cherry_pick(path, &source, &target, "main")
                .unwrap_err()
                .contains("Git 操作"));
            let mut state = result.snapshot;
            if matches!(action, OperationAction::Continue) {
                let conflict = read_conflict(path, "file.txt").unwrap();
                state = resolve_conflict(
                    path,
                    "file.txt",
                    &conflict.revision,
                    ConflictResolution::Content,
                    Some("resolved\n"),
                )
                .unwrap();
            }
            let done = act_on_operation(path, operation(&state, action)).unwrap();
            assert!(done.error.is_none());
            assert!(done.snapshot.operation.is_none());
            if matches!(action, OperationAction::Continue) {
                assert_eq!(
                    fs::read_to_string(root.join("file.txt")).unwrap(),
                    "resolved\n"
                );
                assert_eq!(done.snapshot.commits[0].parents, vec![target]);
            } else {
                assert_eq!(done.snapshot.head, Some(target));
                assert_eq!(
                    fs::read_to_string(root.join("file.txt")).unwrap(),
                    "target\n"
                );
            }
        }
    }

    #[test]
    fn cherry_pick_empty_patch_can_be_skipped_without_creating_a_commit() {
        let (directory, _, source) = fixture();
        let root = directory.path();
        let path = root.to_str().unwrap();
        commit(root, "extra.txt", "different history\n");
        let target = commit(root, "file.txt", "source\n");
        let result = cherry_pick(path, &source, &target, "main").unwrap();
        assert!(!result.conflicted);
        assert!(result.error.is_some());
        assert_eq!(result.snapshot.operation.as_deref(), Some("cherry-pick"));
        let done =
            act_on_operation(path, operation(&result.snapshot, OperationAction::Skip)).unwrap();
        assert!(done.error.is_none());
        assert!(done.snapshot.operation.is_none());
        assert_eq!(done.snapshot.head, Some(target));
    }

    #[test]
    fn cherry_pick_merge_commit_requires_explicit_mainline_and_is_rejected() {
        let (directory, _, source) = fixture();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let target = commit(root, "main.txt", "main work\n");
        run(root, &["merge", "--no-edit", "source"]).unwrap();
        let merge = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        run(root, &["branch", "keep-merge", &merge]).unwrap();
        run(root, &["reset", "--hard", &target]).unwrap();
        assert_ne!(merge, source);
        assert!(cherry_pick(path, &merge, &target, "main")
            .unwrap_err()
            .contains("主线父提交"));
        assert_eq!(run_text(root, &["rev-parse", "HEAD"]).unwrap(), target);
    }
}
