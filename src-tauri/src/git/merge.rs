use super::{
    optional_text, output, run, run_text, snapshot, with_repository, GitCommit, RepositorySnapshot,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub source: String,
    pub source_remote: bool,
    pub target: String,
    pub target_remote: bool,
    pub source_head: String,
    pub target_head: String,
    pub local_target: String,
    pub local_target_head: Option<String>,
    pub target_needs_sync: bool,
    pub commits: Vec<GitCommit>,
    pub commit_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub source: String,
    pub source_remote: bool,
    pub target: String,
    pub target_remote: bool,
    pub source_head: String,
    pub target_head: String,
    pub local_target: String,
    pub local_target_head: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub snapshot: RepositorySnapshot,
    pub merged: bool,
    pub conflicted: bool,
    pub error: Option<String>,
}

pub(super) fn branch_reference(root: &Path, branch: &str, remote: bool) -> Result<String, String> {
    if !remote {
        run(root, &["check-ref-format", "--branch", branch])?;
    }
    let namespace = if remote { "remotes" } else { "heads" };
    let reference = format!("refs/{namespace}/{branch}");
    run(root, &["check-ref-format", &reference])?;
    Ok(reference)
}

pub(super) fn branch_head(root: &Path, branch: &str, remote: bool) -> Result<String, String> {
    let reference = format!("{}^{{commit}}", branch_reference(root, branch, remote)?);
    optional_text(root, &["rev-parse", "--verify", &reference])?.ok_or_else(|| {
        let kind = if remote { "远程跟踪" } else { "本地" };
        format!("{kind}分支“{branch}”不存在或尚无提交。")
    })
}

pub(super) fn preview_branch_merge(
    root: &Path,
    source: &str,
    target: &str,
    source_remote: bool,
    target_remote: bool,
) -> Result<MergePreview, String> {
    if source_remote == target_remote && source == target {
        return Err("请选择两个不同的分支。".to_owned());
    }
    let source_head = branch_head(root, source, source_remote)?;
    let destination = super::merge_target::resolve_target(root, target, target_remote)?;
    let range = format!("{}..{source_head}", destination.merge_head);
    let log = run(
        root,
        &[
            "log",
            "--topo-order",
            "--reverse",
            "-z",
            "--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P",
            &range,
            "--",
        ],
    )?;
    let fields: Vec<&[u8]> = log.split(|byte| *byte == 0).collect();
    let mut commits = Vec::new();
    for fields in fields.chunks_exact(6) {
        let text = |index: usize| String::from_utf8_lossy(fields[index]).into_owned();
        commits.push(GitCommit {
            hash: text(0),
            short_hash: text(1),
            subject: text(2),
            author: text(3),
            date: text(4),
            parents: text(5).split_whitespace().map(str::to_owned).collect(),
            refs: Vec::new(),
            local: true,
            remote: false,
        });
    }
    // Keep the confirmation dialog responsive for branches with a long history.
    let commit_count = commits.len();
    commits.truncate(100);
    Ok(MergePreview {
        source: source.to_owned(),
        source_remote,
        target: target.to_owned(),
        target_remote,
        source_head,
        target_head: destination.head,
        local_target: destination.local,
        local_target_head: destination.local_head,
        target_needs_sync: destination.needs_sync,
        commits,
        commit_count,
    })
}

pub fn preview_merge(
    path: &str,
    source: &str,
    target: &str,
    source_remote: bool,
    target_remote: bool,
) -> Result<MergePreview, String> {
    with_repository(path, |root| {
        preview_branch_merge(root, source, target, source_remote, target_remote)
    })
}

