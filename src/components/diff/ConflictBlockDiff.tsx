import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConflictBlock } from './conflicts';
import { buildConflictBlockRows, getLineHighlight } from './conflictComparison';

const ROW_HEIGHT = 24;
const MAX_HEIGHT = 288;
const MIN_VISIBLE_ROWS = 3;
const SCROLLBAR_SPACE = 16;
const OVERSCAN = 6;

export function ConflictBlockDiff({ block, number }: { block: ConflictBlock; number: number }) {
  const rows = useMemo(() => buildConflictBlockRows(block.ours, block.theirs), [block.ours, block.theirs]);
  const oursRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [top, setTop] = useState(0);
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_VISIBLE_ROWS, rows.length) * ROW_HEIGHT + SCROLLBAR_SPACE);
  const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
  const widths = useMemo(() => rows.reduce((maximum, row) => ({
    original: Math.max(maximum.original, row.original?.text.replace(/\t/g, '  ').length ?? 0),
    modified: Math.max(maximum.modified, row.modified?.text.replace(/\t/g, '  ').length ?? 0),
  }), { original: 0, modified: 0 }), [rows]);

  useEffect(() => {
    scrollTopRef.current = 0;
    if (oursRef.current) oursRef.current.scrollTop = 0;
    if (theirsRef.current) theirsRef.current.scrollTop = 0;
    setTop(0);
  }, [rows]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  function synchronize(element: HTMLDivElement, other: HTMLDivElement | null) {
    if (scrollTopRef.current === element.scrollTop) return;
    scrollTopRef.current = element.scrollTop;
    if (other && other.scrollTop !== element.scrollTop) other.scrollTop = element.scrollTop;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setTop(scrollTopRef.current);
    });
  }

  return <div className="conflict-block-sources">
    {(['original', 'modified'] as const).map(side => {
      const ours = side === 'original';
      const empty = !block[ours ? 'ours' : 'theirs'];
      return <div className="conflict-block-source" key={side}>
        <div className="conflict-block-source-heading">{ours ? '当前版本' : '传入版本'}</div>
        <div className="conflict-block-source-scroll" ref={ours ? oursRef : theirsRef} style={{ height }} role="region" aria-label={`冲突块 ${number} ${ours ? '当前版本' : '传入版本'}`} tabIndex={0} onScroll={event => synchronize(event.currentTarget, ours ? theirsRef.current : oursRef.current)}>
          {rows.length ? <div className="conflict-block-source-lines" style={{ height: rows.length * ROW_HEIGHT, width: `max(100%, calc(${widths[side]}ch + 80px))` }}>
            <div className="conflict-version-visible" style={{ top: start * ROW_HEIGHT }}>{rows.slice(start, end).map((row, index) => {
              const line = row[side];
              const other = row[ours ? 'modified' : 'original'];
              const changed = line && line.kind !== 'context';
              const highlight = changed ? getLineHighlight(line.text, other?.text ?? '') : null;
              return <div className={`conflict-comparison-line ${line?.kind ?? 'empty'}`} key={start + index}>
                <span className="conflict-line-number" aria-hidden="true">{line?.number}</span>
                <span className="conflict-line-sign" aria-hidden="true">{changed ? ours ? '−' : '+' : ''}</span>
                <code>{highlight ? <>{highlight.before}<mark className="conflict-inline-change">{highlight.changed}</mark>{highlight.after}</> : line?.text ?? (empty && start + index === 0 ? '（空）' : '')}</code>
              </div>;
            })}</div>
          </div> : <p className="conflict-block-empty">（空）</p>}
        </div>
      </div>;
    })}
  </div>;
}
