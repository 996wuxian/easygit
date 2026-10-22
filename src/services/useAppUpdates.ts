import { useCallback, useEffect, useRef, useState } from 'react';
import { isDesktop } from './git';
import { UPDATE_PROGRESS_EVENT, updatesApi, type DownloadedUpdate, type DownloadProgress, type UpdateInfo } from './updates';

type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'error';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useAppUpdates() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloaded, setDownloaded] = useState<DownloadedUpdate | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isDesktop()) {
      void import('@tauri-apps/api/event').then(async ({ listen }) => {
        const stop = await listen<DownloadProgress>(UPDATE_PROGRESS_EVENT, event => { if (!disposed) setProgress(event.payload); });
        if (disposed) stop(); else unlisten = stop;
      }).catch(() => { /* Downloads still finish when progress events are unavailable. */ });
    }
    return () => { disposed = true; mounted.current = false; unlisten?.(); };
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus('checking'); setInfo(null); setDownloaded(null); setProgress(null); setError(null);
    try {
      const result = await updatesApi.check();
      if (mounted.current) { setInfo(result); setStatus(result.hasUpdate ? 'available' : 'current'); }
    } catch (reason) { if (mounted.current) { setError(message(reason)); setStatus('error'); } }
    finally { busy.current = false; }
  }, []);

  useEffect(() => { if (isDesktop()) void check(); }, [check]);

  const download = useCallback(async () => {
    if (busy.current || !info?.hasUpdate || !info.assetName) return;
    busy.current = true;
    setStatus('downloading'); setProgress({ downloadedBytes: 0, totalBytes: info.assetSize ?? 0 }); setError(null);
    try {
      const result = await updatesApi.download();
      if (mounted.current) { setDownloaded(result); setStatus('downloaded'); }
    } catch (reason) { if (mounted.current) { setError(message(reason)); setStatus('error'); } }
    finally { busy.current = false; }
  }, [info]);

  const openLink = useCallback(async (url?: string) => {
    try { await updatesApi.openLink(url); }
    catch (reason) { if (mounted.current) setError(message(reason)); }
  }, []);
  const openDirectory = useCallback(async () => {
    try { await updatesApi.openDirectory(); }
    catch (reason) { if (mounted.current) setError(message(reason)); }
  }, []);
  return { status, info, downloaded, progress, error, check, download, openLink, openDirectory };
}
