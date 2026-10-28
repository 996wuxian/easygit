import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyRepository, git, isDesktop, type BranchRequest, type CommitAction, type ConflictResolution, type DiffBlock, type MergePreview, type RepositorySnapshot, type PullResult, type StashEntry, type StashAction, type OperationRequest } from './git';
import { appStorage } from './storage';
import { formatCheckoutError, formatFetchError, formatPullError, formatStageError, gitErrorMessage } from './gitErrors';
import { project, type ProjectText, type DeletedProjectEntry } from './project';
import { confirmPendingChanges } from './pendingChanges';
import type { CloneProgress, NewRepositoryRequest, RemoteRequest as ConfigureRemoteRequest } from './git';

export interface RecentRepository { name: string; path: string }
export interface Activity { id: string; label: string; time: string; error?: boolean; details?: string }
export interface Notice { id: string; message: string; error: boolean }
export interface RepositoryTask { kind: string; label: string }
interface RemoteRequest { path: string; session: number; reading: boolean; promise: Promise<boolean>; complete: (updated: boolean) => void }
interface RefreshRequest { path: string; token: number; promise: Promise<boolean>; notified: boolean; force: boolean }
const RECENTS_KEY = 'esaygit.recent.v1';
function loadRecents(): RecentRepository[] {
  try {
    const data: unknown = JSON.parse(appStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter((v): v is RecentRepository => v && typeof v.name === 'string' && typeof v.path === 'string' && !v.path.startsWith('demo:')) : [];
  } catch { return []; }
}
function remember(recents: RecentRepository[]) {
  try { appStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch { /* storage can be unavailable */ }
}

export function useRepository(onReady: () => void) {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot>(emptyRepository);
  const [recents, setRecents] = useState(loadRecents);
  const [busy, setBusy] = useState(false);
  const [activeOperation, setActiveOperation] = useState<RepositoryTask | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshCount = useRef(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [gitVersion, setGitVersion] = useState('');
  const snapshotRef = useRef(snapshot);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const refreshRequest = useRef<RefreshRequest | null>(null);
  const session = useRef(0);
  const remoteRequest = useRef<RemoteRequest | null>(null);
  const [remoteSync, setRemoteSync] = useState<{ request: RemoteRequest; fetched: boolean } | null>(null);
  const hasRepository = Boolean(snapshot.path);
  snapshotRef.current = snapshot;

  const notify = useCallback((message: string, error = false, details?: string) => {
    const id = crypto.randomUUID();
    setNotices(items => [...items, { id, message, error }]);
    setActivities(items => [{ id, label: message, error, details, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }, ...items].slice(0, 40));
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices(items => items.filter(item => item.id !== id));
  }, []);

  const fetch = useCallback(() => {
    const current = snapshotRef.current;
    if (!current.path || !current.remote) return Promise.resolve(false);
    const existing = remoteRequest.current;
    if (existing?.path === current.path && existing.session === session.current) return existing.promise;
    let complete!: RemoteRequest['complete'];
    const promise = new Promise<boolean>(resolve => { complete = resolve; });
    const request: RemoteRequest = { path: current.path, session: session.current, reading: false, promise, complete };
    remoteRequest.current = request;
    setRemoteSync({ request, fetched: false });
    // Fetch runs independently of the selected workspace and never locks navigation.
    // Re-read after it completes: its returned snapshot may predate another local action.
    void git.fetch(request.path).then(() => {
      if (remoteRequest.current !== request) return request.complete(false);
      setRemoteSync({ request, fetched: true });
    }, error => {
      if (remoteRequest.current === request) {
        remoteRequest.current = null;
        setRemoteSync(null);
        notify(formatFetchError(error), true, gitErrorMessage(error));
      }
      request.complete(false);
    });
    return promise;
  }, [notify]);

  const open = useCallback(async (path: string, setup?: { load: () => Promise<RepositorySnapshot>; kind: string; label: string; onError: (message: string) => void }) => {
    if (busyRef.current) return false;
    if (!await confirmPendingChanges() || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setActiveOperation(setup ? { kind: setup.kind, label: setup.label } : { kind: 'open', label: '正在打开仓库…' });
    const token = ++generation.current;
    try {
      const next = setup ? await setup.load() : await git.open(path.trim());
      if (token !== generation.current) return false;
      session.current++;
      remoteRequest.current?.complete(false);
      remoteRequest.current = null;
      setRemoteSync(null);
      snapshotRef.current = next;
      setSnapshot(next);
      setRecents(current => {
        const updated = [{ name: next.name, path: next.path }, ...current.filter(item => item.path !== next.path)];
        remember(updated);
        return updated;
      });
      notify(`已打开 ${next.name}`);
      if (setup?.kind !== 'clone') void fetch();
      return true;
    } catch (error) {
      const message = setup?.kind === 'clone' && !/^[\u3400-\u9fff]/.test(gitErrorMessage(error))
        ? formatFetchError(error).replace('获取远程更新失败：', '克隆失败：') : gitErrorMessage(error);
      setup?.onError(message);
      notify(message, true, message === gitErrorMessage(error) ? undefined : gitErrorMessage(error));
      return false;
    }
    finally { busyRef.current = false; setBusy(false); setActiveOperation(null); }
  }, [fetch, notify]);

  const setupRepository = (request: NewRepositoryRequest, onProgress: (update: CloneProgress) => void, onError: (message: string) => void) => open('', {
    kind: request.kind,
    label: request.kind === 'clone' ? '正在克隆仓库…' : '正在初始化仓库…',
    load: () => request.kind === 'clone' ? git.clone(request, onProgress) : git.initialize(request.path, request.branch),
    onError,
  });

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (isDesktop()) {
        try {
          const info = await git.bootstrap();
          if (cancelled) return;
          setGitVersion(info.gitVersion ?? 'Git 未安装');
          if (!info.gitAvailable) notify(info.error ?? '未找到 Git，请安装 Git 并重新启动。', true);
          else {
            const recent = loadRecents()[0];
            if (recent) await open(recent.path);
          }
        } catch (error) { if (!cancelled) notify(`启动检查失败：${String(error)}`, true); }
      }
      if (!cancelled) onReady();
    };
    void initialize();
    return () => { cancelled = true; };
  }, [notify, onReady, open]);

  const refresh = useCallback(async (quiet = false, message = '仓库状态已刷新') => {
    const path = snapshotRef.current.path;
    if (!path || busyRef.current) return false;
    const token = generation.current;
    let request = refreshRequest.current;
    if (!request || request.path !== path || request.token !== token) {
      const promise = git.open(path).then(next => {
        if (token !== generation.current || busyRef.current) return false;
        // Keep object identity on unchanged quiet reads, avoiding downstream
        // diff/script reads and renders. Explicit refresh always reloads.
        if (!request?.force && next.revision && next.path === snapshotRef.current.path && next.revision === snapshotRef.current.revision) return true;
        snapshotRef.current = next;
        setSnapshot(next);
        return true;
      });
      request = { path, token, promise, notified: false, force: !quiet };
      refreshRequest.current = request;
    }
    if (!quiet) request.force = true;
    if (!quiet) { refreshCount.current++; setRefreshing(true); }
    try {
      const updated = await request.promise;
      if (updated && token === generation.current && !busyRef.current && !quiet && !request.notified) {
        request.notified = true;
        notify(message);
      }
      return updated;
    } catch (error) {
      if (!quiet && token === generation.current && !request.notified) {
        request.notified = true;
        notify(String(error), true);
      }
      return false;
    } finally {
      if (refreshRequest.current === request) refreshRequest.current = null;
      if (!quiet) { refreshCount.current--; setRefreshing(refreshCount.current > 0); }
    }
  }, [notify]);

  useEffect(() => {
    if (busy || busyRef.current || !remoteSync?.fetched) return;
    const { request } = remoteSync;
    if (remoteRequest.current !== request || request.reading) return;
    request.reading = true;
    // Drop reads started before fetch, and wait for any local write to finish.
    const token = ++generation.current;
    void refresh(false, '远程分支和提交记录已更新').then(updated => {
      if (remoteRequest.current !== request) return request.complete(false);
      if (token !== generation.current || busyRef.current) {
        request.reading = false;
        setRemoteSync({ request, fetched: true });
        return;
      }
      remoteRequest.current = null;
      setRemoteSync(null);
      request.complete(updated);
    });
  }, [busy, refresh, remoteSync]);

  useEffect(() => () => {
    generation.current++;
    session.current++;
    remoteRequest.current?.complete(false);
    remoteRequest.current = null;
  }, []);

  useEffect(() => {
    if (!hasRepository) return;
    let focused = document.hasFocus();
    let disposed = false;
    let reading = false;
    let delay = 8000;
    let timer: number | undefined;
    const active = () => !disposed && focused && document.visibilityState === 'visible';
    const stop = () => { window.clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      stop();
      if (active()) timer = window.setTimeout(() => { void poll(); }, delay);
    };
    const poll = async (reset = false) => {
      if (!active() || reading) return;
      reading = true;
      const previous = snapshotRef.current;
      try {
        const updated = await refresh(true);
        delay = !reset && updated && previous.revision && previous === snapshotRef.current
          ? Math.min(delay * 2, 30000) : 8000;
      } finally {
        reading = false;
        schedule();
      }
    };
    const focus = () => { focused = true; delay = 8000; stop(); void poll(true); };
    const blur = () => { focused = false; stop(); };
    const visibility = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) focus();
      else blur();
    };
    schedule();
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      stop();
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [hasRepository, snapshot.path, refresh]);

  const run = useCallback(async (label: string | ((snapshot: RepositorySnapshot) => { message: string; error?: boolean }), operation: (path: string) => Promise<RepositorySnapshot>, formatError: (error: unknown) => string = String, task: RepositoryTask = { kind: 'operation', label: '正在执行仓库操作…' }) => {
    if (busyRef.current || !snapshotRef.current.path) return false;
    const expectedPath = snapshotRef.current.path;
    if (!await confirmPendingChanges() || busyRef.current || snapshotRef.current.path !== expectedPath) return false;
    busyRef.current = true;
    setBusy(true);
    const current = snapshotRef.current;
    setActiveOperation(task);
    const token = ++generation.current;
    try {
      const next = await operation(current.path);
      if (token !== generation.current) return false;
      snapshotRef.current = next;
      setSnapshot(next);
      const result = typeof label === 'string' ? { message: label } : label(next);
      notify(result.message, result.error ?? false);
      return true;
    } catch (error) {
      const message = formatError(error);
      const raw = gitErrorMessage(error);
      notify(message, true, message === raw || message === String(error) ? undefined : raw);
      return false;
    }
    finally { busyRef.current = false; setBusy(false); setActiveOperation(null); }
  }, [notify]);

  const saveFile = async (expectedPath: string, file: string, revision: string, content: string): Promise<ProjectText | null> => {
    if (busyRef.current || snapshotRef.current.path !== expectedPath) return null;
    busyRef.current = true;
    setBusy(true);
    setActiveOperation({ kind: 'save', label: `正在保存 ${file}…` });
    const token = ++generation.current;
    try {
      const result = await project.saveFile(expectedPath, file, revision, content);
      if (token !== generation.current) return null;
      if (result.snapshot) { snapshotRef.current = result.snapshot; setSnapshot(result.snapshot); }
      notify(result.refreshError ? `文件已保存，Git 状态刷新失败：${result.refreshError}` : `已保存 ${file}`, Boolean(result.refreshError));
      return result.file;
    } finally { busyRef.current = false; setBusy(false); setActiveOperation(null); }
  };

  const runOutcome = async (label: string, action: (path: string) => Promise<PullResult>, task: RepositoryTask) => {
    let outcome: PullResult | undefined;
    const updated = await run(() => ({ message: outcome?.error ? `${label}未完成：${outcome.error}` : outcome?.conflicted ? '当前操作后仍有冲突，请在工作区继续处理' : label, error: Boolean(outcome?.error || outcome?.conflicted) }), async path => {
      outcome = await action(path);
      return outcome.snapshot;
    }, undefined, task);
    return updated && Boolean(outcome && !outcome.error && !outcome.conflicted);
  };
  const saveStash = (message: string, includeUntracked: boolean) => runOutcome('已保存 stash', path => git.saveStash(path, message, includeUntracked), { kind: 'stash', label: '正在保存 stash…' });
  const actOnStash = (entry: StashEntry, action: StashAction) => runOutcome(action === 'drop' ? '已删除 stash' : action === 'pop' ? '已恢复并删除 stash' : '已恢复 stash（保留记录）', path => git.actOnStash(path, entry, action), { kind: 'stash', label: action === 'drop' ? '正在删除 stash…' : '正在恢复 stash…' });
  const actOnOperation = (request: OperationRequest) => runOutcome(request.action === 'abort' ? '已取消当前 Git 操作' : request.action === 'skip' ? '已跳过当前提交' : '已继续当前 Git 操作', path => git.actOnOperation(path, request), { kind: 'operation', label: request.action === 'abort' ? '正在取消当前 Git 操作…' : request.action === 'skip' ? '正在跳过当前提交…' : '正在继续当前 Git 操作…' });
  const stage = (paths: string[]) => run('已暂存更改', path => git.stage(path, paths), formatStageError, { kind: 'stage', label: `正在暂存 ${paths.length} 个文件…` });
  const deleteProjectEntry = async (file: string, directory: boolean) => {
    let outcome: DeletedProjectEntry | undefined;
    return run(() => ({ message: outcome?.refreshError ? `已删除 ${file}，Git 状态刷新失败：${outcome.refreshError}` : `已删除 ${file}`, error: Boolean(outcome?.refreshError) }), async path => {
      outcome = await project.deleteEntry(path, file, directory);
      return outcome.snapshot ?? snapshotRef.current;
    }, gitErrorMessage, { kind: 'delete-file', label: `正在删除 ${file}…` });
  };
  const unstage = (paths: string[]) => run('已取消暂存', path => git.unstage(path, paths), undefined, { kind: 'unstage', label: `正在取消暂存 ${paths.length} 个文件…` });
  const discard = (paths: string[]) => run(paths.length === 1 ? '已撤回更改' : '已撤回所选文件的未暂存更改', path => git.discard(path, paths), undefined, { kind: 'discard', label: `正在撤回 ${paths.length} 个文件的更改…` });
  const discardBlock = (file: string, block: DiffBlock) => run('已撤回所选变更块，其他更改已保留', path => git.discardBlock(path, file, block), undefined, { kind: 'discard', label: '正在撤回所选变更块…' });
  const resolveConflict = (file: string, revision: string, resolution: ConflictResolution, content?: string) => run('冲突已解决并暂存', path => git.resolveConflict(path, file, revision, resolution, content), undefined, { kind: 'resolve', label: '正在保存冲突解决结果…' });
  const commit = (message: string) => run('提交已创建', path => git.commit(path, message.trim()), undefined, { kind: 'commit', label: '正在创建提交…' });
  const actOnCommit = (commit: string, expectedHead: string, expectedBranch: string, action: CommitAction) => run(action === 'soft' ? '已撤回提交，更改保留在暂存区' : action === 'mixed' ? '已撤回提交，更改保留在工作区' : '已创建反向提交', path => git.actOnCommit(path, commit, expectedHead, expectedBranch, action), undefined, { kind: 'commit-action', label: action === 'revert' ? '正在创建反向提交…' : '正在撤回提交…' });
  const cherryPick = async (expectedPath: string, commit: string, expectedHead: string, expectedBranch: string) => {
    if (snapshotRef.current.path !== expectedPath) return false;
    let outcome: PullResult | undefined;
    const updated = await run(next => ({
      message: next.operation === 'cherry-pick'
        ? outcome?.conflicted ? '拣选遇到冲突，请解决并暂存后继续，也可跳过或取消操作' : '拣选已暂停，请查看操作提示；没有新更改时可跳过当前提交'
        : outcome?.error ? `拣选未完成：${outcome.error}` : `已拣选提交到 ${next.branch}`,
      error: Boolean(outcome?.error || outcome?.conflicted),
    }), async path => { outcome = await git.cherryPick(path, commit, expectedHead, expectedBranch); return outcome.snapshot; }, undefined, { kind: 'cherry-pick', label: '正在拣选提交…' });
    return updated && Boolean(outcome && (outcome.snapshot.operation === 'cherry-pick' || !outcome.error));
  };
  const checkout = (branch: string, remote = false) => run(next => ({ message: remote ? `已切换到本地 ${next.branch}（跟踪 ${branch}）` : `已切换到 ${next.branch}` }), path => git.checkout(path, branch, remote), formatCheckoutError, { kind: 'checkout', label: `正在切换到 ${branch}…` });
  const createBranch = (branch: string) => {
    const base = snapshotRef.current.branch || '当前提交';
    return run(`已从 ${base} 创建并切换到 ${branch}`, path => git.createBranch(path, branch), undefined, { kind: 'create-branch', label: `正在创建并切换到 ${branch}…` });
  };
  const manageBranch = (expectedPath: string, request: BranchRequest) => {
    if (snapshotRef.current.path !== expectedPath) return Promise.resolve(false);
    const labels = { rename: '分支已重命名', delete: '本地分支已删除', upstream: '已设置分支上游', 'unset-upstream': '已取消分支上游' };
    return run(labels[request.action.kind], path => git.manageBranch(path, request), undefined, { kind: 'branch', label: '正在更新分支设置…' });
  };
  const pull = () => {
    let conflicted = false;
    let pullError: string | null = null;
    return run(next => pullError
      ? { message: conflicted ? '拉取遇到冲突，请在工作区变更中解决冲突并提交完成合并' : formatPullError(pullError), error: true }
      : conflicted || next.operation === 'merge' || next.files.some(file => file.conflicted)
        ? { message: '拉取遇到冲突，请在工作区变更中解决冲突并提交完成合并', error: true }
        : { message: '拉取更新完成' }, async path => {
      const result = await git.pull(path);
      conflicted = result.conflicted;
      pullError = result.error;
      return result.snapshot;
    }, formatPullError, { kind: 'pull', label: '正在拉取更新…' });
  };
  const push = () => run('更改已推送到远程仓库', path => git.push(path), undefined, { kind: 'push', label: '正在推送当前分支…' });
  const configureRemote = (expectedPath: string, request: ConfigureRemoteRequest, onError?: (message: string) => void) => snapshotRef.current.path !== expectedPath || remoteRequest.current
    ? Promise.resolve(false)
    : run(request.url === null ? '远程配置已移除' : '远程地址已保存', path => git.configureRemote(path, request), error => { const message = gitErrorMessage(error); onError?.(message); return message; }, { kind: 'remote', label: '正在更新远程配置…' });
  const merge = useCallback(async (preview: MergePreview) => {
    if (busyRef.current || !snapshotRef.current.path) return false;
    const expectedPath = snapshotRef.current.path;
    if (!await confirmPendingChanges() || busyRef.current || snapshotRef.current.path !== expectedPath) return false;
    busyRef.current = true;
    setBusy(true);
    setActiveOperation({ kind: 'merge', label: `正在合并 ${preview.source} → ${preview.localTarget}…` });
    const token = ++generation.current;
    try {
      const result = await git.mergeBranches(snapshotRef.current.path, preview);
      if (token !== generation.current) return false;
      snapshotRef.current = result.snapshot;
      setSnapshot(result.snapshot);
      if (result.merged) notify(preview.targetRemote ? `已将 ${preview.source} 合并到本地 ${preview.localTarget}，请推送到 ${preview.target}` : `已将 ${preview.source} 合并到 ${preview.target}`);
      else if (result.conflicted) notify(`合并遇到冲突，请在文件更改面板中解决${result.error ? `：${result.error}` : '。'}`, true);
      else notify(result.error || '合并失败。', true);
      return result.merged || result.conflicted;
    } catch (error) {
      notify(String(error), true);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      setActiveOperation(null);
    }
  }, [notify]);
  const removeWorkspace = useCallback((workspace: RecentRepository) => {
    if (busyRef.current) return false;
    if (snapshotRef.current.path === workspace.path) {
      // Invalidate background refreshes before clearing the selected workspace.
      generation.current++;
      session.current++;
      remoteRequest.current?.complete(false);
      remoteRequest.current = null;
      setRemoteSync(null);
      const empty = emptyRepository();
      snapshotRef.current = empty;
      setSnapshot(empty);
      setActivities([]);
    }
    setRecents(current => {
      const next = current.filter(item => item.path !== workspace.path);
      remember(next);
      return next;
    });
    notify(`已从 easygit 移除 ${workspace.name}，本地项目文件已保留`);
    return true;
  }, [notify]);

  return { snapshot, recents, hasRepository, busy, activeOperation, refreshing, syncing: Boolean(remoteSync), notices, dismissNotice, activities, gitVersion, notify, open, setupRepository, configureRemote, refresh, saveFile, stage, deleteProjectEntry, unstage, discard, discardBlock, resolveConflict, commit, actOnCommit, cherryPick, checkout, createBranch, manageBranch, fetch, pull, push, merge, removeWorkspace, saveStash, actOnStash, actOnOperation };
}
