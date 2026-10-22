import { invokeCommand } from './git';
import { flushStorage, STORAGE_ERROR_EVENT } from './storage';

export async function initializeWindowLifecycle(): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  let exiting = false;
  const unlisten = await listen('easygit://quit-requested', () => {
    if (exiting) return;
    exiting = true;
    void (async () => {
      try {
        await flushStorage();
        await invokeCommand<void>('exit_app');
      } catch (error) {
        exiting = false;
        try { await invokeCommand<void>('show_main_window'); } catch (showError) { console.error(showError); }
        window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: `退出未完成，应用仍在运行：${String(error)}` }));
      }
    })();
  });
  try {
    await invokeCommand<void>('register_window_lifecycle');
  } catch (error) {
    unlisten();
    throw error;
  }
  return unlisten;
}
