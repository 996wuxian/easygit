// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceGrid } from './WorkspaceGrid';
import { usePanelLayout } from './usePanelLayout';
import { PANEL_LAYOUT_STORAGE_KEY } from './model';

let host: HTMLDivElement; let root: Root;
let renders = 0;
let frames: Map<number, FrameRequestCallback>;
function Content() { renders++; const [text, setText] = useState(''); return <input aria-label="面板草稿" value={text} onChange={event => setText(event.target.value)} />; }
function edge(axis: 'width' | 'height' = 'width') { return host.querySelector<HTMLElement>(`[aria-label="调整工作区变更面板${axis === 'width' ? '宽度' : '高度'}"]`)!; }
const pointer = (type: string, x: number, y: number, pointerId = 1) => new PointerEvent(type, { bubbles: true, pointerId, isPrimary: true, button: 0, clientX: x, clientY: y });
async function flushFrame() { await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }); }
function prepareResize(axis: 'width' | 'height' = 'width') {
  const handle = edge(axis);
  const grid = host.querySelector<HTMLElement>('.eg-workspace-grid')!;
  grid.style.columnGap = '16px';
  vi.spyOn(grid, 'clientWidth', 'get').mockReturnValue(1376);
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn(() => false);
  return handle;
}
function measure(id: string, left: number, top: number, width: number, height: number) {
  const node = host.querySelector<HTMLElement>(`[data-eg-panel="${id}"]`)!;
  return vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height } as DOMRect);
}
function Harness() {
  const panels = usePanelLayout();
  return <WorkspaceGrid layout={panels.layout} onMove={panels.movePanel} onResize={panels.resizePanel} renderPanel={() => <Content />} />;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  frames = new Map(); let frame = 0; renders = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('键盘调整面板尺寸并持久化，Home 恢复默认', async () => {
  const resize = edge();
  expect(resize.tagName).toBe('DIV');
  expect(host.querySelector('.eg-panel-resize')).toBeNull();
  await act(async () => resize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await act(async () => edge('height').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const layout = JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!);
  expect(layout.sizes.changes.span).toBe(5);
  expect(layout.sizes.changes.height).toBeGreaterThanOrEqual(180);
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  expect(host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!.style.getPropertyValue('--eg-panel-span')).toBe('5');
  await act(async () => edge().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(host.querySelector('[data-eg-panel="changes"]')!.classList.contains('eg-panel--sized')).toBe(false);
});
it('最大化与 Esc 还原保留同一个面板和草稿，已有弹窗优先处理 Esc', async () => {
  const node = host.querySelector<HTMLInputElement>('[data-eg-panel="changes"] input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, 'unsaved draft');
  await act(async () => node.dispatchEvent(new Event('input', { bubbles: true })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="最大化工作区变更面板"]')!.click());
  expect(host.querySelector('.eg-panel--maximized input')).toBe(node);
  expect(node.value).toBe('unsaved draft');
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('.eg-panel--maximized')).not.toBeNull();
  dialog.remove();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('.eg-panel--maximized')).toBeNull(); expect(node.value).toBe('unsaved draft');
});
it('边框宽度连续变化，每帧合并事件且拖动期间不重渲染内容或写入存储', async () => {
  const resize = prepareResize();
  const panel = host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!;
  const saved = localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
  const renderCount = renders;
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 100, 100)));
  for (let x = 101; x <= 158; x++) await act(async () => resize.dispatchEvent(pointer('pointermove', x, 160)));
  expect(frames.size).toBe(1);
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('4');
  await flushFrame();
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('4.5');
  expect(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)).toBe(saved);
  expect(renders).toBe(renderCount);
  await act(async () => resize.dispatchEvent(pointer('pointerup', 158, 160)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes.changes).toEqual({ span: 4.5, height: 320 });
  expect(document.body.classList.contains('eg-is-panel-resizing')).toBe(false);
});
it('同一行的相邻面板宽度联动并保留小数，不越过最小尺寸', async () => {
  const resize = prepareResize();
  const primary = host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!;
  const neighbor = host.querySelector<HTMLElement>('[data-eg-panel="diff"]')!;
  vi.spyOn(primary, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 448, top: 0, width: 448 } as DOMRect);
  vi.spyOn(neighbor, 'getBoundingClientRect').mockReturnValue({ left: 464, right: 1376, top: 0, width: 912 } as DOMRect);
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 448, 100)));
  await act(async () => resize.dispatchEvent(pointer('pointermove', 506, 100)));
  await flushFrame();
  expect(primary.style.getPropertyValue('--eg-panel-span')).toBe('4.5');
  expect(neighbor.style.getPropertyValue('--eg-panel-span')).toBe('7.5');
  await act(async () => resize.dispatchEvent(pointer('pointerup', 506, 100)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes).toEqual({ changes: { span: 4.5, height: 320 }, diff: { span: 7.5, height: 320 } });
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 506, 100)));
  await act(async () => resize.dispatchEvent(pointer('pointermove', 3000, 100)));
  await flushFrame();
  expect(primary.style.getPropertyValue('--eg-panel-span')).toBe('9');
  expect(neighbor.style.getPropertyValue('--eg-panel-span')).toBe('3');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(primary.style.getPropertyValue('--eg-panel-span')).toBe('4.5');
  expect(neighbor.style.getPropertyValue('--eg-panel-span')).toBe('7.5');
  expect(frames.size).toBe(0);
});
it('底边只改变高度，松手前的最后位置会保存；取消和失焦恢复原尺寸', async () => {
  const resize = prepareResize('height');
  const panel = host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!;
  const content = panel.querySelector<HTMLElement>('.eg-panel-content')!;
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 100, 100)));
  await act(async () => resize.dispatchEvent(pointer('pointermove', 500, 160)));
  await flushFrame();
  expect(content.style.height).toBe('380px');
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('4');
  await act(async () => resize.dispatchEvent(pointer('pointerup', 500, 170)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes.changes).toEqual({ span: 4, height: 390 });
  const saved = localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
  for (const abort of ['pointercancel', 'lostpointercapture', 'blur']) {
    await act(async () => resize.dispatchEvent(pointer('pointerdown', 100, 100)));
    await act(async () => resize.dispatchEvent(pointer('pointermove', 100, 200)));
    await flushFrame();
    await act(async () => abort === 'blur' ? window.dispatchEvent(new Event('blur')) : resize.dispatchEvent(pointer(abort, 100, 200)));
    expect(content.style.height).toBe('390px');
    expect(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)).toBe(saved);
    expect(document.body.classList.contains('eg-is-panel-resizing')).toBe(false);
  }
});
it('移动预览按帧更新，经过相同目标不重渲染面板内容', async () => {
  const handle = host.querySelector<HTMLElement>('[aria-label="移动工作区变更面板"]')!;
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn(() => false);
  const target = host.querySelector<HTMLElement>('[data-eg-panel="diff"]')!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  const renderCount = renders;
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 100, 100)));
  await act(async () => handle.dispatchEvent(pointer('pointermove', 200, 100)));
  await flushFrame();
  expect(renders).toBe(renderCount);
  for (let x = 201; x <= 230; x++) await act(async () => handle.dispatchEvent(pointer('pointermove', x, 100)));
  expect(frames.size).toBe(1);
  await flushFrame();
  expect(host.querySelector<HTMLElement>('.eg-panel-drag-preview')?.style.transform).toBe('translate3d(246px, 116px, 0)');
  expect(renders).toBe(renderCount);
  await act(async () => handle.dispatchEvent(pointer('pointerup', 230, 100)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).order.slice(0, 2)).toEqual(['diff', 'changes']);
});
it('宽度接近上下方面板时吸附并显示跨行参考线，拉远解除后可再次吸附', async () => {
  const resize = prepareResize();
  const grid = host.querySelector<HTMLElement>('.eg-workspace-grid')!;
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, right: 1476, bottom: 1350, width: 1376, height: 1300 } as DOMRect);
  measure('changes', 100, 450, 448, 400);
  measure('diff', 564, 450, 912, 400);
  const above = measure('branches', 100, 50, 564, 200);
  measure('commits', 100, 950, 564, 200);
  const panel = host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!;
  const neighbor = host.querySelector<HTMLElement>('[data-eg-panel="diff"]')!;
  const guide = host.querySelector<HTMLDivElement>('.eg-panel-alignment-guide')!;
  const renderCount = renders;
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 548, 600)));
  const measurements = above.mock.calls.length;
  await act(async () => resize.dispatchEvent(pointer('pointermove', 659, 600)));
  await flushFrame();
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('5');
  expect(neighbor.style.getPropertyValue('--eg-panel-span')).toBe('7');
  expect(panel.dataset.egResizeSnapped).toBe('true');
  expect(guide.hidden).toBe(false);
  expect(guide.dataset.axis).toBe('width');
  expect(guide.style.left).toBe('564px');
  expect(guide.style.top).toBe('0px');
  expect(guide.style.height).toBe('1100px');
  await act(async () => resize.dispatchEvent(pointer('pointermove', 675, 600)));
  await flushFrame();
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('5');
  await act(async () => resize.dispatchEvent(pointer('pointermove', 680, 600)));
  await flushFrame();
  expect(guide.hidden).toBe(true);
  expect(panel.dataset.egResizeSnapped).toBeUndefined();
  expect(Number(panel.style.getPropertyValue('--eg-panel-span'))).toBeGreaterThan(5);
  await act(async () => resize.dispatchEvent(pointer('pointermove', 661, 600)));
  await flushFrame();
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('5');
  expect(guide.hidden).toBe(false);
  expect(above).toHaveBeenCalledTimes(measurements);
  expect(renders).toBe(renderCount);
  await act(async () => resize.dispatchEvent(pointer('pointerup', 661, 600)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes.changes.span).toBe(5);
  expect(guide.hidden).toBe(true);
  expect(panel.dataset.egResizeSnapped).toBeUndefined();
});
it('底边与同排面板对齐时吸附，取消隐藏参考线且松手保存对齐高度', async () => {
  const resize = prepareResize('height');
  measure('changes', 0, 400, 448, 400);
  measure('diff', 464, 400, 912, 500);
  const panel = host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!;
  const content = panel.querySelector<HTMLElement>('.eg-panel-content')!;
  const guide = host.querySelector<HTMLDivElement>('.eg-panel-alignment-guide')!;
  for (const commit of [false, true]) {
    await act(async () => resize.dispatchEvent(pointer('pointerdown', 200, 800)));
    await act(async () => resize.dispatchEvent(pointer('pointermove', 200, 895)));
    await flushFrame();
    expect(content.style.height).toBe('420px');
    expect(guide.hidden).toBe(false);
    expect(guide.dataset.axis).toBe('height');
    expect(guide.style.top).toBe('900px');
    expect(guide.style.width).toBe('1376px');
    await act(async () => commit ? resize.dispatchEvent(pointer('pointerup', 200, 895)) : window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(guide.hidden).toBe(true);
    expect(panel.dataset.egResizeSnapped).toBeUndefined();
    if (!commit) {
      expect(content.style.height).toBe('');
      expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes).toBeUndefined();
    }
  }
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes.changes.height).toBe(420);
});
it('不可达到的对齐边缘不会突破相邻面板最小宽度或显示错误参考线', async () => {
  const resize = prepareResize();
  measure('changes', 0, 400, 448, 400);
  measure('diff', 464, 400, 912, 400);
  measure('branches', 0, 0, 1376, 200);
  const panel = host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!;
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 448, 600)));
  await act(async () => resize.dispatchEvent(pointer('pointermove', 1372, 600)));
  await flushFrame();
  expect(panel.style.getPropertyValue('--eg-panel-span')).toBe('9');
  expect(host.querySelector<HTMLDivElement>('.eg-panel-alignment-guide')!.hidden).toBe(true);
  expect(panel.dataset.egResizeSnapped).toBeUndefined();
  await act(async () => resize.dispatchEvent(pointer('pointerup', 1372, 600)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes.diff.span).toBe(3);
});
it('行末面板不能拖出工作区或吸附到范围外的边缘而突然换行', async () => {
  const resize = prepareResize();
  for (let i = 0; i < 2; i++) await act(async () => resize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  const grid = host.querySelector<HTMLElement>('.eg-workspace-grid')!;
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1376, top: 0, width: 1376, height: 1200 } as DOMRect);
  measure('changes', 696, 400, 680, 400);
  measure('branches', 0, 0, 1470, 200);
  await act(async () => resize.dispatchEvent(pointer('pointerdown', 1376, 600)));
  await act(async () => resize.dispatchEvent(pointer('pointermove', 1465, 600)));
  await flushFrame();
  expect(host.querySelector<HTMLElement>('[data-eg-panel="changes"]')!.style.getPropertyValue('--eg-panel-span')).toBe('6');
  expect(host.querySelector<HTMLDivElement>('.eg-panel-alignment-guide')!.hidden).toBe(true);
  await act(async () => resize.dispatchEvent(pointer('pointerup', 1465, 600)));
  expect(JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)!).sizes.changes.span).toBe(6);
});
