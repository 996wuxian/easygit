import { IconArrowBackUp, IconGitCherryPick, IconLoader2 } from '@tabler/icons-react';
import type { CommitAction, GitCommit } from '../../services/git';
import { Dialog } from '../Dialog';

export type CommitDialogAction = CommitAction | 'cherry-pick';

export function CommitActionDialog({ commit, action, busy, stale, onCancel, onConfirm, targetBranch, disabledReason = '' }: {
  commit: GitCommit; action: CommitDialogAction; busy: boolean; stale: boolean;
  onCancel: () => void; onConfirm: () => void;
  targetBranch?: string; disabledReason?: string;
}) {
  const title = { soft: '撤回到暂存区', mixed: '撤回到工作区', revert: '创建反向提交', 'cherry-pick': '拣选提交' }[action];
  return <Dialog title={title} className="commit-action-dialog" onClose={() => { if (!busy) onCancel(); }}>
    <div className="commit-action-target">{action === 'cherry-pick' ? <IconGitCherryPick size={20} /> : <IconArrowBackUp size={20} />}<span><strong>{commit.subject}</strong><code>{commit.shortHash}</code></span></div>
    {action === 'cherry-pick' && <p className="dialog-description">目标分支：<code>{targetBranch}</code></p>}
    <p className="dialog-description">{action === 'soft'
      ? '撤回当前分支最新的提交，更改保留在暂存区，可修改后重新提交。现有未暂存更改会保留。'
      : action === 'mixed'
        ? '撤回当前分支最新的提交，更改保留在工作区。当前暂存区也会一起取消暂存，工作区文件内容会保留。'
        : action === 'cherry-pick'
          ? '将所选提交的更改应用到目标分支并创建新提交，保留来源提交标记。需要干净的工作区；遇到冲突后可解决并继续，也可跳过或取消。'
          : '创建一条新提交，抵消所选提交的更改，保留原提交与后续历史。需要干净的工作区；遇到冲突会尝试自动取消。'}</p>
    {stale && <p className="error-color" role="alert">当前分支或提交已变化，请取消后重新选择。</p>}
    {!stale && disabledReason && <p className="error-color" role="alert">{disabledReason}</p>}
    <div className="remove-workspace-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>取消</button><button className="primary-button" disabled={busy || stale || Boolean(disabledReason)} onClick={onConfirm}>{busy && <IconLoader2 size={15} className="spin" />}确认{title}</button></div>
  </Dialog>;
}
