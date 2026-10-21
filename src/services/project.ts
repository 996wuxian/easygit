import { invokeCommand } from './git';

export interface ProjectScript { name: string; command: string }
export interface ProjectScriptsInfo { packageFound: boolean; manager: 'npm' | 'pnpm' | 'yarn' | 'bun'; scripts: ProjectScript[] }
export const project = {
  scripts: (path: string) => invokeCommand<ProjectScriptsInfo>('read_project_scripts', { path }),
  runScript: (path: string, script: ProjectScript, manager: ProjectScriptsInfo['manager']) => invokeCommand<void>('run_project_script', { path, name: script.name, expectedCommand: script.command, expectedManager: manager }),
};