pub fn merge_branches(path: &str, request: MergeRequest) -> Result<MergeResult, String> {
    with_repository(path, |root| {
        let before = snapshot(root)?;
        if before.operation.is_some() {
            return Err("请先完成或退出当前 Git 操作，再合并分支。".to_owned());
        }
        if !before.files.is_empty() {
            return Err("请先提交、暂存或撤回工作区中的更改，再合并分支。".to_owned());
        }
        let destination =
            super::merge_target::resolve_target(root, &request.target, request.target_remote)?;
        if branch_head(root, &request.source, request.source_remote)? != request.source_head
            || destination.head != request.target_head
            || destination.local != request.local_target
            || destination.local_head != request.local_target_head
        {
            return Err("分支在预览后发生了变化，请重新打开合并预览。".to_owned());
        }
        if request.source_remote == request.target_remote && request.source == request.target {
            return Err("请选择两个不同的分支。".to_owned());
        }
        let range = format!("{}..{}", destination.merge_head, request.source_head);
        if run_text(root, &["rev-list", "--count", &range, "--"])? == "0" {
            return Err(format!(
                "分支“{}”没有尚未合并到“{}”的提交。",
                request.source, request.target
            ));
        }
        let original_branch = before.branch.clone();
        let merge_output = (|| {
            super::merge_target::prepare_target(root, &original_branch, &destination)?;
            let source_ref = branch_reference(root, &request.source, request.source_remote)?;
            output(Some(root), &["merge", "--no-edit", &source_ref])
        })();
        match merge_output {
            Ok(result) if result.status.success() => Ok(MergeResult {
                snapshot: snapshot(root)?,
                merged: true,
                conflicted: false,
                error: None,
            }),
            Ok(result) => {
                let message = super::error_text(&result);
                let current = snapshot(root)?;
                let conflicted = current.files.iter().any(|file| file.conflicted);
                if conflicted || current.operation.as_deref() == Some("merge") {
                    Ok(MergeResult {
                        snapshot: current,
                        merged: false,
                        conflicted: true,
                        error: Some(message),
                    })
                } else {
                    // If Git rejected the merge without changing the target, return to the
                    // branch the user started from when possible.
                    if original_branch != destination.local
                        && !original_branch.starts_with("detached@")
                    {
                        let _ = run(root, &["switch", "--", &original_branch]);
                    }
                    Ok(MergeResult {
                        snapshot: snapshot(root)?,
                        merged: false,
                        conflicted: false,
                        error: Some(message),
                    })
                }
            }
            Err(error) => {
                let current = snapshot(root)?;
                let conflicted = current.files.iter().any(|file| file.conflicted)
                    || current.operation.as_deref() == Some("merge");
                Ok(MergeResult {
                    snapshot: current,
                    merged: false,
                    conflicted,
                    error: Some(error),
                })
            }
        }
    })
}

