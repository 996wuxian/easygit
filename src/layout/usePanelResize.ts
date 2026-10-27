import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { clampPanelSize, panelSlotSpan, type PanelId, type PanelSize } from './model';

export type ResizeAxis = 'width' | 'height';
type SaveSize = (id: PanelId, size: PanelSize | null) => void;
interface Target {
  id: PanelId; panel: HTMLElement; content: HTMLElement; size: PanelSize;
  span: string; height: string; maxHeight: string; overflow: string; flex: string;
}
interface Alignment { position: number; start: number; end: number }
const SNAP_DISTANCE = 8;
const SNAP_RELEASE_DISTANCE = 14;
interface ResizeSession {
  pointerId: number; handle: HTMLElement; axis: ResizeAxis;
  startX: number; startY: number; x: number; y: number; columnWidth: number;
  primary: Target; neighbor?: Target; size: PanelSize; neighborSize?: PanelSize;
  minSpan: number; maxSpan: number; frame: number | null; painted: boolean;
  bounds: DOMRect; rootBounds: DOMRect; alignments: Alignment[];
  snapped: Alignment | null; guide: HTMLDivElement | null;
}

function findAlignment(position: number, alignments: Alignment[], previous: Alignment | null, minimum: number, maximum: number): Alignment | null {
  if (previous && Math.abs(position - previous.position) <= SNAP_RELEASE_DISTANCE) return previous;
  let closest: Alignment | null = null;
  for (const candidate of alignments) {
    if (candidate.position < minimum || candidate.position > maximum || Math.abs(position - candidate.position) > SNAP_DISTANCE) continue;
    if (!closest || Math.abs(position - candidate.position) < Math.abs(position - closest.position)) closest = candidate;
  }
  return closest;
}

function showAlignment(current: ResizeSession) {
  const { guide, snapped, axis, bounds, rootBounds } = current;
  if (snapped) current.primary.panel.dataset.egResizeSnapped = 'true';
  else delete current.primary.panel.dataset.egResizeSnapped;
  if (!guide) return;
  if (!snapped) { guide.hidden = true; return; }
  const matching = current.alignments.filter(candidate => Math.abs(candidate.position - snapped.position) < .5);
  const start = Math.min(axis === 'width' ? bounds.top : bounds.left, ...matching.map(candidate => candidate.start));
  const end = Math.max(axis === 'width' ? bounds.bottom : bounds.right, ...matching.map(candidate => candidate.end));
  guide.dataset.axis = axis;
  guide.style.left = `${(axis === 'width' ? snapped.position : start) - rootBounds.left}px`;
  guide.style.top = `${(axis === 'width' ? start : snapped.position) - rootBounds.top}px`;
  guide.style.width = axis === 'width' ? '1px' : `${end - start}px`;
  guide.style.height = axis === 'width' ? `${end - start}px` : '1px';
  guide.hidden = false;
}

function readTarget(panel: HTMLElement, fallbackSpan: number): Target | null {
  const content = panel.querySelector<HTMLElement>('.eg-panel-content');
  if (!content) return null;
  const effectiveSpan = parseFloat(getComputedStyle(panel).getPropertyValue('--eg-panel-effective-span'));
  return {
    id: panel.dataset.egPanel as PanelId, panel, content,
    size: clampPanelSize({ span: effectiveSpan || parseFloat(panel.style.getPropertyValue('--eg-panel-span')) || fallbackSpan, height: content.clientHeight || parseFloat(content.style.height) || 320 }),
    span: panel.style.getPropertyValue('--eg-panel-span'), height: content.style.height,
    maxHeight: content.style.maxHeight, overflow: content.style.overflow, flex: content.style.flex,
  };
}

function paint(target: Target, size: PanelSize) {
  target.panel.classList.add('eg-panel--resizing');
  target.panel.style.setProperty('--eg-panel-span', String(size.span));
  target.content.style.height = `${size.height}px`;
  target.content.style.maxHeight = 'none';
  target.content.style.overflow = 'auto';
  target.content.style.flex = '0 0 auto';
}

