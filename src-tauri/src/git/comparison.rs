use super::{optional_text, output, parse_status, run, run_text, validate_files, with_repository};
use serde::Serialize;
use std::{fs, io::Read, path::Path};

const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileComparison {
    pub diff: String,
    pub unchanged: Option<String>,
    pub binary: bool,
    pub original_exists: bool,
    pub modified_exists: bool,
}

fn read_object(root: &Path, mode: &str, oid: &str) -> Result<Vec<u8>, String> {
    if mode == "160000" {
        return Ok(format!("Subproject commit {oid}\n").into_bytes());
    }
    let size = run_text(root, &["cat-file", "-s", oid])?
        .parse::<usize>()
        .map_err(|_| "无法识别 Git 文件大小。")?;
    if size > MAX_SOURCE_BYTES {
        return Err("文件超过 2 MB，暂不支持全屏源码比对，请使用普通差异视图。".to_owned());
    }
    run(root, &["cat-file", "blob", oid])
}

fn head_content(root: &Path, file: &str) -> Result<Option<Vec<u8>>, String> {
    if optional_text(root, &["rev-parse", "--verify", "HEAD"])?.is_none() {
        return Ok(None);
    }
    let entries = run(root, &["ls-tree", "-z", "HEAD", "--", file])?;
    for record in entries.split(|byte| *byte == 0) {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
            continue;
        };
        if &record[tab + 1..] != file.as_bytes() {
            continue;
        }
        let header = String::from_utf8_lossy(&record[..tab]);
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() == 3 {
            return read_object(root, fields[0], fields[2]).map(Some);
        }
    }
    Ok(None)
}

fn index_content(root: &Path, file: &str) -> Result<Option<Vec<u8>>, String> {
    let entries = run(root, &["ls-files", "--stage", "-z", "--", file])?;
    for record in entries.split(|byte| *byte == 0) {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
            continue;
        };
        if &record[tab + 1..] != file.as_bytes() {
            continue;
        }
        let header = String::from_utf8_lossy(&record[..tab]);
        let fields: Vec<_> = header.split_whitespace().collect();
        // Stage 2 is our branch's version in an unresolved conflict.
        if fields.len() == 3 && matches!(fields[2], "0" | "2") {
            return read_object(root, fields[0], fields[1]).map(Some);
        }
    }
    Ok(None)
}

fn working_content(root: &Path, file: &str) -> Result<Option<Vec<u8>>, String> {
    let path = root.join(file);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法读取工作区文件：{error}")),
    };
    if metadata.is_symlink() {
        return fs::read_link(&path)
            .map(|target| Some(target.to_string_lossy().as_bytes().to_vec()))
            .map_err(|error| error.to_string());
    }
    let absolute = path.canonicalize().map_err(|error| error.to_string())?;
    if !absolute.starts_with(root) {
        return Err("无法读取仓库范围外的文件。".to_owned());
    }
    if metadata.is_dir() {
        let oid = run_text(&absolute, &["rev-parse", "HEAD"])?;
        return Ok(Some(format!("Subproject commit {oid}\n").into_bytes()));
    }
    if !metadata.is_file() {
        return Err("此文件类型不支持源码比对。".to_owned());
    }
    let mut bytes = Vec::new();
    fs::File::open(absolute)
        .map_err(|error| error.to_string())?
        .take(MAX_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("文件超过 2 MB，暂不支持全屏源码比对，请使用普通差异视图。".to_owned());
    }
    Ok(Some(bytes))
}

