// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git } from './services/git';
import { useRepository } from './services/useRepository';

vi.mock('./services/git', async importOriginal => ({
  ...await importOriginal<typeof import('./services/git')>(),
  isDesktop: () => false,
  git: { stashes: vi.fn(), open: vi.fn(), bootstrap: vi.fn(), stage: vi.fn(), unstage: vi.fn(), commit: vi.fn(), checkout: vi.fn(), fetch: vi.fn() },
}));
vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));

const alpha = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const beta = { name: 'Beta', path: 'X:/Projects/Beta' };
const snapshot = { ...emptyRepository(), ...alpha, branch: 'main' };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(git.stashes).mockResolvedValue([]);
  localStorage.clear();
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([alpha, beta]));
  vi.mocked(git.open).mockResolvedValue(snapshot);
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

function button(label: string, scope: ParentNode = host) {
  const result = Array.from(scope.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!result) throw new Error(`找不到按钮：${label}`);
  return result;
}
async function click(label: string, scope: ParentNode = host) {
  await act(async () => button(label, scope).click());
}
function saved() { return JSON.parse(localStorage.getItem('esaygit.recent.v1') ?? '[]'); }

describe('工作区移除交互', () => {
  it('侧栏移除先确认，取消后记录和当前工作区保持不变', async () => {
    await act(async () => root.render(<App onReady={() => {}} />));
    await click('打开仓库 Alpha');
    await click('移除工作区 Alpha', host.querySelector('aside')!);
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('本地文件、Git 仓库及未提交的更改都会保留');
    expect(dialog.textContent).toContain(alpha.path);
    expect(saved()).toEqual([alpha, beta]);
    await click('取消', dialog);
    expect(host.querySelector('[aria-label="当前项目与分支"]')?.textContent).toContain('Alpha');
    expect(saved()).toEqual([alpha, beta]);
  });

  it('确认移除当前工作区后，侧栏、最近列表、标题和内容同步清除，不调用 Git 写操作', async () => {
    await act(async () => root.render(<App onReady={() => {}} />));
    await click('打开仓库 Alpha');
    await click('移除工作区 Alpha', host.querySelector('aside')!);
    await click('确认移除');
    expect(host.querySelector('[aria-label="尚未打开仓库"]')).not.toBeNull();
    expect(host.querySelector('aside')?.textContent).not.toContain('Alpha');
    expect(host.querySelector('main')?.textContent).not.toContain('Alpha');
    expect(host.querySelector('[aria-label="当前项目与分支"]')).toBeNull();
    expect(saved()).toEqual([beta]);
    expect(git.open).toHaveBeenCalledTimes(1);
    for (const operation of [git.stage, git.unstage, git.commit, git.checkout, git.fetch]) expect(operation).not.toHaveBeenCalled();
  });

  it('打开仓库弹窗也使用二次确认，移除其他项目时保留当前工作区', async () => {
    await act(async () => root.render(<App onReady={() => {}} />));
    await click('打开仓库 Alpha');
    await click('切换仓库');
    await click('移除工作区 Beta', host.querySelector('[role="dialog"]')!);
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(saved()).toEqual([alpha, beta]);
    await click('确认移除');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('打开一个 Git 仓库');
    expect(host.querySelector('[role="dialog"]')?.textContent).not.toContain('Beta');
    expect(host.querySelector('[aria-label="当前项目与分支"]')?.textContent).toContain('Alpha');
    expect(saved()).toEqual([alpha]);
    await click('关闭对话框');
    expect(host.querySelector('[data-eg-panel="changes"]')).not.toBeNull();
  });

  it('移除后，已经发出的后台刷新不能恢复工作区', async () => {
    let repository!: ReturnType<typeof useRepository>;
    const ready = () => {};
    function Harness() { repository = useRepository(ready); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => { await repository.open(alpha.path); });
    let resolveRefresh!: (value: typeof snapshot) => void;
    vi.mocked(git.open).mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = repository.refresh(true); });
    await act(async () => { repository.removeWorkspace(alpha); });
    await act(async () => { resolveRefresh(snapshot); await pending; });
    expect(repository.hasRepository).toBe(false);
    expect(repository.snapshot.path).toBe('');
    expect(repository.recents).toEqual([beta]);
    expect(saved()).toEqual([beta]);
  });
});
