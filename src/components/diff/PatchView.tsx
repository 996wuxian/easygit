import { IconLoader2 } from '@tabler/icons-react';
import { UnifiedDiff } from './UnifiedDiff';
import './inspection.css';

export function PatchView({ diff, loading, error, showFileHeaders = false }: { diff: string; loading: boolean; error: string | null; showFileHeaders?: boolean }) {
  return <div className="revision-patch" aria-label="只读代码差异" aria-busy={loading}>
    {loading ? <div className="inspection-state"><IconLoader2 className="spin" size={20} />正在读取差异…</div>
      : error ? <div className="inspection-state error-color" role="alert">{error}</div>
        : diff ? <UnifiedDiff diff={diff} showFileHeaders={showFileHeaders} /> : <div className="inspection-state">没有代码差异</div>}
  </div>;
}
