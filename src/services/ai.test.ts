import { describe, expect, it } from 'vitest';
import { parseGeneratedCommitMessage } from './ai';

describe('AI commit message extraction', () => {
  it.each([
    ['feat: 添加全屏差异查看', 'feat: 添加全屏差异查看'],
    ['以下是生成的提交信息：\n\n```text\nfix: 修复滚动跳动\n```', 'fix: 修复滚动跳动'],
    ['<think>需要分析修改内容\nfeat: 这只是分析中的候选\n</think>\ndocs: 更新开发说明', 'docs: 更新开发说明'],
    ['<analysis>先分析</analysis>\n**refactor(diff): 简化比对布局**', 'refactor(diff): 简化比对布局'],
    ['- `FIX（diff）: 修复比对`\n1. "FIX(diff)!：修复比对"', 'fix(diff)!: 修复比对'],
    ['提交信息：feat:增加导航\n\n本次变更添加了导航入口。', 'feat: 增加导航'],
    ['```\nchore:更新依赖\n```', 'chore: 更新依赖'],
    ['Commit message: "test: 补充滚动测试"', 'test: 补充滚动测试'],
  ])('extracts and normalizes a valid subject from %s', (response, expected) => {
    expect(parseGeneratedCommitMessage(response)).toBe(expected);
  });

  it.each(['', '本次主要修复了滚动问题。', 'feature: 添加功能', 'fix:', 'fix( ): 空作用域', '<think>fix: 未完成的分析'])('rejects missing or invalid subjects without inventing a commit: %s', response => {
    expect(() => parseGeneratedCommitMessage(response)).toThrow('AI 未返回有效的提交信息');
  });
});
