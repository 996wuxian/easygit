import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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
    console.error('esaygit failed to render', error, info);
    finishBoot();
  }
  render() {
    return this.state.failed ? <main className="fatal-state"><img src="/brand/esaygit-icon.png" width="52" alt="" /><h1>工作空间暂时无法加载</h1><p>本地仓库不会受到影响。请重新加载后再试。</p><button className="primary-button" onClick={() => location.reload()}>重新加载</button></main> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App onReady={finishBoot} /></ErrorBoundary></StrictMode>);
