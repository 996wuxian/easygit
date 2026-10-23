// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WindowControls } from './WindowControls';

vi.mock('../services/git', () => ({ isDesktop: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
const windowApi = {
  minimize: vi.fn().mockResolvedValue(undefined), hide: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined), toggleMaximize: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false), onResized: vi.fn().mockResolvedValue(() => {}),
};
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(getCurrentWindow).mockReturnValue(windowApi as unknown as ReturnType<typeof getCurrentWindow>);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<WindowControls />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('标题栏窗口操作', () => {
  it('最小化调用原生 minimize，保留任务栏窗口，不调用 hide 或 close', async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="最小化到任务栏"]')!.click());
    expect(windowApi.minimize).toHaveBeenCalledOnce();
    expect(windowApi.hide).not.toHaveBeenCalled(); expect(windowApi.close).not.toHaveBeenCalled();
  });
  it('关闭交给原生 close 请求，由托盘处理器隐藏窗口', async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭到系统托盘"]')!.click());
    expect(windowApi.close).toHaveBeenCalledOnce(); expect(windowApi.minimize).not.toHaveBeenCalled();
  });
});
