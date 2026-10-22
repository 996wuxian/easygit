import { useEffect, useRef, useState } from 'react';
import { git, type GitBranch, type RevisionComparison } from '../../services/git';
import { Dialog } from '../Dialog';
import { PatchView } from '../diff/PatchView';

const key = (branch: GitBranch) => JSON.stringify([branch.remote, branch.name]);

export function BranchCompareDialog({ path, branches, onClose }: { path: string; branches: GitBranch[]; onClose: () => void }) {
  const current = branches.find(branch => branch.current) ?? branches[0];
  const [base, setBase] = useState(current ? key(current) : '');
  const [target, setTarget] = useState(() => {
    const other = branches.find(branch => key(branch) !== base);
    return other ? key(other) : '';
  });
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patch, setPatch] = useState({ diff: '', loading: false, error: null as string | null });
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const reset = () => { request.current++; setComparison(null); setSelected(''); setError(null); setLoading(false); };
  async function compare() {
    const left = branches.find(branch => key(branch) === base); const right = branches.find(branch => key(branch) === target);
    if (!left || !right || base === target) return;
    const token = ++request.current; setComparison(null); setSelected(''); setLoading(true); setError(null);
    try {
      const next = await git.compareBranches(path, left, right);
      if (request.current === token) { setComparison(next); setSelected(next.files[0]?.path ?? ''); }
    } catch (reason) { if (request.current === token) setError(String(reason)); }
    finally { if (request.current === token) setLoading(false); }
  }
  useEffect(() => {
    if (!comparison || !selected) { setPatch({ diff: '', loading: false, error: null }); return; }
    let active = true; setPatch({ diff: '', loading: true, error: null });
    void git.comparisonDiff(path, comparison.base, comparison.target, selected).then(diff => { if (active) setPatch({ diff, loading: false, error: null }); }).catch(reason => { if (active) setPatch({ diff: '', loading: false, error: String(reason) }); });
    return () => { active = false; };
  }, [path, comparison, selected]);
  return <Dialog title="分支代码对比" className="inspection-dialog" onClose={onClose}>
    <p className="dialog-description">查看从基准分支到对比分支的文件与代码变化，保持当前工作区。结果以点击比较时的提交为准。</p>
    <div className="comparison-controls"><label>基准分支<select value={base} onChange={event => { reset(); setBase(event.target.value); }}>{branches.map(branch => <option key={key(branch)} value={key(branch)}>{branch.remote ? '远程' : '本地'} · {branch.name}</option>)}</select></label><label>对比分支<select value={target} onChange={event => { reset(); setTarget(event.target.value); }}>{branches.map(branch => <option key={key(branch)} value={key(branch)}>{branch.remote ? '远程' : '本地'} · {branch.name}</option>)}</select></label><button className="primary-button" disabled={loading || !base || !target || base === target} onClick={() => { void compare(); }}>{loading ? '正在比较…' : '比较'}</button></div>
    {error && <p className="error-color" role="alert">{error}</p>}
    {comparison && <div className="inspection-meta"><code>{comparison.base.slice(0, 12)} → {comparison.target.slice(0, 12)}</code><span>{comparison.files.length} 个变化文件</span></div>}
    <div className="inspection-body"><div className="inspection-files" aria-label="分支变化文件">{comparison?.files.map(file => <button key={file.path} className={selected === file.path ? 'active' : ''} aria-pressed={selected === file.path} onClick={() => setSelected(file.path)}>{file.path}<small>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.status}</small></button>)}{!comparison?.files.length && <div className="inspection-state">{comparison ? '两个分支没有文件差异' : '选择两个分支后点击比较'}</div>}</div><PatchView {...patch} loading={loading || patch.loading} /></div>
  </Dialog>;
}
