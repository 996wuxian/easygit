import { invokeCommand, isDesktop } from './git';
import { APP_DOWNLOAD_URL } from './appInfo';

export const UPDATE_PROGRESS_EVENT = 'easygit-update-download-progress';
export interface UpdateInfo {
  currentVersion: string; latestVersion: string; hasUpdate: boolean; releaseUrl: string;
  publishedAt: string | null; assetName: string | null; assetSize: number | null;
}
export interface DownloadProgress { downloadedBytes: number; totalBytes: number }
export interface DownloadedUpdate { fileName: string; filePath: string }

export const updatesApi = {
  check: () => isDesktop() ? invokeCommand<UpdateInfo>('check_for_updates') : Promise.reject(new Error('请在 easygit 桌面版中检查更新，或前往 GitHub 发布页下载。')),
  download: () => invokeCommand<DownloadedUpdate>('download_update'),
  openDirectory: () => invokeCommand<void>('open_update_download_directory'),
  openLink: async (url = APP_DOWNLOAD_URL) => {
    if (isDesktop()) await invokeCommand<void>('open_external_url', { url });
    else window.open(url, '_blank', 'noopener,noreferrer');
  },
};
