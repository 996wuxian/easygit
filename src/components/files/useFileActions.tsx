import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCopy, IconFolderOpen, IconLink, IconTrash } from '@tabler/icons-react';
import { project } from '../../services/project';
import { ContextMenu } from '../ContextMenu';
import { Dialog } from '../Dialog';

type Entry = { path: string; directory: boolean };
export interface FileActionsProps {
  busy?: boolean;
  notify?: (message: string, error?: boolean) => void;
  onDelete?: (file: string, directory: boolean) => Promise<boolean>;
}

export function useFileActions(repository: string, props: FileActionsProps, onRefresh: () => void) {
  const [menu, setMenu] = useState<(Entry & { x: number; y: number }) | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const notify = (text: string, error = false) => props.notify ? props.notify(text, error) : setMessage({ text, error });
  const execute = async (entry: Entry, action: 'reveal' | 'relative' | 'absolute' | 'copy') => {
    setMenu(null); setWorking(true);
    try {
      if (action === 'reveal') await project.revealEntry(repository, entry.path);
      else if (action === 'copy') { await project.copyEntry(repository, entry.path); notify('已复制，可在资源管理器中粘贴'); }
      else {
        const path = action === 'relative' ? entry.path : await project.entryPath(repository, entry.path);
        await navigator.clipboard.writeText(path);
        notify(action === 'relative' ? '已复制项目相对路径' : '已复制绝对路径');
      }
    } catch (error) { notify(`操作失败：${error instanceof Error ? error.message : String(error)}`, true); }
    finally { setWorking(false); }
  };
  const confirmDelete = async () => {
    if (!deleting || !props.onDelete || props.busy || working) return;
    const entry = deleting;
    // Close this confirmation before the editor's unsaved-changes guard appears.
    setDeleting(null); setWorking(true);
    try { if (await props.onDelete(entry.path, entry.directory)) onRefresh(); }
    catch (error) { notify(`删除失败：${String(error)}`, true); }
    finally { setWorking(false); }
  };
  return {
    open: (entry: Entry, x: number, y: number) => { if (!working) { setMessage(null); setMenu({ ...entry, x, y }); } },
    feedback: message && <div className="files-message" role={message.error ? 'alert' : 'status'}>{message.text}</div>,
    overlays: <>
      {menu && <ContextMenu x={menu.x} y={menu.y} label="项目文件操作" onClose={() => setMenu(null)}>
        <div className="context-menu-heading">{menu.path}</div>
        <button type="button" role="menuitem" onClick={() => { void execute(menu, 'reveal'); }}><IconFolderOpen size={16} />打开文件所在位置</button>
        <button type="button" role="menuitem" onClick={() => { void execute(menu, 'relative'); }}><IconLink size={16} />复制路径</button>
        <button type="button" role="menuitem" onClick={() => { void execute(menu, 'absolute'); }}><IconLink size={16} />复制绝对路径</button>
        <button type="button" role="menuitem" onClick={() => { void execute(menu, 'copy'); }}><IconCopy size={16} />复制</button>
        <div className="context-menu-divider" role="separator" />
        <button type="button" role="menuitem" className="danger-action" disabled={props.busy || !props.onDelete} onClick={() => { setDeleting(menu); setMenu(null); }}><IconTrash size={16} />删除</button>
      </ContextMenu>}
      {deleting && createPortal(<Dialog title={deleting.directory ? '删除目录' : '删除文件'} onClose={() => setDeleting(null)}>
        <p className="dialog-description">确定删除 <code>{deleting.path}</code> 吗？{deleting.directory && '目录及其中所有文件将一并删除。'}文件将通过系统回收站删除。</p>
        <div className="remove-workspace-actions"><button className="secondary-button" autoFocus onClick={() => setDeleting(null)}>取消</button><button className="primary-button discard-confirm-button" disabled={props.busy || working} onClick={() => { void confirmDelete(); }}><IconTrash size={15} />确认删除</button></div>
      </Dialog>, document.body)}
    </>,
  };
}
