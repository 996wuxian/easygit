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
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('全局提示队列', () => {
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
