import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowDown, IconCheck, IconChevronDown, IconChevronRight, IconChevronUp, IconFolder, IconFolderOpen, IconGitBranch, IconHistory, IconKey, IconLayoutDashboard, IconLayoutGrid, IconGitPullRequest, IconLoader2, IconMoon, IconNotes, IconPalette, IconPlus, IconRefresh, IconSearch, IconSettings, IconSun, IconTerminal2, IconX } from '@tabler/icons-react';
import { WorkspaceGrid, usePanelLayout, PANEL_IDS, PANEL_TITLES, type PanelId } from './layout';
import { ChangesPanel, DiffPanel, BranchesPanel, CommitsPanel, StashPanel, ActivityPanel, ScriptsPanel, panelIcons } from './components/Panels';
import { WindowControls } from './components/WindowControls';
import { Dialog } from './components/Dialog';
import { RepositoryDirectoryInput } from './components/RepositoryDirectoryInput';
import { DiscardChangesDialog } from './components/DiscardChangesDialog';
import { ConflictResolutionDialog } from './components/diff/ConflictResolutionDialog';
import { DiscardBlockDialog } from './components/diff/DiscardBlockDialog';
import { BranchMergeDialog } from './components/branches/BranchMergeDialog';
import { BranchCompareDialog } from './components/branches/BranchCompareDialog';
import { BranchSearch } from './components/branches/BranchSearch';
import { CommitDetailsDialog } from './components/commits/CommitDetailsDialog';
import { OperationBanner } from './components/OperationBanner';
import { RemoveWorkspaceDialog } from './components/RemoveWorkspaceDialog';
import { DataStorageDialog } from './components/DataStorageDialog';
import { AboutDialog } from './components/AboutDialog';
import { ProjectNotesDialog } from './components/ProjectNotesDialog';
import { SidebarProjectDrawer } from './components/SidebarProjectDrawer';
import { ToastStack } from './components/notifications/ToastStack';
import { FileTree } from './components/files/FileTree';
import { FileEditorDialog } from './components/files/FileEditorDialog';
import { useFileEditor } from './components/files/useFileEditor';
import { confirmPendingChanges } from './services/pendingChanges';
import type { FilePosition } from './services/project';
import { APP_VERSION } from './services/appInfo';
import { useAppUpdates } from './services/useAppUpdates';
import { git, isDesktop, type DiffBlock, type GitCommit, type MergePreview } from './services/git';
import { generateCommitMessage, parseGeneratedCommitMessage, type AiCommitSettings } from './services/ai';
import { commitStatus } from './components/commits/model';
import { useRepository, type RecentRepository } from './services/useRepository';
import { AI_SETTINGS_KEY, COMMIT_DRAFTS_KEY, STORAGE_ERROR_EVENT, appStorage, readAiApiKey, saveAiApiKey } from './services/storage';

