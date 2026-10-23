export interface GitFile {
  path: string;
  oldPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}
export interface GitBranch { name: string; current: boolean; remote: boolean; lastCommitDate: string | null }
export interface BranchInfo { head: string; upstream: string | null }
export type BranchAction = { kind: 'rename'; name: string } | { kind: 'delete' } | { kind: 'upstream'; upstream: string } | { kind: 'unset-upstream' };
export interface BranchRequest {
  branch: string; expectedHead: string; expectedUpstream: string | null;
  expectedBranch: string; expectedCurrentHead: string | null; action: BranchAction;
}
export interface GitCommitRef { name: string; remote: boolean }
export type CommitAction = 'soft' | 'mixed' | 'revert';
export interface GitCommit { hash: string; shortHash: string; subject: string; author: string; date: string; parents: string[]; refs: GitCommitRef[]; local: boolean; remote: boolean }
export interface MergePreview { source: string; sourceRemote: boolean; target: string; targetRemote: boolean; sourceHead: string; targetHead: string; localTarget: string; localTargetHead: string | null; targetNeedsSync: boolean; commits: GitCommit[]; commitCount: number }
export interface MergeResult { snapshot: RepositorySnapshot; merged: boolean; conflicted: boolean; error: string | null }
export interface BranchReference { name: string; remote: boolean }
export interface StashEntry { hash: string; selector: string; message: string; date: string }
export type StashAction = 'apply' | 'pop' | 'drop';
export type OperationAction = 'continue' | 'abort' | 'skip';
export interface OperationRequest { operation: string; token: string; revision: string; head: string | null; branch: string; action: OperationAction }
export interface HistoryQuery { reference: BranchReference | null; query: string; offset: number; expectedKey: string | null }
export interface HistoryPage { commits: GitCommit[]; nextOffset: number | null; key: string }
export interface RevisionFile { path: string; oldPath: string | null; status: string }
export interface RevisionComparison { base: string; target: string; files: RevisionFile[] }
export interface RepositorySnapshot {
  revision?: string;
  path: string;
  name: string;
  branch: string;
  head: string | null;
  gitVersion: string;
  files: GitFile[];
  branches: GitBranch[];
  commits: GitCommit[];
  stashCount: number;
  stashRevision?: string;
  remote: string | null;
  hasUpstream: boolean;
  upstream: { name: string; hash: string } | null;
  ahead: number;
  behind: number;
  operation: string | null;
  operationToken?: string | null;
}
export interface PullResult { snapshot: RepositorySnapshot; conflicted: boolean; error: string | null }
export interface BootstrapResult { gitAvailable: boolean; gitVersion: string | null; error: string | null }
export type ConflictResolution = 'content' | 'ours' | 'theirs' | 'working' | 'delete';
export interface ConflictFile {
  ours: string | null; theirs: string | null; working: string | null;
  oursExists: boolean; theirsExists: boolean; workingExists: boolean;
  binary: boolean; markerSize: number; revision: string;
}
export interface FileComparison {
  diff: string;
  unchanged: string | null;
  binary: boolean;
  originalExists: boolean;
  modifiedExists: boolean;
}
export interface DiffBlock {
  originalStart: number; modifiedStart: number;
  removed: string[]; added: string[];
  originalNoNewline: boolean; modifiedNoNewline: boolean;
}
export function emptyRepository(): RepositorySnapshot {
  return { path: '', name: '', branch: '', head: null, gitVersion: '', files: [], branches: [], commits: [], stashCount: 0, remote: null, hasUpstream: false, upstream: null, ahead: 0, behind: 0, operation: null };
}
export const isDesktop = () => '__TAURI_INTERNALS__' in window;

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new Error('请在 easygit 桌面应用中打开本地仓库。');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export const git = {
  bootstrap: () => invokeCommand<BootstrapResult>('bootstrap'),
  open: (path: string) => invokeCommand<RepositorySnapshot>('open_repository', { path }),
  openDirectory: (path: string) => invokeCommand<void>('open_repository_directory', { path }),
  diff: (path: string, file: string, staged: boolean) => invokeCommand<string>('read_diff', { path, file, staged }),
  comparison: (path: string, file: string, staged: boolean) => invokeCommand<FileComparison>('read_file_comparison', { path, file, staged }),
  stagedDiff: (path: string) => invokeCommand<string>('read_staged_diff', { path }),
  stage: (path: string, files: string[]) => invokeCommand<RepositorySnapshot>('stage_files', { path, files }),
  unstage: (path: string, files: string[]) => invokeCommand<RepositorySnapshot>('unstage_files', { path, files }),
  discard: (path: string, files: string[]) => invokeCommand<RepositorySnapshot>('discard_changes', { path, files }),
  discardBlock: (path: string, file: string, block: DiffBlock) => invokeCommand<RepositorySnapshot>('discard_diff_block', { path, file, block }),
  conflict: (path: string, file: string) => invokeCommand<ConflictFile>('read_conflict', { path, file }),
  resolveConflict: (path: string, file: string, revision: string, resolution: ConflictResolution, content?: string) => invokeCommand<RepositorySnapshot>('resolve_conflict', { path, file, revision, resolution, content: content ?? null }),
  commit: (path: string, message: string) => invokeCommand<RepositorySnapshot>('create_commit', { path, message }),
  actOnCommit: (path: string, commit: string, expectedHead: string, expectedBranch: string, action: CommitAction) => invokeCommand<RepositorySnapshot>('act_on_commit', { path, commit, expectedHead, expectedBranch, action }),
  checkout: (path: string, branch: string, remote = false) => invokeCommand<RepositorySnapshot>('checkout_branch', { path, branch, remote }),
  createBranch: (path: string, branch: string) => invokeCommand<RepositorySnapshot>('create_branch', { path, branch }),
  branchInfo: (path: string, branch: string) => invokeCommand<BranchInfo>('read_branch_info', { path, branch }),
  manageBranch: (path: string, request: BranchRequest) => invokeCommand<RepositorySnapshot>('manage_branch', { path, request }),
  fetch: (path: string) => invokeCommand<RepositorySnapshot>('fetch_repository', { path }),
  pull: (path: string) => invokeCommand<PullResult>('pull_repository', { path }),
  push: (path: string) => invokeCommand<RepositorySnapshot>('push_repository', { path }),
  previewMerge: (path: string, source: string, target: string, sourceRemote = false, targetRemote = false) => invokeCommand<MergePreview>('preview_merge', { path, source, target, sourceRemote, targetRemote }),
  mergeBranches: (path: string, preview: MergePreview) => {
    const { source, target, sourceRemote, targetRemote, sourceHead, targetHead, localTarget, localTargetHead } = preview;
    return invokeCommand<MergeResult>('merge_branches', { path, request: { source, target, sourceRemote, targetRemote, sourceHead, targetHead, localTarget, localTargetHead } });
  },
  commitFiles: (path: string, commit: string) => invokeCommand<string[]>('read_commit_files', { path, commit }),
  commitDiff: (path: string, commit: string, file: string) => invokeCommand<string>('read_commit_diff', { path, commit, file }),
  history: (path: string, query: HistoryQuery) => invokeCommand<HistoryPage>('read_history_page', { path, query }),
  compareBranches: (path: string, base: BranchReference, target: BranchReference) => invokeCommand<RevisionComparison>('compare_branches', { path, base: base.name, baseRemote: base.remote, target: target.name, targetRemote: target.remote }),
  comparisonDiff: (path: string, base: string, target: string, file: string) => invokeCommand<string>('read_comparison_diff', { path, base, target, file }),
  stashes: (path: string) => invokeCommand<StashEntry[]>('list_stashes', { path }),
  saveStash: (path: string, message: string, includeUntracked: boolean) => invokeCommand<PullResult>('save_stash', { path, message, includeUntracked }),
  stashDiff: (path: string, entry: StashEntry) => invokeCommand<string>('read_stash_diff', { path, selector: entry.selector, hash: entry.hash }),
  actOnStash: (path: string, entry: StashEntry, action: StashAction) => invokeCommand<PullResult>('act_on_stash', { path, selector: entry.selector, hash: entry.hash, action }),
  actOnOperation: (path: string, request: OperationRequest) => invokeCommand<PullResult>('act_on_operation', { path, request }),
};
