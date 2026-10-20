import { useEffect, useState } from 'react';
import { IconMinus, IconSquare, IconSquares, IconX } from '@tabler/icons-react';
import { isDesktop } from '../services/git';

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      off = await win.onResized(async () => { if (!disposed) setMaximized(await win.isMaximized()); });
      if (disposed) off();
    }).catch(console.error);
    return () => { disposed = true; off?.(); };
  }, []);
  async function act(action: 'minimize' | 'toggleMaximize' | 'close') {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[action]();
  }
  if (!isDesktop()) return <span className="preview-window-label">桌面版界面预览</span>;
  return <div className="window-controls">
    <button title="最小化" aria-label="最小化" onClick={() => { void act('minimize'); }}><IconMinus size={15} /></button>
    <button title={maximized ? '还原窗口' : '最大化'} aria-label={maximized ? '还原窗口' : '最大化'} onClick={() => { void act('toggleMaximize'); }}>{maximized ? <IconSquares size={14} /> : <IconSquare size={13} />}</button>
    <button className="window-close" title="关闭" aria-label="关闭" onClick={() => { void act('close'); }}><IconX size={17} /></button>
  </div>;
}
