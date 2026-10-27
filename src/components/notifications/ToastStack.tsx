import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { IconCheck, IconX } from '@tabler/icons-react';
import type { Notice } from '../../services/useRepository';
import './toasts.css';

const MAX_VISIBLE = 3;
const DISPLAY_MS = 5000;
const EXIT_MS = 240;
const CARD_HEIGHT = 36;
const STACK_STEP = 7;
const EXPANDED_GAP = 6;

interface ToastProps {
  notice: Notice; depth: number; offset: number; expanded: boolean; paused: boolean; count: number;
  onDismiss: (id: string) => void; onExit: (id: string) => void; onMeasure: (id: string, height: number) => void;
}

function Toast({ notice, depth, offset, expanded, paused, count, onDismiss, onExit, onMeasure }: ToastProps) {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting'>('entering');
  const card = useRef<HTMLDivElement>(null);
  const remaining = useRef(DISPLAY_MS);
  const beginExit = useCallback(() => { setPhase('exiting'); onExit(notice.id); }, [notice.id, onExit]);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const measure = () => onMeasure(notice.id, element.offsetHeight || CARD_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [notice.id, onMeasure]);

  useEffect(() => {
    let secondFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPhase(current => current === 'entering' ? 'visible' : current));
    });
    return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(secondFrame); };
  }, []);

  useEffect(() => {
    // Covered cards wait their turn, so a notification never expires unread.
    if (phase !== 'visible' || depth !== 0 || paused) return;
    const started = Date.now();
    const timeout = window.setTimeout(beginExit, remaining.current);
    return () => { window.clearTimeout(timeout); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [phase, depth, paused, beginExit]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const timeout = window.setTimeout(() => onDismiss(notice.id), EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [phase, notice.id, onDismiss]);

  const style = {
    '--toast-y': `${offset}px`, '--toast-scale': expanded ? 1 : 1 - depth * .035,
    zIndex: phase === 'exiting' ? MAX_VISIBLE + 1 : MAX_VISIBLE - depth,
  } as CSSProperties;
  return <div className={`toast-slot toast-slot--${phase}${depth > 0 ? ' toast-slot--back' : ''}`} data-toast-id={notice.id} style={style} aria-hidden={phase === 'exiting' ? true : undefined}>
    <div ref={card} className={`toast${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'} aria-atomic="true">
      <span className="toast-icon" aria-hidden="true">{notice.error ? <IconX size={12} /> : <IconCheck size={12} />}</span>
      <span className="toast-message" title={notice.message}>{notice.message}</span>
      {depth === 0 && count > 1 && <span className="toast-count" aria-label={`另有 ${count - 1} 条通知`}>{count - 1}</span>}
      <button type="button" aria-label={`关闭提示：${notice.message}`} tabIndex={phase === 'visible' ? 0 : -1} disabled={phase === 'exiting'} onClick={beginExit}><IconX size={12} /></button>
    </div>
  </div>;
}

export function ToastStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: string) => void }) {
  const region = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState<string[]>([]);
  const expanded = hovered || focused;
  const visible = notices.slice(0, MAX_VISIBLE);
  const measure = useCallback((id: string, height: number) => {
    setHeights(current => current[id] === height ? current : { ...current, [id]: height });
  }, []);
  const exit = useCallback((id: string) => { setLeaving(current => current.includes(id) ? current : [...current, id]); }, []);
  // Retain measurements only for the rendered cards, including while exiting.
  useEffect(() => {
    const ids = new Set(notices.slice(0, MAX_VISIBLE).map(notice => notice.id));
    setHeights(current => Object.keys(current).some(id => !ids.has(id))
      ? Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))) : current);
    setLeaving(current => current.some(id => !ids.has(id)) ? current.filter(id => ids.has(id)) : current);
  }, [notices]);

  const dismiss = useCallback((id: string) => {
    const active = document.activeElement;
    const removed = Array.from(region.current?.querySelectorAll<HTMLElement>('[data-toast-id]') ?? []).find(element => element.dataset.toastId === id);
    if (active instanceof HTMLElement && removed?.contains(active)) {
      const next = region.current?.querySelector<HTMLButtonElement>('[data-toast-id] button:not(:disabled)');
      if (next) next.focus({ preventScroll: true }); else { active.blur(); setFocused(false); }
    }
    onDismiss(id);
  }, [onDismiss]);

  let nextOffset = 0;
  let nextDepth = 0;
  const cards = visible.map(notice => {
    const height = heights[notice.id] ?? CARD_HEIGHT;
    const depth = nextDepth;
    const offset = expanded ? nextOffset : depth * STACK_STEP;
    // Start the next card's movement while the outgoing card is fading away.
    if (!leaving.includes(notice.id)) { nextOffset += height + EXPANDED_GAP; nextDepth++; }
    return <Toast key={notice.id} notice={notice} depth={depth} offset={offset} expanded={expanded} paused={expanded} count={notices.length} onDismiss={dismiss} onExit={exit} onMeasure={measure} />;
  });
  const front = visible.find(notice => !leaving.includes(notice.id));
  const height = front ? expanded ? nextOffset - EXPANDED_GAP : (heights[front.id] ?? CARD_HEIGHT) + (nextDepth - 1) * STACK_STEP : 0;
  return <section ref={region} className={`toast-stack${expanded ? ' toast-stack--expanded' : ''}`} style={{ height }} aria-label="通知提示"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {cards}
  </section>;
}
