import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './context-menu.css';

export function ContextMenu({ x, y, label, onClose, children }: {
  x: number; y: number; label: string; onClose: () => void; children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    if (root) {
      setPosition({ left: Math.max(8, Math.min(x, innerWidth - root.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - root.offsetHeight - 8)) });
      root.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    }
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [x, y]);
  useEffect(() => {
    const outside = (event: Event) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closeRef.current(); };
    const close = () => closeRef.current();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);
  return createPortal(<div className="context-menu" role="menu" aria-label={label} ref={rootRef} style={position}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>{children}</div>, document.body);
}
