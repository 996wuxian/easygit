import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { Dialog } from './Dialog';

export function DiscardChangesDialog({ files, untrackedFiles, scope, busy, onCancel, onConfirm }: {
  files: string[]; untrackedFiles: string[]; scope: 'file' | 'all' | 'selection'; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const isAll = scope === 'all';
  const title = isAll ? '撤回全部未暂存更改' : scope === 'selection' ? '撤回所选文件更改' : '撤回更改';
  return <Dialog title={title} onClose={onCancel} className="discard-changes-dialog">
    <div className="discard-changes-warning"><IconAlertTriangle size={19} /><p>{isAll ? `确定撤回全部 ${files.length} 个文件中的未暂存更改吗？` : scope === 'selection' ? `确定撤回所选 ${files.length} 个文件中的未暂存更改吗？` : `确定撤回 ${files[0]} 中的未暂存更改吗？`}</p></div>
    {scope !== 'file' && <div className="discard-changes-list" aria-label="将撤回的文件">{files.map(file => <code key={file}>{file}</code>)}</div>}
    <p className="discard-changes-note">已暂存的内容会保留。{untrackedFiles.length > 0 && <>以下未跟踪文件也会被删除：<code>{untrackedFiles.join('、')}</code>。</>}此操作无法通过 Git 恢复。</p>
    <div className="remove-workspace-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button discard-confirm-button" disabled={busy} onClick={onConfirm}><IconTrash size={15} />确认撤回</button></div>
  </Dialog>;
}
