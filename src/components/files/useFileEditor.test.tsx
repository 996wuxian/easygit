// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRepository } from '../../services/git';
import { project, type ProjectText } from '../../services/project';
import { useFileEditor } from './useFileEditor';

const snapshot = { ...emptyRepository(), path: 'X:/QA/project', name: 'QA' };
const text: ProjectText = { content: 'line one\nline two\nline three\n', revision: 'one', bom: false, lineEnding: 'lf', reason: null };
let editor: ReturnType<typeof useFileEditor>;
let root: Root;
let host: HTMLDivElement;
const save = vi.fn<(path: string, file: string, revision: string, content: string) => Promise<ProjectText | null>>();
function Harness() { editor = useFileEditor(snapshot, save); return null; }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(project, 'readFile').mockResolvedValue(text); save.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('内容搜索的文件行列定位', () => {
  it('删除当前文件所在目录后清空编辑会话，不影响其他目录的文件', async () => {
    await act(async () => editor.open('src/a.ts'));
    await act(async () => editor.deleted(snapshot.path, 'src-other', true));
    expect(editor.document?.file).toBe('src/a.ts');
    await act(async () => editor.deleted(snapshot.path, 'src', true));
    expect(editor.document).toBeNull();
    expect(editor.dirty).toBe(false);
  });

  it('删除正在读取的文件后忽略迟到结果', async () => {
    let finish!: (result: ProjectText) => void;
    vi.mocked(project.readFile).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    let opening!: Promise<void>;
    await act(async () => { opening = editor.open('src/a.ts'); });
    await act(async () => editor.deleted(snapshot.path, 'src/a.ts', false));
    await act(async () => { finish(text); await opening; });
    expect(editor.document).toBeNull();
    expect(editor.loading).toBe(false);
  });

  it('首次打开携带行列，同一文件再次定位不重读也不重建编辑会话', async () => {
    await act(async () => editor.open('src/a.ts', { line: 2, column: 6, length: 3 }));
    const first = editor.document!;
    expect(first.target).toMatchObject({ line: 2, column: 6, length: 3 });
    await act(async () => editor.open('src/a.ts', { line: 3, column: 1, length: 4 }));
    expect(editor.document?.key).toBe(first.key);
    expect(editor.document?.target).toMatchObject({ line: 3, column: 1, length: 4 });
    expect(editor.document?.target?.request).not.toBe(first.target?.request);
    expect(project.readFile).toHaveBeenCalledTimes(1);
  });

  it('在当前文件定位保留未保存草稿，切换到其他匹配文件仍需确认', async () => {
    await act(async () => editor.open('src/a.ts'));
    await act(async () => editor.change('local draft'));
    await act(async () => editor.open('src/a.ts', { line: 1, column: 1, length: 2 }));
    expect(editor.document?.draft).toBe('local draft'); expect(editor.confirming).toBe(false);
    let opening!: Promise<void>;
    await act(async () => { opening = editor.open('src/b.ts', { line: 2, column: 1, length: 2 }); });
    expect(editor.confirming).toBe(true);
    await act(async () => { await editor.decide('cancel'); await opening; });
    expect(editor.document?.file).toBe('src/a.ts'); expect(editor.document?.draft).toBe('local draft');
    expect(project.readFile).toHaveBeenCalledTimes(1);
  });

  it('保存过程中点击搜索结果不会使保存版本失效', async () => {
    await act(async () => editor.open('src/a.ts'));
    await act(async () => editor.change('saved draft'));
    let finish!: (saved: ProjectText) => void;
    save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let saving!: Promise<boolean>;
    await act(async () => { saving = editor.save(); });
    await act(async () => editor.open('src/a.ts', { line: 2, column: 1, length: 2 }));
    expect(editor.document?.target).toBeUndefined();
    await act(async () => { finish({ ...text, content: 'saved draft', revision: 'saved' }); expect(await saving).toBe(true); });
    expect(editor.dirty).toBe(false); expect(editor.document?.original.revision).toBe('saved');
  });
});
