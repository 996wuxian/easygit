import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { IconFileCode, IconLoader2, IconPhoto } from '@tabler/icons-react';
import type { FilePosition, FileSearchMatch, FileSearchMode } from '../../services/project';
import { useProjectSearch } from './useProjectSearch';
import { isImageFile } from './imagePreview';

function Snippet({ result }: { result: FileSearchMatch }) {
  return <>{result.preview.slice(0, result.matchStart)}<mark>{result.preview.slice(result.matchStart, result.matchStart + result.matchLength)}</mark>{result.preview.slice(result.matchStart + result.matchLength)}</>;
}

export function ProjectSearchResults({ repository, query, mode, showIgnored, refreshKey, selected, viewport, onOpen, onEntryMenu }: {
  repository: string; query: string; mode: FileSearchMode; showIgnored: boolean; refreshKey: string; selected?: string;
  viewport: RefObject<HTMLDivElement | null>; onOpen: (path: string, position?: FilePosition) => void;
  onEntryMenu?: (file: string, x: number, y: number) => void;
}) {
  const search = useProjectSearch(repository, query, mode, showIgnored, refreshKey);
  const [viewportState, setViewportState] = useState({ top: 0, height: 320 });
  const [activeRow, setActiveRow] = useState(0);
  const focusTarget = useRef<number | null>(null);
  const rowHeight = mode === 'content' ? 66 : 44;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = 0;
    setActiveRow(0);
    const update = () => setViewportState({ top: element.scrollTop, height: element.clientHeight || 320 });
    const observer = new ResizeObserver(update);
    observer.observe(element); element.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [viewport, query, mode, showIgnored, refreshKey]);
  useLayoutEffect(() => {
    if (focusTarget.current === null) return;
    viewport.current?.querySelector<HTMLButtonElement>(`[data-search-row="${focusTarget.current}"] button`)?.focus({ preventScroll: true });
    focusTarget.current = null;
  }, [viewport, viewportState, search.results]);
  const start = Math.max(0, Math.floor((viewportState.top - 28) / rowHeight) - 4);
  const end = Math.min(search.results.length, start + Math.ceil(viewportState.height / rowHeight) + 9);
  const progress = search.progress;
  return <div className="project-search" aria-busy={search.loading}>
    <div className="file-search-summary" role="status"><span>{search.results.length} 条{mode === 'content' ? '内容匹配' : '文件结果'}</span>{progress && <small>已检查 {progress.scannedFiles} / {progress.totalFiles}</small>}</div>
    <div className="file-search-results" role="list" aria-label={mode === 'content' ? '文件内容搜索结果' : '文件名搜索结果'} style={{ height: search.results.length * rowHeight }}>
      {search.results.slice(start, end).map((result, index) => <div key={`${result.path}:${result.line}:${result.column}`} data-search-row={start + index} role="listitem" aria-posinset={start + index + 1} aria-setsize={search.results.length} className="file-search-row" style={{ top: (start + index) * rowHeight, height: rowHeight }}>
        <button className={`file-search-result${selected === result.path ? ' selected' : ''}`} aria-label={`打开匹配 ${result.path}${result.line ? ` 第 ${result.line} 行` : ''}`} title={`${result.path}${result.line ? `:${result.line}:${result.column}` : ''}\n${result.preview}`}
          tabIndex={activeRow >= start && activeRow < end ? activeRow === start + index ? 0 : -1 : index === 0 ? 0 : -1} onFocus={() => setActiveRow(start + index)}
          onKeyDown={event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault(); event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              onEntryMenu?.(result.path, bounds.left, bounds.bottom);
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? search.results.length - 1 : Math.max(0, Math.min(search.results.length - 1, start + index + (event.key === 'ArrowDown' ? 1 : -1)));
            const element = viewport.current;
            if (!element) return;
            const height = element.clientHeight || 320;
            const top = 28 + next * rowHeight;
            if (top < element.scrollTop + 28) element.scrollTop = next * rowHeight;
            else if (top + rowHeight > element.scrollTop + height) element.scrollTop = top + rowHeight - height;
            focusTarget.current = next; setActiveRow(next); setViewportState({ top: element.scrollTop, height });
          }}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onEntryMenu?.(result.path, event.clientX, event.clientY); }}
          onClick={() => onOpen(result.path, result.line !== null && result.column !== null ? { line: result.line, column: result.column, length: result.length ?? 1 } : undefined)}>
          <span className="file-search-name">{isImageFile(result.path) ? <IconPhoto size={15} aria-hidden="true" /> : <IconFileCode size={15} aria-hidden="true" />}<strong>{result.path.split('/').pop()}</strong>{result.line !== null && <small>{result.line}:{result.column}</small>}</span>
          {mode === 'content' && <span className="file-search-snippet"><Snippet result={result} /></span>}
          <span className="file-search-path">{mode === 'name' ? <Snippet result={result} /> : result.path}</span>
        </button>
      </div>)}
    </div>
    {search.status === 'error' && <div className="files-message" role="alert">{search.error}<button className="text-button" onClick={search.retry}>重试搜索</button></div>}
    {search.loading && <div className="file-search-loading" role="status"><IconLoader2 size={14} className="spin" />{search.status === 'waiting' ? '准备搜索…' : '正在搜索…'}</div>}
    {!search.loading && search.status !== 'error' && !search.results.length && <div className="files-message">没有匹配的文件{mode === 'content' ? '内容' : ''}</div>}
    {progress && !progress.complete && !search.loading && search.status !== 'error' && <button className="file-search-more text-button" onClick={search.loadMore}>继续搜索，加载更多</button>}
    {progress?.truncated && <div className="files-message">已达到 1000 条结果上限，请缩小搜索范围。</div>}
    {mode === 'content' && <div className="file-search-limits">搜索已保存的 UTF-8 文件（≤2 MiB），每文件最多 20 处。{progress && (progress.skippedFiles > 0 || progress.limitedFiles > 0) ? ` 已跳过 ${progress.skippedFiles} 个不适用文件，${progress.limitedFiles} 个文件达到匹配上限。` : ''}</div>}
  </div>;
}
