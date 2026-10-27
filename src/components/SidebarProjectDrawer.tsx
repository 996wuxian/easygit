import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react';
import type { RecentRepository } from '../services/useRepository';
import './sidebar-projects.css';

export function SidebarProjectDrawer({ projects, selected, busy, sidebarRef, onOpen }: {
  projects: RecentRepository[]; selected: string; busy: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  onOpen: (path: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useId();
  const expandable = projects.length >= 6;
  const visible = expandable && open;
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => { if (!expandable) setOpen(false); }, [expandable]);
  useEffect(() => {
    if (!visible) return;
    const selectedRow = panel.current?.querySelector<HTMLButtonElement>('[aria-current="page"]') ?? panel.current?.querySelector<HTMLButtonElement>('.repository-expanded-item');
    selectedRow?.focus({ preventScroll: true });
    selectedRow?.scrollIntoView?.({ block: 'nearest' });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault(); close(true);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key);
    };
  }, [visible, close]);

  if (!expandable) return null;
  return <>
    <button ref={trigger} type="button" className={`repository-expand-toggle${visible ? ' expanded' : ''}`} aria-label={visible ? '收起项目列表' : '展开项目列表'} title={visible ? '收起项目列表' : `展开全部 ${projects.length} 个项目`} aria-expanded={visible} aria-controls={visible ? id : undefined} onClick={() => setOpen(value => !value)}>
      {visible ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />}
    </button>
    {visible && sidebarRef.current && createPortal(<section ref={panel} id={id} className="repository-expanded-panel" aria-label="项目展开区域">
      <header className="repository-expanded-heading"><strong>全部项目</strong><span>{projects.length}</span><button type="button" className="repository-expanded-close" aria-label="关闭项目展开区域" title="收起 · Esc" onClick={() => close(true)}><IconX size={16} /></button></header>
      <nav className="repository-expanded-list" aria-label="全部项目列表">
        {projects.map(project => <button type="button" className={`repository-expanded-item${project.path === selected ? ' selected' : ''}`} key={project.path} aria-label={`切换到项目 ${project.name}`} aria-current={project.path === selected ? 'page' : undefined} title={`${project.name}\n${project.path}`} disabled={busy} onClick={() => { void onOpen(project.path); }}>
          <span className="repository-expanded-initial" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span><span className="repository-expanded-name">{project.name}</span>
        </button>)}
      </nav>
    </section>, sidebarRef.current)}
  </>;
}
