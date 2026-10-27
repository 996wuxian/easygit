use super::{
    command, error_text,
    files::{safe_path, MAX_BYTES},
};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const PAGE_SIZE: usize = 50;
const RESULT_LIMIT: usize = 1000;
const PER_FILE_LIMIT: usize = 20;
const LIST_LIMIT: usize = 32 * 1024 * 1024;
const SESSION_LIMIT: usize = 16;
const CANCELLED: &str = "搜索已取消。";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileSearchMode {
    Name,
    Content,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchRequest {
    pub path: String,
    pub client: String,
    pub generation: u32,
    pub query: String,
    pub mode: FileSearchMode,
    pub show_ignored: bool,
    pub continuation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchMatch {
    pub path: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub length: Option<usize>,
    pub preview: String,
    pub match_start: usize,
    pub match_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchBatch {
    pub results: Vec<FileSearchMatch>,
    pub complete: bool,
    pub truncated: bool,
    pub scanned_files: usize,
    pub total_files: usize,
    pub skipped_files: usize,
    pub limited_files: usize,
}

struct SearchSession {
    generation: u32,
    created: Instant,
    cancelled: AtomicBool,
    cursor: Mutex<Option<SearchCursor>>,
}

#[derive(Clone, Default)]
pub struct FileSearchState {
    sessions: Arc<Mutex<HashMap<String, Arc<SearchSession>>>>,
}

impl FileSearchState {
    fn session(&self, request: &FileSearchRequest) -> Result<Arc<SearchSession>, String> {
        if request.client.is_empty()
            || request.client.len() > 80
            || !request
                .client
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Err("搜索会话无效，请重新打开项目文件面板。".into());
        }
        let mut sessions = self.sessions.lock().map_err(|_| "搜索服务暂时不可用。")?;
        if request.continuation {
            let session = sessions
                .get(&request.client)
                .filter(|session| session.generation == request.generation)
                .ok_or(CANCELLED)?;
            check_cancelled(&session.cancelled)?;
            return Ok(session.clone());
        }
        if let Some(previous) = sessions.get(&request.client) {
            if previous.generation >= request.generation {
                return Err(CANCELLED.into());
            }
            previous.cancelled.store(true, Ordering::Relaxed);
        }
        prune(&mut sessions, &request.client);
        let session = Arc::new(SearchSession {
            generation: request.generation,
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            cursor: Mutex::new(None),
        });
        sessions.insert(request.client.clone(), session.clone());
        Ok(session)
    }

    pub fn cancel(&self, client: &str, generation: u32) -> Result<(), String> {
        if client.is_empty()
            || client.len() > 80
            || !client
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Err("搜索会话无效。".into());
        }
        let mut sessions = self.sessions.lock().map_err(|_| "搜索服务暂时不可用。")?;
        if sessions
            .get(client)
            .is_some_and(|session| session.generation > generation)
        {
            return Ok(());
        }
        if let Some(session) = sessions.get(client) {
            session.cancelled.store(true, Ordering::Relaxed);
        }
        // Keep a bounded tombstone: a late start must not revive a cancelled task.
        prune(&mut sessions, client);
        sessions.insert(
            client.into(),
            Arc::new(SearchSession {
                generation,
                created: Instant::now(),
                cancelled: AtomicBool::new(true),
                cursor: Mutex::new(None),
            }),
        );
        Ok(())
    }
}

fn prune(sessions: &mut HashMap<String, Arc<SearchSession>>, client: &str) {
    sessions.retain(|key, session| {
        let keep = key == client || session.created.elapsed() < Duration::from_secs(120);
        if !keep {
            session.cancelled.store(true, Ordering::Relaxed);
        }
        keep
    });
    if !sessions.contains_key(client) && sessions.len() >= SESSION_LIMIT {
        if let Some(oldest) = sessions
            .iter()
            .min_by_key(|(_, session)| session.created)
            .map(|(key, _)| key.clone())
        {
            if let Some(session) = sessions.remove(&oldest) {
                session.cancelled.store(true, Ordering::Relaxed);
            }
        }
    }
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}

struct SearchCursor {
    request: FileSearchRequest,
    root: PathBuf,
    pattern: Regex,
    files: Vec<String>,
    next_file: usize,
    found: usize,
    skipped: usize,
    limited: usize,
    pending: VecDeque<FileSearchMatch>,
}

impl SearchCursor {
    fn new(request: FileSearchRequest, cancelled: &AtomicBool) -> Result<Self, String> {
        check_cancelled(cancelled)?;
        if request.query.trim().is_empty() {
            return Err("请输入搜索内容。".into());
        }
        if request.query.chars().count() > 256 {
            return Err("搜索内容不能超过 256 个字符。".into());
        }
        let pattern = RegexBuilder::new(&regex::escape(&request.query))
            .case_insensitive(true)
            .size_limit(1024 * 1024)
            .build()
            .map_err(|_| "搜索内容无效。")?;
        let input = Path::new(&request.path);
        if !input.is_dir() {
            return Err("仓库路径不存在，或不是一个文件夹。".into());
        }
        let mut resolve = command(Some(input));
        resolve.args(["rev-parse", "--show-toplevel"]);
        let output = crate::process::output_with_cancellation(
            &mut resolve,
            Duration::from_secs(30),
            64 * 1024,
            1024 * 1024,
            cancelled,
        )
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::Interrupted {
                CANCELLED.into()
            } else {
                format!("无法打开 Git 仓库：{error}")
            }
        })?;
        if !output.status.success() {
            return Err(error_text(&output));
        }
        let root = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
            .canonicalize()
            .map_err(|error| format!("无法访问仓库路径：{error}"))?;
        check_cancelled(cancelled)?;
        let mut git = command(Some(&root));
        git.args(["ls-files", "--cached", "--others", "-z"]);
        if !request.show_ignored {
            git.arg("--exclude-standard");
        }
        let output = crate::process::output_with_cancellation(
            &mut git,
            Duration::from_secs(30),
            LIST_LIMIT,
            1024 * 1024,
            cancelled,
        )
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::Interrupted {
                CANCELLED.into()
            } else {
                format!("无法读取项目文件清单：{error}")
            }
        })?;
        if !output.status.success() {
            return Err(error_text(&output));
        }
        let mut unique = HashSet::new();
        let mut files = Vec::new();
        let mut skipped = 0;
        for part in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
        {
            check_cancelled(cancelled)?;
            let Ok(path) = std::str::from_utf8(part) else {
                skipped += 1;
                continue;
            };
            if !unique.insert(path) {
                continue;
            }
            if request.mode == FileSearchMode::Content
                && !request.show_ignored
                && dependency_path(path)
            {
                skipped += 1;
                continue;
            }
            if files.len() == 500_000 {
                return Err("项目文件超过 50 万，请关闭“显示忽略文件”后再搜索。".into());
            }
            files.push(path.to_owned());
        }
        Ok(Self {
            request,
            root,
            pattern,
            files,
            next_file: 0,
            found: 0,
            skipped,
            limited: 0,
            pending: VecDeque::new(),
        })
    }

    fn next_batch(&mut self, cancelled: &AtomicBool) -> Result<FileSearchBatch, String> {
        let started = Instant::now();
        let mut results = Vec::new();
        loop {
            check_cancelled(cancelled)?;
            while results.len() < PAGE_SIZE && self.found < RESULT_LIMIT {
                let Some(result) = self.pending.pop_front() else {
                    break;
                };
                self.found += 1;
                results.push(result);
            }
            if results.len() == PAGE_SIZE
                || self.found == RESULT_LIMIT
                || self.next_file == self.files.len()
                || started.elapsed() >= Duration::from_millis(40)
            {
                break;
            }
            if self.request.mode == FileSearchMode::Content {
                self.scan_content_batch(
                    cancelled,
                    started,
                    (PAGE_SIZE - results.len()).min(RESULT_LIMIT - self.found),
                )?;
            } else {
                let outcome = self.scan_file(&self.files[self.next_file], cancelled)?;
                self.next_file += 1;
                self.accept(outcome);
            }
        }
        let exhausted = self.next_file == self.files.len() && self.pending.is_empty();
        let truncated = self.found == RESULT_LIMIT && !exhausted;
        Ok(FileSearchBatch {
            results,
            complete: exhausted || truncated,
            truncated,
            scanned_files: self.next_file,
            total_files: self.files.len(),
            skipped_files: self.skipped,
            limited_files: self.limited,
        })
    }

    fn accept(&mut self, outcome: ScanOutcome) {
        self.skipped += usize::from(outcome.skipped);
        self.limited += usize::from(outcome.limited);
        self.pending.extend(outcome.matches);
    }

    fn scan_content_batch(
        &mut self,
        cancelled: &AtomicBool,
        started: Instant,
        needed: usize,
    ) -> Result<(), String> {
        // Limit IO concurrency and keep a deterministic result order. Every
        // worker retains the same per-file path, size and cancellation checks.
        let workers = std::thread::available_parallelism()
            .map_or(2, usize::from)
            .min(4)
            .min(self.files.len() - self.next_file);
        let next = std::sync::atomic::AtomicUsize::new(self.next_file);
        let produced = std::sync::atomic::AtomicUsize::new(0);
        let mut outcomes = std::thread::scope(|scope| {
            let mut tasks = Vec::new();
            for _ in 0..workers {
                let cursor = &*self;
                let next = &next;
                let produced = &produced;
                tasks.push(scope.spawn(move || {
                    let mut outcomes = Vec::new();
                    while started.elapsed() < Duration::from_millis(40)
                        && produced.load(Ordering::Relaxed) < needed
                    {
                        check_cancelled(cancelled)?;
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        if index >= cursor.files.len() {
                            break;
                        }
                        let outcome = cursor.scan_file(&cursor.files[index], cancelled)?;
                        produced.fetch_add(outcome.matches.len(), Ordering::Relaxed);
                        outcomes.push((index, outcome));
                    }
                    Ok::<_, String>(outcomes)
                }));
            }
            let mut outcomes = Vec::new();
            for task in tasks {
                outcomes.extend(task.join().map_err(|_| "搜索工作线程异常，请重试。")??);
            }
            Ok::<_, String>(outcomes)
        })?;
        self.next_file = next.load(Ordering::Relaxed).min(self.files.len());
        outcomes.sort_unstable_by_key(|(index, _)| *index);
        for (_, outcome) in outcomes {
            self.accept(outcome);
        }
        Ok(())
    }

    fn scan_file(&self, file: &str, cancelled: &AtomicBool) -> Result<ScanOutcome, String> {
        if self.request.mode == FileSearchMode::Name && !self.pattern.is_match(file) {
            return Ok(ScanOutcome::default());
        }
        let Ok(target) = safe_path(&self.root, file, false) else {
            return Ok(ScanOutcome::skipped());
        };
        let Ok(metadata) = fs::metadata(&target) else {
            return Ok(ScanOutcome::skipped());
        };
        if !metadata.is_file() {
            return Ok(ScanOutcome::skipped());
        }
        if self.request.mode == FileSearchMode::Name {
            let found = self.pattern.find(file).expect("path already matched");
            let (preview, match_start, match_length) = preview(file, found.start(), found.end());
            return Ok(ScanOutcome {
                matches: vec![FileSearchMatch {
                    path: file.into(),
                    line: None,
                    column: None,
                    length: None,
                    preview,
                    match_start,
                    match_length,
                }],
                ..ScanOutcome::default()
            });
        }
        if metadata.len() > MAX_BYTES as u64 {
            return Ok(ScanOutcome::skipped());
        }
        let Some(bytes) = read_content(&target, cancelled)? else {
            return Ok(ScanOutcome::skipped());
        };
        let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
        let Ok(text) = std::str::from_utf8(bytes) else {
            return Ok(ScanOutcome::skipped());
        };
        if text.contains('\0') {
            return Ok(ScanOutcome::skipped());
        }
        let mut outcome = ScanOutcome::default();
        for (line_index, line) in text.lines().enumerate() {
            check_cancelled(cancelled)?;
            for found in self.pattern.find_iter(line) {
                if outcome.matches.len() == PER_FILE_LIMIT {
                    outcome.limited = true;
                    return Ok(outcome);
                }
                let (preview, match_start, match_length) =
                    preview(line, found.start(), found.end());
                outcome.matches.push(FileSearchMatch {
                    path: file.into(),
                    line: Some(line_index + 1),
                    column: Some(line[..found.start()].encode_utf16().count() + 1),
                    length: Some(line[found.start()..found.end()].encode_utf16().count()),
                    preview,
                    match_start,
                    match_length,
                });
            }
        }
        Ok(outcome)
    }
}

