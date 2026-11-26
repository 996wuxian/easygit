use super::{
    command, comparison::read_file_versions, error_text, optional_text, repository_root, run,
    validate_files,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, UNIX_EPOCH},
};

const BLAME_STDOUT_LIMIT: usize = 64 * 1024 * 1024;
const BLAME_STDERR_LIMIT: usize = 1024 * 1024;

#[derive(Clone, Default)]
pub struct BlameState(Arc<Mutex<HashMap<PathBuf, Arc<AtomicBool>>>>);

struct BlameGuard {
    state: BlameState,
    root: PathBuf,
    cancelled: Arc<AtomicBool>,
}

impl BlameState {
    fn start(&self, root: PathBuf) -> BlameGuard {
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = self.0.lock() {
            if let Some(previous) = active.insert(root.clone(), cancelled.clone()) {
                previous.store(true, Ordering::Relaxed);
            }
        }
        BlameGuard {
            state: self.clone(),
            root,
            cancelled,
        }
    }

    pub fn cancel(&self, path: &str) {
        if let Ok(root) = repository_root(path) {
            if let Ok(mut active) = self.0.lock() {
                if let Some(flag) = active.remove(&root) {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        }
    }
}

impl Drop for BlameGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.0.lock() {
            if active
                .get(&self.root)
                .is_some_and(|current| Arc::ptr_eq(current, &self.cancelled))
            {
                active.remove(&self.root);
            }
        }
    }
}

fn run_cancellable(root: &Path, args: &[&str], cancelled: &AtomicBool) -> Result<Vec<u8>, String> {
    let mut process = command(Some(root));
    process.args(args);
    let result = crate::process::output_with_cancellation(
        &mut process,
        Duration::from_secs(60),
        BLAME_STDOUT_LIMIT,
        BLAME_STDERR_LIMIT,
        cancelled,
    )
    .map_err(|error| match error.kind() {
        std::io::ErrorKind::Interrupted => "读取逐行作者已取消。".to_owned(),
        std::io::ErrorKind::NotFound => {
            "未找到 Git，请安装 Git 并确认 git 已加入 PATH。".to_owned()
        }
        std::io::ErrorKind::TimedOut => format!("{error}（等待上限 60 秒）"),
        std::io::ErrorKind::InvalidData => error.to_string(),
        _ => format!("无法启动 Git：{error}"),
    })?;
    if result.status.success() {
        Ok(result.stdout)
    } else {
        Err(error_text(&result))
    }
}

#[derive(Clone, Debug, Serialize)]
struct BlameCommit {
    hash: String,
    author: String,
    summary: String,
    time: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
struct BlameRange {
    start: usize,
    count: usize,
    commit: Option<BlameCommit>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SideBlame {
    source: String,
    ranges: Vec<BlameRange>,
    local_time: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct FileBlame {
    original: Option<SideBlame>,
    modified: Option<SideBlame>,
}

fn parse_ranges(output: &str) -> Result<Vec<BlameRange>, String> {
    let invalid = || "Git 返回了无法识别的逐行作者信息。".to_owned();
    let mut commits = HashMap::new();
    let mut ranges = Vec::new();
    let mut lines = output.lines();
    while let Some(header) = lines.next() {
        let mut fields = header.split_whitespace();
        let hash = fields.next().ok_or_else(invalid)?;
        let start = fields
            .nth(1)
            .and_then(|field| field.parse().ok())
            .ok_or_else(invalid)?;
        let count = fields
            .next()
            .and_then(|field| field.parse().ok())
            .ok_or_else(invalid)?;
        let mut author = None;
        let mut summary = "";
        let mut time = None;
        for line in lines.by_ref() {
            if line.starts_with("filename ") {
                break;
            }
            if let Some(value) = line.strip_prefix("author ") {
                author = Some(value);
            }
            if let Some(value) = line.strip_prefix("author-time ") {
                time = value.parse().ok();
            }
            if let Some(value) = line.strip_prefix("summary ") {
                summary = value;
            }
        }
        let commit = if hash.bytes().all(|byte| byte == b'0') {
            None
        } else {
            // Incremental output emits the metadata only for the first range of each commit.
            if let Some(author) = author {
                commits.insert(
                    hash,
                    BlameCommit {
                        hash: hash.to_owned(),
                        author: author.to_owned(),
                        summary: summary.to_owned(),
                        time,
                    },
                );
            }
            Some(commits.get(hash).ok_or_else(invalid)?.clone())
        };
        ranges.push(BlameRange {
            start,
            count,
            commit,
        });
    }
    ranges.sort_unstable_by_key(|range| range.start);
    Ok(ranges)
}

fn read_side(
    root: &Path,
    file: &str,
    source: Option<&[u8]>,
    head: Option<&str>,
    committed: bool,
    cancelled: &AtomicBool,
) -> Result<Option<SideBlame>, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("读取逐行作者已取消。".to_owned());
    }
    let Some(bytes) = source else { return Ok(None) };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Ok(None);
    };
    if bytes.is_empty() || bytes.contains(&0) {
        return Ok(None);
    }
    let source = text.replace("\r\n", "\n");
    let count = source.split_terminator('\n').count();
    let ranges = if let Some(head) = head {
        let mut args = vec![
            "blame",
            "--incremental",
            "--encoding=UTF-8",
            "--no-textconv",
        ];
        let contents;
        let mut temporary;
        if committed {
            args.push(head);
        } else {
            temporary = tempfile::NamedTempFile::new().map_err(|error| error.to_string())?;
            temporary
                .write_all(bytes)
                .map_err(|error| error.to_string())?;
            contents = temporary.path().to_string_lossy();
            // Older Git versions only support --contents with the implicit HEAD.
            args.extend(["--contents", &contents]);
        }
        args.extend(["--", file]);
        let ranges = parse_ranges(&String::from_utf8_lossy(&run_cancellable(
            root, &args, cancelled,
        )?))?;
        let mut next_line = 1usize;
        for range in &ranges {
            if range.start != next_line || range.count == 0 {
                return Ok(None);
            }
            next_line = next_line.saturating_add(range.count);
        }
        if next_line != count + 1 {
            return Ok(None);
        }
        ranges
    } else {
        vec![BlameRange {
            start: 1,
            count,
            commit: None,
        }]
    };
    Ok(Some(SideBlame {
        source,
        ranges,
        local_time: None,
    }))
}

