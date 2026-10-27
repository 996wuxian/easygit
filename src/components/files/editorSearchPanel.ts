import type { Text } from '@codemirror/state';
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, selectMatches, setSearchQuery } from '@codemirror/search';
import './editor-search.css';

type Option = 'caseSensitive' | 'regexp' | 'wholeWord';
type QueryPatch = Partial<Pick<SearchQuery, Option | 'search' | 'replace'>>;
const MAX_MATCHES = 10000;

// Same 24px, round-stroke geometry as the application's Tabler icons. Native
// panel DOM avoids mounting a second React root inside CodeMirror's lifecycle.
const paths = {
  search: ['M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'],
  up: ['M12 5v14', 'M18 11l-6 -6l-6 6'],
  down: ['M12 5v14', 'M18 13l-6 6l-6 -6'],
  close: ['M18 6l-12 12', 'M6 6l12 12'],
  replace: ['M3 4a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z', 'M15 16a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z', 'M21 11v-3a2 2 0 0 0 -2 -2h-6l3 3m0 -6l-3 3', 'M3 13v3a2 2 0 0 0 2 2h6l-3 -3m0 6l3 -3'],
} as const;

function icon(name: keyof typeof paths): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const d of paths[name]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const dom = document.createElement(tag); dom.className = className; return dom;
}

class EditorSearchPanel implements Panel {
  readonly dom = element('div', 'editor-search-panel');
  readonly top = true;
  private readonly searchInput = element('input', 'editor-search-text');
  private readonly replaceInput = element('input', 'editor-search-text');
  private readonly counter = element('span', 'editor-search-count');
  private readonly options = new Map<Option, HTMLButtonElement>();
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly selectAll: HTMLButtonElement;
  private readonly replaceOne: HTMLButtonElement;
  private readonly replaceEvery: HTMLButtonElement;
  private cachedDocument?: Text;
  private cachedKey = '';
  private matches: { from: number; to: number }[] = [];
  private truncated = false;

  constructor(private readonly view: EditorView) {
    this.dom.setAttribute('role', 'search');
    this.dom.setAttribute('aria-label', '文件内查找与替换');
    this.searchInput.placeholder = '查找内容';
    this.searchInput.setAttribute('aria-label', '查找内容');
    this.searchInput.setAttribute('main-field', 'true');
    this.replaceInput.placeholder = '替换为…';
    this.replaceInput.setAttribute('aria-label', '替换内容');
    for (const input of [this.searchInput, this.replaceInput]) { input.spellcheck = false; input.autocomplete = 'off'; }
    this.searchInput.oninput = () => this.commit({ search: this.searchInput.value });
    this.replaceInput.oninput = () => this.commit({ replace: this.replaceInput.value });
    this.counter.setAttribute('role', 'status');
    this.counter.setAttribute('aria-live', 'polite');
    this.counter.setAttribute('aria-atomic', 'true');

    const first = element('div', 'editor-search-row');
    const searchBox = element('label', 'editor-search-field');
    searchBox.append(icon('search'), this.searchInput, this.counter);
    const flags = element('div', 'editor-search-options');
    flags.setAttribute('role', 'group'); flags.setAttribute('aria-label', '查找选项');
    for (const [option, label, glyph] of [['caseSensitive', '区分大小写', 'Aa'], ['wholeWord', '全词匹配', 'ab'], ['regexp', '正则表达式', '.*']] as const) {
      const button = this.button(label, () => this.commit({ [option]: !getSearchQuery(view.state)[option] }), 'editor-search-option');
      button.textContent = glyph;
      if (option === 'wholeWord') button.classList.add('editor-search-word');
      this.options.set(option, button); flags.append(button);
    }
    this.previous = this.button('上一处匹配（Shift + Enter）', () => findPrevious(view)); this.previous.append(icon('up'));
    this.next = this.button('下一处匹配（Enter）', () => findNext(view)); this.next.append(icon('down'));
    const close = this.button('关闭查找（Esc）', () => closeSearchPanel(view)); close.append(icon('close'));
    const navigation = element('div', 'editor-search-navigation'); navigation.append(this.previous, this.next, close);
    first.append(searchBox, flags, navigation);

    const second = element('div', 'editor-search-row');
    const replaceBox = element('label', 'editor-search-field'); replaceBox.append(icon('replace'), this.replaceInput);
    this.replaceOne = this.button('替换当前匹配（Enter）', () => replaceNext(view), 'editor-search-action'); this.replaceOne.textContent = '替换';
    this.replaceEvery = this.button('替换全部匹配（Ctrl + Enter）', () => replaceAll(view), 'editor-search-action'); this.replaceEvery.textContent = '全部替换';
    this.selectAll = this.button('选中全部匹配', () => selectMatches(view), 'editor-search-action'); this.selectAll.textContent = '全选匹配';
    second.append(replaceBox, this.replaceOne, this.replaceEvery, this.selectAll);
    this.dom.append(first, second);
    this.dom.onkeydown = event => {
      if (event.isComposing) return;
      if (runScopeHandlers(view, event, 'search-panel')) { event.preventDefault(); event.stopPropagation(); }
      else if (event.key === 'Enter' && (event.target === this.searchInput || event.target === this.replaceInput)) {
        event.preventDefault(); event.stopPropagation();
        if (event.target === this.searchInput) (event.shiftKey ? findPrevious : findNext)(view);
        else (event.ctrlKey || event.metaKey ? replaceAll : replaceNext)(view);
      }
    };
    this.refresh();
  }

