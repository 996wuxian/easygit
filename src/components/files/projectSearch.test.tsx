// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { project, type FileSearchBatch, type FileSearchMatch } from '../../services/project';
import { FileTree } from './FileTree';

let host: HTMLDivElement;
let root: Root;
const opened = vi.fn();
const match = (index = 0): FileSearchMatch => ({ path: `src/file-${index}.ts`, line: index + 1, column: 7, length: 6, preview: 'const needle = 1;', matchStart: 6, matchLength: 6 });
const batch = (results: FileSearchMatch[], complete = true, scannedFiles = 100): FileSearchBatch => ({ results, complete, scannedFiles, totalFiles: 1000, skippedFiles: 0, limitedFiles: 0, truncated: false });
const advance = async (milliseconds: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); };
function button(label: string) {
  const element = Array.from(host.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === label || button.textContent === label);
  if (!element) throw new Error(`找不到按钮：${label}`);
  return element;
}
const click = async (label: string) => { await act(async () => button(label).click()); };
async function type(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索项目文件"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })));
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); opened.mockReset();
  vi.spyOn(project, 'files').mockResolvedValue({ entries: [], truncated: false });
  vi.spyOn(project, 'cancelSearch').mockResolvedValue(undefined);
  vi.spyOn(project, 'search').mockResolvedValue(batch([match()]));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<FileTree repository="X:/QA/project" files={[]} refreshKey="one" onOpen={opened} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('项目文件名与内容搜索', () => {
  it('在原搜索框切换内容模式，防抖后展示片段并将行列传给编辑器', async () => {
    await click('文件内容'); await type('needle');
    expect(project.search).not.toHaveBeenCalled();
    await advance(300);
    expect(project.search).toHaveBeenCalledWith(expect.objectContaining({ path: 'X:/QA/project', mode: 'content', query: 'needle', continuation: false }));
    expect(host.querySelector('mark')?.textContent).toBe('needle');
    await click('打开匹配 src/file-0.ts 第 1 行');
    expect(opened).toHaveBeenCalledWith('src/file-0.ts', { line: 1, column: 7, length: 6 });
    expect(host.textContent).toContain('搜索已保存的 UTF-8 文件');
  });

  it('输入变化立即取消旧后台任务，旧响应迟到也不会替换新结果', async () => {
    let finish!: (result: FileSearchBatch) => void;
    vi.mocked(project.search).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(batch([{ ...match(), path: 'new.ts' }]));
    await type('old'); await advance(300);
    const request = vi.mocked(project.search).mock.calls[0][0];
    await type('new');
    expect(project.cancelSearch).toHaveBeenCalledWith(request.client, request.generation);
    await advance(300);
    expect(host.textContent).toContain('new.ts');
    await act(async () => finish(batch([{ ...match(), path: 'obsolete.ts' }])));
    expect(host.textContent).not.toContain('obsolete.ts');
    await type('');
    expect(host.querySelector('[aria-label="文件名搜索结果"]')).toBeNull();
  });

  it('稀疏匹配会分批更新进度，继续请求时复用当前会话', async () => {
    vi.mocked(project.search).mockResolvedValueOnce(batch([], false, 50)).mockResolvedValueOnce(batch([match()], true, 1000));
    await click('文件内容'); await type('needle'); await advance(300);
    expect(host.textContent).toContain('已检查 50 / 1000');
    await advance(16);
    expect(project.search).toHaveBeenCalledTimes(2);
    const requests = vi.mocked(project.search).mock.calls.map(call => call[0]);
    expect(requests[1]).toEqual({ ...requests[0], continuation: true });
    expect(host.textContent).toContain('已检查 1000 / 1000');
  });

  it('1000 条结果只渲染可见窗口，键盘可跳到最后一条', async () => {
    let offset = 0;
    vi.mocked(project.search).mockImplementation(async () => {
      const results = Array.from({ length: 50 }, (_, index) => match(offset + index));
      offset += 50;
      return batch(results, offset === 1000, offset);
    });
    await click('文件内容'); await type('needle'); await advance(300);
    for (let page = 1; page < 20; page++) await click('继续搜索，加载更多');
    expect(host.textContent).toContain('1000 条内容匹配');
    expect(host.querySelectorAll('.file-search-result').length).toBeLessThan(20);
    const first = host.querySelector<HTMLButtonElement>('.file-search-result')!;
    await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('打开匹配 src/file-999.ts 第 1000 行');
    expect(host.querySelectorAll('.file-search-result').length).toBeLessThan(20);
  });

  it('未完成搜索在卸载时取消，文件名模式仍使用相同的可取消接口', async () => {
    vi.mocked(project.search).mockReturnValue(new Promise(() => {}));
    await type('file'); await advance(300);
    const request = vi.mocked(project.search).mock.calls[0][0];
    expect(request.mode).toBe('name');
    await act(async () => root.render(null));
    expect(project.cancelSearch).toHaveBeenCalledWith(request.client, request.generation);
  });
});
