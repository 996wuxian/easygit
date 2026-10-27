// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRepository, git, type GitBranch, type GitCommit, type HistoryPage, type RepositorySnapshot } from '../../services/git';
import { branchKey, useCommitHistory } from './useCommitHistory';

const remote: GitBranch = { name: 'origin/feature', remote: true, current: false, lastCommitDate: '2026-01-01T00:00:00Z', head: 'old-tip' };
const initial: RepositorySnapshot = { ...emptyRepository(), path: 'X:/repo', branch: 'main', head: 'main-tip', branches: [remote] };
const commit = (hash: string): GitCommit => ({ hash, shortHash: hash, subject: hash, author: 'author', date: '2026-01-01', parents: [], refs: [], local: false, remote: true });
const page = (hash: string, nextOffset: number | null = null): HistoryPage => ({ commits: [commit(hash)], key: hash, nextOffset });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let snapshot: RepositorySnapshot;
let history: ReturnType<typeof useCommitHistory>;
let host: HTMLDivElement;
let root: Root;
function Harness() { history = useCommitHistory(snapshot); return null; }
async function render(next: RepositorySnapshot) {
  snapshot = next;
  await act(async () => root.render(<Harness />));
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(git, 'history').mockResolvedValue(page('old-tip', 25));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await render(initial);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('分支历史刷新', () => {
  it('非当前远程分支移动后回到第一页并重新读取，而无关快照变化不触发查询', async () => {
    await act(async () => history.setScope(branchKey(remote)));
    expect(history.commits[0].hash).toBe('old-tip');
    vi.mocked(git.history).mockResolvedValueOnce(page('old-page', 50));
    await act(async () => history.next());
    expect(history.offset).toBe(25);
    expect(vi.mocked(git.history).mock.lastCall?.[1]).toMatchObject({ offset: 25, expectedKey: 'old-tip' });
    await render({ ...initial, files: [] });
    expect(git.history).toHaveBeenCalledTimes(2);
    vi.mocked(git.history).mockResolvedValueOnce(page('new-tip'));
    await render({ ...initial, branches: [{ ...remote, head: 'new-tip' }] });
    expect(history.offset).toBe(0);
    expect(history.commits[0].hash).toBe('new-tip');
    expect(vi.mocked(git.history).mock.lastCall?.[1]).toMatchObject({ offset: 0, expectedKey: null, reference: { name: remote.name, remote: true } });
  });

  it('忽略分支更新前才完成的旧请求', async () => {
    const old = deferred<HistoryPage>();
    const latest = deferred<HistoryPage>();
    vi.mocked(git.history).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await act(async () => history.setScope(branchKey(remote)));
    await render({ ...initial, branches: [{ ...remote, head: 'new-tip' }] });
    await act(async () => { latest.resolve(page('new-tip')); await latest.promise; });
    await act(async () => { old.resolve(page('old-tip')); await old.promise; });
    expect(history.commits[0].hash).toBe('new-tip');
  });

  it('选中分支删除后显示错误且不会回退读取当前分支', async () => {
    await act(async () => history.setScope(branchKey(remote)));
    await render({ ...initial, branches: [] });
    expect(history.scope).toBe(branchKey(remote));
    expect(history.commits).toEqual([]);
    expect(history.error).toContain('所选历史分支已不存在');
    expect(git.history).toHaveBeenCalledTimes(1);
  });

  it('无首个提交的分支显示空历史而不尝试解析不存在的引用', async () => {
    const unborn: GitBranch = { name: 'main', current: true, remote: false, lastCommitDate: null, head: null };
    await render({ ...initial, head: null, branches: [unborn] });
    await act(async () => history.setScope(branchKey(unborn)));
    expect(history.commits).toEqual([]);
    expect(history.error).toBeNull();
    expect(git.history).not.toHaveBeenCalled();
  });
});
