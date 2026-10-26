import { describe, expect, it } from 'vitest';
import { buildConflictBlockRows, getLineHighlight } from './conflictComparison';

describe('冲突块差异对比', () => {
  it('保留相同上下文，只高亮不同的行，新增行用空白占位对齐', () => {
    const rows = buildConflictBlockRows('shared\nold\nanchor\nend\n', 'shared\nnew\nanchor\nextra\nend\n');
    expect(rows).toEqual([
      { original: { number: 1, text: 'shared', kind: 'context' }, modified: { number: 1, text: 'shared', kind: 'context' } },
      { original: { number: 2, text: 'old', kind: 'removed' }, modified: { number: 2, text: 'new', kind: 'added' } },
      { original: { number: 3, text: 'anchor', kind: 'context' }, modified: { number: 3, text: 'anchor', kind: 'context' } },
      { original: null, modified: { number: 4, text: 'extra', kind: 'added' } },
      { original: { number: 4, text: 'end', kind: 'context' }, modified: { number: 5, text: 'end', kind: 'context' } },
    ]);
  });

  it.each([
    ['', 'new\n', null, 'added'],
    ['old\n', '', 'removed', null],
    ['', '', null, null],
  ])('支持空版本 %j / %j', (ours, theirs, originalKind, modifiedKind) => {
    const rows = buildConflictBlockRows(ours, theirs);
    expect(rows[0]?.original?.kind ?? null).toBe(originalKind);
    expect(rows[0]?.modified?.kind ?? null).toBe(modifiedKind);
    if (!ours && !theirs) expect(rows).toEqual([]);
  });

  it('比较时兼容 CRLF、空白行与文件末尾换行，不改动原始内容', () => {
    const rows = buildConflictBlockRows('same\r\n\r\nlast\r\n', 'same\n\nlast');
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.original?.text)).toEqual(['same', '', 'last']);
    expect(rows.every(row => row.original?.kind === 'context' && row.modified?.kind === 'context')).toBe(true);
  });

  it('重复行之间的插入不会把后面的相同代码都标成差异', () => {
    const rows = buildConflictBlockRows('start\nrepeat\nrepeat\nend\n', 'start\nrepeat\ninsert\nrepeat\nend\n');
    expect(rows.filter(row => row.modified?.kind === 'added').map(row => row.modified?.text)).toEqual(['insert']);
    expect(rows.filter(row => row.original?.kind === 'removed')).toEqual([]);
    expect(rows.at(-1)?.original?.number).toBe(4);
    expect(rows.at(-1)?.modified?.number).toBe(5);
  });

  it('大冲突块限制比较开销，并完整保留两侧内容与共有边界', () => {
    const ours = Array.from({ length: 1000 }, (_, index) => `ours ${index}`);
    const theirs = Array.from({ length: 1000 }, (_, index) => `theirs ${index}`);
    const rows = buildConflictBlockRows(['start', ...ours, 'end'].join('\n'), ['start', ...theirs, 'end'].join('\n'));
    expect(rows).toHaveLength(1002);
    expect(rows[0].original?.kind).toBe('context');
    expect(rows.at(-1)?.modified?.kind).toBe('context');
    expect(rows.slice(1, -1).map(row => row.original?.text)).toEqual(ours);
    expect(rows.slice(1, -1).map(row => row.modified?.text)).toEqual(theirs);
  });
});

describe('冲突行内差异', () => {
  it.each([
    ['  log: 0,', '  log: 1,', { before: '  log: ', changed: '0', after: ',' }],
    ['const 图标 = "🌕";', 'const 图标 = "🌙";', { before: 'const 图标 = "', changed: '🌕', after: '";' }],
    ['same', 'same', { before: 'same', changed: '', after: '' }],
    ['left right', 'leftright', { before: 'left', changed: ' ', after: 'right' }],
    ['new line', '', { before: '', changed: 'new line', after: '' }],
  ])('只加深 %j 中与 %j 不同的文字', (text, other, expected) => {
    expect(getLineHighlight(text, other)).toEqual(expected);
  });
});
