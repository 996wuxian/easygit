// @vitest-environment happy-dom
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { getSearchQuery, openSearchPanel, search, searchKeymap, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditorSearchPanel } from './editorSearchPanel';

let host: HTMLDivElement;
let view: EditorView;
let editable: Compartment;
const original = 'Cat cat scatter cat\ncat';
const input = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
function type(label: string, value: string) { const field = input(label); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); }
const count = () => host.querySelector('[role="status"]')!.textContent;

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); editable = new Compartment();
  view = new EditorView({ parent: host, state: EditorState.create({ doc: original, extensions: [
    search({ top: true, createPanel: createEditorSearchPanel }), keymap.of(searchKeymap), editable.of(EditorState.readOnly.of(false)),
  ] }) });
  openSearchPanel(view);
});
afterEach(() => { view.destroy(); host.remove(); });

describe('编辑器中文查找与替换', () => {
  it('展示中文操作、图标和匹配数量，前后跳转可从输入框通过快捷键执行', () => {
    expect(host.querySelector('[role="search"]')?.getAttribute('aria-label')).toBe('文件内查找与替换');
    expect(host.textContent).not.toMatch(/previous|next|replace all|match case/);
    expect(button('上一处匹配（Shift + Enter）').querySelector('svg')).not.toBeNull();
    type('查找内容', 'cat'); expect(count()).toBe('共 5 处');
    button('下一处匹配（Enter）').click(); expect(count()).toBe('1 / 5');
    button('下一处匹配（Enter）').click(); expect(count()).toBe('2 / 5');
    input('查找内容').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    expect(count()).toBe('1 / 5');
  });

  it('大小写、全词和正则选项生效，无效表达式显示中文且禁用匹配操作', () => {
    type('查找内容', 'cat');
    button('全词匹配').click(); expect(count()).toBe('共 4 处');
    expect(button('全词匹配').getAttribute('aria-pressed')).toBe('true');
    button('区分大小写').click(); expect(count()).toBe('共 3 处');
    button('正则表达式').click(); type('查找内容', '[');
    expect(count()).toBe('表达式有误');
    expect(input('查找内容').getAttribute('aria-invalid')).toBe('true');
    expect(button('下一处匹配（Enter）').disabled).toBe(true);
    type('查找内容', 'not-found'); expect(count()).toBe('无匹配');
  });

  it('替换当前项和全部替换复用编辑器命令，并同步匹配数', () => {
    type('查找内容', 'cat'); type('替换内容', 'dog');
    button('下一处匹配（Enter）').click(); button('替换当前匹配（Enter）').click();
    expect(view.state.doc.toString().startsWith('dog cat')).toBe(true);
    expect(count()).toContain('4');
    button('替换全部匹配（Ctrl + Enter）').click();
    expect(view.state.doc.toString()).toBe(original.replace(/cat/gi, 'dog'));
    expect(count()).toBe('无匹配');
  });

  it('外部搜索状态和文档变化同步到面板，只读状态禁止替换但仍能查找', () => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'cat', replace: 'new', caseSensitive: true })) });
    expect(input('查找内容').value).toBe('cat'); expect(input('替换内容').value).toBe('new');
    expect(button('区分大小写').getAttribute('aria-pressed')).toBe('true');
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' cat' } }); expect(count()).toBe('共 5 处');
    view.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(true)) });
    expect(input('替换内容').disabled).toBe(true);
    expect(button('替换全部匹配（Ctrl + Enter）').disabled).toBe(true);
    expect(button('下一处匹配（Enter）').disabled).toBe(false);
    view.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(false)) });
    expect(button('替换全部匹配（Ctrl + Enter）').disabled).toBe(false);
    expect(getSearchQuery(view.state).search).toBe('cat');
  });

  it('Esc 只关闭查找面板，阻止冒泡到外层编辑器弹窗的关闭操作', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input('查找内容').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(host.querySelector('[role="search"]')).toBeNull();
    expect(view.state.doc.toString()).toBe(original);
  });
});
