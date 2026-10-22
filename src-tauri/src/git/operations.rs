use super::{output, snapshot, with_repository, PullResult, RepositorySnapshot};
use serde::Deserialize;
use std::{fs, io::Read, path::Path};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationAction {
    Continue,
    Abort,
    Skip,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRequest {
    pub operation: String,
    pub token: String,
    pub revision: String,
    pub head: Option<String>,
    pub branch: String,
    pub action: OperationAction,
}

pub(super) fn token(git_dir: &Path, kind: &str) -> String {
    let mut stamps = Vec::new();
    for name in [
        "MERGE_HEAD",
        "MERGE_MSG",
        "ORIG_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "sequencer/head",
        "sequencer/todo",
        "sequencer/abort-safety",
        "rebase-merge/head-name",
        "rebase-merge/orig-head",
        "rebase-merge/onto",
        "rebase-merge/stopped-sha",
        "rebase-merge/git-rebase-todo",
        "rebase-merge/done",
        "rebase-apply/head-name",
        "rebase-apply/orig-head",
        "rebase-apply/onto",
        "rebase-apply/next",
        "rebase-apply/last",
    ] {
        let path = git_dir.join(name);
        let mut bytes = Vec::new();
        if let Ok(file) = fs::File::open(&path) {
            let _ = file.take(65536).read_to_end(&mut bytes);
        }
        let stamp = fs::metadata(path)
            .ok()
            .map(|meta| (meta.len(), meta.modified().ok()));
        stamps.push((name, stamp, bytes));
    }
    super::revision::hash(&(kind, stamps))
}

pub(super) fn outcome(root: &Path, result: std::process::Output) -> Result<PullResult, String> {
    let state = snapshot(root)?;
    Ok(PullResult {
        conflicted: state.files.iter().any(|file| file.conflicted),
        error: (!result.status.success()).then(|| super::error_text(&result)),
        snapshot: state,
    })
}

pub(super) fn ensure_idle(state: &RepositorySnapshot) -> Result<(), String> {
    if state.operation.is_some() || state.files.iter().any(|file| file.conflicted) {
        return Err("请先完成当前 Git 操作和冲突处理。".into());
    }
    Ok(())
}

pub fn act_on_operation(path: &str, request: OperationRequest) -> Result<PullResult, String> {
    with_repository(path, |root| {
        let state = snapshot(root)?;
        if state.operation.as_deref() != Some(&request.operation)
            || state.operation_token.as_deref() != Some(&request.token)
            || state.revision != request.revision
            || state.head != request.head
            || state.branch != request.branch
        {
            return Err("仓库或当前操作已变化，请刷新后重新操作。".into());
        }
        if !matches!(
            request.operation.as_str(),
            "merge" | "rebase" | "cherry-pick" | "revert"
        ) {
            return Err("当前操作请在外部 Git 工具中完成。".into());
        }
        if matches!(request.action, OperationAction::Continue)
            && state.files.iter().any(|file| file.conflicted)
        {
            return Err("还有未解决的冲突，请先解决并暂存。".into());
        }
        if request.operation == "merge" && matches!(request.action, OperationAction::Skip) {
            return Err("合并操作不支持跳过，请完成或取消合并。".into());
        }
        let flag = match request.action {
            OperationAction::Continue => "--continue",
            OperationAction::Abort => "--abort",
            OperationAction::Skip => "--skip",
        };
        // Use the prepared commit message without launching an interactive editor.
        let result = output(
            Some(root),
            &["-c", "core.editor=true", &request.operation, flag],
        )?;
        outcome(root, result)
    })
}
