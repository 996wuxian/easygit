use super::{operations, output, run, snapshot, with_repository, PullResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub hash: String,
    pub selector: String,
    pub message: String,
    pub date: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StashAction {
    Apply,
    Pop,
    Drop,
}

fn entries(root: &Path) -> Result<Vec<StashEntry>, String> {
    let bytes = run(
        root,
        &["stash", "list", "-z", "--format=%H%x00%gd%x00%gs%x00%aI"],
    )?;
    Ok(bytes
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>()
        .as_chunks::<4>()
        .0
        .iter()
        .map(|fields| {
            let text = |i| String::from_utf8_lossy(fields[i]).into_owned();
            StashEntry {
                hash: text(0),
                selector: text(1),
                message: text(2),
                date: text(3),
            }
        })
        .collect())
}

fn verify(root: &Path, selector: &str, hash: &str) -> Result<(), String> {
    if entries(root)?
        .iter()
        .any(|entry| entry.selector == selector && entry.hash == hash)
    {
        Ok(())
    } else {
        Err("stash 记录已变化，请刷新列表后重新选择。".into())
    }
}

pub fn list_stashes(path: &str) -> Result<Vec<StashEntry>, String> {
    with_repository(path, entries)
}

pub fn stash_diff(path: &str, selector: &str, hash: &str) -> Result<String, String> {
    with_repository(path, |root| {
        verify(root, selector, hash)?;
        super::inspect::patch(
            root,
            &[
                "stash",
                "show",
                "--patch",
                "--include-untracked",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                hash,
                "--",
            ],
        )
    })
}

pub fn save_stash(
    path: &str,
    message: &str,
    include_untracked: bool,
) -> Result<PullResult, String> {
    if message.len() > 2048 {
        return Err("stash 说明过长，请控制在 2048 字节以内。".into());
    }
    with_repository(path, |root| {
        let state = snapshot(root)?;
        operations::ensure_idle(&state)?;
        if state.head.is_none() {
            return Err("请先创建第一次提交，再保存 stash。".into());
        }
        if !state
            .files
            .iter()
            .any(|file| !file.untracked || include_untracked)
        {
            return Err("没有可保存的更改；新文件需要勾选包含未跟踪文件。".into());
        }
        // stash internally builds pathspecs for cleaning saved untracked files.
        // Its internal magic must work; this command accepts no user pathspecs.
        let mut args = vec!["--no-literal-pathspecs", "stash", "push"];
        if include_untracked {
            args.push("--include-untracked");
        }
        if !message.trim().is_empty() {
            args.extend(["--message", message.trim()]);
        }
        args.push("--");
        operations::outcome(root, output(Some(root), &args)?)
    })
}

pub fn act_on_stash(
    path: &str,
    selector: &str,
    hash: &str,
    action: StashAction,
) -> Result<PullResult, String> {
    with_repository(path, |root| {
        operations::ensure_idle(&snapshot(root)?)?;
        verify(root, selector, hash)?;
        if matches!(action, StashAction::Drop) {
            return operations::outcome(root, output(Some(root), &["stash", "drop", selector])?);
        }
        // Apply an immutable object id; a conflicting pop must retain its stash.
        let applied = output(Some(root), &["stash", "apply", "--index", hash])?;
        if !applied.status.success() || matches!(action, StashAction::Apply) {
            return operations::outcome(root, applied);
        }
        if let Err(error) = verify(root, selector, hash) {
            return Ok(PullResult {
                snapshot: snapshot(root)?,
                conflicted: false,
                error: Some(format!(
                    "更改已恢复，但记录列表发生变化，stash 已保留。{error}"
                )),
            });
        }
        operations::outcome(root, output(Some(root), &["stash", "drop", selector])?)
    })
}
