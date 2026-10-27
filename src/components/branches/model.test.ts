import { describe, expect, it } from 'vitest';
import type { GitBranch } from '../../services/git';
import { recentBranchGroups, sixMonthsAgo } from './model';

const now = new Date(2026, 9, 21, 12);
const branch = (name: string, lastCommitDate: string | null, remote = false, current = false): GitBranch => ({ name, lastCommitDate, remote, current, head: null });

describe('recent branch grouping', () => {
  it('separates local and remote branches and orders each by most recent commit', () => {
    const result = recentBranchGroups([
      branch('origin/older', '2026-08-15T00:00:00Z', true), branch('feature', '2026-09-20T00:00:00Z'),
      branch('main', '2026-10-01T00:00:00Z', false, true), branch('origin/main', '2026-10-01T00:00:00Z', true),
      branch('legacy', '2025-01-01T00:00:00Z'), branch('origin/legacy', '2025-01-01T00:00:00Z', true),
    ], now);
    expect(result.local.map(item => item.name)).toEqual(['main', 'feature']);
    expect(result.remote.map(item => item.name)).toEqual(['origin/main', 'origin/older']);
  });

  it('includes the six-month boundary but filters older, unknown, invalid and future dates including an old current branch', () => {
    const cutoff = sixMonthsAgo(now);
    const result = recentBranchGroups([
      branch('boundary', cutoff.toISOString()), branch('older', new Date(cutoff.getTime() - 1).toISOString(), false, true),
      branch('unborn', null), branch('invalid', 'invalid'), branch('future', new Date(now.getTime() + 1).toISOString()),
    ], now);
    expect(result.local.map(item => item.name)).toEqual(['boundary']);
    expect(result.remote).toEqual([]);
  });

  it.each([[2026, 7, 31, 2026, 1, 28], [2024, 7, 31, 2024, 1, 29], [2026, 2, 31, 2025, 8, 30]])('uses six calendar months and clamps month-end dates', (year, month, day, expectedYear, expectedMonth, expectedDay) => {
    const date = new Date(year, month, day, 12);
    const cutoff = sixMonthsAgo(date);
    expect([cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate(), cutoff.getHours()]).toEqual([expectedYear, expectedMonth, expectedDay, 12]);
    expect(date.getDate()).toBe(day);
  });
});
