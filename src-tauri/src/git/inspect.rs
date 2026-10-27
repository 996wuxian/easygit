use super::{
    merge::{branch_head, branch_reference},
    run, run_text, validate_files, with_repository,
};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionComparison {
    pub base: String,
    pub target: String,
    pub files: Vec<RevisionFile>,
}

pub(super) fn commit_hash(root: &Path, value: &str) -> Result<String, String> {
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("提交标识无效，请刷新后重试。".into());
    }
    run_text(
        root,
        &["rev-parse", "--verify", &format!("{value}^{{commit}}")],
    )
}

pub(super) fn patch(root: &Path, args: &[&str]) -> Result<String, String> {
    let bytes = super::run_mode(root, args, super::OutputMode::Bounded(super::DIFF_LIMIT))?;
    String::from_utf8(bytes).map_err(|_| "差异不是 UTF-8 文本，请使用外部工具查看。".into())
}

#[cfg(test)]
mod limit_tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_large_patch_during_git_output_read() {
        let directory = super::super::tests::repo();
        let root = directory.path();
        fs::write(root.join("large.txt"), "text line\n".repeat(300_000)).unwrap();
        run(root, &["add", "--", "large.txt"]).unwrap();
        let error = patch(root, &["diff", "--cached", "--", "large.txt"]).unwrap_err();
        assert!(error.contains("输出超过"), "{error}");
    }
}

fn parse_files(bytes: &[u8]) -> Result<Vec<RevisionFile>, String> {
    let mut fields = bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    let mut files = Vec::new();
    while let Some(status) = fields.next() {
        let text = |value: &[u8]| {
            String::from_utf8(value.to_vec()).map_err(|_| "暂不支持非 UTF-8 文件名。".to_owned())
        };
        let status = text(status)?;
        let first = text(fields.next().ok_or("Git 文件差异格式不完整。")?)?;
        let renamed = status.starts_with('R') || status.starts_with('C');
        let (path, old_path) = if renamed {
            (
                text(fields.next().ok_or("Git 重命名记录不完整。")?)?,
                Some(first),
            )
        } else {
            (first, None)
        };
        files.push(RevisionFile {
            path,
            old_path,
            status,
        });
    }
    Ok(files)
}

fn files(root: &Path, base: Option<&str>, target: &str) -> Result<Vec<RevisionFile>, String> {
    let args = match base {
        Some(base) => vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-status",
            "-z",
            "-M",
            base,
            target,
            "--",
        ],
        None => vec![
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            "--name-status",
            "-z",
            "-M",
            target,
            "--",
        ],
    };
    parse_files(&run(root, &args)?)
}

fn file_patch(root: &Path, base: Option<&str>, target: &str, file: &str) -> Result<String, String> {
    validate_files(&[file.to_owned()])?;
    let entry = files(root, base, target)?
        .into_iter()
        .find(|entry| entry.path == file)
        .ok_or("所选文件不在本次差异中。")?;
    let mut args = match base {
        Some(base) => vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "-M",
            base,
            target,
            "--",
        ],
        None => vec![
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            "-p",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "-M",
            target,
            "--",
        ],
    };
    args.push(&entry.path);
    if let Some(old_path) = &entry.old_path {
        args.push(old_path);
    }
    patch(root, &args)
}

pub fn commit_diff(path: &str, commit: &str, file: &str) -> Result<String, String> {
    with_repository(path, |root| {
        let target = commit_hash(root, commit)?;
        let parents = run_text(root, &["rev-list", "--parents", "-n", "1", &target])?;
        file_patch(root, parents.split_whitespace().nth(1), &target, file)
    })
}

pub fn compare_branches(
    path: &str,
    base: &str,
    base_remote: bool,
    target: &str,
    target_remote: bool,
) -> Result<RevisionComparison, String> {
    with_repository(path, |root| {
        // Validate exact namespaces even when local and remote names overlap.
        branch_reference(root, base, base_remote)?;
        branch_reference(root, target, target_remote)?;
        let base = branch_head(root, base, base_remote)?;
        let target = branch_head(root, target, target_remote)?;
        Ok(RevisionComparison {
            files: files(root, Some(&base), &target)?,
            base,
            target,
        })
    })
}

