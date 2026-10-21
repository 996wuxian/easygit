// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git, type ConflictFile, type GitFile, type RepositorySnapshot } from './services/git';
import { getDiffBlocks } from './components/diff/model';

vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));
const workspace = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const file: GitFile = { path: 'test.ts', oldPath: null, indexStatus: ' ', worktreeStatus: 'M', staged: false, unstaged: true, untracked: false, conflicted: false };
const conflictContent = 'keep\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\nend\n';
const conflict: ConflictFile = { ours: 'ours\n', theirs: 'theirs\n', working: conflictContent, oursExists: true, theirsExists: true, workingExists: true, binary: false, markerSize: 7, revision: 'revision1' };
const blocksDiff = 'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1,3 +1,3 @@\n-old\n+new1\n+new2\n middle\n-removed\n';
let host: HTMLDivElement;
let root: Root;
const ready = () => {};
const clean = (): RepositorySnapshot => ({ ...emptyRepository(), ...workspace, branch: 'main', files: [] });

function button(label: string, scope: ParentNode = document.body) {
  const result = Array.from(scope.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!result) throw new Error(`找不到按钮 ${label}`);
  return result;
}
async function click(label: string, scope?: ParentNode) { await act(async () => button(label, scope).click()); }
async function openWorkspace(overrides: Partial<GitFile> = {}) {
  vi.mocked(git.open).mockResolvedValue({ ...clean(), operation: overrides.conflicted ? 'merge' : null, files: [{ ...file, ...overrides }] });
  await act(async () => root.render(<App onReady={ready} />));
  await click('打开仓库 Alpha');
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  vi.spyOn(git, 'open');
  vi.spyOn(git, 'diff').mockResolvedValue('diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new\n');
  vi.spyOn(git, 'comparison').mockResolvedValue({ diff: '', unchanged: 'new\n', binary: false, originalExists: true, modifiedExists: true });
  vi.spyOn(git, 'discard').mockResolvedValue(clean());
  vi.spyOn(git, 'discardBlock').mockResolvedValue(clean());
  vi.spyOn(git, 'stage').mockResolvedValue({ ...clean(), files: [{ ...file, staged: true, unstaged: false, indexStatus: 'M', worktreeStatus: ' ' }] });
  vi.spyOn(git, 'unstage').mockResolvedValue({ ...clean(), files: [file] });
  vi.spyOn(git, 'conflict').mockResolvedValue(conflict);
  vi.spyOn(git, 'resolveConflict').mockResolvedValue({ ...clean(), operation: 'merge', files: [{ ...file, staged: true, unstaged: false, indexStatus: 'M', worktreeStatus: ' ' }] });
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

describe('差异页文件操作', () => {
  it('普通视图撤回当前文件需要确认，取消不写入', async () => {
    await openWorkspace();
    await click('撤回当前文件更改');
    expect(git.discard).not.toHaveBeenCalled();
    await click('取消', document.querySelector('[aria-label="撤回更改"]')!);
    expect(git.discard).not.toHaveBeenCalled();
    await click('撤回当前文件更改');
    await click('确认撤回');
    expect(git.discard).toHaveBeenCalledWith(workspace.path, [file.path]);
  });

  it('全屏撤回的确认框位于最上层，Escape 只关闭确认框', async () => {
    await openWorkspace();
    await click('展开代码差异');
    const fullscreen = document.querySelector('.diff-fullscreen-dialog')!;
    await click('撤回当前文件更改', fullscreen);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.item(1).getAttribute('aria-label')).toBe('撤回更改');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('.diff-fullscreen-dialog')).toBe(fullscreen);
    expect(git.discard).not.toHaveBeenCalled();
    await click('撤回当前文件更改', fullscreen);
    await click('确认撤回');
    expect(git.discard).toHaveBeenCalledWith(workspace.path, [file.path]);
  });

  it('暂存和取消暂存从差异页执行，暂存区不显示丢弃工作区内容的入口', async () => {
    await openWorkspace();
    await click('暂存当前文件');
    expect(git.stage).toHaveBeenCalledWith(workspace.path, [file.path]);
    expect(host.querySelector('[aria-label="撤回当前文件更改"]')).toBeNull();
    await click('取消暂存', host.querySelector('.diff-file-actions')!);
    expect(git.unstage).toHaveBeenCalledWith(workspace.path, [file.path]);
    expect(host.querySelector('[aria-label="撤回当前文件更改"]')).not.toBeNull();
  });
});

