import type { GitBranch } from '../../services/git';

export function sixMonthsAgo(now: Date): Date {
  const cutoff = new Date(now);
  const day = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - 6);
  const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
  cutoff.setDate(Math.min(day, lastDay));
  return cutoff;
}

export function recentBranchGroups(branches: readonly GitBranch[], now = new Date()) {
  const cutoff = sixMonthsAgo(now).getTime();
  const recent = branches.filter(branch => {
    const date = branch.lastCommitDate ? Date.parse(branch.lastCommitDate) : NaN;
    return date >= cutoff && date <= now.getTime();
  }).sort((left, right) => Date.parse(right.lastCommitDate!) - Date.parse(left.lastCommitDate!) || left.name.localeCompare(right.name));
  return { local: recent.filter(branch => !branch.remote), remote: recent.filter(branch => branch.remote) };
}