pub fn comparison_diff(path: &str, base: &str, target: &str, file: &str) -> Result<String, String> {
    with_repository(path, |root| {
        let base = commit_hash(root, base)?;
        let target = commit_hash(root, target)?;
        file_patch(root, Some(&base), &target, file)
    })
}

pub fn compare_commits(path: &str, base: &str, target: &str) -> Result<RevisionComparison, String> {
    with_repository(path, |root| {
        let base = commit_hash(root, base)?;
        let target = commit_hash(root, target)?;
        Ok(RevisionComparison {
            files: files(root, Some(&base), &target)?,
            base,
            target,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{snapshot, tests::repo};
    use std::fs;

    #[test]
    fn commit_comparison_handles_cross_branch_rename_reverse_and_identical_trees_readonly() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        fs::write(root.join("original.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(root.join("deleted.txt"), "removed\n").unwrap();
        run(root, &["add", "."]).unwrap();
        run(root, &["commit", "-m", "base"]).unwrap();
        let base = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        run(root, &["switch", "-c", "feature"]).unwrap();
        run(root, &["mv", "original.txt", "renamed.txt"]).unwrap();
        run(root, &["rm", "deleted.txt"]).unwrap();
        fs::write(root.join("added.txt"), "new content\n").unwrap();
        run(root, &["add", "."]).unwrap();
        run(root, &["commit", "-m", "target"]).unwrap();
        let target = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        run(root, &["switch", "main"]).unwrap();
        fs::write(root.join("main.txt"), "main only\n").unwrap();
        run(root, &["add", "."]).unwrap();
        run(root, &["commit", "-m", "diverged"]).unwrap();
        let other = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        fs::write(root.join("original.txt"), "staged work\n").unwrap();
        run(root, &["add", "."]).unwrap();
        fs::write(root.join("original.txt"), "unstaged work\n").unwrap();
        let before = snapshot(root).unwrap().revision;
        let result = compare_commits(path, &base, &target).unwrap();
        assert_eq!(result.base, base);
        assert_eq!(result.target, target);
        assert_eq!(result.files.len(), 3);
        let renamed = result
            .files
            .iter()
            .find(|file| file.path == "renamed.txt")
            .unwrap();
        assert!(renamed.status.starts_with('R'));
        assert_eq!(renamed.old_path.as_deref(), Some("original.txt"));
        assert!(result
            .files
            .iter()
            .any(|file| file.path == "added.txt" && file.status == "A"));
        assert!(result
            .files
            .iter()
            .any(|file| file.path == "deleted.txt" && file.status == "D"));
        assert!(comparison_diff(path, &base, &target, "added.txt")
            .unwrap()
            .contains("+new content"));
        assert!(comparison_diff(path, &target, &base, "added.txt")
            .unwrap()
            .contains("-new content"));
        let cross = compare_commits(path, &other, &target).unwrap();
        assert!(cross
            .files
            .iter()
            .any(|file| file.path == "main.txt" && file.status == "D"));
        assert!(compare_commits(path, &base, &base)
            .unwrap()
            .files
            .is_empty());
        assert_eq!(snapshot(root).unwrap().revision, before);
        assert_eq!(
            fs::read_to_string(root.join("original.txt")).unwrap(),
            "unstaged work\n"
        );
        assert_eq!(
            run_text(root, &["show", ":original.txt"]).unwrap(),
            "staged work"
        );
    }

    #[test]
    fn commit_comparison_rejects_expressions_missing_objects_and_outside_files() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        run(root, &["commit", "--allow-empty", "-m", "root"]).unwrap();
        let hash = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        for invalid in ["HEAD", "--help", &"0".repeat(40)] {
            assert!(compare_commits(path, invalid, &hash).is_err());
        }
        assert!(comparison_diff(path, &hash, &hash, "../outside.txt").is_err());
        assert!(comparison_diff(path, &hash, &hash, "missing.txt").is_err());
    }
}
