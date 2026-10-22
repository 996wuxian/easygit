import { useEffect, useRef, useState } from 'react';
import { git, type GitBranch, type HistoryPage, type RepositorySnapshot } from '../../services/git';

export const branchKey = (branch: GitBranch) => JSON.stringify([branch.remote, branch.name]);

export function useCommitHistory(snapshot: RepositorySnapshot) {
  const [scope, setScope] = useState('current');
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<{ context: string; offset: number; value: HistoryPage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = JSON.stringify([snapshot.path, snapshot.head, snapshot.branch, snapshot.upstream?.hash, scope, keyword]);
  const previousContext = useRef(context);
  const key = useRef<string | null>(null);
  const paged = expanded || scope !== 'current' || Boolean(keyword);
  const reference = snapshot.branches.find(branch => branchKey(branch) === scope);
  const referenceName = reference?.name;
  const referenceRemote = reference?.remote;
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (previousContext.current !== context) {
      previousContext.current = context;
      key.current = null;
      if (offset !== 0) { setOffset(0); return; }
    }
    if (!paged || !snapshot.path) { setPage(null); setLoading(false); setError(null); return; }
    let active = true; setLoading(true); setError(null);
    void git.history(snapshot.path, { reference: referenceName ? { name: referenceName, remote: referenceRemote ?? false } : null, query: keyword, offset, expectedKey: offset ? key.current : null }).then(value => {
      if (active) { key.current = value.key; setPage({ context, offset, value }); }
    }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [context, offset, paged, reload, snapshot.path, keyword, referenceName, referenceRemote]);
  const current = page?.context === context && page.offset === offset ? page.value : null;
  return { scope, setScope, search, setSearch, offset, loading, error, paged,
    commits: paged ? current?.commits ?? [] : snapshot.commits,
    nextOffset: current?.nextOffset ?? null,
    expand: () => { setOffset(0); setExpanded(true); },
    refresh: () => { setOffset(0); key.current = null; setReload(value => value + 1); },
    previous: () => setOffset(value => Math.max(0, value - 25)),
    next: () => { if (current?.nextOffset !== null && current?.nextOffset !== undefined) setOffset(current.nextOffset); },
  };
}
