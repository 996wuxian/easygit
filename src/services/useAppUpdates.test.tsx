// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutDialog } from '../components/AboutDialog';
import { useAppUpdates } from './useAppUpdates';
import { updatesApi, type DownloadProgress, type UpdateInfo } from './updates';
import { APP_AUTHOR, APP_DOWNLOAD_URL, APP_REPOSITORY_URL, APP_VERSION } from './appInfo';
import { isDesktop } from './git';

vi.mock('./git', async original => ({ ...await original<typeof import('./git')>(), isDesktop: vi.fn() }));
vi.mock('./updates', async original => ({ ...await original<typeof import('./updates')>(), updatesApi: { check: vi.fn(), download: vi.fn(), openLink: vi.fn(), openDirectory: vi.fn() } }));
const events = vi.hoisted(() => ({ progress: undefined as undefined | ((event: { payload: DownloadProgress }) => void), stop: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_event: string, callback: (event: { payload: DownloadProgress }) => void) => { events.progress = callback; return events.stop; }) }));
const latest: UpdateInfo = { currentVersion: APP_VERSION, latestVersion: '0.2.0', hasUpdate: true, releaseUrl: `${APP_DOWNLOAD_URL}/tag/v0.2.0`, publishedAt: null, assetName: 'easygit_0.2.0_x64-setup.exe', assetSize: 10485760 };
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Harness() {
  const updates = useAppUpdates(); const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>关于</button>{open && <AboutDialog updates={updates} onClose={() => setOpen(false)} />}</>;
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.mocked(isDesktop).mockReturnValue(false);
  vi.mocked(updatesApi.check).mockResolvedValue(latest); events.progress = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(node => node.textContent === text || node.getAttribute('aria-label') === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
async function render() { await act(async () => root.render(<Harness />)); }

describe('关于和更新流程', () => {
  it('显示真实作者、仓库、下载地址和统一版本，浏览器预览不自动联网', async () => {
    await render();
    expect(host.textContent).toContain(APP_AUTHOR); expect(host.textContent).toContain(`v${APP_VERSION}`);
    expect(host.textContent).toContain(APP_REPOSITORY_URL); expect(host.textContent).toContain(APP_DOWNLOAD_URL);
    expect(updatesApi.check).not.toHaveBeenCalled();
    await click(APP_REPOSITORY_URL); expect(updatesApi.openLink).toHaveBeenCalledWith(APP_REPOSITORY_URL);
    await click('检查更新'); expect(host.textContent).toContain('发现新版本 v0.2.0');
  });
  it('启动只检查一次，下载和进度在关闭、重开弹窗后继续保留', async () => {
    vi.mocked(isDesktop).mockReturnValue(true);
    const download = pending<{ fileName: string; filePath: string }>(); vi.mocked(updatesApi.download).mockReturnValue(download.promise);
    await render(); expect(updatesApi.check).toHaveBeenCalledTimes(1);
    await click('下载新版本'); await click('关闭对话框');
    await act(async () => events.progress?.({ payload: { downloadedBytes: 5242880, totalBytes: 10485760 } }));
    await click('关于'); expect(host.querySelector('progress')?.value).toBe(50);
    await click('关闭对话框');
    await act(async () => download.resolve({ fileName: latest.assetName!, filePath: `C:/Downloads/easygit/${latest.assetName}` }));
    await click('关于'); expect(host.textContent).toContain('安装包已下载');
    await click('打开下载文件夹'); expect(updatesApi.openDirectory).toHaveBeenCalledOnce();
    expect(updatesApi.check).toHaveBeenCalledOnce(); expect(updatesApi.download).toHaveBeenCalledOnce();
  });
  it('检查及下载失败可重试，不把失败当成最新版本', async () => {
    vi.mocked(updatesApi.check).mockRejectedValueOnce('GitHub 暂时限制了更新检查');
    vi.mocked(updatesApi.download).mockRejectedValueOnce('安装包校验失败');
    await render(); await click('检查更新'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('GitHub');
    expect(host.textContent).not.toContain('当前已是最新版本');
    await click('检查更新'); await click('下载新版本');
    expect(host.textContent).toContain('安装包校验失败'); expect(host.textContent).toContain('重试下载');
  });
  it('相同版本或没有适合系统的安装包时提供正确的下载入口', async () => {
    vi.mocked(updatesApi.check).mockResolvedValueOnce({ ...latest, hasUpdate: false, latestVersion: APP_VERSION });
    await render(); await click('检查更新'); expect(host.textContent).toContain('当前已是最新版本');
    expect(host.textContent).not.toContain('下载新版本');
    vi.mocked(updatesApi.check).mockResolvedValueOnce({ ...latest, assetName: null, assetSize: null });
    await click('检查更新'); expect(host.textContent).toContain('暂无适合当前系统的安装包');
    await click('前往 GitHub 下载'); expect(updatesApi.openLink).toHaveBeenCalledWith(latest.releaseUrl);
    expect(updatesApi.download).not.toHaveBeenCalled();
  });
});
