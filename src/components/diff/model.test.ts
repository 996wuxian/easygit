import { describe, expect, it } from 'vitest';
import type { FileComparison } from '../../services/git';
import { buildComparisonChanges, buildComparisonRows, countDiffChanges } from './model';

function comparison(diff: string, unchanged: string | null = null): FileComparison {
  return { diff, unchanged, binary: false, originalExists: true, modifiedExists: true };
}

describe('full source comparison alignment', () => {
  it('aligns unequal replacement blocks and resumes with the correct line numbers', () => {
    const rows = buildComparisonRows(comparison('@@ -1,3 +1,4 @@\n unchanged\n-old\n+new one\n+new two\n tail\n'));
    expect(rows.map(row => [row.original?.text ?? null, row.modified?.text ?? null])).toEqual([
      ['unchanged', 'unchanged'], ['old', 'new one'], [null, 'new two'], ['tail', 'tail'],
    ]);
    expect(rows.at(-1)?.original?.number).toBe(3);
    expect(rows.at(-1)?.modified?.number).toBe(4);
    expect(rows[1].original?.kind).toBe('removed');
    expect(rows[1].modified?.kind).toBe('added');
  });

  it.each([
    ['@@ -0,0 +1,2 @@\n+first\n+second\n', null, 'first'],
    ['@@ -1,2 +0,0 @@\n-first\n-second\n', 'first', null],
  ])('handles added and deleted files', (diff, original, modified) => {
    const rows = buildComparisonRows(comparison(diff));
    expect(rows).toHaveLength(2);
    expect(rows[0].original?.text ?? null).toBe(original);
    expect(rows[0].modified?.text ?? null).toBe(modified);
  });

  it('ignores patch metadata and preserves source lines that resemble diff headers', () => {
    const rows = buildComparisonRows(comparison('diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- old text\n\\ No newline at end of file\n+++ new text\n\\ No newline at end of file\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0].original?.text).toBe('-- old text');
    expect(rows[0].modified?.text).toBe('++ new text');
    expect(countDiffChanges('--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- old text\n+++ new text\n')).toEqual({ added: 1, removed: 1 });
  });

  it('shows full unchanged source including blank lines without inventing a trailing row', () => {
    expect(buildComparisonRows(comparison('', 'first\n\nlast\n')).map(row => row.original?.text)).toEqual(['first', '', 'last']);
    expect(buildComparisonRows(comparison('', ''))).toEqual([]);
  });

  it('groups contiguous edits into navigable blocks while preserving aligned positions and source line numbers', () => {
    const rows = buildComparisonRows(comparison('@@ -1,6 +1,6 @@\n same\n-old\n+new\n+extra\n middle\n-removed\n tail\n end\n'));
    expect(buildComparisonChanges(rows)).toEqual([
      { start: 1, end: 3, added: 2, removed: 1, originalLine: 2, modifiedLine: 2 },
      { start: 4, end: 5, added: 0, removed: 1, originalLine: 4, modifiedLine: null },
    ]);
    expect(buildComparisonChanges(buildComparisonRows(comparison('', 'unchanged\n')))).toEqual([]);
    expect(buildComparisonChanges([])).toEqual([]);
  });

  it('keeps added and removed files as one complete change block', () => {
    expect(buildComparisonChanges(buildComparisonRows(comparison('@@ -0,0 +1,2 @@\n+one\n+two\n')))).toEqual([
      { start: 0, end: 2, added: 2, removed: 0, originalLine: null, modifiedLine: 1 },
    ]);
    expect(buildComparisonChanges(buildComparisonRows(comparison('@@ -1,2 +0,0 @@\n-one\n-two\n')))).toEqual([
      { start: 0, end: 2, added: 0, removed: 2, originalLine: 1, modifiedLine: null },
    ]);
  });
});
