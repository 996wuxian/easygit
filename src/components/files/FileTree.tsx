import { useEffect, useState } from 'react';
import { IconChevronRight, IconFileCode, IconFolder, IconFolderOpen, IconLock, IconRefresh, IconSearch } from '@tabler/icons-react';
import type { GitFile } from '../../services/git';
import { project, type ProjectEntry, type ProjectListing } from '../../services/project';
import './files.css';

interface TreeProps {
  repository: string; files: GitFile[]; refreshKey: string; selected?: string;
  onOpen: (file: string) => void;
}
interface DirectoryProps extends TreeProps { directory: string; showIgnored: boolean; query?: string }

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
  const [expanded, setExpanded] = useState(false);
  const status = props.files.find(file => file.path === entry.path);
  const label = status?.conflicted ? '冲突' : status?.untracked || status?.indexStatus === 'A' ? '新增' : status?.indexStatus === 'R' || status?.worktreeStatus === 'R' ? '重命名' : status ? '修改' : entry.ignored ? '忽略' : '';
  const Icon = entry.blocked ? IconLock : entry.directory ? expanded ? IconFolderOpen : IconFolder : IconFileCode;
  return <li>
    <button className={`project-tree-row${props.selected === entry.path ? ' selected' : ''}${entry.ignored ? ' ignored' : ''}`}
      title={entry.blocked ? `${entry.path}：链接、子模块或特殊文件请在外部打开` : entry.path}
      aria-label={`${entry.directory ? '目录' : '打开文件'} ${entry.path}${label ? ` · ${label}` : ''}`}
      aria-expanded={entry.directory ? expanded : undefined} aria-current={props.selected === entry.path ? 'true' : undefined}
      disabled={entry.blocked} onClick={() => entry.directory ? setExpanded(value => !value) : props.onOpen(entry.path)}>
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
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query), 250); return () => window.clearTimeout(timer); }, [query]);
  return <nav className="project-files" aria-label="项目文件浏览">
    <div className="files-toolbar"><label className="file-filter"><IconSearch size={15} /><input aria-label="搜索项目文件" placeholder="搜索文件名或路径…" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="icon-button" aria-label="刷新项目文件" title="刷新目录" onClick={() => setRefresh(value => value + 1)}><IconRefresh size={16} /></button></div>
    <div className="files-options"><label><input type="checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} />显示忽略文件</label><span>工作区文件</span></div>
    <div className="project-tree-scroll" aria-busy={query !== search}><Directory {...props} directory="" showIgnored={showIgnored} query={search} refreshKey={`${props.refreshKey}:${refresh}`} /></div>
  </nav>;
}
