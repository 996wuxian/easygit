// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { git, emptyRepository, type GitCommit, type RepositorySnapshot } from './services/git';
import { CommitDetailsDialog } from './components/commits/CommitDetailsDialog';
import { BranchCompareDialog } from './components/branches/BranchCompareDialog';
import { CommitsPanel } from './components/commits/CommitsPanel';
import { OperationBanner } from './components/OperationBanner';
import { StashPanel } from './components/stash/StashPanel';

const hash = 'a'.repeat(40);
const commit: GitCommit = { hash, shortHash: 'aaaaaaa', subject: '更新需求', author: 'Developer', date: '2026-10-22T00:00:00Z', parents: ['b'.repeat(40)], refs: [], local: true, remote: true };
const snapshot: RepositorySnapshot = {
  ...emptyRepository(), path: 'X:/QA/project', name: 'QA', branch: 'main', head: hash, revision: 'version-1',
  branches: [{ name: 'main', current: true, remote: false, lastCommitDate: null }, { name: 'origin/dev', current: false, remote: true, lastCommitDate: null }],
  commits: Array.from({ length: 10 }, (_, index) => ({ ...commit, hash: index.toString(16).padStart(40, '0'), subject: `提交 ${index}` })),
};
const stash = { hash, selector: 'stash@{0}', message: '保存需求', date: commit.date };
const patch = (content: string) => `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+${content}\n`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(node: ReactNode) { await act(async () => root.render(node)); }
function button(label: string) {
  const node = Array.from(document.querySelectorAll('button')).find(node => node.textContent === label || node.getAttribute('aria-label') === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  await act(async () => element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })));
}

