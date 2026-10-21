// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git, type GitFile } from './services/git';

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

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function button(label: string) {
  const match = Array.from(host.querySelectorAll('button')).find(node =>
    node.getAttribute('aria-label') === label || node.title === label || node.textContent === label);
  if (!match) throw new Error(`找不到按钮：${label}`);
  return match;
}

async function click(label: string) {
  await act(async () => button(label).click());
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
  it('同一文件刷新期间保留代码节点、统计和滚动位置，结果相同也不闪回加载页', async () => {
    await openRepository();
    const scroll = area();
    const code = scroll.querySelector('.code-lines');
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

    await act(async () => pending.resolve(originalDiff));

    expect(scroll.getAttribute('aria-busy')).toBe('false');
    expect(scroll.querySelector('.code-lines')).toBe(code);
    expect(scroll.scrollTop).toBe(70);
    expect(scroll.scrollLeft).toBe(18);
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

  it('后台读取失败时显示错误，后续刷新可以恢复', async () => {
    await openRepository();
    vi.mocked(git.diff).mockRejectedValueOnce(new Error('差异读取失败'));

    await click('刷新仓库');

    expect(area().textContent).toContain('差异读取失败');
    expect(area().getAttribute('aria-busy')).toBe('false');
    vi.mocked(git.diff).mockResolvedValueOnce(updatedDiff);
    await click('刷新仓库');
    expect(area().textContent).toContain('updated content');
  });
});
