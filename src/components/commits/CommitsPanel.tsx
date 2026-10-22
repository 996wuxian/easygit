import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowDown, IconArrowUp, IconCloud, IconGitBranch, IconHistory } from '@tabler/icons-react';
import type { CommitAction, GitCommit, RepositorySnapshot } from '../../services/git';
import { buildCommitGraph, commitStatus } from './model';
import { CommitContextMenu } from './CommitContextMenu';
import { CommitActionDialog } from './CommitActionDialog';
import { branchKey, useCommitHistory } from './useCommitHistory';
import { SelectMenu } from '../SelectMenu';
import './commits.css';
import '../diff/inspection.css';

export function CommitRefs({ commit }: { commit: GitCommit }) {
  return <span className="commit-refs">{commit.refs.map(ref => <span className={`commit-ref ${ref.remote ? 'remote' : 'local'}`} key={`${ref.name}-${ref.remote}`} title={`${ref.remote ? '远端跟踪分支' : '本地分支'}：${ref.name}`}>
    {ref.remote ? <IconCloud size={12} /> : <IconGitBranch size={12} />}<span>{ref.name}</span>
  </span>)}</span>;
}

export function CommitsPanel({ snapshot, onSelect, busy, onAction, notify }: {
  snapshot: RepositorySnapshot; onSelect: (commit: GitCommit) => void; busy: boolean;
  onAction: (commit: GitCommit, expectedHead: string, expectedBranch: string, action: CommitAction) => Promise<boolean>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [menu, setMenu] = useState<{ commit: GitCommit; x: number; y: number } | null>(null);
  const [confirmation, setConfirmation] = useState<{ commit: GitCommit; action: CommitAction; head: string; branch: string } | null>(null);
  const runningRef = useRef(false);
  useEffect(() => setMenu(null), [snapshot.path, snapshot.head]);
  const history = useCommitHistory(snapshot);
  const commits = history.commits;
  const graph = buildCommitGraph(commits);
  return <div className="commits-content">
    <div className="history-tools"><SelectMenu className="history-branch-select" label="历史分支" listLabel="选择历史分支" value={history.scope} onChange={history.setScope}
      options={[{ value: 'current', label: '当前分支与上游', icon: <IconHistory size={16} aria-hidden="true" /> }, ...snapshot.branches.map(branch => ({ value: branchKey(branch), label: `${branch.remote ? '远程' : '本地'} · ${branch.name}`, icon: branch.remote ? <IconCloud size={16} aria-hidden="true" /> : <IconGitBranch size={16} aria-hidden="true" /> }))]} /><input aria-label="搜索提交信息" placeholder="搜索提交信息…" value={history.search} onChange={event => history.setSearch(event.target.value)} maxLength={120} /></div>
    {commits.length > 0 && <div className="history-summary">
      <span>{snapshot.hasUpstream ? <><span title="本地领先上游，等待推送"><IconArrowUp size={12} />{snapshot.ahead}</span><span title="上游领先本地，等待拉取"><IconArrowDown size={12} />{snapshot.behind}</span></> : '本地历史'}</span>
      <small title="远端跟踪分支保存在本机；点击获取更新可刷新远端位置">{snapshot.upstream ? '远端位置以上次获取为准' : '未设置上游分支'}</small>
    </div>}
    <div className="history-list">{commits.map((commit, index) => {
      const status = commitStatus(commit, snapshot.hasUpstream);
      const detail = `${commit.subject}\n${commit.author} · ${new Date(commit.date).toLocaleString('zh-CN')}\n${status.label} · ${commit.hash}`;
      return <button className={`history-row ${status.kind}`} key={commit.hash} onClick={() => onSelect(commit)} title={detail}
        aria-haspopup="menu" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); setMenu({ commit, x: event.clientX, y: event.clientY }); }}
        onKeyDown={event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault(); event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu({ commit, x: bounds.left + 24, y: bounds.bottom });
          }
        }}>
        <svg className="history-graph" width={graph.width} height={56} aria-hidden="true">
          {graph.rows[index].paths.map((path, key) => <path d={path} key={key} />)}
          <circle cx={12 + graph.rows[index].column * 12} cy={28} r={commit.refs.length ? 5 : 3.5} className={commit.refs.length ? 'tip' : ''} />
        </svg>
        <span className="history-row-content"><span className="history-row-title"><strong>{commit.subject}</strong><CommitRefs commit={commit} /></span>
          <span className="history-row-meta"><span className="history-author">{commit.author}</span><time dateTime={commit.date}>{new Date(commit.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</time><span className={`commit-state ${status.kind}`}>{status.label}</span><code>{commit.shortHash}</code></span>
        </span>
      </button>;
    })}</div>
    {!history.paged && snapshot.head && !commits.some(commit => commit.hash === snapshot.head) && <div className="history-range-note">本地 {snapshot.branch} 的指向不在最近 10 条记录中</div>}
    {!history.paged && snapshot.upstream && !commits.some(commit => commit.hash === snapshot.upstream?.hash) && <div className="history-range-note">{snapshot.upstream.name} 的指向不在最近 10 条记录中</div>}
    {history.error && <div className="history-range-note error-color" role="alert">{history.error}<button className="text-button" onClick={history.refresh}>刷新历史</button></div>}
    {!commits.length && !history.loading && !history.error && <div className="clean-state"><IconHistory size={28} stroke={1.3} /><strong>{history.paged ? '没有匹配提交' : '暂无提交'}</strong><span>{history.paged ? '试试其他关键词或分支' : '创建第一次提交后可查看记录'}</span></div>}
    <div className="history-pagination">{history.paged ? <><button aria-label="上一页提交" disabled={history.loading || history.offset === 0} onClick={history.previous}>上一页</button><span>{history.loading ? '正在读取…' : `第 ${Math.floor(history.offset / 25) + 1} 页`}</span><button aria-label="下一页提交" disabled={history.loading || history.nextOffset === null} onClick={history.next}>下一页</button><button onClick={history.refresh} disabled={history.loading}>刷新</button></> : commits.length >= 10 && <button onClick={history.expand}>更多历史</button>}</div>
    {menu && <CommitContextMenu {...menu} snapshot={snapshot} busy={busy} onClose={() => setMenu(null)} onSelect={() => onSelect(menu.commit)} notify={notify}
      onAction={action => { if (snapshot.head) setConfirmation({ commit: menu.commit, action, head: snapshot.head, branch: snapshot.branch }); }} />}
    {confirmation && createPortal(<CommitActionDialog {...confirmation} busy={busy} stale={confirmation.head !== snapshot.head || confirmation.branch !== snapshot.branch}
      onCancel={() => setConfirmation(null)} onConfirm={() => {
        if (runningRef.current || busy) return;
        runningRef.current = true;
        void onAction(confirmation.commit, confirmation.head, confirmation.branch, confirmation.action)
          .then(success => { if (success) setConfirmation(null); })
          .finally(() => { runningRef.current = false; });
      }} />, document.body)}
  </div>;
}
