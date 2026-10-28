// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as service from './services/git';
import { appStorage } from './services/storage';
import * as storageService from './services/storage';
import { project } from './services/project';
import { defaultPanelLayout, PANEL_LAYOUT_STORAGE_KEY } from './layout/model';

const ready = () => {};
vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));
const workspace = { ...service.emptyRepository(), name: 'Project', path: 'X:/Projects/Project', branch: 'main' };
let host: HTMLDivElement;
let root: Root;
function button(label: string) {
  const node = Array.from(document.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function change(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
}
async function render() { await act(async () => root.render(<App onReady={ready} />)); }
async function openWorkspace() {
  localStorage.setItem('esaygit.recent.v1', JSON.stringify([workspace]));
  await render(); await click('打开仓库 Project');
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.spyOn(service, 'isDesktop').mockReturnValue(true);
  vi.spyOn(storageService, 'readAiApiKey').mockReturnValue('');
  vi.spyOn(storageService, 'saveAiApiKey').mockResolvedValue();
  vi.spyOn(service.git, 'bootstrap').mockResolvedValue({ gitAvailable: true, gitVersion: 'git test', error: null });
  vi.spyOn(appStorage, 'getItem').mockImplementation(key => localStorage.getItem(key));
  vi.spyOn(appStorage, 'setItem').mockImplementation((key, value) => localStorage.setItem(key, value));
  vi.spyOn(service.git, 'open').mockResolvedValue(workspace);
  vi.spyOn(service.git, 'clone').mockResolvedValue(workspace);
  vi.spyOn(service.git, 'cancelClone').mockResolvedValue();
  vi.spyOn(service.git, 'initialize').mockResolvedValue(workspace);
  vi.spyOn(service.git, 'stashes').mockResolvedValue([]);
  vi.spyOn(service.git, 'diff').mockResolvedValue('');
  vi.spyOn(service.git, 'remotes').mockResolvedValue([]);
  vi.spyOn(service.git, 'configureRemote').mockResolvedValue({ ...workspace, remote: 'https://host/project.git' });
  vi.spyOn(project, 'scripts').mockResolvedValue({ packageFound: false, manager: 'npm', scripts: [] });
  vi.spyOn(project, 'files').mockResolvedValue({ entries: [], truncated: false });
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('侧栏直接打开隐藏面板', () => {
  it('自动显示、定位并保存面板，不打开布局对话框且保留顺序和尺寸', async () => {
    const layout = { ...defaultPanelLayout(), hidden: ['changes', 'diff', 'branches', 'commits', 'files', 'activity'], sizes: { diff: { span: 8, height: 460 } } };
    localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    await openWorkspace();
    expect(Array.from(host.querySelectorAll('.main-nav button')).map(node => node.getAttribute('aria-label'))).toEqual(['工作区变更', '代码差异', '分支', '提交记录', '项目文件']);
    for (const [label, id] of [['工作区变更', 'changes'], ['代码差异', 'diff'], ['分支', 'branches'], ['提交记录', 'commits'], ['项目文件', 'files']]) {
      expect(host.querySelector(`[data-eg-panel="${id}"]`)).toBeNull();
      await click(label);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 95)); });
      expect(host.querySelector(`[data-eg-panel="${id}"]`)?.classList.contains('panel-highlight')).toBe(true);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(button(label).getAttribute('aria-current')).toBe('page');
      expect(host.querySelectorAll('.main-nav [aria-current="page"]')).toHaveLength(1);
    }
    const saved = JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!);
    expect(saved.hidden).toEqual(['activity']); expect(saved.order).toEqual(layout.order); expect(saved.sizes).toEqual(layout.sizes);
    await click('项目文件'); expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).hidden).toEqual(['activity']);
  });
});

