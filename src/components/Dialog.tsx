import { useEffect, useRef, type ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';

export function Dialog({ title, onClose, children, className = '', hideHeading = false }: { title: string; onClose: () => void; children: ReactNode; className?: string; hideHeading?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const tabbable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter(node => !node.hidden);
    const first = root?.querySelector<HTMLElement>('[autofocus], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? tabbable()[0];
    first?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.item(dialogs.length - 1) !== root) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = tabbable();
        if (!elements.length) { event.preventDefault(); return; }
        if (!root?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? elements.at(-1) : elements[0])?.focus(); }
        else if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus({ preventScroll: true }); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
      {!hideHeading && <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><IconX size={18} /></button></div>}
      {children}
    </div>
  </div>;
}