function restore(target: Target) {
  target.panel.classList.remove('eg-panel--resizing');
  target.panel.style.setProperty('--eg-panel-span', target.span);
  target.content.style.height = target.height;
  target.content.style.maxHeight = target.maxHeight;
  target.content.style.overflow = target.overflow;
  target.content.style.flex = target.flex;
}

function update(current: ResizeSession) {
  const { primary, neighbor, axis } = current;
  const edge = axis === 'width' ? current.bounds.right : current.bounds.bottom;
  const delta = axis === 'width' ? current.x - current.startX : current.y - current.startY;
  const minimum = axis === 'width' ? edge + (current.minSpan - primary.size.span) * current.columnWidth : edge + 180 - primary.size.height;
  const maximum = axis === 'width' ? edge + (current.maxSpan - primary.size.span) * current.columnWidth : edge + 1200 - primary.size.height;
  current.snapped = findAlignment(edge + delta, current.alignments, current.snapped, minimum, maximum);
  showAlignment(current);
  const movement = current.snapped ? current.snapped.position - edge : delta;
  const span = Math.max(current.minSpan, Math.min(current.maxSpan, primary.size.span + movement / current.columnWidth));
  const size = clampPanelSize({ span: axis === 'width' ? span : primary.size.span, height: primary.size.height + (axis === 'height' ? movement : 0) });
  if (size.span === current.size.span && size.height === current.size.height) return;
  current.size = size;
  if (neighbor) {
    current.neighborSize = clampPanelSize({ ...neighbor.size, span: primary.size.span + neighbor.size.span - size.span });
    paint(neighbor, current.neighborSize);
  }
  paint(primary, size);
  current.painted = true;
}

