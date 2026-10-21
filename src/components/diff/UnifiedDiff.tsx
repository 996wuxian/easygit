import { Syntax } from './Syntax';

export const isCombinedDiff = (diff: string) => /^diff --(?:cc|combined) /m.test(diff) || /^@@@ /m.test(diff);

export function UnifiedDiff({ diff }: { diff: string }) {
  if (isCombinedDiff(diff)) return <div className="conflict-diff"><div className="conflict-diff-note">文件存在合并冲突。以下为原始差异，请在编辑器中解决冲突。</div><pre>{diff}</pre></div>;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const display = diff.split('\n').filter(line => {
    if (line.startsWith('@@ ')) inHunk = true;
    if (line.startsWith('diff --git ')) { inHunk = false; return false; }
    return inHunk || !/^(index |--- |\+\+\+ )/.test(line);
  });
  return <div className="code-lines">{display.map((line, index) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      return <div className="code-hunk" key={index}><span>···</span><span>···</span><code>{line}</code></div>;
    }
    const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
    const special = line.startsWith('\\') || !oldLine && !newLine;
    const old = type !== 'added' && !special ? oldLine++ : '';
    const next = type !== 'removed' && !special ? newLine++ : '';
    return <div className={`code-line ${type}`} key={index}><span className="line-number">{old}</span><span className="line-number">{next}</span><span className="line-sign">{type === 'added' ? '+' : type === 'removed' ? '−' : ' '}</span><code><Syntax text={line.startsWith(' ') || type !== 'context' ? line.slice(1) : line} /></code></div>;
  })}</div>;
}
