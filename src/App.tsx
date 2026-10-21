import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconArrowDown, IconArrowUp, IconCheck, IconChevronDown, IconChevronRight, IconCopy, IconFolder, IconFolderOpen, IconGitBranch, IconGitCommit, IconLayoutDashboard, IconLayoutGrid, IconLoader2, IconMoon, IconPalette, IconPlus, IconRefresh, IconSearch, IconSettings, IconSun, IconTerminal2, IconX } from '@tabler/icons-react';
import { WorkspaceGrid, usePanelLayout, PANEL_IDS, PANEL_TITLES, type PanelId } from './layout';
import { ChangesPanel, DiffPanel, BranchesPanel, CommitsPanel, StashPanel, ActivityPanel, panelIcons } from './components/Panels';
import { WindowControls } from './components/WindowControls';
import { Dialog } from './components/Dialog';
import { RemoveWorkspaceDialog } from './components/RemoveWorkspaceDialog';
import { isDesktop, type GitCommit } from './services/git';
import { useRepository, type RecentRepository } from './services/useRepository';

type Modal = 'open' | 'layout' | 'commands' | 'settings' | 'branches' | null;
function readTheme(): 'light' | 'dark' { try { return localStorage.getItem('esaygit.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }

export default function App({ onReady }: { onReady: () => void }) {
  const repo = useRepository(onReady);
  const panels = usePanelLayout();
  const { snapshot, hasRepository, busy, notify } = repo;
  const [theme, setTheme] = useState(readTheme);
  const [modal, setModal] = useState<Modal>(null);
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<string | null>(snapshot.files[0]?.path ?? null);
  const [staged, setStaged] = useState(false);
  const [query, setQuery] = useState('');
  const [commitDrafts, setCommitDrafts] = useState<Record<string, string>>({});
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [activeNav, setActiveNav] = useState('workspace');
  const [removal, setRemoval] = useState<{ workspace: RecentRepository; returnToOpen: boolean } | null>(null);
  const closeModal = useCallback(() => { setModal(null); setQuery(''); }, []);
  const workspaces = hasRepository && !repo.recents.some(item => item.path === snapshot.path)
    ? [{ name: snapshot.name, path: snapshot.path }, ...repo.recents] : repo.recents;

  function requestRemoval(workspace: RecentRepository) {
    if (busy) return;
    setRemoval({ workspace, returnToOpen: modal === 'open' });
    setSelectedCommit(null);
    closeModal();
  }
  function cancelRemoval() {
    if (removal?.returnToOpen) setModal('open');
    setRemoval(null);
  }
  function confirmRemoval() {
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('esaygit.theme', theme); } catch { /* optional preference */ }
  }, [theme]);

  useEffect(() => {
    const current = snapshot.files.find(f => f.path === selected);
    if (!current) { const first = snapshot.files[0]; setSelected(first?.path ?? null); setStaged(first?.staged ?? false); }
    else if (staged && !current.staged) setStaged(false);
    else if (!staged && !current.unstaged && current.staged) setStaged(true);
  }, [snapshot, selected]);

  useEffect(() => {
    if (!repo.notice) return;
    const timeout = window.setTimeout(() => repo.setNotice(null), repo.notice.error ? 8000 : 3500);
    return () => clearTimeout(timeout);
  }, [repo.notice, repo.setNotice]);

  const focusPanel = (id: PanelId) => {
    if (!hasRepository) { setModal('open'); return; }
    if (panels.layout.hidden.includes(id)) panels.togglePanel(id);
    setActiveNav(id === 'commits' ? 'commits' : id === 'branches' ? 'branches' : id === 'activity' ? 'activity' : 'workspace');
    window.setTimeout(() => {
      const node = document.querySelector<HTMLElement>(`[data-eg-panel="${id}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.classList.add('panel-highlight');
      window.setTimeout(() => node?.classList.remove('panel-highlight'), 1200);
    }, 80);
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (removal) {
        if ((event.ctrlKey || event.metaKey) && ['k', 'o', 'r'].includes(event.key.toLowerCase())) event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setModal(current => current === 'commands' ? null : 'commands'); setQuery(''); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); setModal('open'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') { event.preventDefault(); void repo.refresh(); }
      if (event.key === '/' && !modal && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="筛选变更文件"]')?.focus(); }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [modal, removal, repo.refresh]);

  const actions = useMemo(() => [
    { id: 'open', icon: IconFolderOpen, title: '打开本地仓库', detail: '输入 Git 项目目录', shortcut: 'Ctrl O', run: () => setModal('open') },
    { id: 'refresh', icon: IconRefresh, title: '刷新仓库状态', detail: '获取当前工作区的最新状态', shortcut: 'Ctrl R', run: () => { closeModal(); void repo.refresh(); } },
    { id: 'layout', icon: IconLayoutGrid, title: '自定义工作台', detail: '显示、隐藏和重新排列面板', shortcut: '', run: () => setModal('layout') },
    { id: 'theme', icon: theme === 'light' ? IconMoon : IconSun, title: theme === 'light' ? '切换深色主题' : '切换浅色主题', detail: '界面外观', shortcut: '', run: () => { setTheme(t => t === 'light' ? 'dark' : 'light'); closeModal(); } },
    { id: 'branches', icon: IconGitBranch, title: '切换分支', detail: snapshot.branch, shortcut: '', run: () => setModal('branches') },
  ].filter(action => hasRepository || !['refresh', 'branches'].includes(action.id)), [theme, snapshot.branch, hasRepository, repo.refresh, closeModal]);

  async function openPath(value = path) { if (await repo.open(value)) { setPath(''); closeModal(); setActiveNav('workspace'); } }
  const stagedCount = snapshot.files.filter(f => f.staged).length;
  const changedCount = snapshot.files.filter(f => f.unstaged || f.untracked && !f.staged).length;
  const renderPanel = (id: PanelId) => {
    switch (id) {
      case 'changes': return <ChangesPanel key={snapshot.path} snapshot={snapshot} message={commitDrafts[snapshot.path] ?? ''} onMessageChange={message => setCommitDrafts(current => ({ ...current, [snapshot.path]: message }))} selected={selected} busy={busy} onSelect={(file, cached) => { setSelected(file); setStaged(cached); }} onStage={paths => { void repo.stage(paths); }} onUnstage={paths => { void repo.unstage(paths); }} onCommit={repo.commit} />;
      case 'diff': return <DiffPanel snapshot={snapshot} selected={selected} staged={staged} onStagedChange={setStaged} notify={notify} />;
      case 'branches': return <BranchesPanel snapshot={snapshot} busy={busy} onCheckout={name => { void repo.checkout(name); }} />;
      case 'commits': return <CommitsPanel snapshot={snapshot} onSelect={setSelectedCommit} />;
      case 'stash': return <StashPanel count={snapshot.stashCount} />;
      case 'activity': return <ActivityPanel activities={repo.activities} />;
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

    <aside className="sidebar" aria-label="工具栏">
      <button className="rail-brand" title="easygit · 返回工作台" aria-label="返回工作台" onClick={() => { setActiveNav('workspace'); document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); }}><img src="/brand/esaygit-icon.png" alt="" draggable={false} /></button>
      <nav className="main-nav" aria-label="主导航">
        <button title="工作台" aria-label="工作台" aria-current={activeNav === 'workspace' ? 'page' : undefined} className={activeNav === 'workspace' ? 'active' : ''} onClick={() => { setActiveNav('workspace'); document.querySelector('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); }}><IconLayoutDashboard size={20} /></button>
        <button title="提交历史" aria-label="提交历史" aria-current={activeNav === 'commits' ? 'page' : undefined} className={activeNav === 'commits' ? 'active' : ''} onClick={() => focusPanel('commits')}><IconGitCommit size={21} /></button>
        <button title="分支管理" aria-label="分支管理" aria-current={activeNav === 'branches' ? 'page' : undefined} className={activeNav === 'branches' ? 'active' : ''} onClick={() => focusPanel('branches')}><IconGitBranch size={20} /></button>
        <button title="操作记录" aria-label="操作记录" aria-current={activeNav === 'activity' ? 'page' : undefined} className={activeNav === 'activity' ? 'active' : ''} onClick={() => focusPanel('activity')}><IconTerminal2 size={20} /></button>
      </nav>
      <span className="rail-divider" />
      <div className="repository-list">
        {workspaces.map(item => <div className="repository-entry" key={item.path}>
          <button className={`repository-item ${snapshot.path === item.path ? 'selected' : ''}`} aria-label={`打开仓库 ${item.name}`} title={`${item.name}\n${item.path}`} disabled={busy} onClick={() => { void openPath(item.path); }}>{item.name.slice(0, 1).toUpperCase()}{snapshot.path === item.path && <span />}</button>
          <button className="repository-remove" aria-label={`移除工作区 ${item.name}`} title="从 easygit 移除工作区" disabled={busy} onClick={() => requestRemoval(item)}><IconX size={11} /></button>
        </div>)}
        <button className="rail-button add-repository" title="打开本地仓库 · Ctrl O" aria-label="打开本地仓库" onClick={() => setModal('open')}><IconPlus size={19} /></button>
      </div>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom"><button className="rail-button" title="自定义布局" aria-label="自定义布局" onClick={() => setModal('layout')}><IconLayoutGrid size={20} /></button><button className="rail-button" title={theme === 'light' ? '切换深色主题' : '切换浅色主题'} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <IconMoon size={20} /> : <IconSun size={20} />}</button><button className="rail-button" title="偏好设置" aria-label="偏好设置" onClick={() => setModal('settings')}><IconSettings size={20} /></button></div>
    </aside>

    <main className="main-scroll">
      <div className="workspace-topbar"><button className="repository-switcher" title="切换仓库" aria-label="切换仓库" onClick={() => setModal('open')}><IconFolder size={19} /><strong>{snapshot.name || '选择仓库'}</strong><IconChevronDown size={13} /></button><div className="topbar-tools"><button className="topbar-search" onClick={() => setModal('commands')}><IconSearch size={16} /><span>搜索命令或操作</span><kbd>Ctrl K</kbd></button><button className="primary-button open-repo-button" onClick={() => setModal('open')}><IconPlus size={16} />打开仓库</button></div></div>
      {hasRepository ? <div className="workspace-body">
        <section className="page-heading"><h1>工作区</h1><div className="heading-actions"><span className={`workspace-status ${snapshot.files.length ? 'has-changes' : ''}`}><span className="tiny-dot" />{snapshot.operation ? snapshot.operation : snapshot.files.length ? '有未提交更改' : '工作区干净'}</span><button className="icon-button" aria-label="刷新仓库" title="刷新仓库 · Ctrl R" disabled={busy} onClick={() => { void repo.refresh(); }}><IconRefresh size={17} className={busy ? 'spin' : ''} /></button></div></section>

        <section className="repository-overview" aria-label="当前仓库">
          <button className="branch-card" onClick={() => setModal('branches')} title="切换分支"><span className="branch-card-top"><span><IconGitBranch size={15} />当前分支</span><IconChevronDown size={15} /></span><strong>{snapshot.branch || '尚无分支'}</strong><span className="branch-card-bottom"><span title={snapshot.path}>{snapshot.path}</span><span className="branch-card-local">LOCAL</span></span></button>
          <div className="metric-card"><span className="metric-label">未暂存<IconFolder size={16} /></span><strong>{changedCount}</strong><span className="metric-detail">工作区文件</span></div>
          <div className="metric-card"><span className="metric-label">已暂存<IconCheck size={16} /></span><strong>{stagedCount}</strong><span className="metric-detail"><span className="metric-dot" />等待提交</span></div>
          <div className="metric-card"><span className="metric-label">待推送<IconArrowUp size={16} /></span><strong>{snapshot.ahead}</strong><span className="metric-detail">{snapshot.remote ? `${snapshot.remote} · 落后 ${snapshot.behind} 次提交` : '未设置远程'}</span></div>
        </section>

        {snapshot.operation && <div className="operation-banner"><IconGitBranch size={16} />当前正在进行 {snapshot.operation}，请处理完成后继续提交。</div>}

        <div className="workspace-section-heading"><div><h2>更改与历史</h2><span className="section-subtitle">{panels.visiblePanels.length} 个面板</span></div><div><span className={`layout-saved ${panels.storageError ? 'save-error' : ''}`} title={panels.storageError ? '本次布局未保存' : '布局已保存'}><IconCheck size={12} /><span>{panels.storageError ? '未保存' : '已保存'}</span></span><button className="text-button" onClick={() => setModal('layout')}><IconLayoutGrid size={14} />布局</button><span className="toolbar-divider" /><button className="text-button" disabled={busy || !snapshot.remote} onClick={() => { void repo.fetch(); }}><IconArrowDown size={14} />获取更新</button></div></div>

        <WorkspaceGrid layout={panels.layout} onMove={panels.movePanel} renderPanel={renderPanel} panelActions={id => <>{id === 'changes' && <span className="panel-count">{snapshot.files.length}</span>}{id === 'commits' && <span className="panel-subtitle">最近 {Math.min(snapshot.commits.length, 5)} 次</span>}<button className="panel-hide-button" aria-label={`隐藏${PANEL_TITLES[id]}`} title="隐藏面板" disabled={panels.visiblePanels.length === 1} onClick={() => panels.togglePanel(id)}><IconX size={13} /></button></>} />

        <div className="workspace-footer"><span>{repo.gitVersion || snapshot.gitVersion}</span><span>拖动 <span className="footer-grip">⠿</span> 调整面板<span className="footer-divider">·</span><kbd>Ctrl K</kbd> 命令</span></div>
      </div> : <section className="repository-empty" aria-label="尚未打开仓库">
        <IconFolderOpen size={38} stroke={1.2} />
        <h1>打开一个仓库</h1>
        <p>选择本地 Git 项目以开始。</p>
        <button className="primary-button" disabled={busy} onClick={() => setModal('open')}><IconPlus size={16} />打开仓库<kbd>Ctrl O</kbd></button>
        {repo.recents.length > 0 && <div className="empty-recent-list"><span>最近打开</span>{repo.recents.map(item => <button key={item.path} disabled={busy || !isDesktop()} title={item.path} onClick={() => { void openPath(item.path); }}><IconFolder size={16} /><strong>{item.name}</strong><small>{item.path}</small><IconChevronRight size={14} /></button>)}</div>}
      </section>}
    </main>

    {modal === 'open' && <Dialog title="打开一个 Git 仓库" onClose={closeModal} className="open-repo-dialog"><div className="open-repo-intro"><span className="dialog-feature-icon"><IconFolderOpen size={26} stroke={1.5} /></span><p>打开本地 Git 项目目录。<br /><strong>支持普通仓库和 worktree。</strong></p></div><form onSubmit={event => { event.preventDefault(); void openPath(); }}><label className="field-label" htmlFor="repo-path">仓库目录</label><input id="repo-path" className="text-field mono" placeholder="例如 X:\Projects\my-repository" value={path} onChange={e => setPath(e.target.value)} autoFocus /><p className="field-help">填写包含 .git 的项目目录，也支持 Git worktree。</p>{!isDesktop() && <div className="preview-note">打开本地仓库需要运行 easygit 桌面版。</div>}<button className="primary-button dialog-submit" type="submit" disabled={!path.trim() || busy || !isDesktop()}>{busy ? <IconLoader2 size={16} className="spin" /> : <IconFolderOpen size={16} />}打开仓库</button></form>{workspaces.length > 0 && <><div className="dialog-section-label">最近打开</div><div className="recent-dialog-list">{workspaces.map(item => <div className="recent-dialog-row" key={item.path}><button disabled={busy} onClick={() => { void openPath(item.path); }}><IconFolder size={19} /><span><strong>{item.name}</strong><small>{item.path}</small></span><IconChevronRight size={16} /></button><button className="icon-button" title="从 easygit 移除工作区" aria-label={`移除工作区 ${item.name}`} disabled={busy} onClick={() => requestRemoval(item)}><IconX size={14} /></button></div>)}</div></>}</Dialog>}

    {modal === 'layout' && <Dialog title="自定义布局" onClose={closeModal}><p className="dialog-description">选择你需要的面板。拖动面板标题栏上的手柄，即可交换位置；布局会自动保存在这台设备上。</p><div className="layout-options">{PANEL_IDS.map(id => { const Icon = panelIcons[id]; const visible = !panels.layout.hidden.includes(id); return <label key={id} className={visible ? 'checked' : ''}><span className="layout-option-icon"><Icon size={20} stroke={1.5} /></span><span><strong>{PANEL_TITLES[id]}</strong><small>{{ changes: '查看文件更改与创建提交', diff: '逐行查看代码差异', branches: '查看与切换本地分支', commits: '回看最近的提交记录', stash: '查看暂存记录数量', activity: '跟踪操作结果与错误' }[id]}</small></span><input type="checkbox" checked={visible} disabled={visible && panels.visiblePanels.length === 1} onChange={() => panels.togglePanel(id)} /></label>; })}</div><div className="dialog-action-row"><button className="text-button" onClick={() => { panels.resetLayout(); notify('已恢复默认布局'); }}><IconRefresh size={15} />恢复默认布局</button><button className="primary-button" onClick={closeModal}><IconCheck size={16} />完成</button></div></Dialog>}

    {modal === 'commands' && <Dialog title="命令面板" className="command-dialog" onClose={closeModal}><label className="command-search"><IconSearch size={21} /><input aria-label="搜索命令" placeholder="搜索命令…" value={query} onChange={e => setQuery(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') actions.find(action => `${action.title}${action.detail}`.includes(query))?.run(); }} /><kbd>ESC</kbd></label><div className="dialog-section-label">快捷操作</div><div className="command-list">{actions.filter(action => `${action.title}${action.detail}`.includes(query)).map(action => <button key={action.id} onClick={action.run}><span className="command-icon"><action.icon size={19} /></span><span><strong>{action.title}</strong><small>{action.detail}</small></span>{action.shortcut && <kbd>{action.shortcut}</kbd>}<IconChevronRight size={14} /></button>)}{!actions.some(action => `${action.title}${action.detail}`.includes(query)) && <div className="empty-inline">没有找到对应命令，试试“布局”或“分支”。</div>}</div><div className="command-footer"><span><kbd>↵</kbd> 执行首个结果</span><span>Ctrl K 打开 / 关闭</span></div></Dialog>}

    {modal === 'branches' && <Dialog title="切换分支" onClose={closeModal}><p className="dialog-description">当前分支：<code>{snapshot.branch}</code></p><BranchesPanel snapshot={snapshot} busy={busy} onCheckout={name => { void repo.checkout(name).then(ok => { if (ok) closeModal(); }); }} /></Dialog>}

    {modal === 'settings' && <Dialog title="偏好设置" onClose={closeModal}><div className="settings-section"><h3><IconPalette size={17} />外观</h3><p>选择界面主题。</p><div className="theme-options"><button className={theme === 'light' ? 'chosen' : ''} onClick={() => setTheme('light')}><span className="theme-preview light-preview"><i /><i /><i /></span><span><IconSun size={16} />浅色{theme === 'light' && <IconCheck size={15} />}</span></button><button className={theme === 'dark' ? 'chosen' : ''} onClick={() => setTheme('dark')}><span className="theme-preview dark-preview"><i /><i /><i /></span><span><IconMoon size={16} />深色{theme === 'dark' && <IconCheck size={15} />}</span></button></div></div><button className="settings-link" onClick={() => setModal('layout')}><IconLayoutGrid size={19} /><span><strong>面板与布局</strong><small>选择面板，自由组织工作台</small></span><IconChevronRight size={17} /></button><div className="about-app"><img src="/brand/esaygit-icon.png" alt="" /><div><strong>easygit <span>0.1.0</span></strong><p>本地 Git 客户端。</p></div><span>Tauri + React</span></div></Dialog>}

    {selectedCommit && <Dialog title="提交详情" onClose={() => setSelectedCommit(null)}><div className="commit-detail"><IconGitCommit size={32} stroke={1.5} /><h3>{selectedCommit.subject}</h3><p>{selectedCommit.author} · {new Date(selectedCommit.date).toLocaleString('zh-CN')}</p><label className="field-label">Commit SHA</label><div className="commit-hash"><code>{selectedCommit.hash}</code><button className="icon-button" aria-label="复制提交 SHA" onClick={() => { void navigator.clipboard.writeText(selectedCommit.hash).then(() => notify('Commit SHA 已复制')).catch(() => notify('无法访问剪贴板', true)); }}><IconCopy size={16} /></button></div></div></Dialog>}

    {removal && <RemoveWorkspaceDialog workspace={removal.workspace} busy={busy} onCancel={cancelRemoval} onConfirm={confirmRemoval} />}
    {repo.notice && <div className={`toast ${repo.notice.error ? 'error' : ''}`} role={repo.notice.error ? 'alert' : 'status'}>{repo.notice.error ? <IconX size={17} /> : <IconCheck size={17} />}<span>{repo.notice.message}</span><button aria-label="关闭提示" onClick={() => repo.setNotice(null)}><IconX size={14} /></button></div>}
  </div>;
}

