import { useEffect, useState } from 'react';
import { IconCopy } from '@tabler/icons-react';
import { git, type GitCommit } from '../../services/git';
import { Dialog } from '../Dialog';
import { PatchView } from '../diff/PatchView';
import { CommitRefs } from './CommitsPanel';

export function CommitDetailsDialog({ path, commit, status, notify, onClose }: { path: string; commit: GitCommit; status: string; notify: (message: string, error?: boolean) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [patch, setPatch] = useState<{ diff: string; error: string | null; loading: boolean }>({ diff: '', error: null, loading: false });
  useEffect(() => {
    let active = true;
    void git.commitFiles(path, commit.hash).then(next => { if (active) { setFiles(next); setSelected(next[0] ?? ''); } }).catch(error => { if (active) setFileError(String(error)); });
    return () => { active = false; };
  }, [path, commit.hash]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setPatch({ diff: '', error: null, loading: true });
    void git.commitDiff(path, commit.hash, selected).then(diff => { if (active) setPatch({ diff, error: null, loading: false }); }).catch(error => { if (active) setPatch({ diff: '', error: String(error), loading: false }); });
    return () => { active = false; };
  }, [path, commit.hash, selected]);
  return <Dialog title="提交详情" className="inspection-dialog commit-detail" onClose={onClose}>
    <h3 className="commit-detail-heading" title={commit.subject}>{commit.subject}</h3>
    <CommitRefs commit={commit} />
    <div className="inspection-meta"><span>{commit.author} · {new Date(commit.date).toLocaleString('zh-CN')}</span><span>{status}</span><code>{commit.hash}</code><button className="icon-button" aria-label="复制提交 SHA" onClick={() => { void navigator.clipboard.writeText(commit.hash).then(() => notify('Commit SHA 已复制')).catch(() => notify('无法访问剪贴板', true)); }}><IconCopy size={15} /></button></div>
    {commit.parents.length > 1 && <p className="dialog-description">合并提交，显示相对第一父提交的代码变化。</p>}
    <div className="inspection-body"><div className="inspection-files" aria-label="提交涉及的文件">
      {fileError ? <p role="alert">{fileError}</p> : files === null ? <div className="inspection-state">正在读取文件列表…</div> : files.length ? files.map(file => <button key={file} className={file === selected ? 'active' : ''} aria-pressed={file === selected} onClick={() => setSelected(file)}>{file}</button>) : <div className="inspection-state">此提交没有文件差异。</div>}
    </div><PatchView {...patch} /></div>
  </Dialog>;
}