type Modal = 'open' | 'layout' | 'commands' | 'settings' | 'ai-settings' | 'data-settings' | 'about' | 'branches' | 'create-branch' | 'project-notes' | null;
type RepositoryPress = { path: string; pointerId: number; startX: number; startY: number; timer: number; started: boolean; targetPath: string | null; element: HTMLButtonElement };
const SIDEBAR_ORDER_KEY = 'easygit.sidebar-repository-order.v1';
const DEFAULT_AI_SETTINGS: AiCommitSettings = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '' };
function readSidebarOrder(): string[] { try { const value: unknown = JSON.parse(appStorage.getItem(SIDEBAR_ORDER_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : []; } catch { return []; } }
function readTheme(): 'light' | 'dark' { try { return appStorage.getItem('esaygit.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }
function readAiSettings(): AiCommitSettings {
  const apiKey = readAiApiKey();
  try {
    const value: unknown = JSON.parse(appStorage.getItem(AI_SETTINGS_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_AI_SETTINGS, apiKey };
    const saved = value as Partial<AiCommitSettings>;
    return {
      baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
      model: typeof saved.model === 'string' ? saved.model : DEFAULT_AI_SETTINGS.model,
      apiKey,
    };
  } catch { return { ...DEFAULT_AI_SETTINGS, apiKey }; }
}
function readCommitDrafts(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(appStorage.getItem(COMMIT_DRAFTS_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
  } catch { return {}; }
}

export default function App({ onReady }: { onReady: () => void }) {
  const repo = useRepository(onReady);
  const updates = useAppUpdates();
  const panels = usePanelLayout();
  const { snapshot, hasRepository, busy, syncing, notify } = repo;
  const editor = useFileEditor(snapshot, repo.saveFile);
  const filesRefreshKey = JSON.stringify([snapshot.head, snapshot.files.map(file => file.path)]);
  const openFile = (file: string, position?: FilePosition) => {
    if (snapshot.files.some(entry => entry.path === file && entry.conflicted)) void (async () => {
      if (!await confirmPendingChanges()) return;
      await editor.close();
      setConflictFile(file);
    })();
    else void editor.open(file, position);
  };
  const [theme, setTheme] = useState(readTheme);
  const [aiSettings, setAiSettings] = useState(readAiSettings);
  const [generatingCommitMessage, setGeneratingCommitMessage] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [path, setPath] = useState('');
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchFilter, setBranchFilter] = useState({ path: '', query: '' });
  const branchQuery = branchFilter.path === snapshot.path ? branchFilter.query : '';
  const [selected, setSelected] = useState<string | null>(snapshot.files[0]?.path ?? null);
  const [staged, setStaged] = useState(false);
  const [query, setQuery] = useState('');
  const [commitDrafts, setCommitDrafts] = useState(readCommitDrafts);
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [commitDetailStatus, setCommitDetailStatus] = useState<string | null>(null);
  const [comparingBranches, setComparingBranches] = useState(false);
  const [mergeRequest, setMergeRequest] = useState<{ source: string; target: string; sourceRemote: boolean; targetRemote: boolean } | null>(null);
  const [activeNav, setActiveNav] = useState('workspace');
  const [removal, setRemoval] = useState<{ workspace: RecentRepository; returnToOpen: boolean } | null>(null);
  const [repositoryTooltip, setRepositoryTooltip] = useState<{ name: string; path: string; left: number; top: number } | null>(null);
  const [sidebarOrder, setSidebarOrder] = useState(readSidebarOrder);
  const [draggingRepository, setDraggingRepository] = useState<string | null>(null);
  const [dropTargetRepository, setDropTargetRepository] = useState<string | null>(null);
  const repositoryPress = useRef<RepositoryPress | null>(null);
  const suppressRepositoryClick = useRef(false);
  const repositoryListRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [repositoryScroll, setRepositoryScroll] = useState({ canUp: false, canDown: false });
  const [discardConfirmation, setDiscardConfirmation] = useState<{ files: string[]; untrackedFiles: string[]; scope: 'file' | 'all' | 'selection'; overlay: boolean } | null>(null);
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [blockDiscard, setBlockDiscard] = useState<{ file: string; block: DiffBlock } | null>(null);
  const closeModal = useCallback(() => { setModal(null); setQuery(''); }, []);
  const requestBranchMerge = (source: string, target: string, sourceRemote: boolean, targetRemote: boolean) => { setModal(null); setMergeRequest({ source, target, sourceRemote, targetRemote }); };
  const workspaces = useMemo(() => {
    const available = hasRepository && !repo.recents.some(item => item.path === snapshot.path)
      ? [{ name: snapshot.name, path: snapshot.path }, ...repo.recents] : repo.recents;
    const byPath = new Map(available.map(item => [item.path, item]));
    return [...sidebarOrder.map(path => byPath.get(path)).filter((item): item is RecentRepository => Boolean(item)), ...available.filter(item => !sidebarOrder.includes(item.path))];
  }, [hasRepository, repo.recents, snapshot.name, snapshot.path, sidebarOrder]);

  const moveWorkspace = useCallback((fromPath: string, toPath: string) => {
    if (fromPath === toPath) return;
    setSidebarOrder(current => {
      const availablePaths = workspaces.map(item => item.path);
      const order = [...current.filter(path => availablePaths.includes(path)), ...availablePaths.filter(path => !current.includes(path))];
      const fromIndex = order.indexOf(fromPath);
      const toIndex = order.indexOf(toPath);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      try { appStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(order)); } catch { /* optional preference */ }
      return order;
    });
  }, [workspaces]);

  const updateRepositoryScroll = useCallback(() => {
    const list = repositoryListRef.current;
    if (!list) return;
    const next = { canUp: list.scrollTop > 1, canDown: list.scrollTop + list.clientHeight < list.scrollHeight - 1 };
    setRepositoryScroll(current => current.canUp === next.canUp && current.canDown === next.canDown ? current : next);
  }, []);

  function scrollRepositories(direction: -1 | 1) {
    repositoryListRef.current?.scrollBy({ top: direction * 120, behavior: 'smooth' });
  }

  function startRepositoryPress(workspace: RecentRepository, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (repositoryPress.current) window.clearTimeout(repositoryPress.current.timer);
    const element = event.currentTarget;
    const press: RepositoryPress = {
      path: workspace.path,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
      started: false,
      targetPath: workspace.path,
      element,
    };
    repositoryPress.current = press;
    press.timer = window.setTimeout(() => {
      if (repositoryPress.current !== press) return;
      press.started = true;
      setDraggingRepository(press.path);
      setDropTargetRepository(press.path);
      try { press.element.setPointerCapture(press.pointerId); } catch { /* pointer may have been cancelled */ }
    }, 360);
  }

  useEffect(() => {
    if (!workspaces.length) return;
    setSidebarOrder(current => {
      const paths = workspaces.map(item => item.path);
      const next = [...current.filter(path => paths.includes(path)), ...paths.filter(path => !current.includes(path))];
      if (next.length === current.length && next.every((path, index) => path === current[index])) return current;
      try { appStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(next)); } catch { /* optional preference */ }
      return next;
    });
  }, [workspaces]);

  useEffect(() => {
    updateRepositoryScroll();
    const list = repositoryListRef.current;
    if (list && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateRepositoryScroll);
      observer.observe(list);
      if (list.firstElementChild) observer.observe(list.firstElementChild);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateRepositoryScroll);
    return () => window.removeEventListener('resize', updateRepositoryScroll);
  }, [updateRepositoryScroll, workspaces.length]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const press = repositoryPress.current;
      if (!press || event.pointerId !== press.pointerId) return;
      if (!press.started) {
        if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 8) {
          window.clearTimeout(press.timer);
          repositoryPress.current = null;
        }
        return;
      }
      const entry = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-repository-path]');
      press.targetPath = entry?.dataset.repositoryPath ?? null;
      setDropTargetRepository(press.targetPath);
      event.preventDefault();
    };
    const finish = (event: PointerEvent, cancelled = false) => {
      const press = repositoryPress.current;
      if (!press || event.pointerId !== press.pointerId) return;
      window.clearTimeout(press.timer);
      repositoryPress.current = null;
      if (press.started && !cancelled) {
        suppressRepositoryClick.current = true;
        if (press.targetPath) moveWorkspace(press.path, press.targetPath);
        window.setTimeout(() => { suppressRepositoryClick.current = false; }, 0);
      }
      setDraggingRepository(null);
      setDropTargetRepository(null);
    };
    const up = (event: PointerEvent) => finish(event);
    const cancel = (event: PointerEvent) => finish(event, true);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (repositoryPress.current) window.clearTimeout(repositoryPress.current.timer);
    };
  }, [moveWorkspace]);

  function requestRemoval(workspace: RecentRepository) {
    if (busy) return;
    setRemoval({ workspace, returnToOpen: modal === 'open' });
    setSelectedCommit(null);
    setComparingBranches(false);
    closeModal();
  }

  function showRepositoryTooltip(workspace: RecentRepository, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    setRepositoryTooltip({
      name: workspace.name,
      path: workspace.path,
      left: Math.min(rect.right + 10, Math.max(8, window.innerWidth - 280)),
      top: rect.top + rect.height / 2,
    });
  }
  function cancelRemoval() {
    if (removal?.returnToOpen) setModal('open');
    setRemoval(null);
  }
  async function confirmRemoval() {
    if (removal?.workspace.path === snapshot.path && !await confirmPendingChanges()) return;
    if (!removal || !repo.removeWorkspace(removal.workspace)) return;
    setCommitDrafts(current => {
      const next = { ...current };
      delete next[removal.workspace.path];
      return next;
    });
    if (snapshot.path === removal.workspace.path) {
      setSelected(null);
      setStaged(false);
      setSelectedCommit(null);
      setActiveNav('workspace');
    }
    cancelRemoval();
  }
  function requestDiscard(files: string[], scope: 'file' | 'all' | 'selection', overlay = false) {
    if (busy || !files.length) return;
    const selectedFiles = [...files];
    setDiscardConfirmation({ files: selectedFiles, untrackedFiles: snapshot.files.filter(file => selectedFiles.includes(file.path) && file.untracked).map(file => file.path), scope, overlay });
  }
  async function confirmDiscard() {
    if (!discardConfirmation) return;
    if (await repo.discard(discardConfirmation.files)) setDiscardConfirmation(null);
  }
  function requestBlockDiscard(file: string, block: DiffBlock) {
    if (!busy && !staged && snapshot.files.some(entry => entry.path === file && entry.unstaged && !entry.conflicted)) setBlockDiscard({ file, block });
  }
  async function confirmBlockDiscard() {
    if (blockDiscard && await repo.discardBlock(blockDiscard.file, blockDiscard.block)) setBlockDiscard(null);
  }

  async function generateStagedCommitMessage() {
    const repositoryPath = snapshot.path;
    if (!repositoryPath || busy || generatingCommitMessage) return;
    if (!aiSettings.apiKey.trim()) {
      setModal('ai-settings');
      notify('请先配置 AI API Key。', true);
      return;
    }
    setGeneratingCommitMessage(true);
    try {
      const diff = await git.stagedDiff(repositoryPath);
      const result = await generateCommitMessage(aiSettings, diff);
      const message = parseGeneratedCommitMessage(result);
      setCommitDrafts(current => ({ ...current, [repositoryPath]: message }));
      notify('已生成提交信息');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), true);
    } finally {
      setGeneratingCommitMessage(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { appStorage.setItem('esaygit.theme', theme); } catch { /* optional preference */ }
  }, [theme]);

  useEffect(() => {
    try {
      appStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ baseUrl: aiSettings.baseUrl, model: aiSettings.model }));
      void saveAiApiKey(aiSettings.apiKey).catch(error => notify(`密钥保存失败：${String(error)}`, true));
    } catch (error) { notify(`AI 设置保存失败：${String(error)}`, true); }
  }, [aiSettings, notify]);

  useEffect(() => {
    try { appStorage.setItem(COMMIT_DRAFTS_KEY, JSON.stringify(commitDrafts)); }
    catch (error) { notify(`提交草稿保存失败：${String(error)}`, true); }
  }, [commitDrafts, notify]);

  useEffect(() => {
    const onStorageError = (event: Event) => notify(String((event as CustomEvent<unknown>).detail), true);
    window.addEventListener(STORAGE_ERROR_EVENT, onStorageError);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, onStorageError);
  }, [notify]);

  useEffect(() => {
    const current = snapshot.files.find(f => f.path === selected);
    if (!current) { const first = snapshot.files[0]; setSelected(first?.path ?? null); setStaged(first?.staged ?? false); }
    else if (staged && !current.staged) setStaged(false);
    else if (!staged && !current.unstaged && current.staged) setStaged(true);
  }, [snapshot, selected]);

  const focusPanel = (id: PanelId) => {
    if (!hasRepository) { setModal('open'); return; }
    if (panels.layout.hidden.includes(id)) {
      setModal('layout');
      notify(`请在自定义布局中勾选「${PANEL_TITLES[id]}」面板。`);
      return;
    }
    setActiveNav(['commits', 'branches', 'activity', 'files'].includes(id) ? id : 'workspace');
    window.setTimeout(() => {
      const node = document.querySelector<HTMLElement>(`[data-eg-panel="${id}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.classList.add('panel-highlight');
      window.setTimeout(() => node?.classList.remove('panel-highlight'), 1200);
    }, 80);
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (editor.visible || removal || discardConfirmation || conflictFile || blockDiscard) {
        if ((event.ctrlKey || event.metaKey) && ['k', 'o', 'r'].includes(event.key.toLowerCase())) event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setModal(current => current === 'commands' ? null : 'commands'); setQuery(''); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); setModal('open'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') { event.preventDefault(); void repo.refresh(); }
      if (event.key === '/' && !modal && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))) { event.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="筛选变更文件"]')?.focus(); }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [modal, editor.visible, removal, discardConfirmation, conflictFile, blockDiscard, repo.refresh]);

  const actions = useMemo(() => [
    { id: 'open', icon: IconFolderOpen, title: '打开本地仓库', detail: '输入 Git 项目目录', shortcut: 'Ctrl O', run: () => setModal('open') },
    { id: 'refresh', icon: IconRefresh, title: '刷新仓库状态', detail: '获取当前工作区的最新状态', shortcut: 'Ctrl R', run: () => { closeModal(); void repo.refresh(); } },
    { id: 'layout', icon: IconLayoutGrid, title: '自定义工作台', detail: '显示、隐藏和重新排列面板', shortcut: '', run: () => setModal('layout') },
    { id: 'theme', icon: theme === 'light' ? IconMoon : IconSun, title: theme === 'light' ? '切换深色主题' : '切换浅色主题', detail: '界面外观', shortcut: '', run: () => { setTheme(t => t === 'light' ? 'dark' : 'light'); closeModal(); } },
    { id: 'branches', icon: IconGitBranch, title: '切换分支', detail: snapshot.branch, shortcut: '', run: () => setModal('branches') },
    { id: 'files', icon: IconFolder, title: '浏览项目文件', detail: '查看目录和编辑工作区文件', shortcut: '', run: () => { closeModal(); focusPanel('files'); } },
  ].filter(action => hasRepository || !['refresh', 'branches', 'files'].includes(action.id)), [theme, snapshot.branch, hasRepository, repo.refresh, closeModal, panels.layout]);

  async function openPath(value = path) {
    if (await repo.open(value)) {
      setPath(''); closeModal(); setActiveNav('workspace');
      setSelectedCommit(null); setCommitDetailStatus(null); setComparingBranches(false); setMergeRequest(null);
    }
  }
  async function openProjectDirectory() {
    if (!snapshot.path) return;
    try { await git.openDirectory(snapshot.path); }
    catch (error) { notify(`无法打开项目文件夹：${String(error)}`, true); }
  }
  const stagedCount = snapshot.files.filter(f => f.staged).length;
  const changedCount = snapshot.files.filter(f => f.unstaged || f.untracked && !f.staged).length;
  const mergeDisabled = busy || syncing || Boolean(snapshot.operation);
  const canPush = Boolean(snapshot.remote && snapshot.head && !snapshot.branch.startsWith('detached@') && (!snapshot.hasUpstream || snapshot.ahead > 0));
  const pushTitle = !snapshot.remote ? '请先配置远程仓库' : !snapshot.head ? '请先创建提交' : snapshot.branch.startsWith('detached@') ? '游离 HEAD 状态无法推送' : snapshot.hasUpstream && !snapshot.ahead ? '没有待推送的提交' : snapshot.hasUpstream ? `推送当前分支（${snapshot.ahead} 个待推送提交）` : '首次推送并设置上游分支';
  const renderPanel = (id: PanelId) => {
    switch (id) {
      case 'changes': return <ChangesPanel key={snapshot.path} snapshot={snapshot} message={commitDrafts[snapshot.path] ?? ''} onMessageChange={message => setCommitDrafts(current => ({ ...current, [snapshot.path]: message }))} selected={selected} selectedStaged={staged} busy={busy} activeOperation={repo.activeOperation} generatingCommitMessage={generatingCommitMessage} onGenerateCommitMessage={() => { void generateStagedCommitMessage(); }} canPush={canPush} pushTitle={pushTitle} onPush={() => { void repo.push(); }} onSelect={(file, cached) => { setSelected(file); setStaged(cached); }} onStage={paths => { void repo.stage(paths); }} onUnstage={paths => { void repo.unstage(paths); }} onDiscard={(paths, scope) => requestDiscard(paths, scope)} onResolveConflict={setConflictFile} onCommit={repo.commit} />;
      case 'diff': return <DiffPanel snapshot={snapshot} selected={selected} staged={staged} onStagedChange={setStaged} onSelectFile={setSelected} notify={notify} busy={busy} onStage={paths => { void repo.stage(paths); }} onUnstage={paths => { void repo.unstage(paths); }} onDiscard={(paths, scope) => requestDiscard(paths, scope, true)} onResolveConflict={setConflictFile} onDiscardBlock={requestBlockDiscard} />;
      case 'branches': return <BranchesPanel onBranchAction={repo.manageBranch} notify={repo.notify} searchQuery={branchQuery} snapshot={snapshot} busy={busy} mergeDisabled={mergeDisabled} onCompare={() => setComparingBranches(true)} onMergeRequest={requestBranchMerge} onCheckout={(name, remote) => { void repo.checkout(name, remote); }} />;
      case 'commits': return <CommitsPanel key={snapshot.path} snapshot={snapshot} onSelect={commit => { setCommitDetailStatus(null); setSelectedCommit(commit); }} busy={busy} notify={notify} onCherryPick={(commit, head, branch) => repo.cherryPick(snapshot.path, commit.hash, head, branch)} onAction={async (commit, head, branch, action) => {
        const path = snapshot.path;
        const success = await repo.actOnCommit(commit.hash, head, branch, action);
        if (success && action !== 'revert') setCommitDrafts(current => ({ ...current, [path]: commit.subject }));
        if (!success) await repo.refresh(true);
        return success;
      }} />;
      case 'stash': return <StashPanel key={snapshot.path} snapshot={snapshot} busy={busy} onSave={repo.saveStash} onAction={repo.actOnStash} />;
      case 'activity': return <ActivityPanel activities={repo.activities} />;
      case 'scripts': return <ScriptsPanel key={snapshot.path} snapshot={snapshot} notify={notify} />;
      case 'files': return <FileTree key={snapshot.path} repository={snapshot.path} files={snapshot.files} refreshKey={filesRefreshKey} revision={snapshot.revision} selected={editor.document?.file} onOpen={openFile} />;
    }
  };

  return <div className="app-shell">
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img className="titlebar-wordmark" src="/brand/easygit-wordmark.png" alt="easygit" draggable={false} />
      </div>
      <div className="titlebar-center" data-tauri-drag-region aria-label={hasRepository ? '当前项目与分支' : '未打开项目'} title={hasRepository ? `${snapshot.name} / ${snapshot.branch || '尚无分支'}` : undefined}>
        {hasRepository && <><IconFolder size={14} />
        <span className="titlebar-project" data-tauri-drag-region>{snapshot.name}</span>
        <span className="titlebar-separator" data-tauri-drag-region>/</span>
        <IconGitBranch size={14} />
        <span className="titlebar-branch" data-tauri-drag-region>{snapshot.branch || '尚无分支'}</span></>}
      </div>
      <WindowControls />
    </header>

    <aside ref={sidebarRef} className="sidebar" aria-label="工具栏">
      <button className="rail-brand" title="easygit · 返回工作台" aria-label="返回工作台" onClick={() => { setActiveNav('workspace'); document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); }}><img src="/brand/esaygit-icon.png" alt="" draggable={false} /></button>
      <nav className="main-nav" aria-label="主导航">
        <button title="工作台" aria-label="工作台" aria-current={activeNav === 'workspace' ? 'page' : undefined} className={activeNav === 'workspace' ? 'active' : ''} onClick={() => { setActiveNav('workspace'); document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); }}><IconLayoutDashboard size={20} /></button>
        <button title="提交历史" aria-label="提交历史" aria-current={activeNav === 'commits' ? 'page' : undefined} className={activeNav === 'commits' ? 'active' : ''} onClick={() => focusPanel('commits')}><IconHistory size={21} /></button>
        <button title="分支管理" aria-label="分支管理" aria-current={activeNav === 'branches' ? 'page' : undefined} className={activeNav === 'branches' ? 'active' : ''} onClick={() => focusPanel('branches')}><IconGitBranch size={20} /></button>
        <button title="项目文件" aria-label="项目文件" aria-current={activeNav === 'files' ? 'page' : undefined} className={activeNav === 'files' ? 'active' : ''} onClick={() => focusPanel('files')}><IconFolder size={20} /></button>
        <button title="操作记录" aria-label="操作记录" aria-current={activeNav === 'activity' ? 'page' : undefined} className={activeNav === 'activity' ? 'active' : ''} onClick={() => focusPanel('activity')}><IconTerminal2 size={20} /></button>
      </nav>
      <span className="rail-divider" />
      <div className="repository-navigation" aria-label="仓库列表">
        <button className="repository-scroll-button" title="向上滚动仓库列表" aria-label="向上滚动仓库列表" disabled={!repositoryScroll.canUp} onClick={() => scrollRepositories(-1)}><IconChevronUp size={16} /></button>
        <div className="repository-list-area">
        <div className="repository-list-scroll" ref={repositoryListRef} onScroll={updateRepositoryScroll}>
          <div className="repository-list">
            {workspaces.map(item => <div className={`repository-entry ${draggingRepository === item.path ? 'dragging' : ''} ${dropTargetRepository === item.path && draggingRepository !== item.path ? 'drag-over' : ''}`} data-repository-path={item.path} key={item.path}>
              <button className={`repository-item ${snapshot.path === item.path ? 'selected' : ''}`} aria-label={`打开仓库 ${item.name}`} aria-describedby={repositoryTooltip?.path === item.path ? 'repository-tooltip' : undefined} disabled={busy} onPointerDown={event => startRepositoryPress(item, event)} onContextMenu={event => event.preventDefault()} onMouseEnter={event => showRepositoryTooltip(item, event.currentTarget)} onMouseLeave={() => setRepositoryTooltip(null)} onFocus={event => showRepositoryTooltip(item, event.currentTarget)} onBlur={() => setRepositoryTooltip(null)} onClick={event => { if (suppressRepositoryClick.current) { event.preventDefault(); suppressRepositoryClick.current = false; return; } void openPath(item.path); }}>{item.name.slice(0, 1).toUpperCase()}</button>
              <button className="repository-remove" aria-label={`移除工作区 ${item.name}`} title="从 easygit 移除工作区" disabled={busy} onClick={() => requestRemoval(item)}><IconX size={11} /></button>
            </div>)}
          </div>
        </div>
        <SidebarProjectDrawer projects={workspaces} selected={snapshot.path} busy={busy} sidebarRef={sidebarRef} onOpen={openPath} />
        </div>
        <button className="repository-scroll-button" title="向下滚动仓库列表" aria-label="向下滚动仓库列表" disabled={!repositoryScroll.canDown} onClick={() => scrollRepositories(1)}><IconChevronDown size={16} /></button>
        <button className="rail-button add-repository" title="打开本地仓库 · Ctrl O" aria-label="打开本地仓库" onClick={() => setModal('open')}><IconPlus size={19} /></button>
      </div>
      <div className="sidebar-bottom"><button className="rail-button" title="自定义布局" aria-label="自定义布局" onClick={() => setModal('layout')}><IconLayoutGrid size={20} /></button><button className="rail-button" title={theme === 'light' ? '切换深色主题' : '切换浅色主题'} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <IconMoon size={20} /> : <IconSun size={20} />}</button><button className="rail-button" title="偏好设置" aria-label="偏好设置" onClick={() => setModal('settings')}><IconSettings size={20} /></button></div>
    </aside>

    {repositoryTooltip && createPortal(<div id="repository-tooltip" className="repository-tooltip" role="tooltip" style={{ left: repositoryTooltip.left, top: repositoryTooltip.top }}><strong>{repositoryTooltip.name}</strong><small>{repositoryTooltip.path}</small></div>, document.body)}

    <main className="main-scroll">
      <div className="workspace-topbar"><button className="repository-switcher" title="切换仓库" aria-label="切换仓库" onClick={() => setModal('open')}><IconFolder size={19} /><strong>{snapshot.name || '选择仓库'}</strong><IconChevronDown size={13} /></button><div className="topbar-tools"><button className="topbar-search" onClick={() => setModal('commands')}><IconSearch size={16} /><span>搜索命令或操作</span><kbd>Ctrl K</kbd></button><button className="primary-button open-repo-button" aria-label="打开项目所在文件夹" title={snapshot.path ? `打开项目所在文件夹：${snapshot.path}` : '请先打开一个项目'} disabled={!hasRepository} onClick={() => { void openProjectDirectory(); }}><IconFolderOpen size={16} />打开项目所在文件夹</button></div></div>
      {hasRepository ? <div className="workspace-body">
        <section className="page-heading"><h1>工作区</h1><div className="heading-actions"><button className="text-button project-notes-button" aria-haspopup="dialog" title="记录当前项目的事项" onClick={() => setModal('project-notes')}><IconNotes size={16} aria-hidden="true" />项目笔记</button><span role="status" className={`workspace-status ${snapshot.files.length ? 'has-changes' : ''}`}><span className="tiny-dot" /><span className="workspace-status-label">{repo.activeOperation?.label ?? (repo.refreshing ? '正在刷新仓库状态…' : snapshot.operation ? snapshot.operation : snapshot.files.length ? '有未提交更改' : '工作区干净')}</span></span><button className="icon-button" aria-label="刷新仓库" title="刷新仓库 · Ctrl R" disabled={busy || repo.refreshing} onClick={() => { void repo.refresh(); }}><IconRefresh size={17} className={repo.refreshing ? 'spin' : ''} /></button></div></section>

        <section className="repository-overview" aria-label="当前仓库">
          <button className="branch-card" onClick={() => setModal('branches')} title="切换分支"><span className="branch-card-top"><span><IconGitBranch size={15} />当前分支</span></span><strong>{snapshot.branch || '尚无分支'}</strong><IconChevronDown className="branch-card-chevron" size={15} /></button>
          <div className="metric-card"><span className="metric-label">未暂存</span><strong>{changedCount}</strong></div>
          <div className="metric-card"><span className="metric-label">已暂存</span><strong>{stagedCount}</strong></div>
          <div className="metric-card"><span className="metric-label">待推送</span><strong>{snapshot.ahead}</strong></div>
        </section>

        <OperationBanner key={snapshot.path} snapshot={snapshot} busy={busy} onAction={repo.actOnOperation} />

        <div className="workspace-section-heading"><div><h2>更改与历史</h2><span className="section-subtitle">{panels.visiblePanels.length} 个面板</span></div><div><span className={`layout-saved ${panels.storageError ? 'save-error' : ''}`} title={panels.storageError ? '本次布局未保存' : '布局已保存'}><IconCheck size={12} /><span>{panels.storageError ? '未保存' : '已保存'}</span></span><button className="text-button" onClick={() => setModal('layout')}><IconLayoutGrid size={14} />布局</button></div></div>

        <WorkspaceGrid layout={panels.layout} onMove={panels.movePanel} onResize={panels.resizePanel} renderPanel={renderPanel} panelActions={id => <>{id === 'changes' && <span className="panel-count">{snapshot.files.length}</span>}{id === 'commits' && <span className="panel-subtitle">搜索 · 分页</span>}{id === 'branches' && <><BranchSearch key={snapshot.path} query={branchQuery} onQueryChange={query => setBranchFilter({ path: snapshot.path, query })} /><button className="icon-button panel-create-branch-button" aria-label="创建分支" title="基于当前分支创建本地分支" disabled={busy || syncing || Boolean(snapshot.operation) || snapshot.files.some(file => file.conflicted)} onClick={() => { setBranchName(''); setModal('create-branch'); }}><IconPlus size={16} /></button><button className="text-button panel-fetch-button" aria-label="获取远程更新" aria-busy={syncing} disabled={busy || syncing || !snapshot.remote} title={syncing ? '正在后台获取远程分支和提交记录' : snapshot.remote ? '获取远程仓库更新' : '请先配置远程仓库'} onClick={() => { void repo.fetch(); }}>{syncing ? <IconRefresh size={14} className="spin" /> : <IconArrowDown size={14} />}<span className="panel-remote-label">{syncing ? '正在获取' : '获取更新'}</span></button><button className="text-button panel-pull-button" aria-label="拉取更新" disabled={busy || syncing || !snapshot.remote || !snapshot.hasUpstream || snapshot.behind === 0 || Boolean(snapshot.operation) || snapshot.files.some(file => file.conflicted)} title={!snapshot.remote ? '请先配置远程仓库' : !snapshot.hasUpstream ? '当前分支尚未设置上游分支' : snapshot.behind === 0 ? '当前分支没有待拉取的提交' : snapshot.operation ? '请先完成当前 Git 操作' : syncing ? '正在获取远程更新' : `合并 ${snapshot.upstream?.name ?? '上游分支'} 的更新`} onClick={() => { void repo.pull(); }}><IconGitPullRequest size={14} /><span className="panel-remote-label">拉取更新</span></button></>}</>} />

        <div className="workspace-footer"><span>{repo.gitVersion || snapshot.gitVersion}</span><span>拖动 <span className="footer-grip">⠿</span> 调整位置 · 拖动边框调整大小<span className="footer-divider">·</span><kbd>Ctrl K</kbd> 命令</span></div>
      </div> : <section className="repository-empty" aria-label="尚未打开仓库">
        <IconFolderOpen size={38} stroke={1.2} />
        <h1>打开一个仓库</h1>
        <p>选择本地 Git 项目以开始。</p>
        <button className="primary-button" disabled={busy} onClick={() => setModal('open')}><IconPlus size={16} />打开仓库<kbd>Ctrl O</kbd></button>
        {repo.recents.length > 0 && <div className="empty-recent-list"><span>最近打开</span>{repo.recents.map(item => <button key={item.path} disabled={busy || !isDesktop()} title={item.path} onClick={() => { void openPath(item.path); }}><IconFolder size={16} /><strong>{item.name}</strong><small>{item.path}</small><IconChevronRight size={14} /></button>)}</div>}
      </section>}
    </main>

    {modal === 'open' && <Dialog title="打开一个 Git 仓库" onClose={() => { if (!pickingDirectory && !busy) closeModal(); }} className="open-repo-dialog"><div className="open-repo-intro"><span className="dialog-feature-icon"><IconFolderOpen size={26} stroke={1.5} /></span><p>打开本地 Git 项目目录。<br /><strong>支持普通仓库和 worktree。</strong></p></div><form onSubmit={event => { event.preventDefault(); if (!pickingDirectory) void openPath(); }}><label className="field-label" htmlFor="repo-path">仓库目录</label><RepositoryDirectoryInput value={path} onChange={setPath} defaultPath={snapshot.path} busy={busy} onPendingChange={setPickingDirectory} notify={notify} /><p className="field-help">选择或填写包含 .git 的项目目录，也支持 Git worktree。</p>{!isDesktop() && <div className="preview-note">打开本地仓库需要运行 easygit 桌面版。</div>}<button className="primary-button dialog-submit" type="submit" disabled={!path.trim() || busy || pickingDirectory || !isDesktop()}>{busy ? <IconLoader2 size={16} className="spin" /> : <IconFolderOpen size={16} />}打开仓库</button></form>{workspaces.length > 0 && <><div className="dialog-section-label">最近打开</div><div className="recent-dialog-list">{workspaces.map(item => <div className="recent-dialog-row" key={item.path}><button disabled={busy} onClick={() => { void openPath(item.path); }}><IconFolder size={19} /><span><strong>{item.name}</strong><small>{item.path}</small></span><IconChevronRight size={16} /></button><button className="icon-button" title="从 easygit 移除工作区" aria-label={`移除工作区 ${item.name}`} disabled={busy} onClick={() => requestRemoval(item)}><IconX size={14} /></button></div>)}</div></>}</Dialog>}

    {modal === 'create-branch' && <Dialog title="创建本地分支" onClose={closeModal} className="create-branch-dialog"><form onSubmit={event => { event.preventDefault(); const name = branchName.trim(); if (!name) return; void repo.createBranch(name).then(success => { if (success) { setBranchName(''); closeModal(); } }); }}><p className="dialog-description">从 <code>{snapshot.branch || '当前提交'}</code> 创建并切换到新分支。</p><label className="field-label" htmlFor="new-branch-name">新分支名称</label><input id="new-branch-name" className="text-field mono" value={branchName} onChange={event => setBranchName(event.target.value)} placeholder="例如 feature/login" autoFocus spellCheck={false} /><p className="field-help">输入新的本地分支名，不能与现有分支重名。</p><div className="dialog-action-row"><button className="text-button" type="button" disabled={busy} onClick={closeModal}>取消</button><button className="primary-button" type="submit" disabled={!branchName.trim() || busy}>{busy ? <IconLoader2 size={16} className="spin" /> : <IconGitBranch size={16} />}创建并切换</button></div></form></Dialog>}

    {modal === 'layout' && <Dialog title="自定义布局" onClose={closeModal}><p className="dialog-description">选择你需要的面板。拖动标题栏手柄交换位置，拖动右侧、底部边框调整宽高；双击边框恢复默认尺寸。尺寸和布局会自动保存。</p><div className="layout-options">{PANEL_IDS.map(id => { const Icon = panelIcons[id]; const visible = !panels.layout.hidden.includes(id); return <label key={id} className={visible ? 'checked' : ''}><span className="layout-option-icon"><Icon size={20} stroke={1.5} /></span><span><strong>{PANEL_TITLES[id]}</strong><small>{{ changes: '查看文件更改与创建提交', diff: '逐行查看代码差异', branches: '切换、合并与对比分支', commits: '搜索与翻页查看提交', stash: '保存、预览与恢复未完成更改', activity: '跟踪操作结果与错误', scripts: '读取 package.json 脚本并在终端运行', files: '浏览项目目录、查看内容并编辑文件' }[id]}</small></span><input type="checkbox" checked={visible} disabled={visible && panels.visiblePanels.length === 1} onChange={() => panels.togglePanel(id)} /></label>; })}</div><div className="dialog-action-row"><button className="text-button" onClick={() => { panels.resetLayout(); notify('已恢复默认布局'); }}><IconRefresh size={15} />恢复默认布局</button><button className="primary-button" onClick={closeModal}><IconCheck size={16} />完成</button></div></Dialog>}

    {modal === 'commands' && <Dialog title="命令面板" className="command-dialog" onClose={closeModal}><label className="command-search"><IconSearch size={21} /><input aria-label="搜索命令" placeholder="搜索命令…" value={query} onChange={e => setQuery(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') actions.find(action => `${action.title}${action.detail}`.includes(query))?.run(); }} /><kbd>ESC</kbd></label><div className="dialog-section-label">快捷操作</div><div className="command-list">{actions.filter(action => `${action.title}${action.detail}`.includes(query)).map(action => <button key={action.id} onClick={action.run}><span className="command-icon"><action.icon size={19} /></span><span><strong>{action.title}</strong><small>{action.detail}</small></span>{action.shortcut && <kbd>{action.shortcut}</kbd>}<IconChevronRight size={14} /></button>)}{!actions.some(action => `${action.title}${action.detail}`.includes(query)) && <div className="empty-inline">没有找到对应命令，试试“布局”或“分支”。</div>}</div><div className="command-footer"><span><kbd>↵</kbd> 执行首个结果</span><span>Ctrl K 打开 / 关闭</span></div></Dialog>}

    {modal === 'branches' && <Dialog title="切换分支" onClose={closeModal}><p className="dialog-description">当前分支：<code>{snapshot.branch}</code></p><BranchesPanel onBranchAction={repo.manageBranch} notify={repo.notify} snapshot={snapshot} busy={busy} mergeDisabled={mergeDisabled} onMergeRequest={requestBranchMerge} onCheckout={(name, remote) => { void repo.checkout(name, remote).then(ok => { if (ok) closeModal(); }); }} /></Dialog>}

    {modal === 'settings' && <Dialog title="偏好设置" onClose={closeModal}>
      <div className="settings-section"><h3><IconPalette size={17} />外观</h3><p>选择界面主题。</p><div className="theme-options"><button className={theme === 'light' ? 'chosen' : ''} onClick={() => setTheme('light')}><span className="theme-preview light-preview"><i /><i /><i /></span><span><IconSun size={16} />浅色{theme === 'light' && <IconCheck size={15} />}</span></button><button className={theme === 'dark' ? 'chosen' : ''} onClick={() => setTheme('dark')}><span className="theme-preview dark-preview"><i /><i /><i /></span><span><IconMoon size={16} />深色{theme === 'dark' && <IconCheck size={15} />}</span></button></div></div>
      <button className="settings-link" onClick={() => setModal('ai-settings')}><IconKey size={19} /><span><strong>AI 提交信息</strong><small>{aiSettings.apiKey ? '已配置第三方 AI 服务' : '配置 API Key，按差异生成提交信息'}</small></span><IconChevronRight size={17} /></button>
      <button className="settings-link" onClick={() => setModal('data-settings')}><IconFolder size={19} /><span><strong>数据存储</strong><small>查看、打开或迁移本机数据目录</small></span><IconChevronRight size={17} /></button>
      <button className="settings-link" onClick={() => setModal('layout')}><IconLayoutGrid size={19} /><span><strong>面板与布局</strong><small>选择面板，自由组织工作台</small></span><IconChevronRight size={17} /></button>
      <button className="about-app" aria-label="关于 easygit 与版本更新" onClick={() => setModal('about')}><img src="/brand/esaygit-icon.png" alt="" /><div><strong>easygit <span>v{APP_VERSION}</span></strong><p>{updates.info?.hasUpdate ? `发现新版本 v${updates.info.latestVersion}` : '关于、下载与版本更新'}</p></div><IconChevronRight size={17} /></button>
    </Dialog>}

    {modal === 'ai-settings' && <Dialog title="AI 提交信息" onClose={closeModal}>
      <p className="dialog-description">配置兼容 OpenAI Chat Completions 的第三方服务。默认使用 DeepSeek；提交信息会按规范生成，例如 <code>feat: 添加功能</code>、<code>docs: 更新说明</code>。设置保存在本机数据目录，API Key 由 Windows 系统加密保存。</p>
      <div className="ai-settings-form">
        <label className="field-label" htmlFor="ai-base-url">API 地址</label>
        <input id="ai-base-url" className="text-field mono" value={aiSettings.baseUrl} placeholder="https://api.deepseek.com" spellCheck={false} onChange={event => setAiSettings(current => ({ ...current, baseUrl: event.target.value }))} />
        <label className="field-label" htmlFor="ai-model">模型名称</label>
        <input id="ai-model" className="text-field mono" value={aiSettings.model} placeholder="deepseek-flash" spellCheck={false} onChange={event => setAiSettings(current => ({ ...current, model: event.target.value }))} />
        <label className="field-label" htmlFor="ai-api-key">API Key</label>
        <input id="ai-api-key" className="text-field mono" type="password" autoComplete="new-password" value={aiSettings.apiKey} placeholder="粘贴第三方服务的 API Key" onChange={event => setAiSettings(current => ({ ...current, apiKey: event.target.value }))} />
      </div>
      <p className="ai-settings-notice">点击生成时，当前仓库的已暂存差异会发送到上述服务以生成提交信息。</p>
      <div className="dialog-action-row"><button className="text-button" onClick={() => setAiSettings(DEFAULT_AI_SETTINGS)}>恢复 DeepSeek 默认值</button><button className="primary-button" onClick={closeModal}><IconCheck size={16} />完成</button></div>
    </Dialog>}

    {modal === 'data-settings' && <DataStorageDialog onClose={closeModal} notify={notify} />}
    {modal === 'about' && <AboutDialog updates={updates} onClose={closeModal} />}
    {modal === 'project-notes' && hasRepository && <ProjectNotesDialog key={snapshot.path} path={snapshot.path} name={snapshot.name} onClose={closeModal} />}
    {editor.visible && hasRepository && createPortal(<FileEditorDialog editor={editor} snapshot={snapshot} busy={busy} refreshKey={filesRefreshKey} onOpen={openFile} onResolveConflict={openFile} />, document.body)}

    {mergeRequest && <BranchMergeDialog key={`${snapshot.path}:${mergeRequest.sourceRemote}:${mergeRequest.source}:${mergeRequest.targetRemote}:${mergeRequest.target}`} path={snapshot.path} source={mergeRequest.source} sourceRemote={mergeRequest.sourceRemote} target={mergeRequest.target} targetRemote={mergeRequest.targetRemote} busy={busy} hasChanges={snapshot.files.length > 0} operation={snapshot.operation} onClose={() => setMergeRequest(null)} onConfirm={(preview: MergePreview) => repo.merge(preview)} onSelectCommit={commit => { setCommitDetailStatus(`待合并提交 · ${mergeRequest.source} → ${mergeRequest.target}`); setSelectedCommit(commit); }} />}

    {selectedCommit && <CommitDetailsDialog key={`${snapshot.path}:${selectedCommit.hash}`} path={snapshot.path} commit={selectedCommit} status={commitDetailStatus ?? commitStatus(selectedCommit, snapshot.hasUpstream).label} notify={notify} onClose={() => { setSelectedCommit(null); setCommitDetailStatus(null); }} />}
    {comparingBranches && hasRepository && <BranchCompareDialog key={snapshot.path} path={snapshot.path} branches={snapshot.branches} onClose={() => setComparingBranches(false)} />}

    {removal && <RemoveWorkspaceDialog workspace={removal.workspace} busy={busy} onCancel={cancelRemoval} onConfirm={confirmRemoval} />}
    {discardConfirmation && (discardConfirmation.overlay ? createPortal(<DiscardChangesDialog {...discardConfirmation} busy={busy} onCancel={() => { if (!busy) setDiscardConfirmation(null); }} onConfirm={() => { void confirmDiscard(); }} />, document.body) : <DiscardChangesDialog {...discardConfirmation} busy={busy} onCancel={() => { if (!busy) setDiscardConfirmation(null); }} onConfirm={() => { void confirmDiscard(); }} />)}
    {conflictFile && createPortal(<ConflictResolutionDialog key={`${snapshot.path}:${conflictFile}`} path={snapshot.path} file={conflictFile} operation={snapshot.operation} busy={busy} onResolve={repo.resolveConflict} onClose={() => setConflictFile(null)} />, document.body)}
    {blockDiscard && createPortal(<DiscardBlockDialog {...blockDiscard} untracked={Boolean(snapshot.files.find(file => file.path === blockDiscard.file)?.untracked)} busy={busy} onCancel={() => { if (!busy) setBlockDiscard(null); }} onConfirm={() => { void confirmBlockDiscard(); }} />, document.body)}
    {repo.notices.length > 0 && createPortal(<ToastStack notices={repo.notices} onDismiss={repo.dismissNotice} />, document.body)}
  </div>;
}

