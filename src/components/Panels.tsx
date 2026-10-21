import { useState } from 'react';
import { IconArrowDown, IconArrowRight, IconArrowUp, IconCheck, IconChevronRight, IconCircleCheck, IconCode, IconFile, IconFileCode, IconGitBranch, IconGitCommit, IconInbox, IconLoader2, IconMinus, IconPlus, IconSearch, IconSparkles, IconStack2, IconTrash, IconX } from '@tabler/icons-react';
import type { GitCommit, GitFile, RepositorySnapshot } from '../services/git';
import type { Activity } from '../services/useRepository';
import './panels.css';

export function ChangesPanel({ snapshot, message, onMessageChange, selected, onSelect, onStage, onUnstage, onDiscard, onCommit, canPush, pushTitle, onPush, onGenerateCommitMessage, generatingCommitMessage, busy }: {
  message: string; onMessageChange: (message: string) => void;
  snapshot: RepositorySnapshot; selected: string | null; onSelect: (path: string, staged: boolean) => void;
  onStage: (paths: string[]) => void; onUnstage: (paths: string[]) => void; onDiscard: (paths: string[], scope: 'file' | 'all') => void; onCommit: (message: string) => Promise<boolean>; canPush: boolean; pushTitle: string; onPush: () => void; onGenerateCommitMessage: () => void; generatingCommitMessage: boolean; busy: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({ pending: false, staged: false });
  const pending = snapshot.files.filter(f => f.unstaged || f.untracked && !f.staged);
  const staged = snapshot.files.filter(f => f.staged);
  const matches = (f: GitFile) => f.path.toLowerCase().includes(filter.toLowerCase());
  const submit = async () => { if (!message.trim() || !staged.length || busy || generatingCommitMessage) return; if (await onCommit(message)) onMessageChange(''); };
  function row(f: GitFile, isStaged: boolean) {
    const name = f.path.split('/').pop();
    const directory = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    return <div className={`file-row ${selected === f.path ? 'selected' : ''}`} key={`${f.path}-${isStaged}`}>
      <button className="file-select" onClick={() => onSelect(f.path, isStaged)} title={f.path}>
        <IconFileCode size={17} className="file-icon" />
        <span className="file-label"><strong>{name}</strong><small>{directory || '仓库根目录'}</small></span>
        <span className={`file-status ${f.untracked ? 'new' : f.conflicted ? 'conflict' : ''}`}>{f.conflicted ? '!' : f.untracked ? 'U' : f.indexStatus === 'A' ? 'A' : f.indexStatus === 'D' || f.worktreeStatus === 'D' ? 'D' : 'M'}</span>
      </button>
      {!isStaged && <button className="file-action icon-button discard-file-action" title={f.conflicted ? '冲突文件暂时无法撤回' : '撤回更改'} aria-label={`撤回更改 ${f.path}`} disabled={busy || f.conflicted} onClick={() => onDiscard([f.path], 'file')}><IconTrash size={15} /></button>}
      <button className="file-action icon-button" title={isStaged ? '取消暂存' : f.conflicted ? '请先在编辑器中解决冲突并暂存' : '暂存文件'} aria-label={`${isStaged ? '取消暂存' : f.conflicted ? '标记已解决' : '暂存'} ${f.path}`} disabled={busy || f.conflicted} onClick={() => isStaged ? onUnstage([f.path]) : onStage([f.path])}>{isStaged ? <IconMinus size={16} /> : <IconPlus size={16} />}</button>
    </div>;
  }
  return <div className="changes-content">
    <label className="file-filter"><IconSearch size={15} /><input aria-label="筛选变更文件" placeholder="筛选文件…" value={filter} onChange={e => setFilter(e.target.value)} /><kbd>/</kbd></label>
    <div className="file-groups">
      <div className="file-group-label"><button className="file-group-toggle" aria-label={`${collapsedGroups.pending ? '展开' : '折叠'}未暂存文件`} aria-expanded={!collapsedGroups.pending} aria-controls="unstaged-file-list" onClick={() => setCollapsedGroups(current => ({ ...current, pending: !current.pending }))}><IconChevronRight size={12} /><span>未暂存</span><b>{pending.length}</b></button><div className="file-group-actions"><button className="discard-all-action" title={pending.some(f => f.conflicted) ? '请先解决冲突文件' : `撤回全部未暂存更改（${pending.length} 个文件）`} aria-label="全部撤回" disabled={!pending.length || pending.some(f => f.conflicted) || busy} onClick={() => onDiscard(pending.map(f => f.path), 'all')}><IconTrash size={13} />全部撤回</button><button title="暂存全部非冲突文件" aria-label="暂存全部文件" disabled={!pending.some(f => !f.conflicted) || busy} onClick={() => onStage(pending.filter(f => !f.conflicted).map(f => f.path))}><IconPlus size={14} />全部暂存</button></div></div>
      <div id="unstaged-file-list" hidden={collapsedGroups.pending}>{pending.filter(matches).map(f => row(f, false))}</div>
      <div className="file-group-label staged-label"><button className="file-group-toggle" aria-label={`${collapsedGroups.staged ? '展开' : '折叠'}已暂存文件`} aria-expanded={!collapsedGroups.staged} aria-controls="staged-file-list" onClick={() => setCollapsedGroups(current => ({ ...current, staged: !current.staged }))}><IconChevronRight size={12} /><span>已暂存</span><b>{staged.length}</b></button><div className="file-group-actions"><button title="取消全部暂存" aria-label="取消全部暂存" disabled={!staged.length || busy} onClick={() => onUnstage(staged.map(f => f.path))}><IconMinus size={14} />取消暂存</button></div></div>
      <div id="staged-file-list" hidden={collapsedGroups.staged}>{staged.filter(matches).map(f => row(f, true))}</div>
      {!snapshot.files.length && <div className="clean-state"><IconCircleCheck size={28} stroke={1.3} /><strong>工作区干净</strong><span>没有未提交的更改</span></div>}
      {filter && !snapshot.files.some(matches) && <div className="empty-inline">没有匹配的文件</div>}
    </div>
    <div className="commit-form">
      <label htmlFor="commit-message">提交信息</label>
      <div className="commit-message-row">
        <textarea id="commit-message" aria-label="提交信息" placeholder="描述本次更改…" value={message} disabled={generatingCommitMessage} onChange={e => onMessageChange(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }} />
        <button className="icon-button generate-commit-message" aria-label="AI 生成提交信息" title={staged.length ? '根据已暂存差异生成提交信息' : '请先暂存要提交的文件'} disabled={!staged.length || busy || generatingCommitMessage} aria-busy={generatingCommitMessage} onClick={onGenerateCommitMessage}>{generatingCommitMessage ? <IconLoader2 size={16} className="spin" /> : <IconSparkles size={16} />}</button>
      </div>
      <div className="commit-actions"><button className="primary-button commit-button" disabled={!staged.length || !message.trim() || busy || generatingCommitMessage} onClick={() => { void submit(); }}>{busy ? <IconLoader2 size={16} className="spin" /> : <IconCheck size={16} />}提交更改 <span>{staged.length}</span><kbd>Ctrl ↵</kbd></button><button className="icon-button push-commit-button" aria-label="推送当前分支" title={pushTitle} disabled={busy || !canPush} onClick={onPush}><IconArrowUp size={16} /></button></div>
    </div>
  </div>;
}

export { DiffPanel } from './diff/DiffPanel';

export function BranchesPanel({ snapshot, busy, onCheckout }: { snapshot: RepositorySnapshot; busy: boolean; onCheckout: (name: string) => void }) {
  const branches = snapshot.branches.filter(b => !b.remote);
  return <div className="branches-content"><div className="list-section-label">本地分支 <span>{branches.length}</span></div>{branches.map(branch => <button className={`branch-row ${branch.current ? 'current' : ''}`} key={branch.name} disabled={busy || branch.current} title={branch.current ? '当前分支' : `切换到 ${branch.name}`} onClick={() => onCheckout(branch.name)}><IconGitBranch size={16} /><span>{branch.name}</span>{branch.current ? <span className="current-badge">当前</span> : <IconArrowRight size={14} className="branch-arrow" />}</button>)}{!branches.length && <div className="empty-inline">首次提交后会显示本地分支。</div>}<div className="branch-bottom"><span className="tiny-dot" />{snapshot.remote ? `${snapshot.remote} · ${snapshot.ahead} 个待推送，${snapshot.behind} 个待拉取` : '尚未配置远程仓库'}</div></div>;
}

export function CommitsPanel({ snapshot, onSelect }: { snapshot: RepositorySnapshot; onSelect: (commit: GitCommit) => void }) {
  return <div className="commits-content">{snapshot.commits.slice(0, 5).map((commit, index) => <button className="commit-row" key={commit.hash} onClick={() => onSelect(commit)}><span className={`commit-graph-dot ${index === 0 ? 'latest' : ''}`}><IconGitCommit size={18} /></span><span className="commit-label"><strong>{commit.subject}</strong><small>{commit.author}<span>·</span>{new Date(commit.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</small></span><code>{commit.shortHash}</code></button>)}{!snapshot.commits.length && <div className="clean-state"><IconGitCommit size={28} stroke={1.3} /><strong>暂无提交</strong><span>创建第一次提交后可查看记录</span></div>}</div>;
}

export function StashPanel({ count }: { count: number }) {
  return <div className="stash-content"><div className="stash-illustration"><IconInbox size={32} stroke={1.2} /></div><strong>{count ? `${count} 条暂存记录` : '没有暂存记录'}</strong><p>{count ? '更改已保存在 Git stash 中。' : '当前仓库没有 stash。'}</p></div>;
}

export function ActivityPanel({ activities }: { activities: Activity[] }) {
  return <div className="activity-content">{activities.length ? activities.slice(0, 8).map(item => <div className="activity-row" key={item.id}>{item.error ? <IconX size={15} className="error-color" /> : <IconCheck size={15} className="success-color" />}<span>{item.label}</span><time>{item.time}</time></div>) : <div className="clean-state"><IconArrowDown size={26} stroke={1.3} /><strong>暂无操作记录</strong><span>仓库操作的结果会记录在这里</span></div>}</div>;
}

export const panelIcons = { changes: IconFile, diff: IconCode, branches: IconGitBranch, commits: IconGitCommit, stash: IconStack2, activity: IconCircleCheck };
