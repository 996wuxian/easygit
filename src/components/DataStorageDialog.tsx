import { useEffect, useState } from 'react';
import { IconArrowRight, IconFolderOpen, IconLoader2 } from '@tabler/icons-react';
import { Dialog } from './Dialog';
import { isDesktop } from '../services/git';
import { getDataDirectory, migrateDataDirectory, openDataDirectory } from '../services/storage';

export function DataStorageDialog({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [directory, setDirectory] = useState('');
  const [newDirectory, setNewDirectory] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isDesktop()) { setError('请在 easygit 桌面版中管理数据目录。'); return; }
    void getDataDirectory().then(value => {
      if (!cancelled) setDirectory(value);
    }).catch(error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, []);

  async function migrate() {
    if (!newDirectory.trim() || busy) return;
    setBusy(true);
    try {
      const path = await migrateDataDirectory(newDirectory);
      setDirectory(path);
      setNewDirectory('');
      notify('数据目录已迁移，后续保存将使用新目录。');
    } catch (error) { notify(`迁移失败：${String(error)}`, true); }
    finally { setBusy(false); }
  }

  return <Dialog title="数据存储" onClose={() => { if (!busy) onClose(); }}>
    <p className="dialog-description">主题、布局、仓库列表、排序和提交草稿自动保存到本机数据目录，并保留上一份数据备份。API Key 单独加密保存，仅当前 Windows 用户可解密。</p>
    {error ? <p className="storage-settings-error" role="alert">{error}</p> : <>
      <label className="field-label" htmlFor="current-data-directory">当前数据目录</label>
      <div className="storage-directory-row">
        <input id="current-data-directory" className="text-field mono" value={directory || '正在读取…'} readOnly />
        <button className="secondary-button" disabled={!directory || busy} onClick={() => {
          void openDataDirectory().catch(error => notify(`无法打开数据目录：${String(error)}`, true));
        }}><IconFolderOpen size={16} />打开目录</button>
      </div>
      <form className="storage-migration-form" onSubmit={event => { event.preventDefault(); void migrate(); }}>
        <label className="field-label" htmlFor="new-data-directory">迁移到新目录</label>
        <input id="new-data-directory" className="text-field mono" placeholder="填写新的绝对路径，例如 D:\easygit-data" value={newDirectory} disabled={busy} onChange={event => setNewDirectory(event.target.value)} />
        <p className="field-help">复制数据和加密密钥后切换目录。原目录文件会保留，目标目录已有 easygit 数据时不会覆盖。</p>
        <button className="primary-button dialog-submit" disabled={!directory || !newDirectory.trim() || busy} type="submit">{busy ? <IconLoader2 size={16} className="spin" /> : <IconArrowRight size={16} />}{busy ? '正在迁移…' : '迁移到此目录'}</button>
      </form>
    </>}
  </Dialog>;
}
