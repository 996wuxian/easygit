// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { git, emptyRepository, type GitCommit, type RevisionComparison } from './services/git';
import { project } from './services/project';

vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));
const ready = () => {};
const workspace = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const commits: GitCommit[] = Array.from({ length: 10 }, (_, index) => ({ hash: String(index + 1).padStart(40, 'a'), shortHash: `commit${index + 1}`, subject: `提交 ${index + 1}`, author: 'Developer', date: '2026-10-23T00:00:00Z', parents: [], refs: [], local: true, remote: false }));
const result = (base = commits[0].hash, target = commits[1].hash): RevisionComparison => ({ base, target, files: [{ path: 'first.ts', oldPath: null, status: 'M' }, { path: 'second.ts', oldPath: null, status: 'A' }] });
const patch = (value: string) => `diff --git a/first.ts b/first.ts\n--- a/first.ts\n+++ b/first.ts\n@@ -1 +1 @@\n-old\n+${value}\n`;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let host: HTMLDivElement;
let root: Root;
function button(label: string) {
  const node = Array.from(document.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function menu(subject: string) {
  const row = Array.from(host.querySelectorAll<HTMLButtonElement>('.history-row')).find(row => row.querySelector('strong')?.textContent === subject)!;
  await act(async () => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 100 })));
}
async function startComparison() {
  await menu(commits[0].subject); await click('设为对比基准');
  await menu(commits[1].subject); await click('与基准提交对比…');
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear(); localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  vi.spyOn(git, 'open').mockResolvedValue({ ...emptyRepository(), ...workspace, branch: 'main', head: commits[0].hash, commits });
  vi.spyOn(git, 'stashes').mockResolvedValue([]);
  vi.spyOn(project, 'scripts').mockResolvedValue({ packageFound: false, manager: 'npm', scripts: [] });
  vi.spyOn(project, 'files').mockResolvedValue({ entries: [], truncated: false });
  vi.spyOn(git, 'compareCommits').mockResolvedValue(result());
  vi.spyOn(git, 'comparisonDiff').mockResolvedValue(patch('compared content'));
  vi.spyOn(git, 'checkout');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App onReady={ready} />)); await click('打开仓库 Alpha');
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('提交对比工作流', () => {
  it('选择两个提交后自动读取累计差异，可选择文件并交换方向', async () => {
    await menu(commits[0].subject); expect(button('与基准提交对比…').disabled).toBe(true); await click('设为对比基准');
    expect(host.querySelector('.history-compare-base')?.textContent).toContain(commits[0].subject);
    await menu(commits[0].subject); expect(button('与基准提交对比…').disabled).toBe(true);
    await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await menu(commits[1].subject); await click('与基准提交对比…');
    expect(git.compareCommits).toHaveBeenCalledWith(workspace.path, commits[0].hash, commits[1].hash);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('compared content');
    await act(async () => document.querySelector<HTMLButtonElement>('.inspection-files button:nth-child(2)')!.click());
    expect(git.comparisonDiff).toHaveBeenLastCalledWith(workspace.path, commits[0].hash, commits[1].hash, 'second.ts');
    vi.mocked(git.compareCommits).mockResolvedValue(result(commits[1].hash, commits[0].hash));
    await click('交换对比方向');
    expect(git.compareCommits).toHaveBeenLastCalledWith(workspace.path, commits[1].hash, commits[0].hash);
    expect(git.checkout).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label^="撤回变更块"]')).toBeNull();
  });

  it('翻到其他历史记录后仍可与先前基准对比，关闭弹窗后可清除基准', async () => {
    await menu(commits[0].subject); await click('设为对比基准');
    vi.spyOn(git, 'history').mockResolvedValue({ commits: [commits[1]], nextOffset: null, key: 'history-key' });
    await click('更多历史');
    expect(host.querySelectorAll('.history-row')).toHaveLength(1);
    expect(host.querySelector('.history-compare-base')?.textContent).toContain(commits[0].subject);
    await menu(commits[1].subject); await click('与基准提交对比…');
    expect(git.compareCommits).toHaveBeenCalledWith(workspace.path, commits[0].hash, commits[1].hash);
    await click('关闭对话框'); await click('清除对比基准');
    expect(host.querySelector('.history-compare-base')).toBeNull();
  });

  it('交换方向后忽略先前迟到的文件列表，切换文件后忽略旧差异', async () => {
    const forward = deferred<RevisionComparison>();
    vi.mocked(git.compareCommits).mockReturnValueOnce(forward.promise).mockResolvedValue(result(commits[1].hash, commits[0].hash));
    const first = deferred<string>();
    vi.mocked(git.comparisonDiff).mockImplementation(async (_path, _base, _target, file) => file === 'first.ts' ? first.promise : patch('second file content'));
    await startComparison(); await click('交换对比方向');
    await act(async () => forward.resolve({ ...result(), files: [{ path: 'outdated.ts', oldPath: null, status: 'M' }] }));
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('outdated.ts');
    await act(async () => document.querySelector<HTMLButtonElement>('.inspection-files button:nth-child(2)')!.click());
    await act(async () => first.resolve(patch('outdated patch')));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('second file content');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('outdated patch');
  });

  it('读取失败可重试，没有变化时显示明确空状态', async () => {
    vi.mocked(git.compareCommits).mockRejectedValueOnce('无法读取所选提交').mockResolvedValue({ ...result(), files: [] });
    await startComparison(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法读取所选提交');
    await click('重试'); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('两个提交的文件内容相同');
    expect(git.comparisonDiff).not.toHaveBeenCalled();
  });
});