fn modified_time(path: &Path) -> Option<i64> {
    let modified = fs::symlink_metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs()
        .try_into()
        .ok()
}

fn index_time(root: &Path, file: &str) -> Option<i64> {
    // Prefer the cached stat for this path. Some index entries have no stat data.
    if let Ok(output) = run(root, &["ls-files", "--debug", "--", file]) {
        let time = String::from_utf8_lossy(&output).lines().find_map(|line| {
            let (seconds, _) = line.strip_prefix("  mtime: ")?.split_once(':')?;
            seconds.parse::<i64>().ok().filter(|seconds| *seconds > 0)
        });
        if time.is_some() {
            return time;
        }
    }
    let index = optional_text(root, &["rev-parse", "--git-path", "index"]).ok()??;
    modified_time(&root.join(index))
}

fn set_local_time(side: &mut Option<SideBlame>, time: impl FnOnce() -> Option<i64>) {
    if let Some(side) = side
        .as_mut()
        .filter(|side| side.ranges.iter().any(|range| range.commit.is_none()))
    {
        side.local_time = time();
    }
}

fn read_file_blame_in_root(
    root: &Path,
    file: &str,
    staged: bool,
    cancelled: &AtomicBool,
) -> Result<FileBlame, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("读取逐行作者已取消。".to_owned());
    }
    let head = optional_text(root, &["rev-parse", "--verify", "HEAD"])?;
    let versions = read_file_versions(root, file, staged)?;
    let history = if let Some(head) = head.as_deref() {
        let object = format!("{head}:{}", versions.history_path);
        match optional_text(root, &["cat-file", "-t", &object])?.as_deref() {
            Some("blob") => Some(head),
            Some(_) => {
                return Ok(FileBlame {
                    original: None,
                    modified: None,
                })
            }
            None => None,
        }
    } else {
        None
    };
    let (mut original, mut modified) = if versions.original == versions.modified {
        let original = read_side(
            root,
            &versions.history_path,
            versions.original.as_deref(),
            history,
            staged,
            cancelled,
        )?;
        let modified = original.clone();
        (original, modified)
    } else {
        std::thread::scope(|scope| {
            let original_task = scope.spawn(|| {
                read_side(
                    root,
                    &versions.history_path,
                    versions.original.as_deref(),
                    history,
                    staged,
                    cancelled,
                )
            });
            let modified = read_side(
                root,
                &versions.history_path,
                versions.modified.as_deref(),
                history,
                false,
                cancelled,
            );
            let original = original_task
                .join()
                .map_err(|_| "读取逐行作者线程异常。".to_owned())?;
            Ok::<_, String>((original?, modified?))
        })?
    };
    if cancelled.load(Ordering::Relaxed) {
        return Err("读取逐行作者已取消。".to_owned());
    }
    if staged {
        set_local_time(&mut modified, || index_time(root, file));
    } else {
        set_local_time(&mut original, || index_time(root, &versions.original_path));
        set_local_time(&mut modified, || modified_time(&root.join(file)));
    }
    if optional_text(root, &["rev-parse", "--verify", "HEAD"])? != head {
        return Err("读取逐行作者期间 HEAD 已变化。".to_owned());
    }
    Ok(FileBlame { original, modified })
}

