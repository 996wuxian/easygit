use super::{
    error_text, output, parse_status, run, snapshot, validate_files, with_repository,
    RepositorySnapshot,
};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBlock {
    pub original_start: usize,
    pub modified_start: usize,
    pub removed: Vec<String>,
    pub added: Vec<String>,
    pub original_no_newline: bool,
    pub modified_no_newline: bool,
}

fn range_offset(value: &str) -> Result<usize, String> {
    let (start, count) = value.split_once(',').unwrap_or((value, "1"));
    let start: usize = start.parse().map_err(|_| "无法读取差异行号。")?;
    Ok(if count == "0" {
        start
    } else {
        start.saturating_sub(1)
    })
}

// Zero-context Git hunks each describe exactly one contiguous change block.
fn blocks(diff: &str) -> Result<Vec<(DiffBlock, String)>, String> {
    let mut results: Vec<(DiffBlock, String)> = Vec::new();
    let mut previous = "";
    for raw in diff.split_inclusive('\n') {
        let line = raw.trim_end_matches('\n');
        if let Some(header) = line.strip_prefix("@@ -") {
            let (old, rest) = header.split_once(" +").ok_or("无法读取差异块。")?;
            let (new, _) = rest.split_once(" @@").ok_or("无法读取差异块。")?;
            results.push((
                DiffBlock {
                    original_start: range_offset(old)?,
                    modified_start: range_offset(new)?,
                    removed: vec![],
                    added: vec![],
                    original_no_newline: false,
                    modified_no_newline: false,
                },
                raw.to_owned(),
            ));
        } else if let Some((block, patch)) = results.last_mut() {
            patch.push_str(raw);
            if let Some(text) = line.strip_prefix('-') {
                block.removed.push(text.trim_end_matches('\r').to_owned());
                previous = "-";
            } else if let Some(text) = line.strip_prefix('+') {
                block.added.push(text.trim_end_matches('\r').to_owned());
                previous = "+";
            } else if line.starts_with('\\') {
                if previous == "-" {
                    block.original_no_newline = true;
                }
                if previous == "+" {
                    block.modified_no_newline = true;
                }
            } else {
                return Err("此类型的差异不支持区块撤回。".to_owned());
            }
        }
    }
    Ok(results)
}

