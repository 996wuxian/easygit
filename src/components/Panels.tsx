import { IconArrowDown, IconCheck, IconCircleCheck, IconCode, IconFile, IconFileCode, IconGitBranch, IconHistory, IconStack2, IconTerminal2, IconX } from '@tabler/icons-react';
import type { Activity } from '../services/useRepository';
import './panels.css';

export { ChangesPanel } from './ChangesPanel';

export { DiffPanel } from './diff/DiffPanel';

export { BranchesPanel } from './branches/BranchesPanel';

export { CommitsPanel } from './commits/CommitsPanel';
export { ScriptsPanel } from './scripts/ScriptsPanel';

export { StashPanel } from './stash/StashPanel';

export function ActivityPanel({ activities }: { activities: Activity[] }) {
  return <div className="activity-content">{activities.length ? activities.slice(0, 8).map(item => <div className="activity-row" key={item.id}>{item.error ? <IconX size={15} className="error-color" /> : <IconCheck size={15} className="success-color" />}<div className="activity-message">{item.label}{item.details && <details className="activity-error-details"><summary>原始错误详情</summary><pre>{item.details}</pre></details>}</div><time>{item.time}</time></div>) : <div className="clean-state"><IconArrowDown size={26} stroke={1.3} /><strong>暂无操作记录</strong><span>仓库操作的结果会记录在这里</span></div>}</div>;
}

export const panelIcons = { changes: IconFile, diff: IconCode, branches: IconGitBranch, commits: IconHistory, stash: IconStack2, activity: IconCircleCheck, scripts: IconTerminal2, files: IconFileCode };
