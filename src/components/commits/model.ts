import type { CommitAction, GitCommit, RepositorySnapshot } from '../../services/git';

export function commitActionReason(snapshot: RepositorySnapshot, commit: GitCommit, action: CommitAction): string {
  if (snapshot.operation || snapshot.files.some(file => file.conflicted)) return '请先完成当前 Git 操作及冲突处理';
  if (snapshot.branch.startsWith('detached@')) return '请先切换到本地分支';
  if (!commit.local || commit.remote) return '仅支持当前本地分支中未推送的提交';
  if (action !== 'revert' && commit.hash !== snapshot.head) return '仅支持撤回最新提交，较早提交请使用反向提交';
  if (action === 'revert' && commit.parents.length > 1) return '合并提交需要选择主线父提交，暂不支持反向提交';
  if (action === 'revert' && snapshot.files.length) return '反向提交需要干净的工作区，请先处理未提交更改';
  return '';
}

export function commitStatus(commit: GitCommit, hasUpstream: boolean) {
  if (!hasUpstream) return { label: '本地提交', kind: 'local' };
  if (commit.local && commit.remote) return { label: '已同步', kind: 'synced' };
  return commit.remote ? { label: '待拉取', kind: 'incoming' } : { label: '待推送', kind: 'outgoing' };
}

export function buildCommitGraph(commits: readonly GitCommit[]) {
  let lanes: string[] = [];
  let columns = 1;
  const rows = commits.map(commit => {
    let column = lanes.indexOf(commit.hash);
    const newLane = column === -1;
    if (newLane) { column = lanes.length; lanes.push(commit.hash); }
    const before = [...lanes];
    const after = lanes.filter(hash => hash !== commit.hash);
    commit.parents.forEach((hash, index) => {
      if (!after.includes(hash)) after.splice(Math.min(column + index, after.length), 0, hash);
    });
    const paths: string[] = [];
    const x = (index: number) => 12 + index * 12;
    before.forEach((hash, index) => {
      if (!(newLane && index === column)) paths.push(`M${x(index)} 0V28`);
      if (hash !== commit.hash) {
        paths.push(`M${x(index)} 28C${x(index)} 42 ${x(after.indexOf(hash))} 42 ${x(after.indexOf(hash))} 56`);
      }
    });
    commit.parents.forEach(hash => {
      paths.push(`M${x(column)} 28C${x(column)} 42 ${x(after.indexOf(hash))} 42 ${x(after.indexOf(hash))} 56`);
    });
    columns = Math.max(columns, before.length, after.length);
    lanes = after;
    return { column, paths };
  });
  return { width: columns * 12 + 12, rows };
}
