use super::{
    command, error_text, output_mode, run, snapshot, validate_files, with_repository, OutputMode,
    RepositorySnapshot,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};

pub(super) const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_ENTRIES: usize = 5000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    name: String,
    path: String,
    directory: bool,
    blocked: bool,
    ignored: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListing {
    entries: Vec<ProjectEntry>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectText {
    pub content: Option<String>,
    pub revision: String,
    pub bom: bool,
    pub line_ending: String,
    pub reason: Option<String>,
    pub image: Option<ProjectImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectImage {
    pub mime: String,
    pub data_url: String,
    pub size: usize,
}

fn image_mime(file: &str) -> Option<&'static str> {
    match Path::new(file)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" | "jfif" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn image_preview(mime: &str, bytes: &[u8]) -> ProjectImage {
    ProjectImage {
        mime: mime.into(),
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        size: bytes.len(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedProjectText {
    pub file: ProjectText,
    pub snapshot: Option<RepositorySnapshot>,
    pub refresh_error: Option<String>,
}

fn reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.is_symlink()
    }
}

// Validate every component before following a directory. This also protects
// worktree .git files, Windows junctions, alternate streams and nested repos.
pub(super) fn safe_path(root: &Path, relative: &str, allow_root: bool) -> Result<PathBuf, String> {
    if relative.is_empty() && allow_root {
        return Ok(root.to_owned());
    }
    validate_files(&[relative.to_owned()])?;
    let mut path = root.to_owned();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("文件路径无效。".into());
        };
        let text = name.to_str().ok_or("暂不支持非 UTF-8 文件名。")?;
        if text.eq_ignore_ascii_case(".git") || text.contains(':') || text.ends_with(['.', ' ']) {
            return Err("不能访问 Git 管理文件或特殊文件路径。".into());
        }
        path.push(name);
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| format!("无法访问文件：{error}"))?;
        if reparse(&metadata)
            || !path
                .canonicalize()
                .map_err(|error| error.to_string())?
                .starts_with(root)
        {
            return Err("符号链接、目录联接和仓库外文件请使用外部工具处理。".into());
        }
        if metadata.is_dir() && path.join(".git").exists() {
            return Err("子模块或嵌套仓库请作为独立项目打开。".into());
        }
    }
    Ok(path)
}

fn ignored_paths(root: &Path, entries: &[ProjectEntry]) -> Result<HashSet<String>, String> {
    if entries.is_empty() {
        return Ok(HashSet::new());
    }
    // NUL-delimited stdin handles every filename and avoids Windows command-line
    // limits. A temporary file avoids blocking on a full stdin pipe.
    let mut input = tempfile::tempfile().map_err(|error| error.to_string())?;
    for entry in entries {
        input
            .write_all(entry.path.as_bytes())
            .and_then(|_| input.write_all(&[0]))
            .map_err(|error| error.to_string())?;
    }
    input
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut git = command(Some(root));
    git.args(["--no-literal-pathspecs", "check-ignore", "-z", "--stdin"])
        .stdin(Stdio::from(input));
    let result = crate::process::output_with_limit(
        &mut git,
        Duration::from_secs(60),
        8 * MAX_BYTES,
        MAX_BYTES,
    )
    .map_err(|error| error.to_string())?;
    if !result.status.success() && result.status.code() != Some(1) {
        return Err(error_text(&result));
    }
    Ok(result
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect())
}

fn list_at(root: &Path, directory: &str, show_ignored: bool) -> Result<ProjectListing, String> {
    let target = safe_path(root, directory, true)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(target).map_err(|error| format!("无法读取目录：{error}"))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "暂不支持非 UTF-8 文件名。")?;
        if name.eq_ignore_ascii_case(".git") {
            continue;
        }
        if entries.len() >= MAX_ENTRIES {
            return Err("单个目录超过 5000 项，请使用外部文件管理器。".into());
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        let path = if directory.is_empty() {
            name.clone()
        } else {
            format!("{directory}/{name}")
        };
        let blocked =
            safe_path(root, &path, false).is_err() || (!metadata.is_dir() && !metadata.is_file());
        entries.push(ProjectEntry {
            name,
            path,
            directory: metadata.is_dir(),
            blocked,
            ignored: false,
        });
    }
    let ignored = ignored_paths(root, &entries)?;
    for entry in &mut entries {
        entry.ignored = ignored.contains(&entry.path);
    }
    entries.retain(|entry| show_ignored || !entry.ignored);
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then(a.name.cmp(&b.name))
    });
    Ok(ProjectListing {
        entries,
        truncated: false,
    })
}

