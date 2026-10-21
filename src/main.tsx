import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isDesktop } from './services/git';
import { flushStorage, initializeStorage, STORAGE_ERROR_EVENT } from './services/storage';
import './App.css';

const started = performance.now();
export function finishBoot() {
  const remaining = Math.max(0, 850 - (performance.now() - started));
  window.setTimeout(() => {
    const screen = document.getElementById('app-loading');
    screen?.classList.add('leaving');
    window.setTimeout(() => screen?.remove(), 350);
  }, remaining);
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('easygit failed to render', error, info);
    finishBoot();
  }
  render() {
    return this.state.failed ? <main className="fatal-state"><img src="/brand/esaygit-icon.png" width="52" alt="" /><h1>工作空间暂时无法加载</h1><p>本地仓库不会受到影响。请重新加载后再试。</p><button className="primary-button" onClick={() => location.reload()}>重新加载</button></main> : this.props.children;
  }
}

const root = createRoot(document.getElementById('root')!);

async function startApp() {
  try {
    await initializeStorage();
    if (isDesktop()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      let closing = false;
      await win.onCloseRequested(async event => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          await flushStorage();
          await win.destroy();
        } catch (error) {
          closing = false;
          window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: `数据尚未保存，暂未关闭窗口：${String(error)}` }));
        }
      });
    }
    root.render(<StrictMode><ErrorBoundary><App onReady={finishBoot} /></ErrorBoundary></StrictMode>);
  } catch (error) {
    root.render(<main className="fatal-state"><h1>本地数据暂时无法加载</h1><p>{String(error)}</p><button className="primary-button" onClick={() => location.reload()}>重新加载</button></main>);
    finishBoot();
  }
}

void startApp();
