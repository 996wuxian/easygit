import { IconDeviceFloppy, IconFileCode, IconPhoto, IconRefresh } from '@tabler/icons-react';
import type { RepositorySnapshot } from '../../services/git';
import type { FilePosition } from '../../services/project';
import { Dialog } from '../Dialog';
import { FileTree } from './FileTree';
import { FileContent } from './FileContent';
import { imageSizeLabel } from './imagePreview';
import type { FileEditor } from './useFileEditor';
import type { FileActionsProps } from './useFileActions';
import './files.css';

export function FileEditorDialog({ editor, snapshot, busy, refreshKey, onOpen, onResolveConflict, onDelete, notify }: {
  editor: FileEditor; snapshot: RepositorySnapshot; busy: boolean; refreshKey: string;
  onOpen: (file: string, position?: FilePosition) => void; onResolveConflict: (file: string) => void;
} & FileActionsProps) {
  const doc = editor.document;
  const image = doc?.original.image;
  const conflicted = Boolean(doc && snapshot.files.some(file => file.path === doc.file && file.conflicted));
  const canSave = editor.dirty && !editor.saving && !editor.external && !busy && !conflicted;
  return <>
    <Dialog title="项目文件编辑器" className="file-editor-dialog" onClose={() => { void editor.close(); }}>
      <div className="file-editor-layout">
        <aside className="file-editor-sidebar"><FileTree key={snapshot.path} repository={snapshot.path} files={snapshot.files} refreshKey={refreshKey} revision={snapshot.revision} selected={doc?.file} onOpen={onOpen} busy={busy} onDelete={onDelete} notify={notify} /></aside>
        <section className="file-editor-main" aria-label="文件内容">
          <div className="file-editor-toolbar">{image ? <IconPhoto size={17} /> : <IconFileCode size={17} />}<span className="editor-file-path" title={doc?.file}>{doc?.file ?? '读取文件'}</span>{editor.dirty && <span className="editor-dirty">未保存</span>}<button className="text-button" disabled={editor.saving || editor.loading || !doc} onClick={editor.reload} title="重新读取磁盘内容"><IconRefresh size={15} />重新读取</button>{doc?.original.content != null && <button className="primary-button" disabled={!canSave} onClick={() => { void editor.save(); }}><IconDeviceFloppy size={16} />{editor.saving ? '正在保存' : '保存'}<kbd>Ctrl S</kbd></button>}</div>
          {editor.external && <div className="editor-notice" role="alert">磁盘文件已变化，草稿已保留。请复制需要的内容后重新读取，再核对修改。</div>}
          {editor.error && <div className="editor-notice error-color" role="alert">{editor.error}</div>}
          {conflicted && <div className="editor-notice">此文件存在合并冲突。<button className="text-button" onClick={() => onResolveConflict(doc!.file)}>打开冲突解决工具</button></div>}
          {editor.loading ? <div className="files-message" role="status">正在读取文件内容…</div> : doc ? <FileContent key={doc.key} doc={doc} readOnly={editor.saving || busy || conflicted} onChange={editor.change} onSave={() => { if (canSave) void editor.save(); }} /> : <div className="files-message">请选择项目中的文件。</div>}
          <footer className="file-editor-footer"><span>{image ? `${image.mime === 'image/svg+xml' ? 'SVG' : image.mime.split('/')[1].toUpperCase()} · ${imageSizeLabel(image.size)}` : doc ? `${doc.original.bom ? 'UTF-8 BOM' : 'UTF-8'} · ${doc.original.lineEnding.toUpperCase()}` : '工作区文件'}</span><span>{editor.dirty ? '修改尚未写入磁盘' : image && doc?.original.content === null ? (doc.original.reason ?? '图片仅供预览') : '保存后可在工作区查看差异并暂存'}</span></footer>
        </section>
      </div>
    </Dialog>
    {editor.confirming && <Dialog title="文件尚未保存" onClose={() => { void editor.decide('cancel'); }}>
      <p className="dialog-description"><code>{doc?.file}</code> 有未保存的修改，如何处理？</p>
      {editor.error && <p className="error-color" role="alert">{editor.error}</p>}
      {editor.external && <p className="dialog-description">磁盘内容已变化，请取消后核对草稿与磁盘内容。</p>}
      <div className="dialog-action-row"><button className="text-button" disabled={editor.saving} onClick={() => { void editor.decide('cancel'); }}>取消</button><button className="text-button" disabled={editor.saving} onClick={() => { void editor.decide('discard'); }}>放弃修改</button><button className="primary-button" disabled={editor.saving || editor.external || conflicted || busy} onClick={() => { void editor.decide('save'); }}>保存并继续</button></div>
    </Dialog>}
  </>;
}
