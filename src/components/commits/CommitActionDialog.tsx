import { IconArrowBackUp, IconLoader2 } from '@tabler/icons-react';
import type { CommitAction, GitCommit } from '../../services/git';
import { Dialog } from '../Dialog';

export function CommitActionDialog({ commit, action, busy, stale, onCancel, onConfirm }: {
  commit: GitCommit; action: CommitAction; busy: boolean; stale: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const title = action === 'soft' ? '撤回到暂存区' : action === 'mixed' ? '撤回到工作区' : '创建反向提交';
  return <Dialog title={title} className="commit-action-dialog" onClose={() => { if (!busy) onCancel(); }}>
    <div className="commit-action-target"><IconArrowBackUp size={20} /><span><strong>{commit.subject}</strong><code>{commit.shortHash}</code></span></div>
    <p className="dialog-description">{action === 'soft'
      ? '撤回当前分支最新的提交，更改保留在暂存区，可修改后重新提交。现有未暂存更改会保留。'
      : action === 'mixed'
        ? '撤回当前分支最新的提交，更改保留在工作区。当前暂存区也会一起取消暂存，工作区文件内容会保留。'
        : '创建一条新提交，抵消所选提交的更改，保留原提交与后续历史。需要干净的工作区；遇到冲突会尝试自动取消。'}</p>
    {stale && <p className="error-color" role="alert">当前分支或提交已变化，请取消后重新选择。</p>}
    <div className="remove-workspace-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>取消</button><button className="primary-button" disabled={busy || stale} onClick={onConfirm}>{busy && <IconLoader2 size={15} className="spin" />}确认{title}</button></div>
  </Dialog>;
}
