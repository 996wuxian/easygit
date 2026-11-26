// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRepository, type RepositorySnapshot } from '../services/git';
import { BranchesPanel } from './branches/BranchesPanel';
import { CommitsPanel } from './commits/CommitsPanel';

describe('date formatting safety in BranchesPanel and CommitsPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders BranchesPanel without throwing when a branch has an invalid lastCommitDate', async () => {
    const snapshot: RepositorySnapshot = {
      ...emptyRepository(),
      path: 'X:/repo',
      branch: 'main',
      head: 'abc1234',
      branches: [
        { name: 'main', remote: false, current: true, lastCommitDate: 'not-a-valid-date', head: 'abc1234' },
        { name: 'feature/ok', remote: false, current: false, lastCommitDate: new Date().toISOString(), head: 'def5678' },
      ],
    };

    await act(async () => {
      root.render(<BranchesPanel snapshot={snapshot} busy={false} searchQuery="main" onCheckout={vi.fn()} />);
    });

    expect(host.textContent).toContain('main');
    expect(host.querySelectorAll('time')).toHaveLength(0);
  });

  it('renders CommitsPanel without throwing when commits have empty or unparseable dates', async () => {
    const snapshot: RepositorySnapshot = {
      ...emptyRepository(),
      path: 'X:/repo',
      branch: 'main',
      head: 'abc1234',
      commits: [
        { hash: 'abc1234', shortHash: 'abc1234', subject: 'corrupted date commit', author: 'dev', date: 'invalid-date', parents: [], refs: [], local: true, remote: false },
        { hash: 'def5678', shortHash: 'def5678', subject: 'empty date commit', author: 'dev', date: '', parents: [], refs: [], local: true, remote: false },
      ],
    };

    await act(async () => {
      root.render(
        <CommitsPanel
          snapshot={snapshot}
          busy={false}
          onSelect={vi.fn()}
          onAction={vi.fn(async () => false)}
          notify={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain('corrupted date commit');
    expect(host.textContent).toContain('empty date commit');
    expect(host.textContent).toContain('invalid-date');
  });
});
