// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { git, emptyRepository, type GitCommit, type RepositorySnapshot } from './services/git';
import { project } from './services/project';

vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));
const ready = () => {};
const workspace = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const head = 'a'.repeat(40);
const source: GitCommit = { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: '修复登录错误', author: 'Developer', date: '2026-10-23T00:00:00Z', parents: ['c'.repeat(40)], refs: [{ name: 'origin/source', remote: true }], local: false, remote: true };
let snapshot: RepositorySnapshot;
let host: HTMLDivElement;
let root: Root;
function button(label: string) {
  const node = Array.from(document.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function menu() {
  const row = Array.from(host.querySelectorAll<HTMLButtonElement>('.history-row')).find(row => row.querySelector('strong')?.textContent === source.subject)!;
  await act(async () => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 100 })));
}
async function openWorkspace() { await act(async () => root.render(<App onReady={ready} />)); await click('打开仓库 Alpha'); }
async function showSourceHistory() {
  await click('历史分支');
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent?.includes('远程 · origin/source'))!;
  await act(async () => option.click());
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  snapshot = { ...emptyRepository(), ...workspace, branch: 'main', head, revision: 'before', commits: [{ ...source, hash: head, shortHash: 'aaaaaaa', subject: '当前分支提交', local: true, remote: false }], branches: [{ name: 'main', current: true, remote: false, lastCommitDate: source.date, head }, { name: 'origin/source', current: false, remote: true, lastCommitDate: source.date, head: source.hash }] };
  vi.spyOn(git, 'open').mockImplementation(async () => snapshot);
  vi.spyOn(git, 'stashes').mockResolvedValue([]);
  vi.spyOn(project, 'scripts').mockResolvedValue({ packageFound: false, manager: 'npm', scripts: [] });
  vi.spyOn(git, 'history').mockResolvedValue({ commits: [source], key: 'source-history', nextOffset: null });
  vi.spyOn(git, 'cherryPick').mockImplementation(async () => ({ snapshot: { ...snapshot, head: 'd'.repeat(40) }, conflicted: false, error: null }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('拣选提交工作流', () => {
  it('从远程分支历史选择提交，确认来源和目标后才执行拣选', async () => {
    await openWorkspace(); await showSourceHistory(); await menu(); await click('拣选到当前分支…');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('修复登录错误');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('main');
    expect(git.cherryPick).not.toHaveBeenCalled(); await click('取消'); expect(git.cherryPick).not.toHaveBeenCalled();
    await menu(); await click('拣选到当前分支…'); await click('确认拣选提交');
    expect(git.cherryPick).toHaveBeenCalledWith(workspace.path, source.hash, head, 'main');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.querySelector('[aria-label="通知提示"]')?.textContent).toContain('已拣选提交到 main');
  });
  it('工作区有修改时禁用拣选，说明原因', async () => {
    snapshot.files = [{ path: 'new.txt', oldPath: null, indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, untracked: true, conflicted: false }];
    await openWorkspace(); await showSourceHistory(); await menu();
    expect(button('拣选到当前分支…').disabled).toBe(true);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('干净的工作区'); expect(git.cherryPick).not.toHaveBeenCalled();
  });
  it('拣选冲突关闭确认弹窗，展示冲突状态并可确认取消', async () => {
    vi.mocked(git.cherryPick).mockImplementation(async () => ({ snapshot: { ...snapshot, revision: 'conflict', operation: 'cherry-pick', operationToken: 'pick-token', files: [{ path: 'file.txt', oldPath: null, indexStatus: 'U', worktreeStatus: 'U', staged: false, unstaged: true, untracked: false, conflicted: true }] }, conflicted: true, error: '冲突' }));
    vi.spyOn(git, 'actOnOperation').mockImplementation(async () => ({ snapshot, conflicted: false, error: null }));
    await openWorkspace(); await showSourceHistory(); await menu(); await click('拣选到当前分支…'); await click('确认拣选提交');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).toContain('正在进行 cherry-pick');
    expect(button('继续操作').disabled).toBe(true);
    await click('取消操作'); expect(git.actOnOperation).not.toHaveBeenCalled(); await click('确认取消操作');
    expect(git.actOnOperation).toHaveBeenCalledWith(workspace.path, expect.objectContaining({ operation: 'cherry-pick', token: 'pick-token', action: 'abort', head, branch: 'main' }));
    expect(host.textContent).not.toContain('正在进行 cherry-pick');
  });
  it('空拣选提示跳过，避免继续重复报错', async () => {
    vi.mocked(git.cherryPick).mockImplementation(async () => ({ snapshot: { ...snapshot, revision: 'empty-pick', operation: 'cherry-pick', operationToken: 'pick-token' }, conflicted: false, error: 'empty' }));
    vi.spyOn(git, 'actOnOperation').mockImplementation(async () => ({ snapshot, conflicted: false, error: null }));
    await openWorkspace(); await showSourceHistory(); await menu(); await click('拣选到当前分支…'); await click('确认拣选提交');
    expect(host.textContent).toContain('没有产生可提交的更改'); expect(button('继续操作').disabled).toBe(true);
    await click('跳过当前提交'); await click('确认跳过提交');
    expect(git.actOnOperation).toHaveBeenCalledWith(workspace.path, expect.objectContaining({ action: 'skip' }));
  });
});
