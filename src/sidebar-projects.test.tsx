// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { emptyRepository, git } from './services/git';

vi.mock('./services/git', async importOriginal => ({
  ...await importOriginal<typeof import('./services/git')>(),
  isDesktop: () => false,
  git: { stashes: vi.fn(), open: vi.fn(), diff: vi.fn(), fetch: vi.fn() },
}));
vi.mock('./components/WindowControls', () => ({ WindowControls: () => null }));

const projects = Array.from({ length: 9 }, (_, index) => ({ name: `Project ${index + 1}`, path: `X:/Projects/project-${index + 1}` }));
let host: HTMLDivElement; let root: Root;
function button(label: string, scope: ParentNode = host) {
  const node = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function render(count = projects.length) {
  localStorage.setItem('esaygit.recent.v1', JSON.stringify(projects.slice(0, count)));
  await act(async () => root.render(<App onReady={() => {}} />));
}
function drawer() { return host.querySelector<HTMLElement>('[aria-label="项目展开区域"]'); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  vi.mocked(git.stashes).mockResolvedValue([]);
  vi.mocked(git.diff).mockResolvedValue('');
  vi.mocked(git.open).mockImplementation(async path => ({ ...emptyRepository(), ...projects.find(project => project.path === path)!, branch: 'main' }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('侧栏项目展开区域', () => {
  it('少于 6 个项目时不显示展开按钮', async () => {
    await render(5);
    expect(host.querySelector('[aria-label="展开项目列表"]')).toBeNull();
    expect(host.querySelectorAll('.repository-item')).toHaveLength(5);
    expect(drawer()).toBeNull();
  });
  it('恰好 6 个项目时也显示入口并可展开全部项目', async () => {
    await render(6); await click('展开项目列表');
    expect(drawer()?.querySelectorAll('.repository-expanded-item')).toHaveLength(6);
    expect(button('收起项目列表').getAttribute('aria-expanded')).toBe('true');
  });
  it('超过 6 个时在列表边缘提供展开入口，展开区归属同一侧栏并显示全部名称', async () => {
    await render();
    const trigger = button('展开项目列表');
    expect(trigger.closest('.repository-list-area')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click('展开项目列表');
    expect(drawer()?.parentElement).toBe(host.querySelector('.sidebar'));
    expect(drawer()?.querySelectorAll('.repository-expanded-item')).toHaveLength(9);
    expect(drawer()?.textContent).toContain('Project 9');
    expect(button('收起项目列表').getAttribute('aria-controls')).toBe(drawer()?.id);
    await click('关闭项目展开区域');
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('可从展开区切换项目，选中状态同步且打开项目后保留超过 8 个项目记录', async () => {
    await render(); await click('展开项目列表');
    await click('切换到项目 Project 9');
    expect(git.open).toHaveBeenCalledWith(projects[8].path);
    expect(button('切换到项目 Project 9').getAttribute('aria-current')).toBe('page');
    expect(button('打开仓库 Project 9').classList.contains('selected')).toBe(true);
    expect(host.querySelector('[aria-label="当前项目与分支"]')?.textContent).toContain('Project 9');
    const saved = JSON.parse(localStorage.getItem('esaygit.recent.v1')!);
    expect(saved).toHaveLength(9);
    expect(saved).toEqual(expect.arrayContaining([projects[0], projects[8]]));
  });
  it('支持 Escape、外部点击和重复点击按钮收起', async () => {
    await render(); await click('展开项目列表');
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(button('展开项目列表'));
    await click('展开项目列表');
    await act(async () => host.querySelector('.main-scroll')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(drawer()).toBeNull();
    await click('展开项目列表'); await click('收起项目列表');
    expect(drawer()).toBeNull();
  });
  it('减少到 6 个时保留展开入口，低于 6 个时自动收起', async () => {
    await render(7); await click('展开项目列表');
    await click('移除工作区 Project 7'); await click('确认移除');
    expect(host.querySelectorAll('.repository-item')).toHaveLength(6);
    expect(host.querySelector('.repository-expand-toggle')).not.toBeNull();
    await click('移除工作区 Project 6'); await click('确认移除');
    expect(host.querySelectorAll('.repository-item')).toHaveLength(5);
    expect(drawer()).toBeNull();
    expect(host.querySelector('.repository-expand-toggle')).toBeNull();
  });
  it('切换项目期间禁用展开区项目行，完成后恢复', async () => {
    let finish!: (value: ReturnType<typeof emptyRepository>) => void;
    vi.mocked(git.open).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); await click('展开项目列表'); await click('切换到项目 Project 1');
    expect(Array.from(drawer()!.querySelectorAll<HTMLButtonElement>('.repository-expanded-item')).every(node => node.disabled)).toBe(true);
    await act(async () => finish({ ...emptyRepository(), ...projects[0], branch: 'main' }));
    expect(button('切换到项目 Project 1').disabled).toBe(false);
  });
});
