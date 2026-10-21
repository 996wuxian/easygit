import { useEffect, useState } from 'react';
import { IconCopy, IconFileCode, IconLoader2, IconTextWrap, IconX } from '@tabler/icons-react';
import { git, type FileComparison, type RepositorySnapshot } from '../../services/git';
import { Dialog } from '../Dialog';
import { ComparisonFileSelect } from './ComparisonFileSelect';
import { SplitDiff } from './SplitDiff';
import { UnifiedDiff } from './UnifiedDiff';
import { countDiffChanges } from './model';
import './diff.css';

type ComparisonState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready' | 'refreshing'; data: FileComparison }
  | { key: string; status: 'error'; error: string };

export function ExpandedDiff({ snapshot, selected, staged, compactDiff, compactLoading, compactError, onStagedChange, onSelectFile, onClose, notify }: {
  snapshot: RepositorySnapshot; selected: string; staged: boolean;
  compactDiff: string; compactLoading: boolean; compactError: string;
  onStagedChange: (staged: boolean) => void; onSelectFile?: (path: string) => void;
  onClose: () => void; notify: (message: string, error?: boolean) => void;
}) {
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const [wrap, setWrap] = useState(false);
  const [result, setResult] = useState<ComparisonState | null>(null);
  const requestKey = JSON.stringify([snapshot.path, selected, staged]);
  useEffect(() => {
    let cancelled = false;
    setResult(current => current?.key === requestKey && 'data' in current
      ? { key: requestKey, status: 'refreshing', data: current.data }
      : { key: requestKey, status: 'loading' });
    void git.comparison(snapshot.path, selected, staged).then(data => {
      if (!cancelled) setResult({ key: requestKey, status: 'ready', data });
    }).catch(error => {
      if (!cancelled) setResult({ key: requestKey, status: 'error', error: String(error) });
    });
    return () => { cancelled = true; };
  }, [snapshot, selected, staged, requestKey]);
  useEffect(() => {
    const guard = (event: KeyboardEvent) => {
      if (((event.ctrlKey || event.metaKey) && ['k', 'o'].includes(event.key.toLowerCase())) || event.key === '/') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, []);

  const current = result?.key === requestKey ? result : null;
  const comparison = current && 'data' in current ? current.data : null;
  const loading = !current || current.status === 'loading' || current.status === 'refreshing';
  const error = current?.status === 'error' ? current.error : '';
  const selectedFile = snapshot.files.find(file => file.path === selected);
  const originalPath = staged || selectedFile?.worktreeStatus === 'R' ? selectedFile?.oldPath ?? selected : selected;
  const originalLabel = staged ? 'HEAD' : selectedFile?.conflicted ? '当前分支' : '暂存区';
  const modifiedLabel = staged ? '暂存区' : '工作区';
  const { added, removed } = countDiffChanges(mode === 'split' && comparison ? comparison.diff : compactDiff);

  return <Dialog title="代码差异 · 全屏" className="diff-fullscreen-dialog" hideHeading onClose={onClose}>
    <div className="expanded-diff-toolbar">
      <ComparisonFileSelect files={snapshot.files} selected={selected} onSelect={onSelectFile} />
      <div className="diff-toolbar">
        <div className="segmented"><button className={!staged ? 'active' : ''} onClick={() => onStagedChange(false)}>工作区</button><button className={staged ? 'active' : ''} onClick={() => onStagedChange(true)}>暂存区</button></div>
        <div className="segmented comparison-modes"><button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>左右比对</button><button className={mode === 'unified' ? 'active' : ''} onClick={() => setMode('unified')}>统一视图</button></div>
        <div className="diff-tools"><span className="diff-add">+{added}</span><span className="diff-remove">−{removed}</span>
          {mode === 'unified' && <button className={`icon-button ${wrap ? 'active' : ''}`} aria-label="切换代码自动换行" title="自动换行" onClick={() => setWrap(value => !value)}><IconTextWrap size={16} /></button>}
          <button className="icon-button" aria-label="复制 diff" title="复制 diff" disabled={!compactDiff} onClick={() => { void navigator.clipboard.writeText(compactDiff).then(() => notify('Diff 已复制')).catch(() => notify('无法访问剪贴板', true)); }}><IconCopy size={16} /></button>
          <button className="icon-button" aria-label="退出全屏差异" title="退出全屏（Esc）" onClick={onClose}><IconX size={18} /></button>
        </div>
      </div>
    </div>
    <div className="expanded-diff-body" aria-busy={mode === 'split' ? loading : compactLoading}>
      {mode === 'unified' ? <div className={`code-scroll ${wrap ? 'wrap-code' : ''}`}>
        {compactError ? <div className="diff-empty"><IconX size={24} /><span>{compactError}</span></div> : compactLoading && !compactDiff ? <div className="diff-empty"><IconLoader2 className="spin" size={24} /><span>正在读取差异…</span></div> : compactDiff ? <UnifiedDiff diff={compactDiff} /> : <div className="diff-empty"><span>当前分区没有差异</span></div>}
      </div> : error || comparison?.binary ? <div className="diff-empty"><IconFileCode size={28} /><span>{error || '二进制或非 UTF-8 文件无法进行源码比对。'}</span><button className="text-button" onClick={() => setMode('unified')}>查看统一差异视图</button></div> : !comparison ? <div className="diff-empty"><IconLoader2 size={24} className="spin" /><span>正在读取完整源码…</span></div> : <SplitDiff key={requestKey} comparison={comparison} originalLabel={originalLabel} modifiedLabel={modifiedLabel} originalPath={originalPath} modifiedPath={selected} />}
    </div>
    <div className="diff-footer"><span>{mode === 'split' ? '完整源码 · 左右同步滚动' : '统一差异视图'}</span><span><kbd>Esc</kbd>退出全屏</span></div>
  </Dialog>;
}
