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
export interface GitBranch { name: string; current: boolean; remote: boolean }
export interface GitCommit { hash: string; shortHash: string; subject: string; author: string; date: string }
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
  ahead: number;
  behind: number;
  operation: string | null;
}
export interface BootstrapResult { gitAvailable: boolean; gitVersion: string | null; error: string | null }
export function emptyRepository(): RepositorySnapshot {
  return { path: '', name: '', branch: '', head: null, gitVersion: '', files: [], branches: [], commits: [], stashCount: 0, remote: null, hasUpstream: false, ahead: 0, behind: 0, operation: null };
}
export const isDesktop = () => '__TAURI_INTERNALS__' in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new Error('请在 easygit 桌面应用中打开本地仓库。');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export const git = {
  bootstrap: () => call<BootstrapResult>('bootstrap'),
  open: (path: string) => call<RepositorySnapshot>('open_repository', { path }),
  diff: (path: string, file: string, staged: boolean) => call<string>('read_diff', { path, file, staged }),
  stage: (path: string, files: string[]) => call<RepositorySnapshot>('stage_files', { path, files }),
  unstage: (path: string, files: string[]) => call<RepositorySnapshot>('unstage_files', { path, files }),
  discard: (path: string, files: string[]) => call<RepositorySnapshot>('discard_changes', { path, files }),
  commit: (path: string, message: string) => call<RepositorySnapshot>('create_commit', { path, message }),
  checkout: (path: string, branch: string) => call<RepositorySnapshot>('checkout_branch', { path, branch }),
  fetch: (path: string) => call<RepositorySnapshot>('fetch_repository', { path }),
  push: (path: string) => call<RepositorySnapshot>('push_repository', { path }),
};
