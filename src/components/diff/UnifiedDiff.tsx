import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowBackUp } from '@tabler/icons-react';
import type { DiffBlock } from '../../services/git';
import { changeHighlightClass, DiffNavigation, DiffText, useDiffNavigation, type ChangeRange, type TextMatch } from './DiffNavigation';
import { getDiffBlocks } from './model';
import './large-diff.css';

export const isCombinedDiff = (diff: string) => /^diff --(?:cc|combined) /m.test(diff) || /^@@@ /m.test(diff);

type DiffRow =
  | { kind: 'heading'; text: string }
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; text: string; type: 'added' | 'removed' | 'context'; old: number | ''; next: number | ''; block?: DiffBlock; blockNumber: number; changeNumber: number | null };

const CHUNK_SIZE = 100;
const FULL_VIEW_LINE_LIMIT = 10_000;

function exceedsLineLimit(diff: string): boolean {
  let lines = 1;
  for (let index = 0; index < diff.length; index++) {
    if (diff[index] === '\n' && index + 1 < diff.length && ++lines > FULL_VIEW_LINE_LIMIT) return true;
  }
  return false;
}

function parseRows(diff: string, showFileHeaders: boolean): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let inChange = false;
  let blockIndex = -1;
  const blocks = getDiffBlocks(diff);
  const rows: DiffRow[] = [];
  const lines = diff.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      if (showFileHeaders) {
        oldLine = 0; newLine = 0; inChange = false;
        rows.push({ kind: 'heading', text: line.slice('diff --git '.length) });
      }
      continue;
    }
    if (line.startsWith('@@ ')) inHunk = true;
    if (!inHunk && /^(index |--- |\+\+\+ )/.test(line)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inChange = false;
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      rows.push({ kind: 'hunk', text: line });
      continue;
    }
    const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
    const firstChange = type !== 'context' && !inChange;
    if (firstChange) blockIndex++;
    const changed = type !== 'context' || line.startsWith('\\') && inChange;
    if (!line.startsWith('\\')) inChange = type !== 'context';
    const special = line.startsWith('\\') || !oldLine && !newLine;
    rows.push({
      kind: 'line',
      text: line.startsWith(' ') || type !== 'context' ? line.slice(1) : line,
      type,
      old: type !== 'added' && !special ? oldLine++ : '',
      next: type !== 'removed' && !special ? newLine++ : '',
      block: firstChange ? blocks[blockIndex] : undefined,
      blockNumber: blockIndex + 1,
      changeNumber: changed ? blockIndex + 1 : null,
    });
  }
  return rows;
}

// Text and controls remain mounted for native search, selection and keyboard
// navigation. Only syntax tokenization is deferred for chunks outside view.
const DiffChunk = memo(function DiffChunk({ rows, offset, query, current, currentChange, deferHighlight, onDiscardBlock, discardBlockDisabled }: {
  rows: DiffRow[]; deferHighlight: boolean; onDiscardBlock?: (block: DiffBlock) => void; discardBlockDisabled: boolean;
  offset: number; query: string; current?: TextMatch; currentChange?: ChangeRange;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(() => !deferHighlight || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (!deferHighlight || highlight || !ref.current || typeof IntersectionObserver === 'undefined') return;
    let waitingForSelection = false;
    const activate = () => {
      if (window.getSelection()?.isCollapsed === false) {
        if (!waitingForSelection) {
          waitingForSelection = true;
          document.addEventListener('selectionchange', activate);
        }
        return;
      }
      if (waitingForSelection) document.removeEventListener('selectionchange', activate);
      waitingForSelection = false;
      setHighlight(true);
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        activate();
      }
    }, { rootMargin: '300px' });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      if (waitingForSelection) document.removeEventListener('selectionchange', activate);
    };
  }, [deferHighlight, highlight]);

  return <div ref={ref}>{rows.map((row, index) => {
    const line = offset + index;
    const content = <DiffText text={row.text} query={query} currentStart={current?.line === line ? current.start : undefined} highlight={row.kind === 'line' && (highlight || !deferHighlight)} />;
    if (row.kind === 'heading') return <div className="patch-file-heading" data-diff-row={line} key={index}>{content}</div>;
    if (row.kind === 'hunk') return <div className="code-hunk" data-diff-row={line} key={index}><span>···</span><span>···</span><code>{content}</code></div>;
    const { block } = row;
    return <div className={`code-line ${row.type}${changeHighlightClass(line, currentChange)}`} data-diff-row={line} key={index}><span className="line-number">{row.old}</span><span className="line-number">{row.next}</span><span className="line-sign">{block && onDiscardBlock ? <button className="diff-block-undo" aria-label={`撤回变更块 ${row.blockNumber}`} title="撤回该变更块，保留其他更改" disabled={discardBlockDisabled} onClick={() => onDiscardBlock(block)}><IconArrowBackUp size={14} /></button> : row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}</span><code>{content}</code></div>;
  })}</div>;
});

