// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from './git';
import { flushStorage, STORAGE_ERROR_EVENT } from './storage';
import { initializeWindowLifecycle } from './windowLifecycle';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('./git', () => ({ invokeCommand: vi.fn() }));
vi.mock('./storage', () => ({ flushStorage: vi.fn(), STORAGE_ERROR_EVENT: 'easygit-storage-error' }));

afterEach(() => vi.resetAllMocks());

async function register() {
  let quit!: () => void;
  const unlisten = vi.fn();
  vi.mocked(listen).mockImplementation(async (_event, handler) => { quit = () => handler({ event: 'easygit://quit-requested', id: 1, payload: null }); return unlisten; });
  vi.mocked(invokeCommand).mockResolvedValue(undefined);
  await initializeWindowLifecycle();
  expect(listen).toHaveBeenCalledWith('easygit://quit-requested', expect.any(Function));
  expect(invokeCommand).toHaveBeenCalledWith('register_window_lifecycle');
  return { quit, unlisten };
}

describe('托盘退出', () => {
  it('等待待保存内容写完才退出，重复点击退出只执行一次', async () => {
    const { quit } = await register();
    let finish!: () => void;
    vi.mocked(flushStorage).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    quit();
    quit();
    expect(flushStorage).toHaveBeenCalledTimes(1);
    expect(invokeCommand).not.toHaveBeenCalledWith('exit_app');
    finish();
    await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith('exit_app'));
  });

  it('保存失败时恢复窗口并提示，允许修复问题后再次退出', async () => {
    const { quit } = await register();
    const error = vi.fn();
    window.addEventListener(STORAGE_ERROR_EVENT, error);
    try {
      vi.mocked(flushStorage).mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValue(undefined);
      quit();
      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      expect(invokeCommand).toHaveBeenCalledWith('show_main_window');
      expect(invokeCommand).not.toHaveBeenCalledWith('exit_app');
      expect((error.mock.calls[0][0] as CustomEvent<string>).detail).toContain('磁盘不可写');
      quit();
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith('exit_app'));
    } finally {
      window.removeEventListener(STORAGE_ERROR_EVENT, error);
    }
  });

  it('初始化原生退出桥接失败时清理事件监听', async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    vi.mocked(invokeCommand).mockRejectedValue(new Error('注册失败'));
    await expect(initializeWindowLifecycle()).rejects.toThrow('注册失败');
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
