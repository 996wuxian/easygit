use super::conflicts::*;
use super::{create_commit, run, run_text, stage_files};
use std::fs;

fn conflict(ours: Option<&[u8]>, theirs: Option<&[u8]>) -> tempfile::TempDir {
    let directory = super::tests::repo();
    let root = directory.path();
    let path = root.to_str().unwrap();
    run(root, &["config", "core.autocrlf", "false"]).unwrap();
    fs::write(root.join("conflict.txt"), b"base\n").unwrap();
    fs::write(root.join("other.txt"), b"other\n").unwrap();
    stage_files(path, &["conflict.txt".into(), "other.txt".into()]).unwrap();
    create_commit(path, "initial").unwrap();
    run(root, &["branch", "feature"]).unwrap();
    for (branch, contents) in [("main", ours), ("feature", theirs)] {
        run(root, &["switch", branch]).unwrap();
        if let Some(contents) = contents {
            fs::write(root.join("conflict.txt"), contents).unwrap();
        } else {
            fs::remove_file(root.join("conflict.txt")).unwrap();
        }
        stage_files(path, &["conflict.txt".into()]).unwrap();
        create_commit(path, branch).unwrap();
    }
    run(root, &["switch", "main"]).unwrap();
    assert!(run(root, &["merge", "feature"]).is_err());
    fs::write(root.join("other.txt"), b"keep unstaged\n").unwrap();
    directory
}

#[test]
fn merged_text_is_staged_and_other_files_are_preserved() {
    let directory = conflict(Some(b"ours\n"), Some(b"theirs\n"));
    let path = directory.path().to_str().unwrap();
    let data = read_conflict(path, "conflict.txt").unwrap();
    assert_eq!(data.ours.as_deref(), Some("ours\n"));
    assert_eq!(data.theirs.as_deref(), Some("theirs\n"));
    let result = resolve_conflict(
        path,
        "conflict.txt",
        &data.revision,
        ConflictResolution::Content,
        Some("ours\ntheirs\n"),
    )
    .unwrap();
    assert!(result.files.iter().all(|file| !file.conflicted));
    assert_eq!(
        run_text(directory.path(), &["show", ":conflict.txt"]).unwrap(),
        "ours\ntheirs"
    );
    assert_eq!(
        fs::read(directory.path().join("other.txt")).unwrap(),
        b"keep unstaged\n"
    );
    assert!(result
        .files
        .iter()
        .any(|file| file.path == "other.txt" && file.unstaged && !file.staged));
}

#[test]
fn markers_and_stale_revisions_are_rejected_without_writing() {
    let directory = conflict(Some(b"ours\n"), Some(b"theirs\n"));
    let path = directory.path().to_str().unwrap();
    let data = read_conflict(path, "conflict.txt").unwrap();
    let original = data.working.as_deref().unwrap();
    assert!(resolve_conflict(
        path,
        "conflict.txt",
        &data.revision,
        ConflictResolution::Content,
        Some(original)
    )
    .unwrap_err()
    .contains("冲突标记"));
    assert!(resolve_conflict(
        path,
        "conflict.txt",
        &data.revision,
        ConflictResolution::Working,
        None
    )
    .unwrap_err()
    .contains("冲突标记"));
    fs::write(directory.path().join("conflict.txt"), b"external edit\n").unwrap();
    assert!(resolve_conflict(
        path,
        "conflict.txt",
        &data.revision,
        ConflictResolution::Ours,
        None
    )
    .unwrap_err()
    .contains("已被其他操作修改"));
    assert_eq!(
        fs::read(directory.path().join("conflict.txt")).unwrap(),
        b"external edit\n"
    );
    let latest = read_conflict(path, "conflict.txt").unwrap();
    let result = resolve_conflict(
        path,
        "conflict.txt",
        &latest.revision,
        ConflictResolution::Working,
        None,
    )
    .unwrap();
    assert!(result.files.iter().all(|file| !file.conflicted));
}

