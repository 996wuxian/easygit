use super::*;
use std::time::Instant;

#[test]
fn revision_tracks_non_current_branch_tip_even_with_same_commit_date() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    let unborn = open_repository(path).unwrap();
    assert!(unborn.branches[0].head.is_none());
    run(root, &["commit", "--allow-empty", "-m", "main"]).unwrap();
    let tree = run_text(root, &["rev-parse", "HEAD^{tree}"]).unwrap();
    let make_tip = |message| {
        let mut process = command(Some(root));
        process
            .args(["commit-tree", &tree, "-m", message])
            .env("GIT_AUTHOR_DATE", "2025-01-15T10:00:00+08:00")
            .env("GIT_COMMITTER_DATE", "2025-01-15T10:00:00+08:00");
        let result =
            crate::process::output_with_timeout(&mut process, Duration::from_secs(30)).unwrap();
        assert!(result.status.success(), "{}", error_text(&result));
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    };
    let old = make_tip("old remote");
    let new = make_tip("new remote");
    run(root, &["update-ref", "refs/remotes/origin/feature", &old]).unwrap();
    let before = open_repository(path).unwrap();
    run(root, &["update-ref", "refs/remotes/origin/feature", &new]).unwrap();
    let after = open_repository(path).unwrap();
    fn branch(state: &RepositorySnapshot) -> &GitBranch {
        state
            .branches
            .iter()
            .find(|branch| branch.name == "origin/feature")
            .unwrap()
    }
    assert_eq!(
        branch(&before).last_commit_date,
        branch(&after).last_commit_date
    );
    assert_eq!(branch(&before).head.as_deref(), Some(old.as_str()));
    assert_eq!(branch(&after).head.as_deref(), Some(new.as_str()));
    assert_eq!(before.head, after.head);
    assert_ne!(before.revision, after.revision);
}

#[test]
fn revision_detects_edits_even_when_git_status_is_unchanged() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    std::fs::write(root.join("file.txt"), "initial\n").unwrap();
    run(root, &["add", "."]).unwrap();
    run(root, &["commit", "-m", "initial"]).unwrap();
    let file = root.join("file.txt");
    let stamp = std::time::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    std::fs::write(&file, "edited\n").unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(stamp)
        .unwrap();
    let first = open_repository(path).unwrap();
    assert_eq!(first.revision, open_repository(path).unwrap().revision);
    // Same length and same M status; only the edit's file stamp changes.
    std::fs::write(&file, "change\n").unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(stamp + Duration::from_secs(1))
        .unwrap();
    let second = open_repository(path).unwrap();
    assert_eq!(
        first.files[0].worktree_status,
        second.files[0].worktree_status
    );
    assert_ne!(first.revision, second.revision);
    let staged = stage_files(path, &["file.txt".into()]).unwrap();
    assert_ne!(second.revision, staged.revision);
    assert_eq!(staged.revision, open_repository(path).unwrap().revision);
}

#[test]
fn revision_tracks_ignored_script_inputs_and_lockfiles() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    std::fs::write(root.join(".git/info/exclude"), "package.json\nyarn.lock\n").unwrap();
    let first = open_repository(path).unwrap();
    std::fs::write(root.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
    let scripts = open_repository(path).unwrap();
    assert!(scripts.files.is_empty());
    assert_ne!(first.revision, scripts.revision);
    std::fs::write(root.join("yarn.lock"), "").unwrap();
    let lock = open_repository(path).unwrap();
    assert!(lock.files.is_empty());
    assert_ne!(scripts.revision, lock.revision);
    assert_eq!(lock.revision, open_repository(path).unwrap().revision);
}

#[test]
fn snapshot_resolves_local_custom_and_missing_upstreams() {
    let directory = tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    run(root, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
    run(root, &["branch", "base"]).unwrap();
    run(root, &["branch", "--set-upstream-to=base"]).unwrap();
    let local = open_repository(path).unwrap();
    assert_eq!(local.upstream.unwrap().name, "base");
    run(
        root,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    )
    .unwrap();
    run(
        root,
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/custom/*",
        ],
    )
    .unwrap();
    run(root, &["config", "branch.main.remote", "origin"]).unwrap();
    run(root, &["config", "branch.main.merge", "refs/heads/main"]).unwrap();
    run(root, &["update-ref", "refs/custom/main", "HEAD"]).unwrap();
    let custom = open_repository(path).unwrap();
    assert_eq!(custom.upstream.as_ref().unwrap().hash, custom.head.unwrap());
    run(root, &["update-ref", "-d", "refs/custom/main"]).unwrap();
    assert!(!open_repository(path).unwrap().has_upstream);
    run(root, &["checkout", "--detach"]).unwrap();
    let detached = open_repository(path).unwrap();
    assert!(detached.branch.starts_with("detached@"));
    assert!(!detached.has_upstream);
}

/// Read-only profiling of a real repository; never creates commits or updates refs.
#[test]
#[ignore = "set EASYGIT_PERF_REPO to the repository to profile"]
fn profile_repository_refresh() {
    let path = std::env::var("EASYGIT_PERF_REPO").expect("set EASYGIT_PERF_REPO");
    for sample in 0..5 {
        GIT_COMMAND_COUNT.with(|count| count.set(0));
        let start = Instant::now();
        let snapshot = open_repository(&path).unwrap();
        let elapsed = start.elapsed();
        let commands = GIT_COMMAND_COUNT.with(|count| count.get());
        println!(
            "sample={sample} git_commands={commands} elapsed_ms={:.1} commits={} files={}",
            elapsed.as_secs_f64() * 1000.0,
            snapshot.commits.len(),
            snapshot.files.len()
        );
    }
}
