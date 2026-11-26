import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronRight, IconFileCode, IconFolder, IconFolderOpen, IconLock, IconPhoto, IconRefresh, IconSearch } from '@tabler/icons-react';
import type { GitFile } from '../../services/git';
import { project, type FilePosition, type FileSearchMode, type ProjectEntry, type ProjectListing } from '../../services/project';
import { ProjectSearchResults } from './ProjectSearchResults';
import { canLocateFileChange, type ProjectFileTarget } from './fileChanges';
import { isImageFile } from './imagePreview';
import { useFileActions, type FileActionsProps } from './useFileActions';
import './files.css';

interface TreeProps extends FileActionsProps {
  repository: string; files: GitFile[]; refreshKey: string; selected?: string; revision?: string;
  revealChanges?: boolean;
  changeTarget?: ProjectFileTarget;
  onOpen: (file: string, position?: FilePosition) => void;
}
interface DirectoryProps extends TreeProps {
  directory: string; showIgnored: boolean; query?: string;
  fileStatusMap: Map<string, GitFile>;
  changedDirectories?: ReadonlySet<string>;
  onEntryMenu?: (entry: ProjectEntry, x: number, y: number) => void;
}

function Directory(props: DirectoryProps) {
  const { repository, directory, showIgnored, query = '', refreshKey, changedDirectories } = props;
  // Git can track a file inside a directory whose name is ignored.
  const includeIgnored = showIgnored || (directory ? changedDirectories?.has(directory) === true : Boolean(changedDirectories?.size));
  const scopeKey = JSON.stringify([repository, directory, showIgnored, query]);
  const [state, setState] = useState<{ scopeKey: string; listing: ProjectListing } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void project.files(repository, directory, includeIgnored, query).then(value => {
      if (!cancelled) setState({ scopeKey, listing: value });
    }).catch(reason => {
      if (!cancelled) setError(String(reason));
    });
    return () => { cancelled = true; };
  }, [repository, directory, includeIgnored, query, scopeKey, refreshKey, retry]);
  const result = state?.scopeKey === scopeKey ? state.listing : null;
  if (error) return <div className="files-message" role="alert">{error}<button className="text-button" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!result) return <div className="files-message" role="status">正在读取文件…</div>;
  const entries = showIgnored ? result.entries : result.entries.filter(entry => !entry.ignored || changedDirectories?.has(entry.path));
  return <><ul className="project-tree-list" aria-label={directory || (query ? '文件搜索结果' : '项目根目录')}>
    {entries.map(entry => <Entry key={entry.path} {...props} entry={entry} />)}
  </ul>{!entries.length && <div className="files-message">{query ? '没有匹配的文件' : '此目录没有可显示的文件'}</div>}
    {result.truncated && <div className="files-message" role="status">仅显示前 200 项，请输入更具体的文件名。</div>}</>;
}