#[derive(Default)]
struct ScanOutcome {
    matches: Vec<FileSearchMatch>,
    skipped: bool,
    limited: bool,
}
impl ScanOutcome {
    fn skipped() -> Self {
        Self {
            skipped: true,
            ..Self::default()
        }
    }
}
fn dependency_path(path: &str) -> bool {
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_some()
            && matches!(
                part,
                "node_modules"
                    | "vendor"
                    | "dist"
                    | "build"
                    | "target"
                    | ".next"
                    | ".nuxt"
                    | ".output"
                    | "coverage"
            )
        {
            return true;
        }
    }
    false
}

fn read_content(path: &std::path::Path, cancelled: &AtomicBool) -> Result<Option<Vec<u8>>, String> {
    let Ok(mut file) = fs::File::open(path) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    let mut chunk = [0; 16 * 1024];
    loop {
        check_cancelled(cancelled)?;
        let Ok(count) = file.read(&mut chunk) else {
            return Ok(None);
        };
        if count == 0 {
            return Ok(Some(bytes));
        }
        if bytes.len() + count > MAX_BYTES {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
}

// UTF-8 boundaries for the snippet; UTF-16 offsets for React slicing/CodeMirror.
fn preview(line: &str, from: usize, to: usize) -> (String, usize, usize) {
    let start = line[..from]
        .char_indices()
        .rev()
        .nth(48)
        .map_or(0, |(index, _)| index);
    let end = line[to..]
        .char_indices()
        .nth(96)
        .map_or(line.len(), |(index, _)| to + index);
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < line.len() { "…" } else { "" };
    let offset = prefix.encode_utf16().count() + line[start..from].encode_utf16().count();
    (
        format!("{prefix}{}{suffix}", &line[start..end]),
        offset,
        line[from..to].encode_utf16().count(),
    )
}

pub fn search_project_files(
    state: &FileSearchState,
    request: FileSearchRequest,
) -> Result<FileSearchBatch, String> {
    let session = state.session(&request)?;
    let mut cursor = session
        .cursor
        .lock()
        .map_err(|_| "搜索任务不可用，请重试。")?;
    check_cancelled(&session.cancelled)?;
    if request.continuation {
        let current = cursor.as_ref().ok_or("搜索已结束或过期，请重新搜索。")?;
        let mut original = current.request.clone();
        original.continuation = true;
        if original != request {
            return Err("搜索条件已变化，请重新搜索。".into());
        }
    } else {
        *cursor = Some(SearchCursor::new(request, &session.cancelled)?);
    }
    let result = cursor
        .as_mut()
        .ok_or("搜索任务不存在。")?
        .next_batch(&session.cancelled);
    if session.cancelled.load(Ordering::Relaxed) {
        *cursor = None;
        return Err(CANCELLED.into());
    }
    if result.as_ref().is_ok_and(|batch| batch.complete) || result.is_err() {
        *cursor = None;
    }
    result
}

#[cfg(test)]
#[path = "file_search_tests.rs"]
mod tests;