pub fn discard_diff_block(
    path: &str,
    file: &str,
    requested: &DiffBlock,
) -> Result<RepositorySnapshot, String> {
    validate_files(&[file.to_owned()])?;
    with_repository(path, |root| {
        let status = parse_status(&run(
            root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?)?;
        let entry = status
            .iter()
            .find(|entry| entry.path == file)
            .ok_or("此文件已没有未暂存更改，请刷新后重试。")?;
        if entry.conflicted || entry.worktree_status == "R" || !entry.unstaged {
            return Err("冲突文件、工作区重命名或已暂存的更改不支持区块撤回。".to_owned());
        }
        let mut args = vec![
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--unified=0",
            "--inter-hunk-context=0",
            "--diff-algorithm=myers",
            "--no-indent-heuristic",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ];
        let null_file = if cfg!(windows) { "NUL" } else { "/dev/null" };
        if entry.untracked {
            args.push("--no-index");
        }
        args.push("--");
        if entry.untracked {
            args.push(null_file);
        }
        args.push(file);
        let result = output(Some(root), &args)?;
        if !(result.status.success() || entry.untracked && result.status.code() == Some(1)) {
            return Err(error_text(&result));
        }
        if result.stdout.len() > 8 * 1024 * 1024 {
            return Err("差异过大，请使用整文件撤回。".to_owned());
        }
        let diff = String::from_utf8(result.stdout).map_err(|_| "仅支持 UTF-8 文本的区块撤回。")?;
        let matches = blocks(&diff)?;
        let (_, hunk) = matches
            .iter()
            .find(|(block, _)| block == requested)
            .ok_or("所选变更块已变化，请取消并刷新差异后重试。")?;
        let header_end = diff
            .find("\n@@ -")
            .map(|offset| offset + 1)
            .ok_or("没有可撤回的文本差异块。")?;
        // Use Git's freshly generated paths and hunk, never a caller-provided patch.
        // Earlier, unselected blocks can shift line numbers. Anchor both ranges
        // in worktree coordinates so reversing a pure deletion inserts it at
        // the right place even when earlier changes added or removed lines.
        let range = |count: usize| {
            format!(
                "{},{}",
                requested.modified_start + usize::from(count > 0),
                count
            )
        };
        let (_, body) = hunk.split_once('\n').ok_or("无法读取差异块内容。")?;
        let header: String = diff[..header_end]
            .split_inclusive('\n')
            .filter(|line| !line.starts_with("old mode ") && !line.starts_with("new mode "))
            .collect();
        let patch = format!(
            "{}@@ -{} +{} @@\n{body}",
            header,
            range(requested.removed.len()),
            range(requested.added.len())
        );
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let patch_file = directory.path().join("discard.patch");
        fs::write(&patch_file, patch).map_err(|error| error.to_string())?;
        let patch_path = patch_file.to_string_lossy();
        run(
            root,
            &[
                "apply",
                "--reverse",
                "--unidiff-zero",
                "--whitespace=nowarn",
                "--check",
                "--",
                &patch_path,
            ],
        )?;
        run(
            root,
            &[
                "apply",
                "--reverse",
                "--unidiff-zero",
                "--whitespace=nowarn",
                "--",
                &patch_path,
            ],
        )?;
        snapshot(root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{create_commit, stage_files};

    fn setup(filename: &str, original: &[u8], modified: Option<&[u8]>) -> tempfile::TempDir {
        let directory = crate::git::tests::repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        run(root, &["config", "core.autocrlf", "false"]).unwrap();
        fs::write(root.join(filename), original).unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();
        if let Some(modified) = modified {
            fs::write(root.join(filename), modified).unwrap();
        } else {
            fs::remove_file(root.join(filename)).unwrap();
        }
        directory
    }
    fn block(old: usize, new: usize, removed: &[&str], added: &[&str]) -> DiffBlock {
        DiffBlock {
            original_start: old,
            modified_start: new,
            removed: removed.iter().map(|text| (*text).into()).collect(),
            added: added.iter().map(|text| (*text).into()).collect(),
            original_no_newline: false,
            modified_no_newline: false,
        }
    }

    #[test]
    fn only_the_selected_block_is_reversed_and_index_is_untouched() {
        let filename = "[草稿] file.txt";
        let directory = setup(
            filename,
            b"one\ntwo\nthree\nfour\nfive\n",
            Some(b"staged\ntwo\nthree\nfour\nfive\n"),
        );
        let root = directory.path();
        let path = root.to_str().unwrap();
        stage_files(path, &[filename.to_owned()]).unwrap();
        let staged = run(root, &["show", &format!(":{filename}")]).unwrap();
        fs::write(
            root.join(filename),
            b"staged\nchanged two\nthree\nfour\nchanged five\n",
        )
        .unwrap();
        let result =
            discard_diff_block(path, filename, &block(1, 1, &["two"], &["changed two"])).unwrap();
        assert_eq!(
            fs::read(root.join(filename)).unwrap(),
            b"staged\ntwo\nthree\nfour\nchanged five\n"
        );
        assert_eq!(
            run(root, &["show", &format!(":{filename}")]).unwrap(),
            staged
        );
        assert!(result
            .files
            .iter()
            .any(|entry| entry.path == filename && entry.staged && entry.unstaged));
    }

    #[test]
    fn supports_pure_addition_deletion_and_unequal_replacements() {
        for (selected, expected) in [
            (
                block(1, 1, &["old"], &["new1", "new2"]),
                "start\nold\nmiddle\ntail\nextra\n",
            ),
            (
                block(3, 4, &["remove"], &[]),
                "start\nnew1\nnew2\nmiddle\nremove\ntail\nextra\n",
            ),
            (
                block(5, 5, &[], &["extra"]),
                "start\nnew1\nnew2\nmiddle\ntail\n",
            ),
        ] {
            let directory = setup(
                "file.txt",
                b"start\nold\nmiddle\nremove\ntail\n",
                Some(b"start\nnew1\nnew2\nmiddle\ntail\nextra\n"),
            );
            discard_diff_block(directory.path().to_str().unwrap(), "file.txt", &selected).unwrap();
            assert_eq!(
                fs::read_to_string(directory.path().join("file.txt")).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn rejects_changed_blocks_before_writing() {
        let directory = setup("file.txt", b"one\ntwo\n", Some(b"one\nexternal edit\n"));
        let path = directory.path().to_str().unwrap();
        let result = discard_diff_block(path, "file.txt", &block(1, 1, &["two"], &["stale edit"]));
        assert!(result.unwrap_err().contains("变更块已变化"));
        assert_eq!(
            fs::read(directory.path().join("file.txt")).unwrap(),
            b"one\nexternal edit\n"
        );
        assert!(discard_diff_block(path, "../file.txt", &block(0, 0, &[], &[])).is_err());
    }

    #[test]
    fn new_and_deleted_files_can_be_reversed_without_touching_other_files() {
        let directory = setup("deleted.txt", b"one\ntwo\n", None);
        let root = directory.path();
        let path = root.to_str().unwrap();
        discard_diff_block(path, "deleted.txt", &block(0, 0, &["one", "two"], &[])).unwrap();
        assert_eq!(fs::read(root.join("deleted.txt")).unwrap(), b"one\ntwo\n");
        fs::write(root.join("new.txt"), b"new\n").unwrap();
        fs::write(root.join("keep.txt"), b"keep\n").unwrap();
        discard_diff_block(path, "new.txt", &block(0, 0, &[], &["new"])).unwrap();
        assert!(!root.join("new.txt").exists());
        assert_eq!(fs::read(root.join("keep.txt")).unwrap(), b"keep\n");
    }

    #[test]
    fn respects_crlf_with_and_without_git_conversion() {
        for autocrlf in ["false", "true"] {
            let directory = setup(
                "file.txt",
                b"one\r\ntwo\r\nthree\r\n",
                Some(b"changed\r\ntwo\r\nother\r\n"),
            );
            let root = directory.path();
            run(root, &["config", "core.autocrlf", autocrlf]).unwrap();
            discard_diff_block(
                root.to_str().unwrap(),
                "file.txt",
                &block(0, 0, &["one"], &["changed"]),
            )
            .unwrap();
            assert_eq!(
                fs::read(root.join("file.txt")).unwrap(),
                b"one\r\ntwo\r\nother\r\n"
            );
        }
    }

    #[test]
    fn preserves_missing_final_newlines() {
        for (original, modified, old_missing, new_missing) in [
            (&b"old"[..], &b"new"[..], true, true),
            (&b"old\n"[..], &b"new"[..], false, true),
            (&b"old"[..], &b"new\n"[..], true, false),
        ] {
            let directory = setup("file.txt", original, Some(modified));
            let mut selected = block(0, 0, &["old"], &["new"]);
            selected.original_no_newline = old_missing;
            selected.modified_no_newline = new_missing;
            discard_diff_block(directory.path().to_str().unwrap(), "file.txt", &selected).unwrap();
            assert_eq!(
                fs::read(directory.path().join("file.txt")).unwrap(),
                original
            );
        }
    }
}
