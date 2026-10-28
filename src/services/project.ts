import { invokeCommand } from './git';
import type { RepositorySnapshot } from './git';

export interface ProjectEntry { name: string; path: string; directory: boolean; blocked: boolean; ignored: boolean }
export interface ProjectListing { entries: ProjectEntry[]; truncated: boolean }
export interface ProjectImage { mime: string; dataUrl: string; size: number }
export interface ProjectText { content: string | null; revision: string; bom: boolean; lineEnding: 'lf' | 'crlf'; reason: string | null; image?: ProjectImage | null }
export interface SavedProjectText { file: ProjectText; snapshot: RepositorySnapshot | null; refreshError: string | null }
export interface DeletedProjectEntry { snapshot: RepositorySnapshot | null; refreshError: string | null }
export type FileSearchMode = 'name' | 'content';
export interface FilePosition { line: number; column: number; length: number }
export interface FileSearchMatch {
  path: string; line: number | null; column: number | null; length: number | null;
  preview: string; matchStart: number; matchLength: number;
}
export interface FileSearchRequest {
  path: string; client: string; generation: number; query: string; mode: FileSearchMode;
  showIgnored: boolean; continuation: boolean;
}
export interface FileSearchBatch {
  results: FileSearchMatch[]; complete: boolean; truncated: boolean;
  scannedFiles: number; totalFiles: number; skippedFiles: number; limitedFiles: number;
}

export interface ProjectScript { name: string; command: string }
export interface ProjectScriptsInfo { packageFound: boolean; manager: 'npm' | 'pnpm' | 'yarn' | 'bun'; scripts: ProjectScript[] }
export const project = {
  search: (request: FileSearchRequest) => invokeCommand<FileSearchBatch>('search_project_files', { request }),
  cancelSearch: (client: string, generation: number) => invokeCommand<void>('cancel_project_search', { client, generation }),
  files: (path: string, directory = '', showIgnored = false, query = '') => invokeCommand<ProjectListing>('list_project_files', { path, directory, showIgnored, query }),
  readFile: (path: string, file: string) => invokeCommand<ProjectText>('read_project_file', { path, file }),
  entryPath: (path: string, file: string) => invokeCommand<string>('project_entry_path', { path, file }),
  revealEntry: (path: string, file: string) => invokeCommand<void>('reveal_project_entry', { path, file }),
  copyEntry: (path: string, file: string) => invokeCommand<void>('copy_project_entry', { path, file }),
  deleteEntry: (path: string, file: string, directory: boolean) => invokeCommand<DeletedProjectEntry>('delete_project_entry', { path, file, directory }),
  saveFile: (path: string, file: string, revision: string, content: string) => invokeCommand<SavedProjectText>('save_project_file', { path, file, revision, content }),
  scripts: (path: string) => invokeCommand<ProjectScriptsInfo>('read_project_scripts', { path }),
  runScript: (path: string, script: ProjectScript, manager: ProjectScriptsInfo['manager']) => invokeCommand<void>('run_project_script', { path, name: script.name, expectedCommand: script.command, expectedManager: manager }),
};
