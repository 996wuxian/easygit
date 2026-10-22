import { IconArrowUpRight, IconBrandGithub, IconCheck, IconDownload, IconFolderOpen, IconLoader2, IconRefresh } from '@tabler/icons-react';
import { APP_AUTHOR, APP_AUTHOR_URL, APP_DOWNLOAD_URL, APP_REPOSITORY_URL, APP_VERSION } from '../services/appInfo';
import type { useAppUpdates } from '../services/useAppUpdates';
import { Dialog } from './Dialog';
import './about.css';

export function AboutDialog({ updates, onClose }: { updates: ReturnType<typeof useAppUpdates>; onClose: () => void }) {
  const { status, info, downloaded, progress, error } = updates;
  const busy = status === 'checking' || status === 'downloading';
  const percent = progress && progress.totalBytes > 0 ? Math.min(99, Math.floor(progress.downloadedBytes / progress.totalBytes * 100)) : 0;
  const statusText = status === 'checking' ? '正在检查 GitHub 最新正式版本…' : status === 'current' ? '当前已是最新版本' : info?.hasUpdate ? `发现新版本 v${info.latestVersion}` : '启动时检查一次，也可手动检查更新。';
  return <Dialog title="关于与更新" className="about-dialog" onClose={onClose}>
    <div className="about-identity"><img src="/brand/esaygit-icon.png" alt="" /><div><h3>easygit <span>v{APP_VERSION}</span></h3><p>本地 Git 工作空间</p></div></div>
    <dl className="about-details">
      <div><dt>作者</dt><dd><button className="about-link" onClick={() => { void updates.openLink(APP_AUTHOR_URL); }}>{APP_AUTHOR}<IconArrowUpRight size={14} /></button></dd></div>
      <div><dt>仓库地址</dt><dd><button className="about-link mono" onClick={() => { void updates.openLink(APP_REPOSITORY_URL); }}>{APP_REPOSITORY_URL}<IconArrowUpRight size={14} /></button></dd></div>
      <div><dt>下载地址</dt><dd><button className="about-link mono" onClick={() => { void updates.openLink(APP_DOWNLOAD_URL); }}>{APP_DOWNLOAD_URL}<IconArrowUpRight size={14} /></button></dd></div>
    </dl>
    <section className="app-update-section" aria-label="版本更新">
      <div className="app-update-heading"><h3>版本更新</h3><button className="secondary-button" disabled={busy} onClick={() => { void updates.check(); }}>{status === 'checking' ? <IconLoader2 size={15} className="spin" /> : <IconRefresh size={15} />}{status === 'checking' ? '检查中…' : '检查更新'}</button></div>
      <p className={`app-update-status ${status === 'current' ? 'success-color' : ''}`} role="status">{status === 'current' && <IconCheck size={16} />}{statusText}</p>
      {info?.hasUpdate && status !== 'downloaded' && <p className="app-update-hint">{info.assetName ? `${info.assetName}${info.assetSize ? ` · ${(info.assetSize / 1024 / 1024).toFixed(1)} MB` : ''}` : '此版本暂无适合当前系统的安装包，可前往 GitHub 发布页查看。'}</p>}
      {status === 'downloading' && <div className="app-update-progress"><div><span>正在下载安装包…</span><span>{percent}%</span></div><progress aria-label="安装包下载进度" max={100} value={percent} /><small>关闭此窗口后下载会继续。</small></div>}
      {status === 'downloaded' && downloaded && <div className="app-update-downloaded" role="status"><strong><IconCheck size={16} />安装包已下载</strong><span title={downloaded.filePath}>{downloaded.fileName}</span><small>从托盘退出 easygit 后，运行安装包完成更新。</small></div>}
      {error && <p className="app-update-error" role="alert">{error}</p>}
      <div className="app-update-actions">{info?.hasUpdate && info.assetName && status !== 'downloaded' && <button className="primary-button" disabled={busy} onClick={() => { void updates.download(); }}><IconDownload size={15} />{status === 'downloading' ? '正在下载…' : status === 'error' ? '重试下载' : '下载新版本'}</button>}{status === 'downloaded' && <button className="primary-button" onClick={() => { void updates.openDirectory(); }}><IconFolderOpen size={15} />打开下载文件夹</button>}<button className="text-button" onClick={() => { void updates.openLink(info?.releaseUrl); }}><IconBrandGithub size={15} />前往 GitHub 下载</button></div>
    </section>
  </Dialog>;
}