pub fn commit_files(path: &str, commit: &str) -> Result<Vec<String>, String> {
    if !((commit.len() == 40 || commit.len() == 64)
        && commit.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err("提交 SHA 格式无效。".to_owned());
    }
    with_repository(path, |root| {
        let hash = run_text(
            root,
            &["rev-parse", "--verify", &format!("{commit}^{{commit}}")],
        )?;
        let parents = run_text(root, &["rev-list", "--parents", "-n", "1", &hash])?;
        let first_parent = parents.split_whitespace().nth(1);
        let output = if let Some(parent) = first_parent {
            run(root, &["diff", "--name-only", "-z", parent, &hash, "--"])?
        } else {
            run(
                root,
                &[
                    "diff-tree",
                    "--root",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    "-z",
                    &hash,
                    "--",
                ],
            )?
        };
        Ok(output
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| String::from_utf8_lossy(path).into_owned())
            .collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn commit(root: &Path, file: &str, content: &str) {
        fs::write(root.join(file), content).unwrap();
        run(root, &["add", "--", file]).unwrap();
        run(root, &["commit", "-m", content]).unwrap();
    }

    fn remote_fixture() -> tempfile::TempDir {
        let directory = super::super::tests::repo();
        let root = directory.path();
        commit(root, "shared.txt", "base\n");
        run(root, &["switch", "-c", "coworker"]).unwrap();
        commit(root, "shared.txt", "coworker\n");
        run(root, &["update-ref", "refs/remotes/origin/feature", "HEAD"]).unwrap();
        run(root, &["switch", "main"]).unwrap();
        run(root, &["branch", "-D", "coworker"]).unwrap();
        directory
    }

    fn execute(root: &Path, preview: &MergePreview) -> Result<MergeResult, String> {
        merge_branches(
            root.to_str().unwrap(),
            MergeRequest {
                source: preview.source.clone(),
                target: preview.target.clone(),
                source_head: preview.source_head.clone(),
                target_head: preview.target_head.clone(),
                source_remote: preview.source_remote,
                target_remote: preview.target_remote,
                local_target: preview.local_target.clone(),
                local_target_head: preview.local_target_head.clone(),
            },
        )
    }

    #[test]
    fn remote_source_merges_without_a_local_copy_and_local_merges_still_work() {
        let directory = remote_fixture();
        let root = directory.path();
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "main",
            true,
            false,
        )
        .unwrap();
        assert!(preview.source_remote);
        assert_eq!(preview.commit_count, 1);
        assert_eq!(preview.commits[0].subject, "coworker");
        let result = execute(root, &preview).unwrap();
        assert!(result.merged);
        assert!(!result.conflicted);
        assert_eq!(result.snapshot.branch, "main");
        assert_eq!(
            result.snapshot.head.as_deref(),
            Some(preview.source_head.as_str())
        );
        assert!(!result
            .snapshot
            .branches
            .iter()
            .any(|branch| !branch.remote && branch.name == "origin/feature"));
        assert_eq!(
            fs::read_to_string(root.join("shared.txt")).unwrap(),
            "coworker\n"
        );

        run(root, &["switch", "-c", "local-feature"]).unwrap();
        commit(root, "local.txt", "local change");
        let preview = preview_merge(
            root.to_str().unwrap(),
            "local-feature",
            "main",
            false,
            false,
        )
        .unwrap();
        assert!(!preview.source_remote);
        let result = execute(root, &preview).unwrap();
        assert!(result.merged);
        assert_eq!(result.snapshot.branch, "main");
        assert!(root.join("local.txt").exists());
    }

    #[test]
    fn remote_and_local_sources_with_the_same_name_resolve_exact_namespaces() {
        let directory = remote_fixture();
        let root = directory.path();
        run(root, &["branch", "origin/feature", "main"]).unwrap();
        let local = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "main",
            false,
            false,
        )
        .unwrap();
        let remote = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "main",
            true,
            false,
        )
        .unwrap();
        assert_eq!(local.commit_count, 0);
        assert_eq!(remote.commit_count, 1);
        assert_ne!(local.source_head, remote.source_head);
        // Identical display names are valid when source and target are different refs.
        let remote_to_local = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/feature",
            true,
            false,
        )
        .unwrap();
        let result = execute(root, &remote_to_local).unwrap();
        assert!(result.merged);
        assert_eq!(result.snapshot.branch, "origin/feature");
        assert_eq!(result.snapshot.head, Some(remote.source_head));
        assert_eq!(branch_head(root, "main", false).unwrap(), local.target_head);
    }

    #[test]
    fn stale_remote_preview_dirty_work_and_missing_local_targets_are_rejected() {
        let directory = remote_fixture();
        let root = directory.path();
        assert!(preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/feature",
            true,
            false
        )
        .unwrap_err()
        .contains("本地分支"));
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "main",
            true,
            false,
        )
        .unwrap();
        run(root, &["update-ref", "refs/remotes/origin/feature", "main"]).unwrap();
        assert!(execute(root, &preview)
            .unwrap_err()
            .contains("预览后发生了变化"));
        assert_eq!(
            branch_head(root, "main", false).unwrap(),
            preview.target_head
        );
        run(
            root,
            &[
                "update-ref",
                "refs/remotes/origin/feature",
                &preview.source_head,
            ],
        )
        .unwrap();
        fs::write(root.join("keep.txt"), "unsaved").unwrap();
        assert!(execute(root, &preview).unwrap_err().contains("工作区"));
        assert_eq!(
            fs::read_to_string(root.join("keep.txt")).unwrap(),
            "unsaved"
        );
        assert_eq!(
            branch_head(root, "main", false).unwrap(),
            preview.target_head
        );
    }

    #[test]
    fn remote_merge_conflicts_remain_available_to_the_existing_conflict_tool() {
        let directory = remote_fixture();
        let root = directory.path();
        commit(root, "shared.txt", "local\n");
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "main",
            true,
            false,
        )
        .unwrap();
        let result = execute(root, &preview).unwrap();
        assert!(!result.merged);
        assert!(result.conflicted);
        assert_eq!(result.snapshot.branch, "main");
        assert_eq!(result.snapshot.operation.as_deref(), Some("merge"));
        assert!(result
            .snapshot
            .files
            .iter()
            .any(|file| file.path == "shared.txt" && file.conflicted));
    }

    fn remote_target_fixture() -> tempfile::TempDir {
        let directory = remote_fixture();
        let root = directory.path();
        run(root, &["remote", "add", "origin", "."]).unwrap();
        run(root, &["update-ref", "refs/remotes/origin/main", "main"]).unwrap();
        directory
    }

    #[test]
    fn remote_target_is_created_only_after_confirmation_and_is_not_pushed() {
        let directory = remote_target_fixture();
        let root = directory.path();
        run(root, &["switch", "-c", "other"]).unwrap();
        run(root, &["branch", "-D", "main"]).unwrap();
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true,
        )
        .unwrap();
        assert_eq!(preview.local_target, "main");
        assert!(preview.local_target_head.is_none());
        assert_eq!(preview.commit_count, 1);
        assert!(
            optional_text(root, &["rev-parse", "--verify", "refs/heads/main"])
                .unwrap()
                .is_none()
        );
        fs::write(root.join("unsaved.txt"), "keep").unwrap();
        assert!(execute(root, &preview).unwrap_err().contains("工作区"));
        assert!(
            optional_text(root, &["rev-parse", "--verify", "refs/heads/main"])
                .unwrap()
                .is_none()
        );
        fs::remove_file(root.join("unsaved.txt")).unwrap();
        let result = execute(root, &preview).unwrap();
        assert!(result.merged);
        assert_eq!(result.snapshot.branch, "main");
        assert_eq!(result.snapshot.upstream.unwrap().name, "origin/main");
        assert_eq!(
            branch_head(root, "origin/main", true).unwrap(),
            preview.target_head
        );
        assert_eq!(result.snapshot.head, Some(preview.source_head));
    }

    #[test]
    fn remote_target_reuses_its_tracking_branch_and_fast_forwards_before_merging() {
        let directory = remote_target_fixture();
        let root = directory.path();
        run(root, &["branch", "deploy-main", "main"]).unwrap();
        run(
            root,
            &["branch", "--set-upstream-to", "origin/main", "deploy-main"],
        )
        .unwrap();
        run(root, &["switch", "-c", "remote-update"]).unwrap();
        commit(root, "remote.txt", "remote target update");
        run(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        run(root, &["switch", "main"]).unwrap();
        let main_head = branch_head(root, "main", false).unwrap();
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true,
        )
        .unwrap();
        assert_eq!(preview.local_target, "deploy-main");
        assert!(preview.target_needs_sync);
        assert_eq!(preview.commit_count, 1);
        let result = execute(root, &preview).unwrap();
        assert!(result.merged);
        assert_eq!(result.snapshot.branch, "deploy-main");
        assert!(root.join("remote.txt").exists());
        assert_eq!(
            fs::read_to_string(root.join("shared.txt")).unwrap(),
            "coworker\n"
        );
        assert_eq!(branch_head(root, "main", false).unwrap(), main_head);
        assert_eq!(
            branch_head(root, "origin/main", true).unwrap(),
            preview.target_head
        );
    }

    #[test]
    fn remote_target_preserves_ahead_local_commits_and_sets_the_selected_upstream() {
        let directory = remote_target_fixture();
        let root = directory.path();
        commit(root, "local.txt", "local unpublished work");
        let local_head = branch_head(root, "main", false).unwrap();
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true,
        )
        .unwrap();
        assert_eq!(preview.local_target_head, Some(local_head.clone()));
        assert!(!preview.target_needs_sync);
        let result = execute(root, &preview).unwrap();
        assert!(result.merged);
        assert_eq!(
            fs::read_to_string(root.join("local.txt")).unwrap(),
            "local unpublished work"
        );
        assert!(output(
            Some(root),
            &["merge-base", "--is-ancestor", &local_head, "HEAD"]
        )
        .unwrap()
        .status
        .success());
        assert_eq!(result.snapshot.upstream.unwrap().name, "origin/main");
        let included = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true,
        )
        .unwrap();
        assert_eq!(included.commit_count, 0);
    }

    #[test]
    fn remote_target_rejects_diverged_or_differently_tracked_local_branches() {
        let directory = remote_target_fixture();
        let root = directory.path();
        commit(root, "local.txt", "local work");
        let local_head = branch_head(root, "main", false).unwrap();
        run(
            root,
            &[
                "switch",
                "--no-track",
                "-c",
                "remote-update",
                "refs/remotes/origin/main",
            ],
        )
        .unwrap();
        commit(root, "remote.txt", "other work");
        run(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        run(root, &["switch", "main"]).unwrap();
        assert!(preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true
        )
        .unwrap_err()
        .contains("已分叉"));
        assert_eq!(branch_head(root, "main", false).unwrap(), local_head);
        run(root, &["remote", "add", "other", "."]).unwrap();
        run(root, &["update-ref", "refs/remotes/other/main", "main"]).unwrap();
        run(root, &["branch", "--set-upstream-to", "other/main", "main"]).unwrap();
        assert!(preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true
        )
        .unwrap_err()
        .contains("已跟踪其他"));
        assert_eq!(
            run_text(root, &["rev-parse", "--abbrev-ref", "main@{upstream}"]).unwrap(),
            "other/main"
        );
    }

    #[test]
    fn changed_remote_or_local_target_invalidates_the_preview_without_writing() {
        let directory = remote_target_fixture();
        let root = directory.path();
        let preview = preview_merge(
            root.to_str().unwrap(),
            "origin/feature",
            "origin/main",
            true,
            true,
        )
        .unwrap();
        run(
            root,
            &[
                "update-ref",
                "refs/remotes/origin/main",
                &preview.source_head,
            ],
        )
        .unwrap();
        assert!(execute(root, &preview)
            .unwrap_err()
            .contains("预览后发生了变化"));
        assert_eq!(
            branch_head(root, "main", false).unwrap(),
            preview.target_head
        );
        run(
            root,
            &[
                "update-ref",
                "refs/remotes/origin/main",
                &preview.target_head,
            ],
        )
        .unwrap();
        commit(root, "unexpected.txt", "new local commit");
        let current = branch_head(root, "main", false).unwrap();
        assert!(execute(root, &preview)
            .unwrap_err()
            .contains("预览后发生了变化"));
        assert_eq!(branch_head(root, "main", false).unwrap(), current);
    }
}
