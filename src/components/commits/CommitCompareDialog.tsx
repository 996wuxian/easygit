import { useEffect, useState } from 'react';
import { IconArrowsExchange } from '@tabler/icons-react';
import { git, type GitCommit, type RevisionComparison } from '../../services/git';
import { Dialog } from '../Dialog';
import { PatchView } from '../diff/PatchView';
import '../diff/inspection.css';

export function CommitCompareDialog({ path, base, target, onClose }: {
  path: string; base: GitCommit; target: GitCommit; onClose: () => void;
}) {
  const [reversed, setReversed] = useState(false);
  const [retry, setRetry] = useState(0);
  const left = reversed ? target : base;
  const right = reversed ? base : target;
  const key = JSON.stringify([path, left.hash, right.hash, retry]);
  const [result, setResult] = useState<{ key: string; comparison?: RevisionComparison; error?: string } | null>(null);
  const [selected, setSelected] = useState('');
  const [patch, setPatch] = useState<{ key: string; diff: string; error: string | null } | null>(null);
  const current = result?.key === key ? result : null;
  const comparison = current?.comparison;
  const loading = !current;
  const patchKey = JSON.stringify([key, selected]);
  useEffect(() => {
    let active = true;
    void git.compareCommits(path, left.hash, right.hash).then(next => {
      if (active) { setResult({ key, comparison: next }); setSelected(next.files[0]?.path ?? ''); }
    }).catch(error => { if (active) setResult({ key, error: String(error) }); });
    return () => { active = false; };
  }, [path, left.hash, right.hash, key]);
  useEffect(() => {
    if (!comparison || !selected || !comparison.files.some(file => file.path === selected)) return;
    let active = true;
    void git.comparisonDiff(path, comparison.base, comparison.target, selected).then(diff => {
      if (active) setPatch({ key: patchKey, diff, error: null });
    }).catch(error => { if (active) setPatch({ key: patchKey, diff: '', error: String(error) }); });
    return () => { active = false; };
  }, [path, comparison, selected, patchKey]);
  return <Dialog title="提交代码对比" className="inspection-dialog commit-compare-dialog" onClose={onClose}>
    <div className="commit-compare-controls">
      <div><span>基准提交</span><code>{left.shortHash}</code><strong>{left.subject}</strong></div>
      <button className="secondary-button" onClick={() => setReversed(value => !value)} aria-label="交换对比方向"><IconArrowsExchange size={16} />交换方向</button>
      <div><span>目标提交</span><code>{right.shortHash}</code><strong>{right.subject}</strong></div>
    </div>
    <p className="dialog-description">显示基准提交到目标提交的累计文件变化，包含两个提交之间的最终内容差异。</p>
    <div className="inspection-meta" role="status"><code>{left.shortHash} → {right.shortHash}</code><span>{loading ? '正在比较…' : comparison ? `${comparison.files.length} 个变化文件` : '对比失败'}</span></div>
    {current?.error && <div className="commit-compare-error" role="alert">{current.error}<button className="text-button" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
    <div className="inspection-body"><div className="inspection-files" aria-label="提交对比变化文件">
      {comparison?.files.map(file => <button key={file.path} className={selected === file.path ? 'active' : ''} aria-pressed={selected === file.path} onClick={() => setSelected(file.path)}>{file.path}<small>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.status}</small></button>)}
      {!comparison?.files.length && <div className="inspection-state">{loading ? '正在读取变化文件…' : current?.error ? '无法读取变化文件' : '两个提交的文件内容相同'}</div>}
    </div><PatchView diff={!loading && comparison && patch?.key === patchKey ? patch.diff : ''} error={current?.error ?? (comparison && patch?.key === patchKey ? patch.error : null)} loading={loading || Boolean(comparison?.files.length && patch?.key !== patchKey)} /></div>
  </Dialog>;
}
