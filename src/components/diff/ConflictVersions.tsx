import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { ConflictFile, ConflictResolution } from '../../services/git';
import { buildComparisonChanges, buildComparisonRows } from './model';
import { Syntax } from './Syntax';
import { ChangeOverview } from './ChangeOverview';

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

export function ConflictVersions({ data, resolution, locked, onChoose }: {
  data: ConflictFile;
  resolution: ConflictResolution | null;
  locked: boolean;
  onChoose: (side: 'ours' | 'theirs') => void;
}) {
  const rows = useMemo(() => data.comparison && !data.binary ? buildComparisonRows(data.comparison) : [], [data.comparison, data.binary]);
  const changes = useMemo(() => buildComparisonChanges(rows), [rows]);
  const oursRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const versionsRef = useRef<HTMLDivElement>(null);
  const overviewViewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const scrollTopRef = useRef(0);
  const [viewport, setViewport] = useState({ top: 0, height: 200 });
  const [activeChange, setActiveChange] = useState(0);
  const [overviewOffset, setOverviewOffset] = useState(0);
  const widths = useMemo(() => rows.reduce((maximum, row) => ({
    original: Math.max(maximum.original, row.original?.text.replace(/\t/g, '  ').length ?? 0),
    modified: Math.max(maximum.modified, row.modified?.text.replace(/\t/g, '  ').length ?? 0),
  }), { original: 0, modified: 0 }), [rows]);

  const updateOverview = useCallback((top: number) => {
    const indicator = overviewViewportRef.current;
    const height = oursRef.current?.clientHeight || 200;
    const contentHeight = Math.max(height, rows.length * ROW_HEIGHT);
    if (!indicator) return;
    const visibleTop = Math.max(0, Math.min(top, contentHeight - height));
    indicator.style.transform = `translateY(${visibleTop / contentHeight * height}px)`;
  }, [rows.length]);
  useLayoutEffect(() => updateOverview(scrollTopRef.current), [updateOverview, viewport.height]);

  const jumpToChange = useCallback((index: number) => {
    const change = changes[index];
    const element = oursRef.current;
    if (!change || !element) return;
    const height = element.clientHeight || 200;
    const top = Math.max(0, Math.min(change.start * ROW_HEIGHT - ROW_HEIGHT * 2, rows.length * ROW_HEIGHT - height));
    for (const source of [element, theirsRef.current]) {
      if (source) source.scrollTop = top;
    }
    scrollTopRef.current = top;
    updateOverview(top);
    setViewport({ top, height });
    setActiveChange(index);
  }, [changes, rows.length, updateOverview]);

  useEffect(() => { jumpToChange(0); }, [jumpToChange]);
  useLayoutEffect(() => {
    const element = oursRef.current;
    const versions = versionsRef.current;
    if (!element || !versions) return;
    const measure = () => {
      const height = element.clientHeight || 200;
      setViewport(current => current.height === height ? current : { ...current, height });
      setOverviewOffset(Math.max(0, element.getBoundingClientRect().top - versions.getBoundingClientRect().top));
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

  function synchronize(element: HTMLDivElement, other: HTMLDivElement | null) {
    const top = element.scrollTop;
    if (scrollTopRef.current === top) return;
    scrollTopRef.current = top;
    if (other && other.scrollTop !== top) other.scrollTop = top;
    updateOverview(top);
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setViewport(current => ({ ...current, top: scrollTopRef.current }));
    });
  }

  const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
  const active = changes[activeChange];

  return <div className="conflict-comparison">
    {!data.binary && <div className="conflict-comparison-toolbar">
      <div className="conflict-comparison-legend"><span className="conflict-legend-ours">− 当前版本差异</span><span className="conflict-legend-theirs">+ 传入版本差异</span><span>两侧同步滚动</span></div>
      <div className="conflict-comparison-navigation">
        <span role="status">{changes.length ? `差异 ${activeChange + 1} / ${changes.length}` : '两侧内容相同'}</span>
        <button className="icon-button" aria-label="上一处差异" title="上一处差异" disabled={activeChange === 0 || !changes.length} onClick={() => jumpToChange(activeChange - 1)}><IconChevronUp size={16} /></button>
        <button className="icon-button" aria-label="下一处差异" title="下一处差异" disabled={activeChange >= changes.length - 1} onClick={() => jumpToChange(activeChange + 1)}><IconChevronDown size={16} /></button>
      </div>
    </div>}
    <div className={`conflict-versions${!data.binary && rows.length ? ' has-overview' : ''}`} ref={versionsRef}>
      {!data.binary && rows.length > 0 && <div className="conflict-change-overview" style={{ paddingTop: overviewOffset }}>
        <ChangeOverview changes={changes} rowCount={rows.length} viewportRef={overviewViewportRef} height={viewport.height} rowHeight={ROW_HEIGHT} onJump={change => {
          jumpToChange(changes.indexOf(change));
          (data.oursExists ? oursRef : theirsRef).current?.focus({ preventScroll: true });
        }} />
      </div>}
      {(['ours', 'theirs'] as const).map(side => {
        const ours = side === 'ours';
        const source = ours ? 'original' : 'modified';
        const label = ours ? '当前版本' : '传入版本';
        const exists = ours ? data.oursExists : data.theirsExists;
        return <section className={`conflict-version-${side}`} key={side}>
          <h3>{label} <small>{side}</small>{!exists && <small>已删除</small>}</h3>
          <div className="conflict-version-scroll" ref={ours ? oursRef : theirsRef} role="region" aria-label={`${label}源码`} tabIndex={0} onScroll={event => synchronize(event.currentTarget, ours ? theirsRef.current : oursRef.current)}>
            {!exists || data.binary || !rows.length ? <p className="conflict-version-message">{!exists ? '此版本中不存在该文件' : data.binary ? '二进制或非 UTF-8 文件' : '空文件'}</p> : <div className="conflict-version-lines" style={{ height: rows.length * ROW_HEIGHT, width: `max(100%, calc(${widths[source]}ch + 80px))` }}>
              <div className="conflict-version-visible" style={{ top: start * ROW_HEIGHT }}>{rows.slice(start, end).map((row, index) => {
                const line = row[source];
                const changed = line && line.kind !== 'context';
                const selected = changed && active && start + index >= active.start && start + index < active.end;
                return <div className={`conflict-comparison-line ${line?.kind ?? 'empty'}${selected ? ' current-difference' : ''}`} key={start + index}>
                  <span className="conflict-line-number" aria-hidden="true">{line?.number}</span>
                  <span className="conflict-line-sign" aria-label={changed ? `${label}差异行` : undefined} aria-hidden={!changed}>{changed ? ours ? '−' : '+' : ''}</span>
                  <code>{line && <Syntax text={line.text} />}</code>
                </div>;
              })}</div>
            </div>}
          </div>
          <button className="secondary-button" aria-pressed={resolution === side} disabled={locked} onClick={() => onChoose(side)}>{exists ? `使用${label}` : `接受${label}的删除`}</button>
        </section>;
      })}
    </div>
  </div>;
}