describe('新用户仓库入口', () => {
  it('克隆时推导目录名称并在完成后打开，记录最近项目', async () => {
    await render(); await click('克隆仓库');
    await change('clone-url', 'git@host:owner/project.git');
    expect((document.getElementById('setup-name') as HTMLInputElement).value).toBe('project');
    await change('setup-name', 'my-project'); await change('clone-url', 'https://host/other.git');
    expect((document.getElementById('setup-name') as HTMLInputElement).value).toBe('my-project');
    await change('setup-directory', 'X:/Projects'); await click('克隆并打开');
    expect(service.git.clone).toHaveBeenCalledWith(expect.objectContaining({ kind: 'clone', url: 'https://host/other.git', parent: 'X:/Projects', name: 'my-project' }), expect.any(Function));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[aria-label="当前项目与分支"]')?.textContent).toContain('Project');
    expect(JSON.parse(localStorage.getItem('esaygit.recent.v1')!)[0].path).toBe(workspace.path);
  });
  it('显示真实阶段、阻止重复提交和快捷键切走，取消后保留输入以便重试', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(service.git.clone).mockImplementation((_request, progress) => {
      progress({ phase: '正在接收对象', percent: 42 });
      return new Promise((_resolve, failure) => { reject = failure; });
    });
    await render(); await click('克隆仓库');
    await change('clone-url', 'https://host/project.git'); await change('setup-directory', 'X:/Projects'); await click('克隆并打开');
    expect(host.querySelector('.setup-progress')?.textContent).toContain('42%');
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(service.git.clone).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'o', bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('克隆仓库');
    await click('取消克隆');
    expect(service.git.cancelClone).toHaveBeenCalledWith(vi.mocked(service.git.clone).mock.calls[0][0].id);
    await act(async () => reject(new Error('克隆已取消，可以重新尝试。')));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('克隆已取消');
    expect((document.getElementById('clone-url') as HTMLInputElement).value).toBe('https://host/project.git');
    expect(button('克隆并打开').disabled).toBe(false);
  });
  it('初始化使用选择的现有目录和初始分支，失败后保留输入', async () => {
    vi.mocked(service.git.initialize).mockRejectedValueOnce(new Error('此目录已经位于 Git 仓库中'));
    await render(); await click('初始化仓库');
    await change('setup-directory', 'X:/Projects'); await change('setup-name', 'develop'); await click('初始化并打开');
    expect(service.git.initialize).toHaveBeenCalledWith('X:/Projects', 'develop');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('已经位于');
    expect((document.getElementById('setup-name') as HTMLInputElement).value).toBe('develop');
    await click('初始化并打开'); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('远程地址配置', () => {
  it('新增远程地址，提交预览时的配置，保存后刷新列表和仓库状态', async () => {
    await openWorkspace(); await click('配置远程仓库'); await click('添加远程仓库');
    expect((document.getElementById('remote-name') as HTMLInputElement).value).toBe('origin');
    await change('remote-url', 'https://host/project.git');
    vi.mocked(service.git.remotes).mockResolvedValue([{ name: 'origin', fetchUrls: ['https://host/project.git'], pushUrls: ['https://host/project.git'] }]);
    await click('保存地址');
    expect(service.git.configureRemote).toHaveBeenCalledWith(workspace.path, { name: 'origin', url: 'https://host/project.git', expected: null });
    expect(host.querySelector('.remote-list')?.textContent).toContain('https://host/project.git');
    expect(button('获取远程更新').disabled).toBe(false);
  });
  it('修改保留原始配置以防止覆盖外部更新，移除需要确认', async () => {
    const remote = { name: 'origin', fetchUrls: ['https://host/old.git'], pushUrls: ['git@host:push.git'] };
    vi.mocked(service.git.remotes).mockResolvedValue([remote]);
    await openWorkspace(); await click('配置远程仓库'); await click('修改远程 origin');
    await change('remote-url', 'https://host/new.git'); await click('保存地址');
    expect(service.git.configureRemote).toHaveBeenLastCalledWith(workspace.path, { name: 'origin', url: 'https://host/new.git', expected: remote });
    await click('移除远程 origin'); expect(service.git.configureRemote).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.remote-remove-note')?.textContent).toContain('本地分支、项目文件');
    await click('确认移除远程');
    expect(service.git.configureRemote).toHaveBeenLastCalledWith(workspace.path, { name: 'origin', url: null, expected: remote });
  });
});
