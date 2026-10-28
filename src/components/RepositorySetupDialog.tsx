import { useRef, useState } from 'react';
import { IconDownload, IconGitBranch, IconLoader2 } from '@tabler/icons-react';
import { Dialog } from './Dialog';
import { RepositoryDirectoryInput } from './RepositoryDirectoryInput';
import { git, isDesktop, type CloneProgress, type NewRepositoryRequest } from '../services/git';
import './repository-setup.css';

export function RepositorySetupDialog({ mode, defaultPath, busy, onClose, onCreate, notify }: {
  mode: 'clone' | 'init'; defaultPath: string; busy: boolean; onClose: () => void;
  onCreate: (request: NewRepositoryRequest, progress: (update: CloneProgress) => void, onError: (message: string) => void) => Promise<boolean>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [directory, setDirectory] = useState('');
  const [name, setName] = useState('');
  const nameEdited = useRef(false);
  const [branch, setBranch] = useState('main');
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const task = useRef('');
  const cloning = mode === 'clone';
  const locked = busy || running || picking;
  const changeUrl = (value: string) => {
    setUrl(value);
    if (!nameEdited.current) setName(value.trim().replace(/[?#].*$/, '').replace(/[/\\]+$/, '').split(/[/:\\]/).pop()?.replace(/\.git$/i, '').replace(/[<>:"|?*]/g, '-') ?? '');
  };
  const submit = async () => {
    if (pending.current || locked || !isDesktop()) return;
    pending.current = true; setRunning(true); setError(''); setProgress(null); setCancelling(false);
    task.current = crypto.randomUUID();
    try {
      const request: NewRepositoryRequest = cloning
        ? { kind: 'clone', id: task.current, url: url.trim(), parent: directory.trim(), name: name.trim() }
        : { kind: 'init', path: directory.trim(), branch: branch.trim() };
      if (await onCreate(request, setProgress, setError)) onClose();
    } catch (failure) { setError(String(failure)); }
    finally { pending.current = false; setRunning(false); setCancelling(false); }
  };
  const cancel = async () => {
    if (cancelling || !running || !progress) return;
    setCancelling(true);
    try { await git.cancelClone(task.current); }
    catch (failure) { setError(`无法取消克隆：${String(failure)}`); setCancelling(false); }
  };
  return <Dialog title={cloning ? '克隆仓库' : '初始化仓库'} className="repository-setup-dialog" onClose={() => { if (!locked) onClose(); }}>
    <p className="dialog-description">{cloning ? '将远程仓库下载到本机，完成后自动打开。' : '为已有项目文件夹启用 Git 版本管理，完成后自动打开。'}</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {cloning && <><label className="field-label" htmlFor="clone-url">仓库地址</label><input id="clone-url" className="text-field mono" placeholder="https://github.com/owner/repository.git 或 git@host:owner/repository.git" value={url} onChange={event => changeUrl(event.target.value)} disabled={locked} required autoFocus spellCheck={false} /><p className="field-help">支持 HTTPS、SSH 和本地仓库；使用本机已有的 Git 凭据或 SSH 密钥。</p></>}
      <label className="field-label" htmlFor="setup-directory">{cloning ? '保存位置' : '项目文件夹'}</label>
      <RepositoryDirectoryInput id="setup-directory" label={cloning ? '选择保存位置' : '选择项目文件夹'} value={directory} onChange={setDirectory} defaultPath={defaultPath} busy={busy || running} onPendingChange={setPicking} notify={notify} />
      <p className="field-help">{cloning ? '在此位置创建下面的新文件夹，已有同名文件夹不会被覆盖。' : '选择尚未加入 Git 仓库的现有文件夹，项目文件会保留。'}</p>
      <label className="field-label" htmlFor="setup-name">{cloning ? '新文件夹名称' : '初始分支'}</label>
      <input id="setup-name" className="text-field mono" value={cloning ? name : branch} onChange={event => { if (cloning) { nameEdited.current = true; setName(event.target.value); } else setBranch(event.target.value); }} disabled={locked} required spellCheck={false} />
      {cloning && directory && name && <p className="field-help setup-target">目标目录：{directory.replace(/[/\\]+$/, '')}/{name}</p>}
      {!cloning && <p className="field-help">初始化不会自动暂存或提交文件；可在工作台选择首次提交的内容。</p>}
      {running && <div className="setup-progress" role="status"><IconLoader2 size={17} className="spin" /><span>{cancelling ? '正在取消，等待清理临时文件…' : progress ? `${progress.phase}${progress.percent !== null ? ` · ${progress.percent}%` : ''}` : cloning ? '正在准备克隆…' : '正在初始化…'}{cloning && progress?.percent !== null && progress?.percent !== undefined && <small>百分比表示当前阶段进度</small>}</span></div>}
      {error && <p className="setup-error" role="alert">{error}</p>}
      {!isDesktop() && <p className="preview-note">请在 easygit 桌面版中创建或克隆本地仓库。</p>}
      <div className="dialog-action-row">
        {running && cloning ? <button type="button" className="secondary-button" disabled={cancelling || !progress} onClick={() => { void cancel(); }}>取消克隆</button> : <button type="button" className="secondary-button" disabled={locked} onClick={onClose}>取消</button>}
        <button type="submit" className="primary-button" disabled={locked || !directory.trim() || !(cloning ? url.trim() && name.trim() : branch.trim()) || !isDesktop()}>{running ? <IconLoader2 size={16} className="spin" /> : cloning ? <IconDownload size={16} /> : <IconGitBranch size={16} />}{running ? cloning ? '正在克隆…' : '正在初始化…' : cloning ? '克隆并打开' : '初始化并打开'}</button>
      </div>
    </form>
  </Dialog>;
}
