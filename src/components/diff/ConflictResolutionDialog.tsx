import { useEffect, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconLoader2, IconRefresh } from '@tabler/icons-react';
import { git, type ConflictFile, type ConflictResolution } from '../../services/git';
import { Dialog } from '../Dialog';
import { ConflictVersions } from './ConflictVersions';
import { ConflictBlockDiff } from './ConflictBlockDiff';
import { acceptConflictBlock, hasConflictMarkers, parseConflictBlocks } from './conflicts';
import './diff.css';

export function ConflictResolutionDialog({ path, file, operation, busy, onResolve, onClose }: {
  path: string; file: string; operation: string | null; busy: boolean;
  onResolve: (file: string, revision: string, resolution: ConflictResolution, content?: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [data, setData] = useState<ConflictFile | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState('');
  const [resolution, setResolution] = useState<ConflictResolution | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  const dirty = data && (content !== (data.working ?? '') || resolution !== (data.binary || !data.workingExists ? null : 'content'));
  const close = () => { if (!locked) { if (dirty) setConfirmClose(true); else onClose(); } };

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    void git.conflict(path, file).then(result => {
      if (cancelled) return;
      setData(result);
      setContent(result.working ?? '');
      setResolution(result.binary || !result.workingExists ? null : 'content');
    }).catch(error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [path, file, attempt]);

  const blocks = parseConflictBlocks(content, data?.markerSize);
  const unresolved = hasConflictMarkers(content, data?.markerSize);
  const workingUnresolved = hasConflictMarkers(data?.working ?? '', data?.markerSize);
  const canSave = data && resolution && !locked
    && !(resolution === 'content' && unresolved)
    && !(resolution === 'working' && workingUnresolved);
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      if (await onResolve(file, data.revision, resolution, resolution === 'content' ? content : undefined)) onClose();
      else setError('未能保存解决结果，请查看错误提示。若文件已变化，可重新打开以读取最新内容。');
    } catch (error) { setError(String(error)); }
    finally { setSaving(false); }
  };

  return <Dialog title="解决文件冲突" className="conflict-resolution-dialog" onClose={close}>
    <div className="conflict-dialog-body">
    <div className="conflict-file-heading"><IconAlertTriangle size={17} /><code title={file}>{file}</code><span>{operation ?? '冲突'}</span></div>
    {operation === 'rebase' && <p className="conflict-help">Rebase 期间，当前版本（ours）是变基目标，传入版本（theirs）是正在重放的提交。</p>}
    {error && <div className="conflict-error" role="alert">{error}{!data && <button className="text-button" onClick={() => setAttempt(value => value + 1)}><IconRefresh size={14} />重试读取</button>}</div>}
    {!data ? !error && <div className="diff-empty"><IconLoader2 size={24} className="spin" /><span>正在读取冲突版本…</span></div> : <>
      <ConflictVersions data={data} resolution={resolution} locked={locked} onChoose={setResolution} />
      <div className="conflict-result-heading"><h3>合并结果</h3><div>
        {!data.binary && <button className="text-button" aria-pressed={resolution === 'content'} disabled={locked} onClick={() => setResolution('content')}>编辑合并结果</button>}
        {!data.binary && data.workingExists && <button className="text-button" aria-pressed={resolution === 'working'} disabled={locked || workingUnresolved} title={workingUnresolved ? '工作区仍包含冲突标记' : '使用已在外部编辑器解决的工作区文件'} onClick={() => setResolution('working')}>保留工作区文件</button>}
        <button className="text-button" aria-pressed={resolution === 'delete'} disabled={locked} onClick={() => setResolution('delete')}>删除文件</button>
      </div></div>
      {resolution === 'content' && <>
        {blocks.length > 0 && <div className="conflict-blocks" aria-label="待处理冲突块">{blocks.map((block, index) => <section className="conflict-block" key={`${block.start}-${index}`}>
          <div><strong>冲突块 {index + 1}</strong><div>{(['ours', 'theirs', 'both'] as const).map((side, choice) => <button className="text-button" key={side} disabled={locked} aria-label={`冲突块 ${index + 1} ${['使用当前', '使用传入', '保留双方'][choice]}`} onClick={() => setContent(value => acceptConflictBlock(value, block, side))}>{['使用当前', '使用传入', '保留双方'][choice]}</button>)}</div></div>
          <ConflictBlockDiff block={block} number={index + 1} />
        </section>)}</div>}
        <textarea className="conflict-result-editor" aria-label="编辑合并结果" spellCheck={false} value={content} disabled={locked} onChange={event => setContent(event.target.value)} />
        <p className="conflict-help">{unresolved ? `仍有未处理的冲突标记${blocks.length ? `（${blocks.length} 个冲突块）` : ''}，请逐块选择或手动编辑。` : '冲突标记已清除，可以保存。'} 保留双方时按当前版本、传入版本的顺序拼接。</p>
      </>}
      {resolution !== 'content' && <p className="conflict-help" role="status">{resolution === 'ours' ? data.oursExists ? '将用当前版本替换整个文件，包括冲突块以外的内容。' : '当前版本中此文件已被删除，保存后会删除工作区文件。' : resolution === 'theirs' ? data.theirsExists ? '将用传入版本替换整个文件，包括冲突块以外的内容。' : '传入版本中此文件已被删除，保存后会删除工作区文件。' : resolution === 'delete' ? '保存后会删除此文件，并将删除作为解决结果暂存。' : resolution === 'working' ? '将保留当前工作区文件，并标记已解决。' : '请选择要保留的版本或删除文件。'}</p>}
      <p className="conflict-help">保存后会将此文件暂存。全部冲突处理完成后，可继续提交或完成当前 Git 操作。</p>
    </>}
    </div>
    <div className="conflict-dialog-actions"><button className="secondary-button" disabled={locked} onClick={close}>取消</button><button className="primary-button" disabled={!canSave} onClick={() => { void save(); }}>{locked ? <IconLoader2 className="spin" size={15} /> : <IconCheck size={15} />}保存并标记已解决</button></div>
    {confirmClose && <div className="conflict-close-confirmation" role="alert"><span>放弃尚未保存的解决结果？</span><button className="secondary-button" onClick={() => setConfirmClose(false)}>继续编辑</button><button className="secondary-button" onClick={onClose}>放弃编辑</button></div>}
  </Dialog>;
}
