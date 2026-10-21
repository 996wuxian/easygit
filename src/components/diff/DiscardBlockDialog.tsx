import { IconArrowBackUp } from '@tabler/icons-react';
import type { DiffBlock } from '../../services/git';
import { Dialog } from '../Dialog';
import { diffBlockPreview } from './model';
import { UnifiedDiff } from './UnifiedDiff';

export function DiscardBlockDialog({ file, block, untracked, busy, onCancel, onConfirm }: {
  file: string; block: DiffBlock; untracked: boolean; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return <Dialog title="撤回所选变更块" className="discard-block-dialog" onClose={onCancel}>
    <p className="discard-block-path"><code>{file}</code></p>
    <p className="dialog-description">仅撤回下方变更块，文件中的其他更改和已暂存内容会保留。此操作无法通过 Git 恢复。{untracked && '该新文件只有一个变更块，撤回后会删除此文件。'}</p>
    <div className="discard-block-preview code-scroll" aria-label="将撤回的变更块"><UnifiedDiff diff={diffBlockPreview(block)} /></div>
    <div className="conflict-dialog-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>取消</button><button className="primary-button discard-confirm-button" disabled={busy} onClick={onConfirm}><IconArrowBackUp size={15} />确认撤回此块</button></div>
  </Dialog>;
}
