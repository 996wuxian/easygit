import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyRepository, git, isDesktop, type RepositorySnapshot } from './git';

export interface RecentRepository { name: string; path: string }
export interface Activity { id: string; label: string; time: string; error?: boolean }
const RECENTS_KEY = 'esaygit.recent.v1';
function loadRecents(): RecentRepository[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter((v): v is RecentRepository => v && typeof v.name === 'string' && typeof v.path === 'string' && !v.path.startsWith('demo:')).slice(0, 8) : [];
  } catch { return []; }
}
function remember(recents: RecentRepository[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch { /* storage can be unavailable */ }
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
  const hasRepository = Boolean(snapshot.path);
  snapshotRef.current = snapshot;

  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    setActivities(items => [{ id: crypto.randomUUID(), label: message, error, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }, ...items].slice(0, 40));
  }, []);

  const open = useCallback(async (path: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    const token = ++generation.current;
    try {
      const next = await git.open(path.trim());
      if (token !== generation.current) return false;
      snapshotRef.current = next;
      setSnapshot(next);
      setRecents(current => {
        const updated = [{ name: next.name, path: next.path }, ...current.filter(item => item.path !== next.path)].slice(0, 8);
        remember(updated);
        return updated;
      });
      notify(`已打开 ${next.name}`);
      return true;
    } catch (error) { notify(String(error), true); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [notify]);

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

  const refresh = useCallback(async (quiet = false) => {
    if (!snapshotRef.current.path || busyRef.current) return;
    const token = generation.current;
    try {
      const next = await git.open(snapshotRef.current.path);
      if (token !== generation.current || busyRef.current) return;
      snapshotRef.current = next;
      setSnapshot(next);
      if (!quiet) notify('仓库状态已刷新');
    } catch (error) { if (!quiet && token === generation.current) notify(String(error), true); }
  }, [notify]);

  useEffect(() => {
    if (!hasRepository) return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(true); }, 8000);
    const focus = () => { void refresh(true); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(id); window.removeEventListener('focus', focus); };
  }, [hasRepository, refresh]);

  const run = useCallback(async (label: string, operation: (path: string) => Promise<RepositorySnapshot>) => {
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
      notify(label);
      return true;
    } catch (error) { notify(String(error), true); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [notify]);

  const stage = (paths: string[]) => run('已暂存更改', path => git.stage(path, paths));
  const unstage = (paths: string[]) => run('已取消暂存', path => git.unstage(path, paths));
  const discard = (paths: string[]) => run(paths.length === 1 ? '已撤回更改' : '已撤回全部未暂存更改', path => git.discard(path, paths));
  const commit = (message: string) => run('提交已创建', path => git.commit(path, message.trim()));
  const checkout = (branch: string) => run(`已切换到 ${branch}`, path => git.checkout(path, branch));
  const fetch = () => run('远程引用已更新', path => git.fetch(path));
  const push = () => run('更改已推送到远程仓库', path => git.push(path));
  const removeWorkspace = useCallback((workspace: RecentRepository) => {
    if (busyRef.current) return false;
    if (snapshotRef.current.path === workspace.path) {
      // Invalidate background refreshes before clearing the selected workspace.
      generation.current++;
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

  return { snapshot, recents, hasRepository, busy, notice, setNotice, activities, gitVersion, notify, open, refresh, stage, unstage, discard, commit, checkout, fetch, push, removeWorkspace };
}
