import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiffBlock, FileComparison } from '../../services/git';
import { IconArrowBackUp } from '@tabler/icons-react';
import { buildComparisonChanges, buildComparisonRows, getDiffBlocks, type ComparisonChange, type SourceLine } from './model';
import { ChangeOverview } from './ChangeOverview';
import { Syntax } from './Syntax';

const ROW_HEIGHT = 24;
const OVERSCAN = 20;

const SourceRow = memo(function SourceRow({ line, block, blockNumber, onDiscardBlock }: { line: SourceLine | null; block?: DiffBlock; blockNumber?: number; onDiscardBlock?: (block: DiffBlock) => void }) {
  return <div className={`source-line ${line?.kind ?? 'empty'}`}>
    <span className="source-line-number" aria-hidden="true">{line?.number ?? ''}</span>
    <span className="source-line-sign">{block && onDiscardBlock ? <button className="diff-block-undo" aria-label={`撤回变更块 ${blockNumber}`} title="撤回该变更块，保留其他更改" onClick={() => onDiscardBlock(block)}><IconArrowBackUp size={14} /></button> : <span aria-hidden="true">{line?.kind === 'added' ? '+' : line?.kind === 'removed' ? '−' : ''}</span>}</span>
    <code>{line && <Syntax text={line.text} />}</code>
  </div>;
});

export function SplitDiff({ comparison, originalLabel, modifiedLabel, originalPath, modifiedPath, onDiscardBlock }: {
  comparison: FileComparison;
  originalLabel: string; modifiedLabel: string; originalPath: string; modifiedPath: string;
  onDiscardBlock?: (block: DiffBlock) => void;
}) {
  const rows = useMemo(() => buildComparisonRows(comparison), [comparison.diff, comparison.unchanged]);
  const changes = useMemo(() => buildComparisonChanges(rows), [rows]);
  const blockStarts = useMemo(() => {
    const blocks = getDiffBlocks(comparison.diff);
    return new Map(changes.map((change, index) => [change.start, { block: blocks[index], number: index + 1 }]));
  }, [changes, comparison.diff]);
  const originalRef = useRef<HTMLDivElement>(null);
  const modifiedRef = useRef<HTMLDivElement>(null);
  const overviewViewportRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ row: 0, height: 600 });
  const updateOverview = useCallback((top: number) => {
    const indicator = overviewViewportRef.current;
    const height = originalRef.current?.clientHeight ?? 0;
    const contentHeight = Math.max(height, rows.length * ROW_HEIGHT);
    if (!indicator || !contentHeight) return;
    const visibleTop = Math.max(0, Math.min(top, contentHeight - height));
    indicator.style.transform = `translateY(${visibleTop / contentHeight * height}px)`;
  }, [rows.length]);
  useLayoutEffect(() => updateOverview(scrollTopRef.current), [updateOverview, viewport.height]);
  useEffect(() => {
    const element = originalRef.current;
    if (!element) return;
    const measure = () => {
      const height = element.clientHeight || 600;
      setViewport(current => current.height === height ? current : { ...current, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);
  const widths = useMemo(() => rows.reduce((maximum, row) => ({
    original: Math.max(maximum.original, row.original?.text.replace(/\t/g, '  ').length ?? 0),
    modified: Math.max(maximum.modified, row.modified?.text.replace(/\t/g, '  ').length ?? 0),
  }), { original: 0, modified: 0 }), [rows]);
  const start = Math.max(0, Math.min(rows.length - Math.ceil(viewport.height / ROW_HEIGHT), viewport.row - OVERSCAN));
  const end = Math.min(rows.length, viewport.row + Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN + 1);
  function synchronize(element: HTMLDivElement, other: HTMLDivElement | null) {
    const top = element.scrollTop;
    if (top === scrollTopRef.current) return;
    scrollTopRef.current = top;
    if (other && other.scrollTop !== top) other.scrollTop = top;
    // Move the overview immediately; syntax rendering must not delay the scroll indicator.
    updateOverview(top);
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const row = Math.floor(scrollTopRef.current / ROW_HEIGHT);
      setViewport(current => current.row === row ? current : { ...current, row });
    });
  }
  const jumpToChange = useCallback((change: ComparisonChange) => {
    const original = originalRef.current;
    if (!original) return;
    original.scrollTop = Math.max(0, change.start * ROW_HEIGHT - viewport.height / 3);
    // The native scroll event performs synchronization and virtual window updates.
    original.focus({ preventScroll: true });
  }, [viewport.height]);
  return <div className="split-diff">
    <ChangeOverview changes={changes} rowCount={rows.length} viewportRef={overviewViewportRef} height={viewport.height} rowHeight={ROW_HEIGHT} onJump={jumpToChange} />
    {(['original', 'modified'] as const).map(side => {
      const original = side === 'original';
      const exists = original ? comparison.originalExists : comparison.modifiedExists;
      return <section className={`split-source split-source-${side}`} key={side} aria-label={original ? '原始文件' : '变更后文件'}>
        <header className="split-source-heading"><strong>{original ? '原始文件' : '变更后文件'}</strong><span>{original ? originalLabel : modifiedLabel}</span>{!exists && <small>不存在</small>}</header>
        <div className="split-source-path" title={original ? originalPath : modifiedPath}>{original ? originalPath : modifiedPath}</div>
        <div className="split-source-scroll" ref={original ? originalRef : modifiedRef} role="region" aria-label={original ? '原始文件源码' : '变更后文件源码'} tabIndex={0} onScroll={event => synchronize(event.currentTarget, original ? modifiedRef.current : originalRef.current)}>
          {rows.length ? <div className="source-lines" style={{ height: rows.length * ROW_HEIGHT, width: `max(100%, calc(${widths[side]}ch + 88px))` }}>
            <div className="source-visible-lines" style={{ top: start * ROW_HEIGHT }}>{rows.slice(start, end).map((row, index) => {
              const action = !original ? blockStarts.get(start + index) : undefined;
              return <SourceRow line={row[side]} block={action?.block} blockNumber={action?.number} onDiscardBlock={onDiscardBlock} key={start + index} />;
            })}</div>
          </div> : <div className="diff-empty"><span>{exists ? '空文件' : '此版本中没有该文件'}</span></div>}
        </div>
      </section>;
    })}
  </div>;
}
