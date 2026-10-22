use super::merge::{branch_head, branch_reference};
use super::{optional_text, output, run, run_text};
use std::path::Path;

pub(super) struct MergeTarget {
    pub local: String,
    pub local_head: Option<String>,
    pub head: String,
    pub merge_head: String,
    pub remote_ref: Option<String>,
    pub needs_sync: bool,
    pub bind_upstream: bool,
}

fn is_ancestor(root: &Path, ancestor: &str, descendant: &str) -> Result<bool, String> {
    let result = output(
        Some(root),
        &["merge-base", "--is-ancestor", ancestor, descendant],
    )?;
    match result.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(super::error_text(&result)),
    }
}

pub(super) fn resolve_target(
    root: &Path,
    target: &str,
    remote: bool,
) -> Result<MergeTarget, String> {
    if !remote {
        let head = branch_head(root, target, false)?;
        return Ok(MergeTarget {
            local: target.to_owned(),
            local_head: Some(head.clone()),
            merge_head: head.clone(),
            head,
            remote_ref: None,
            needs_sync: false,
            bind_upstream: false,
        });
    }
    let mut destination = resolve_remote_branch(root, target)?;
    if let Some(local_head) = &destination.local_head {
        if is_ancestor(root, &destination.head, local_head)? {
            destination.merge_head = local_head.clone();
        } else if is_ancestor(root, local_head, &destination.head)? {
            destination.needs_sync = true;
        } else {
            return Err(format!(
                "本地分支“{}”与“{target}”已分叉。请先同步并处理冲突，或直接以本地“{}”为目标合并。",
                destination.local, destination.local
            ));
        }
    }
    Ok(destination)
}

// Switching reuses this resolution without the merge target's synchronization.
pub(super) fn resolve_remote_branch(root: &Path, target: &str) -> Result<MergeTarget, String> {
    let head = branch_head(root, target, true)?;
    let remote_ref = branch_reference(root, target, true)?;
    if optional_text(root, &["symbolic-ref", "--quiet", &remote_ref])?.is_some() {
        return Err("请选择实际的远程分支，不能使用远程 HEAD 别名。".to_owned());
    }
    let remotes = run_text(root, &["remote"])?;
    let remote_name = remotes
        .lines()
        .filter(|name| target.starts_with(&format!("{name}/")))
        .max_by_key(|name| name.len())
        .ok_or_else(|| format!("找不到分支“{target}”所属的远程仓库。"))?;
    let default_local = &target[remote_name.len() + 1..];
    branch_reference(root, default_local, false)?;

    let refs = run_text(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(upstream)",
            "refs/heads",
        ],
    )?;
    let branches: Vec<(&str, &str)> = refs
        .lines()
        .filter_map(|line| {
            let (name, upstream) = line.split_once('\0')?;
            Some((name.strip_prefix("refs/heads/")?, upstream))
        })
        .collect();
    let tracked = branches
        .iter()
        .filter(|(_, upstream)| *upstream == remote_ref)
        .min_by_key(|(name, _)| (*name != default_local, *name));
    let local_branch = tracked.or_else(|| branches.iter().find(|(name, _)| *name == default_local));
    let (local, local_head, bind_upstream) = if let Some((name, upstream)) = local_branch {
        if !upstream.is_empty() && *upstream != remote_ref {
            return Err(format!(
                "本地分支“{name}”已跟踪其他远程分支。请直接选择本地分支作为目标，或先调整其上游。"
            ));
        }
        (
            (*name).to_owned(),
            Some(branch_head(root, name, false)?),
            upstream.is_empty(),
        )
    } else {
        (default_local.to_owned(), None, true)
    };

    Ok(MergeTarget {
        local,
        local_head,
        merge_head: head.clone(),
        head,
        remote_ref: Some(remote_ref),
        needs_sync: false,
        bind_upstream,
    })
}

pub(super) fn prepare_target(
    root: &Path,
    current: &str,
    target: &MergeTarget,
) -> Result<(), String> {
    if target.local_head.is_none() {
        run(
            root,
            &["switch", "--no-track", "-c", &target.local, &target.head],
        )?;
    } else if current != target.local {
        run(root, &["switch", "--", &target.local])?;
    }
    if let Some(reference) = &target.remote_ref {
        if target.bind_upstream {
            run(
                root,
                &["branch", "--set-upstream-to", reference, &target.local],
            )?;
        }
        if target.needs_sync {
            run(root, &["merge", "--ff-only", "--no-edit", &target.head])?;
        }
    }
    Ok(())
}
