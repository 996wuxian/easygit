use super::{
    optional_text, output, run, run_text, snapshot, with_repository, GitCommit, RepositorySnapshot,
};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub source: String,
    pub target: String,
    pub source_head: String,
    pub target_head: String,
    pub commits: Vec<GitCommit>,
    pub commit_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub snapshot: RepositorySnapshot,
    pub merged: bool,
    pub conflicted: bool,
    pub error: Option<String>,
}

fn branch_head(root: &Path, branch: &str) -> Result<String, String> {
    run(root, &["check-ref-format", "--branch", branch])?;
    let reference = format!("refs/heads/{branch}^{{commit}}");
    optional_text(root, &["rev-parse", "--verify", &reference])?
        .ok_or_else(|| format!("本地分支“{branch}”不存在或尚无提交。"))
}

pub(super) fn preview_branch_merge(
    root: &Path,
    source: &str,
    target: &str,
) -> Result<MergePreview, String> {
    if source == target {
        return Err("请选择两个不同的分支。".to_owned());
    }
    let source_head = branch_head(root, source)?;
    let target_head = branch_head(root, target)?;
    let range = format!("{target_head}..{source_head}");
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
        target: target.to_owned(),
        source_head,
        target_head,
        commits,
        commit_count,
    })
}

pub fn preview_merge(path: &str, source: &str, target: &str) -> Result<MergePreview, String> {
    with_repository(path, |root| preview_branch_merge(root, source, target))
}

pub fn merge_branches(
    path: &str,
    source: &str,
    target: &str,
    source_head: &str,
    target_head: &str,
) -> Result<MergeResult, String> {
    with_repository(path, |root| {
        let before = snapshot(root)?;
        if before.operation.is_some() {
            return Err("请先完成或退出当前 Git 操作，再合并分支。".to_owned());
        }
        if !before.files.is_empty() {
            return Err("请先提交、暂存或撤回工作区中的更改，再合并分支。".to_owned());
        }
        if branch_head(root, source)? != source_head || branch_head(root, target)? != target_head {
            return Err("分支在预览后发生了变化，请重新打开合并预览。".to_owned());
        }
        if source == target {
            return Err("请选择两个不同的分支。".to_owned());
        }
        let preview = preview_branch_merge(root, source, target)?;
        if preview.commit_count == 0 {
            return Err(format!("分支“{source}”没有尚未合并到“{target}”的提交。"));
        }
        let original_branch = before.branch.clone();
        if original_branch != target {
            run(root, &["switch", "--", target])?;
        }
        let source_ref = format!("refs/heads/{source}");
        let merge_output = output(Some(root), &["merge", "--no-edit", &source_ref]);
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
                    if original_branch != target && !original_branch.starts_with("detached@") {
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
