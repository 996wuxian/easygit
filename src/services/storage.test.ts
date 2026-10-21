import { describe, expect, it } from 'vitest';
import { AI_SETTINGS_KEY, COMMIT_DRAFTS_KEY, FileBackedStorage, type StorageDriver } from './storage';

class MemoryLegacyStorage {
  readonly values = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
}

class MemoryFileDriver implements StorageDriver {
  data: Record<string, string> | null = null;
  apiKey: string | null = null;
  failData = false;
  failKey = false;
  async readData() { return this.data ? { ...this.data } : null; }
  async readApiKey() { return this.apiKey; }
  async writeData(values: Record<string, string>) {
    if (this.failData) throw new Error('disk unavailable');
    this.data = { ...values };
  }
  async writeApiKey(apiKey: string) {
    if (this.failKey) throw new Error('key protection unavailable');
    this.apiKey = apiKey;
  }
}

describe('file-backed application storage', () => {
  it('migrates preferences and drafts, separates the API key, then removes legacy copies', async () => {
    const legacy = new MemoryLegacyStorage({
      'esaygit.theme': 'dark',
      'esaygit.recent.v1': '[{"name":"Alpha","path":"X:/Alpha"}]',
      'esaygit.workspace-layout.v1': '{"version":1}',
      'easygit.sidebar-repository-order.v1': '["X:/Alpha"]',
      [COMMIT_DRAFTS_KEY]: '{"X:/Alpha":"feat: 添加功能"}',
      [AI_SETTINGS_KEY]: JSON.stringify({ baseUrl: 'https://api.example.test', model: 'model', apiKey: 'test-only-key' }),
      unrelated: 'keep',
    });
    const driver = new MemoryFileDriver();
    const storage = new FileBackedStorage(driver, legacy);

    await storage.initialize();

    expect(storage.getItem('esaygit.theme')).toBe('dark');
    expect(storage.getItem(COMMIT_DRAFTS_KEY)).toContain('feat: 添加功能');
    expect(driver.apiKey).toBe('test-only-key');
    expect(JSON.parse(driver.data![AI_SETTINGS_KEY])).toEqual({ baseUrl: 'https://api.example.test', model: 'model' });
    expect(JSON.stringify(driver.data)).not.toContain('test-only-key');
    expect(Object.fromEntries(legacy.values)).toEqual({ unrelated: 'keep' });
  });

  it.each(['failKey', 'failData'] as const)('keeps legacy data when %s prevents migration and can retry safely', async failure => {
    const original = JSON.stringify({ baseUrl: 'https://api.example.test', apiKey: 'legacy-test-key' });
    const legacy = new MemoryLegacyStorage({ [AI_SETTINGS_KEY]: original, 'esaygit.theme': 'dark' });
    const driver = new MemoryFileDriver();
    driver[failure] = true;

    await expect(new FileBackedStorage(driver, legacy).initialize()).rejects.toThrow();
    expect(legacy.getItem(AI_SETTINGS_KEY)).toBe(original);
    expect(legacy.getItem('esaygit.theme')).toBe('dark');

    driver[failure] = false;
    const retry = new FileBackedStorage(driver, legacy);
    await retry.initialize();
    expect(retry.getApiKey()).toBe('legacy-test-key');
    expect(retry.getItem('esaygit.theme')).toBe('dark');
    expect(legacy.getItem(AI_SETTINGS_KEY)).toBeNull();
  });

  it('prefers native data and does not resurrect a cleared key from browser storage', async () => {
    const driver = new MemoryFileDriver();
    driver.data = { 'esaygit.theme': 'dark', [AI_SETTINGS_KEY]: '{"model":"native-model"}' };
    driver.apiKey = '';
    const legacy = new MemoryLegacyStorage({ 'esaygit.theme': 'light', [AI_SETTINGS_KEY]: '{"apiKey":"old-key"}' });
    const storage = new FileBackedStorage(driver, legacy);

    await storage.initialize();

    expect(storage.getItem('esaygit.theme')).toBe('dark');
    expect(storage.getItem(AI_SETTINGS_KEY)).toBe('{"model":"native-model"}');
    expect(storage.getApiKey()).toBe('');
    expect(driver.apiKey).toBe('');
  });

  it('serializes overlapping saves and restores the latest state after restart', async () => {
    const driver = new MemoryFileDriver();
    const legacy = new MemoryLegacyStorage();
    const storage = new FileBackedStorage(driver, legacy);
    await storage.initialize();
    let release!: () => void;
    let markStarted!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const originalWrite = driver.writeData.bind(driver);
    let first = true;
    driver.writeData = async values => {
      if (first) { first = false; markStarted(); await blocked; }
      await originalWrite(values);
    };

    storage.setItem('esaygit.theme', 'dark');
    await started;
    storage.setItem('esaygit.theme', 'light');
    storage.setItem(COMMIT_DRAFTS_KEY, '{"X:/Alpha":"docs: 更新文档"}');
    const savingKey = storage.setApiKey('latest-test-key');
    release();
    await savingKey;
    await storage.flush();

    const restarted = new FileBackedStorage(driver, legacy);
    await restarted.initialize();
    expect(restarted.getItem('esaygit.theme')).toBe('light');
    expect(restarted.getItem(COMMIT_DRAFTS_KEY)).toContain('docs: 更新文档');
    expect(restarted.getApiKey()).toBe('latest-test-key');
    expect(JSON.stringify(driver.data)).not.toContain('latest-test-key');
  });

  it('reports failed saves and flush retries without losing the in-memory draft', async () => {
    const driver = new MemoryFileDriver();
    const errors: unknown[] = [];
    const storage = new FileBackedStorage(driver, new MemoryLegacyStorage(), error => errors.push(error));
    await storage.initialize();
    driver.failData = true;
    storage.setItem(COMMIT_DRAFTS_KEY, '{"X:/Alpha":"fix: 修复问题"}');

    await expect(storage.flush()).rejects.toThrow('disk unavailable');
    expect(errors).toHaveLength(1);
    expect(storage.getItem(COMMIT_DRAFTS_KEY)).toContain('fix: 修复问题');
    driver.failData = false;
    await storage.flush();
    expect(driver.data![COMMIT_DRAFTS_KEY]).toContain('fix: 修复问题');
  });
});
