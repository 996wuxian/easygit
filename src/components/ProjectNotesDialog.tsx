import { useEffect, useRef, useState } from 'react';
import { IconAlertCircle, IconCheck, IconDeviceFloppy, IconLoader2, IconNotes } from '@tabler/icons-react';
import { isDesktop } from '../services/git';
import { appStorage, flushStorage } from '../services/storage';
import { Dialog } from './Dialog';
import './project-notes.css';

const NOTES_FLUSH_DELAY_MS = 400;

type NoteState = { content: string } & (
  | { status: 'saved' | 'saving' }
  | { status: 'error' | 'load-error'; message: string }
);

function readNote(key: string): NoteState {
  try {
    return { content: appStorage.getItem(key) ?? '', status: 'saved' };
  } catch (error) {
    return { content: '', status: 'load-error', message: `无法读取项目笔记：${String(error)}` };
  }
}

export function ProjectNotesDialog({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const storageKey = `easygit.project-notes.v1:${path}`;
  const [note, setNote] = useState(() => readNote(storageKey));
  const revision = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlushTimer = () => {
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
  };

  useEffect(() => clearFlushTimer, []);

  async function save(content: string, immediate = false): Promise<boolean> {
    clearFlushTimer();
    const current = ++revision.current;
    setNote({ content, status: 'saving' });
    try {
      // Update the shared cache immediately so closing or quitting cannot drop recent edits.
      appStorage.setItem(storageKey, content);
      if (!immediate && isDesktop()) {
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          void flushStorage().then(
            () => {
              if (current === revision.current) setNote({ content, status: 'saved' });
            },
            error => {
              if (current === revision.current) {
                setNote({ content, status: 'error', message: `笔记保存失败：${String(error)}` });
              }
            },
          );
        }, NOTES_FLUSH_DELAY_MS);
        return true;
      }
      await flushStorage();
      if (current !== revision.current) return false;
      setNote({ content, status: 'saved' });
      return true;
    } catch (error) {
      if (current === revision.current) {
        setNote({ content, status: 'error', message: `笔记保存失败：${String(error)}` });
      }
      return false;
    }
  }

  async function close() {
    if (note.status === 'saved' || note.status === 'load-error' || await save(note.content, true)) onClose();
  }

  const failed = note.status === 'error' || note.status === 'load-error';

  return <Dialog title="项目笔记" className="project-notes-dialog" onClose={() => { void close(); }}>
    <div className="project-notes-project">
      <IconNotes size={20} aria-hidden="true" />
      <div><strong>{name}</strong><span title={path}>{path}</span></div>
    </div>
    <p className="dialog-description" id="project-notes-help">记录这个项目的待办、启动步骤、环境配置或排查心得。内容自动保存到本机，每个项目单独记录。</p>
    <label className="field-label" htmlFor="project-notes-content">笔记内容</label>
    <textarea
      id="project-notes-content"
      className="text-field project-notes-editor"
      aria-describedby="project-notes-help"
      placeholder={'待办事项\n\n启动步骤与环境配置\n\n问题记录与解决办法…'}
      value={note.content}
      disabled={note.status === 'load-error'}
      onChange={event => { void save(event.currentTarget.value); }}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          event.stopPropagation();
          void save(note.content, true);
        }
      }}
    />
    {failed && <p className="project-notes-error" role="alert">{note.message}{note.status === 'error' && '。当前内容仍保留在窗口中，请重试保存。'}</p>}
    <div className="project-notes-footer">
      <span className={`project-notes-status ${failed ? 'is-error' : ''}`} role="status">
        {failed ? <IconAlertCircle size={14} aria-hidden="true" /> : note.status === 'saving' ? <IconLoader2 size={14} className="spin" aria-hidden="true" /> : <IconCheck size={14} aria-hidden="true" />}
        {failed ? note.status === 'load-error' ? '读取失败' : '尚未保存' : note.status === 'saving' ? '正在保存…' : '已自动保存'}
      </span>
      <div className="project-notes-actions">
        {note.status === 'load-error' && <button className="secondary-button" onClick={() => setNote(readNote(storageKey))}>重新读取</button>}
        {note.status === 'error' && <button className="secondary-button" onClick={() => { void save(note.content, true); }}><IconDeviceFloppy size={15} aria-hidden="true" />重试保存</button>}
        <button className="primary-button" onClick={() => { void close(); }}><IconCheck size={15} aria-hidden="true" />完成</button>
      </div>
    </div>
  </Dialog>;
}