function Entry({ entry, ...props }: DirectoryProps & { entry: ProjectEntry }) {
  const canExpand = entry.directory && !entry.blocked;
  const revealChangedDirectory = canExpand && props.changedDirectories?.has(entry.path);
  const targetWithinDirectory = canExpand && props.changeTarget?.path.startsWith(`${entry.path}/`) ? props.changeTarget : undefined;
  const target = props.changeTarget?.path === entry.path ? props.changeTarget : undefined;
  const selected = props.selected === entry.path;
  const selectedPath = !props.changeTarget && !entry.directory && selected ? entry.path : undefined;
  const [expanded, setExpanded] = useState(() => Boolean(revealChangedDirectory || targetWithinDirectory || canExpand && props.selected?.startsWith(`${entry.path}/`)));
  const row = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (canExpand && props.selected?.startsWith(`${entry.path}/`)) setExpanded(true);
  }, [canExpand, entry.path, props.selected]);
  useEffect(() => { if (revealChangedDirectory) setExpanded(true); }, [revealChangedDirectory]);
  useEffect(() => { if (targetWithinDirectory) setExpanded(true); }, [targetWithinDirectory]);
  useEffect(() => {
    if (!target && !selectedPath) return;
    const button = row.current;
    const viewport = button?.closest<HTMLElement>('.project-tree-scroll');
    if (!button || !viewport) return;
    const bounds = button.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    const offset = target
      ? bounds.top - visible.top - (visible.height - bounds.height) / 2
      : bounds.top < visible.top ? bounds.top - visible.top : bounds.bottom > visible.bottom ? bounds.bottom - visible.bottom : 0;
    if (offset) viewport.scrollTo({ top: viewport.scrollTop + offset, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [target, selectedPath]);
  const status = props.fileStatusMap.get(entry.path);
  const changed = props.revealChanges && status;
  const label = status?.conflicted ? '冲突' : status?.untracked || status?.indexStatus === 'A' ? '新增' : status?.indexStatus === 'R' || status?.worktreeStatus === 'R' ? '重命名' : status ? '修改' : entry.ignored ? '忽略' : '';
  const Icon = entry.blocked ? IconLock : entry.directory ? expanded ? IconFolderOpen : IconFolder : isImageFile(entry.path) ? IconPhoto : IconFileCode;
  return <li>
    <button ref={row} className={`project-tree-row${selected ? ' selected' : ''}${changed ? ' changed' : ''}${target ? ' change-target' : ''}${entry.ignored ? ' ignored' : ''}`}
      title={entry.blocked ? `${entry.path}：链接、子模块或特殊文件请在外部打开` : entry.path}
      aria-label={`${entry.directory ? '目录' : '打开文件'} ${entry.path}${label ? ` · ${label}` : ''}`}
      aria-expanded={entry.directory ? expanded : undefined} aria-current={target || !props.changeTarget && selected ? 'true' : undefined}
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
    {canExpand && expanded && <Directory {...props} directory={entry.path} />}
  </li>;
}

export function FileTree(props: TreeProps) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FileSearchMode>('name');
  const [refresh, setRefresh] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const actions = useFileActions(props.repository, props, () => setRefresh(value => value + 1));
  const fileStatusMap = useMemo(() => new Map(props.files.map(file => [file.path, file])), [props.files]);
  const changedDirectories = useMemo(() => {
    if (!props.revealChanges) return undefined;
    const directories = new Set<string>();
    for (const file of fileStatusMap.values()) {
      if (!canLocateFileChange(file)) continue;
      for (let slash = file.path.lastIndexOf('/'); slash > 0; slash = file.path.lastIndexOf('/', slash - 1)) {
        const directory = file.path.slice(0, slash);
        if (directories.has(directory)) break;
        directories.add(directory);
      }
    }
    return directories;
  }, [fileStatusMap, props.revealChanges]);
  useEffect(() => { if (props.revealChanges) setQuery(''); }, [props.revealChanges, props.changeTarget]);
  const refreshKey = `${props.refreshKey}:${refresh}`;
  return <nav className="project-files" aria-label="项目文件浏览">
    <div className="files-toolbar">
      <div className="files-search-mode" role="group" aria-label="文件搜索方式"><button aria-pressed={mode === 'name'} onClick={() => setMode('name')}>文件名 / 路径</button><button aria-pressed={mode === 'content'} onClick={() => setMode('content')}>文件内容</button></div>
      <label className="file-filter"><IconSearch size={15} /><input aria-label="搜索项目文件" placeholder={mode === 'content' ? '搜索文件内容…' : '搜索文件名或路径…'} maxLength={256} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className="icon-button" aria-label="刷新项目文件" title="刷新目录与搜索结果" onClick={() => setRefresh(value => value + 1)}><IconRefresh size={16} /></button>
    </div>
    <div className="files-options"><label><input type="checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} />显示忽略文件</label><span>{mode === 'content' ? '搜索磁盘内容' : '工作区文件'}</span></div>
    {actions.feedback}
    <div ref={viewport} className="project-tree-scroll">{query.trim() ? <ProjectSearchResults repository={props.repository} query={query} mode={mode} showIgnored={showIgnored} refreshKey={`${refreshKey}:${mode === 'content' ? props.revision ?? '' : ''}`} selected={props.selected} viewport={viewport} onOpen={props.onOpen} onEntryMenu={(file, x, y) => actions.open({ path: file, directory: false }, x, y)} /> : <Directory {...props} directory="" showIgnored={showIgnored} refreshKey={refreshKey} fileStatusMap={fileStatusMap} changedDirectories={changedDirectories} onEntryMenu={actions.open} />}</div>
    {actions.overlays}
  </nav>;
}
