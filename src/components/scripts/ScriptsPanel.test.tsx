// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { emptyRepository, git, type RepositorySnapshot } from '../../services/git';
import { project, type ProjectScriptsInfo } from '../../services/project';
import { ScriptsPanel } from './ScriptsPanel';

vi.mock('../WindowControls', () => ({ WindowControls: () => null }));
const alpha = { ...emptyRepository(), path: 'X:/Projects/Alpha', name: 'Alpha', branch: 'main' };
const beta = { ...alpha, path: 'X:/Projects/Beta', name: 'Beta' };
const info: ProjectScriptsInfo = { packageFound: true, manager: 'pnpm', scripts: [{ name: 'dev', command: 'vite --host 127.0.0.1' }, { name: 'build', command: 'tsc && vite build' }, { name: 'tauri:dev', command: 'tauri dev' }] };
const ready = () => {};
let root: Root;
let host: HTMLDivElement;
const notify = vi.fn<(message: string, error?: boolean) => void>();
function button(name: string, scope: ParentNode = host) {
  const node = Array.from(scope.querySelectorAll('button')).find(element => element.getAttribute('aria-label') === name || element.textContent === name);
  if (!node) throw new Error(`找不到按钮 ${name}`);
  return node;
}
async function click(name: string, scope?: ParentNode) { await act(async () => button(name, scope).click()); }
async function render(snapshot: RepositorySnapshot = alpha) { await act(async () => root.render(<ScriptsPanel key={snapshot.path} snapshot={snapshot} notify={notify} />)); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  notify.mockReset();
  vi.spyOn(project, 'scripts').mockResolvedValue(info);
  vi.spyOn(project, 'runScript').mockResolvedValue();
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

describe('项目脚本面板', () => {
  it('后台刷新保留按钮、列表节点和滚动位置，不反复变灰或显示加载动画', async () => {
    await render();
    const list = host.querySelector<HTMLElement>('[aria-label="项目运行脚本"]')!;
    const run = button('运行脚本 dev');
    const refresh = button('刷新项目脚本');
    list.scrollTop = 100;
    run.focus();
    let resolve!: (value: ProjectScriptsInfo) => void;
    vi.mocked(project.scripts).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await render({ ...alpha });
    expect(host.querySelector('[aria-label="项目运行脚本"]')).toBe(list);
    expect(button('运行脚本 dev')).toBe(run);
    expect(run.disabled).toBe(false);
    expect(refresh.disabled).toBe(false);
    expect(refresh.querySelector('.spin')).toBeNull();
    expect(host.querySelector('.project-scripts-content')?.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(run);
    await act(async () => resolve(structuredClone(info)));
    expect(host.querySelector('[aria-label="项目运行脚本"]')).toBe(list);
    expect(list.scrollTop).toBe(100);
    expect(run.disabled).toBe(false);
    expect(document.activeElement).toBe(run);
  });

  it('手动刷新有明确进度，后台读取失败也保留上次脚本，后续刷新能恢复', async () => {
    await render();
    const list = host.querySelector('[aria-label="项目运行脚本"]');
    let reject!: (error: Error) => void;
    vi.mocked(project.scripts).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    await click('刷新项目脚本');
    expect(button('刷新项目脚本').querySelector('.spin')).not.toBeNull();
    expect(button('运行脚本 dev').disabled).toBe(true);
    expect(host.querySelector('[aria-label="项目运行脚本"]')).toBe(list);
    await act(async () => reject(new Error('package.json 正在写入')));
    expect(host.querySelector('[aria-label="项目运行脚本"]')).toBe(list);
    expect(host.textContent).toContain('保留上次读取的脚本');
    expect(button('运行脚本 dev').disabled).toBe(false);
    let resolve!: (value: ProjectScriptsInfo) => void;
    vi.mocked(project.scripts).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await render({ ...alpha });
    expect(host.textContent).toContain('保留上次读取的脚本');
    expect(button('刷新项目脚本').querySelector('.spin')).toBeNull();
    await act(async () => resolve({ ...info, scripts: [...info.scripts, { name: 'new', command: 'node new.js' }] }));
    expect(host.textContent).not.toContain('保留上次读取的脚本');
    expect(button('运行脚本 new').disabled).toBe(false);
  });

  it('没有脚本的空状态在后台刷新期间也保持同一节点', async () => {
    vi.mocked(project.scripts).mockResolvedValue({ ...info, scripts: [] });
    await render();
    const empty = host.querySelector('.project-scripts-empty');
    let resolve!: (value: ProjectScriptsInfo) => void;
    vi.mocked(project.scripts).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await render({ ...alpha });
    expect(host.querySelector('.project-scripts-empty')).toBe(empty);
    expect(button('刷新项目脚本').querySelector('.spin')).toBeNull();
    await act(async () => resolve({ ...info, scripts: [] }));
    expect(host.querySelector('.project-scripts-empty')).toBe(empty);
  });

  it('列出脚本原始命令并使用当前项目和识别的包管理器启动', async () => {
    await render();
    expect(host.textContent).toContain('pnpm');
    expect(host.textContent).toContain('tsc && vite build');
    await click('运行脚本 tauri:dev');
    expect(project.runScript).toHaveBeenCalledWith(alpha.path, info.scripts[2], 'pnpm');
    expect(notify).toHaveBeenCalledWith('已打开终端执行 pnpm run tauri:dev');
    expect(host.textContent).toContain('已打开终端：pnpm run tauri:dev');
  });

  it('启动期间防止重复点击，失败后允许重试并提示错误', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(project.runScript).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    await render();
    await act(async () => { button('运行脚本 dev').click(); button('运行脚本 dev').click(); });
    expect(project.runScript).toHaveBeenCalledTimes(1);
    expect(button('运行脚本 build').disabled).toBe(true);
    await act(async () => reject(new Error('脚本已变化，请刷新')));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('脚本已变化'), true);
    expect(button('运行脚本 dev').disabled).toBe(false);
  });

  it('切换项目后不显示旧项目的异步结果，也不会运行旧脚本', async () => {
    let resolve!: (value: ProjectScriptsInfo) => void;
    vi.mocked(project.scripts).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await render(alpha);
    await render(beta);
    await act(async () => resolve({ ...info, scripts: [{ name: 'obsolete', command: 'old command' }] }));
    expect(host.textContent).not.toContain('obsolete');
    await click('运行脚本 dev');
    expect(project.runScript).toHaveBeenCalledWith(beta.path, info.scripts[0], 'pnpm');
  });

  it('读取失败可以刷新，缺少 package.json 或 scripts 时显示明确的空状态', async () => {
    vi.mocked(project.scripts).mockRejectedValueOnce(new Error('JSON 格式错误'));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('JSON 格式错误');
    vi.mocked(project.scripts).mockResolvedValueOnce({ ...info, packageFound: false, scripts: [] });
    await click('刷新项目脚本');
    expect(host.textContent).toContain('未找到 package.json');
    vi.mocked(project.scripts).mockResolvedValueOnce({ ...info, scripts: [] });
    await click('刷新项目脚本');
    expect(host.textContent).toContain('没有配置运行脚本');
  });

  it('异常脚本名不会送入终端执行', async () => {
    vi.mocked(project.scripts).mockResolvedValue({ ...info, scripts: [{ name: 'dev&whoami', command: 'vite' }] });
    await render();
    expect(button('运行脚本 dev&whoami').disabled).toBe(true);
    await click('运行脚本 dev&whoami');
    expect(project.runScript).not.toHaveBeenCalled();
  });

  it('首页以独立面板展示，支持键盘移动和布局中的显示隐藏', async () => {
    localStorage.setItem('esaygit.recent.v1', JSON.stringify([{ name: alpha.name, path: alpha.path }]));
    vi.spyOn(git, 'open').mockResolvedValue(alpha);
    await act(async () => root.render(<App onReady={ready} />));
    await click('打开仓库 Alpha');
    const panel = host.querySelector('[data-eg-panel="scripts"]')!;
    expect(panel.textContent).toContain('项目脚本');
    expect(panel.querySelector('[aria-label="运行脚本 dev"]')).not.toBeNull();
    await act(async () => button('移动项目脚本面板').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })));
    const saved = JSON.parse(localStorage.getItem('esaygit.workspace-layout.v1')!);
    expect(saved.order.indexOf('scripts')).toBeLessThan(saved.order.indexOf('stash'));
    await click('自定义布局');
    const option = Array.from(host.querySelectorAll('label')).find(label => label.textContent?.includes('项目脚本'))!;
    await act(async () => option.querySelector<HTMLInputElement>('input')!.click());
    expect(host.querySelector('[data-eg-panel="scripts"]')).toBeNull();
  });
});
