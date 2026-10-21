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
export interface GitCommitRef { name: string; remote: boolean }
export type CommitAction = 'soft' | 'mixed' | 'revert';
export interface GitCommit { hash: string; shortHash: string; subject: string; author: string; date: string; parents: string[]; refs: GitCommitRef[]; local: boolean; remote: boolean }
export interface MergePreview { source: string; target: string; sourceHead: string; targetHead: string; commits: GitCommit[]; commitCount: number }
export interface MergeResult { snapshot: RepositorySnapshot; merged: boolean; conflicted: boolean; error: string | null }
export interface RepositorySnapshot {
  path: string;
  name: string;
  branch: string;
  head: string | null;
  gitVersion: string;
  files: GitFile[];
  branches: GitBranch[];
  commits: GitCommit[];
  stashCount: number;
  remote: string | null;
  hasUpstream: boolean;
  upstream: { name: string; hash: string } | null;
  ahead: number;
  behind: number;
  operation: string | null;
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
  checkout: (path: string, branch: string) => invokeCommand<RepositorySnapshot>('checkout_branch', { path, branch }),
  createBranch: (path: string, branch: string) => invokeCommand<RepositorySnapshot>('create_branch', { path, branch }),
  fetch: (path: string) => invokeCommand<RepositorySnapshot>('fetch_repository', { path }),
  pull: (path: string) => invokeCommand<PullResult>('pull_repository', { path }),
  push: (path: string) => invokeCommand<RepositorySnapshot>('push_repository', { path }),
  previewMerge: (path: string, source: string, target: string) => invokeCommand<MergePreview>('preview_merge', { path, source, target }),
  mergeBranches: (path: string, source: string, target: string, sourceHead: string, targetHead: string) => invokeCommand<MergeResult>('merge_branches', { path, source, target, sourceHead, targetHead }),
  commitFiles: (path: string, commit: string) => invokeCommand<string[]>('read_commit_files', { path, commit }),
};
