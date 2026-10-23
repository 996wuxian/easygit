import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowBackUp, IconCopy, IconFileText, IconInfoCircle, IconRestore, IconGitCompare, IconFlag, IconX } from '@tabler/icons-react';
import type { CommitAction, GitCommit, RepositorySnapshot } from '../../services/git';
import { commitActionReason } from './model';

export function CommitContextMenu({ commit, snapshot, x, y, busy, onClose, onSelect, onAction, notify, compareBase, onMarkBase, onCompare, onClearBase }: {
  commit: GitCommit; snapshot: RepositorySnapshot; x: number; y: number; busy: boolean;
  onClose: () => void; onSelect: () => void; onAction: (action: CommitAction) => void;
  notify: (message: string, error?: boolean) => void;
  compareBase?: GitCommit | null; onMarkBase?: () => void; onCompare?: () => void; onClearBase?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const root = rootRef.current;
    const previous = document.activeElement as HTMLElement | null;
    if (root) {
      setPosition({ left: Math.max(8, Math.min(x, innerWidth - root.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - root.offsetHeight - 8)) });
      root.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    }
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [x, y]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const copy = (text: string, label: string) => {
    onClose();
    void navigator.clipboard.writeText(text).then(() => notify(`${label}已复制`)).catch(() => notify('无法访问剪贴板', true));
  };
  const items = [
    { action: 'soft', label: '撤回到暂存区…', icon: IconArrowBackUp },
    { action: 'mixed', label: '撤回到工作区…', icon: IconArrowBackUp },
    { action: 'revert', label: '反向提交（保留历史）…', icon: IconRestore },
  ] as const;
  return createPortal(<div className="commit-context-menu" role="menu" aria-label="提交操作" ref={rootRef} style={position}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    <div className="commit-context-heading"><code>{commit.shortHash}</code><span>{commit.subject}</span></div>
    <button role="menuitem" onClick={() => { onClose(); onSelect(); }}><IconInfoCircle size={15} />查看提交详情</button>
    {onMarkBase && <>
      <button role="menuitem" disabled={compareBase?.hash === commit.hash} onClick={() => { onClose(); onMarkBase(); }}><IconFlag size={15} />设为对比基准</button>
      <button role="menuitem" disabled={!compareBase || compareBase.hash === commit.hash} onClick={() => { onClose(); onCompare?.(); }}><IconGitCompare size={15} />与基准提交对比…</button>
      {compareBase && <button role="menuitem" onClick={() => { onClose(); onClearBase?.(); }}><IconX size={15} />清除对比基准</button>}
      <div className="commit-context-divider" role="separator" />
    </>}
    <button role="menuitem" onClick={() => copy(commit.subject, '提交信息')}><IconFileText size={15} />复制提交信息</button>
    <button role="menuitem" onClick={() => copy(commit.hash, '完整 SHA')}><IconCopy size={15} />复制完整 SHA</button>
    <button role="menuitem" onClick={() => copy(commit.shortHash, '短 SHA')}><IconCopy size={15} />复制短 SHA</button>
    <div className="commit-context-divider" role="separator" />
    {items.map(({ action, label, icon: Icon }) => {
      const reason = busy ? '仓库操作正在进行中' : commitActionReason(snapshot, commit, action);
      return <button role="menuitem" key={action} disabled={Boolean(reason)} title={reason || label} onClick={() => { onClose(); onAction(action); }}><Icon size={15} />{label}</button>;
    })}
    <div className="commit-context-note">{commitActionReason(snapshot, commit, 'soft') || '撤回会保留工作区文件，操作前需要确认'}</div>
  </div>, document.body);
}
