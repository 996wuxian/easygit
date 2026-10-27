import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  IconActivity,
  IconArrowsMove,
  IconCode,
  IconFiles,
  IconGitBranch,
  IconHistory,
  IconGripVertical,
  IconPackage,
  IconTerminal2,
  IconFolder,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react";
import { panelSlotSpan, visiblePanelIds, type PanelId, type PanelLayout, type PanelSize } from "./model";
import { usePanelResize } from './usePanelResize';
import "./layout.css";

export const PANEL_TITLES: Record<PanelId, string> = {
  changes: "工作区变更",
  diff: "代码差异",
  branches: "分支",
  commits: "提交记录",
  stash: "暂存架",
  activity: "操作记录",
  scripts: "项目脚本",
  files: "项目文件",
};

const panelIcons = {
  changes: IconFiles,
  diff: IconCode,
  branches: IconGitBranch,
  commits: IconHistory,
  stash: IconPackage,
  activity: IconActivity,
  scripts: IconTerminal2,
  files: IconFolder,
};

const PanelContent = memo(function PanelContent({ id, renderPanel }: { id: PanelId; renderPanel: (id: PanelId) => ReactNode }) {
  return <>{renderPanel(id)}</>;
});

interface DragSession {
  id: PanelId;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: PanelId | null;
  handle: HTMLButtonElement;
}

export interface WorkspaceGridProps {
  layout: PanelLayout;
  onMove: (active: PanelId, target: PanelId) => void;
  onResize?: (id: PanelId, size: PanelSize | null) => void;
  renderPanel: (id: PanelId) => ReactNode;
  panelActions?: (id: PanelId) => ReactNode;
  panelTitles?: Partial<Record<PanelId, string>>;
  className?: string;
}

