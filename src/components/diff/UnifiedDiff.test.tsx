// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedDiff } from './UnifiedDiff';

let host: HTMLDivElement;
let root: Root;
let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null }>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    private record: { callback: IntersectionObserverCallback; target: Element | null };
    constructor(callback: IntersectionObserverCallback) { this.record = { callback, target: null }; observers.push(this.record); }
    observe(target: Element) { this.record.target = target; }
    disconnect() {}
  });
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

describe('large unified differences', () => {
  it('uses a selectable raw preview above the line limit and resets explicit full view for another file', async () => {
    const diff = `@@ -1,10001 +1,10001 @@\n${' unchanged\n'.repeat(10001)}`;
    await act(async () => root.render(<UnifiedDiff key="file-a" diff={diff} onDiscardBlock={() => {}} />));
    const preview = host.querySelector('pre[aria-label="完整差异文本"]');
    expect(preview?.textContent).toBe(diff);
    expect(host.textContent).toContain('区块撤回未启用');
    expect(host.querySelectorAll('.code-line')).toHaveLength(0);

    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === '加载完整视图')!;
    await act(async () => button.click());
    expect(host.querySelector('.code-line')).not.toBeNull();

    const updated = `${diff} more\n`;
    await act(async () => root.render(<UnifiedDiff key="file-a" diff={updated} onDiscardBlock={() => {}} />));
    expect(host.querySelector('.code-line')).not.toBeNull();
    expect(host.querySelector('pre[aria-label="完整差异文本"]')).toBeNull();

    await act(async () => root.render(<UnifiedDiff key="file-b" diff={updated} onDiscardBlock={() => {}} />));
    expect(host.querySelector('pre[aria-label="完整差异文本"]')?.textContent).toBe(updated);
  }, 20_000);

  it('keeps offscreen text and block actions available, then highlights when viewed', async () => {
    const lines = Array.from({ length: 250 }, (_, index) => ` unchanged ${index + 1}`);
    const diff = `@@ -1,251 +1,251 @@\n${lines.join('\n')}\n-old\n+const newValue = 1\n`;
    const discard = vi.fn();
    await act(async () => root.render(<UnifiedDiff diff={diff} onDiscardBlock={discard} />));

    const finalLine = host.querySelector('.code-line.added')!;
    expect(finalLine.querySelector('code')?.textContent).toBe('const newValue = 1');
    expect(finalLine.querySelector('.syntax-keyword')).toBeNull();
    expect(finalLine.querySelectorAll('.line-number')[1].textContent).toBe('251');
    const button = host.querySelector<HTMLButtonElement>('[aria-label="撤回变更块 1"]')!;
    await act(async () => button.click());
    expect(discard).toHaveBeenCalledWith(expect.objectContaining({ removed: ['old'], added: ['const newValue = 1'] }));

    const observer = observers.find(item => item.target?.contains(finalLine))!;
    await act(async () => observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(finalLine.querySelector('.syntax-keyword')?.textContent).toBe('const');
    expect(finalLine.querySelector('code')?.textContent).toBe('const newValue = 1');
  });

  it('does not replace text while the user has an active selection', async () => {
    const diff = `@@ -1,250 +1,250 @@\n${Array.from({ length: 250 }, () => ' const selected = 1').join('\n')}\n`;
    await act(async () => root.render(<UnifiedDiff diff={diff} />));
    const observer = observers[0];
    const code = observer.target!.querySelector('code')!;
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);
    await act(async () => observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(code.querySelector('.syntax-keyword')).toBeNull();
    selection.mockReturnValue({ isCollapsed: true } as Selection);
    await act(async () => document.dispatchEvent(new Event('selectionchange')));
    expect(code.querySelector('.syntax-keyword')?.textContent).toBe('const');
  });
});
