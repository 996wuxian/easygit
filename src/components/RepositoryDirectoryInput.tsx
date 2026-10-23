import { useEffect, useRef, useState } from 'react';
import { IconFolderOpen, IconLoader2 } from '@tabler/icons-react';
import { git, isDesktop } from '../services/git';

export function RepositoryDirectoryInput({ value, onChange, defaultPath, busy, onPendingChange, notify }: {
  value: string; onChange: (path: string) => void; defaultPath: string; busy: boolean;
  onPendingChange: (pending: boolean) => void; notify: (message: string, error?: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingChangeRef = useRef(onPendingChange);
  pendingChangeRef.current = onPendingChange;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingChangeRef.current(false); };
  }, []);
  const choose = async () => {
    if (pending.current || busy || !isDesktop()) return;
    pending.current = true; setPicking(true); onPendingChange(true);
    try {
      const selected = await git.pickDirectory(value.trim() || defaultPath);
      if (mounted.current && selected) onChange(selected);
    } catch (error) { if (mounted.current) notify(`无法选择文件夹：${String(error)}`, true); }
    finally {
      pending.current = false;
      if (mounted.current) {
        setPicking(false); onPendingChange(false);
        requestAnimationFrame(() => { if (mounted.current) inputRef.current?.focus({ preventScroll: true }); });
      }
    }
  };
  return <div className="repository-directory-input">
    <input ref={inputRef} id="repo-path" className="text-field mono" placeholder="例如 X:\Projects\my-repository" value={value} onChange={event => onChange(event.target.value)} disabled={busy || picking} autoFocus />
    <button type="button" className="secondary-button" aria-label="选择仓库文件夹" aria-busy={picking} disabled={busy || picking || !isDesktop()} onClick={() => { void choose(); }}>
      {picking ? <IconLoader2 size={16} className="spin" /> : <IconFolderOpen size={16} />}{picking ? '正在选择…' : '选择文件夹'}
    </button>
  </div>;
}
