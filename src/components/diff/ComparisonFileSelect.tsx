import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconCheck, IconChevronDown, IconFileCode } from '@tabler/icons-react';

export function ComparisonFileSelect({ files, selected, onSelect }: {
  files: readonly { path: string }[];
  selected: string;
  onSelect?: (path: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const paths = files.some(file => file.path === selected)
    ? files.map(file => file.path)
    : [selected, ...files.map(file => file.path)];
  const open = activeIndex !== null;
  const selectedIndex = paths.indexOf(selected);
  const active = Math.min(activeIndex ?? selectedIndex, paths.length - 1);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setActiveIndex(null);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
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
    onSelect?.(paths[index]);
    setActiveIndex(null);
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(null);
    } else if (event.key === 'Tab') {
      setActiveIndex(null);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') setActiveIndex(0);
      else if (event.key === 'End') setActiveIndex(paths.length - 1);
      else setActiveIndex(open ? Math.max(0, Math.min(paths.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))) : selectedIndex);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active);
      else setActiveIndex(selectedIndex);
    }
  };

  return <div className="comparison-file-select" ref={rootRef} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setActiveIndex(null);
  }}>
    <button type="button" className="comparison-file-trigger" role="combobox" aria-label="切换比对文件"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined} title={selected} disabled={!onSelect}
      onKeyDown={handleKey} onClick={() => setActiveIndex(open ? null : selectedIndex)}>
      <IconFileCode size={16} aria-hidden="true" /><span>{selected}</span>
      <IconChevronDown className="comparison-file-chevron" size={15} aria-hidden="true" />
    </button>
    {open && <div className="comparison-file-menu" role="listbox" aria-label="比对文件" id={listId} ref={listRef}>
      {paths.map((path, index) => <div key={path} id={`${listId}-${index}`} role="option"
        aria-selected={path === selected} className={`comparison-file-option ${index === active ? 'highlighted' : ''}`}
        title={path} onPointerMove={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()}
        onClick={() => choose(index)}>
        <IconFileCode size={15} aria-hidden="true" /><span>{path}</span>
        {path === selected && <IconCheck className="comparison-file-check" size={15} aria-hidden="true" />}
      </div>)}
    </div>}
  </div>;
}