export function WorkspaceGrid({ layout, onMove, onResize, renderPanel, panelActions, panelTitles, className = "" }: WorkspaceGridProps) {
  const ids = visiblePanelIds(layout);
  const [drag, setDrag] = useState<{ id: PanelId; target: PanelId | null; x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const session = useRef<DragSession | null>(null);
  const moveRef = useRef(onMove);
  const idsRef = useRef(ids);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragPreview = useRef<HTMLDivElement>(null);
  const dragFrame = useRef<number | null>(null);
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const resize = usePanelResize(gridRef, onResize);
  moveRef.current = onMove;
  idsRef.current = ids;

  useEffect(() => {
    if (maximized && !ids.includes(maximized)) setMaximized(null);
  }, [maximized, ids.join(',')]);
  useEffect(() => {
    if (!maximized) return;
    const panel = gridRef.current?.querySelector<HTMLElement>(`[data-eg-panel="${maximized}"]`);
    const previous = document.activeElement as HTMLElement | null;
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length && dialogs.item(dialogs.length - 1) !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); setMaximized(null); }
      if (event.key === 'Tab' && panel) {
        const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex="0"]')).filter(node => node.getClientRects().length);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    panel?.querySelector<HTMLButtonElement>('.eg-panel-maximize')?.focus();
    window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('keydown', keyDown); previous?.focus({ preventScroll: true }); };
  }, [maximized]);

  useEffect(() => {
    const cancel = () => {
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
      const current = session.current;
      session.current = null;
      if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      document.body.classList.remove("eg-is-panel-dragging");
      setDrag(null);
    };
    const paintDrag = () => {
      dragFrame.current = null;
      const current = session.current;
      if (!current) return;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) < 7) return;
      const started = !current.active;
      current.active = true;
      document.body.classList.add("eg-is-panel-dragging");
      const element = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>("[data-eg-panel]");
      const target = element && gridRef.current?.contains(element) ? element.dataset.egPanel as PanelId : null;
      const next = target && target !== current.id && idsRef.current.includes(target) ? target : null;
      if (started || next !== current.target) setDrag({ id: current.id, target: next, x: current.x, y: current.y });
      current.target = next;
      if (dragPreview.current) dragPreview.current.style.transform = `translate3d(${current.x + 16}px, ${current.y + 16}px, 0)`;
    };
    const pointerMove = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(paintDrag);
      event.preventDefault();
    };
    const pointerUp = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      paintDrag();
      if (current.active && current.target) {
        moveRef.current(current.id, current.target);
        setAnnouncement(`已将${PANEL_TITLES[current.id]}移动到${PANEL_TITLES[current.target]}的位置`);
      }
      cancel();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.current) {
        event.preventDefault();
        cancel();
        setAnnouncement("已取消面板移动");
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      if (session.current?.pointerId === event.pointerId) cancel();
    };
    window.addEventListener("pointermove", pointerMove, { passive: false });
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("blur", cancel);
      const current = session.current;
      session.current = null;
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
      if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      document.body.classList.remove("eg-is-panel-dragging");
    };
  }, []);

  return (
    <>
      {maximized && <div className="eg-panel-backdrop" onClick={() => setMaximized(null)} />}
      <div className={`eg-workspace-grid ${className}`} ref={gridRef}>
        {ids.map((id, index) => {
          const Icon = panelIcons[id];
          const title = panelTitles?.[id] ?? PANEL_TITLES[id];
          const size = layout.sizes?.[id];
          const full = maximized === id;
          const style = { "--eg-panel-span": size?.span ?? panelSlotSpan(index, ids.length) } as CSSProperties;
          return (
            <section
              key={id}
              className={`eg-panel eg-panel--${id}${size ? ' eg-panel--sized' : ''}${full ? ' eg-panel--maximized' : ''}${drag?.id === id ? " eg-panel--dragging" : ""}${drag?.target === id ? " eg-panel--drop-target" : ""}`}
              data-eg-panel={id}
              style={style}
              aria-labelledby={`eg-panel-heading-${id}`}
              role={full ? 'dialog' : undefined}
              aria-modal={full ? true : undefined}
              inert={maximized && !full ? true : undefined}
            >
              <header className="eg-panel-header">
                <div className="eg-panel-heading">
                  <Icon size={17} stroke={1.7} aria-hidden="true" />
                  <h2 id={`eg-panel-heading-${id}`}>{title}</h2>
                </div>
                <div className="eg-panel-header-actions">
                  {panelActions?.(id)}
                  <button className="icon-button eg-panel-maximize" aria-label={`${full ? '还原' : '最大化'}${title}面板`} title={full ? '还原面板 · Esc' : '最大化面板'} aria-pressed={full} onClick={() => setMaximized(full ? null : id)}>{full ? <IconMinimize size={16} /> : <IconMaximize size={16} />}</button>
                  <button
                    className="eg-panel-drag-handle"
                    type="button"
                    aria-label={`移动${title}面板`}
                    aria-describedby="eg-layout-instructions"
                    title="拖动调整位置 · Alt + 方向键移动"
                    disabled={full}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || !event.isPrimary || session.current || document.body.classList.contains('eg-is-panel-resizing')) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      session.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null, handle: event.currentTarget };
                    }}
                    onKeyDown={(event) => {
                      if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault();
                      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
                      const target = ids[index + direction];
                      if (!target) return;
                      onMove(id, target);
                      setAnnouncement(`已将${title}移动到第 ${index + direction + 1} 个位置`);
                    }}
                  >
                    <IconGripVertical size={17} stroke={1.7} aria-hidden="true" />
                  </button>
                </div>
              </header>
              <div className="eg-panel-content" style={full ? { height: 'auto', maxHeight: 'none', overflow: 'auto', flex: '1 1 0' } : size ? { height: size.height, maxHeight: 'none', overflow: 'auto', flex: '0 0 auto' } : undefined}><PanelContent id={id} renderPanel={renderPanel} /></div>
              {onResize && !full && <>
                <div className="eg-panel-resize-edge eg-panel-resize-edge--right" role="separator" aria-orientation="vertical" aria-label={`调整${title}面板宽度`} tabIndex={0} title="拖动边框调整宽度 · 左右方向键调整 · 双击恢复默认" onPointerDown={event => resize.start(event, 'width')} onLostPointerCapture={resize.cancel} onDoubleClick={() => onResize(id, null)} onKeyDown={event => resize.keyboard(event, id, 'width')} />
                <div className="eg-panel-resize-edge eg-panel-resize-edge--bottom" role="separator" aria-orientation="horizontal" aria-label={`调整${title}面板高度`} tabIndex={0} title="拖动边框调整高度 · 上下方向键调整 · 双击恢复默认" onPointerDown={event => resize.start(event, 'height')} onLostPointerCapture={resize.cancel} onDoubleClick={() => onResize(id, null)} onKeyDown={event => resize.keyboard(event, id, 'height')} />
              </>}
              {drag?.target === id && <div className="eg-panel-drop-label"><IconArrowsMove size={15} />松开以交换位置</div>}
            </section>
          );
        })}
        <div ref={resize.guide} className="eg-panel-alignment-guide" hidden aria-hidden="true" />
      </div>
      {drag && (
        <div ref={dragPreview} className="eg-panel-drag-preview" style={{ transform: `translate3d(${drag.x + 16}px, ${drag.y + 16}px, 0)` }} aria-hidden="true">
          <IconArrowsMove size={16} />{panelTitles?.[drag.id] ?? PANEL_TITLES[drag.id]}
        </div>
      )}
      <span id="eg-layout-instructions" className="eg-sr-only">拖动面板标题栏右侧手柄交换位置，或按住 Alt 并使用方向键移动。按 Escape 取消拖动。</span>
      <span className="eg-sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  );
}
