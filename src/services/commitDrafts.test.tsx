// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommitDraft, removeCommitDraft, setCommitDraft, useCommitDraft } from './commitDrafts';
import { COMMIT_DRAFTS_KEY, appStorage } from './storage';

function DraftViewer({ path }: { path: string }) {
  const draft = useCommitDraft(path);
  return <output data-testid="draft">{draft}</output>;
}

describe('commitDrafts external store', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
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

  it('persists, isolates, and removes drafts per repository path', () => {
    setCommitDraft('X:/Alpha', 'feat: alpha');
    setCommitDraft('X:/Beta', 'fix: beta');

    expect(getCommitDraft('X:/Alpha')).toBe('feat: alpha');
    expect(getCommitDraft('X:/Beta')).toBe('fix: beta');
    expect(getCommitDraft('')).toBe('');

    removeCommitDraft('X:/Alpha');
    expect(getCommitDraft('X:/Alpha')).toBe('');
    expect(getCommitDraft('X:/Beta')).toBe('fix: beta');
  });

  it('preserves the in-memory draft instead of rolling back when appStorage.setItem throws', async () => {
    localStorage.setItem(COMMIT_DRAFTS_KEY, JSON.stringify({ 'X:/Alpha': 'old draft' }));
    await act(async () => root.render(<DraftViewer path="X:/Alpha" />));
    expect(host.querySelector('[data-testid="draft"]')?.textContent).toBe('old draft');

    const setItemSpy = vi.spyOn(appStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const onError = vi.fn();

    try {
      await act(async () => {
        setCommitDraft('X:/Alpha', 'new typed draft', onError);
      });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-testid="draft"]')?.textContent).toBe('new typed draft');
      expect(getCommitDraft('X:/Alpha')).toBe('new typed draft');

      await act(async () => {
        setCommitDraft('X:/Alpha', 'new typed draft!', onError);
      });
      expect(host.querySelector('[data-testid="draft"]')?.textContent).toBe('new typed draft!');
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('handles corrupted JSON without repeatedly throwing and guards Object.prototype keys', () => {
    localStorage.setItem(COMMIT_DRAFTS_KEY, '{corrupted-json');
    const parseSpy = vi.spyOn(JSON, 'parse');

    try {
      expect(getCommitDraft('X:/Alpha')).toBe('');
      expect(getCommitDraft('X:/Alpha')).toBe('');
      expect(getCommitDraft('toString')).toBe('');
      expect(getCommitDraft('constructor')).toBe('');
      expect(parseSpy).toHaveBeenCalledTimes(1);

      setCommitDraft('toString', 'safe value');
      expect(getCommitDraft('toString')).toBe('safe value');
      removeCommitDraft('toString');
      expect(getCommitDraft('toString')).toBe('');
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('only re-renders subscribed draft consumers on keystroke updates', async () => {
    let parentRenders = 0;
    function Parent() {
      parentRenders++;
      return <DraftViewer path="X:/Alpha" />;
    }

    await act(async () => root.render(<Parent />));
    expect(parentRenders).toBe(1);

    await act(async () => {
      setCommitDraft('X:/Alpha', 'feat: isolated');
    });
    expect(parentRenders).toBe(1);
    expect(host.querySelector('[data-testid="draft"]')?.textContent).toBe('feat: isolated');
  });
});
