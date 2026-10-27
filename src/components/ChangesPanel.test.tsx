// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesPanel } from './ChangesPanel';
import { emptyRepository, type GitFile } from '../services/git';
import type { RepositoryTask } from '../services/useRepository';

const file = (path: string, changes: Partial<GitFile> = {}): GitFile => ({ path, oldPath: null, indexStatus: ' ', worktreeStatus: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, ...changes });
const files = [file('a.ts'), file('b.ts'), file('c.ts'), file('both.ts', { staged: true })];
const stage = vi.fn(); const unstage = vi.fn(); const discard = vi.fn(); const commit = vi.fn(async () => true);
let host: HTMLDivElement; let root: Root;
function Harness({ entries = files, task = null }: { entries?: GitFile[]; task?: RepositoryTask | null }) {
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ path: string; staged: boolean } | null>(null);
  return <ChangesPanel snapshot={{ ...emptyRepository(), files: entries }} selected={preview?.path ?? null} selectedStaged={preview?.staged} message={message} onMessageChange={setMessage} onSelect={(path, staged) => setPreview({ path, staged })} onStage={stage} onUnstage={unstage} onDiscard={discard} onResolveConflict={() => {}} onCommit={commit} canPush pushTitle="推送" onPush={() => {}} onGenerateCommitMessage={() => {}} generatingCommitMessage={false} busy={Boolean(task)} activeOperation={task} />;
}
function button(label: string) { return Array.from(host.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)!; }
async function choose(path: string, options: MouseEventInit = {}, staged = false) {
  const node = host.querySelector<HTMLButtonElement>(`[aria-label="选择${staged ? '已暂存' : '未暂存'}文件 ${path}"]`)!;
  await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true, ...options })));
}
async function input(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
  await act(async () => node.dispatchEvent(new Event('input', { bubbles: true })));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('文件批量操作', () => {
  it('不显示复选框，Ctrl 取消选择不会留下预览选中背景，Shift 仍可连选', async () => {
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    await choose('a.ts'); await choose('c.ts', { ctrlKey: true });
    await act(async () => button('暂存所选').click());
    expect(stage).toHaveBeenLastCalledWith(['a.ts', 'c.ts']);
    await choose('c.ts', { ctrlKey: true });
    const deselected = button('选择未暂存文件 c.ts');
    expect(deselected.getAttribute('aria-pressed')).toBe('false');
    expect(deselected.closest('.file-row')!.classList.contains('selected')).toBe(false);
    expect(host.querySelectorAll('.file-row.selected')).toHaveLength(1);
    await choose('a.ts'); await choose('c.ts', { shiftKey: true });
    expect(host.querySelectorAll('.file-row.selected')).toHaveLength(3);
    expect(button('选择未暂存文件 c.ts').getAttribute('aria-pressed')).toBe('true');
    await act(async () => button('暂存所选').click());
    expect(stage).toHaveBeenLastCalledWith(['a.ts', 'b.ts', 'c.ts']);
  });
  it('Ctrl 多选和 Shift 连选只操作所选文件，撤回沿用预览确认流程', async () => {
    await choose('a.ts'); await choose('c.ts', { shiftKey: true });
    expect(host.querySelector('[aria-label="批量文件操作"]')?.textContent).toContain('已选 3 项');
    await act(async () => button('暂存所选').click());
    expect(stage).toHaveBeenLastCalledWith(['a.ts', 'b.ts', 'c.ts']);
    await choose('b.ts', { ctrlKey: true });
    await act(async () => button('撤回所选').click());
    expect(discard).toHaveBeenLastCalledWith(['a.ts', 'c.ts'], 'selection');
  });
  it('已暂存与未暂存的同一文件各自选择，过滤后清除批量范围', async () => {
    await choose('both.ts'); await choose('both.ts', {}, true);
    expect(button('选择未暂存文件 both.ts').getAttribute('aria-pressed')).toBe('false');
    await act(async () => button('取消暂存所选').click());
    expect(unstage).toHaveBeenCalledWith(['both.ts']);
    await input('[aria-label="筛选变更文件"]', 'a.ts');
    expect(host.querySelector('[aria-label="批量文件操作"]')).toBeNull();
  });
  it('仓库刷新移除已消失的选择，冲突文件禁用批量暂存与撤回', async () => {
    await choose('a.ts');
    await act(async () => root.render(<Harness entries={[file('conflict.ts', { conflicted: true })]} />));
    expect(host.querySelector('[aria-label="批量文件操作"]')).toBeNull();
    await choose('conflict.ts');
    expect(button('暂存所选').disabled).toBe(true);
    expect(button('撤回所选').disabled).toBe(true);
  });
});

describe('提交表单反馈', () => {
  it('有未解决冲突时明确提示，并阻止快捷键提交', async () => {
    await input('textarea', 'should not commit');
    await act(async () => root.render(<Harness entries={[file('a.ts', { staged: true }), file('conflict.ts', { conflicted: true })]} />));
    expect(host.querySelector('#commit-disabled-reason')?.textContent).toBe('请先解决冲突文件');
    await act(async () => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(commit).not.toHaveBeenCalled();
  });
  it('显示禁用原因，满足暂存和信息条件后才提交，成功清空草稿', async () => {
    expect(host.querySelector('#commit-disabled-reason')?.textContent).toBe('请填写提交信息');
    await input('textarea', 'feat: improve UX\n\nDetails');
    expect(host.querySelector('#commit-disabled-reason')).toBeNull();
    await act(async () => host.querySelector<HTMLTextAreaElement>('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })));
    expect(commit).toHaveBeenCalledWith('feat: improve UX\n\nDetails');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    await act(async () => root.render(<Harness entries={[file('a.ts')]} />));
    expect(host.querySelector('#commit-disabled-reason')?.textContent).toBe('请先暂存要提交的文件');
  });
  it('暂存、推送期间不把提交按钮显示成正在提交', async () => {
    await act(async () => root.render(<Harness task={{ kind: 'stage', label: '正在暂存 2 个文件…' }} />));
    expect(host.querySelector('.commit-button .spin')).toBeNull();
    expect(host.querySelector('#commit-disabled-reason')?.textContent).toBe('正在暂存 2 个文件…');
    await act(async () => root.render(<Harness task={{ kind: 'push', label: '正在推送当前分支…' }} />));
    expect(host.querySelector('.push-commit-button .spin')).not.toBeNull();
    expect(host.querySelector('.commit-button .spin')).toBeNull();
    await act(async () => root.render(<Harness task={{ kind: 'commit', label: '正在创建提交…' }} />));
    expect(host.querySelector('.commit-button .spin')).not.toBeNull();
  });
  it('提交框随内容增高且有限高，清空并失焦后恢复紧凑高度', async () => {
    const node = host.querySelector<HTMLTextAreaElement>('textarea')!;
    let measured = 110;
    vi.spyOn(node, 'scrollHeight', 'get').mockImplementation(() => measured);
    await input('textarea', 'title\n\nbody');
    expect(node.style.height).toBe('112px');
    measured = 1000; await input('textarea', 'long body');
    expect(node.style.height).toBe('143px');
    measured = 20; await input('textarea', '');
    expect(node.style.height).toBe('35px');
    await act(async () => node.focus());
    expect(node.style.height).toBe('71px');
    await act(async () => node.blur());
    expect(node.style.height).toBe('35px');
  });
});
