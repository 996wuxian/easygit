import { IconAlertTriangle, IconGitMerge, IconMinus, IconPlus, IconArrowBackUp } from '@tabler/icons-react';
import type { DiffBlock, GitFile } from '../../services/git';
import './diff.css';

export interface DiffActions {
  busy: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[], scope: 'file' | 'all') => void;
  onResolveConflict: (file: string) => void;
  onDiscardBlock: (file: string, block: DiffBlock) => void;
}

export function DiffFileActions({ file, staged, busy, onStage, onUnstage, onDiscard, onResolveConflict }: DiffActions & { file?: GitFile; staged: boolean }) {
  if (!file) return null;
  return <div className={`diff-file-actions ${file.conflicted ? 'has-conflict' : ''}`}>
    {file.conflicted ? <><span><IconAlertTriangle size={14} />此文件有冲突，解决后才能提交</span><button className="secondary-button" disabled={busy} onClick={() => onResolveConflict(file.path)}><IconGitMerge size={14} />解决冲突</button></> : <>
      <span>{staged ? '已暂存的文件更改' : file.untracked ? '新文件' : '未暂存的文件更改'}</span>
      {staged ? <button className="text-button" disabled={busy || !file.staged} onClick={() => onUnstage([file.path])}><IconMinus size={14} />取消暂存</button> : <>
        <button className="text-button diff-discard-action" aria-label="撤回当前文件更改" title="撤回当前文件的全部未暂存更改，保留已暂存内容" disabled={busy || !file.unstaged} onClick={() => onDiscard([file.path], 'file')}><IconArrowBackUp size={14} />撤回文件更改</button>
        <button className="text-button" aria-label="暂存当前文件" disabled={busy || !file.unstaged} onClick={() => onStage([file.path])}><IconPlus size={14} />暂存文件</button>
      </>}
    </>}
  </div>;
}
