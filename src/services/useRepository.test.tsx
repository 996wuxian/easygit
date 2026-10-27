// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRepository, git, type RepositorySnapshot } from './git';
import { useRepository } from './useRepository';
import { project, type ProjectText } from './project';
import { registerPendingChangesGuard } from './pendingChanges';

const initial = { ...emptyRepository(), name: 'Alpha', path: 'X:/Projects/Alpha', branch: 'main' };
const ready = () => {};
let repository: ReturnType<typeof useRepository>;
let host: HTMLDivElement;
let root: Root;
function Harness() { repository = useRepository(ready); return null; }
function deferred() {
  let resolve!: (value: RepositorySnapshot) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RepositorySnapshot>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.spyOn(git, 'open').mockResolvedValue(initial);
  vi.spyOn(git, 'fetch').mockResolvedValue(initial);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () => { await repository.open(initial.path); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('文件编辑与仓库操作协调', () => {
  const text: ProjectText = { content: 'saved\n', revision: 'saved-version', bom: false, lineEnding: 'lf', reason: null };

  it('取消未保存确认时不打开项目、不切换分支', async () => {
    const unregister = registerPendingChangesGuard(async () => false);
    const checkout = vi.spyOn(git, 'checkout');
    const openCount = vi.mocked(git.open).mock.calls.length;
    try {
      await act(async () => {
        expect(await repository.open('X:/Projects/Other')).toBe(false);
        expect(await repository.checkout('other')).toBe(false);
      });
      expect(git.open).toHaveBeenCalledTimes(openCount);
      expect(checkout).not.toHaveBeenCalled();
      expect(repository.snapshot.path).toBe(initial.path);
    } finally { unregister(); }
  });

  it('保存文件更新工作区，并且不再次触发未保存确认', async () => {
    const updated = { ...initial, revision: 'saved' };
    const guard = vi.fn(async () => false);
    const unregister = registerPendingChangesGuard(guard);
    vi.spyOn(project, 'saveFile').mockResolvedValue({ file: text, snapshot: updated, refreshError: null });
    try {
      await act(async () => { expect(await repository.saveFile(initial.path, 'clean.ts', 'original', 'saved\n')).toEqual(text); });
      expect(project.saveFile).toHaveBeenCalledWith(initial.path, 'clean.ts', 'original', 'saved\n');
      expect(guard).not.toHaveBeenCalled();
      expect(repository.snapshot).toBe(updated);
      expect(repository.busy).toBe(false);
    } finally { unregister(); }
  });

  it('磁盘保存成功但刷新失败时仍返回已保存版本，失败后释放操作锁', async () => {
    vi.spyOn(project, 'saveFile').mockResolvedValueOnce({ file: text, snapshot: null, refreshError: 'Git unavailable' })
      .mockRejectedValueOnce(new Error('external change'));
    await act(async () => { expect(await repository.saveFile(initial.path, 'clean.ts', 'original', 'saved\n')).toEqual(text); });
    expect(repository.notice?.message).toContain('文件已保存');
    expect(repository.snapshot).toEqual(initial);
    await act(async () => { await expect(repository.saveFile(initial.path, 'clean.ts', 'saved-version', 'next')).rejects.toThrow('external change'); });
    expect(repository.busy).toBe(false);
    await act(async () => { expect(await repository.saveFile('X:/Projects/Other', 'clean.ts', 'original', 'saved')).toBeNull(); });
    expect(project.saveFile).toHaveBeenCalledTimes(2);
  });
});

describe('仓库刷新协调', () => {
  it('未变化的静默刷新保留快照，版本变化后发布新快照', async () => {
    const first = { ...initial, revision: 'one' };
    vi.mocked(git.open).mockResolvedValue(first);
    await act(async () => { await repository.refresh(); });
    vi.mocked(git.open).mockResolvedValue({ ...first });
    await act(async () => { expect(await repository.refresh(true)).toBe(true); });
    expect(repository.snapshot).toBe(first);
    const changed = { ...first, revision: 'two' };
    vi.mocked(git.open).mockResolvedValue(changed);
    await act(async () => { await repository.refresh(true); });
    expect(repository.snapshot).toBe(changed);
  });

  it('手动刷新加入静默读取时，即使版本未变也强制重新发布快照', async () => {
    const first = { ...initial, revision: 'one' };
    vi.mocked(git.open).mockResolvedValue(first);
    await act(async () => { await repository.refresh(); });
    const pending = deferred();
    vi.mocked(git.open).mockReturnValueOnce(pending.promise);
    let background!: Promise<boolean>;
    let manual!: Promise<boolean>;
    await act(async () => {
      background = repository.refresh(true);
      manual = repository.refresh();
    });
    const reread = { ...first };
    await act(async () => { pending.resolve(reread); await Promise.all([background, manual]); });
    expect(repository.snapshot).toBe(reread);
  });

  it('空闲时逐步降低轮询频率，失焦暂停，回到窗口立即刷新', async () => {
    vi.useFakeTimers();
    const first = { ...initial, revision: 'one' };
    vi.mocked(git.open).mockResolvedValue(first);
    await act(async () => { await repository.refresh(); });
    const reads = vi.mocked(git.open).mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(git.open).toHaveBeenCalledTimes(reads + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(git.open).toHaveBeenCalledTimes(reads + 2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15999); });
    expect(git.open).toHaveBeenCalledTimes(reads + 2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(git.open).toHaveBeenCalledTimes(reads + 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(git.open).toHaveBeenCalledTimes(reads + 4);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(git.open).toHaveBeenCalledTimes(reads + 4);
    const changed = { ...first, revision: 'two' };
    vi.mocked(git.open).mockResolvedValue(changed);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(repository.snapshot).toBe(changed);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(git.open).toHaveBeenCalledTimes(reads + 6);
  });

  it('隐藏窗口时取消轮询，恢复可见时刷新并且慢读取不会重叠', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    const reads = vi.mocked(git.open).mock.calls.length;
    await act(async () => {
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(git.open).toHaveBeenCalledTimes(reads);
    const pending = deferred();
    vi.mocked(git.open).mockReturnValueOnce(pending.promise);
    await act(async () => {
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(git.open).toHaveBeenCalledTimes(reads + 1);
    await act(async () => { pending.resolve(initial); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(git.open).toHaveBeenCalledTimes(reads + 2);
  });

  it('后台刷新、窗口焦点和手动刷新共享未完成的读取，只更新一次状态', async () => {
    const pending = deferred();
    vi.mocked(git.open).mockReturnValueOnce(pending.promise);
    let background!: Promise<boolean>;
    let manual!: Promise<boolean>;
    await act(async () => {
      background = repository.refresh(true);
      window.dispatchEvent(new Event('focus'));
      manual = repository.refresh();
      void repository.refresh();
    });
    expect(git.open).toHaveBeenCalledTimes(2);
    const next = { ...initial, head: 'new' };
    await act(async () => { pending.resolve(next); await Promise.all([background, manual]); });
    expect(repository.snapshot).toBe(next);
    expect(repository.activities.filter(item => item.label === '仓库状态已刷新')).toHaveLength(1);
  });

  it('写操作使旧刷新失效，旧请求结束也不会清除正在进行的新刷新', async () => {
    const obsolete = deferred();
    const current = deferred();
    vi.mocked(git.open).mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(current.promise);
    let oldRefresh!: Promise<boolean>;
    await act(async () => { oldRefresh = repository.refresh(true); });
    const written = { ...initial, head: 'written' };
    vi.spyOn(git, 'stage').mockResolvedValue(written);
    await act(async () => { await repository.stage(['file.ts']); });
    let newRefresh!: Promise<boolean>;
    await act(async () => { newRefresh = repository.refresh(true); });
    await act(async () => { obsolete.resolve(initial); await oldRefresh; });
    expect(repository.snapshot).toBe(written);
    let joined!: Promise<boolean>;
    await act(async () => { joined = repository.refresh(); });
    expect(git.open).toHaveBeenCalledTimes(3);
    const latest = { ...written, head: 'latest' };
    await act(async () => { current.resolve(latest); await Promise.all([newRefresh, joined]); });
    expect(repository.snapshot).toBe(latest);
  });

  it('刷新失败保留当前仓库，解除请求后允许重试', async () => {
    vi.mocked(git.open).mockRejectedValueOnce(new Error('读取失败'));
    await act(async () => { await repository.refresh(); });
    expect(repository.snapshot).toBe(initial);
    expect(repository.notice?.message).toContain('读取失败');
    const next = { ...initial, head: 'recovered' };
    vi.mocked(git.open).mockResolvedValueOnce(next);
    await act(async () => { await repository.refresh(); });
    expect(repository.snapshot).toBe(next);
  });
});

const remote = { ...initial, remote: 'https://example.invalid/alpha.git', head: 'local', hasUpstream: true };
const updated = { ...remote, behind: 2, upstream: { name: 'origin/main', hash: 'remote-tip' }, branches: [{ name: 'origin/feature', current: false, remote: true, lastCommitDate: null, head: 'remote-tip' }] };
async function openRemote(network: ReturnType<typeof deferred>) {
  vi.mocked(git.fetch).mockReturnValueOnce(network.promise);
  vi.mocked(git.open).mockResolvedValue(remote);
  await act(async () => { await repository.open(remote.path); });
}

describe('打开项目后获取远程更新', () => {
  it('无远程配置时只展示本地仓库', () => {
    expect(git.fetch).not.toHaveBeenCalled();
    expect(repository.syncing).toBe(false);
  });

  it('先展示本地内容，后台获取后刷新远程分支和落后数量，手动请求复用本次同步', async () => {
    const network = deferred();
    await openRemote(network);
    expect(repository.snapshot).toBe(remote);
    expect(repository.busy).toBe(false);
    expect(repository.syncing).toBe(true);
    expect(git.fetch).toHaveBeenCalledWith(remote.path);
    let joined!: Promise<boolean>;
    await act(async () => { joined = repository.fetch(); });
    expect(git.fetch).toHaveBeenCalledTimes(1);
    vi.mocked(git.open).mockResolvedValue(updated);
    await act(async () => { network.resolve(remote); });
    expect(await joined).toBe(true);
    expect(repository.snapshot).toBe(updated);
    expect(repository.syncing).toBe(false);
    expect(repository.notice?.message).toBe('远程分支和提交记录已更新');
  });

  it('同步结束时使旧的本地刷新失效，避免重新显示过期的远程状态', async () => {
    const network = deferred();
    const stale = deferred();
    await openRemote(network);
    vi.mocked(git.open).mockReturnValueOnce(stale.promise).mockResolvedValue(updated);
    let oldRefresh!: Promise<boolean>;
    await act(async () => { oldRefresh = repository.refresh(true); });
    await act(async () => { network.resolve(remote); });
    expect(repository.snapshot).toBe(updated);
    await act(async () => { stale.resolve(remote); await oldRefresh; });
    expect(repository.snapshot).toBe(updated);
  });

  it('同步期间的写操作完成后才重新读取，保留最新暂存结果', async () => {
    const network = deferred();
    const write = deferred();
    await openRemote(network);
    vi.spyOn(git, 'stage').mockReturnValueOnce(write.promise);
    let writing!: Promise<boolean>;
    await act(async () => { writing = repository.stage(['README.md']); });
    const reads = vi.mocked(git.open).mock.calls.length;
    await act(async () => { network.resolve(remote); });
    expect(repository.busy).toBe(true);
    expect(git.open).toHaveBeenCalledTimes(reads);
    const staged = { ...updated, head: 'written', files: [{ path: 'README.md', oldPath: null, indexStatus: 'M', worktreeStatus: ' ', staged: true, unstaged: false, untracked: false, conflicted: false }] };
    vi.mocked(git.open).mockResolvedValue(staged);
    await act(async () => { write.resolve({ ...staged, behind: 0 }); await writing; });
    expect(repository.snapshot).toBe(staged);
    expect(repository.syncing).toBe(false);
  });

  it('远程状态读取期间发生写操作时重读最新状态', async () => {
    const network = deferred();
    const stale = deferred();
    await openRemote(network);
    vi.mocked(git.open).mockReturnValueOnce(stale.promise);
    await act(async () => { network.resolve(remote); });
    const written = { ...updated, head: 'new-local-commit' };
    vi.spyOn(git, 'commit').mockResolvedValueOnce(written);
    await act(async () => { await repository.commit('new local commit'); });
    vi.mocked(git.open).mockResolvedValue(written);
    await act(async () => { stale.resolve(updated); });
    expect(repository.snapshot).toBe(written);
    expect(repository.syncing).toBe(false);
  });

  it('切换项目不等待网络，旧项目的成功或失败均不覆盖当前项目', async () => {
    const alpha = deferred();
    const beta = deferred();
    await openRemote(alpha);
    const other = { ...remote, name: 'Beta', path: 'X:/Projects/Beta' };
    vi.mocked(git.open).mockResolvedValue(other);
    vi.mocked(git.fetch).mockReturnValueOnce(beta.promise);
    await act(async () => { expect(await repository.open(other.path)).toBe(true); });
    expect(repository.snapshot).toBe(other);
    expect(repository.syncing).toBe(true);
    await act(async () => { alpha.reject(new Error('Alpha disconnected')); });
    expect(repository.notice?.message).toBe('已打开 Beta');
    expect(repository.syncing).toBe(true);
    const latest = { ...other, behind: 3 };
    vi.mocked(git.open).mockResolvedValue(latest);
    await act(async () => { beta.resolve(other); });
    expect(repository.snapshot).toBe(latest);
    expect(repository.syncing).toBe(false);
  });

  it('切走又切回同一路径时仍隔离旧会话的结果', async () => {
    const old = deferred();
    await openRemote(old);
    const other = { ...initial, path: 'X:/Projects/Beta', name: 'Beta' };
    vi.mocked(git.open).mockResolvedValueOnce(other);
    await act(async () => { await repository.open(other.path); });
    const current = deferred();
    await openRemote(current);
    await act(async () => { old.resolve({ ...updated, behind: 10 }); });
    expect(repository.snapshot).toBe(remote);
    expect(repository.syncing).toBe(true);
    vi.mocked(git.open).mockResolvedValue(updated);
    await act(async () => { current.resolve(remote); });
    expect(repository.snapshot).toBe(updated);
  });

  it('网络失败保留本地内容，并允许手动重试', async () => {
    const network = deferred();
    await openRemote(network);
    await act(async () => { network.reject(new Error('offline')); });
    expect(repository.snapshot).toBe(remote);
    expect(repository.busy).toBe(false);
    expect(repository.syncing).toBe(false);
    expect(repository.notice).toEqual({ message: '获取远程更新失败：无法连接远程 Git 服务器。请检查网络、VPN 或代理设置，并确认服务器可以访问。', error: true });
    expect(repository.activities[0].details).toBe('offline');
    vi.mocked(git.open).mockResolvedValue(updated);
    await act(async () => { void repository.fetch(); });
    expect(git.fetch).toHaveBeenCalledTimes(2);
    expect(repository.snapshot).toBe(updated);
    expect(repository.syncing).toBe(false);
  });

  it('移除当前项目后不会被后台同步重新打开', async () => {
    const network = deferred();
    await openRemote(network);
    await act(async () => { expect(repository.removeWorkspace(remote)).toBe(true); });
    await act(async () => { network.resolve(updated); });
    expect(repository.hasRepository).toBe(false);
    expect(repository.syncing).toBe(false);
    expect(repository.snapshot.path).toBe('');
  });
});
