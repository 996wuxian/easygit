// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastStack } from './components/notifications/ToastStack';
import { useRepository } from './services/useRepository';

let repository: ReturnType<typeof useRepository>;
let root: Root;
let host: HTMLDivElement;
const ready = () => {};
function Harness() {
  repository = useRepository(ready);
  return <><button>返回工作区</button><ToastStack notices={repository.notices} onDismiss={repository.dismissNotice} /></>;
}
// Flush React between animation frames so each toast starts its own clock at
// the same point it would in a browser, rather than batching the entire wait.
const advance = async (milliseconds: number) => {
  for (let remaining = milliseconds; remaining > 0; remaining -= 20) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(20, remaining)); });
  }
};

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('全局提示队列', () => {
  it('首次提示和空队列后的新提示先确定尺寸，再启用宽度过渡并渐显', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('toast-content')) return 0;
      return this.querySelector('.toast-message')?.textContent === '已保存' ? 100 : 270;
    });
    const stack = host.querySelector<HTMLElement>('.toast-stack')!;
    await act(async () => repository.notify('已保存'));
    expect(stack.style.width).toBe('102px');
    expect(stack.classList.contains('toast-stack--ready')).toBe(false);
    expect(host.querySelector('.toast-slot--visible')).toBeNull();
    await advance(80);
    expect(stack.style.width).toBe('102px');
    expect(stack.classList.contains('toast-stack--ready')).toBe(true);
    expect(host.querySelector('.toast-slot--visible')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.toast button')!.click());
    await advance(280);
    expect(repository.notices).toEqual([]);
    expect(stack.classList.contains('toast-stack--ready')).toBe(false);
    await act(async () => repository.notify('读取文件失败，请稍后重试'));
    expect(stack.style.width).toBe('272px');
    expect(stack.classList.contains('toast-stack--ready')).toBe(false);
    await advance(80);
    expect(stack.style.width).toBe('272px');
    expect(stack.classList.contains('toast-stack--ready')).toBe(true);
  });

  it('宽度取当前提示的实际内容尺寸，后排长提示不会撑宽短提示，切换后重新适配', async () => {
    const widths: Record<string, number> = { '已保存': 100, '读取文件失败，请稍后重试': 270, '第三条': 160 };
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('toast-content')) return 0;
      return widths[this.querySelector('.toast-message')!.textContent!] + (this.querySelector('.toast-count') ? 23 : 0);
    });
    await act(async () => { for (const message of Object.keys(widths)) repository.notify(message); });
    const stack = host.querySelector<HTMLElement>('.toast-stack')!;
    const nextMessage = host.querySelectorAll('.toast-message')[1];
    expect(stack.style.width).toBe('125px');
    await advance(80);
    await act(async () => host.querySelector<HTMLButtonElement>('.toast button')!.click());
    expect(stack.style.width).toBe('295px');
    expect(nextMessage.closest('.toast-slot')!.classList.contains('toast-slot--back')).toBe(false);
    expect(nextMessage.closest('.toast-slot')!.classList.contains('toast-slot--visible')).toBe(true);
    await advance(280);
    expect(host.querySelector('.toast-message')).toBe(nextMessage);
    await act(async () => host.querySelector<HTMLButtonElement>('.toast button')!.click());
    expect(stack.style.width).toBe('162px');
    expect(host.querySelector('.toast-count')).toBeNull();
    await advance(280);
    expect(stack.style.width).toBe('162px');
    expect(repository.notices.map(item => item.message)).toEqual(['第三条']);
    await act(async () => host.querySelector<HTMLButtonElement>('.toast button')!.click());
    expect(stack.style.width).toBe('162px');
    await advance(280);
    expect(host.querySelector('.toast')).toBeNull();
  });

  it('展开时适配可见提示的最大宽度及换行高度，收起后回到前排宽度', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('toast-content')) return 0;
      return this.querySelector('.toast-message')?.textContent === '短提示' ? 120 : 300;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('toast') && this.closest('.toast-stack--expanded') && this.textContent?.includes('较长的提示') ? 80 : 36;
    });
    await act(async () => { repository.notify('短提示'); repository.notify('较长的提示'); });
    const stack = host.querySelector<HTMLElement>('.toast-stack')!;
    const toast = host.querySelector<HTMLElement>('.toast')!;
    expect(stack.style.width).toBe('122px');
    expect(stack.style.height).toBe('43px');
    await act(async () => toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(stack.style.width).toBe('302px');
    expect(stack.style.height).toBe('122px');
    await act(async () => toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(stack.style.width).toBe('122px');
    expect(stack.style.height).toBe('43px');
  });

  it('同一批消息全部保留，三张卡片层叠，依次到前景后才开始消失倒计时', async () => {
    await act(async () => { for (const message of ['第一条', '第二条', '第三条', '第四条']) repository.notify(message); });
    expect(repository.notices.map(item => item.message)).toEqual(['第一条', '第二条', '第三条', '第四条']);
    expect(host.querySelectorAll('.toast')).toHaveLength(3);
    expect(host.textContent).not.toContain('第四条');
    await advance(500);
    expect(host.querySelectorAll('.toast-slot--visible')).toHaveLength(3);
    await advance(4600);
    expect(host.querySelectorAll('.toast-slot--exiting')).toHaveLength(1);
    expect(host.textContent).toContain('第一条');
    expect(host.querySelectorAll<HTMLElement>('.toast-slot')[1].style.getPropertyValue('--toast-y')).toBe('0px');
    await advance(900);
    expect(host.textContent).not.toContain('第一条');
    expect(host.textContent).toContain('第四条');
    expect(repository.notices.map(item => item.message)).toEqual(['第二条', '第三条', '第四条']);
    await advance(5400);
    expect(repository.notices.map(item => item.message)).toEqual(['第三条', '第四条']);
    await advance(5400);
    expect(repository.notices.map(item => item.message)).toEqual(['第四条']);
    await advance(5400);
    expect(repository.notices).toEqual([]);
    expect(host.querySelector('.toast')).toBeNull();
  });

  it('手动关闭只移除选中的提示，重复文字也保留各自身份', async () => {
    await act(async () => { repository.notify('相同提示'); repository.notify('相同提示', true); });
    const ids = repository.notices.map(item => item.id);
    expect(new Set(ids).size).toBe(2);
    await advance(500);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('相同提示');
    await act(async () => host.querySelector<HTMLButtonElement>('.toast button')!.click());
    expect(host.querySelectorAll('.toast')).toHaveLength(2);
    await advance(280);
    expect(repository.notices.map(item => item.id)).toEqual([ids[1]]);
    expect(host.querySelectorAll('.toast')).toHaveLength(1);
  });

  it('鼠标悬停和键盘聚焦暂停倒计时，离开后继续剩余时间', async () => {
    await act(async () => repository.notify('请仔细阅读'));
    await advance(1000);
    const toast = host.querySelector<HTMLElement>('.toast')!;
    await act(async () => toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await advance(8000);
    expect(repository.notices).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('.toast button')!.focus());
    await act(async () => toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    await advance(8000);
    expect(repository.notices).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.focus());
    await advance(3500);
    expect(host.querySelector('.toast-slot--visible')).not.toBeNull();
    await advance(1000);
    expect(repository.notices).toEqual([]);
  });
});
