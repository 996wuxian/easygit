import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconMaximize, IconCode, IconCopy, IconFileCode, IconLoader2, IconTextWrap, IconX } from '@tabler/icons-react';
import { git, type DiffBlock, type RepositorySnapshot } from '../../services/git';
import { ExpandedDiff } from './ExpandedDiff';
import { isCombinedDiff, UnifiedDiff } from './UnifiedDiff';
import { countDiffChanges } from './model';
import type { DiffActions } from './DiffFileActions';
import { DiffFileNavigation } from './DiffNavigation';
import '../panels.css';

type DiffState = { key: string; status: 'loading' | 'ready' | 'refreshing' | 'error'; diff?: string; error?: string };

export function DiffPanel({ snapshot, selected, staged, onStagedChange, onSelectFile, notify, ...actions }: DiffActions & {
  snapshot: RepositorySnapshot; selected: string | null; staged: boolean;
  onStagedChange: (value: boolean) => void; onSelectFile?: (path: string) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [result, setResult] = useState<DiffState | null>(null);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const requestKey = JSON.stringify([snapshot.path, selected, staged]);
  useEffect(() => {
    let cancelled = false;
    if (!snapshot.path || !selected) { setResult(null); return; }
    // Keep the same file visible during a background refresh, including an empty diff.
    setResult(current => current?.key === requestKey
      ? { ...current, status: current.diff !== undefined ? 'refreshing' : 'loading' }
      : { key: requestKey, status: 'loading' });
    void git.diff(snapshot.path, selected, staged).then(diff => {
      if (!cancelled) setResult({ key: requestKey, status: 'ready', diff });
    }).catch(error => {
      if (!cancelled) setResult(current => ({ ...(current?.key === requestKey ? current : { key: requestKey }), status: 'error', error: String(error) }));
    });
    return () => { cancelled = true; };
  }, [snapshot, selected, staged, requestKey]);
  useEffect(() => { if (!selected) setExpanded(false); }, [selected]);
  const current = result?.key === requestKey ? result : null;
  const diff = current?.diff ?? '';
  const hasResult = current?.diff !== undefined;
  const loading = Boolean(snapshot.path && selected && (!current || current.status === 'loading' || current.status === 'refreshing'));
  const error = current?.error ?? '';
  const showLoading = loading && !hasResult && !error;
  const combined = isCombinedDiff(diff);
  const { added, removed } = countDiffChanges(diff);
  const selectedFile = snapshot.files.find(file => file.path === selected);
  const files = snapshot.files.filter(file => staged ? file.staged : file.unstaged || file.untracked || file.conflicted);
  const discardBlock = selected && !staged && hasResult && selectedFile?.unstaged && !selectedFile.conflicted && selectedFile.worktreeStatus !== 'R'
    ? (block: DiffBlock) => actions.onDiscardBlock(selected, block) : undefined;
  return <div className="diff-content">
    <div className="diff-toolbar">
      <div className="diff-toolbar-main">
        <div className="segmented"><button className={!staged ? 'active' : ''} onClick={() => onStagedChange(false)}>工作区</button><button className={staged ? 'active' : ''} onClick={() => onStagedChange(true)}>暂存区</button></div>
        <div className="diff-file-path"><IconFileCode size={14} aria-hidden="true" /><span className="diff-file-name" title={selected ?? '选择一个文件以查看更改'}>{selected ? selected.split('/').pop() : '选择文件'}</span><DiffFileNavigation files={files} selected={selected} onSelect={onSelectFile} /></div>
      </div>
      <div className="diff-tools">{!combined && <><span className="diff-add">+{added}</span><span className="diff-remove">−{removed}</span></>}<i /><button className={`icon-button ${wrap ? 'active' : ''}`} aria-label="切换代码自动换行" title="自动换行" onClick={() => setWrap(value => !value)}><IconTextWrap size={16} /></button><button className="icon-button" disabled={!diff} title="复制 diff" aria-label="复制 diff" onClick={() => { void navigator.clipboard.writeText(diff).then(() => notify('Diff 已复制')).catch(() => notify('无法访问剪贴板', true)); }}><IconCopy size={16} /></button><button className="icon-button" aria-label="展开代码差异" title="展开代码差异" disabled={!selected} onClick={() => setExpanded(true)}><IconMaximize size={16} /></button></div>
    </div>
    <div className={`code-scroll diff-code-scroll ${wrap ? 'wrap-code' : ''}`} aria-label="文件差异" aria-busy={loading}>
      {showLoading ? <div className="diff-empty"><IconLoader2 size={24} className="spin" /><span>正在读取差异…</span></div> : error && !hasResult ? <div className="diff-empty"><IconX size={24} /><span>{error}</span></div> : !selected || !diff ? <div className="diff-empty"><IconCode size={30} stroke={1.3} /><strong>{selected ? '没有差异' : '选择一个文件'}</strong><span>{selected ? '可切换到工作区或暂存区查看更改。' : '从左侧文件列表查看更改。'}</span></div> : <UnifiedDiff interactive key={requestKey} diff={diff} onDiscardBlock={discardBlock} discardBlockDisabled={actions.busy || Boolean(error)} />}
    </div>
    <div className="diff-footer"><span><span className="tiny-dot" />{staged ? '已暂存的更改' : '未暂存的更改'}</span>{error && hasResult ? <span className="diff-refresh-error" role="status" title={error}>刷新失败，显示上次差异</span> : <span>UTF-8 <i /> {combined ? '冲突原始差异' : '统一视图'}</span>}</div>
    {expanded && selected && createPortal(<ExpandedDiff {...actions} snapshot={snapshot} selected={selected} staged={staged} compactDiff={diff} compactHasResult={hasResult} compactLoading={loading} compactError={error} onStagedChange={onStagedChange} onSelectFile={onSelectFile} notify={notify} onClose={() => setExpanded(false)} />, document.body)}
  </div>;
}