export function UnifiedDiff({ diff, onDiscardBlock, discardBlockDisabled = false, showFileHeaders = false, interactive = false }: { diff: string; onDiscardBlock?: (block: DiffBlock) => void; discardBlockDisabled?: boolean; showFileHeaders?: boolean; interactive?: boolean }) {
  const view = useRef<HTMLDivElement>(null);
  const combined = isCombinedDiff(diff);
  const large = useMemo(() => !combined && exceedsLineLimit(diff), [combined, diff]);
  const [fullViewRequested, setFullViewRequested] = useState(false);
  const fullView = !large || fullViewRequested;
  const rows = useMemo(() => combined || !fullView ? [] : parseRows(diff, showFileHeaders), [combined, diff, showFileHeaders, fullView]);
  const lines = useMemo(() => interactive ? combined || !fullView ? [diff] : rows.map(row => row.text) : [], [interactive, combined, fullView, diff, rows]);
  const changes = useMemo(() => interactive ? rows.flatMap((row, index) => row.kind === 'line' && row.block ? [index] : []) : [], [interactive, rows]);
  const navigation = useDiffNavigation(lines, changes, (line, start) => {
    const row = view.current?.querySelector<HTMLElement>(`[data-diff-row="${line}"]`);
    const target = start === undefined ? row : row?.querySelector<HTMLElement>(`[data-search-start="${start}"]`) ?? row;
    const viewport = view.current?.closest<HTMLElement>('.code-scroll');
    if (!target || !viewport) return;
    const bounds = target.getBoundingClientRect(); const visible = viewport.getBoundingClientRect();
    viewport.scrollTop += bounds.top - visible.top - viewport.clientHeight / 3;
    if (bounds.left < visible.left || bounds.right > visible.right) viewport.scrollLeft += bounds.left - visible.left - viewport.clientWidth / 3;
  });
  const currentStart = changes[navigation.changeIndex];
  const currentChange = useMemo(() => {
    if (currentStart === undefined) return undefined;
    const first = rows[currentStart];
    if (first.kind !== 'line' || first.changeNumber === null) return undefined;
    let end = currentStart + 1;
    while (end < rows.length) {
      const row = rows[end];
      if (row.kind !== 'line' || row.changeNumber !== first.changeNumber) break;
      end++;
    }
    return { start: currentStart, end };
  }, [rows, currentStart]);
  const chunks = useMemo(() => {
    const groups: DiffRow[][] = [];
    for (let index = 0; index < rows.length; index += CHUNK_SIZE) groups.push(rows.slice(index, index + CHUNK_SIZE));
    return groups;
  }, [rows]);
  const toolbar = interactive && <DiffNavigation navigation={navigation} />;
  const raw = <DiffText text={diff} query={navigation.query} currentStart={navigation.current?.start} highlight={false} />;
  if (combined) return <div ref={view} className="conflict-diff">{toolbar}<div className="conflict-diff-note">文件存在合并冲突。以下为原始差异，请在编辑器中解决冲突。</div><pre data-diff-row={0}>{raw}</pre></div>;
  if (!fullView) return <div ref={view} className={`large-diff${interactive ? ' diff-interactive-view' : ''}`}>{toolbar}
    <div className="large-diff-notice" role="status"><span>差异超过 10,000 行，当前显示完整原始文本。语法高亮{onDiscardBlock ? '和区块撤回' : ''}未启用。</span><button className="text-button" onClick={() => setFullViewRequested(true)}>加载完整视图</button><small>加载完整视图可能影响性能。</small></div>
    <pre className="large-diff-raw" data-diff-row={0} aria-label="完整差异文本">{raw}</pre>
  </div>;
  return <div ref={view} className="diff-interactive-view" onKeyDown={event => {
    if (interactive && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); view.current?.querySelector<HTMLInputElement>('[aria-label="在差异中搜索"]')?.focus(); }
  }}>{toolbar}<div className="code-lines">{chunks.map((rows, index) => <DiffChunk key={index} rows={rows} offset={index * CHUNK_SIZE} query={navigation.query} current={navigation.current} currentChange={currentChange} deferHighlight={chunks.length > 2 && index >= 2} onDiscardBlock={onDiscardBlock} discardBlockDisabled={discardBlockDisabled} />)}</div></div>;
}
