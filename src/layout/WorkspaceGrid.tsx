import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  IconActivity,
  IconArrowsMove,
  IconCode,
  IconFiles,
  IconGitBranch,
  IconHistory,
  IconGripVertical,
  IconPackage,
} from "@tabler/icons-react";
import { panelSlotSpan, visiblePanelIds, type PanelId, type PanelLayout } from "./model";
import "./layout.css";

export const PANEL_TITLES: Record<PanelId, string> = {
  changes: "工作区变更",
  diff: "代码差异",
  branches: "分支",
  commits: "提交记录",
  stash: "暂存架",
  activity: "操作记录",
};

const panelIcons = {
  changes: IconFiles,
  diff: IconCode,
  branches: IconGitBranch,
  commits: IconHistory,
  stash: IconPackage,
  activity: IconActivity,
};

interface DragSession {
  id: PanelId;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  target: PanelId | null;
  handle: HTMLButtonElement;
}

export interface WorkspaceGridProps {
  layout: PanelLayout;
  onMove: (active: PanelId, target: PanelId) => void;
  renderPanel: (id: PanelId) => ReactNode;
  panelActions?: (id: PanelId) => ReactNode;
  panelTitles?: Partial<Record<PanelId, string>>;
  className?: string;
}

export function WorkspaceGrid({ layout, onMove, renderPanel, panelActions, panelTitles, className = "" }: WorkspaceGridProps) {
  const ids = visiblePanelIds(layout);
  const [drag, setDrag] = useState<{ id: PanelId; target: PanelId | null; x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const session = useRef<DragSession | null>(null);
  const moveRef = useRef(onMove);
  const idsRef = useRef(ids);
  const gridRef = useRef<HTMLDivElement>(null);
  moveRef.current = onMove;
  idsRef.current = ids;

  useEffect(() => {
    const cancel = () => {
      const current = session.current;
      session.current = null;
      if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      document.body.classList.remove("eg-is-panel-dragging");
      setDrag(null);
    };
    const pointerMove = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 7) return;
      current.active = true;
      document.body.classList.add("eg-is-panel-dragging");
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-eg-panel]");
      const target = element && gridRef.current?.contains(element) ? element.dataset.egPanel as PanelId : null;
      current.target = target && target !== current.id && idsRef.current.includes(target) ? target : null;
      setDrag({ id: current.id, target: current.target, x: event.clientX, y: event.clientY });
      event.preventDefault();
    };
    const pointerUp = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
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
      if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      document.body.classList.remove("eg-is-panel-dragging");
    };
  }, []);

  return (
    <>
      <div className={`eg-workspace-grid ${className}`} ref={gridRef}>
        {ids.map((id, index) => {
          const Icon = panelIcons[id];
          const title = panelTitles?.[id] ?? PANEL_TITLES[id];
          const style = { "--eg-panel-span": panelSlotSpan(index, ids.length) } as CSSProperties;
          return (
            <section
              key={id}
              className={`eg-panel eg-panel--${id}${drag?.id === id ? " eg-panel--dragging" : ""}${drag?.target === id ? " eg-panel--drop-target" : ""}`}
              data-eg-panel={id}
              style={style}
              aria-labelledby={`eg-panel-heading-${id}`}
            >
              <header className="eg-panel-header">
                <div className="eg-panel-heading">
                  <Icon size={17} stroke={1.7} aria-hidden="true" />
                  <h2 id={`eg-panel-heading-${id}`}>{title}</h2>
                </div>
                <div className="eg-panel-header-actions">
                  {panelActions?.(id)}
                  <button
                    className="eg-panel-drag-handle"
                    type="button"
                    aria-label={`移动${title}面板`}
                    aria-describedby="eg-layout-instructions"
                    title="拖动调整位置 · Alt + 方向键移动"
                    onPointerDown={(event) => {
                      if (event.button !== 0 || !event.isPrimary || session.current) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      session.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, target: null, handle: event.currentTarget };
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
              <div className="eg-panel-content">{renderPanel(id)}</div>
              {drag?.target === id && <div className="eg-panel-drop-label"><IconArrowsMove size={15} />松开以交换位置</div>}
            </section>
          );
        })}
      </div>
      {drag && (
        <div className="eg-panel-drag-preview" style={{ left: drag.x + 16, top: drag.y + 16 }} aria-hidden="true">
          <IconArrowsMove size={16} />{panelTitles?.[drag.id] ?? PANEL_TITLES[drag.id]}
        </div>
      )}
      <span id="eg-layout-instructions" className="eg-sr-only">拖动面板标题栏右侧手柄交换位置，或按住 Alt 并使用方向键移动。按 Escape 取消拖动。</span>
      <span className="eg-sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  );
}
