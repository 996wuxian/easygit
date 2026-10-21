import { memo, type RefObject } from 'react';
import type { ComparisonChange } from './model';

export const ChangeOverview = memo(function ChangeOverview({ changes, rowCount, viewportRef, height, rowHeight, onJump }: {
  changes: readonly ComparisonChange[];
  rowCount: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  height: number;
  rowHeight: number;
  onJump: (change: ComparisonChange) => void;
}) {
  const contentHeight = Math.max(height, rowCount * rowHeight);
  return <nav className="change-overview" aria-label="变更区域概览">
    <div className="change-overview-heading" title={`${changes.length} 个变更块，点击色块跳转`}><span aria-hidden="true">⋮</span></div>
    <div className="change-overview-track" style={{ height }}>
      <div className="change-overview-viewport" ref={viewportRef} aria-hidden="true" style={{ height: `${height / contentHeight * 100}%` }} />
      {changes.map((change, index) => {
        const kind = change.added && change.removed ? 'modified' : change.added ? 'added' : 'removed';
        const type = kind === 'modified' ? '修改' : kind === 'added' ? '新增' : '删除';
        const location = change.modifiedLine !== null ? `变更后第 ${change.modifiedLine} 行` : `原文件第 ${change.originalLine} 行`;
        const label = `变更块 ${index + 1}：${type}，${location}，新增 ${change.added} 行，删除 ${change.removed} 行`;
        return <button type="button" key={change.start} className={`change-overview-marker ${kind}`} aria-label={label} title={label}
          style={{ top: `clamp(0px, ${change.start * rowHeight / contentHeight * 100}%, calc(100% - 12px))`, height: `max(12px, ${(change.end - change.start) * rowHeight / contentHeight * 100}%)` }}
          onClick={() => onJump(change)} />;
      })}
    </div>
  </nav>;
});
