// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRepository, git, type RepositorySnapshot } from './git';
import { useRepository } from './useRepository';

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
});

describe('仓库刷新协调', () => {
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
const updated = { ...remote, behind: 2, upstream: { name: 'origin/main', hash: 'remote-tip' }, branches: [{ name: 'origin/feature', current: false, remote: true, lastCommitDate: null }] };
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
    expect(repository.notice).toEqual({ message: '获取远程更新失败：Error: offline', error: true });
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