pub fn read_file_blame_managed(
    state: &BlameState,
    path: &str,
    file: &str,
    staged: bool,
) -> Result<FileBlame, String> {
    validate_files(&[file.to_owned()])?;
    // Blame can walk a long history. Keep it outside the lock used by refreshes and mutations.
    let root = repository_root(path)?;
    let guard = state.start(root.clone());
    read_file_blame_in_root(&root, file, staged, &guard.cancelled)
}

#[cfg(test)]
pub fn read_file_blame(path: &str, file: &str, staged: bool) -> Result<FileBlame, String> {
    let state = BlameState::default();
    read_file_blame_managed(&state, path, file, staged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn authors(side: Option<SideBlame>) -> Vec<Option<String>> {
        side.unwrap()
            .ranges
            .into_iter()
            .flat_map(|range| {
                let author = range.commit.map(|commit| commit.author);
                std::iter::repeat_n(author, range.count)
            })
            .collect()
    }

    #[test]
    fn attributes_both_versions_through_local_edits_and_renames() {
        let directory = crate::git::tests::repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let file = "[中文] notes.txt";
        let first = Some("陈晨".to_owned());
        let second = Some("Bobby".to_owned());

        fs::write(root.join(file), "first\nsecond\nthird\n").unwrap();
        let unborn = read_file_blame(path, file, false).unwrap();
        assert!(unborn.original.is_none());
        assert_eq!(
            unborn.modified.as_ref().unwrap().local_time,
            modified_time(&root.join(file))
        );
        assert_eq!(authors(unborn.modified), [None, None, None]);
        run(root, &["add", "--", file]).unwrap();
        run(root, &["-c", "user.name=陈晨", "commit", "-m", "initial"]).unwrap();
        fs::write(root.join(file), "first\ncommitted\nthird\n").unwrap();
        run(root, &["add", "--", file]).unwrap();
        run(
            root,
            &["-c", "user.name=Bobby", "commit", "-m", "edit middle"],
        )
        .unwrap();

        let renamed = "renamed notes.txt";
        run(root, &["mv", "--", file, renamed]).unwrap();
        fs::write(
            root.join(renamed),
            "first\ncommitted\nthird\nstaged addition\n",
        )
        .unwrap();
        let staged_time = modified_time(&root.join(renamed));
        run(root, &["add", "--", renamed]).unwrap();
        fs::write(
            root.join(renamed),
            "local insertion\nfirst\nworking edit\nthird\nstaged addition\n",
        )
        .unwrap();

        let staged = read_file_blame(path, renamed, true).unwrap();
        let first_commit = staged.original.as_ref().unwrap().ranges[0]
            .commit
            .as_ref()
            .unwrap();
        let recorded_time = super::super::run_text(root, &["show", "-s", "--format=%at", "HEAD^"])
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(first_commit.time, Some(recorded_time));
        assert_eq!(staged.modified.as_ref().unwrap().local_time, staged_time);
        assert_eq!(
            authors(staged.original),
            [first.clone(), second.clone(), first.clone()]
        );
        let index_authors = [first.clone(), second, first.clone(), None];
        assert_eq!(authors(staged.modified), index_authors);
        let working = read_file_blame(path, renamed, false).unwrap();
        assert_eq!(working.original.as_ref().unwrap().local_time, staged_time);
        assert_eq!(
            working.modified.as_ref().unwrap().local_time,
            modified_time(&root.join(renamed))
        );
        assert_eq!(authors(working.original), index_authors);
        assert_eq!(
            authors(working.modified),
            [None, first.clone(), None, first, None]
        );
    }

    #[test]
    fn newer_blame_request_cancels_previous_guard() {
        let state = BlameState::default();
        let root = PathBuf::from("X:/repo");
        let first = state.start(root.clone());
        assert!(!first.cancelled.load(Ordering::Relaxed));
        let second = state.start(root);
        assert!(first.cancelled.load(Ordering::Relaxed));
        assert!(!second.cancelled.load(Ordering::Relaxed));
    }
}
