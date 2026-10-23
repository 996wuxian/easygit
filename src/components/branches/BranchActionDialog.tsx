import { useEffect, useRef, useState } from 'react';
import { IconLoader2 } from '@tabler/icons-react';
import { git, type BranchAction, type BranchInfo, type BranchRequest, type RepositorySnapshot } from '../../services/git';
import { Dialog } from '../Dialog';

export type BranchActionKind = BranchAction['kind'];
export const branchActionTitles = { rename: '重命名分支', delete: '删除本地分支', upstream: '设置上游分支', 'unset-upstream': '取消上游分支' };

export function BranchActionDialog({ snapshot, branch, kind, defaultUpstream = '', busy, onClose, onAction }: {
  snapshot: RepositorySnapshot; branch: string; kind: BranchActionKind; defaultUpstream?: string; busy: boolean;
  onClose: () => void; onAction: (path: string, request: BranchRequest) => Promise<boolean>;
}) {
  const [initial] = useState(() => ({ path: snapshot.path, branch: snapshot.branch, head: snapshot.head }));
  const [info, setInfo] = useState<BranchInfo | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState(branch);
  const [upstream, setUpstream] = useState(defaultUpstream);
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const remoteBranches = snapshot.branches.filter(item => item.remote);
  const stale = initial.path !== snapshot.path || initial.branch !== snapshot.branch || initial.head !== snapshot.head || !snapshot.branches.some(item => !item.remote && item.name === branch);
  useEffect(() => {
    let active = true;
    void git.branchInfo(initial.path, branch).then(next => {
      if (!active) return;
      setInfo(next);
      if (!defaultUpstream) setUpstream(next.upstream?.replace(/^refs\/remotes\//, '') ?? '');
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [initial.path, branch, defaultUpstream]);
  const locked = busy || saving;
  const invalid = kind === 'rename' ? !name.trim() || name.trim() === branch || snapshot.branches.some(item => !item.remote && item.name === name.trim())
    : kind === 'upstream' ? !remoteBranches.some(item => item.name === upstream) : kind === 'unset-upstream' ? !info?.upstream : branch === snapshot.branch;
  const submit = async () => {
    if (running.current || locked || stale || invalid || !info || error) return;
    running.current = true; setSaving(true);
    const action: BranchAction = kind === 'rename' ? { kind, name: name.trim() } : kind === 'upstream' ? { kind, upstream } : { kind };
    try {
      const ok = await onAction(initial.path, { branch, expectedHead: info.head, expectedUpstream: info.upstream, expectedBranch: initial.branch, expectedCurrentHead: initial.head, action });
      if (ok) onClose();
    } finally { running.current = false; setSaving(false); }
  };
  return <Dialog title={branchActionTitles[kind]} className="branch-action-dialog" onClose={() => { if (!locked) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="branch-action-target">本地分支：<code>{branch}</code></p>
      {!info && !error && <p className="dialog-description" role="status">正在读取分支信息…</p>}
      {kind === 'rename' && <label className="field-label">新分支名称<input className="text-field mono" aria-label="新分支名称" value={name} onChange={event => setName(event.target.value)} disabled={locked} autoFocus /></label>}
      {kind === 'upstream' && <><label className="field-label">远程上游分支<select className="text-field mono" aria-label="远程上游分支" value={upstream} onChange={event => setUpstream(event.target.value)} disabled={locked}>
        <option value="">请选择远程分支</option>{remoteBranches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select></label><p className="dialog-description">仅更改跟踪关系，后续获取与推拉状态将以上游为准。</p></>}
      {kind === 'delete' && <p className="dialog-description">删除本地分支，远程分支会保留。仅允许删除已完全合并到当前分支、且未被其他 worktree 使用的分支。</p>}
      {kind === 'unset-upstream' && <p className="dialog-description">{info && !info.upstream ? '此分支尚未设置上游。' : <>取消跟踪 <code>{info?.upstream?.replace(/^refs\/remotes\//, '') ?? '…'}</code>，分支提交和远程内容会保留。</>}</p>}
      {stale && <p className="error-color" role="alert">仓库或当前分支已变化，请关闭后重新操作。</p>}
      {error && <p className="error-color" role="alert">{error}</p>}
      <div className="remove-workspace-actions"><button type="button" className="secondary-button" disabled={locked} onClick={onClose}>取消</button><button type="submit" className={`primary-button ${kind === 'delete' ? 'remove-workspace-confirm' : ''}`} disabled={locked || stale || invalid || !info || Boolean(error)}>{saving && <IconLoader2 size={15} className="spin" />}确认{branchActionTitles[kind]}</button></div>
    </form>
  </Dialog>;
}
