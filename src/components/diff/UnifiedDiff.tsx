import { Syntax } from './Syntax';
import { IconArrowBackUp } from '@tabler/icons-react';
import type { DiffBlock } from '../../services/git';
import { getDiffBlocks } from './model';

export const isCombinedDiff = (diff: string) => /^diff --(?:cc|combined) /m.test(diff) || /^@@@ /m.test(diff);

export function UnifiedDiff({ diff, onDiscardBlock, discardBlockDisabled = false, showFileHeaders = false }: { diff: string; onDiscardBlock?: (block: DiffBlock) => void; discardBlockDisabled?: boolean; showFileHeaders?: boolean }) {
  if (isCombinedDiff(diff)) return <div className="conflict-diff"><div className="conflict-diff-note">文件存在合并冲突。以下为原始差异，请在编辑器中解决冲突。</div><pre>{diff}</pre></div>;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const blocks = getDiffBlocks(diff);
  let blockIndex = -1;
  let inChange = false;
  const lines = diff.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const display = lines.filter(line => {
    if (line.startsWith('@@ ')) inHunk = true;
    if (line.startsWith('diff --git ')) { inHunk = false; return showFileHeaders; }
    return inHunk || !/^(index |--- |\+\+\+ )/.test(line);
  });
  return <div className="code-lines">{display.map((line, index) => {
    if (line.startsWith('diff --git ')) {
      oldLine = 0; newLine = 0; inChange = false;
      return <div className="patch-file-heading" key={index}>{line.slice('diff --git '.length)}</div>;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inChange = false;
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      return <div className="code-hunk" key={index}><span>···</span><span>···</span><code>{line}</code></div>;
    }
    const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
    const firstChange = type !== 'context' && !inChange;
    if (firstChange) blockIndex++;
    if (!line.startsWith('\\')) inChange = type !== 'context';
    const block = firstChange ? blocks[blockIndex] : undefined;
    const special = line.startsWith('\\') || !oldLine && !newLine;
    const old = type !== 'added' && !special ? oldLine++ : '';
    const next = type !== 'removed' && !special ? newLine++ : '';
    return <div className={`code-line ${type}`} key={index}><span className="line-number">{old}</span><span className="line-number">{next}</span><span className="line-sign">{block && onDiscardBlock ? <button className="diff-block-undo" aria-label={`撤回变更块 ${blockIndex + 1}`} title="撤回该变更块，保留其他更改" disabled={discardBlockDisabled} onClick={() => onDiscardBlock(block)}><IconArrowBackUp size={14} /></button> : type === 'added' ? '+' : type === 'removed' ? '−' : ' '}</span><code><Syntax text={line.startsWith(' ') || type !== 'context' ? line.slice(1) : line} /></code></div>;
  })}</div>;
}
