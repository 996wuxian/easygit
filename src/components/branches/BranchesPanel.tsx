import { useState, type DragEvent } from 'react';
import { IconArrowRight, IconCloud, IconGitBranch, IconGitMerge } from '@tabler/icons-react';
import type { RepositorySnapshot } from '../../services/git';
import { recentBranchGroups } from './model';
import './branches.css';

export function BranchesPanel({ snapshot, busy, onCheckout, onMergeRequest, mergeDisabled = false }: {
  snapshot: RepositorySnapshot; busy: boolean; onCheckout: (name: string) => void;
  onMergeRequest?: (source: string, target: string) => void; mergeDisabled?: boolean;
}) {
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const groups = recentBranchGroups(snapshot.branches);
  const localBranches = dragSource ? snapshot.branches.filter(branch => !branch.remote) : groups.local;
  const currentFiltered = snapshot.branch && !snapshot.branch.startsWith('detached@') && !groups.local.some(branch => branch.current);
  const handleDragStart = (event: DragEvent<HTMLButtonElement>, name: string) => {
    if (!onMergeRequest || mergeDisabled) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-easygit-branch', name);
    event.dataTransfer.setData('text/plain', name);
    setDragSource(name);
  };
  const handleDrop = (event: DragEvent<HTMLButtonElement>, target: string) => {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer.getData('application/x-easygit-branch') || dragSource;
    setMergeTarget(null);
    setDragSource(null);
    if (source && source !== target && onMergeRequest && !mergeDisabled) onMergeRequest(source, target);
  };
  return <div className="branches-content">
    <div className="branch-filter-note">近 6 个月<span>按最后提交时间</span></div>
    {onMergeRequest && <div className="branch-merge-hint"><IconGitMerge size={13} />拖动本地分支到目标分支即可合并</div>}
    {currentFiltered && <div className="branch-current-note" title={snapshot.branch}>当前：<code>{snapshot.branch}</code><span>{snapshot.head ? '不在近期列表中' : '尚无提交'}</span></div>}
    {(['local', 'remote'] as const).map(type => {
      const branches = type === 'local' ? localBranches : groups.remote;
      return <section className="branch-group" aria-label={type === 'local' ? '本地分支' : '远程分支'} key={type}>
      <div className="branch-group-heading">{type === 'local' ? <IconGitBranch size={13} /> : <IconCloud size={13} />}<span>{type === 'local' ? '本地分支' : '远程分支'}</span><b>{branches.length}</b></div>
      {branches.map(branch => {
        const date = branch.lastCommitDate ? new Date(branch.lastCommitDate) : null;
        const content = <>{branch.remote ? <IconCloud size={16} /> : <IconGitBranch size={16} />}<span className="branch-name">{branch.name}</span>{date && <time dateTime={branch.lastCommitDate!} title={`最后提交：${date.toLocaleString('zh-CN')}`}>{date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</time>}{branch.current ? <span className="current-badge">当前</span> : !branch.remote && <IconArrowRight size={14} className="branch-arrow" />}</>;
        return branch.remote
          ? <div className="branch-row remote" key={branch.name} title={`远程跟踪分支：${branch.name}，以上次获取更新为准`}>{content}</div>
          : <button
            className={`branch-row ${branch.current ? 'current' : ''} ${mergeTarget === branch.name && dragSource !== branch.name ? 'merge-target' : ''} ${dragSource === branch.name ? 'merge-source' : ''}`}
            key={branch.name}
            draggable={Boolean(onMergeRequest) && !mergeDisabled}
            aria-disabled={busy || branch.current}
            title={onMergeRequest ? `${branch.current ? '当前分支' : `切换到 ${branch.name}`}；拖动到其他本地分支以预览合并` : branch.current ? `当前分支：${branch.name}` : `切换到 ${branch.name}`}
            onClick={() => { if (!busy && !branch.current) onCheckout(branch.name); }}
            onDragStart={event => handleDragStart(event, branch.name)}
            onDragEnd={() => { setDragSource(null); setMergeTarget(null); }}
            onDragOver={event => {
              if (!dragSource || dragSource === branch.name || mergeDisabled) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (mergeTarget !== branch.name) setMergeTarget(branch.name);
            }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMergeTarget(current => current === branch.name ? null : current); }}
            onDrop={event => handleDrop(event, branch.name)}
          >{content}</button>;
      })}
      {!branches.length && <div className="branch-empty">{type === 'local' ? '近半年没有本地分支提交' : '近半年没有远程分支提交'}</div>}
      </section>;
    })}
    <div className="branch-bottom">{snapshot.remote ? <><span title={snapshot.remote}>{snapshot.ahead} 个待推送 · {snapshot.behind} 个待拉取</span><small>远程分支以上次获取更新为准</small></> : <span>尚未配置远程仓库</span>}</div>
  </div>;
}
