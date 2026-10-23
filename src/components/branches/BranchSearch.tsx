import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { IconSearch, IconX } from '@tabler/icons-react';
import './branches.css';

export function BranchSearch({ query, onQueryChange }: {
  query: string; onQueryChange: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const close = () => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const upwards = below < 64 && above > below;
    setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popupRef.current?.contains(event.target)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className={`icon-button panel-search-branch-button${query.trim() ? ' filtering' : ''}`} aria-label="搜索分支" title={query.trim() ? `正在筛选分支：${query}` : '搜索全部本地和远程分支'}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
      onClick={() => setOpen(value => !value)}>
      <IconSearch size={16} />
    </button>
    {open && createPortal(<div ref={popupRef} id={popupId} role="dialog" aria-label="搜索分支" className="branch-search-popover" style={position}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) setOpen(false); }}>
      <div className="branch-search-heading">
        <label className="branch-search-input"><IconSearch size={16} aria-hidden="true" /><input autoFocus type="search" aria-label="筛选分支" placeholder="搜索本地或远程分支…" value={query} onChange={event => onQueryChange(event.target.value)} /></label>
        <button type="button" className="icon-button" aria-label="关闭分支搜索" onClick={close}><IconX size={16} /></button>
      </div>
    </div>, document.body)}
  </>;
}
