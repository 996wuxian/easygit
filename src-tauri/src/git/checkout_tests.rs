use super::*;
use std::fs;

fn commit(root: &Path, file: &str, content: &str) {
    fs::write(root.join(file), content).unwrap();
    run(root, &["add", "--", file]).unwrap();
    run(root, &["commit", "-m", content]).unwrap();
}

fn remote_repo() -> tempfile::TempDir {
    let directory = super::tests::repo();
    let root = directory.path();
    commit(root, "common.txt", "base");
    run(root, &["remote", "add", "origin", "."]).unwrap();
    run(root, &["switch", "-c", "publish"]).unwrap();
    commit(root, "dev.txt", "remote dev");
    run(root, &["update-ref", "refs/remotes/origin/dev", "HEAD"]).unwrap();
    run(root, &["switch", "main"]).unwrap();
    run(root, &["branch", "-D", "publish"]).unwrap();
    directory
}

#[test]
fn remote_checkout_creates_a_tracking_branch_and_keeps_compatible_uncommitted_work() {
    let directory = remote_repo();
    let root = directory.path();
    let main_head = run_text(root, &["rev-parse", "main"]).unwrap();
    let remote_head = run_text(root, &["rev-parse", "refs/remotes/origin/dev"]).unwrap();
    fs::write(root.join("common.txt"), "unfinished work").unwrap();
    let result = checkout_branch(root.to_str().unwrap(), "origin/dev", true).unwrap();
    assert_eq!(result.branch, "dev");
    assert_eq!(result.head, Some(remote_head.clone()));
    assert_eq!(result.upstream.unwrap().name, "origin/dev");
    assert_eq!(
        run_text(root, &["symbolic-ref", "HEAD"]).unwrap(),
        "refs/heads/dev"
    );
    assert_eq!(
        fs::read_to_string(root.join("common.txt")).unwrap(),
        "unfinished work"
    );
    assert!(result
        .files
        .iter()
        .any(|file| file.path == "common.txt" && file.unstaged));
    assert_eq!(run_text(root, &["rev-parse", "main"]).unwrap(), main_head);
    assert_eq!(
        run_text(root, &["rev-parse", "refs/remotes/origin/dev"]).unwrap(),
        remote_head
    );
}

#[test]
fn remote_checkout_reuses_diverged_local_history_without_pulling_or_merging() {
    let directory = remote_repo();
    let root = directory.path();
    checkout_branch(root.to_str().unwrap(), "origin/dev", true).unwrap();
    commit(root, "local.txt", "unpublished local commit");
    let local_head = run_text(root, &["rev-parse", "HEAD"]).unwrap();
    run(
        root,
        &[
            "switch",
            "--no-track",
            "-c",
            "remote-update",
            "refs/remotes/origin/dev",
        ],
    )
    .unwrap();
    commit(root, "remote.txt", "new remote commit");
    run(root, &["update-ref", "refs/remotes/origin/dev", "HEAD"]).unwrap();
    run(root, &["switch", "main"]).unwrap();
    let result = checkout_branch(root.to_str().unwrap(), "origin/dev", true).unwrap();
    assert_eq!(result.branch, "dev");
    assert_eq!(result.head, Some(local_head));
    assert_eq!((result.ahead, result.behind), (1, 1));
    assert!(result.operation.is_none());
    assert!(root.join("local.txt").exists());
    assert!(!root.join("remote.txt").exists());
}

#[test]
fn remote_checkout_prefers_the_existing_tracking_branch_even_with_a_custom_name() {
    let directory = remote_repo();
    let root = directory.path();
    run(root, &["branch", "--track", "work/dev", "origin/dev"]).unwrap();
    run(root, &["branch", "dev", "main"]).unwrap();
    let other_head = run_text(root, &["rev-parse", "refs/heads/dev"]).unwrap();
    let result = checkout_branch(root.to_str().unwrap(), "origin/dev", true).unwrap();
    assert_eq!(result.branch, "work/dev");
    assert_eq!(result.upstream.unwrap().name, "origin/dev");
    assert_eq!(
        run_text(root, &["rev-parse", "refs/heads/dev"]).unwrap(),
        other_head
    );
}

#[test]
fn remote_checkout_refuses_to_retarget_a_local_branch_tracking_another_remote() {
    let directory = remote_repo();
    let root = directory.path();
    run(root, &["remote", "add", "other", "."]).unwrap();
    run(root, &["update-ref", "refs/remotes/other/dev", "main"]).unwrap();
    run(root, &["branch", "--track", "dev", "other/dev"]).unwrap();
    let error = checkout_branch(root.to_str().unwrap(), "origin/dev", true).unwrap_err();
    assert!(error.contains("已跟踪其他"));
    assert_eq!(
        run_text(root, &["branch", "--show-current"]).unwrap(),
        "main"
    );
    assert_eq!(
        run_text(root, &["rev-parse", "--abbrev-ref", "dev@{upstream}"]).unwrap(),
        "other/dev"
    );
}

#[test]
fn remote_checkout_does_not_overwrite_files_or_create_a_branch_when_switch_is_rejected() {
    let directory = remote_repo();
    let root = directory.path();
    fs::write(root.join("dev.txt"), "unsaved local file").unwrap();
    assert!(checkout_branch(root.to_str().unwrap(), "origin/dev", true).is_err());
    assert_eq!(
        run_text(root, &["branch", "--show-current"]).unwrap(),
        "main"
    );
    assert_eq!(
        fs::read_to_string(root.join("dev.txt")).unwrap(),
        "unsaved local file"
    );
    assert!(
        optional_text(root, &["rev-parse", "--verify", "refs/heads/dev"])
            .unwrap()
            .is_none()
    );
}

#[test]
fn unfinished_merge_blocks_remote_checkout_even_without_conflicts() {
    let directory = remote_repo();
    let root = directory.path();
    run(
        root,
        &["merge", "--no-ff", "--no-commit", "refs/remotes/origin/dev"],
    )
    .unwrap();
    let error = checkout_branch(root.to_str().unwrap(), "origin/dev", true).unwrap_err();
    assert!(error.contains("当前 Git 操作"));
    let state = snapshot(root).unwrap();
    assert_eq!(state.branch, "main");
    assert_eq!(state.operation.as_deref(), Some("merge"));
    assert!(state
        .files
        .iter()
        .any(|file| file.path == "dev.txt" && file.staged));
}
