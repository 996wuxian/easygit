use super::operations::OperationAction;
use super::*;

fn commit(root: &std::path::Path, text: &str, message: &str) -> String {
    std::fs::write(root.join("file.txt"), text).unwrap();
    run(root, &["add", "."]).unwrap();
    run(root, &["commit", "-m", message]).unwrap();
    run_text(root, &["rev-parse", "HEAD"]).unwrap()
}

fn request(state: &RepositorySnapshot, action: OperationAction) -> OperationRequest {
    OperationRequest {
        operation: state.operation.clone().unwrap(),
        token: state.operation_token.clone().unwrap(),
        revision: state.revision.clone(),
        head: state.head.clone(),
        branch: state.branch.clone(),
        action,
    }
}

fn conflict_repo() -> tempfile::TempDir {
    let directory = tests::repo();
    let root = directory.path();
    commit(root, "base\n", "base");
    run(root, &["checkout", "-b", "incoming"]).unwrap();
    commit(root, "incoming\n", "incoming");
    run(root, &["checkout", "main"]).unwrap();
    commit(root, "ours\n", "ours");
    directory
}

#[test]
fn stash_roundtrip_preserves_index_untracked_files_and_guards_stale_selectors() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    commit(root, "base\n", "base");
    std::fs::write(root.join("file.txt"), "staged\n").unwrap();
    run(root, &["add", "file.txt"]).unwrap();
    std::fs::write(root.join("file.txt"), "working\n").unwrap();
    std::fs::write(root.join("new 中文.txt"), "new\n").unwrap();
    let saved = save_stash(path, "half-finished", true).unwrap();
    assert!(saved.error.is_none());
    assert!(
        saved.snapshot.files.is_empty(),
        "{:?}",
        saved.snapshot.files
    );
    let entry = list_stashes(path).unwrap().remove(0);
    assert!(entry.message.contains("half-finished"));
    let diff = stash_diff(path, &entry.selector, &entry.hash).unwrap();
    assert!(diff.contains("+working"));
    assert!(diff.contains("new"));
    let restored = act_on_stash(path, &entry.selector, &entry.hash, StashAction::Apply).unwrap();
    assert!(restored.error.is_none());
    assert!(restored
        .snapshot
        .files
        .iter()
        .any(|file| file.path == "file.txt" && file.staged && file.unstaged));
    assert_eq!(
        std::fs::read_to_string(root.join("new 中文.txt")).unwrap(),
        "new\n"
    );
    save_stash(path, "second", true).unwrap();
    assert!(act_on_stash(path, &entry.selector, &entry.hash, StashAction::Drop).is_err());
    let entries = list_stashes(path).unwrap();
    let latest = &entries[0];
    assert!(
        act_on_stash(path, &latest.selector, &latest.hash, StashAction::Pop)
            .unwrap()
            .error
            .is_none()
    );
    assert_eq!(list_stashes(path).unwrap().len(), 1);
    let remaining = list_stashes(path).unwrap().remove(0);
    assert!(act_on_stash(
        path,
        &remaining.selector,
        &remaining.hash,
        StashAction::Drop
    )
    .unwrap()
    .error
    .is_none());
    assert!(list_stashes(path).unwrap().is_empty());
}

#[test]
fn conflicting_pop_keeps_the_stash_and_returns_conflict_snapshot() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    commit(root, "base\n", "base");
    std::fs::write(root.join("file.txt"), "stash version\n").unwrap();
    save_stash(path, "conflicting", true).unwrap();
    commit(root, "branch version\n", "branch changed");
    let entry = list_stashes(path).unwrap().remove(0);
    let result = act_on_stash(path, &entry.selector, &entry.hash, StashAction::Pop).unwrap();
    assert!(result.error.is_some());
    assert!(result.conflicted);
    assert!(result.snapshot.files.iter().any(|file| file.conflicted));
    assert_eq!(list_stashes(path).unwrap()[0].hash, entry.hash);
}

#[test]
fn merge_can_continue_or_abort_and_rejects_changed_confirmation() {
    let directory = conflict_repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    assert!(run(root, &["merge", "incoming"]).is_err());
    let state = open_repository(path).unwrap();
    assert!(act_on_operation(path, request(&state, OperationAction::Continue)).is_err());
    let pending = request(&state, OperationAction::Abort);
    std::fs::write(root.join("file.txt"), "new external editing\n").unwrap();
    assert!(act_on_operation(path, pending).is_err());
    let conflict = read_conflict(path, "file.txt").unwrap();
    let resolved = resolve_conflict(
        path,
        "file.txt",
        &conflict.revision,
        ConflictResolution::Content,
        Some("resolved\n"),
    )
    .unwrap();
    let done = act_on_operation(path, request(&resolved, OperationAction::Continue)).unwrap();
    assert!(done.error.is_none());
    assert!(done.snapshot.operation.is_none());
    assert_eq!(
        run_text(root, &["rev-list", "--parents", "-n", "1", "HEAD"])
            .unwrap()
            .split_whitespace()
            .count(),
        3
    );
    let merge_head = done.snapshot.head.as_deref().unwrap();
    assert_eq!(commit_files(path, merge_head).unwrap(), vec!["file.txt"]);
    let patch = commit_diff(path, merge_head, "file.txt").unwrap();
    assert!(patch.contains("-ours"));
    assert!(patch.contains("+resolved"));
    let directory = conflict_repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    let before = run_text(root, &["rev-parse", "HEAD"]).unwrap();
    assert!(run(root, &["merge", "incoming"]).is_err());
    let state = open_repository(path).unwrap();
    let done = act_on_operation(path, request(&state, OperationAction::Abort)).unwrap();
    assert!(done.error.is_none());
    assert_eq!(done.snapshot.head.unwrap(), before);
    assert!(done.snapshot.operation.is_none());
    assert_eq!(
        std::fs::read_to_string(root.join("file.txt")).unwrap(),
        "ours\n"
    );
}

