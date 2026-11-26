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
function repoBar() { return host.querySelector<HTMLElement>('[aria-label="仓库列表"]')!; }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  vi.mocked(git.stashes).mockResolvedValue([]);
  vi.mocked(git.diff).mockResolvedValue('');
  vi.mocked(git.open).mockImplementation(async path => ({ ...emptyRepository(), ...projects.find(project => project.path === path)!, branch: 'main' }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('顶部横向项目列表', () => {
  it('位于内容页上方而非左侧工具栏，并直接展示完整项目名称', async () => {
    await render(5);
    expect(host.querySelector('.sidebar [aria-label="仓库列表"]')).toBeNull();
    expect(repoBar().closest('.workspace-pane')).not.toBeNull();
    expect(repoBar().nextElementSibling).toBe(host.querySelector('.main-scroll'));
    const items = repoBar().querySelectorAll('.repository-item');
    expect(items).toHaveLength(5);
    expect(repoBar().textContent).toContain('Project 1');
    expect(repoBar().textContent).toContain('Project 5');
  });

  it('可横向切换全部项目，选中状态同步且保留超过 8 个项目记录', async () => {
    await render();
    expect(repoBar().querySelectorAll('.repository-item')).toHaveLength(9);
    await click('打开仓库 Project 9');
    expect(git.open).toHaveBeenCalledWith(projects[8].path);
    expect(button('打开仓库 Project 9').classList.contains('selected')).toBe(true);
    expect(button('打开仓库 Project 9').getAttribute('aria-current')).toBe('page');
    expect(host.querySelector('[aria-label="当前项目与分支"]')?.textContent).toContain('Project 9');
    const saved = JSON.parse(localStorage.getItem('esaygit.recent.v1')!);
    expect(saved).toHaveLength(9);
    expect(saved).toEqual(expect.arrayContaining([projects[0], projects[8]]));
  });

  it('支持鼠标滚轮转换为横向滚动，且在溢出时提供左右微调按钮', async () => {
    await render();
    const scroller = repoBar().querySelector<HTMLDivElement>('.repository-list-scroll')!;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 900 });
    scroller.scrollLeft = 0;

    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(button('向左滚动仓库列表').disabled).toBe(true);
    expect(button('向右滚动仓库列表').disabled).toBe(false);

    const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    await act(async () => {
      scroller.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(scroller.scrollLeft).toBe(120);
    expect(button('向左滚动仓库列表').disabled).toBe(false);
  });

  it('选中超出可视区域的项目时自动将其完整滚入可视区域', async () => {
    await render();
    const scroller = repoBar().querySelector<HTMLDivElement>('.repository-list-scroll')!;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 1200 });
    scroller.scrollLeft = 0;
    const entries = Array.from(repoBar().querySelectorAll<HTMLElement>('.repository-entry'));
    entries.forEach((entry, index) => {
      Object.defineProperty(entry, 'offsetLeft', { configurable: true, value: index * 120 });
      Object.defineProperty(entry, 'offsetWidth', { configurable: true, value: 112 });
    });

    await click('打开仓库 Project 9');
    expect(entries[8].classList.contains('selected')).toBe(true);
    expect(scroller.scrollLeft).toBeGreaterThanOrEqual(8 * 120 + 112 - 300);

    await click('打开仓库 Project 1');
    expect(entries[0].classList.contains('selected')).toBe(true);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('切换项目期间禁用项目按钮，完成后恢复', async () => {
    let finish!: (value: ReturnType<typeof emptyRepository>) => void;
    vi.mocked(git.open).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render();
    await click('打开仓库 Project 1');
    expect(Array.from(repoBar().querySelectorAll<HTMLButtonElement>('.repository-item')).every(node => node.disabled)).toBe(true);
    await act(async () => finish({ ...emptyRepository(), ...projects[0], branch: 'main' }));
    expect(button('打开仓库 Project 1').disabled).toBe(false);
  });
});