pub fn list_project_files(
    path: &str,
    directory: &str,
    show_ignored: bool,
    query: &str,
) -> Result<ProjectListing, String> {
    with_repository(path, |root| {
        if query.trim().is_empty() {
            return list_at(root, directory, show_ignored);
        }
        let query = query.trim().to_lowercase();
        let mut paths = run_search(root, false)?;
        if show_ignored {
            paths.extend(run_search(root, true)?);
        }
        paths.sort();
        paths.dedup();
        let mut entries = Vec::new();
        let mut truncated = false;
        for file in paths
            .into_iter()
            .filter(|file| file.to_lowercase().contains(&query))
        {
            let Ok(target) = safe_path(root, &file, false) else {
                continue;
            };
            if !target.is_file() {
                continue;
            }
            if entries.len() == 200 {
                truncated = true;
                break;
            }
            entries.push(ProjectEntry {
                name: file.rsplit('/').next().unwrap_or(&file).into(),
                path: file,
                directory: false,
                blocked: false,
                ignored: false,
            });
        }
        Ok(ProjectListing { entries, truncated })
    })
}

fn run_search(root: &Path, ignored: bool) -> Result<Vec<String>, String> {
    let args = if ignored {
        vec![
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
        ]
    } else {
        vec![
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ]
    };
    let result = output_mode(Some(root), &args, OutputMode::Bounded(4 * MAX_BYTES))?;
    if !result.status.success() {
        return Err(error_text(&result));
    }
    result
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| {
            String::from_utf8(part.to_vec()).map_err(|_| "暂不支持非 UTF-8 文件名。".into())
        })
        .collect()
}

fn read_at(root: &Path, file: &str) -> Result<ProjectText, String> {
    let target = safe_path(root, file, false)?;
    if !target.is_file() {
        return Err("请选择普通文件。".into());
    }
    let mime = image_mime(file);
    let limit = if mime.is_some() {
        MAX_IMAGE_BYTES
    } else {
        MAX_BYTES
    };
    let mut bytes = Vec::new();
    fs::File::open(&target)
        .map_err(|error| error.to_string())?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > limit {
        return Ok(ProjectText {
            content: None,
            revision: String::new(),
            bom: false,
            line_ending: "lf".into(),
            reason: Some(
                if mime.is_some() {
                    "图片超过 10 MiB，请使用外部工具查看。"
                } else {
                    "文件超过 2 MiB，请使用外部编辑器。"
                }
                .into(),
            ),
            image: None,
        });
    }
    let revision = format!("{:x}", Sha256::digest(&bytes));
    let bom = bytes.starts_with(b"\xef\xbb\xbf");
    let text = std::str::from_utf8(if bom { &bytes[3..] } else { &bytes });
    let mut result = ProjectText {
        content: None,
        revision,
        bom,
        line_ending: "lf".into(),
        reason: None,
        image: mime.map(|mime| image_preview(mime, &bytes)),
    };
    if mime.is_some_and(|mime| mime != "image/svg+xml") {
        return Ok(result);
    }
    if bytes.len() > MAX_BYTES {
        result.reason = Some("SVG 超过 2 MiB，仅支持图片预览，请使用外部编辑器修改。".into());
        return Ok(result);
    }
    match text {
        Ok(text) if !text.contains('\0') => {
            let crlf = text.matches("\r\n").count();
            let lf = text.matches('\n').count();
            if text.replace("\r\n", "").contains('\r') || (crlf > 0 && crlf != lf) {
                result.reason = Some("文件包含混合或旧式换行，请使用外部编辑器以保留格式。".into());
            } else {
                result.line_ending = if crlf > 0 { "crlf" } else { "lf" }.into();
                result.content = Some(text.replace("\r\n", "\n"));
            }
        }
        _ => result.reason = Some("二进制或非 UTF-8 文件，请使用外部工具查看。".into()),
    }
    Ok(result)
}

pub fn read_project_file(path: &str, file: &str) -> Result<ProjectText, String> {
    with_repository(path, |root| read_at(root, file))
}

