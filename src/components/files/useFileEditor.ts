import { useEffect, useRef, useState } from 'react';
import type { RepositorySnapshot } from '../../services/git';
import { project, type ProjectText } from '../../services/project';
import { registerPendingChangesGuard } from '../../services/pendingChanges';

export interface EditorDocument { repository: string; file: string; original: ProjectText; draft: string; key: number }
interface EditorState { document: EditorDocument | null; visible: boolean; loading: boolean; saving: boolean; error: string; external: boolean; confirming: boolean }
type Save = (path: string, file: string, revision: string, content: string) => Promise<ProjectText | null>;
const initial: EditorState = { document: null, visible: false, loading: false, saving: false, error: '', external: false, confirming: false };

export function useFileEditor(snapshot: RepositorySnapshot, onSave: Save) {
  const [state, setState] = useState<EditorState>(initial);
  const current = useRef(state);
  const saveAction = useRef(onSave);
  saveAction.current = onSave;
  const sequence = useRef(0);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (value: boolean) => void } | null>(null);
  const pathRef = useRef(snapshot.path);
  pathRef.current = snapshot.path;
  const update = (patch: Partial<EditorState>) => { current.current = { ...current.current, ...patch }; setState(current.current); };
  const dirty = () => {
    const doc = current.current.document;
    return Boolean(doc && doc.original.content !== null && doc.draft !== doc.original.content);
  };

  async function save(): Promise<boolean> {
    const doc = current.current.document;
    if (!doc || current.current.saving || current.current.external || doc.original.content === null) return false;
    if (!dirty()) return true;
    update({ saving: true, error: '' });
    try {
      const result = await saveAction.current(doc.repository, doc.file, doc.original.revision, doc.draft);
      if (!result) return false;
      if (current.current.document === doc) update({ document: { ...doc, original: result }, external: false });
      return true;
    } catch (error) { update({ error: String(error) }); return false; }
    finally { update({ saving: false }); }
  }

  function confirmLeave(): Promise<boolean> {
    if (current.current.saving) return Promise.resolve(false);
    if (!dirty()) return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    pending.current = { promise, resolve };
    update({ confirming: true, visible: true });
    return promise;
  }

  async function decide(choice: 'save' | 'discard' | 'cancel') {
    if (current.current.saving) return;
    if (choice === 'save' && !await save()) return;
    const doc = current.current.document;
    if (choice === 'discard' && doc) update({ document: { ...doc, draft: doc.original.content ?? '' } });
    const request = pending.current;
    pending.current = null;
    update({ confirming: false });
    request?.resolve(choice !== 'cancel');
  }

  async function load(file: string, force = false) {
    const repository = pathRef.current;
    const doc = current.current.document;
    if (!force && doc?.file === file && doc.repository === repository) { update({ visible: true }); return; }
    if (!await confirmLeave() || repository !== pathRef.current) return;
    const token = ++sequence.current;
    update({ document: null, visible: true, loading: true, error: '', external: false });
    try {
      const original = await project.readFile(repository, file);
      if (token === sequence.current && repository === pathRef.current) update({ document: { repository, file, original, draft: original.content ?? '', key: token } });
    } catch (error) { if (token === sequence.current) update({ error: String(error) }); }
    finally { if (token === sequence.current) update({ loading: false }); }
  }

  const handlers = useRef({ confirmLeave, save, load });
  handlers.current = { confirmLeave, save, load };
  useEffect(() => registerPendingChangesGuard(() => handlers.current.confirmLeave(), dirty), []);
  useEffect(() => {
    sequence.current++;
    pending.current?.resolve(false);
    pending.current = null;
    update(initial);
  }, [snapshot.path]);
  useEffect(() => () => { sequence.current++; pending.current?.resolve(false); }, []);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const doc = current.current.document;
      if (!doc || current.current.loading || current.current.saving || !document.hasFocus() || document.hidden) return;
      void project.readFile(doc.repository, doc.file).then(original => {
        const active = current.current.document;
        if (cancelled || !active || active.key !== doc.key || current.current.saving || active.original.revision !== doc.original.revision) return;
        if (original.revision === active.original.revision && original.reason === active.original.reason) return;
        if (dirty()) update({ external: true });
        else update({ document: { ...active, original, draft: original.content ?? '', key: ++sequence.current }, external: false, error: '' });
      }).catch(error => {
        if (!cancelled && current.current.document?.key === doc.key) update({ external: true, error: String(error) });
      });
    };
    check();
    window.addEventListener('focus', check);
    const interval = window.setInterval(check, 8000);
    return () => { cancelled = true; window.removeEventListener('focus', check); window.clearInterval(interval); };
  }, [snapshot]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return {
    ...state, dirty: dirty(), save, decide,
    open: (file: string) => load(file),
    reload: () => { const doc = current.current.document; if (doc) void load(doc.file, true); },
    close: async () => { if (await confirmLeave()) update({ visible: false }); },
    change: (draft: string) => { const doc = current.current.document; if (doc && !current.current.saving) update({ document: { ...doc, draft } }); },
  };
}

export type FileEditor = ReturnType<typeof useFileEditor>;
