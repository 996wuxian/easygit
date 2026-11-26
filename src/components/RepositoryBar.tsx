import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronLeft, IconChevronRight, IconPlus, IconX } from '@tabler/icons-react';
import type { RecentRepository } from '../services/useRepository';

type RepositoryPress = {
  path: string; pointerId: number; startX: number; startY: number;
  timer: number; started: boolean; targetPath: string | null; element: HTMLButtonElement;
};

interface RepositoryBarProps {
  workspaces: RecentRepository[];
  selectedPath: string;
  busy: boolean;
  onOpen: (path: string) => void | Promise<void>;
  onRemove: (workspace: RecentRepository) => void;
  onAdd: () => void;
  onMove: (fromPath: string, toPath: string) => void;
}

export const RepositoryBar = memo(function RepositoryBar({
  workspaces, selectedPath, busy, onOpen, onRemove, onAdd, onMove,
}: RepositoryBarProps) {
  const [repositoryTooltip, setRepositoryTooltip] = useState<{ name: string; path: string; left: number; top: number } | null>(null);
  const [draggingRepository, setDraggingRepository] = useState<string | null>(null);
  const [dropTargetRepository, setDropTargetRepository] = useState<string | null>(null);
  const [repositoryScroll, setRepositoryScroll] = useState({ canLeft: false, canRight: false });
  const repositoryPress = useRef<RepositoryPress | null>(null);
  const suppressRepositoryClick = useRef(false);
  const repositoryListRef = useRef<HTMLDivElement>(null);

  const updateRepositoryScroll = useCallback(() => {
    const list = repositoryListRef.current;
    if (!list) return;
    const next = { canLeft: list.scrollLeft > 1, canRight: list.scrollLeft + list.clientWidth < list.scrollWidth - 1 };
    setRepositoryScroll(current => current.canLeft === next.canLeft && current.canRight === next.canRight ? current : next);
  }, []);

  const ensureSelectedRepositoryVisible = useCallback(() => {
    const list = repositoryListRef.current;
    const entry = list?.querySelector<HTMLElement>('.repository-entry.selected');
    if (!list || !entry || list.clientWidth <= 0) return;
    const padding = 8;
    const left = entry.offsetLeft;
    const right = left + entry.offsetWidth;
    const viewLeft = list.scrollLeft;
    const viewRight = viewLeft + list.clientWidth;
    if (left - padding < viewLeft) {
      list.scrollLeft = Math.max(0, left - padding);
    } else if (right + padding > viewRight) {
      list.scrollLeft = Math.max(0, right + padding - list.clientWidth);
    }
    updateRepositoryScroll();
  }, [updateRepositoryScroll]);

  const hasRepositoryOverflow = repositoryScroll.canLeft || repositoryScroll.canRight;

  function scrollRepositories(direction: -1 | 1) {
    repositoryListRef.current?.scrollBy({ left: direction * 200, behavior: 'smooth' });
  }

  function startRepositoryPress(workspace: RecentRepository, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (repositoryPress.current) window.clearTimeout(repositoryPress.current.timer);
    const element = event.currentTarget;
    const press: RepositoryPress = {
      path: workspace.path,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
      started: false,
      targetPath: workspace.path,
      element,
    };
    repositoryPress.current = press;
    press.timer = window.setTimeout(() => {
      if (repositoryPress.current !== press) return;
      press.started = true;
      setDraggingRepository(press.path);
      setDropTargetRepository(press.path);
      try { press.element.setPointerCapture(press.pointerId); } catch { /* pointer may have been cancelled */ }
    }, 360);
  }

  function showRepositoryTooltip(workspace: RecentRepository, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    setRepositoryTooltip({
      name: workspace.name,
      path: workspace.path,
      left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 272)),
      top: rect.bottom + 8,
    });
  }

  useEffect(() => {
    if (busy) setRepositoryTooltip(null);
  }, [busy]);

  useEffect(() => {
    setRepositoryTooltip(null);
  }, [workspaces]);

  useEffect(() => {
    const list = repositoryListRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth) return;
      if (event.deltaY === 0 || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY;
      updateRepositoryScroll();
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => list.removeEventListener('wheel', onWheel);
  }, [updateRepositoryScroll]);

  useEffect(() => {
    if (!selectedPath) return;
    ensureSelectedRepositoryVisible();
    const frame = window.requestAnimationFrame(ensureSelectedRepositoryVisible);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPath, workspaces, hasRepositoryOverflow, ensureSelectedRepositoryVisible]);

  useEffect(() => {
    updateRepositoryScroll();
    const list = repositoryListRef.current;
    const onResize = () => {
      updateRepositoryScroll();
      ensureSelectedRepositoryVisible();
    };
    if (list && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(onResize);
      observer.observe(list);
      if (list.firstElementChild) observer.observe(list.firstElementChild);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateRepositoryScroll, ensureSelectedRepositoryVisible, workspaces.length]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const press = repositoryPress.current;
      if (!press || event.pointerId !== press.pointerId) return;
      if (!press.started) {
        if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 8) {
          window.clearTimeout(press.timer);
          repositoryPress.current = null;
        }
        return;
      }
      const entry = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-repository-path]');
      press.targetPath = entry?.dataset.repositoryPath ?? null;
      setDropTargetRepository(press.targetPath);
      event.preventDefault();
    };
    const finish = (event: PointerEvent, cancelled = false) => {
      const press = repositoryPress.current;
      if (!press || event.pointerId !== press.pointerId) return;
      window.clearTimeout(press.timer);
      repositoryPress.current = null;
      if (press.started && !cancelled) {
        suppressRepositoryClick.current = true;
        if (press.targetPath) onMove(press.path, press.targetPath);
        window.setTimeout(() => { suppressRepositoryClick.current = false; }, 0);
      }
      setDraggingRepository(null);
      setDropTargetRepository(null);
    };
    const up = (event: PointerEvent) => finish(event);
    const cancel = (event: PointerEvent) => finish(event, true);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (repositoryPress.current) {
        window.clearTimeout(repositoryPress.current.timer);
        if (!repositoryPress.current.started) repositoryPress.current = null;
      }
    };
  }, [onMove]);

  return <>
    <div className="repository-navigation" aria-label="仓库列表">
      {hasRepositoryOverflow && <button className="repository-scroll-button" title="向左滚动仓库列表" aria-label="向左滚动仓库列表" disabled={!repositoryScroll.canLeft} onClick={() => scrollRepositories(-1)}><IconChevronLeft size={15} /></button>}
      <div className="repository-list-scroll" ref={repositoryListRef} onScroll={updateRepositoryScroll}>
        <div className="repository-list">
          {workspaces.length === 0 && <span className="repository-empty-hint">暂无打开过的项目</span>}
          {workspaces.map(item => <div className={`repository-entry ${selectedPath === item.path ? 'selected' : ''} ${draggingRepository === item.path ? 'dragging' : ''} ${dropTargetRepository === item.path && draggingRepository !== item.path ? 'drag-over' : ''}`} data-repository-path={item.path} key={item.path}>
            <button className={`repository-item ${selectedPath === item.path ? 'selected' : ''}`} aria-label={`打开仓库 ${item.name}`} aria-current={selectedPath === item.path ? 'page' : undefined} aria-describedby={repositoryTooltip?.path === item.path ? 'repository-tooltip' : undefined} disabled={busy} onPointerDown={event => startRepositoryPress(item, event)} onContextMenu={event => event.preventDefault()} onMouseEnter={event => showRepositoryTooltip(item, event.currentTarget)} onMouseLeave={() => setRepositoryTooltip(null)} onFocus={event => showRepositoryTooltip(item, event.currentTarget)} onBlur={() => setRepositoryTooltip(null)} onClick={event => { if (suppressRepositoryClick.current) { event.preventDefault(); suppressRepositoryClick.current = false; return; } void onOpen(item.path); }}><span className="repository-item-initial" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><span className="repository-item-name">{item.name}</span></button>
            <button className="repository-remove" aria-label={`移除工作区 ${item.name}`} title="从 easygit 移除工作区" disabled={busy} onClick={() => onRemove(item)}><IconX size={12} /></button>
          </div>)}
        </div>
      </div>
      {hasRepositoryOverflow && <button className="repository-scroll-button" title="向右滚动仓库列表" aria-label="向右滚动仓库列表" disabled={!repositoryScroll.canRight} onClick={() => scrollRepositories(1)}><IconChevronRight size={15} /></button>}
      <button className="repository-add-button" title="打开本地仓库 · Ctrl O" aria-label="打开本地仓库" onClick={onAdd}><IconPlus size={16} /></button>
    </div>
    {repositoryTooltip && createPortal(<div id="repository-tooltip" className="repository-tooltip" role="tooltip" style={{ left: repositoryTooltip.left, top: repositoryTooltip.top }}><strong>{repositoryTooltip.name}</strong><small>{repositoryTooltip.path}</small></div>, document.body)}
  </>;
});
