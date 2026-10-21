import { IconFolder, IconTrash } from '@tabler/icons-react';
import type { RecentRepository } from '../services/useRepository';
import { Dialog } from './Dialog';

export function RemoveWorkspaceDialog({ workspace, busy, onCancel, onConfirm }: {
  workspace: RecentRepository; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <Dialog title="移除工作区" onClose={onCancel} className="remove-workspace-dialog">
    <p className="dialog-description">确定从 easygit 移除这个工作区吗？</p>
    <div className="remove-workspace-target"><IconFolder size={22} /><div><strong>{workspace.name}</strong><small>{workspace.path}</small></div></div>
    <p className="remove-workspace-note">移除后，侧栏和最近打开列表将不再显示此项目。本地文件、Git 仓库及未提交的更改都会保留，你可以随时重新打开。</p>
    <div className="remove-workspace-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button remove-workspace-confirm" disabled={busy} onClick={onConfirm}><IconTrash size={15} />确认移除</button></div>
  </Dialog>;
}