pub fn save_project_file(
    path: &str,
    file: &str,
    revision: &str,
    content: &str,
) -> Result<SavedProjectText, String> {
    with_repository(path, |root| {
        let current = read_at(root, file)?;
        if current.revision != revision {
            return Err(
                "文件已被外部操作修改，请重新读取并核对后再保存；你的草稿仍然保留。".into(),
            );
        }
        if current.content.is_none() || content.contains(['\0', '\r']) {
            return Err("只支持编辑 UTF-8 文本。".into());
        }
        if !run(root, &["ls-files", "--unmerged", "-z", "--", file])?.is_empty() {
            return Err("此文件存在合并冲突，请使用冲突解决工具。".into());
        }
        let mut bytes = if current.bom {
            b"\xef\xbb\xbf".to_vec()
        } else {
            Vec::new()
        };
        let encoded = if current.line_ending == "crlf" {
            content.replace('\n', "\r\n")
        } else {
            content.to_owned()
        };
        bytes.extend_from_slice(encoded.as_bytes());
        if bytes.len() > MAX_BYTES {
            return Err("保存内容超过 2 MiB。".into());
        }
        let target = safe_path(root, file, false)?;
        let permissions = fs::metadata(&target)
            .map_err(|error| error.to_string())?
            .permissions();
        if permissions.readonly() {
            return Err("文件为只读，无法保存。".into());
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(target.parent().ok_or("文件目录无效。")?)
                .map_err(|error| error.to_string())?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| error.to_string())?;
        // Recheck after preparing the replacement. Our repository lock serializes
        // app operations; external editors are detected optimistically by content.
        if read_at(root, file)?.revision != revision {
            return Err("文件已被外部操作修改，保存已取消，草稿仍然保留。".into());
        }
        temporary
            .persist(&target)
            .map_err(|error| format!("无法保存文件：{}", error.error))?;
        // A successful disk write must be reported even if refreshing Git fails.
        let saved = ProjectText {
            content: Some(content.into()),
            revision: format!("{:x}", Sha256::digest(&bytes)),
            bom: current.bom,
            line_ending: current.line_ending,
            reason: None,
            image: image_mime(file).map(|mime| image_preview(mime, &bytes)),
        };
        let (snapshot, refresh_error) = match snapshot(root) {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        };
        Ok(SavedProjectText {
            file: saved,
            snapshot,
            refresh_error,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{create_commit, run_text, stage_files};

    #[test]
    fn images_are_returned_as_read_only_previews() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        let bytes = b"\x89PNG\r\n\x1a\n\0image bytes";
        for (file, mime) in [
            ("图片.PNG", "image/png"),
            ("photo.jpg", "image/jpeg"),
            ("photo.JPEG", "image/jpeg"),
            ("photo.jfif", "image/jpeg"),
            ("animated.gif", "image/gif"),
            ("photo.webp", "image/webp"),
            ("photo.bmp", "image/bmp"),
            ("icon.ico", "image/x-icon"),
            ("photo.avif", "image/avif"),
        ] {
            fs::write(root.join(file), bytes).unwrap();
            let read = read_project_file(path, file).unwrap();
            let image = read.image.unwrap();
            assert_eq!(image.mime, mime);
            assert_eq!(image.size, bytes.len());
            assert_eq!(
                image.data_url,
                format!("data:{mime};base64,{}", STANDARD.encode(bytes))
            );
            assert!(read.content.is_none());
            assert!(read.reason.is_none());
            assert!(save_project_file(path, file, &read.revision, "text").is_err());
            assert_eq!(fs::read(root.join(file)).unwrap(), bytes);
        }
    }

    #[test]
    fn svg_supports_preview_source_and_saving() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>图片</text></svg>";
        fs::write(root.join("icon.svg"), svg).unwrap();
        let read = read_project_file(path, "icon.svg").unwrap();
        assert_eq!(read.content.as_deref(), Some(svg));
        assert_eq!(read.image.unwrap().mime, "image/svg+xml");
        let edited = svg.replace("图片", "修改");
        let saved = save_project_file(path, "icon.svg", &read.revision, &edited).unwrap();
        assert_eq!(saved.file.content.as_deref(), Some(edited.as_str()));
        assert_eq!(
            saved.file.image.unwrap().data_url,
            format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(edited.as_bytes())
            )
        );
        assert_eq!(fs::read_to_string(root.join("icon.svg")).unwrap(), edited);
    }

    #[test]
    fn images_have_a_separate_bounded_read_limit() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        let bytes = vec![0; MAX_BYTES + 1];
        fs::write(root.join("large.png"), &bytes).unwrap();
        assert_eq!(
            read_project_file(path, "large.png")
                .unwrap()
                .image
                .unwrap()
                .size,
            bytes.len()
        );
        fs::write(root.join("large.svg"), &bytes).unwrap();
        let svg = read_project_file(path, "large.svg").unwrap();
        assert!(svg.image.is_some() && svg.content.is_none());
        assert!(svg.reason.unwrap().contains("2 MiB"));
        fs::write(root.join("large.png"), vec![0; MAX_IMAGE_BYTES + 1]).unwrap();
        let read = read_project_file(path, "large.png").unwrap();
        assert!(read.image.is_none() && read.content.is_none());
        assert!(read.reason.unwrap().contains("10 MiB"));
    }

    #[test]
    fn directories_are_lazy_sorted_and_ignored_files_are_optional() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        fs::write(root.join(".gitignore"), "build/\nsecret.txt\n").unwrap();
        fs::create_dir(root.join("build")).unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/clean.ts"), "clean").unwrap();
        fs::write(root.join("secret.txt"), "ignored").unwrap();
        fs::write(root.join("readme.md"), "text").unwrap();
        fs::write(root.join("中文 [draft].txt"), "unicode").unwrap();
        let listing = list_project_files(path, "", false, "").unwrap();
        assert_eq!(listing.entries[0].path, "src");
        assert!(listing.entries.iter().all(|entry| ![
            ".git",
            "build",
            "secret.txt",
            "src/clean.ts"
        ]
        .contains(&entry.path.as_str())));
        let all = list_project_files(path, "", true, "").unwrap();
        assert!(all
            .entries
            .iter()
            .any(|entry| entry.path == "build" && entry.ignored));
        assert!(all.entries.iter().all(|entry| entry.path != ".git"));
        let child = list_project_files(path, "src", false, "").unwrap();
        assert_eq!(child.entries[0].path, "src/clean.ts");
        assert_eq!(
            list_project_files(path, "", false, "CLEAN")
                .unwrap()
                .entries[0]
                .path,
            "src/clean.ts"
        );
        assert!(list_project_files(path, "", false, "secret")
            .unwrap()
            .entries
            .is_empty());
        assert_eq!(
            list_project_files(path, "", true, "secret")
                .unwrap()
                .entries[0]
                .path,
            "secret.txt"
        );
        assert_eq!(
            list_project_files(path, "", false, "[draft]")
                .unwrap()
                .entries[0]
                .path,
            "中文 [draft].txt"
        );
    }

    #[test]
    fn saving_preserves_bom_crlf_final_newline_and_index() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        let original = b"\xef\xbb\xbfhello\r\nworld";
        fs::write(root.join("text.txt"), original).unwrap();
        stage_files(path, &["text.txt".into()]).unwrap();
        create_commit(path, "initial").unwrap();
        fs::write(root.join("text.txt"), b"\xef\xbb\xbfstaged\r\nworld").unwrap();
        stage_files(path, &["text.txt".into()]).unwrap();
        let before = run(root, &["show", ":text.txt"]).unwrap();
        let read = read_project_file(path, "text.txt").unwrap();
        assert!(read.bom);
        assert_eq!(read.line_ending, "crlf");
        assert_eq!(read.content.as_deref(), Some("staged\nworld"));
        let saved = save_project_file(path, "text.txt", &read.revision, "edited\nworld").unwrap();
        assert_eq!(
            fs::read(root.join("text.txt")).unwrap(),
            b"\xef\xbb\xbfedited\r\nworld"
        );
        assert_eq!(run(root, &["show", ":text.txt"]).unwrap(), before);
        assert!(saved
            .snapshot
            .unwrap()
            .files
            .iter()
            .any(|file| file.path == "text.txt" && file.staged && file.unstaged));
        assert_eq!(
            saved.file.revision,
            read_project_file(path, "text.txt").unwrap().revision
        );
    }

    #[test]
    fn empty_files_and_final_newlines_round_trip() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        fs::write(root.join("text.txt"), "").unwrap();
        for content in ["one\n", "", "two"] {
            let read = read_project_file(path, "text.txt").unwrap();
            save_project_file(path, "text.txt", &read.revision, content).unwrap();
            assert_eq!(fs::read_to_string(root.join("text.txt")).unwrap(), content);
        }
    }

    #[test]
    fn stale_and_deleted_files_are_never_overwritten() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        fs::write(root.join("text.txt"), "original").unwrap();
        let read = read_project_file(path, "text.txt").unwrap();
        fs::write(root.join("text.txt"), "external").unwrap();
        assert!(save_project_file(path, "text.txt", &read.revision, "draft")
            .unwrap_err()
            .contains("外部"));
        assert_eq!(
            fs::read_to_string(root.join("text.txt")).unwrap(),
            "external"
        );
        fs::remove_file(root.join("text.txt")).unwrap();
        assert!(save_project_file(path, "text.txt", &read.revision, "draft").is_err());
        assert!(!root.join("text.txt").exists());
    }

    #[test]
    fn unsupported_formats_and_oversized_saves_are_rejected() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        for content in [
            b"binary\0".as_slice(),
            b"\xff\xfe",
            b"mixed\r\nnew\n",
            &vec![b'x'; MAX_BYTES + 1],
        ] {
            fs::write(root.join("text.txt"), content).unwrap();
            let read = read_project_file(path, "text.txt").unwrap();
            assert!(read.content.is_none() && read.reason.is_some());
            assert!(save_project_file(path, "text.txt", &read.revision, "draft").is_err());
            assert_eq!(fs::read(root.join("text.txt")).unwrap(), content);
        }
        fs::write(root.join("text.txt"), "small").unwrap();
        let read = read_project_file(path, "text.txt").unwrap();
        assert!(
            save_project_file(path, "text.txt", &read.revision, &"x".repeat(MAX_BYTES + 1))
                .is_err()
        );
    }

    #[test]
    fn traversal_git_metadata_and_nested_repositories_are_protected() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("nested/.git"), "gitdir: somewhere").unwrap();
        fs::write(root.join("nested/text.txt"), "nested").unwrap();
        for file in [
            "../outside",
            ".git/config",
            ".GIT/config",
            "nested/text.txt",
            "file:stream",
            "C:/Windows/win.ini",
        ] {
            assert!(read_project_file(path, file).is_err(), "{file}");
            assert!(
                save_project_file(path, file, "stale", "draft").is_err(),
                "{file}"
            );
        }
        assert!(list_project_files(path, "nested", false, "").is_err());
        assert_eq!(
            run_text(root, &["config", "user.name"]).unwrap(),
            "esaygit test"
        );
    }

    #[test]
    fn conflicts_must_use_the_conflict_resolver() {
        let repository = crate::git::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        fs::write(root.join("text.txt"), "base\n").unwrap();
        stage_files(path, &["text.txt".into()]).unwrap();
        create_commit(path, "base").unwrap();
        run(root, &["branch", "other"]).unwrap();
        fs::write(root.join("text.txt"), "main\n").unwrap();
        stage_files(path, &["text.txt".into()]).unwrap();
        create_commit(path, "main").unwrap();
        run(root, &["switch", "other"]).unwrap();
        fs::write(root.join("text.txt"), "other\n").unwrap();
        stage_files(path, &["text.txt".into()]).unwrap();
        create_commit(path, "other").unwrap();
        run(root, &["switch", "main"]).unwrap();
        assert!(run(root, &["merge", "other"]).is_err());
        let read = read_project_file(path, "text.txt").unwrap();
        assert!(
            save_project_file(path, "text.txt", &read.revision, "resolved\n")
                .unwrap_err()
                .contains("冲突")
        );
        assert!(!run(root, &["ls-files", "--unmerged"]).unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_junctions_cannot_read_or_replace_external_files() {
        use std::os::windows::process::CommandExt;
        let repository = crate::git::tests::repo();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("external.txt"), "keep external").unwrap();
        let link = repository.path().join("linked");
        let status = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let path = repository.path().to_str().unwrap();
        let listing = list_project_files(path, "", false, "").unwrap();
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path == "linked" && entry.blocked));
        assert!(list_project_files(path, "linked", false, "").is_err());
        assert!(read_project_file(path, "linked/external.txt").is_err());
        assert!(save_project_file(path, "linked/external.txt", "", "overwrite").is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("external.txt")).unwrap(),
            "keep external"
        );
        fs::remove_dir(link).unwrap();
    }
}
