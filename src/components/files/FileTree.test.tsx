// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { project, type ProjectEntry, type ProjectListing } from '../../services/project';
import { FileTree } from './FileTree';

let host: HTMLDivElement;
let root: Root;
const opened = vi.fn();
const entry = (path: string, directory = false): ProjectEntry => ({ name: path.split('/').pop()!, path, directory, blocked: false, ignored: false });
const listing = (entries: ProjectEntry[]): ProjectListing => ({ entries, truncated: false });
const tree: Record<string, ProjectEntry[]> = {
  '': [entry('src', true), entry('src-other', true), entry('README.md')],
  src: [entry('src/mixins', true), entry('src/components', true)],
  'src/mixins': [entry('src/mixins/appMixin.js'), entry('src/mixins/otherMixin.js')],
};
const render = async (selected: string) => { await act(async () => root.render(<FileTree repository="X:/QA/project" files={[]} refreshKey="one" selected={selected} onOpen={opened} />)); };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(project, 'files').mockImplementation(async (_repository, directory = '') => listing(tree[directory] ?? []));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('当前编辑文件的目录定位', () => {
  it('初次打开深层文件时逐级展开父目录，不读取无关目录', async () => {
    await render('src/mixins/appMixin.js');
    expect(button('目录 src').getAttribute('aria-expanded')).toBe('true');
    expect(button('目录 src/mixins').getAttribute('aria-expanded')).toBe('true');
    expect(button('打开文件 src/mixins/appMixin.js').getAttribute('aria-current')).toBe('true');
    expect(button('目录 src-other').getAttribute('aria-expanded')).toBe('false');
    expect(button('目录 src/components').getAttribute('aria-expanded')).toBe('false');
    expect(vi.mocked(project.files).mock.calls.map(call => call[1])).toEqual(['', 'src', 'src/mixins']);
  });

  it('更换选中文件时自动展开，但允许手动折叠当前目录', async () => {
    await render('README.md');
    expect(button('目录 src').getAttribute('aria-expanded')).toBe('false');
    await render('src/mixins/appMixin.js');
    expect(button('目录 src/mixins').getAttribute('aria-expanded')).toBe('true');
    await act(async () => button('目录 src').click());
    await render('src/mixins/appMixin.js');
    expect(button('目录 src').getAttribute('aria-expanded')).toBe('false');
    await render('src/mixins/otherMixin.js');
    expect(button('目录 src').getAttribute('aria-expanded')).toBe('true');
    expect(button('打开文件 src/mixins/otherMixin.js').getAttribute('aria-current')).toBe('true');
  });

  it('文件不在可见区域时只滚动左侧目录，不抢走编辑焦点', async () => {
    let finish!: (result: ProjectListing) => void;
    vi.mocked(project.files).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render('src/mixins/appMixin.js');
    const viewport = host.querySelector<HTMLElement>('.project-tree-scroll')!;
    viewport.scrollTop = 10;
    const scroll = vi.spyOn(viewport, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 200));
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 500, 100, 24));
    const editor = document.createElement('textarea'); document.body.append(editor); editor.focus();
    try {
      await act(async () => finish(listing(tree[''])));
      expect(scroll).toHaveBeenCalledWith({ top: 234, behavior: 'smooth' });
      expect(document.activeElement).toBe(editor);
    } finally { editor.remove(); }
  });
});
