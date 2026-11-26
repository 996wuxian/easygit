import type { GitFile } from '../../services/git';

export interface ProjectFileTarget { path: string }

export function canLocateFileChange(file: GitFile): boolean {
  if (file.conflicted) return file.indexStatus !== 'D' || file.worktreeStatus !== 'D';
  return file.worktreeStatus !== 'D' && (file.indexStatus !== 'D' || file.unstaged);
}

function compareTreePaths(left: string, right: string): number {
  const a = left.split('/');
  const b = right.split('/');
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const aIsDirectory = index < a.length - 1;
    const bIsDirectory = index < b.length - 1;
    if (aIsDirectory !== bIsDirectory) return aIsDirectory ? -1 : 1;
    if (a[index] === b[index]) continue;
    const aLower = a[index].toLowerCase();
    const bLower = b[index].toLowerCase();
    if (aLower !== bLower) return aLower < bLower ? -1 : 1;
    return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function getProjectFileChanges(files: readonly GitFile[]) {
  const byPath = new Map(files.map(file => [file.path, file]));
  const paths = Array.from(byPath.values()).filter(canLocateFileChange).map(file => file.path).sort(compareTreePaths);
  return { count: byPath.size, paths };
}
