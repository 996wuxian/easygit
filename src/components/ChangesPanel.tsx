import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { IconArrowUp, IconCheck, IconChevronRight, IconCircleCheck, IconCode, IconFileCode, IconLoader2, IconMinus, IconPlus, IconSearch, IconSparkles, IconTrash, IconX } from '@tabler/icons-react';
import type { GitFile, RepositorySnapshot } from '../services/git';
import type { RepositoryTask } from '../services/useRepository';
import './panels.css';

interface ChangesProps {
  message: string; onMessageChange: (message: string) => void;
  snapshot: RepositorySnapshot; selected: string | null; selectedStaged?: boolean;
  onSelect: (path: string, staged: boolean) => void;
  onStage: (paths: string[]) => void; onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[], scope: 'file' | 'all' | 'selection') => void;
  onResolveConflict: (file: string) => void; onCommit: (message: string) => Promise<boolean>;
  canPush: boolean; pushTitle: string; onPush: () => void;
  onGenerateCommitMessage: () => void; generatingCommitMessage: boolean; busy: boolean;
  activeOperation?: RepositoryTask | null;
}

export function ChangesPanel({ snapshot, message, onMessageChange, selected, selectedStaged, onSelect, onStage, onUnstage, onDiscard, onResolveConflict, onCommit, canPush, pushTitle, onPush, onGenerateCommitMessage, generatingCommitMessage, busy, activeOperation }: ChangesProps) {
  const [filter, setFilter] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({ pending: false, staged: false });
  const [selection, setSelection] = useState<{ staged: boolean; paths: string[] }>({ staged: false, paths: [] });
  const anchor = useRef<{ staged: boolean; path: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const pending = snapshot.files.filter(f => f.unstaged || f.untracked && !f.staged);
  const staged = snapshot.files.filter(f => f.staged);
  const matches = (f: GitFile) => f.path.toLowerCase().includes(filter.toLowerCase());
  const selectionPaths = new Set(selection.paths);
  const chosen = (selection.staged ? staged : pending).filter(file => selectionPaths.has(file.path) && matches(file));
  const chosenPaths = new Set(chosen.map(file => file.path));
  const selectionConflict = chosen.some(file => file.conflicted);
  const committing = activeOperation?.kind === 'commit';
  const commitReason = busy ? activeOperation?.label ?? '请等待当前操作完成' : generatingCommitMessage ? '正在生成提交信息…' : snapshot.files.some(file => file.conflicted) ? '请先解决冲突文件' : snapshot.operation && snapshot.operation !== 'merge' ? '请通过操作提示条继续当前 Git 操作' : !staged.length ? '请先暂存要提交的文件' : !message.trim() ? '请填写提交信息' : '';
  const submit = async () => { if (commitReason) return; if (await onCommit(message)) onMessageChange(''); };
  useEffect(() => {
    const available = new Set((selection.staged ? staged : pending).map(file => file.path));
    if (selection.paths.some(path => !available.has(path))) setSelection(current => ({ ...current, paths: current.paths.filter(path => available.has(path)) }));
  }, [snapshot.files, selection]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const resize = () => {
      const minimum = focused ? 71 : 35;
      element.style.height = '0px';
      element.style.height = `${Math.min(143, Math.max(minimum, element.scrollHeight + 2))}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; resize(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message, focused]);

  function selectFile(file: GitFile, isStaged: boolean, event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) {
    const visible = (isStaged ? staged : pending).filter(matches).map(entry => entry.path);
    const previous = selection.staged === isStaged ? selection.paths : [];
    let paths: string[];
    if (event.shiftKey && anchor.current?.staged === isStaged && visible.includes(anchor.current.path)) {
      const from = visible.indexOf(anchor.current.path); const to = visible.indexOf(file.path);
      const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      paths = event.ctrlKey || event.metaKey ? [...new Set([...previous, ...range])] : range;
    } else {
      paths = event.ctrlKey || event.metaKey ? previous.includes(file.path) ? previous.filter(path => path !== file.path) : [...previous, file.path] : [file.path];
      anchor.current = { staged: isStaged, path: file.path };
    }
    setSelection({ staged: isStaged, paths });
    onSelect(file.path, isStaged);
  }
  function row(file: GitFile, isStaged: boolean) {
    const name = file.path.split('/').pop();
    const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    const isSelected = selection.staged === isStaged && chosenPaths.has(file.path);
    const isPreview = !anchor.current && selected === file.path && (selectedStaged === undefined || selectedStaged === isStaged);
    return <div className={`file-row${isSelected || isPreview ? ' selected' : ''}`} key={`${file.path}-${isStaged}`}>
      <button className="file-select" aria-label={`选择${isStaged ? '已暂存' : '未暂存'}文件 ${file.path}`} aria-pressed={isSelected} onClick={event => selectFile(file, isStaged, event)} title={`${file.path}\nCtrl 多选 · Shift 连选`}>
        <IconFileCode size={17} className="file-icon" />
        <span className="file-label"><strong>{name}</strong><small>{directory || '仓库根目录'}</small></span>
        <span className={`file-status ${file.untracked ? 'new' : file.conflicted ? 'conflict' : ''}`}>{file.conflicted ? '!' : file.untracked ? 'U' : file.indexStatus === 'A' ? 'A' : file.indexStatus === 'D' || file.worktreeStatus === 'D' ? 'D' : 'M'}</span>
      </button>
      {!isStaged && <button className="file-action icon-button discard-file-action" title={file.conflicted ? '冲突文件暂时无法撤回' : '撤回更改'} aria-label={`撤回更改 ${file.path}`} disabled={busy || file.conflicted} onClick={() => onDiscard([file.path], 'file')}><IconTrash size={15} /></button>}
      <button className="file-action icon-button" title={isStaged ? '取消暂存' : file.conflicted ? '打开冲突解决工具' : '暂存文件'} aria-label={`${isStaged ? '取消暂存' : file.conflicted ? '解决冲突' : '暂存'} ${file.path}`} disabled={busy} onClick={() => file.conflicted ? onResolveConflict(file.path) : isStaged ? onUnstage([file.path]) : onStage([file.path])}>{isStaged ? <IconMinus size={16} /> : file.conflicted ? <IconCode size={16} /> : <IconPlus size={16} />}</button>
    </div>;
  }
  return <div className="changes-content">
    <label className="file-filter"><IconSearch size={15} /><input aria-label="筛选变更文件" placeholder="筛选文件…" value={filter} onChange={event => { setFilter(event.target.value); setSelection({ staged: false, paths: [] }); anchor.current = null; }} /><kbd>/</kbd></label>
    {chosen.length > 0 && <div className="file-selection-toolbar" role="group" aria-label="批量文件操作">
      <span>已选 {chosen.length} 项</span>
      {selection.staged ? <button className="text-button" disabled={busy} onClick={() => onUnstage(chosen.map(file => file.path))}><IconMinus size={14} />取消暂存所选</button> : <>
        <button className="text-button" disabled={busy || selectionConflict} title={selectionConflict ? '请先解决所选文件的冲突' : '暂存所选文件'} onClick={() => onStage(chosen.map(file => file.path))}><IconPlus size={14} />暂存所选</button>
        <button className="text-button discard-all-action" disabled={busy || selectionConflict} title={selectionConflict ? '请先解决所选文件的冲突' : '预览并撤回所选文件的未暂存更改'} onClick={() => onDiscard(chosen.map(file => file.path), 'selection')}><IconTrash size={14} />撤回所选</button>
      </>}
      <button className="icon-button" aria-label="清除文件选择" onClick={() => { setSelection({ staged: false, paths: [] }); anchor.current = null; }}><IconX size={14} /></button>
    </div>}
    <div className="file-groups">
      <div className="file-group-label"><button className="file-group-toggle" aria-label={`${collapsedGroups.pending ? '展开' : '折叠'}未暂存文件`} aria-expanded={!collapsedGroups.pending} aria-controls="unstaged-file-list" onClick={() => setCollapsedGroups(current => ({ ...current, pending: !current.pending }))}><IconChevronRight size={12} /><span>未暂存</span><b>{pending.length}</b></button><div className="file-group-actions"><button className="discard-all-action" title={pending.some(f => f.conflicted) ? '请先解决冲突文件' : `撤回全部未暂存更改（${pending.length} 个文件）`} aria-label="全部撤回" disabled={!pending.length || pending.some(f => f.conflicted) || busy} onClick={() => onDiscard(pending.map(f => f.path), 'all')}><IconTrash size={13} />全部撤回</button><button title="暂存全部非冲突文件" aria-label="暂存全部文件" disabled={!pending.some(f => !f.conflicted) || busy} onClick={() => onStage(pending.filter(f => !f.conflicted).map(f => f.path))}><IconPlus size={14} />全部暂存</button></div></div>
      <div id="unstaged-file-list" hidden={collapsedGroups.pending}>{pending.filter(matches).map(f => row(f, false))}</div>
      <div className="file-group-label staged-label"><button className="file-group-toggle" aria-label={`${collapsedGroups.staged ? '展开' : '折叠'}已暂存文件`} aria-expanded={!collapsedGroups.staged} aria-controls="staged-file-list" onClick={() => setCollapsedGroups(current => ({ ...current, staged: !current.staged }))}><IconChevronRight size={12} /><span>已暂存</span><b>{staged.length}</b></button><div className="file-group-actions"><button title="取消全部暂存" aria-label="取消全部暂存" disabled={!staged.length || busy} onClick={() => onUnstage(staged.map(f => f.path))}><IconMinus size={14} />取消暂存</button></div></div>
      <div id="staged-file-list" hidden={collapsedGroups.staged}>{staged.filter(matches).map(f => row(f, true))}</div>
      {!snapshot.files.length && <div className="clean-state"><IconCircleCheck size={28} stroke={1.3} /><strong>工作区干净</strong><span>没有未提交的更改</span></div>}
      {filter && !snapshot.files.some(matches) && <div className="empty-inline">没有匹配的文件</div>}
    </div>
    <div className="commit-form">
      <label htmlFor="commit-message">提交信息</label>
      <div className="commit-message-row">
        <textarea ref={textarea} id="commit-message" aria-label="提交信息" placeholder="描述本次更改…" value={message} disabled={generatingCommitMessage} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={e => onMessageChange(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }} />
        <button className="icon-button generate-commit-message" aria-label="AI 生成提交信息" title={busy ? activeOperation?.label : staged.length ? '根据已暂存差异生成提交信息' : '请先暂存要提交的文件'} disabled={!staged.length || busy || generatingCommitMessage} aria-busy={generatingCommitMessage} onClick={onGenerateCommitMessage}>{generatingCommitMessage ? <IconLoader2 size={16} className="spin" /> : <IconSparkles size={16} />}</button>
      </div>
      <div className="commit-actions"><button className="primary-button commit-button" aria-describedby={commitReason ? 'commit-disabled-reason' : undefined} title={commitReason || '提交已暂存的更改 · Ctrl Enter'} disabled={Boolean(commitReason)} aria-busy={committing} onClick={() => { void submit(); }}>{committing ? <IconLoader2 size={16} className="spin" /> : <IconCheck size={16} />}{committing ? '正在提交…' : '提交更改'} <span>{staged.length}</span><kbd>Ctrl ↵</kbd></button><button className="icon-button push-commit-button" aria-label="推送当前分支" title={busy ? activeOperation?.label : pushTitle} disabled={busy || !canPush} aria-busy={activeOperation?.kind === 'push'} onClick={onPush}>{activeOperation?.kind === 'push' ? <IconLoader2 size={16} className="spin" /> : <IconArrowUp size={16} />}</button></div>
      {commitReason && <p id="commit-disabled-reason" className="commit-disabled-reason" role="status">{commitReason}</p>}
    </div>
  </div>;
}
