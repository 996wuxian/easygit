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
  vi.mocked(git.fetch).mockResolvedValue(snapshot);
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
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.parentElement?.classList.contains('commit-actions')).toBe(true);
    expect(host.querySelector('.workspace-section-heading [aria-label="推送当前分支"]')).toBeNull();
    await click('推送当前分支');
    expect(git.push).toHaveBeenCalledWith(workspace.path);
  });

  it('有待推送提交时显示数量，推送后状态刷新', async () => {
    vi.mocked(git.open).mockResolvedValue({ ...snapshot, hasUpstream: true, ahead: 2 });
    await openWorkspace();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="推送当前分支"]')!;
    expect(button.title).toContain('2 个待推送提交');
    expect(button.disabled).toBe(false);
    expect(button.previousElementSibling?.textContent).toContain('提交更改');
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
      vi.mocked(git.open).mockResolvedValue(state);
      await openWorkspace();
      expect((host.querySelector('[aria-label="推送当前分支"]') as HTMLButtonElement).disabled).toBe(true);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });
});

describe('项目远程状态展示', () => {
  it('打开后显示后台获取状态，保留已有历史行，并展示获取到的提交与分支', async () => {
    let finish!: (value: RepositorySnapshot) => void;
    vi.mocked(git.fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const date = new Date().toISOString();
    const localCommit = { hash: 'abc123', shortHash: 'abc123', subject: 'Local history', author: 'Developer', date, parents: [], refs: [{ name: 'main', remote: false }], local: true, remote: true };
    const local = { ...snapshot, hasUpstream: true, upstream: { name: 'origin/main', hash: 'abc123' }, commits: [localCommit], branches: [{ name: 'main', current: true, remote: false, lastCommitDate: date }] };
    vi.mocked(git.open).mockResolvedValue(local);
    await openWorkspace();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="获取远程更新"]')!;
    const history = host.querySelector('.history-row');
    expect(history?.textContent).toContain('Local history');
    expect(button.textContent).toBe('正在获取');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="刷新仓库"]')!.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="打开仓库 Alpha"]')!.disabled).toBe(false);
    const latest = { ...local, behind: 1, upstream: { name: 'origin/main', hash: 'remote-tip' }, commits: [{ ...localCommit, hash: 'remote-tip', shortHash: 'remote', subject: 'New remote commit', parents: ['abc123'], refs: [{ name: 'origin/main', remote: true }], local: false }, localCommit], branches: [...local.branches, { name: 'origin/feature', current: false, remote: true, lastCommitDate: date }] };
    vi.mocked(git.open).mockResolvedValue(latest);
    await act(async () => { finish(local); });
    expect(button.textContent).toBe('获取更新');
    expect(button.disabled).toBe(false);
    expect(host.textContent).toContain('New remote commit');
    expect(host.textContent).toContain('origin/feature');
    expect(host.textContent).toContain('1 个待拉取');
    expect(Array.from(host.querySelectorAll('.history-row')).find(row => row.textContent?.includes('Local history'))).toBe(history);
  });
});