// Pointer moves only write the affected panels' styles, at most once per frame.
// React and persistent storage are updated once when the pointer is released.
export function usePanelResize(grid: RefObject<HTMLDivElement | null>, onResize?: SaveSize) {
  const session = useRef<ResizeSession | null>(null);
  const guide = useRef<HTMLDivElement>(null);
  const save = useRef(onResize);
  save.current = onResize;

  const capture = useCallback((panel: HTMLElement, axis: ResizeAxis) => {
    const root = grid.current;
    if (!root) return null;
    const panels = Array.from(root.querySelectorAll<HTMLElement>(':scope > [data-eg-panel]'));
    const index = panels.indexOf(panel);
    const primary = readTarget(panel, panelSlotSpan(index, panels.length));
    if (!primary) return null;
    const gap = parseFloat(getComputedStyle(root).columnGap) || 16;
    const bounds = panel.getBoundingClientRect();
    const rootBounds = root.getBoundingClientRect();
    const columnWidth = Math.max(1, (root.clientWidth + gap) / 12);
    const availableSpan = rootBounds.width > 0 && bounds.width > 0 ? Math.max(3, Math.min(12, Math.round((rootBounds.right - bounds.left + gap) / columnWidth * 1000) / 1000)) : 12;
    // Capture geometry once. Pointer frames only use these coordinates, avoiding
    // layout reads between style writes while the panels are being resized.
    const others = panels.filter(node => node !== panel).map(node => ({ node, bounds: node.getBoundingClientRect() }));
    const next = axis === 'width' && bounds.width > 0 ? others.find(other => Math.abs(other.bounds.top - bounds.top) < 1 && Math.abs(other.bounds.left - bounds.right - gap) < 2)?.node : undefined;
    const neighbor = next ? readTarget(next, panelSlotSpan(panels.indexOf(next), panels.length)) ?? undefined : undefined;
    const alignments = others.filter(other => other.node !== next && other.bounds.width > 0 && other.bounds.height > 0 && (axis === 'width' ? Math.abs(other.bounds.top - bounds.top) >= 1 : Math.abs(other.bounds.top - bounds.top) < 1)).map(other => ({
      position: axis === 'width' ? other.bounds.right : other.bounds.bottom,
      start: axis === 'width' ? other.bounds.top : other.bounds.left,
      end: axis === 'width' ? other.bounds.bottom : other.bounds.right,
    }));
    return { primary, neighbor, bounds, rootBounds, alignments, minSpan: neighbor ? Math.max(3, primary.size.span + neighbor.size.span - 12) : 3, maxSpan: neighbor ? Math.min(12, primary.size.span + neighbor.size.span - 3) : availableSpan, columnWidth };
  }, [grid]);

  const finish = useCallback((commit: boolean) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    if (commit) update(current);
    const accepted = commit && current.painted && Boolean(save.current);
    for (const target of [current.primary, current.neighbor]) {
      if (!target) continue;
      if (accepted) {
        // Keep the final preview until React commits the saved size, avoiding a
        // flash back to the old dimensions on pointer release.
        target.panel.classList.remove('eg-panel--resizing');
        target.panel.classList.add('eg-panel--sized');
      } else restore(target);
    }
    delete current.primary.panel.dataset.egResizingAxis;
    delete current.primary.panel.dataset.egResizeSnapped;
    if (current.guide) current.guide.hidden = true;
    document.body.classList.remove('eg-is-panel-resizing');
    document.body.style.removeProperty('--eg-resize-cursor');
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (accepted) {
      save.current?.(current.primary.id, current.size);
      if (current.neighbor && current.neighborSize) save.current?.(current.neighbor.id, current.neighborSize);
    }
  }, []);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const current = session.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      current.x = event.clientX; current.y = event.clientY;
      if (current.frame !== null) return;
      current.frame = requestAnimationFrame(() => {
        current.frame = null;
        if (session.current === current) update(current);
      });
    };
    const end = (event: globalThis.PointerEvent) => {
      const current = session.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      finish(true);
    };
    const cancel = () => finish(false);
    const pointerCancel = (event: globalThis.PointerEvent) => { if (session.current?.pointerId === event.pointerId) cancel(); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && session.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      cancel();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [finish]);

  const start = (event: PointerEvent<HTMLElement>, axis: ResizeAxis) => {
    if (event.button !== 0 || !event.isPrimary || session.current || !save.current || document.body.classList.contains('eg-is-panel-dragging')) return;
    const panel = event.currentTarget.closest<HTMLElement>('[data-eg-panel]');
    const measured = panel && capture(panel, axis);
    if (!measured) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = { ...measured, axis, pointerId: event.pointerId, handle: event.currentTarget, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, size: measured.primary.size, frame: null, painted: false, snapped: null, guide: guide.current };
    measured.primary.panel.dataset.egResizingAxis = axis;
    document.body.classList.add('eg-is-panel-resizing');
    document.body.style.setProperty('--eg-resize-cursor', axis === 'width' ? 'col-resize' : 'row-resize');
  };

  const keyboard = (event: KeyboardEvent<HTMLElement>, id: PanelId, axis: ResizeAxis) => {
    if (!save.current || session.current) return;
    if (event.key === 'Home') { event.preventDefault(); save.current(id, null); return; }
    const direction = axis === 'width' ? event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0 : event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const panel = event.currentTarget.closest<HTMLElement>('[data-eg-panel]');
    const measured = panel && capture(panel, axis);
    if (!measured) return;
    const size = clampPanelSize({ span: axis === 'width' ? Math.max(measured.minSpan, Math.min(measured.maxSpan, measured.primary.size.span + direction)) : measured.primary.size.span, height: measured.primary.size.height + (axis === 'height' ? direction * 24 : 0) });
    save.current(id, size);
    if (measured.neighbor) save.current(measured.neighbor.id, clampPanelSize({ ...measured.neighbor.size, span: measured.primary.size.span + measured.neighbor.size.span - size.span }));
  };

  return { start, keyboard, guide, cancel: () => finish(false) };
}