describe('Git 工作流界面', () => {
  it('切换提交文件后忽略先前文件的迟到差异，预览始终只读', async () => {
    vi.spyOn(git, 'commitFiles').mockResolvedValue(['first.ts', 'second.ts']);
    const old = deferred<string>();
    vi.spyOn(git, 'commitDiff').mockImplementation(async (_path, _hash, file) => file === 'first.ts' ? old.promise : patch('second-content'));
    await render(<CommitDetailsDialog path={snapshot.path} commit={commit} status="已同步" notify={vi.fn()} onClose={vi.fn()} />);
    await click('second.ts');
    expect(host.textContent).toContain('second-content');
    await act(async () => old.resolve(patch('outdated-first-content')));
    expect(host.textContent).not.toContain('outdated-first-content');
    expect(document.querySelector('[aria-label^="撤回变更块"]')).toBeNull();
  });

  it('分支对比传递远程标记，选择变化后忽略旧请求', async () => {
    const pending = deferred<Awaited<ReturnType<typeof git.compareBranches>>>();
    const compare = vi.spyOn(git, 'compareBranches').mockReturnValue(pending.promise);
    const diff = vi.spyOn(git, 'comparisonDiff').mockResolvedValue(patch('compared'));
    const checkout = vi.spyOn(git, 'checkout');
    await render(<BranchCompareDialog path={snapshot.path} branches={snapshot.branches} onClose={vi.fn()} />);
    await click('比较');
    expect(compare).toHaveBeenCalledWith(snapshot.path, snapshot.branches[0], snapshot.branches[1]);
    await click('对比分支');
    await act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === '本地 · main')!.click());
    await act(async () => pending.resolve({ base: hash, target: 'b'.repeat(40), files: [{ path: 'old.ts', oldPath: null, status: 'M' }] }));
    expect(host.textContent).not.toContain('old.ts');
    expect(diff).not.toHaveBeenCalled(); expect(checkout).not.toHaveBeenCalled();
    expect(button('比较').disabled).toBe(true);
  });

  it('分支选择菜单标出选中项，Escape 只关闭菜单，键盘选择仍保留远程标记', async () => {
    const onClose = vi.fn();
    const compare = vi.spyOn(git, 'compareBranches').mockResolvedValue({ base: hash, target: 'b'.repeat(40), files: [] });
    await render(<BranchCompareDialog path={snapshot.path} branches={snapshot.branches} onClose={onClose} />);
    await click('基准分支');
    const list = document.querySelector('[role="listbox"][aria-label="选择基准分支"]')!;
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toBe('本地 · main');
    await act(async () => button('基准分支').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await click('基准分支');
    await act(async () => button('基准分支').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
    await act(async () => button('基准分支').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(button('基准分支').textContent).toBe('远程 · origin/dev');
    expect(button('比较').disabled).toBe(true);
    await click('对比分支');
    await act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === '本地 · main')!.click());
    await click('比较');
    expect(compare).toHaveBeenCalledWith(snapshot.path, snapshot.branches[1], snapshot.branches[0]);
    expect(host.textContent).toContain('两个分支没有文件差异');
    await click('基准分支');
    await act(async () => document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')!.click());
    expect(host.textContent).toContain('两个分支没有文件差异');
  });

  it('stash 保存默认包含新文件，删除必须先确认', async () => {
    vi.spyOn(git, 'stashes').mockResolvedValue([stash]);
    vi.spyOn(git, 'stashDiff').mockResolvedValue(patch('saved-content') + patch('another-file').replaceAll('file.ts', 'second.ts'));
    const onSave = vi.fn().mockResolvedValue(true); const onAction = vi.fn().mockResolvedValue(true);
    const dirty = { ...snapshot, stashCount: 1, files: [{ path: 'new.ts', oldPath: null, indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, untracked: true, conflicted: false }] };
    await render(<StashPanel snapshot={dirty} busy={false} onSave={onSave} onAction={onAction} />);
    await click('保存更改');
    await change(host.querySelector<HTMLInputElement>('[aria-label="stash 说明"]')!, '未完成需求');
    await click('保存到 stash'); expect(onSave).toHaveBeenCalledWith('未完成需求', true);
    await act(async () => host.querySelector<HTMLButtonElement>('.stash-entry')!.click());
    expect(host.textContent).toContain('saved-content');
    expect(host.querySelectorAll('.patch-file-heading')).toHaveLength(2);
    expect(host.querySelectorAll('.patch-file-heading')[1].textContent).toContain('second.ts');
    await click('删除记录…'); expect(onAction).not.toHaveBeenCalled();
    await click('返回'); expect(onAction).not.toHaveBeenCalled();
    await click('删除记录…'); await click('确认删除 stash');
    expect(onAction).toHaveBeenCalledWith(stash, 'drop');
  });

  it('stash 发生冲突时保留预览与记录，阻止重复恢复', async () => {
    vi.spyOn(git, 'stashes').mockResolvedValue([stash]);
    vi.spyOn(git, 'stashDiff').mockResolvedValue(patch('saved-content'));
    const onAction = vi.fn().mockResolvedValue(false);
    const props = { snapshot: { ...snapshot, stashCount: 1 }, busy: false, onSave: vi.fn(), onAction };
    await render(<StashPanel {...props} />);
    await act(async () => host.querySelector<HTMLButtonElement>('.stash-entry')!.click());
    await click('恢复并删除记录'); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await render(<StashPanel {...props} snapshot={{ ...props.snapshot, files: [{ path: 'file.ts', oldPath: null, indexStatus: 'U', worktreeStatus: 'U', staged: false, unstaged: true, untracked: false, conflicted: true }] }} />);
    expect(button('恢复并删除记录').disabled).toBe(true); expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('未解决冲突不能继续，确认后仓库变化会阻止取消操作', async () => {
    const onAction = vi.fn().mockResolvedValue(true);
    const active = { ...snapshot, operation: 'merge', operationToken: 'merge-token', files: [{ path: 'file.ts', oldPath: null, indexStatus: 'U', worktreeStatus: 'U', staged: false, unstaged: true, untracked: false, conflicted: true }] };
    await render(<OperationBanner snapshot={active} busy={false} onAction={onAction} />);
    expect(button('完成合并').disabled).toBe(true);
    await click('取消合并'); expect(onAction).not.toHaveBeenCalled();
    await render(<OperationBanner snapshot={{ ...active, revision: 'version-2' }} busy={false} onAction={onAction} />);
    expect(button('确认取消操作').disabled).toBe(true); expect(host.textContent).toContain('仓库状态已变化');
    await click('返回');
    await render(<OperationBanner snapshot={{ ...active, files: [] }} busy={false} onAction={onAction} />);
    await click('完成合并');
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ operation: 'merge', token: 'merge-token', revision: 'version-1', head: hash, branch: 'main', action: 'continue' }));
  });

  it('历史按需分页，搜索重置分页且忽略上一页迟到响应', async () => {
    vi.useFakeTimers();
    const oldPage = deferred<Awaited<ReturnType<typeof git.history>>>();
    const history = vi.spyOn(git, 'history').mockImplementation(async (_path, query) => query.query ? { commits: [{ ...commit, subject: '搜索结果' }], nextOffset: null, key: 'search-key' } : query.offset ? oldPage.promise : { commits: [{ ...commit, subject: '第一页' }], nextOffset: 25, key: 'page-key' });
    await render(<CommitsPanel snapshot={snapshot} busy={false} onAction={vi.fn()} onSelect={vi.fn()} notify={vi.fn()} />);
    expect(history).not.toHaveBeenCalled();
    await click('更多历史'); await click('下一页提交');
    expect(history).toHaveBeenLastCalledWith(snapshot.path, expect.objectContaining({ offset: 25, expectedKey: 'page-key' }));
    expect(host.textContent).not.toContain('第一页');
    await change(host.querySelector<HTMLInputElement>('[aria-label="搜索提交信息"]')!, '需求');
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(history).toHaveBeenLastCalledWith(snapshot.path, { reference: null, query: '需求', offset: 0, expectedKey: null });
    await act(async () => oldPage.resolve({ commits: [{ ...commit, subject: '过期第二页' }], nextOffset: null, key: 'page-key' }));
    expect(host.textContent).toContain('搜索结果'); expect(host.textContent).not.toContain('过期第二页');
    expect(button('上一页提交').disabled).toBe(true);
  });
});
