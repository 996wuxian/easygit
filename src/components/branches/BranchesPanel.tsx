import { useEffect, useState, type DragEvent } from 'react';
import { useOverflowTooltip } from '../OverflowTooltip';
import { IconArrowRight, IconCloud, IconGitBranch, IconGitMerge } from '@tabler/icons-react';
import type { BranchRequest, GitBranch, RepositorySnapshot } from '../../services/git';
import { useBranchManagement } from './BranchManagement';
import { recentBranchGroups } from './model';
import './branches.css';

export function BranchesPanel({ snapshot, busy, onCheckout, onMergeRequest, mergeDisabled = false, onCompare, searchQuery = '', onBranchAction, notify }: {
  snapshot: RepositorySnapshot; busy: boolean; onCheckout: (name: string, remote: boolean) => void;
  onMergeRequest?: (source: string, target: string, sourceRemote: boolean, targetRemote: boolean) => void; mergeDisabled?: boolean;
  onCompare?: () => void;
  searchQuery?: string;
  onBranchAction?: (path: string, request: BranchRequest) => Promise<boolean>;
  notify?: (message: string, error?: boolean) => void;
}) {
  const [dragSource, setDragSource] = useState<Pick<GitBranch, 'name' | 'remote'> | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Pick<GitBranch, 'name' | 'remote'> | null>(null);
  const overflow = useOverflowTooltip();
  const management = useBranchManagement({ snapshot, busy, onCheckout, onBranchAction, notify });
  const openMenu = (branch: GitBranch, row: HTMLButtonElement, x: number, y: number) => {
    row.focus({ preventScroll: true }); overflow.hide(); management.openMenu(branch, x, y);
  };
  const showTooltip = (row: HTMLElement, branch: GitBranch) => overflow.show(row, branch.name, '.branch-name', `${branch.remote}:${branch.name}`);
  useEffect(() => { overflow.hide(); }, [snapshot.path, snapshot.branches, searchQuery]);
  const sameBranch = (left: Pick<GitBranch, 'name' | 'remote'> | null, right: GitBranch) => left?.name === right.name && left.remote === right.remote;
  const keyword = searchQuery.trim().toLocaleLowerCase();
  const matches = keyword ? snapshot.branches.filter(branch => branch.name.toLocaleLowerCase().includes(keyword)) : [];
  const groups = keyword ? { local: matches.filter(branch => !branch.remote), remote: matches.filter(branch => branch.remote) } : recentBranchGroups(snapshot.branches);
  const recentLocalNames = new Set(groups.local.map(branch => branch.name));
  const localBranches = dragSource && !keyword ? [...groups.local, ...snapshot.branches.filter(branch => !branch.remote && !recentLocalNames.has(branch.name))] : groups.local;
  const currentFiltered = !keyword && snapshot.branch && !snapshot.branch.startsWith('detached@') && !groups.local.some(branch => branch.current);
  const handleDragStart = (event: DragEvent<HTMLElement>, branch: GitBranch) => {
    overflow.hide();
    if (!onMergeRequest || mergeDisabled || busy) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-easygit-branch', JSON.stringify({ name: branch.name, remote: branch.remote }));
    event.dataTransfer.setData('text/plain', branch.name);
    setDragSource({ name: branch.name, remote: branch.remote });
  };
  const handleDrop = (event: DragEvent<HTMLElement>, target: GitBranch) => {
    event.preventDefault();
    event.stopPropagation();
    const source = dragSource;
    setMergeTarget(null);
    setDragSource(null);
    if (source && !sameBranch(source, target) && onMergeRequest && !mergeDisabled && !busy) onMergeRequest(source.name, target.name, source.remote, target.remote);
  };
  const dragProps = (branch: GitBranch) => ({
    draggable: Boolean(onMergeRequest) && !mergeDisabled && !busy,
    onDragStart: (event: DragEvent<HTMLElement>) => handleDragStart(event, branch),
    onDragEnd: () => { setDragSource(null); setMergeTarget(null); },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragSource || sameBranch(dragSource, branch) || mergeDisabled || busy) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!sameBranch(mergeTarget, branch)) setMergeTarget({ name: branch.name, remote: branch.remote });
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMergeTarget(current => sameBranch(current, branch) ? null : current);
    },
    onDrop: (event: DragEvent<HTMLElement>) => handleDrop(event, branch),
  });
  return <div className="branches-content">
    <div className="branch-filter-note" role="status">{keyword ? '搜索结果 · 全部时间' : '近 6 个月'}<span>{keyword ? `${matches.length} 个匹配分支` : '按最后提交时间'}</span></div>
    {onCompare && <button className="text-button branch-compare-entry" onClick={onCompare} disabled={snapshot.branches.length < 2}>对比分支代码</button>}
    {onMergeRequest && <div className="branch-merge-hint"><IconGitMerge size={13} />拖动分支到目标分支即可预览合并，支持本地和远程分支</div>}
    {currentFiltered && <div className="branch-current-note" title={snapshot.branch}>当前：<code>{snapshot.branch}</code><span>{snapshot.head ? '不在近期列表中' : '尚无提交'}</span></div>}
    {(['local', 'remote'] as const).map(type => {
      const branches = type === 'local' ? localBranches : groups.remote;
      return <section className="branch-group" aria-label={type === 'local' ? '本地分支' : '远程分支'} key={type}>
      <div className="branch-group-heading">{type === 'local' ? <IconGitBranch size={13} /> : <IconCloud size={13} />}<span>{type === 'local' ? '本地分支' : '远程分支'}</span><b>{branches.length}</b></div>
      {branches.map(branch => {
        const date = branch.lastCommitDate ? new Date(branch.lastCommitDate) : null;
        const content = <>{branch.remote ? <IconCloud size={16} /> : <IconGitBranch size={16} />}<span className="branch-name">{branch.name}</span>{date && <time dateTime={branch.lastCommitDate!} title={`最后提交：${date.toLocaleString('zh-CN')}`}>{date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</time>}{branch.current ? <span className="current-badge">当前</span> : <IconArrowRight size={14} className="branch-arrow" />}</>;
        return <button
            className={`branch-row ${branch.remote ? 'remote' : ''} ${branch.current ? 'current' : ''} ${sameBranch(mergeTarget, branch) ? 'merge-target' : ''} ${sameBranch(dragSource, branch) ? 'merge-source' : ''}`}
            key={branch.name}
            {...dragProps(branch)}
            aria-disabled={busy || branch.current}
            aria-haspopup="menu"
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu(branch, event.currentTarget, event.clientX, event.clientY); }}
            onKeyDown={event => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault(); event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect(); openMenu(branch, event.currentTarget, rect.left + 24, rect.bottom);
              }
            }}
            aria-describedby={overflow.describedBy(`${branch.remote}:${branch.name}`)}
            onMouseEnter={event => showTooltip(event.currentTarget, branch)}
            onMouseLeave={() => overflow.hide()}
            onFocus={event => showTooltip(event.currentTarget, branch)}
            onBlur={() => overflow.hide()}
            aria-label={branch.remote ? `切换到远程分支 ${branch.name}` : branch.current ? `当前分支：${branch.name}` : `切换到 ${branch.name}`}
            onClick={() => { if (!busy && !branch.current) onCheckout(branch.name, branch.remote); }}
          >{content}</button>;
      })}
      {!branches.length && <div className="branch-empty">{keyword ? (type === 'local' ? '没有匹配的本地分支' : '没有匹配的远程分支') : (type === 'local' ? '近半年没有本地分支提交' : '近半年没有远程分支提交')}</div>}
      </section>;
    })}
    <div className="branch-bottom">{snapshot.remote ? <><span title={snapshot.remote}>{snapshot.ahead} 个待推送 · {snapshot.behind} 个待拉取</span><small>远程分支以上次获取更新为准</small></> : <span>尚未配置远程仓库</span>}</div>
    {overflow.tooltip}
    {management.content}
  </div>;
}
