// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git, type RepositorySnapshot } from './services/git';

vi.mock('./services/git', async importOriginal => ({
  ...await importOriginal<typeof import('./services/git')>(),
  isDesktop: () => false,
  git: { stashes: vi.fn(), open: vi.fn(), bootstrap: vi.fn(), stage: vi.fn(), unstage: vi.fn(), discard: vi.fn(), diff: vi.fn(), commit: vi.fn(), checkout: vi.fn(), fetch: vi.fn() },
}));
vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));

const workspace = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const file = (path: string, overrides: Partial<RepositorySnapshot['files'][number]> = {}): RepositorySnapshot['files'][number] => ({ path, oldPath: null, indexStatus: ' ', worktreeStatus: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, ...overrides });
const dirtySnapshot: RepositorySnapshot = {
  ...emptyRepository(), ...workspace, branch: 'main', files: [
    file('src/modified.ts', { indexStatus: 'M', staged: true }),
    file('notes/draft.txt', { indexStatus: '?', worktreeStatus: '?', untracked: true }),
  ],
};
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(git.stashes).mockResolvedValue([]);
  localStorage.clear();
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  vi.mocked(git.open).mockResolvedValue(dirtySnapshot);
  vi.mocked(git.discard).mockResolvedValue({ ...dirtySnapshot, files: [] });
  vi.mocked(git.diff).mockResolvedValue('');
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

async function click(label: string, scope: ParentNode = host) {
  const target = Array.from(scope.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!target) throw new Error(`找不到按钮：${label}`);
  await act(async () => target.click());
}
async function openWorkspace() {
  await act(async () => root.render(<App onReady={() => {}} />));
  await click('打开仓库 Alpha');
}

describe('撤回未暂存更改', () => {
  it('未暂存和已暂存文件组可独立折叠，数量和组操作仍保留', async () => {
    await openWorkspace();
    expect(host.querySelectorAll('.file-row')).toHaveLength(3);
    const pendingToggle = host.querySelector<HTMLButtonElement>('[aria-label="折叠未暂存文件"]')!;
    await act(async () => pendingToggle.click());
    expect(host.querySelector<HTMLDivElement>('#unstaged-file-list')?.hidden).toBe(true);
    expect(host.querySelectorAll('#staged-file-list .file-row')).toHaveLength(1);
    expect(host.querySelector('[aria-label="全部撤回"]')).not.toBeNull();
    const stagedToggle = host.querySelector<HTMLButtonElement>('[aria-label="折叠已暂存文件"]')!;
    await act(async () => stagedToggle.click());
    expect(host.querySelector<HTMLDivElement>('#staged-file-list')?.hidden).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="展开未暂存文件"]')!.click());
    expect(host.querySelector<HTMLDivElement>('#unstaged-file-list')?.hidden).toBe(false);
    expect(host.querySelector<HTMLDivElement>('#staged-file-list')?.hidden).toBe(true);
    expect(host.querySelectorAll('#unstaged-file-list .file-row')).toHaveLength(2);
  });

  it('取消暂存图标和文字位于同一组水平对齐的操作按钮中', async () => {
    await openWorkspace();
    const unstage = host.querySelector<HTMLButtonElement>('[aria-label="取消全部暂存"]')!;
    expect(unstage.parentElement?.classList.contains('file-group-actions')).toBe(true);
    expect(unstage.querySelector('svg')).not.toBeNull();
  });

  it('撤回按钮紧邻加号左侧，全部撤回位于全部暂存左侧', async () => {
    await openWorkspace();
    const row = Array.from(host.querySelectorAll('.file-row')).find(node => node.querySelector('[aria-label="撤回更改 src/modified.ts"]'))!;
    expect(Array.from(row.querySelectorAll('button')).slice(1).map(button => button.getAttribute('aria-label'))).toEqual([
      '撤回更改 src/modified.ts', '暂存 src/modified.ts',
    ]);
    const actions = host.querySelector('.file-group-actions')!;
    expect(Array.from(actions.querySelectorAll('button')).map(button => button.getAttribute('aria-label'))).toEqual(['全部撤回', '暂存全部文件']);
  });

  it('单文件撤回先确认，取消不执行 Git 操作', async () => {
    await openWorkspace();
    await click('撤回更改 src/modified.ts');
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('src/modified.ts');
    expect(dialog.textContent).toContain('已暂存的内容会保留');
    expect(git.discard).not.toHaveBeenCalled();
    await click('取消', dialog);
    expect(git.discard).not.toHaveBeenCalled();
  });

  it('确认单文件后只撤回所选文件', async () => {
    await openWorkspace();
    await click('撤回更改 src/modified.ts');
    await click('确认撤回');
    expect(git.discard).toHaveBeenCalledWith(workspace.path, ['src/modified.ts']);
  });

  it('全部撤回展示文件列表和未跟踪文件删除提示，确认后一次提交全部路径', async () => {
    await openWorkspace();
    await click('全部撤回');
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('2 个文件');
    expect(dialog.textContent).toContain('src/modified.ts');
    expect(dialog.textContent).toContain('notes/draft.txt');
    expect(dialog.textContent).toContain('以下未跟踪文件也会被删除');
    expect(git.discard).not.toHaveBeenCalled();
    await click('确认撤回', dialog);
    expect(git.discard).toHaveBeenCalledWith(workspace.path, ['src/modified.ts', 'notes/draft.txt']);
  });

  it('撤回失败时保留确认弹窗供用户处理', async () => {
    vi.mocked(git.discard).mockRejectedValueOnce(new Error('撤回失败'));
    await openWorkspace();
    await click('全部撤回');
    await click('确认撤回');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('撤回全部未暂存更改');
    expect(document.querySelector('[aria-label="通知提示"]')?.textContent).toContain('撤回失败');
  });

  it('存在冲突文件时禁用该文件和全部撤回', async () => {
    const conflicted = file('conflict.txt', { indexStatus: 'U', worktreeStatus: 'U', conflicted: true });
    vi.mocked(git.open).mockResolvedValueOnce({ ...dirtySnapshot, files: [...dirtySnapshot.files, conflicted] });
    await openWorkspace();
    expect((host.querySelector('[aria-label="撤回更改 conflict.txt"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[aria-label="全部撤回"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