describe('冲突解决流程', () => {
  it('从全屏打开工具，保留双方且保留冲突外的编辑后保存并暂存', async () => {
    await openWorkspace({ conflicted: true, indexStatus: 'U', worktreeStatus: 'U' });
    await click('展开代码差异');
    await click('解决冲突', document.querySelector('.diff-fullscreen-dialog')!);
    const dialog = document.querySelector('[aria-label="解决文件冲突"]')!;
    expect(button('保存并标记已解决', dialog).disabled).toBe(true);
    const editor = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    const slash = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    await act(async () => editor.dispatchEvent(slash));
    expect(slash.defaultPrevented).toBe(false);
    await click('冲突块 1 保留双方', dialog);
    expect(editor.value).toBe('keep\nours\ntheirs\nend\n');
    expect(button('保存并标记已解决', dialog).disabled).toBe(false);
    await click('保存并标记已解决', dialog);
    expect(git.resolveConflict).toHaveBeenCalledWith(workspace.path, file.path, 'revision1', 'content', 'keep\nours\ntheirs\nend\n');
    expect(document.querySelector('[aria-label="解决文件冲突"]')).toBeNull();
    expect(document.querySelector('.diff-fullscreen-dialog')).not.toBeNull();
  });

  it('保存失败保留编辑结果，关闭时可继续编辑', async () => {
    vi.mocked(git.resolveConflict).mockRejectedValue(new Error('文件已被外部修改'));
    await openWorkspace({ conflicted: true, indexStatus: 'U', worktreeStatus: 'U' });
    await click(`解决冲突 ${file.path}`);
    const dialog = document.querySelector('[aria-label="解决文件冲突"]')!;
    await click('冲突块 1 使用当前', dialog);
    await click('保存并标记已解决', dialog);
    expect(dialog.querySelector('textarea')?.value).toBe('keep\nours\nend\n');
    expect(document.body.textContent).toContain('文件已被外部修改');
    await click('取消', dialog);
    expect(dialog.textContent).toContain('放弃尚未保存');
    await click('继续编辑', dialog);
    expect(dialog.querySelector('textarea')?.value).toBe('keep\nours\nend\n');
  });

  it('二进制冲突必须显式选择版本，不能误存空文本', async () => {
    vi.mocked(git.conflict).mockResolvedValue({ ...conflict, binary: true, ours: null, theirs: null, working: null });
    await openWorkspace({ conflicted: true, indexStatus: 'U', worktreeStatus: 'U' });
    await click(`解决冲突 ${file.path}`);
    const dialog = document.querySelector('[aria-label="解决文件冲突"]')!;
    expect(dialog.querySelector('textarea')).toBeNull();
    expect(button('保存并标记已解决', dialog).disabled).toBe(true);
    await click('使用传入版本', dialog);
    await click('保存并标记已解决', dialog);
    expect(git.resolveConflict).toHaveBeenCalledWith(workspace.path, file.path, 'revision1', 'theirs', undefined);
  });
});

describe('只撤回所选变更块', () => {
  it.each(['普通视图', '左右比对', '统一视图'])('%s 能独立撤回同一个 hunk 内的第二个变更块', async mode => {
    vi.mocked(git.diff).mockResolvedValue(blocksDiff);
    vi.mocked(git.comparison).mockResolvedValue({ diff: blocksDiff, unchanged: null, binary: false, originalExists: true, modifiedExists: true });
    await openWorkspace();
    let scope: ParentNode = host;
    if (mode !== '普通视图') {
      await click('展开代码差异');
      scope = document.querySelector('.diff-fullscreen-dialog')!;
      if (mode === '统一视图') await click('统一视图', scope);
    }
    await click('撤回变更块 2', scope);
    const dialog = document.querySelector('[aria-label="撤回所选变更块"]')!;
    expect(dialog.textContent).toContain('removed');
    expect(dialog.textContent).not.toContain('new1');
    expect(dialog.querySelectorAll('.code-line')).toHaveLength(1);
    expect(git.discardBlock).not.toHaveBeenCalled();
    expect(git.discard).not.toHaveBeenCalled();
    await click('确认撤回此块', dialog);
    expect(git.discardBlock).toHaveBeenCalledWith(workspace.path, file.path, getDiffBlocks(blocksDiff)[1]);
    expect(git.discard).not.toHaveBeenCalled();
  });

  it('取消区块撤回不执行写操作，过期区块失败后保留确认框', async () => {
    await openWorkspace();
    await click('撤回变更块 1');
    await click('取消', document.querySelector('[aria-label="撤回所选变更块"]')!);
    expect(git.discardBlock).not.toHaveBeenCalled();
    vi.mocked(git.discardBlock).mockRejectedValueOnce(new Error('所选变更块已变化'));
    await click('撤回变更块 1');
    await click('确认撤回此块');
    expect(document.querySelector('[aria-label="撤回所选变更块"]')).not.toBeNull();
    expect(document.body.textContent).toContain('所选变更块已变化');
  });

  it.each([{ staged: true, unstaged: false, indexStatus: 'M' }, { conflicted: true, indexStatus: 'U', worktreeStatus: 'U' }])('暂存区或冲突文件不提供工作区区块撤回', async overrides => {
    await openWorkspace(overrides);
    expect(host.querySelector('[aria-label="撤回变更块 1"]')).toBeNull();
  });
});
