import { useEffect, useState } from 'react';
import { IconArrowRight, IconGitBranch, IconGitMerge, IconLoader2 } from '@tabler/icons-react';
import { Dialog } from '../Dialog';
import { git, type GitCommit, type MergePreview } from '../../services/git';

export function BranchMergeDialog({
  path, source, target, busy, hasChanges, operation, onClose, onConfirm, onSelectCommit,
}: {
  path: string; source: string; target: string; busy: boolean; hasChanges: boolean; operation: string | null;
  onClose: () => void; onConfirm: (preview: MergePreview) => Promise<boolean>; onSelectCommit: (commit: GitCommit) => void;
}) {
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    setLoading(true);
    void git.previewMerge(path, source, target).then(value => {
      if (active) setPreview(value);
    }).catch(reason => {
      if (active) setError(String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, source, target]);

  const canConfirm = Boolean(preview?.commitCount && !loading && !error && !busy && !hasChanges && !operation);
  return <Dialog title="合并分支" className="branch-merge-dialog" onClose={busy ? () => {} : onClose}>
    <div className="merge-branch-route"><span><small>源分支</small><code><IconGitBranch size={15} />{source}</code></span><IconArrowRight size={17} /><span><small>目标分支</small><code><IconGitBranch size={15} />{target}</code></span></div>
    <p className="dialog-description">将源分支中目标分支尚未包含的提交合并到目标分支。确认前请检查提交列表。</p>
    {loading && <div className="merge-loading"><IconLoader2 size={18} className="spin" />正在读取待合并提交…</div>}
    {error && <div className="merge-error" role="alert">{error}</div>}
    {preview && <>
      <div className="merge-preview-heading"><strong>待合并提交</strong><span>{preview.commitCount} 个</span></div>
      {preview.commitCount === 0 ? <div className="merge-empty">源分支没有新的提交可以合并。</div> : <div className="merge-commit-list">
        {preview.commits.map(commit => <button className="merge-commit-row" key={commit.hash} onClick={() => onSelectCommit(commit)} title="查看提交详情和改动文件">
          <span className="merge-commit-copy"><strong>{commit.subject}</strong><small>{commit.author} · {new Date(commit.date).toLocaleString('zh-CN')}</small></span>
          <code>{commit.shortHash}</code>
        </button>)}
        {preview.commitCount > preview.commits.length && <div className="merge-truncated">列表显示前 {preview.commits.length} 个提交，共 {preview.commitCount} 个。</div>}
      </div>}
      <div className="merge-preview-note">
        <span>目标分支当前提交</span><code>{preview.targetHead.slice(0, 12)}</code>
        <span>源分支当前提交</span><code>{preview.sourceHead.slice(0, 12)}</code>
      </div>
    </>}
    {hasChanges && <div className="merge-warning">工作区有未提交更改。请先提交、暂存或撤回这些更改，再合并分支。</div>}
    {operation && <div className="merge-warning">当前有未完成的 {operation} 操作，请先完成或退出该操作。</div>}
    <div className="dialog-action-row merge-dialog-actions">
      <button className="primary-button" disabled={!canConfirm} onClick={() => { if (preview) void onConfirm(preview).then(success => { if (success) onClose(); }); }}>
        {busy ? <IconLoader2 size={15} className="spin" /> : <IconGitMerge size={15} />}{busy ? '正在合并…' : '确认合并'}
      </button>
    </div>
  </Dialog>;
}
