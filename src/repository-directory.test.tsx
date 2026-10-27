// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as gitService from './services/git';
import { appStorage } from './services/storage';
import { project } from './services/project';

const ready = () => {};
let host: HTMLDivElement;
let root: Root;
function button(label: string) {
  const node = Array.from(document.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
function input() { return document.querySelector<HTMLInputElement>('#repo-path')!; }
async function change(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  await act(async () => input().dispatchEvent(new Event('input', { bubbles: true })));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  vi.spyOn(gitService, 'isDesktop').mockReturnValue(false);
  vi.spyOn(appStorage, 'getItem').mockImplementation(key => localStorage.getItem(key));
  vi.spyOn(appStorage, 'setItem').mockImplementation((key, value) => localStorage.setItem(key, value));
  vi.spyOn(gitService.git, 'pickDirectory').mockResolvedValue('X:/Projects/selected repo');
  vi.spyOn(gitService.git, 'open').mockResolvedValue({ ...gitService.emptyRepository(), path: 'X:/Projects/selected repo', name: 'selected repo' });
  vi.spyOn(gitService.git, 'stashes').mockResolvedValue([]);
  vi.spyOn(project, 'scripts').mockResolvedValue({ packageFound: false, manager: 'npm', scripts: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App onReady={ready} />));
  vi.mocked(gitService.isDesktop).mockReturnValue(true);
  await act(async () => host.querySelector<HTMLButtonElement>('.repository-empty > button')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('打开仓库时选择文件夹', () => {
  it('选中目录后填入完整路径，确认打开才调用仓库接口', async () => {
    await click('选择仓库文件夹');
    expect(gitService.git.pickDirectory).toHaveBeenCalledWith('');
    expect(input().value).toBe('X:/Projects/selected repo');
    expect(gitService.git.open).not.toHaveBeenCalled();
    await click('打开仓库');
    expect(gitService.git.open).toHaveBeenCalledWith('X:/Projects/selected repo');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('已有路径作为选择起点，取消选择保留原路径，也可手动输入', async () => {
    await change('X:/Projects/manual'); vi.mocked(gitService.git.pickDirectory).mockResolvedValue(null);
    await click('选择仓库文件夹');
    expect(gitService.git.pickDirectory).toHaveBeenCalledWith('X:/Projects/manual');
    expect(input().value).toBe('X:/Projects/manual'); expect(input().disabled).toBe(false);
    await change('X:/Projects/edited'); await click('打开仓库');
    expect(gitService.git.open).toHaveBeenCalledWith('X:/Projects/edited');
  });
  it('选择过程中阻止重复弹窗和提前打开仓库', async () => {
    let finish!: (path: string | null) => void;
    vi.mocked(gitService.git.pickDirectory).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await change('X:/Projects/manual'); await click('选择仓库文件夹');
    expect(button('选择仓库文件夹').disabled).toBe(true); expect(button('打开仓库').disabled).toBe(true);
    await click('选择仓库文件夹'); expect(gitService.git.pickDirectory).toHaveBeenCalledTimes(1);
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(gitService.git.open).not.toHaveBeenCalled();
    await act(async () => finish(null)); expect(button('选择仓库文件夹').disabled).toBe(false);
  });
  it('选择失败时保留输入并允许重试', async () => {
    await change('X:/Projects/manual'); vi.mocked(gitService.git.pickDirectory).mockRejectedValueOnce('系统选择器不可用');
    await click('选择仓库文件夹');
    expect(input().value).toBe('X:/Projects/manual'); expect(document.querySelector('[aria-label="通知提示"]')?.textContent).toContain('无法选择文件夹');
    expect(button('选择仓库文件夹').disabled).toBe(false); await click('选择仓库文件夹');
    expect(input().value).toBe('X:/Projects/selected repo');
  });
});
