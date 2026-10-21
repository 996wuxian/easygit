import type { FileComparison } from '../../services/git';

export interface SourceLine {
  number: number;
  text: string;
  kind: 'context' | 'added' | 'removed';
}
export interface ComparisonRow { original: SourceLine | null; modified: SourceLine | null }

export interface ComparisonChange {
  start: number;
  end: number;
  added: number;
  removed: number;
  originalLine: number | null;
  modifiedLine: number | null;
}

export function buildComparisonChanges(rows: readonly ComparisonRow[]): ComparisonChange[] {
  const changes: ComparisonChange[] = [];
  let block: ComparisonChange | null = null;
  rows.forEach((row, index) => {
    const added = row.modified?.kind === 'added' ? 1 : 0;
    const removed = row.original?.kind === 'removed' ? 1 : 0;
    if (!added && !removed) {
      block = null;
      return;
    }
    if (!block) {
      block = { start: index, end: index, added: 0, removed: 0, originalLine: row.original?.number ?? null, modifiedLine: row.modified?.number ?? null };
      changes.push(block);
    }
    block.end = index + 1;
    block.added += added;
    block.removed += removed;
  });
  return changes;
}

export function countDiffChanges(diff: string): { added: number; removed: number } {
  let inHunk = false;
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) inHunk = true;
    else if (line.startsWith('diff --')) inHunk = false;
    else if (inHunk && line.startsWith('+')) added++;
    else if (inHunk && line.startsWith('-')) removed++;
  }
  return { added, removed };
}

export function buildComparisonRows(comparison: FileComparison): ComparisonRow[] {
  if (comparison.unchanged !== null) {
    const lines = comparison.unchanged.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines.map((text, index) => {
      const line: SourceLine = { number: index + 1, text, kind: 'context' };
      return { original: line, modified: line };
    });
  }
  const rows: ComparisonRow[] = [];
  let originalNumber = 0;
  let modifiedNumber = 0;
  let inHunk = false;
  let removed: SourceLine[] = [];
  let added: SourceLine[] = [];
  const flushChanges = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ original: removed[index] ?? null, modified: added[index] ?? null });
    }
    removed = [];
    added = [];
  };
  for (const line of comparison.diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flushChanges();
      originalNumber = Number(hunk[1]);
      modifiedNumber = Number(hunk[2]);
      inHunk = true;
    } else if (inHunk && line.startsWith('-')) {
      removed.push({ number: originalNumber++, text: line.slice(1), kind: 'removed' });
    } else if (inHunk && line.startsWith('+')) {
      added.push({ number: modifiedNumber++, text: line.slice(1), kind: 'added' });
    } else if (inHunk && line.startsWith(' ')) {
      flushChanges();
      rows.push({
        original: { number: originalNumber++, text: line.slice(1), kind: 'context' },
        modified: { number: modifiedNumber++, text: line.slice(1), kind: 'context' },
      });
    }
  }
  flushChanges();
  return rows;
}
