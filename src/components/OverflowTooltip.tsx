import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './overflow-tooltip.css';

export function useOverflowTooltip() {
  const [target, setTarget] = useState<{ anchor: HTMLElement; text: string; key: string } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const show = (anchor: HTMLElement, text: string, selector: string, key = text) => {
    const elements = [...(anchor.matches(selector) ? [anchor] : []), ...anchor.querySelectorAll<HTMLElement>(selector)];
    const clipped = elements.some(element => element.scrollWidth > element.clientWidth);
    setTarget(clipped ? { anchor, text, key } : null);
  };
  const hide = () => setTarget(null);
  useLayoutEffect(() => {
    if (!target || !tooltipRef.current) return;
    const anchor = target.anchor.getBoundingClientRect();
    const box = tooltipRef.current.getBoundingClientRect();
    const top = anchor.bottom + 6 + box.height <= window.innerHeight - 8 ? anchor.bottom + 6 : anchor.top - box.height - 6;
    setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)), top: Math.max(8, top) });
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const close = () => setTarget(null);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', close);
    const observer = new MutationObserver(() => { if (!target.anchor.isConnected) close(); });
    observer.observe(target.anchor.parentNode ?? document.body, { childList: true });
    return () => {
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', close);
      observer.disconnect();
    };
  }, [target]);
  return {
    show, hide,
    describedBy: (key: string) => target?.key === key ? id : undefined,
    tooltip: target && createPortal(<div ref={tooltipRef} id={id} className="overflow-tooltip" role="tooltip" style={position}>{target.text}</div>, document.body),
  };
}