pub fn read_file_comparison(
    path: &str,
    file: &str,
    staged: bool,
) -> Result<FileComparison, String> {
    validate_files(&[file.to_owned()])?;
    with_repository(path, |root| {
        let files = parse_status(&run(
            root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?)?;
        let selected = files.iter().find(|entry| entry.path == file);
        let original_path = selected
            .and_then(|entry| {
                (staged || entry.worktree_status == "R")
                    .then_some(entry.old_path.as_deref())
                    .flatten()
            })
            .unwrap_or(file);
        let original = if staged {
            head_content(root, original_path)?
        } else {
            index_content(root, original_path)?
        };
        let modified = if staged {
            index_content(root, file)?
        } else {
            working_content(root, file)?
        };
        let before = original.as_deref().unwrap_or_default();
        let after = modified.as_deref().unwrap_or_default();
        let binary = [before, after]
            .iter()
            .any(|bytes| bytes.contains(&0) || std::str::from_utf8(bytes).is_err());
        let mut comparison = FileComparison {
            diff: String::new(),
            unchanged: None,
            binary,
            original_exists: original.is_some(),
            modified_exists: modified.is_some(),
        };
        if binary {
            return Ok(comparison);
        }
        let before = String::from_utf8_lossy(before).replace("\r\n", "\n");
        let after = String::from_utf8_lossy(after).replace("\r\n", "\n");
        if before == after {
            comparison.unchanged = Some(before);
            return Ok(comparison);
        }
        // Diff the exact contents already read, rather than a moving index/worktree pair.
        let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
        let old_file = directory.path().join("original");
        let new_file = directory.path().join("modified");
        fs::write(&old_file, &before).map_err(|error| error.to_string())?;
        fs::write(&new_file, &after).map_err(|error| error.to_string())?;
        let result = output(
            None,
            &[
                "-c",
                "diff.algorithm=myers",
                "-c",
                "diff.indentHeuristic=false",
                "diff",
                "--no-index",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--unified=2147483647",
                "--",
                &old_file.to_string_lossy(),
                &new_file.to_string_lossy(),
            ],
        )?;
        if !result.status.success() && result.status.code() != Some(1) {
            return Err(super::error_text(&result));
        }
        comparison.diff = String::from_utf8_lossy(&result.stdout).into_owned();
        Ok(comparison)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{create_commit, stage_files};

    #[test]
    fn staged_and_working_comparisons_use_the_correct_versions() {
        let directory = crate::git::tests::repo();
        let path = directory.path().to_str().unwrap();
        let file = "中文 source.txt";
        fs::write(directory.path().join(file), "original\nunchanged\n").unwrap();
        stage_files(path, &[file.to_owned()]).unwrap();
        create_commit(path, "initial").unwrap();
        fs::write(directory.path().join(file), "staged\nunchanged\n").unwrap();
        stage_files(path, &[file.to_owned()]).unwrap();
        fs::write(directory.path().join(file), "working\nunchanged\n").unwrap();
        let staged = read_file_comparison(path, file, true).unwrap();
        assert!(staged.diff.contains("-original\n+staged"));
        assert!(!staged.diff.contains("+working"));
        let working = read_file_comparison(path, file, false).unwrap();
        assert!(working.diff.contains("-staged\n+working"));
        assert!(working.diff.contains(" unchanged"));
        fs::write(directory.path().join(file), "staged\r\nunchanged\r\n").unwrap();
        assert_eq!(
            read_file_comparison(path, file, false)
                .unwrap()
                .unchanged
                .as_deref(),
            Some("staged\nunchanged\n")
        );
    }

    #[test]
    fn handles_new_deleted_renamed_and_unchanged_files() {
        let directory = crate::git::tests::repo();
        let path = directory.path().to_str().unwrap();
        fs::write(directory.path().join("first.txt"), "content\n").unwrap();
        let added = read_file_comparison(path, "first.txt", false).unwrap();
        assert!(!added.original_exists && added.modified_exists);
        assert!(added.diff.contains("+content"));
        stage_files(path, &["first.txt".to_owned()]).unwrap();
        assert!(read_file_comparison(path, "first.txt", true)
            .unwrap()
            .diff
            .contains("+content"));
        create_commit(path, "initial").unwrap();
        run(directory.path(), &["mv", "first.txt", "renamed.txt"]).unwrap();
        let renamed = read_file_comparison(path, "renamed.txt", true).unwrap();
        assert_eq!(renamed.unchanged.as_deref(), Some("content\n"));
        fs::remove_file(directory.path().join("renamed.txt")).unwrap();
        let deleted = read_file_comparison(path, "renamed.txt", false).unwrap();
        assert!(deleted.original_exists && !deleted.modified_exists);
        assert!(deleted.diff.contains("-content"));
    }

    #[test]
    fn detects_binary_content_and_rejects_large_or_outside_files() {
        let directory = crate::git::tests::repo();
        let path = directory.path().to_str().unwrap();
        fs::write(directory.path().join("image.bin"), [0, 1, 2]).unwrap();
        assert!(
            read_file_comparison(path, "image.bin", false)
                .unwrap()
                .binary
        );
        fs::write(
            directory.path().join("large.txt"),
            vec![b'a'; MAX_SOURCE_BYTES + 1],
        )
        .unwrap();
        assert!(read_file_comparison(path, "large.txt", false)
            .unwrap_err()
            .contains("2 MB"));
        assert!(read_file_comparison(path, "../outside.txt", false).is_err());
    }
}