  private button(label: string, action: () => unknown, className = 'editor-search-icon'): HTMLButtonElement {
    const button = element('button', className);
    button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    button.onclick = () => { action(); };
    return button;
  }

  private commit(patch: QueryPatch) {
    const current = getSearchQuery(this.view.state);
    const query = new SearchQuery({ search: current.search, replace: current.replace, caseSensitive: current.caseSensitive, regexp: current.regexp, wholeWord: current.wholeWord, literal: current.literal, ...patch });
    if (!query.eq(current)) this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private refresh() {
    const { state } = this.view;
    const query = getSearchQuery(state);
    if (this.searchInput.value !== query.search) this.searchInput.value = query.search;
    if (this.replaceInput.value !== query.replace) this.replaceInput.value = query.replace;
    for (const [option, button] of this.options) button.setAttribute('aria-pressed', String(query[option]));
    const key = JSON.stringify([query.search, query.caseSensitive, query.regexp, query.wholeWord, query.literal]);
    if (this.cachedDocument !== state.doc || this.cachedKey !== key) {
      this.cachedDocument = state.doc; this.cachedKey = key; this.matches = []; this.truncated = false;
      if (query.valid) {
        const cursor = query.getCursor(state.doc);
        for (let match = cursor.next(); !match.done; match = cursor.next()) {
          if (this.matches.length === MAX_MATCHES) { this.truncated = true; break; }
          this.matches.push({ from: match.value.from, to: match.value.to });
        }
      }
    }
    const selection = state.selection.main;
    const active = this.matches.findIndex(match => match.from === selection.from && match.to === selection.to);
    const total = `${this.matches.length}${this.truncated ? '+' : ''}`;
    this.counter.textContent = !query.search ? '' : !query.valid ? '表达式有误' : !this.matches.length ? '无匹配' : active >= 0 ? `${active + 1} / ${total}` : `共 ${total} 处`;
    this.counter.classList.toggle('is-empty', !query.search);
    this.counter.classList.toggle('is-error', Boolean(query.search && (!query.valid || !this.matches.length)));
    this.searchInput.setAttribute('aria-invalid', String(Boolean(query.search && !query.valid)));
    const noMatch = !query.valid || !this.matches.length;
    this.previous.disabled = this.next.disabled = this.selectAll.disabled = noMatch;
    this.replaceOne.disabled = this.replaceEvery.disabled = noMatch || state.readOnly;
    this.replaceInput.disabled = state.readOnly;
    this.replaceInput.title = state.readOnly ? '当前文件只读，无法替换' : '';
  }

  update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.transactions.length) this.refresh(); }
  mount() { this.searchInput.focus(); this.searchInput.select(); }
}

export function createEditorSearchPanel(view: EditorView): Panel { return new EditorSearchPanel(view); }
