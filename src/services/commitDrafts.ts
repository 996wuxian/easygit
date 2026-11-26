import { useSyncExternalStore } from 'react';
import { COMMIT_DRAFTS_KEY, appStorage } from './storage';

let lastStoredRaw: string | null | undefined;
let cachedDrafts: Record<string, string> = {};
const listeners = new Set<() => void>();

function readDrafts(): Record<string, string> {
  let raw: string | null;
  try {
    raw = appStorage.getItem(COMMIT_DRAFTS_KEY);
  } catch {
    return cachedDrafts;
  }
  if (raw === lastStoredRaw) return cachedDrafts;
  lastStoredRaw = raw;
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    cachedDrafts = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
  } catch {
    cachedDrafts = {};
  }
  return cachedDrafts;
}

function writeDrafts(next: Record<string, string>, onError?: (error: unknown) => void) {
  const raw = JSON.stringify(next);
  cachedDrafts = next;
  try {
    appStorage.setItem(COMMIT_DRAFTS_KEY, raw);
    lastStoredRaw = raw;
  } catch (error) {
    onError?.(error);
  }
  for (const listener of listeners) listener();
}

export function getCommitDraft(repositoryPath: string): string {
  if (!repositoryPath) return '';
  const drafts = readDrafts();
  return Object.hasOwn(drafts, repositoryPath) ? drafts[repositoryPath] : '';
}

export function setCommitDraft(repositoryPath: string, message: string, onError?: (error: unknown) => void) {
  if (!repositoryPath) return;
  const current = readDrafts();
  const previous = Object.hasOwn(current, repositoryPath) ? current[repositoryPath] : '';
  if (previous === message) return;
  writeDrafts({ ...current, [repositoryPath]: message }, onError);
}

export function removeCommitDraft(repositoryPath: string, onError?: (error: unknown) => void) {
  if (!repositoryPath) return;
  const current = readDrafts();
  if (!Object.hasOwn(current, repositoryPath)) return;
  const next = { ...current };
  delete next[repositoryPath];
  writeDrafts(next, onError);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCommitDraft(repositoryPath: string): string {
  return useSyncExternalStore(
    subscribe,
    () => getCommitDraft(repositoryPath),
    () => '',
  );
}
