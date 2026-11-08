import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BlameCommit, SideBlame } from '../../services/git';
import './blame.css';

export type LineAttribution = Omit<BlameCommit, 'hash'> & { hash?: string };
export type BlameLookup = (line: number, text: string) => LineAttribution | undefined;
export interface DiffBlame { original?: BlameLookup; modified?: BlameLookup }

export function createBlameLookup(side?: SideBlame | null): BlameLookup | undefined {
  if (!side) return undefined;
  const lines = side.source.split('\n');
  const { ranges } = side;
  const local = { author: '你', summary: '未提交的更改', time: side.localTime };
  return (line, text) => {
    // Diff and blame load independently. An edit may shift or replace lines between reads.
    if (lines[line - 1] !== text && lines[line - 1] !== text.replace(/\r$/, '')) return undefined;
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const range = ranges[middle];
      if (line < range.start) high = middle;
      else if (line >= range.start + range.count) low = middle + 1;
      else return range.commit ?? local;
    }
    return undefined;
  };
}

export function blameAttributes(attribution?: LineAttribution) {
  return {
    'data-blame-author': attribution?.author,
    'data-blame-hash': attribution?.hash?.slice(0, 8),
    'data-blame-summary': attribution?.summary,
    'data-blame-time': attribution?.time ?? undefined,
  };
}

const relativeTime = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' });
const absoluteTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false });
const timeUnits = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3_600], ['minute', 60]] as const;

function BlameTime({ seconds }: { seconds: string }) {
  const date = new Date(Number(seconds) * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const delta = Math.trunc((date.getTime() - Date.now()) / 1000);
  const [unit, duration] = timeUnits.find(([, size]) => Math.abs(delta) >= size) ?? ['second', 1];
  const relative = unit === 'second' && delta <= 0 ? '刚刚' : relativeTime.format(Math.trunc(delta / duration), unit);
  return <time dateTime={date.toISOString()}>{relative}（{absoluteTime.format(date)}）</time>;
}

function blameTarget(event: MouseEvent) {
  const element = event.target;
  if (!(element instanceof Element) || element.closest('button')) return null;
  const row = element.closest<HTMLElement>('[data-blame-author]');
  return row ? { row, x: event.clientX } : null;
}

export function useLineBlame(blame: DiffBlame | undefined, diff: string) {
  const [hovered, setHovered] = useState<ReturnType<typeof blameTarget>>(null);
  const [selected, setSelected] = useState<ReturnType<typeof blameTarget>>(null);
  const popup = useRef<HTMLDivElement>(null);
  const active = hovered ?? selected;

  useEffect(() => {
    setHovered(null);
    setSelected(null);
  }, [blame, diff]);
  useEffect(() => {
    if (!active) return;
    const hide = () => { setHovered(null); setSelected(null); };
    document.addEventListener('scroll', hide, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [active]);
  useLayoutEffect(() => {
    if (!active || !popup.current) return;
    const row = active.row.getBoundingClientRect();
    const { width, height } = popup.current.getBoundingClientRect();
    const below = row.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : row.top - height - 6;
    popup.current.style.left = `${Math.max(8, Math.min(active.x + 8, window.innerWidth - width - 8))}px`;
    popup.current.style.top = `${Math.max(8, top)}px`;
  }, [active]);

  const details = active?.row.dataset;
  return {
    events: {
      onMouseOver(event: MouseEvent) {
        if (!blame) return;
        const target = blameTarget(event);
        setHovered(current => current?.row === target?.row ? current : target);
      },
      onMouseLeave() { setHovered(null); },
      onClick(event: MouseEvent) {
        if (blame && window.getSelection()?.isCollapsed !== false) setSelected(blameTarget(event));
      },
    },
    tooltip: details?.blameAuthor && createPortal(<div ref={popup} className="diff-line-blame" role="tooltip">
      <div className="diff-line-blame-header"><strong>{details.blameAuthor}</strong>{details.blameTime && <BlameTime seconds={details.blameTime} />}{details.blameHash && <code>{details.blameHash}</code>}</div>
      {details.blameSummary && <p>{details.blameSummary}</p>}
    </div>, document.body),
  };
}
