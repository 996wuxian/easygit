import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowRight, IconCopy, IconEdit, IconLink, IconTrash, IconUnlink } from '@tabler/icons-react';
import type { BranchRequest, GitBranch, RepositorySnapshot } from '../../services/git';
import { ContextMenu } from '../ContextMenu';
import { BranchActionDialog, type BranchActionKind } from './BranchActionDialog';

export function useBranchManagement({ snapshot, busy, onCheckout, onBranchAction, notify }: {
  snapshot: RepositorySnapshot; busy: boolean; onCheckout: (name: string, remote: boolean) => void;
  onBranchAction?: (path: string, request: BranchRequest) => Promise<boolean>;
  notify?: (message: string, error?: boolean) => void;
}) {
  const [menu, setMenu] = useState<{ branch: GitBranch; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ branch: string; kind: BranchActionKind; defaultUpstream?: string } | null>(null);
  useEffect(() => { setMenu(null); setDialog(null); }, [snapshot.path]);
  useEffect(() => { setMenu(null); }, [snapshot.branch, snapshot.head]);
  const locked = busy || Boolean(snapshot.operation) || snapshot.files.some(file => file.conflicted);
  const noLocal = !snapshot.head || !snapshot.branch || snapshot.branch.startsWith('detached@');
  const request = (kind: BranchActionKind) => {
    if (!menu) return;
    setDialog({ branch: menu.branch.remote ? snapshot.branch : menu.branch.name, kind, defaultUpstream: menu.branch.remote ? menu.branch.name : undefined });
    setMenu(null);
  };
  const openMenu = (branch: GitBranch, x: number, y: number) => setMenu({ branch, x, y });
  return {
    openMenu,
    content: <>
      {menu && <ContextMenu x={menu.x} y={menu.y} label="分支操作" onClose={() => setMenu(null)}>
        <div className="context-menu-heading">{menu.branch.remote ? '远程' : '本地'} · {menu.branch.name}</div>
        <button role="menuitem" disabled={locked || menu.branch.current} onClick={() => { onCheckout(menu.branch.name, menu.branch.remote); setMenu(null); }}><IconArrowRight size={15} />切换到此分支</button>
        <button role="menuitem" onClick={() => {
          const name = menu.branch.name; setMenu(null);
          void navigator.clipboard.writeText(name).then(() => notify?.('分支名已复制')).catch(() => notify?.('无法访问剪贴板', true));
        }}><IconCopy size={15} />复制分支名称</button>
        {onBranchAction && <>
          <div className="context-menu-divider" role="separator" />
          {!menu.branch.remote && <button role="menuitem" disabled={locked} onClick={() => request('rename')}><IconEdit size={15} />重命名分支…</button>}
          <button role="menuitem" disabled={locked || (menu.branch.remote && noLocal) || !snapshot.branches.some(branch => branch.remote)} onClick={() => request('upstream')}><IconLink size={15} />{menu.branch.remote ? '设为当前分支的上游…' : '设置上游分支…'}</button>
          {!menu.branch.remote && <>
            <button role="menuitem" disabled={locked} onClick={() => request('unset-upstream')}><IconUnlink size={15} />取消上游分支…</button>
            <div className="context-menu-divider" role="separator" />
            <button role="menuitem" className="danger-action" disabled={locked || menu.branch.current} onClick={() => request('delete')}><IconTrash size={15} />删除本地分支…</button>
          </>}
          <div className="context-menu-note">{locked ? '请先完成当前仓库操作或冲突处理' : menu.branch.current ? '当前分支可重命名，切换到其他分支后才能删除' : menu.branch.remote ? `设置上游会修改本地 ${snapshot.branch || '当前分支'} 的跟踪关系` : '删除前将检查合并状态和 worktree 占用'}</div>
        </>}
      </ContextMenu>}
      {dialog && onBranchAction && createPortal(<BranchActionDialog {...dialog} snapshot={snapshot} busy={busy} onAction={onBranchAction} onClose={() => setDialog(null)} />, document.body)}
    </>,
  };
}
