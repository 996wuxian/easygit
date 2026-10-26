use super::comparison::{compare_contents, FileComparison};
use super::{run, run_text, snapshot, validate_files, with_repository, RepositorySnapshot};
use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
};

const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub working: Option<String>,
    pub ours_exists: bool,
    pub theirs_exists: bool,
    pub working_exists: bool,
    pub binary: bool,
    pub marker_size: usize,
    pub revision: String,
    pub comparison: Option<FileComparison>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictResolution {
    Content,
    Ours,
    Theirs,
    Working,
    Delete,
}

// Never follow a symlink or a junction while reading or replacing a conflict file.
fn working_path(root: &Path, file: &str) -> Result<PathBuf, String> {
    let mut path = root.to_owned();
    for component in Path::new(file).components() {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.is_symlink()
                    || !path
                        .canonicalize()
                        .map_err(|error| error.to_string())?
                        .starts_with(root)
                {
                    return Err("暂不支持在应用内处理符号链接或仓库外的冲突文件。".to_owned());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    if path.is_dir() {
        return Err("目录或子模块冲突请在外部 Git 工具中处理。".to_owned());
    }
    Ok(path)
}

fn read_working(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("冲突文件超过 2 MB，请在外部编辑器中处理。".to_owned());
    }
    Ok(Some(bytes))
}

fn read_at(root: &Path, file: &str, with_comparison: bool) -> Result<ConflictFile, String> {
    let entries = run(root, &["ls-files", "--unmerged", "-z", "--", file])?;
    let mut versions: [Option<Vec<u8>>; 2] = [None, None];
    let mut found = false;
    for record in entries.split(|byte| *byte == 0) {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
            continue;
        };
        if &record[tab + 1..] != file.as_bytes() {
            continue;
        }
        found = true;
        let header = String::from_utf8_lossy(&record[..tab]);
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") {
            return Err("符号链接或子模块冲突请在外部 Git 工具中处理。".to_owned());
        }
        if let Some(index) = match fields[2] {
            "2" => Some(0),
            "3" => Some(1),
            _ => None,
        } {
            let size: usize = run_text(root, &["cat-file", "-s", fields[1]])?
                .parse()
                .map_err(|_| "无法读取冲突文件大小。")?;
            if size > MAX_BYTES {
                return Err("冲突文件超过 2 MB，请在外部编辑器中处理。".to_owned());
            }
            versions[index] = Some(run(root, &["cat-file", "blob", fields[1]])?);
        }
    }
    if !found {
        return Err("此文件已没有未解决的冲突，请刷新后重试。".to_owned());
    }
    let working = read_working(&working_path(root, file)?)?;
    let attributes = run(
        root,
        &["check-attr", "-z", "conflict-marker-size", "--", file],
    )?;
    let marker_size = attributes
        .split(|byte| *byte == 0)
        .nth(2)
        .and_then(|value| std::str::from_utf8(value).ok())
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|size| *size > 0 && *size <= 1024)
        .unwrap_or(7);
    let binary = versions
        .iter()
        .chain(std::iter::once(&working))
        .flatten()
        .any(|bytes| bytes.contains(&0) || std::str::from_utf8(bytes).is_err());
    let text = |bytes: &Option<Vec<u8>>| {
        bytes
            .as_ref()
            .and_then(|bytes| (!binary).then(|| String::from_utf8_lossy(bytes).into_owned()))
    };
    let mut hash = DefaultHasher::new();
    entries.hash(&mut hash);
    working.hash(&mut hash);
    marker_size.hash(&mut hash);
    Ok(ConflictFile {
        ours: text(&versions[0]),
        theirs: text(&versions[1]),
        working: text(&working),
        ours_exists: versions[0].is_some(),
        theirs_exists: versions[1].is_some(),
        working_exists: working.is_some(),
        binary,
        marker_size,
        revision: format!("{:x}", hash.finish()),
        comparison: if binary || !with_comparison {
            None
        } else {
            Some(compare_contents(
                versions[0].as_deref(),
                versions[1].as_deref(),
            )?)
        },
    })
}

fn has_markers(content: &str, size: usize) -> bool {
    content.lines().any(|line| {
        let line = line.trim_end_matches('\r');
        [('<', true), ('|', true), ('=', false), ('>', true)]
            .iter()
            .any(|(marker, label)| {
                let prefix: String = std::iter::repeat_n(*marker, size).collect();
                line.strip_prefix(&prefix)
                    .is_some_and(|suffix| suffix.is_empty() || *label && suffix.starts_with(' '))
            })
    })
}

pub fn read_conflict(path: &str, file: &str) -> Result<ConflictFile, String> {
    validate_files(&[file.to_owned()])?;
    with_repository(path, |root| read_at(root, file, true))
}

pub fn resolve_conflict(
    path: &str,
    file: &str,
    revision: &str,
    resolution: ConflictResolution,
    content: Option<&str>,
) -> Result<RepositorySnapshot, String> {
    validate_files(&[file.to_owned()])?;
    with_repository(path, |root| {
        let current = read_at(root, file, false)?;
        if current.revision != revision {
            return Err(
                "冲突文件已被其他操作修改，请重新读取后再解决，避免覆盖新内容。".to_owned(),
            );
        }
        let target = working_path(root, file)?;
        let remove = match resolution {
            ConflictResolution::Ours => !current.ours_exists,
            ConflictResolution::Theirs => !current.theirs_exists,
            ConflictResolution::Delete => true,
            _ => false,
        };
        if remove {
            if target.exists() {
                fs::remove_file(&target).map_err(|error| error.to_string())?;
            }
        } else {
            match resolution {
                ConflictResolution::Content => {
                    let content = content.ok_or("缺少合并结果。")?;
                    if current.binary || content.len() > MAX_BYTES || content.contains('\0') {
                        return Err("只支持编辑 2 MB 以内的 UTF-8 文本冲突。".to_owned());
                    }
                    if has_markers(content, current.marker_size) {
                        return Err("合并结果中仍包含冲突标记，请处理完后再保存。".to_owned());
                    }
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                    }
                    fs::write(&target, content).map_err(|error| error.to_string())?;
                }
                ConflictResolution::Ours | ConflictResolution::Theirs => {
                    let side = if matches!(resolution, ConflictResolution::Ours) {
                        "--ours"
                    } else {
                        "--theirs"
                    };
                    run(root, &["checkout", side, "--", file])?;
                }
                ConflictResolution::Working => {
                    if !current.working_exists || current.binary {
                        return Err("请先选择要保留的版本或删除文件。".to_owned());
                    }
                    if has_markers(
                        current.working.as_deref().unwrap_or_default(),
                        current.marker_size,
                    ) {
                        return Err("工作区文件仍包含冲突标记，请先解决冲突。".to_owned());
                    }
                }
                ConflictResolution::Delete => unreachable!(),
            }
        }
        // If staging fails, leave the resolved worktree contents available for retry.
        run(root, &["add", "--", file])?;
        snapshot(root)
    })
}
