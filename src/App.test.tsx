import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

afterEach(() => vi.unstubAllGlobals());

function renderStart(recents: unknown[] = []) {
  const storage = { getItem: (key: string) => key === 'esaygit.recent.v1' ? JSON.stringify(recents) : null };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  return renderToStaticMarkup(<App onReady={() => {}} />);
}

describe('未打开仓库的起始页', () => {
  it('只显示打开入口，不显示预填仓库、分支、统计或更改面板', () => {
    const html = renderStart();
    expect(html).toContain('尚未打开仓库');
    expect(html).toContain('打开一个仓库');
    expect(html).not.toContain('示例');
    expect(html).not.toContain('当前分支');
    expect(html).not.toContain('工作区干净');
    expect(html).not.toContain('更改与历史');
    expect(html).not.toContain('data-eg-panel');
  });

  it('保留真实最近项目，忽略旧示例记录', () => {
    const html = renderStart([
      { name: '旧示例项目', path: 'demo://esaygit' },
      { name: 'MyProject', path: 'X:/Projects/MyProject' },
    ]);
    expect(html).toContain('MyProject');
    expect(html).toContain('最近打开');
    expect(html).not.toContain('旧示例项目');
    expect(html).not.toContain('demo://');
  });
});
