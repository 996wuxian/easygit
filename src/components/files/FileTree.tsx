import { useEffect, useRef, useState } from 'react';
import { IconChevronRight, IconFileCode, IconFolder, IconFolderOpen, IconLock, IconPhoto, IconRefresh, IconSearch } from '@tabler/icons-react';
import type { GitFile } from '../../services/git';
import { project, type FilePosition, type FileSearchMode, type ProjectEntry, type ProjectListing } from '../../services/project';
import { ProjectSearchResults } from './ProjectSearchResults';
import { isImageFile } from './imagePreview';
import { useFileActions, type FileActionsProps } from './useFileActions';
import './files.css';

interface TreeProps extends FileActionsProps {
  repository: string; files: GitFile[]; refreshKey: string; selected?: string; revision?: string;
  onOpen: (file: string, position?: FilePosition) => void;
}
interface DirectoryProps extends TreeProps { directory: string; showIgnored: boolean; query?: string; onEntryMenu?: (entry: ProjectEntry, x: number, y: number) => void }

function Directory(props: DirectoryProps) {
  const { repository, directory, showIgnored, query = '', refreshKey } = props;
  const [result, setResult] = useState<ProjectListing | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult(null); setError('');
    void project.files(repository, directory, showIgnored, query).then(value => { if (!cancelled) setResult(value); })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [repository, directory, showIgnored, query, refreshKey, retry]);
  if (error) return <div className="files-message" role="alert">{error}<button className="text-button" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!result) return <div className="files-message" role="status">正在读取文件…</div>;
  return <><ul className="project-tree-list" aria-label={directory || (query ? '文件搜索结果' : '项目根目录')}>
    {result.entries.map(entry => <Entry key={entry.path} {...props} entry={entry} />)}
  </ul>{!result.entries.length && <div className="files-message">{query ? '没有匹配的文件' : '此目录没有可显示的文件'}</div>}
    {result.truncated && <div className="files-message" role="status">仅显示前 200 项，请输入更具体的文件名。</div>}</>;
}

function Entry({ entry, ...props }: DirectoryProps & { entry: ProjectEntry }) {
  const [expanded, setExpanded] = useState(() => Boolean(entry.directory && props.selected?.startsWith(`${entry.path}/`)));
  const row = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (entry.directory && props.selected?.startsWith(`${entry.path}/`)) setExpanded(true);
  }, [entry.directory, entry.path, props.selected]);
  useEffect(() => {
    if (entry.directory || props.selected !== entry.path) return;
    const button = row.current;
    const viewport = button?.closest<HTMLElement>('.project-tree-scroll');
    if (!button || !viewport) return;
    const bounds = button.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    const offset = bounds.top < visible.top ? bounds.top - visible.top : bounds.bottom > visible.bottom ? bounds.bottom - visible.bottom : 0;
    if (offset) viewport.scrollTo({ top: viewport.scrollTop + offset, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [entry.directory, entry.path, props.selected]);
  const status = props.files.find(file => file.path === entry.path);
  const label = status?.conflicted ? '冲突' : status?.untracked || status?.indexStatus === 'A' ? '新增' : status?.indexStatus === 'R' || status?.worktreeStatus === 'R' ? '重命名' : status ? '修改' : entry.ignored ? '忽略' : '';
  const Icon = entry.blocked ? IconLock : entry.directory ? expanded ? IconFolderOpen : IconFolder : isImageFile(entry.path) ? IconPhoto : IconFileCode;
  return <li>
    <button ref={row} className={`project-tree-row${props.selected === entry.path ? ' selected' : ''}${entry.ignored ? ' ignored' : ''}`}
      title={entry.blocked ? `${entry.path}：链接、子模块或特殊文件请在外部打开` : entry.path}
      aria-label={`${entry.directory ? '目录' : '打开文件'} ${entry.path}${label ? ` · ${label}` : ''}`}
      aria-expanded={entry.directory ? expanded : undefined} aria-current={props.selected === entry.path ? 'true' : undefined}
      disabled={entry.blocked} onClick={() => entry.directory ? setExpanded(value => !value) : props.onOpen(entry.path)}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); props.onEntryMenu?.(entry, event.clientX, event.clientY); }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault(); event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          props.onEntryMenu?.(entry, bounds.left, bounds.bottom);
        }
      }}>
      {entry.directory ? <IconChevronRight size={13} className={expanded ? 'expanded' : ''} /> : <span className="tree-indent" />}
      <Icon size={16} stroke={1.6} /><span className="tree-file-name">{props.query ? entry.path : entry.name}</span>
      {label && <small className={status?.conflicted ? 'error-color' : ''}>{label}</small>}
    </button>
    {entry.directory && expanded && <Directory {...props} directory={entry.path} />}
  </li>;
}

export function FileTree(props: TreeProps) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FileSearchMode>('name');
  const [refresh, setRefresh] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const actions = useFileActions(props.repository, props, () => setRefresh(value => value + 1));
  const refreshKey = `${props.refreshKey}:${refresh}`;
  return <nav className="project-files" aria-label="项目文件浏览">
    <div className="files-toolbar">
      <div className="files-search-mode" role="group" aria-label="文件搜索方式"><button aria-pressed={mode === 'name'} onClick={() => setMode('name')}>文件名 / 路径</button><button aria-pressed={mode === 'content'} onClick={() => setMode('content')}>文件内容</button></div>
      <label className="file-filter"><IconSearch size={15} /><input aria-label="搜索项目文件" placeholder={mode === 'content' ? '搜索文件内容…' : '搜索文件名或路径…'} maxLength={256} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className="icon-button" aria-label="刷新项目文件" title="刷新目录与搜索结果" onClick={() => setRefresh(value => value + 1)}><IconRefresh size={16} /></button>
    </div>
    <div className="files-options"><label><input type="checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} />显示忽略文件</label><span>{mode === 'content' ? '搜索磁盘内容' : '工作区文件'}</span></div>
    {actions.feedback}
    <div ref={viewport} className="project-tree-scroll">{query.trim() ? <ProjectSearchResults repository={props.repository} query={query} mode={mode} showIgnored={showIgnored} refreshKey={`${refreshKey}:${mode === 'content' ? props.revision ?? '' : ''}`} selected={props.selected} viewport={viewport} onOpen={props.onOpen} onEntryMenu={(file, x, y) => actions.open({ path: file, directory: false }, x, y)} /> : <Directory {...props} directory="" showIgnored={showIgnored} refreshKey={refreshKey} onEntryMenu={actions.open} />}</div>
    {actions.overlays}
  </nav>;
}
