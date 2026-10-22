import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import './select-menu.css';

export interface SelectOption { value: string; label: string; icon: ReactNode }

export function SelectMenu({ options, value, onChange, label, listLabel, className = '' }: {
  options: readonly SelectOption[]; value: string; onChange?: (value: string) => void;
  label: string; listLabel: string; className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const selected = options.find(option => option.value === value);
  const open = activeIndex !== null && Boolean(onChange) && options.length > 0;
  const active = Math.min(activeIndex ?? selectedIndex, options.length - 1);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const upwards = below < Math.min(320, options.length * 36 + 10) && above > below;
    setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      maxHeight: Math.min(320, Math.max(36, upwards ? above : below)),
      ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) setActiveIndex(null);
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !listRef.current?.contains(event.target)) setActiveIndex(null);
    };
    const close = () => setActiveIndex(null);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.children.item(active) as HTMLElement | null;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [open, active]);

  const choose = (index: number) => {
    if (options[index]) onChange?.(options[index].value);
    setActiveIndex(null);
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setActiveIndex(null);
    } else if (event.key === 'Tab') setActiveIndex(null);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') setActiveIndex(0);
      else if (event.key === 'End') setActiveIndex(options.length - 1);
      else setActiveIndex(open ? Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))) : selectedIndex);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active); else setActiveIndex(selectedIndex);
    }
  };

  return <div className={`select-control ${className}`} ref={rootRef} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget) && !listRef.current?.contains(event.relatedTarget)) setActiveIndex(null);
  }}>
    <button type="button" className="select-trigger" role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined} title={selected?.label} disabled={!onChange || !options.length}
      onKeyDown={handleKey} onClick={() => setActiveIndex(open ? null : selectedIndex)}>
      {selected?.icon}<span>{selected?.label ?? label}</span><IconChevronDown className="select-chevron" size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div className="select-menu" style={position} role="listbox" aria-label={listLabel} id={listId} ref={listRef}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} className={`select-option ${index === active ? 'highlighted' : ''}`}
        title={option.label} onPointerMove={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()}
        onClick={() => choose(index)}>
        {option.icon}<span>{option.label}</span>{option.value === value && <IconCheck className="select-check" size={15} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </div>;
}
