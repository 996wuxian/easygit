import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, class: 'editor-token-keyword' },
  { tag: [tags.string, tags.regexp], class: 'editor-token-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'editor-token-number' },
  { tag: [tags.variableName, tags.propertyName], class: 'editor-token-variable' },
  { tag: [tags.typeName, tags.className], class: 'editor-token-type' },
  { tag: tags.comment, class: 'editor-token-comment' },
  { tag: tags.tagName, class: 'editor-token-tag' },
  { tag: tags.attributeName, class: 'editor-token-type' },
  { tag: tags.heading, class: 'editor-token-heading' },
]);

async function language(file: string): Promise<Extension> {
  const extension = file.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'js': case 'jsx': case 'ts': case 'tsx': case 'mjs': case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: extension === 'ts' || extension === 'tsx', jsx: extension === 'jsx' || extension === 'tsx' });
    case 'json': return (await import('@codemirror/lang-json')).json();
    case 'html': case 'vue': return (await import('@codemirror/lang-html')).html();
    case 'css': case 'scss': return (await import('@codemirror/lang-css')).css();
    case 'md': case 'mdx': return (await import('@codemirror/lang-markdown')).markdown();
    case 'rs': return (await import('@codemirror/lang-rust')).rust();
    case 'py': return (await import('@codemirror/lang-python')).python();
    default: return [];
  }
}

export default function CodeEditor({ file, content, readOnly, onChange, onSave }: {
  file: string; content: string; readOnly: boolean; onChange: (value: string) => void; onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const editable = useRef(new Compartment());
  useEffect(() => {
    const mode = new Compartment();
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      lineNumbers(), drawSelection(), highlightActiveLine(), history(), indentOnInput(), bracketMatching(),
      syntaxHighlighting(highlighting), search({ top: true }), highlightSelectionMatches(),
      EditorView.contentAttributes.of({ 'aria-label': `编辑文件 ${file}`, spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      editable.current.of(EditorState.readOnly.of(readOnly)), mode.of([]),
      EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.onChange(update.state.doc.toString()); }),
    ] }) });
    view.current = editor;
    let disposed = false;
    void language(file).then(extension => { if (!disposed) editor.dispatch({ effects: mode.reconfigure(extension) }); }).catch(() => { /* Plain text remains editable if a language chunk fails. */ });
    return () => { disposed = true; view.current = null; editor.destroy(); };
    // The parent gives each loaded document a stable key. React updates must not reset undo history.
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)) }); }, [readOnly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content }, annotations: Transaction.addToHistory.of(false) });
  }, [content]);
  return <div ref={host} className="project-code-editor" />;
}