#[test]
fn rebase_cherry_pick_and_revert_support_continue_skip_and_abort() {
    for operation in ["rebase", "cherry-pick", "revert"] {
        for action in [
            OperationAction::Continue,
            OperationAction::Skip,
            OperationAction::Abort,
        ] {
            let directory = conflict_repo();
            let root = directory.path();
            let path = root.to_str().unwrap();
            let before = run_text(root, &["rev-parse", "HEAD"]).unwrap();
            assert!(run(root, &[operation, "incoming"]).is_err());
            let mut state = open_repository(path).unwrap();
            assert_eq!(state.operation.as_deref(), Some(operation));
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
            let done = act_on_operation(path, request(&state, action)).unwrap();
            assert!(done.error.is_none(), "{operation}: {:?}", done.error);
            assert!(done.snapshot.operation.is_none());
            if matches!(action, OperationAction::Abort) {
                assert_eq!(done.snapshot.head.unwrap(), before);
            }
        }
    }
}

#[test]
fn revision_diff_handles_root_renames_and_readonly_branch_comparisons() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    let base = commit(root, "base\n", "root");
    assert!(commit_diff(path, &base, "file.txt")
        .unwrap()
        .contains("+base"));
    run(root, &["checkout", "-b", "feature"]).unwrap();
    run(root, &["mv", "file.txt", "renamed 中文.txt"]).unwrap();
    run(root, &["commit", "-m", "rename"]).unwrap();
    let tip = run_text(root, &["rev-parse", "HEAD"]).unwrap();
    run(root, &["config", "diff.renames", "false"]).unwrap();
    assert_eq!(commit_files(path, &tip).unwrap(), vec!["renamed 中文.txt"]);
    let comparison = compare_branches(path, "main", false, "feature", false).unwrap();
    assert_eq!(comparison.base, base);
    assert_eq!(comparison.target, tip);
    assert_eq!(comparison.files[0].old_path.as_deref(), Some("file.txt"));
    let patch = comparison_diff(
        path,
        &comparison.base,
        &comparison.target,
        "renamed 中文.txt",
    )
    .unwrap();
    assert!(patch.contains("rename from file.txt"));
    assert!(commit_diff(path, &tip, "renamed 中文.txt")
        .unwrap()
        .contains("rename from"));
    assert_eq!(run_text(root, &["rev-parse", "HEAD"]).unwrap(), tip);
    assert!(comparison_diff(path, &base, &tip, "../outside").is_err());
    assert!(commit_diff(path, "--all", "file.txt").is_err());
}

#[test]
fn history_pages_search_branch_scope_and_reject_changed_tips() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    for index in 0..32 {
        run(
            root,
            &["commit", "--allow-empty", "-m", &format!("message {index}")],
        )
        .unwrap();
    }
    let query = |offset, expected_key| HistoryQuery {
        reference: None,
        query: String::new(),
        offset,
        expected_key,
    };
    let first = history_page(path, query(0, None)).unwrap();
    assert_eq!(first.commits.len(), 25);
    assert_eq!(first.next_offset, Some(25));
    let next = history_page(path, query(25, Some(first.key.clone()))).unwrap();
    assert_eq!(next.commits.len(), 7);
    assert!(next.next_offset.is_none());
    assert!(!next
        .commits
        .iter()
        .any(|commit| first.commits.iter().any(|old| old.hash == commit.hash)));
    let mut search = query(0, None);
    search.query = "MESSAGE 31".into();
    assert_eq!(history_page(path, search).unwrap().commits.len(), 1);
    run(root, &["branch", "other", "HEAD~3"]).unwrap();
    let mut selected = query(0, None);
    selected.reference = Some(super::history::HistoryReference {
        name: "other".into(),
        remote: false,
    });
    assert!(history_page(path, selected)
        .unwrap()
        .commits
        .iter()
        .all(|commit| commit.local));
    run(root, &["commit", "--allow-empty", "-m", "tip advanced"]).unwrap();
    assert!(history_page(path, query(25, Some(first.key))).is_err());
}

#[test]
fn published_commits_can_be_reverted_without_rewriting_history() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    std::fs::write(root.join("file.txt"), "first\n").unwrap();
    run(root, &["add", "."]).unwrap();
    run(root, &["commit", "-m", "initial"]).unwrap();
    let first = run_text(root, &["rev-parse", "HEAD"]).unwrap();
    std::fs::write(root.join("file.txt"), "second\n").unwrap();
    run(root, &["add", "."]).unwrap();
    run(root, &["commit", "-m", "published"]).unwrap();
    let published = run_text(root, &["rev-parse", "HEAD"]).unwrap();
    run(
        root,
        &["update-ref", "refs/remotes/origin/main", &published],
    )
    .unwrap();
    assert!(act_on_commit(path, &published, &published, "main", CommitAction::Soft).is_err());
    let state = act_on_commit(path, &published, &published, "main", CommitAction::Revert).unwrap();
    assert_ne!(state.head.as_deref(), Some(published.as_str()));
    assert_eq!(run_text(root, &["rev-parse", "HEAD^1"]).unwrap(), published);
    assert_eq!(
        std::fs::read_to_string(root.join("file.txt")).unwrap(),
        "first\n"
    );
    assert_eq!(run_text(root, &["rev-parse", "HEAD~2"]).unwrap(), first);
}
