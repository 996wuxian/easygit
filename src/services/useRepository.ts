import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyRepository, git, isDesktop, type CommitAction, type ConflictResolution, type DiffBlock, type MergePreview, type RepositorySnapshot } from './git';
import { appStorage } from './storage';

export interface RecentRepository { name: string; path: string }
export interface Activity { id: string; label: string; time: string; error?: boolean }
interface RemoteRequest { path: string; session: number; reading: boolean; promise: Promise<boolean>; complete: (updated: boolean) => void }
interface RefreshRequest { path: string; token: number; promise: Promise<boolean>; notified: boolean; force: boolean }
const RECENTS_KEY = 'esaygit.recent.v1';
function loadRecents(): RecentRepository[] {
  try {
    const data: unknown = JSON.parse(appStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter((v): v is RecentRepository => v && typeof v.name === 'string' && typeof v.path === 'string' && !v.path.startsWith('demo:')).slice(0, 8) : [];
  } catch { return []; }
}
function remember(recents: RecentRepository[]) {
  try { appStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch { /* storage can be unavailable */ }
}

export function useRepository(onReady: () => void) {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot>(emptyRepository);
  const [recents, setRecents] = useState(loadRecents);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
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

  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    setActivities(items => [{ id: crypto.randomUUID(), label: message, error, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }, ...items].slice(0, 40));
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
        notify(`获取远程更新失败：${String(error)}`, true);
      }
      request.complete(false);
    });
    return promise;
  }, [notify]);

  const open = useCallback(async (path: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    const token = ++generation.current;
    try {
      const next = await git.open(path.trim());
      if (token !== generation.current) return false;
      session.current++;
      remoteRequest.current?.complete(false);
      remoteRequest.current = null;
      setRemoteSync(null);
      snapshotRef.current = next;
      setSnapshot(next);
      setRecents(current => {
        const updated = [{ name: next.name, path: next.path }, ...current.filter(item => item.path !== next.path)].slice(0, 8);
        remember(updated);
        return updated;
      });
      notify(`已打开 ${next.name}`);
      void fetch();
      return true;
    } catch (error) { notify(String(error), true); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [fetch, notify]);

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

  const run = useCallback(async (label: string | ((snapshot: RepositorySnapshot) => { message: string; error?: boolean }), operation: (path: string) => Promise<RepositorySnapshot>) => {
    if (busyRef.current || !snapshotRef.current.path) return false;
    busyRef.current = true;
    setBusy(true);
    const current = snapshotRef.current;
    const token = ++generation.current;
    try {
      const next = await operation(current.path);
      if (token !== generation.current) return false;
      snapshotRef.current = next;
      setSnapshot(next);
      const result = typeof label === 'string' ? { message: label } : label(next);
      notify(result.message, result.error ?? false);
      return true;
    } catch (error) { notify(String(error), true); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [notify]);

  const stage = (paths: string[]) => run('已暂存更改', path => git.stage(path, paths));
  const unstage = (paths: string[]) => run('已取消暂存', path => git.unstage(path, paths));
  const discard = (paths: string[]) => run(paths.length === 1 ? '已撤回更改' : '已撤回全部未暂存更改', path => git.discard(path, paths));
  const discardBlock = (file: string, block: DiffBlock) => run('已撤回所选变更块，其他更改已保留', path => git.discardBlock(path, file, block));
  const resolveConflict = (file: string, revision: string, resolution: ConflictResolution, content?: string) => run('冲突已解决并暂存', path => git.resolveConflict(path, file, revision, resolution, content));
  const commit = (message: string) => run('提交已创建', path => git.commit(path, message.trim()));
  const actOnCommit = (commit: string, expectedHead: string, expectedBranch: string, action: CommitAction) => run(action === 'soft' ? '已撤回提交，更改保留在暂存区' : action === 'mixed' ? '已撤回提交，更改保留在工作区' : '已创建反向提交', path => git.actOnCommit(path, commit, expectedHead, expectedBranch, action));
  const checkout = (branch: string, remote = false) => run(next => ({ message: remote ? `已切换到本地 ${next.branch}（跟踪 ${branch}）` : `已切换到 ${next.branch}` }), path => git.checkout(path, branch, remote));
  const createBranch = (branch: string) => {
    const base = snapshotRef.current.branch || '当前提交';
    return run(`已从 ${base} 创建并切换到 ${branch}`, path => git.createBranch(path, branch));
  };
  const pull = () => {
    let conflicted = false;
    let pullError: string | null = null;
    return run(next => pullError
      ? { message: conflicted ? '拉取遇到冲突，请在工作区变更中解决冲突并提交完成合并' : `拉取失败：${pullError}`, error: true }
      : conflicted || next.operation === 'merge' || next.files.some(file => file.conflicted)
        ? { message: '拉取遇到冲突，请在工作区变更中解决冲突并提交完成合并', error: true }
        : { message: '拉取更新完成' }, async path => {
      const result = await git.pull(path);
      conflicted = result.conflicted;
      pullError = result.error;
      return result.snapshot;
    });
  };
  const push = () => run('更改已推送到远程仓库', path => git.push(path));
  const merge = useCallback(async (preview: MergePreview) => {
    if (busyRef.current || !snapshotRef.current.path) return false;
    busyRef.current = true;
    setBusy(true);
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

  return { snapshot, recents, hasRepository, busy, syncing: Boolean(remoteSync), notice, setNotice, activities, gitVersion, notify, open, refresh, stage, unstage, discard, discardBlock, resolveConflict, commit, actOnCommit, checkout, createBranch, fetch, pull, push, merge, removeWorkspace };
}
