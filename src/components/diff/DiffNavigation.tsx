import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowDown, IconArrowUp, IconChevronLeft, IconChevronRight, IconSearch, IconX } from '@tabler/icons-react';
import { Syntax } from './Syntax';
import './navigation.css';

export interface TextMatch { line: number; start: number; end: number }
export interface ChangeRange { start: number; end: number }
export function changeHighlightClass(row: number, range?: ChangeRange): string {
  if (!range || row < range.start || row >= range.end) return '';
  return ` diff-change-current${row === range.start ? ' diff-change-start' : ''}${row === range.end - 1 ? ' diff-change-end' : ''}`;
}
const MATCH_LIMIT = 10_000;
export function findTextMatches(lines: readonly string[], query: string): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: TextMatch[] = [];
  for (let line = 0; line < lines.length; line++) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lines[line]))) {
      matches.push({ line, start: match.index, end: match.index + match[0].length });
      if (matches.length === MATCH_LIMIT) return matches;
    }
  }
  return matches;
}

export function useDiffNavigation(lines: readonly string[], changes: readonly number[], onJump: (line: number, start?: number) => void) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [changeIndex, setChangeIndex] = useState(-1);
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;
  const matches = useMemo(() => findTextMatches(lines, query), [lines, query]);
  useEffect(() => {
    setMatchIndex(matches.length ? 0 : -1);
    if (matches.length) jumpRef.current(matches[0].line, matches[0].start);
  }, [matches]);
  useEffect(() => setChangeIndex(-1), [changes]);
  const moveMatch = (direction: number) => {
    if (!matches.length) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next); jumpRef.current(matches[next].line, matches[next].start);
  };
  const moveChange = (direction: number) => {
    if (!changes.length) return;
    const next = changeIndex < 0 ? direction > 0 ? 0 : changes.length - 1 : (changeIndex + direction + changes.length) % changes.length;
    setChangeIndex(next); jumpRef.current(changes[next]);
  };
  return { query, setQuery, matches, matchIndex, changeIndex, changeCount: changes.length, current: matches[matchIndex], moveMatch, moveChange };
}

export function DiffNavigation({ navigation }: { navigation: ReturnType<typeof useDiffNavigation> }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="diff-navigation" role="group" aria-label="差异导航与搜索">
    <div className="diff-navigation-group">
      <button className="icon-button" aria-label="上一个变更" title="上一个变更" disabled={!navigation.changeCount} onClick={() => navigation.moveChange(-1)}><IconArrowUp size={14} /></button>
      <span className="diff-navigation-count" aria-label="变更位置">{navigation.changeIndex + 1}/{navigation.changeCount}</span>
      <button className="icon-button" aria-label="下一个变更" title="下一个变更" disabled={!navigation.changeCount} onClick={() => navigation.moveChange(1)}><IconArrowDown size={14} /></button>
    </div>
    <label className="diff-search-field"><IconSearch size={14} /><input ref={input} aria-label="在差异中搜索" placeholder="搜索差异…" value={navigation.query} onChange={event => navigation.setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); navigation.moveMatch(event.shiftKey ? -1 : 1); }
      if (event.key === 'Escape' && navigation.query) { event.preventDefault(); event.stopPropagation(); navigation.setQuery(''); }
    }} /></label>
    {navigation.query && <div className="diff-navigation-group">
      <span className="diff-navigation-count" role="status" aria-label="搜索匹配位置">{navigation.matchIndex + 1}/{navigation.matches.length}{navigation.matches.length === MATCH_LIMIT ? '+' : ''}</span>
      <button className="icon-button" aria-label="上一个匹配" title="上一个匹配 · Shift Enter" disabled={!navigation.matches.length} onClick={() => navigation.moveMatch(-1)}><IconArrowUp size={14} /></button>
      <button className="icon-button" aria-label="下一个匹配" title="下一个匹配 · Enter" disabled={!navigation.matches.length} onClick={() => navigation.moveMatch(1)}><IconArrowDown size={14} /></button>
      <button className="icon-button" aria-label="清除差异搜索" title="清除搜索" onClick={() => { navigation.setQuery(''); input.current?.focus(); }}><IconX size={14} /></button>
    </div>}
  </div>;
}

export function DiffText({ text, query = '', currentStart, highlight = true }: { text: string; query?: string; currentStart?: number; highlight?: boolean }) {
  const render = (value: string) => highlight ? <Syntax text={value} /> : value;
  if (!query) return render(text);
  const matches = findTextMatches([text], query);
  let end = 0;
  return <>{matches.map(match => {
    const before = text.slice(end, match.start); end = match.end;
    return <span key={match.start}>{render(before)}<mark className={`diff-search-match${currentStart === match.start ? ' current' : ''}`} data-search-start={match.start}>{text.slice(match.start, match.end)}</mark></span>;
  })}{render(text.slice(end))}</>;
}

export function DiffFileNavigation({ files, selected, onSelect }: { files: readonly { path: string }[]; selected: string | null; onSelect?: (path: string) => void }) {
  const index = files.findIndex(file => file.path === selected);
  return <div className="diff-file-navigation" role="group" aria-label="差异文件导航">
    <button className="icon-button" aria-label="上一个文件" title={index > 0 ? files[index - 1].path : '已是第一个文件'} disabled={!onSelect || index <= 0} onClick={() => onSelect?.(files[index - 1].path)}><IconChevronLeft size={14} /></button>
    <span className="diff-navigation-count">{index + 1}/{files.length}</span>
    <button className="icon-button" aria-label="下一个文件" title={index < files.length - 1 ? files[index + 1].path : '已是最后一个文件'} disabled={!onSelect || !files.length || index >= files.length - 1} onClick={() => onSelect?.(files[index + 1].path)}><IconChevronRight size={14} /></button>
  </div>;
}
