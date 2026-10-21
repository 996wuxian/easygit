import { describe, expect, it } from 'vitest';
import { acceptConflictBlock, hasConflictMarkers, parseConflictBlocks } from './conflicts';

describe('冲突块合并', () => {
  it('逐块保留选择内容，保留冲突外的修改和 CRLF 换行', () => {
    const source = 'edited before\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> feature\r\nafter\r\n';
    const [block] = parseConflictBlocks(source);
    expect(acceptConflictBlock(source, block, 'ours')).toBe('edited before\r\nours\r\nafter\r\n');
    expect(acceptConflictBlock(source, block, 'theirs')).toBe('edited before\r\ntheirs\r\nafter\r\n');
    expect(acceptConflictBlock(source, block, 'both')).toBe('edited before\r\nours\r\ntheirs\r\nafter\r\n');
  });

  it('支持 diff3 基础版本、自定义标记长度、空版本及多个冲突块', () => {
    const source = '<<<<< HEAD\n||||| base\nbase\n=====\nincoming\n>>>>> feature\nkeep\n<<<<< HEAD\nlocal\n=====\n>>>>> feature';
    const blocks = parseConflictBlocks(source, 5);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].ours).toBe('');
    expect(blocks[0].theirs).toBe('incoming\n');
    const first = acceptConflictBlock(source, blocks[0], 'theirs');
    const final = acceptConflictBlock(first, parseConflictBlocks(first, 5)[0], 'ours');
    expect(final).toBe('incoming\nkeep\nlocal\n');
    expect(hasConflictMarkers(final, 5)).toBe(false);
  });

  it('不替换缺少结束标记的冲突，阻止未清除的标记保存', () => {
    const partial = '<<<<<<< HEAD\nours\n=======\ntheirs\n';
    expect(parseConflictBlocks(partial)).toHaveLength(0);
    expect(hasConflictMarkers(partial)).toBe(true);
    expect(hasConflictMarkers('code <<<<<<< value\n=======normal text')).toBe(false);
  });
});
