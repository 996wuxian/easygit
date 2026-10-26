// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git } from './services/git';
import { appStorage } from './services/storage';

vi.mock('./services/git', async importOriginal => ({
  ...await importOriginal<typeof import('./services/git')>(),
  isDesktop: () => false,
  git: { stashes: vi.fn(), open: vi.fn() },
}));
vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));

const alpha = { name: 'Alpha', path: 'X:/Projects/Alpha' };
const beta = { name: 'Beta', path: 'X:/Projects/Beta' };
const ready = () => {};
let host: HTMLDivElement;
let root: Root;

function button(label: string, scope: ParentNode = host) {
  const node = Array.from(scope.querySelectorAll('button')).find(element => element.getAttribute('aria-label') === label || element.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
function editor() { return host.querySelector<HTMLTextAreaElement>('textarea#project-notes-content')!; }
async function write(content: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor(), content);
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([alpha, beta]));
  vi.mocked(git.stashes).mockResolvedValue([]);
  vi.mocked(git.open).mockImplementation(async path => ({ ...emptyRepository(), ...(path === alpha.path ? alpha : beta), branch: 'main' }));
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

describe('项目笔记工作流', () => {
  it('从状态左侧打开，自动保存，按项目隔离并在重启界面后恢复', async () => {
    await act(async () => root.render(<App onReady={ready} />));
    expect(host.querySelector('.project-notes-button')).toBeNull();
    await click('打开仓库 Alpha');
    const entry = button('项目笔记');
    expect(entry.nextElementSibling?.classList.contains('workspace-status')).toBe(true);
    entry.focus();
    await click('项目笔记');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('项目笔记');
    expect(document.activeElement).toBe(editor());
    const content = '待办：检查登录问题\n启动：pnpm run dev\n保留空行\n\n';
    await write(content);
    expect(host.querySelector('[role="dialog"] [role="status"]')?.textContent).toBe('已自动保存');
    await act(async () => editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(entry);

    await click('打开仓库 Beta');
    await click('项目笔记');
    expect(editor().value).toBe('');
    await write('Beta 的部署事项');
    await click('完成');
    await click('打开仓库 Alpha');
    await click('项目笔记');
    expect(editor().value).toBe(content);

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<App onReady={ready} />));
    await click('打开仓库 Alpha');
    await click('项目笔记');
    expect(editor().value).toBe(content);
    await write('');
    await click('完成');
    await click('项目笔记');
    expect(editor().value).toBe('');
    await click('完成');
    await click('打开仓库 Beta');
    await click('项目笔记');
    expect(editor().value).toBe('Beta 的部署事项');
  });

  it('保存失败时保留内容和弹窗，重试成功后可关闭并恢复笔记', async () => {
    await act(async () => root.render(<App onReady={ready} />));
    await click('打开仓库 Alpha');
    await click('项目笔记');
    const save = vi.spyOn(appStorage, 'setItem').mockImplementation(() => { throw new Error('磁盘空间不足'); });
    await write('不能丢失的事项');
    expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('磁盘空间不足');
    await click('完成');
    expect(editor().value).toBe('不能丢失的事项');
    save.mockRestore();
    await click('重试保存');
    await click('完成');
    await click('项目笔记');
    expect(editor().value).toBe('不能丢失的事项');
    expect(host.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  });
});
