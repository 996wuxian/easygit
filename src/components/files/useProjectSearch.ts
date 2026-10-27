import { useCallback, useEffect, useRef, useState } from 'react';
import { project, type FileSearchBatch, type FileSearchMatch, type FileSearchMode, type FileSearchRequest } from '../../services/project';

interface SearchState {
  key: string; status: 'waiting' | 'loading' | 'ready' | 'error';
  results: FileSearchMatch[]; progress: FileSearchBatch | null; error: string;
}
interface SearchTask {
  key: string; request: FileSearchRequest; stopped: boolean; busy: boolean;
  started: boolean; complete: boolean; loaded: number;
}
const empty = (key: string): SearchState => ({ key, status: 'waiting', results: [], progress: null, error: '' });

export function useProjectSearch(path: string, query: string, mode: FileSearchMode, showIgnored: boolean, refreshKey: string) {
  const [client] = useState(() => crypto.randomUUID());
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([path, query, mode, showIgnored, refreshKey, retry]);
  const [state, setState] = useState<SearchState>(() => empty(key));
  const generation = useRef(0);
  const active = useRef<SearchTask | null>(null);

  const scan = useCallback(async (task: SearchTask) => {
    if (task.stopped || task.busy || task.complete) return;
    task.busy = true;
    const target = task.loaded + 50;
    setState(current => ({ ...(current.key === task.key ? current : empty(task.key)), status: 'loading', error: '' }));
    try {
      while (!task.stopped && !task.complete && task.loaded < target) {
        const request = { ...task.request, continuation: task.started };
        task.started = true;
        const batch = await project.search(request);
        if (task.stopped) return;
        task.complete = batch.complete;
        task.loaded += batch.results.length;
        setState(current => ({
          key: task.key, status: 'loading', error: '', progress: batch,
          results: [...(current.key === task.key ? current.results : []), ...batch.results],
        }));
        // Sparse searches publish progress and yield between bounded native pages.
        if (!task.complete && task.loaded < target) await new Promise<void>(resolve => window.setTimeout(resolve, 16));
      }
      if (!task.stopped) setState(current => current.key === task.key ? { ...current, status: 'ready' } : current);
    } catch (error) {
      if (!task.stopped) setState(current => ({ ...(current.key === task.key ? current : empty(task.key)), status: 'error', error: String(error) }));
    } finally { task.busy = false; }
  }, []);

  useEffect(() => {
    const task: SearchTask = {
      key, request: { path, query, mode, showIgnored, client, generation: ++generation.current, continuation: false },
      stopped: false, busy: false, started: false, complete: false, loaded: 0,
    };
    active.current = task;
    setState(empty(key));
    const timer = window.setTimeout(() => { void scan(task); }, 300);
    return () => {
      task.stopped = true;
      window.clearTimeout(timer);
      if (active.current === task) active.current = null;
      if (task.started) void project.cancelSearch(client, task.request.generation).catch(() => { /* Late native replies are also rejected by generation. */ });
    };
  }, [key, path, query, mode, showIgnored, client, scan]);

  const current = state.key === key ? state : empty(key);
  return {
    ...current, loading: current.status === 'waiting' || current.status === 'loading',
    loadMore: () => { const task = active.current; if (task) void scan(task); },
    retry: () => setRetry(value => value + 1),
  };
}
