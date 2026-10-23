import { describe, expect, it } from 'vitest';
import { emptyRepository, type GitCommit } from '../../services/git';
import { buildCommitGraph, cherryPickReason, commitActionReason, commitStatus } from './model';

const commit = (hash: string, parents: string[], local = true, remote = false): GitCommit => ({ hash, shortHash: hash, subject: hash, author: 'Author', date: '2026-10-21T00:00:00Z', parents, refs: [], local, remote });

describe('commit history presentation', () => {
  it('permits picking commits from other branches and protects existing history and merge commits', () => {
    const state = { ...emptyRepository(), branch: 'main', head: 'tip' };
    expect(cherryPickReason(state, commit('other', ['base'], false, true))).toBe('');
    expect(cherryPickReason(state, commit('old', ['base']))).toContain('已包含');
    expect(cherryPickReason(state, commit('merge', ['one', 'two'], false))).toContain('主线');
    expect(cherryPickReason({ ...state, branch: 'detached@tip' }, commit('other', [], false))).toContain('本地分支');
    expect(cherryPickReason({ ...state, operation: 'rebase' }, commit('other', [], false))).toContain('Git 操作');
  });
  it('limits undo to the unpublished tip and permits reverting older unpublished commits only when clean', () => {
    const state = { ...emptyRepository(), branch: 'main', head: 'tip' };
    expect(commitActionReason(state, commit('tip', ['old']), 'soft')).toBe('');
    expect(commitActionReason(state, commit('old', ['base']), 'mixed')).toContain('最新');
    expect(commitActionReason(state, commit('old', ['base']), 'revert')).toBe('');
    expect(commitActionReason(state, commit('tip', ['old'], true, true), 'soft')).toContain('已推送');
    expect(commitActionReason(state, commit('tip', ['old'], true, true), 'revert')).toBe('');
    expect(commitActionReason(state, commit('remote', ['old'], false, true), 'revert')).toContain('不属于');
    expect(commitActionReason(state, commit('tip', ['left', 'right']), 'revert')).toContain('合并提交');
    expect(commitActionReason({ ...state, operation: 'merge' }, commit('tip', []), 'soft')).toContain('Git 操作');
    expect(commitActionReason({ ...state, branch: 'detached@tip' }, commit('tip', []), 'soft')).toContain('本地分支');
    expect(commitActionReason({ ...state, files: [{ path: 'new', oldPath: null, indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, untracked: true, conflicted: false }] }, commit('tip', []), 'revert')).toContain('干净');
  });
  it('distinguishes shared, outgoing, incoming, and local-only history', () => {
    expect(commitStatus(commit('a', [], true, true), true).label).toBe('已同步');
    expect(commitStatus(commit('a', []), true).label).toBe('待推送');
    expect(commitStatus(commit('b', [], false, true), true).label).toBe('待拉取');
    expect(commitStatus(commit('a', []), false).label).toBe('本地提交');
  });

  it('joins divergent tips at their common parent without inventing an edge between the tips', () => {
    const graph = buildCommitGraph([commit('local', ['base']), commit('remote', ['base'], false, true), commit('base', [])]);
    expect(graph.rows.map(row => row.column)).toEqual([0, 1, 0]);
    expect(graph.width).toBe(36);
    expect(graph.rows[0].paths).toEqual(['M12 28C12 42 12 42 12 56']);
    expect(graph.rows[1].paths).toContain('M24 28C24 42 12 42 12 56');
    expect(graph.rows[2].paths).toEqual(['M12 0V28']);
  });

  it('shows both parents of a merge and handles empty histories', () => {
    const graph = buildCommitGraph([commit('merge', ['first', 'second']), commit('first', ['base']), commit('second', ['base']), commit('base', [])]);
    expect(graph.rows[0].paths).toHaveLength(2);
    expect(graph.rows.map(row => row.column)).toEqual([0, 0, 1, 0]);
    expect(buildCommitGraph([])).toEqual({ width: 24, rows: [] });
  });
});
