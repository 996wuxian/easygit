import { useState } from 'react';
import type { OperationAction, OperationRequest, RepositorySnapshot } from '../services/git';
import { Dialog } from './Dialog';
import './diff/inspection.css';

export function OperationBanner({ snapshot, busy, onAction }: { snapshot: RepositorySnapshot; busy: boolean; onAction: (request: OperationRequest) => Promise<boolean> }) {
  const [confirmation, setConfirmation] = useState<OperationRequest | null>(null);
  const kind = snapshot.operation;
  if (!kind) return null;
  const supported = ['merge', 'rebase', 'cherry-pick', 'revert'].includes(kind);
  const conflicted = snapshot.files.some(file => file.conflicted);
  const emptyCherryPick = kind === 'cherry-pick' && !conflicted && !snapshot.files.some(file => file.staged);
  const ready = supported && Boolean(snapshot.operationToken && snapshot.revision);
  const request = (action: OperationAction): OperationRequest => ({ operation: kind, token: snapshot.operationToken ?? '', revision: snapshot.revision ?? '', head: snapshot.head, branch: snapshot.branch, action });
  const stale = confirmation && (confirmation.revision !== snapshot.revision || confirmation.token !== snapshot.operationToken);
  return <>
    <div className="operation-banner" role="status"><div><strong>正在进行 {kind}</strong><p>{conflicted ? '先解决冲突并暂存，再继续操作。' : emptyCherryPick ? '拣选没有产生可提交的更改，可能已包含相同修改。可跳过当前提交，或取消操作。' : supported ? '可继续完成当前操作，或取消并返回操作前状态。' : '请使用外部 Git 工具完成当前操作。'}</p></div>{supported && <div className="operation-actions"><button className="primary-button" disabled={busy || !ready || conflicted || emptyCherryPick} onClick={() => { void onAction(request('continue')); }}>{kind === 'merge' ? '完成合并' : '继续操作'}</button>{kind !== 'merge' && <button className="secondary-button" disabled={busy || !ready} onClick={() => setConfirmation(request('skip'))}>跳过当前提交</button>}<button className="secondary-button" disabled={busy || !ready} onClick={() => setConfirmation(request('abort'))}>{kind === 'merge' ? '取消合并' : '取消操作'}</button></div>}</div>
    {confirmation && <Dialog title={confirmation.action === 'abort' ? '取消当前 Git 操作' : '跳过当前提交'} onClose={() => { if (!busy) setConfirmation(null); }}><p className="dialog-description">{confirmation.action === 'abort' ? `将取消 ${confirmation.operation} 并尝试恢复操作前状态。Git 会在无法安全恢复时拒绝操作。` : '将放弃当前正在重放的这条提交，继续处理后续提交。'}</p>{stale && <p className="error-color" role="alert">仓库状态已变化，请取消后重新操作。</p>}<div className="dialog-action-row"><button className="secondary-button" disabled={busy} onClick={() => setConfirmation(null)}>返回</button><button className="primary-button" disabled={busy || Boolean(stale)} onClick={() => { void onAction(confirmation).then(success => { if (success) setConfirmation(null); }); }}>确认{confirmation.action === 'abort' ? '取消操作' : '跳过提交'}</button></div></Dialog>}
  </>;
}
