import { useEffect, useRef, useState } from 'react';
import { IconRefresh, IconStack2 } from '@tabler/icons-react';
import { git, type RepositorySnapshot, type StashAction, type StashEntry } from '../../services/git';
import { Dialog } from '../Dialog';
import { PatchView } from '../diff/PatchView';
import './stash.css';

export function StashPanel({ snapshot, busy, onSave, onAction }: { snapshot: RepositorySnapshot; busy: boolean; onSave: (message: string, includeUntracked: boolean) => Promise<boolean>; onAction: (entry: StashEntry, action: StashAction) => Promise<boolean> }) {
  const [entries, setEntries] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [selected, setSelected] = useState<StashEntry | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [patch, setPatch] = useState({ diff: '', loading: false, error: null as string | null });
  const running = useRef(false);
  const locked = busy || Boolean(snapshot.operation) || snapshot.files.some(file => file.conflicted);
  useEffect(() => {
    if (!snapshot.path) return;
    let active = true; setLoading(true); setError(null);
    void git.stashes(snapshot.path).then(next => { if (active) setEntries(next); }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [snapshot.path, snapshot.stashRevision, snapshot.stashCount, reload]);
  useEffect(() => {
    if (!selected) return;
    let active = true; setPatch({ diff: '', loading: true, error: null });
    void git.stashDiff(snapshot.path, selected).then(diff => { if (active) setPatch({ diff, loading: false, error: null }); }).catch(reason => { if (active) setPatch({ diff: '', loading: false, error: String(reason) }); });
    return () => { active = false; };
  }, [snapshot.path, selected]);
  async function act(action: StashAction) {
    if (running.current || locked || !selected) return;
    running.current = true;
    try { if (await onAction(selected, action)) { setSelected(null); setConfirmDrop(false); setReload(value => value + 1); } }
    finally { running.current = false; }
  }
  async function save() {
    if (running.current || locked) return;
    running.current = true;
    try { if (await onSave(message, includeUntracked)) { setSaving(false); setMessage(''); setReload(value => value + 1); } }
    finally { running.current = false; }
  }
  const stale = selected && !entries.some(entry => entry.hash === selected.hash && entry.selector === selected.selector);
  return <div className="stash-panel-content">
    <div className="stash-toolbar"><span><IconStack2 size={14} />{snapshot.stashCount} 条 stash</span><button className="text-button" disabled={locked || !snapshot.head || !snapshot.files.length} onClick={() => setSaving(value => !value)}>保存更改</button><button className="icon-button" aria-label="刷新 stash" disabled={loading || busy} onClick={() => setReload(value => value + 1)}><IconRefresh size={14} className={loading ? 'spin' : ''} /></button></div>
    {saving && <form className="stash-save-form" onSubmit={event => { event.preventDefault(); void save(); }}><input className="text-field" aria-label="stash 说明" placeholder="保存说明（可选）" maxLength={400} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} /><label><input type="checkbox" checked={includeUntracked} disabled={busy} onChange={event => setIncludeUntracked(event.target.checked)} />包含未跟踪的新文件</label><div><button className="primary-button" type="submit" disabled={locked}>保存到 stash</button><button className="text-button" type="button" disabled={busy} onClick={() => setSaving(false)}>取消</button></div></form>}
    {error && <p role="alert" className="stash-error">{error}</p>}
    <div className="stash-entry-list">{entries.map(entry => <button className="stash-entry" key={`${entry.selector}:${entry.hash}`} onClick={() => { setConfirmDrop(false); setSelected(entry); }}><strong>{entry.message}</strong><small>{entry.selector} · {new Date(entry.date).toLocaleString('zh-CN')}</small></button>)}{!entries.length && !loading && !error && <div className="clean-state"><IconStack2 size={26} /><strong>没有 stash 记录</strong><span>保存未完成的更改，稍后再恢复</span></div>}</div>
    {selected && <Dialog title={confirmDrop ? '删除 stash' : 'stash 详情'} className={confirmDrop ? '' : 'inspection-dialog'} onClose={() => { if (!busy) setSelected(null); }}>
      <p className="dialog-description">{selected.message}</p><div className="inspection-meta"><code>{selected.selector}</code><code>{selected.hash.slice(0, 12)}</code></div>
      {stale && <p role="alert" className="error-color">记录列表已变化，请关闭后重新选择。</p>}
      {confirmDrop ? <p className="dialog-description">确认删除这条保存记录？删除只移除 stash，当前工作区保持不变。</p> : <div className="stash-patch"><PatchView {...patch} showFileHeaders /></div>}
      {locked && !busy && <p className="error-color">请先完成当前 Git 操作和冲突处理。</p>}
      <div className="dialog-action-row stash-dialog-actions">{confirmDrop ? <><button className="secondary-button" disabled={busy} onClick={() => setConfirmDrop(false)}>返回</button><button className="primary-button" disabled={locked || Boolean(stale)} onClick={() => { void act('drop'); }}>确认删除 stash</button></> : <><button className="text-button" disabled={locked || Boolean(stale)} onClick={() => setConfirmDrop(true)}>删除记录…</button><button className="secondary-button" disabled={locked || Boolean(stale)} onClick={() => { void act('apply'); }}>恢复并保留记录</button><button className="primary-button" disabled={locked || Boolean(stale)} onClick={() => { void act('pop'); }}>恢复并删除记录</button></>}</div>
    </Dialog>}
  </div>;
}
