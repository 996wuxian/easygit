// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git, type FileComparison, type GitFile } from './services/git';

const alpha = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const beta = { name: 'Beta', path: 'X:/Projects/Beta' };
const files: GitFile[] = ['first.ts', 'second.ts'].map(path => ({
  path, oldPath: null, indexStatus: 'M', worktreeStatus: 'M',
  staged: true, unstaged: true, untracked: false, conflicted: false,
}));
const originalDiff = '@@ -1 +1 @@\n-before\n+visible content';
const updatedDiff = '@@ -1 +1 @@\n-before\n+updated content';
const ready = () => {};
let host: HTMLDivElement;
let root: Root;

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function button(label: string, scope: ParentNode = host) {
  const match = Array.from(scope.querySelectorAll('button')).find(node =>
    node.getAttribute('aria-label') === label || node.title === label || node.textContent === label);
  if (!match) throw new Error(`找不到按钮：${label}`);
  return match;
}

async function click(label: string, scope?: ParentNode) {
  await act(async () => button(label, scope).click());
}

function area() {
  const result = host.querySelector<HTMLElement>('[aria-label="文件差异"]');
  if (!result) throw new Error('找不到文件差异区域');
  return result;
}

async function openRepository(diff = originalDiff) {
  vi.mocked(git.diff).mockResolvedValue(diff);
  await act(async () => root.render(<App onReady={ready} />));
  await click('打开仓库 Alpha');
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([alpha, beta]));
  vi.spyOn(git, 'open').mockImplementation(async path => ({
    ...emptyRepository(), ...(path === beta.path ? beta : alpha),
    branch: 'main', files: structuredClone(files),
  }));
  vi.spyOn(git, 'diff');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('代码差异刷新', () => {
  it('首页文件、分支和提交列表在相同内容刷新后保留节点、焦点和滚动位置', async () => {
    const date = new Date().toISOString();
    vi.mocked(git.open).mockImplementation(async () => ({
      ...emptyRepository(), ...alpha, branch: 'main', head: 'abc123', files: structuredClone(files),
      branches: [{ name: 'main', current: true, remote: false, lastCommitDate: date }, { name: 'feature', current: false, remote: false, lastCommitDate: date }],
      commits: [{ hash: 'abc123', shortHash: 'abc123', subject: 'Initial commit', author: 'Developer', date, parents: [], refs: [{ name: 'main', remote: false }], local: true, remote: false }],
    }));
    await openRepository();
    const fileRow = host.querySelector('.file-row');
    const historyRow = host.querySelector('.history-row');
    const branchRow = button('切换到 feature');
    const scroll = host.querySelector<HTMLElement>('.eg-panel--branches .eg-panel-content')!;
    scroll.scrollTop = 50;
    branchRow.focus();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelector('.file-row')).toBe(fileRow);
    expect(host.querySelector('.history-row')).toBe(historyRow);
    expect(button('切换到 feature')).toBe(branchRow);
    expect(document.activeElement).toBe(branchRow);
    expect(scroll.scrollTop).toBe(50);
  });

  it('同一文件刷新期间保留代码节点、统计和滚动位置，结果相同也不闪回加载页', async () => {
    await openRepository();
    await click('工作区');
    const scroll = area();
    const code = scroll.querySelector('.code-lines');
    const undo = button('撤回变更块 1');
    expect(code).not.toBeNull();
    scroll.scrollTop = 70;
    scroll.scrollLeft = 18;
    const pending = deferred();
    vi.mocked(git.diff).mockReturnValueOnce(pending.promise);

    await click('刷新仓库');

    expect(scroll.getAttribute('aria-busy')).toBe('true');
    expect(scroll.querySelector('.code-lines')).toBe(code);
    expect(scroll.textContent).toContain('visible content');
    expect(scroll.textContent).not.toContain('正在读取差异');
    expect(host.querySelector('.diff-add')?.textContent).toBe('+1');
    expect(button('复制 diff').disabled).toBe(false);
    expect(button('撤回变更块 1')).toBe(undo);
    expect(undo.disabled).toBe(false);

    await act(async () => pending.resolve(originalDiff));

    expect(scroll.getAttribute('aria-busy')).toBe('false');
    expect(scroll.querySelector('.code-lines')).toBe(code);
    expect(scroll.scrollTop).toBe(70);
    expect(scroll.scrollLeft).toBe(18);
    expect(button('撤回变更块 1')).toBe(undo);
  });

  it.each(['文件', '差异分区', '仓库'] as const)('切换%s后立即隐藏旧内容，忽略尚未返回的旧请求', async target => {
    await openRepository();
    const obsolete = deferred();
    vi.mocked(git.diff).mockReturnValueOnce(obsolete.promise);
    await click('刷新仓库');
    const current = deferred();
    vi.mocked(git.diff).mockReturnValueOnce(current.promise);

    await click(target === '文件' ? 'second.ts' : target === '差异分区' ? '工作区' : '打开仓库 Beta');

    expect(area().textContent).not.toContain('visible content');
    expect(area().textContent).toContain('正在读取差异');
    await act(async () => obsolete.resolve(originalDiff));
    expect(area().textContent).not.toContain('visible content');
    expect(area().getAttribute('aria-busy')).toBe('true');
    await act(async () => current.resolve(updatedDiff));
    expect(area().textContent).toContain('updated content');
    expect(area().getAttribute('aria-busy')).toBe('false');
  });

  it('空差异在焦点刷新时也保持稳定，同时能够读取后来新增的更改', async () => {
    await openRepository('');
    const empty = area().querySelector('.diff-empty');
    expect(area().textContent).toContain('没有差异');
    const pending = deferred();
    vi.mocked(git.diff).mockReturnValueOnce(pending.promise);

    await act(async () => window.dispatchEvent(new Event('focus')));

    expect(area().getAttribute('aria-busy')).toBe('true');
    expect(area().querySelector('.diff-empty')).toBe(empty);
    expect(area().textContent).toContain('没有差异');
    await act(async () => pending.resolve(updatedDiff));
    expect(area().textContent).toContain('updated content');
  });

  it('后台读取失败时在底栏提示并保留差异，后续刷新可以恢复', async () => {
    await openRepository();
    const code = area().querySelector('.code-lines');
    vi.mocked(git.diff).mockRejectedValueOnce(new Error('差异读取失败'));

    await click('刷新仓库');

    expect(area().querySelector('.code-lines')).toBe(code);
    expect(area().textContent).toContain('visible content');
    expect(host.querySelector('.diff-refresh-error')?.getAttribute('title')).toContain('差异读取失败');
    expect(area().getAttribute('aria-busy')).toBe('false');
    vi.mocked(git.diff).mockResolvedValueOnce(updatedDiff);
    await click('刷新仓库');
    expect(area().textContent).toContain('updated content');
    expect(host.querySelector('.diff-refresh-error')).toBeNull();
  });

  it.each(['左右比对', '统一视图'])('全屏%s 在焦点刷新期间保留源码、滚动位置和区块按钮', async mode => {
    const comparison: FileComparison = { diff: originalDiff, unchanged: null, binary: false, originalExists: true, modifiedExists: true };
    vi.spyOn(git, 'comparison').mockResolvedValue(comparison);
    await openRepository();
    await click('工作区');
    await click('展开代码差异');
    const dialog = document.querySelector('.diff-fullscreen-dialog')!;
    if (mode === '统一视图') await click('统一视图', dialog);
    const scroll = dialog.querySelector<HTMLElement>(mode === '左右比对' ? '[aria-label="变更后文件源码"]' : '.code-scroll')!;
    const code = scroll.querySelector(mode === '左右比对' ? '.source-lines' : '.code-lines');
    const undo = button('撤回变更块 1', dialog);
    scroll.scrollTop = 70;
    scroll.scrollLeft = 18;
    undo.focus();
    const compactPending = deferred();
    const comparisonPending = deferred<FileComparison>();
    vi.mocked(git.diff).mockReturnValueOnce(compactPending.promise);
    vi.mocked(git.comparison).mockReturnValueOnce(comparisonPending.promise);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(scroll.querySelector(mode === '左右比对' ? '.source-lines' : '.code-lines')).toBe(code);
    expect(button('撤回变更块 1', dialog)).toBe(undo);
    expect(undo.disabled).toBe(false);
    expect(document.activeElement).toBe(undo);
    expect(dialog.querySelector('.diff-empty')).toBeNull();
    await act(async () => { compactPending.resolve(originalDiff); comparisonPending.resolve(structuredClone(comparison)); });
    expect(button('撤回变更块 1', dialog)).toBe(undo);
    expect(scroll.scrollTop).toBe(70);
    expect(scroll.scrollLeft).toBe(18);
    expect(document.activeElement).toBe(undo);
  });

  it('全屏后台读取失败保留左右源码，重试时也不卸载代码视图', async () => {
    const comparison: FileComparison = { diff: originalDiff, unchanged: null, binary: false, originalExists: true, modifiedExists: true };
    vi.spyOn(git, 'comparison').mockResolvedValue(comparison);
    await openRepository();
    await click('展开代码差异');
    const dialog = document.querySelector('.diff-fullscreen-dialog')!;
    const code = dialog.querySelector('.source-lines');
    vi.mocked(git.comparison).mockRejectedValueOnce(new Error('读取源码失败'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(dialog.querySelector('.source-lines')).toBe(code);
    expect(dialog.querySelector('.diff-refresh-error')?.getAttribute('title')).toContain('读取源码失败');
    const pending = deferred<FileComparison>();
    vi.mocked(git.comparison).mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(dialog.querySelector('.source-lines')).toBe(code);
    expect(dialog.querySelector('.diff-empty')).toBeNull();
    await act(async () => pending.resolve(comparison));
    expect(dialog.querySelector('.source-lines')).toBe(code);
    expect(dialog.querySelector('.diff-refresh-error')).toBeNull();
  });
});
