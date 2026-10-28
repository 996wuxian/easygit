import { useCallback, useEffect, useRef, useState } from 'react';
import { IconCheck, IconEdit, IconLoader2, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import { Dialog } from './Dialog';
import { git, type GitRemote, type RemoteRequest } from '../services/git';
import './repository-setup.css';

export function RemotesDialog({ path, busy, syncing, onClose, onSave }: {
  path: string; busy: boolean; syncing: boolean; onClose: () => void;
  onSave: (path: string, request: RemoteRequest, onError: (message: string) => void) => Promise<boolean>;
}) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ remote: GitRemote | null; name: string; url: string } | null>(null);
  const [removing, setRemoving] = useState<GitRemote | null>(null);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const locked = busy || syncing || saving;
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError('');
    try { const result = await git.remotes(path); if (token === generation.current) setRemotes(result); }
    catch (failure) { if (token === generation.current) setError(`无法读取远程配置：${String(failure)}`); }
    finally { if (token === generation.current) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const save = async (request: RemoteRequest) => {
    if (locked || pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      let reason = '';
      if (await onSave(path, request, message => { reason = message; })) { setEditing(null); setRemoving(null); await load(); }
      else setError(reason || '远程配置未保存，请等待当前操作完成后重试。');
    } catch (failure) { setError(String(failure)); }
    finally { pending.current = false; setSaving(false); }
  };
  return <Dialog title="远程仓库" className="remotes-dialog" onClose={() => { if (!saving && !busy) onClose(); }}>
    <p className="dialog-description">管理当前项目的远程地址。保存地址后，可在分支面板获取更新；本机 Git 凭据和 SSH 配置继续生效。</p>
    {syncing && <p className="preview-note" role="status">正在获取远程更新，完成后即可修改配置。</p>}
    {loading ? <div className="setup-progress" role="status"><IconLoader2 size={16} className="spin" />正在读取远程配置…</div> : editing ? <form onSubmit={event => { event.preventDefault(); void save({ name: editing.name.trim(), url: editing.url.trim(), expected: editing.remote }); }}>
      <label className="field-label" htmlFor="remote-name">远程名称</label><input id="remote-name" className="text-field mono" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} disabled={locked || Boolean(editing.remote)} required spellCheck={false} />
      <p className="field-help">通常使用 origin；多个远程仓库使用不同名称。</p>
      <label className="field-label" htmlFor="remote-url">仓库地址</label><input id="remote-url" className="text-field mono" value={editing.url} placeholder="HTTPS、SSH 或本地仓库地址" onChange={event => setEditing({ ...editing, url: event.target.value })} disabled={locked} required spellCheck={false} />
      <p className="field-help">请使用不含密码或令牌的地址。单独配置过的推送地址会保留。</p>
      <div className="dialog-action-row"><button type="button" className="secondary-button" disabled={locked} onClick={() => { setEditing(null); setError(''); }}>返回列表</button><button className="primary-button" type="submit" disabled={locked || !editing.name.trim() || !editing.url.trim()}>{saving ? <IconLoader2 size={15} className="spin" /> : <IconCheck size={15} />}保存地址</button></div>
    </form> : removing ? <div>
      <p className="remote-remove-note">移除远程配置 <strong>{removing.name}</strong>？对应的远程跟踪分支和上游关联也会移除，本地分支、项目文件和服务器上的仓库会保留。</p>
      <div className="dialog-action-row"><button className="secondary-button" disabled={locked} onClick={() => setRemoving(null)}>取消</button><button className="primary-button remove-workspace-confirm" disabled={locked} onClick={() => { void save({ name: removing.name, url: null, expected: removing }); }}>{saving ? <IconLoader2 size={15} className="spin" /> : <IconTrash size={15} />}确认移除远程</button></div>
    </div> : <>
      <div className="remote-list">{remotes.map(remote => <div className="remote-item" key={remote.name}><div><strong>{remote.name}</strong>{remote.fetchUrls.map((url, index) => <code key={`fetch-${index}`}>{url}</code>)}{JSON.stringify(remote.pushUrls) !== JSON.stringify(remote.fetchUrls) && <small>推送地址：{remote.pushUrls.join('、')}</small>}{remote.fetchUrls.length !== 1 && <small>此远程有多个地址，请使用 Git 命令调整。</small>}</div><button className="icon-button" aria-label={`修改远程 ${remote.name}`} title="修改获取地址" disabled={locked || remote.fetchUrls.length !== 1} onClick={() => { setError(''); setEditing({ remote, name: remote.name, url: remote.fetchUrls[0] ?? '' }); }}><IconEdit size={16} /></button><button className="icon-button" aria-label={`移除远程 ${remote.name}`} disabled={locked} onClick={() => { setError(''); setRemoving(remote); }}><IconTrash size={16} /></button></div>)}</div>
      {!remotes.length && !error && <p className="preview-note">尚未配置远程仓库。添加地址后即可获取更新或首次推送。</p>}
      <div className="dialog-action-row"><button className="text-button" disabled={locked} onClick={() => { void load(); }}><IconRefresh size={15} />刷新</button><button className="primary-button" disabled={locked || Boolean(error)} onClick={() => setEditing({ remote: null, name: remotes.some(remote => remote.name === 'origin') ? '' : 'origin', url: '' })}><IconPlus size={15} />添加远程仓库</button></div>
    </>}
    {error && <p className="setup-error" role="alert">{error}</p>}
  </Dialog>;
}