#[test]
fn either_side_and_binary_files_can_be_resolved() {
    for (resolution, expected) in [
        (ConflictResolution::Ours, &b"ours\0binary"[..]),
        (ConflictResolution::Theirs, &b"theirs\0binary"[..]),
    ] {
        let directory = conflict(Some(b"ours\0binary"), Some(b"theirs\0binary"));
        let path = directory.path().to_str().unwrap();
        let data = read_conflict(path, "conflict.txt").unwrap();
        assert!(data.binary);
        let result =
            resolve_conflict(path, "conflict.txt", &data.revision, resolution, None).unwrap();
        assert!(result.files.iter().all(|file| !file.conflicted));
        assert_eq!(
            fs::read(directory.path().join("conflict.txt")).unwrap(),
            expected
        );
        assert_eq!(
            run(directory.path(), &["show", ":conflict.txt"]).unwrap(),
            expected
        );
    }
}

#[test]
fn modify_delete_can_keep_a_version_or_accept_deletion() {
    for (ours, theirs, resolution, expected) in [
        (None, Some(&b"theirs\n"[..]), ConflictResolution::Ours, None),
        (
            None,
            Some(&b"theirs\n"[..]),
            ConflictResolution::Theirs,
            Some(&b"theirs\n"[..]),
        ),
        (Some(&b"ours\n"[..]), None, ConflictResolution::Theirs, None),
        (
            Some(&b"ours\n"[..]),
            None,
            ConflictResolution::Ours,
            Some(&b"ours\n"[..]),
        ),
        (
            Some(&b"ours\n"[..]),
            Some(&b"theirs\n"[..]),
            ConflictResolution::Delete,
            None,
        ),
    ] {
        let directory = conflict(ours, theirs);
        let path = directory.path().to_str().unwrap();
        let data = read_conflict(path, "conflict.txt").unwrap();
        let result =
            resolve_conflict(path, "conflict.txt", &data.revision, resolution, None).unwrap();
        assert!(result.files.iter().all(|file| !file.conflicted));
        assert_eq!(
            fs::read(directory.path().join("conflict.txt"))
                .ok()
                .as_deref(),
            expected
        );
    }
}

#[test]
fn non_conflicts_and_outside_paths_cannot_be_resolved() {
    let directory = conflict(Some(b"ours\n"), Some(b"theirs\n"));
    let path = directory.path().to_str().unwrap();
    assert!(read_conflict(path, "../outside.txt").is_err());
    assert!(resolve_conflict(path, "other.txt", "", ConflictResolution::Delete, None).is_err());
    assert_eq!(
        fs::read(directory.path().join("other.txt")).unwrap(),
        b"keep unstaged\n"
    );
}

#[test]
fn checkout_respects_repository_line_ending_configuration() {
    let directory = conflict(Some(b"ours\n"), Some(b"theirs\n"));
    let root = directory.path();
    let path = root.to_str().unwrap();
    run(root, &["config", "core.autocrlf", "true"]).unwrap();
    let data = read_conflict(path, "conflict.txt").unwrap();
    resolve_conflict(
        path,
        "conflict.txt",
        &data.revision,
        ConflictResolution::Theirs,
        None,
    )
    .unwrap();
    assert_eq!(fs::read(root.join("conflict.txt")).unwrap(), b"theirs\r\n");
    assert_eq!(run(root, &["show", ":conflict.txt"]).unwrap(), b"theirs\n");
}

#[test]
fn custom_markers_are_checked_before_staging() {
    let directory = conflict(Some(b"ours\n"), Some(b"theirs\n"));
    let root = directory.path();
    let path = root.to_str().unwrap();
    fs::write(
        root.join(".gitattributes"),
        b"conflict.txt conflict-marker-size=5\n",
    )
    .unwrap();
    let data = read_conflict(path, "conflict.txt").unwrap();
    assert_eq!(data.marker_size, 5);
    assert!(resolve_conflict(
        path,
        "conflict.txt",
        &data.revision,
        ConflictResolution::Content,
        Some("<<<<< HEAD\nours\n=====\ntheirs\n>>>>> feature\n")
    )
    .unwrap_err()
    .contains("冲突标记"));
}
