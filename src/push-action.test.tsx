// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git, type RepositorySnapshot } from './services/git';

vi.mock('./services/git', async importOriginal => ({
  ...await importOriginal<typeof import('./services/git')>(),
  isDesktop: () => false,
  git: { open: vi.fn(), bootstrap: vi.fn(), stage: vi.fn(), unstage: vi.fn(), discard: vi.fn(), diff: vi.fn(), commit: vi.fn(), checkout: vi.fn(), fetch: vi.fn(), push: vi.fn() },
}));
vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));

const workspace = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const snapshot: RepositorySnapshot = { ...emptyRepository(), ...workspace, branch: 'main', head: 'abc123', remote: 'X:/Projects/remote.git' };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  vi.mocked(git.open).mockResolvedValue(snapshot);
  vi.mocked(git.diff).mockResolvedValue('');
  vi.mocked(git.push).mockResolvedValue({ ...snapshot, hasUpstream: true, ahead: 0 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!button) throw new Error(`找不到按钮：${label}`);
  await act(async () => button.click());
}
async function openWorkspace() {
  await act(async () => root.render(<App onReady={() => {}} />));
  await click('打开仓库 Alpha');
}

describe('推送入口', () => {
  it('远程已配置且当前分支未设置上游时允许首次推送', async () => {
    await openWorkspace();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="推送当前分支"]')!;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('推送');
    await click('推送当前分支');
    expect(git.push).toHaveBeenCalledWith(workspace.path);
  });

  it('有待推送提交时显示数量，推送后状态刷新', async () => {
    vi.mocked(git.open).mockResolvedValueOnce({ ...snapshot, hasUpstream: true, ahead: 2 });
    await openWorkspace();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="推送当前分支"]')!;
    expect(button.textContent).toContain('2');
    expect(button.disabled).toBe(false);
    const actions = host.querySelector('.workspace-section-heading > div:last-child')!;
    expect(Array.from(actions.querySelectorAll('button')).slice(-2).map(item => item.textContent)).toEqual(['获取更新', '推送2']);
    await click('推送当前分支');
    expect(await vi.mocked(git.push).mock.results[0].value).toEqual(expect.objectContaining({ ahead: 0, hasUpstream: true }));
  });

  it('无远程仓库、无提交或已同步时禁用推送', async () => {
    const states = [
      { ...snapshot, remote: null },
      { ...snapshot, head: null },
      { ...snapshot, hasUpstream: true, ahead: 0 },
    ];
    for (const state of states) {
      vi.mocked(git.open).mockResolvedValueOnce(state);
      await openWorkspace();
      expect((host.querySelector('[aria-label="推送当前分支"]') as HTMLButtonElement).disabled).toBe(true);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });
});
