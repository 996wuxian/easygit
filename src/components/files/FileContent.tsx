import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { EditorDocument } from './useFileEditor';
import { svgPreviewUrl } from './imagePreview';

const CodeEditor = lazy(() => import('./CodeEditor'));

export function FileContent({ doc, readOnly, onChange, onSave }: {
  doc: EditorDocument; readOnly: boolean; onChange: (content: string) => void; onSave: () => void;
}) {
  const image = doc.original.image;
  const editableSvg = image?.mime === 'image/svg+xml' && doc.original.content !== null;
  const [source, setSource] = useState(Boolean(doc.target));
  const [actualSize, setActualSize] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ url: string; width: number; height: number } | null>(null);
  const url = useMemo(() => editableSvg ? svgPreviewUrl(doc.draft) : image?.dataUrl, [editableSvg, doc.draft, image?.dataUrl]);
  useEffect(() => { if (doc.target) setSource(true); }, [doc.target]);
  const preview = Boolean(image && (!editableSvg || !source));
  return <div className="file-content">
    {image && <div className="file-content-toolbar">
      {editableSvg ? <div className="file-view-mode" role="group" aria-label="SVG 查看方式">
        <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>预览</button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>源码</button>
      </div> : <span>图片预览</span>}
      {preview && <>
        <span className="file-image-dimensions">{dimensions && dimensions.url === url ? `${dimensions.width} × ${dimensions.height} px` : ''}</span>
        <div className="file-view-mode" role="group" aria-label="图片缩放">
          <button type="button" aria-pressed={!actualSize} onClick={() => setActualSize(false)}>适应窗口</button>
          <button type="button" aria-pressed={actualSize} onClick={() => setActualSize(true)}>原始尺寸</button>
        </div>
      </>}
    </div>}
    {preview && url ? failedUrl === url ? <div className="files-message" role="alert">无法预览此图片，文件可能已损坏或格式不受支持。{editableSvg && '可以切换到源码查看。'}</div> :
      <div className={`file-image-viewport${actualSize ? ' actual-size' : ''}`}>
        <img key={url} src={url} alt={doc.file} onError={() => setFailedUrl(url)} onLoad={event => {
          const img = event.currentTarget;
          setDimensions({ url, width: img.naturalWidth, height: img.naturalHeight });
        }} />
      </div> : doc.original.content !== null ?
      <Suspense fallback={<div className="files-message" role="status">正在加载编辑器…</div>}>
        <CodeEditor file={doc.file} content={doc.draft} target={doc.target} readOnly={readOnly} onChange={onChange} onSave={onSave} />
      </Suspense> : <div className="files-message">{doc.original.reason ?? '此文件暂不支持预览。'}</div>}
  </div>;
}
