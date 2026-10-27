// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchSearch } from './BranchSearch';

let host: HTMLDivElement;
let root: Root;

function Workspace() {
  const [query, setQuery] = useState('');
  return <main aria-label="工作区">
    <section>
      <header><BranchSearch query={query} onQueryChange={setQuery} /></header>
      <div aria-label="分支列表">{query}</div>
    </section>
  </main>;
}

function input() {
  return document.querySelector<HTMLInputElement>('input[aria-label="筛选分支"]');
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Workspace />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="搜索分支"]')!.click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('分支搜索浮层', () => {
  it('输入、清空时分支列表滚动不会关闭搜索或丢失焦点', async () => {
    const field = input()!;
    const list = host.querySelector('[aria-label="分支列表"]')!;
    for (const value of ['z', 'zi', '']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        // A list can scroll automatically when filtering clamps its scroll position.
        list.dispatchEvent(new Event('scroll'));
      });
      expect(input()).toBe(field);
      expect(field.value).toBe(value);
      expect(document.activeElement).toBe(field);
      expect(list.textContent).toBe(value);
    }
  });

  it('主工作区滚动时保持搜索并重新定位浮层', async () => {
    const field = input()!;
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="搜索分支"]')!;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 100, width: 20, height: 20 }));
    await act(async () => host.querySelector('[aria-label="工作区"]')!.dispatchEvent(new Event('scroll')));
    expect(input()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(document.querySelector<HTMLElement>('.branch-search-popover')!.style.top).toBe('126px');
  });

  it('清除按钮清空筛选并将焦点返回输入框', async () => {
    const field = input()!;
    expect(document.querySelector('[aria-label="清除分支搜索"]')).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'feature');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const clear = document.querySelector<HTMLButtonElement>('[aria-label="清除分支搜索"]')!;
    await act(async () => { clear.focus(); clear.click(); });
    expect(field.value).toBe('');
    expect(host.querySelector('[aria-label="分支列表"]')!.textContent).toBe('');
    expect(document.activeElement).toBe(field);
    expect(document.querySelector('[aria-label="清除分支搜索"]')).toBeNull();
  });

  it('按 Escape 或点击外部仍可关闭浮层', async () => {
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="搜索分支"]')!;
    await act(async () => input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(input()).not.toBeNull();
    await act(async () => host.querySelector('[aria-label="分支列表"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(input()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
