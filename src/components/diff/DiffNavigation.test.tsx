// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedDiff } from './UnifiedDiff';
import { SplitDiff } from './SplitDiff';
import { DiffFileNavigation, findTextMatches } from './DiffNavigation';

let host: HTMLDivElement; let root: Root;
const diff = '@@ -1,3 +1,3 @@\n-old needle\n+new needle\n context\n-old2\n+new2\n';
function button(label: string) { return host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!; }
async function search(value: string) {
  const node = host.querySelector<HTMLInputElement>('[aria-label="在差异中搜索"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
  await act(async () => node.dispatchEvent(new Event('input', { bubbles: true })));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('差异导航与搜索', () => {
  it('统一差异中导航连续变更块，并搜索大小写不敏感的字面文本', async () => {
    await act(async () => root.render(<UnifiedDiff diff={diff} interactive />));
    await act(async () => button('下一个变更').click());
    expect(host.querySelector('.diff-change-current code')?.textContent).toBe('old needle');
    await act(async () => button('下一个变更').click());
    expect(host.querySelector('.diff-change-current code')?.textContent).toBe('old2');
    await act(async () => button('上一个变更').click());
    expect(host.querySelector('.diff-change-current code')?.textContent).toBe('old needle');
    await search('NEEDLE');
    expect(host.querySelectorAll('mark')).toHaveLength(2);
    expect(host.querySelector('[aria-label="搜索匹配位置"]')?.textContent).toBe('1/2');
    await act(async () => button('下一个匹配').click());
    expect(host.querySelector('mark.current')?.closest('.code-line')?.textContent).toContain('new needle');
    await search('does not exist');
    expect(button('下一个匹配').disabled).toBe(true);
    expect(host.querySelector('[aria-label="搜索匹配位置"]')?.textContent).toBe('0/0');
    expect(findTextMatches(['a.b aXb'], 'a.b')).toEqual([{ line: 0, start: 0, end: 3 }]);
    expect(findTextMatches(['İ x'], 'x')).toEqual([{ line: 0, start: 2, end: 3 }]);
  });
  it('原始大差异仍可全文搜索，加载完整视图后保留搜索', async () => {
    const large = '@@ -0,0 +1,10020 @@\n' + Array.from({ length: 10020 }, (_, i) => `+line ${i}${i === 10019 ? ' needle' : ''}`).join('\n');
    await act(async () => root.render(<UnifiedDiff diff={large} interactive />));
    await search('needle');
    expect(host.querySelector('.large-diff-raw mark')?.textContent).toBe('needle');
    await act(async () => Array.from(host.querySelectorAll('button')).find(node => node.textContent === '加载完整视图')!.click());
    expect(host.querySelector('.code-lines mark')?.textContent).toBe('needle');
  });
  it('统一差异的当前标记跨渲染分块连续覆盖整个变更，仅首尾带圆角', async () => {
    const context = Array.from({ length: 98 }, (_, i) => ` context ${i}`).join('\n');
    const multiline = `@@ -1,100 +1,104 @@\n${context}\n-old\n+new one\n+new two\n+new three\n tail\n+last\n\\ No newline at end of file\n`;
    await act(async () => root.render(<UnifiedDiff diff={multiline} interactive />));
    await act(async () => button('下一个变更').click());
    const marked = Array.from(host.querySelectorAll('.diff-change-current'));
    expect(marked.map(row => row.querySelector('code')?.textContent)).toEqual(['old', 'new one', 'new two', 'new three']);
    expect(marked[0].parentElement).not.toBe(marked[1].parentElement);
    expect(Array.from(host.querySelectorAll('.diff-change-start'))).toEqual([marked[0]]);
    expect(Array.from(host.querySelectorAll('.diff-change-end'))).toEqual([marked[3]]);
    await act(async () => button('下一个变更').click());
    expect(Array.from(host.querySelectorAll('.diff-change-current code')).map(code => code.textContent)).toEqual(['last', '\\ No newline at end of file']);
    expect(host.querySelector('.diff-change-start code')?.textContent).toBe('last');
    expect(host.querySelector('.diff-change-end code')?.textContent).toBe('\\ No newline at end of file');
    expect(marked.every(row => !row.classList.contains('diff-change-current'))).toBe(true);
  });
  it('左右比对的标记覆盖多行替换及对齐空行，并正确切换到单行变更', async () => {
    const multiline = '@@ -1,3 +1,4 @@\n-old\n+new one\n+new two\n+new three\n context\n-last\n';
    await act(async () => root.render(<SplitDiff comparison={{ originalExists: true, modifiedExists: true, binary: false, unchanged: null, diff: multiline }} originalLabel="HEAD" modifiedLabel="工作区" originalPath="a.ts" modifiedPath="a.ts" interactive />));
    await act(async () => button('下一个变更').click());
    for (const side of host.querySelectorAll('.split-source')) {
      const marked = Array.from(side.querySelectorAll('.diff-change-current'));
      expect(marked).toHaveLength(3);
      expect(Array.from(side.querySelectorAll('.diff-change-start'))).toEqual([marked[0]]);
      expect(Array.from(side.querySelectorAll('.diff-change-end'))).toEqual([marked[2]]);
      expect(side.querySelector('.context.diff-change-current')).toBeNull();
    }
    expect(host.querySelectorAll('.split-source-original .empty.diff-change-current')).toHaveLength(2);
    await act(async () => button('下一个变更').click());
    for (const side of host.querySelectorAll('.split-source')) {
      expect(side.querySelectorAll('.diff-change-current')).toHaveLength(1);
      expect(side.querySelector('.diff-change-current.diff-change-start.diff-change-end')).not.toBeNull();
    }
  });
  it('长变更滚动后保留整块标记，圆角仅出现在实际变更块的首尾', async () => {
    const removed = Array.from({ length: 150 }, (_, i) => `-old ${i}`).join('\n');
    const added = Array.from({ length: 150 }, (_, i) => `+new ${i}`).join('\n');
    const multiline = `@@ -1,151 +1,151 @@\n${removed}\n${added}\n tail\n`;
    await act(async () => root.render(<SplitDiff comparison={{ originalExists: true, modifiedExists: true, binary: false, unchanged: null, diff: multiline }} originalLabel="HEAD" modifiedLabel="工作区" originalPath="a.ts" modifiedPath="a.ts" interactive />));
    await act(async () => button('下一个变更').click());
    expect(host.querySelectorAll('.diff-change-start')).toHaveLength(2);
    expect(host.querySelectorAll('.diff-change-end')).toHaveLength(0);
    expect(host.querySelector('.source-line:not(.diff-change-current)')).toBeNull();
    const scroll = host.querySelector<HTMLElement>('.split-source-scroll')!;
    await act(async () => {
      scroll.scrollTop = 120 * 24;
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    expect(host.querySelectorAll('.diff-change-start')).toHaveLength(0);
    expect(host.querySelectorAll('.diff-change-end')).toHaveLength(2);
    expect(Array.from(host.querySelectorAll('.diff-change-end code')).map(code => code.textContent)).toEqual(['old 149', 'new 149']);
    expect(host.querySelector('.source-line:not(.context):not(.diff-change-current)')).toBeNull();
    expect(host.querySelectorAll('.context.diff-change-current')).toHaveLength(0);
  });
  it('左右比对搜索当前虚拟窗口之外的内容，并同步跳转两侧', async () => {
    const text = Array.from({ length: 1000 }, (_, i) => i === 950 ? 'needle at bottom' : `context ${i}`).join('\n');
    await act(async () => root.render(<SplitDiff comparison={{ originalExists: true, modifiedExists: true, binary: false, unchanged: text, diff: '' }} originalLabel="HEAD" modifiedLabel="工作区" originalPath="a.ts" modifiedPath="a.ts" interactive />));
    expect(host.textContent).not.toContain('needle at bottom');
    await search('needle');
    expect(host.querySelectorAll('mark')).toHaveLength(2);
    const scrolls = host.querySelectorAll<HTMLElement>('.split-source-scroll');
    expect(scrolls[0].scrollTop).toBeGreaterThan(20000);
    expect(scrolls[1].scrollTop).toBe(scrolls[0].scrollTop);
    expect(host.querySelectorAll('.source-line').length).toBeLessThan(150);
  });
  it('文件导航保持边界并将完整路径交给文件选择回调', async () => {
    const select = vi.fn();
    await act(async () => root.render(<DiffFileNavigation files={[{ path: 'a.ts' }, { path: 'nested/b.ts' }]} selected="a.ts" onSelect={select} />));
    expect(button('上一个文件').disabled).toBe(true);
    await act(async () => button('下一个文件').click());
    expect(select).toHaveBeenCalledWith('nested/b.ts');
    await act(async () => root.render(<DiffFileNavigation files={[{ path: 'first-staged.ts' }]} selected="unstaged.ts" onSelect={select} />));
    await act(async () => button('下一个文件').click());
    expect(select).toHaveBeenLastCalledWith('first-staged.ts');
  });
});
