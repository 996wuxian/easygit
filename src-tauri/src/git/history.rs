use super::{output, run, GitCommit, GitCommitRef, GitUpstream};
use std::path::Path;

fn is_ancestor(root: &Path, ancestor: &str, tip: &str) -> Result<bool, String> {
    if ancestor == tip {
        return Ok(true);
    }
    let result = output(Some(root), &["merge-base", "--is-ancestor", ancestor, tip])?;
    match result.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(super::error_text(&result)),
    }
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
    fields
        .chunks_exact(6)
        .map(|fields| {
            let text = |index: usize| String::from_utf8_lossy(fields[index]).into_owned();
            let hash = text(0);
            let local = upstream.is_none() || is_ancestor(root, &hash, head)?;
            let remote = match upstream {
                Some(upstream) => is_ancestor(root, &hash, &upstream.hash)?,
                None => false,
            };
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
                parents: text(5).split_whitespace().map(str::to_owned).collect(),
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
    use crate::git::{open_repository, run_text, tests::repo};

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
}
