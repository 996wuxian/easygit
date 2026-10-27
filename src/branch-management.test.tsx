// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git, type RepositorySnapshot } from './services/git';
import { project } from './services/project';

vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));
const ready = () => {};
const hash = 'a'.repeat(40);
const workspace = { name: 'Alpha', path: 'X:/Projects/Alpha' };
function initial(): RepositorySnapshot {
  const date = new Date().toISOString();
  return { ...emptyRepository(), ...workspace, branch: 'main', head: hash,
    branches: [
      { name: 'main', current: true, remote: false, lastCommitDate: date, head: 'main' },
      { name: 'topic', current: false, remote: false, lastCommitDate: date, head: 'topic' },
      { name: 'origin/main', current: false, remote: true, lastCommitDate: date, head: 'remote' },
    ] };
}
let host: HTMLDivElement;
let root: Root;
let snapshot: RepositorySnapshot;
function button(label: string) {
  const node = Array.from(document.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function openMenu(label: string, keyboard = false) {
  await act(async () => button(label).dispatchEvent(keyboard
    ? new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })
    : new MouseEvent('contextmenu', { clientX: 150, clientY: 200, bubbles: true, cancelable: true })));
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  await act(async () => element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear(); localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  snapshot = initial();
  vi.spyOn(git, 'open').mockResolvedValue(snapshot);
  vi.spyOn(git, 'stashes').mockResolvedValue([]);
  vi.spyOn(project, 'scripts').mockResolvedValue({ packageFound: false, manager: 'npm', scripts: [] });
  vi.spyOn(git, 'branchInfo').mockResolvedValue({ head: hash, upstream: null });
  vi.spyOn(git, 'manageBranch').mockResolvedValue(snapshot);
  vi.spyOn(git, 'checkout').mockResolvedValue(snapshot);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App onReady={ready} />));
  await click('打开仓库 Alpha');
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('分支管理工作流', () => {
  it('键盘打开菜单、重命名确认后更新分支列表，右键不会切换分支', async () => {
    vi.mocked(git.manageBranch).mockResolvedValue({ ...snapshot, branches: snapshot.branches.map(branch => branch.name === 'topic' ? { ...branch, name: 'feature/new' } : branch) });
    await openMenu('切换到 topic', true);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(git.checkout).not.toHaveBeenCalled();
    await click('重命名分支…');
    await change(document.querySelector<HTMLInputElement>('[aria-label="新分支名称"]')!, 'feature/new');
    expect(git.manageBranch).not.toHaveBeenCalled();
    await click('确认重命名分支');
    expect(git.manageBranch).toHaveBeenCalledWith(workspace.path, { branch: 'topic', expectedHead: hash, expectedUpstream: null, expectedBranch: 'main', expectedCurrentHead: hash, action: { kind: 'rename', name: 'feature/new' } });
    expect(button('切换到 feature/new')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('当前分支不能删除，删除其他分支必须确认，取消不修改仓库', async () => {
    await openMenu('当前分支：main'); expect(button('删除本地分支…').disabled).toBe(true);
    await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await openMenu('切换到 topic'); await click('删除本地分支…'); await click('取消');
    expect(git.manageBranch).not.toHaveBeenCalled();
    await openMenu('切换到 topic'); await click('删除本地分支…');
    vi.mocked(git.manageBranch).mockResolvedValue({ ...snapshot, branches: snapshot.branches.filter(branch => branch.name !== 'topic') });
    await click('确认删除本地分支');
    expect(git.manageBranch).toHaveBeenCalledWith(workspace.path, expect.objectContaining({ branch: 'topic', action: { kind: 'delete' } }));
    expect(document.querySelector('[aria-label="切换到 topic"]')).toBeNull();
  });

  it('远程菜单设置当前本地分支上游，不提供远程删除或重命名', async () => {
    await openMenu('切换到远程分支 origin/main');
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('删除本地分支');
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('重命名分支');
    await click('设为当前分支的上游…');
    expect(document.querySelector<HTMLSelectElement>('[aria-label="远程上游分支"]')!.value).toBe('origin/main');
    await click('确认设置上游分支');
    expect(git.manageBranch).toHaveBeenCalledWith(workspace.path, expect.objectContaining({ branch: 'main', action: { kind: 'upstream', upstream: 'origin/main' } }));
  });

  it('后端拒绝未合并分支删除时保留分支和确认弹窗', async () => {
    vi.mocked(git.manageBranch).mockRejectedValue('此分支尚未完全合并到当前分支，不能删除。');
    await openMenu('切换到 topic'); await click('删除本地分支…'); await click('确认删除本地分支');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button('切换到 topic')).toBeTruthy();
    expect(host.textContent).toContain('尚未完全合并');
  });
});
