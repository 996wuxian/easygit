use super::{run, GitCommit, GitCommitRef, GitUpstream};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path};

#[derive(Deserialize)]
pub struct HistoryReference {
    pub name: String,
    pub remote: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub reference: Option<HistoryReference>,
    pub query: String,
    pub offset: u32,
    pub expected_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub commits: Vec<GitCommit>,
    pub next_offset: Option<u32>,
    pub key: String,
}

fn excluded(root: &Path, tip: &str, other: Option<&str>) -> Result<HashSet<String>, String> {
    if other == Some(tip) {
        return Ok(HashSet::new());
    }
    let mut args = vec!["rev-list", tip];
    if let Some(other) = other {
        args.extend(["--not", other]);
    }
    Ok(super::run_text(root, &args)?
        .lines()
        .map(str::to_owned)
        .collect())
}

pub fn history_page(path: &str, query: HistoryQuery) -> Result<HistoryPage, String> {
    if query.query.len() > 256 || query.offset > 1_000_000 {
        return Err("历史查询范围或关键词过长。".into());
    }
    super::with_repository(path, |root| {
        let head = super::optional_text(root, &["rev-parse", "--verify", "HEAD"])?;
        let branch = super::optional_text(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?
            .unwrap_or_else(|| "HEAD".into());
        let upstream_name = super::optional_text(
            root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )?;
        let upstream = match &upstream_name {
            Some(_) => {
                super::optional_text(root, &["rev-parse", "--verify", "@{upstream}^{commit}"])?
            }
            None => None,
        };
        let selected = query
            .reference
            .as_ref()
            .map(|reference| super::merge::branch_head(root, &reference.name, reference.remote))
            .transpose()?;
        let scope = selected.as_ref().or(head.as_ref());
        let key = super::revision::hash(&(
            &head,
            &branch,
            &upstream_name,
            &upstream,
            &selected,
            query.query.trim(),
        ));
        if query
            .expected_key
            .as_ref()
            .is_some_and(|expected| *expected != key)
        {
            return Err("分支历史已变化，请刷新历史后再翻页。".into());
        }
        let Some(scope) = scope else {
            return Ok(HistoryPage {
                commits: Vec::new(),
                next_offset: None,
                key,
            });
        };
        let skip = format!("--skip={}", query.offset);
        let mut args = vec![
            "log",
            "--topo-order",
            "-26",
            &skip,
            "-z",
            "--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P",
            scope,
        ];
        if selected.is_none() {
            if let Some(upstream) = &upstream {
                args.push(upstream);
            }
        }
        if !query.query.trim().is_empty() {
            args.extend([
                "--fixed-strings",
                "--regexp-ignore-case",
                "--grep",
                query.query.trim(),
            ]);
        }
        args.push("--");
        let bytes = run(root, &args)?;
        let fields: Vec<_> = bytes.split(|byte| *byte == 0).collect();
        let mut commits: Vec<GitCommit> = fields
            .chunks_exact(6)
            .map(|fields| {
                let text = |i| String::from_utf8_lossy(fields[i]).into_owned();
                GitCommit {
                    hash: text(0),
                    short_hash: text(1),
                    subject: text(2),
                    author: text(3),
                    date: text(4),
                    parents: text(5).split_whitespace().map(str::to_owned).collect(),
                    refs: Vec::new(),
                    local: false,
                    remote: false,
                }
            })
            .collect();
        let next_offset = (commits.len() > 25).then_some(query.offset + 25);
        commits.truncate(25);
        // User-driven pages/searches batch reachability by branch, never spawn
        // ancestry queries for each row. The background snapshot stays at ten.
        if !commits.is_empty() {
            if selected.is_some() {
                let not_local = excluded(root, scope, head.as_deref())?;
                let not_remote = match upstream.as_deref() {
                    Some(remote) => excluded(root, scope, Some(remote))?,
                    None => HashSet::new(),
                };
                for commit in &mut commits {
                    commit.local = head.is_some() && !not_local.contains(&commit.hash);
                    commit.remote = upstream.is_some() && !not_remote.contains(&commit.hash);
                }
            } else if let Some(remote) = upstream
                .as_ref()
                .filter(|remote| Some(*remote) != head.as_ref())
            {
                let range = format!("{}...{remote}", head.as_deref().unwrap_or(scope));
                let sides = super::run_text(root, &["rev-list", "--left-right", &range])?;
                let left: HashSet<_> = sides
                    .lines()
                    .filter_map(|line| line.strip_prefix('<'))
                    .collect();
                let right: HashSet<_> = sides
                    .lines()
                    .filter_map(|line| line.strip_prefix('>'))
                    .collect();
                for commit in &mut commits {
                    commit.local = !right.contains(commit.hash.as_str());
                    commit.remote = !left.contains(commit.hash.as_str());
                }
            } else {
                for commit in &mut commits {
                    commit.local = true;
                    commit.remote = upstream.is_some();
                }
            }
            for commit in &mut commits {
                if head.as_ref() == Some(&commit.hash) {
                    commit.refs.push(GitCommitRef {
                        name: branch.clone(),
                        remote: false,
                    });
                }
                if upstream.as_ref() == Some(&commit.hash) {
                    commit.refs.push(GitCommitRef {
                        name: upstream_name.clone().unwrap_or_default(),
                        remote: true,
                    });
                }
            }
        }
        Ok(HistoryPage {
            commits,
            next_offset,
            key,
        })
    })
}

pub(super) fn read_history(
    root: &Path,
    head: Option<&str>,
    branch: &str,
    upstream: Option<&GitUpstream>,
) -> Result<Vec<GitCommit>, String> {
    let Some(head) = head else {
        return Ok(Vec::new());
    };
    let mut args = vec![
        "log",
        "--topo-order",
        "-10",
        "-z",
        "--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P",
        head,
    ];
    if let Some(upstream) = upstream {
        args.push(&upstream.hash);
    }
    args.push("--");
    let log = run(root, &args)?;
    let fields: Vec<&[u8]> = log.split(|byte| *byte == 0).collect();
    let mut local_ancestors = HashSet::from([head.to_owned()]);
    let mut remote_ancestors: HashSet<String> = upstream
        .map(|upstream| upstream.hash.clone())
        .into_iter()
        .collect();
    fields
        .chunks_exact(6)
        .map(|fields| {
            let text = |index: usize| String::from_utf8_lossy(fields[index]).into_owned();
            let hash = text(0);
            let parents: Vec<String> = text(5).split_whitespace().map(str::to_owned).collect();
            // --topo-order visits every child before its parents. Propagate
            // reachability from both tips through this already bounded log;
            // no per-commit Git processes or persistent history cache needed.
            let local = local_ancestors.remove(&hash);
            let remote = remote_ancestors.remove(&hash);
            if local {
                local_ancestors.extend(parents.iter().cloned());
            }
            if remote {
                remote_ancestors.extend(parents.iter().cloned());
            }
            let mut refs = Vec::new();
            if hash == head {
                refs.push(GitCommitRef {
                    name: if branch.starts_with("detached@") {
                        "HEAD".to_owned()
                    } else {
                        branch.to_owned()
                    },
                    remote: false,
                });
            }
            if let Some(upstream) = upstream.filter(|upstream| upstream.hash == hash) {
                refs.push(GitCommitRef {
                    name: upstream.name.clone(),
                    remote: true,
                });
            }
            Ok(GitCommit {
                hash,
                short_hash: text(1),
                subject: text(2),
                author: text(3),
                date: text(4),
                parents,
                refs,
                local,
                remote,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{command, open_repository, run_text, tests::repo};

    fn commit(root: &Path, message: &str) -> String {
        run(root, &["commit", "--allow-empty", "-m", message]).unwrap();
        run_text(root, &["rev-parse", "HEAD"]).unwrap()
    }

    #[test]
    fn limits_history_to_ten_and_handles_unborn_and_detached_head() {
        let directory = repo();
        let root = directory.path();
        assert!(read_history(root, None, "main", None).unwrap().is_empty());
        let mut tip = String::new();
        for index in 0..12 {
            tip = commit(root, &format!("chore: commit {index}"));
        }
        let commits = read_history(root, Some(&tip), "main", None).unwrap();
        assert_eq!(commits.len(), 10);
        assert_eq!(commits[0].subject, "chore: commit 11");
        assert!(commits.iter().all(|commit| commit.local && !commit.remote));
        assert_eq!(commits[0].refs[0].name, "main");
        assert_eq!(commits[0].parents.len(), 1);
        let detached = read_history(root, Some(&tip), "detached@1234567", None).unwrap();
        assert_eq!(detached[0].refs[0].name, "HEAD");
    }

    #[test]
    fn places_local_and_remote_refs_by_hash_and_distinguishes_divergence() {
        let directory = repo();
        let root = directory.path();
        let path = root.to_str().unwrap();
        let base = commit(root, "docs: shared base");
        run(
            root,
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/repo.git",
            ],
        )
        .unwrap();
        run(root, &["config", "branch.main.remote", "origin"]).unwrap();
        run(root, &["config", "branch.main.merge", "refs/heads/main"]).unwrap();
        run(root, &["update-ref", "refs/remotes/origin/main", &base]).unwrap();
        let local = commit(root, "feat: local only");
        let outgoing = open_repository(path).unwrap();
        assert_eq!(outgoing.ahead, 1);
        assert_eq!(outgoing.behind, 0);
        assert_eq!(outgoing.upstream.unwrap().hash, base);
        let tip = &outgoing.commits[0];
        assert!(tip.local && !tip.remote);
        assert_eq!(tip.refs[0].name, "main");
        assert!(outgoing.commits[1].local && outgoing.commits[1].remote);
        assert_eq!(outgoing.commits[1].refs[0].name, "origin/main");

        run(root, &["checkout", "-b", "remote-side", &base]).unwrap();
        let remote = commit(root, "fix: remote only");
        run(root, &["checkout", "main"]).unwrap();
        run(root, &["update-ref", "refs/remotes/origin/main", &remote]).unwrap();
        let divergent = open_repository(path).unwrap();
        assert_eq!((divergent.ahead, divergent.behind), (1, 1));
        assert_eq!(divergent.commits.len(), 3);
        let incoming = divergent
            .commits
            .iter()
            .find(|commit| commit.hash == remote)
            .unwrap();
        assert!(!incoming.local && incoming.remote);
        assert!(incoming.refs[0].remote);
        assert_eq!(incoming.refs[0].name, "origin/main");
        let shared = divergent
            .commits
            .iter()
            .find(|commit| commit.hash == base)
            .unwrap();
        assert!(shared.local && shared.remote);

        run(root, &["update-ref", "refs/remotes/origin/main", &local]).unwrap();
        let synchronized = open_repository(path).unwrap();
        assert_eq!((synchronized.ahead, synchronized.behind), (0, 0));
        assert_eq!(synchronized.commits[0].refs.len(), 2);
        assert!(synchronized
            .commits
            .iter()
            .all(|commit| commit.local && commit.remote));
    }

    #[test]
    fn bulk_reachability_matches_git_with_merges_truncation_and_skewed_dates() {
        let directory = repo();
        let root = directory.path();
        let base = commit(root, "base");
        run(root, &["branch", "remote-side"]).unwrap();
        for index in 0..3 {
            commit(root, &format!("local {index}"));
        }
        let local = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        run(root, &["checkout", "remote-side"]).unwrap();
        for index in 0..12 {
            let result = command(Some(root))
                .args(["commit", "--allow-empty", "-m", &format!("remote {index}")])
                .env("GIT_AUTHOR_DATE", "2000-01-01T00:00:00Z")
                .env("GIT_COMMITTER_DATE", "2000-01-01T00:00:00Z")
                .output()
                .unwrap();
            assert!(result.status.success());
        }
        let remote = run_text(root, &["rev-parse", "HEAD"]).unwrap();

        let check = |head: &str, remote: &str| {
            let upstream = GitUpstream {
                name: "origin/main".into(),
                hash: remote.into(),
            };
            super::super::GIT_COMMAND_COUNT.with(|count| count.set(0));
            let commits = read_history(root, Some(head), "main", Some(&upstream)).unwrap();
            super::super::GIT_COMMAND_COUNT.with(|count| assert_eq!(count.get(), 1));
            assert_eq!(commits.len(), 10);
            for commit in commits {
                let reachable = |tip: &str| {
                    super::super::output(
                        Some(root),
                        &["merge-base", "--is-ancestor", &commit.hash, tip],
                    )
                    .unwrap()
                    .status
                    .success()
                };
                assert_eq!(commit.local, reachable(head), "local {}", commit.subject);
                assert_eq!(
                    commit.remote,
                    reachable(remote),
                    "remote {}",
                    commit.subject
                );
            }
        };
        check(&local, &remote);
        check(&remote, &base);
        check(&base, &remote);
        check(&remote, &remote);
        run(root, &["checkout", "main"]).unwrap();
        run(
            root,
            &["merge", "--no-ff", "remote-side", "-m", "merge both sides"],
        )
        .unwrap();
        let merged = run_text(root, &["rev-parse", "HEAD"]).unwrap();
        check(&merged, &remote);
    }
}
