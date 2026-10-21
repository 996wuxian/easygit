import { IconArrowRight, IconCloud, IconGitBranch } from '@tabler/icons-react';
import type { RepositorySnapshot } from '../../services/git';
import { recentBranchGroups } from './model';
import './branches.css';

export function BranchesPanel({ snapshot, busy, onCheckout }: { snapshot: RepositorySnapshot; busy: boolean; onCheckout: (name: string) => void }) {
  const groups = recentBranchGroups(snapshot.branches);
  const currentFiltered = snapshot.branch && !snapshot.branch.startsWith('detached@') && !groups.local.some(branch => branch.current);
  return <div className="branches-content">
    <div className="branch-filter-note">近 6 个月<span>按最后提交时间</span></div>
    {currentFiltered && <div className="branch-current-note" title={snapshot.branch}>当前：<code>{snapshot.branch}</code><span>{snapshot.head ? '不在近期列表中' : '尚无提交'}</span></div>}
    {(['local', 'remote'] as const).map(type => <section className="branch-group" aria-label={type === 'local' ? '本地分支' : '远程分支'} key={type}>
      <div className="branch-group-heading">{type === 'local' ? <IconGitBranch size={13} /> : <IconCloud size={13} />}<span>{type === 'local' ? '本地分支' : '远程分支'}</span><b>{groups[type].length}</b></div>
      {groups[type].map(branch => {
        const date = new Date(branch.lastCommitDate!);
        const content = <>{branch.remote ? <IconCloud size={16} /> : <IconGitBranch size={16} />}<span className="branch-name">{branch.name}</span><time dateTime={branch.lastCommitDate!} title={`最后提交：${date.toLocaleString('zh-CN')}`}>{date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</time>{branch.current ? <span className="current-badge">当前</span> : !branch.remote && <IconArrowRight size={14} className="branch-arrow" />}</>;
        return branch.remote
          ? <div className="branch-row remote" key={branch.name} title={`远程跟踪分支：${branch.name}，以上次获取更新为准`}>{content}</div>
          : <button className={`branch-row ${branch.current ? 'current' : ''}`} key={branch.name} disabled={busy || branch.current} title={branch.current ? `当前分支：${branch.name}` : `切换到 ${branch.name}`} onClick={() => onCheckout(branch.name)}>{content}</button>;
      })}
      {!groups[type].length && <div className="branch-empty">{type === 'local' ? '近半年没有本地分支提交' : '近半年没有远程分支提交'}</div>}
    </section>)}
    <div className="branch-bottom">{snapshot.remote ? <><span title={snapshot.remote}>{snapshot.ahead} 个待推送 · {snapshot.behind} 个待拉取</span><small>远程分支以上次获取更新为准</small></> : <span>尚未配置远程仓库</span>}</div>
  </div>;
}
