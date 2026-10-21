import { invokeCommand, isDesktop } from './git';
import type { AiCommitSettings } from './ai';

export const AI_SETTINGS_KEY = 'easygit.ai-commit-settings.v1';
export const COMMIT_DRAFTS_KEY = 'easygit.commit-drafts.v1';
export const STORAGE_ERROR_EVENT = 'easygit-storage-error';
const LEGACY_KEYS = [
  AI_SETTINGS_KEY,
  'esaygit.theme',
  'esaygit.recent.v1',
  'esaygit.workspace-layout.v1',
  'easygit.sidebar-repository-order.v1',
  COMMIT_DRAFTS_KEY,
];

export interface StorageDriver {
  readData: () => Promise<Record<string, string> | null>;
  writeData: (values: Record<string, string>) => Promise<void>;
  readApiKey: () => Promise<string | null>;
  writeApiKey: (apiKey: string) => Promise<void>;
}

function splitAiSettings(raw: string | null): { value: string; apiKey: string | null } {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null');
    if (saved && typeof saved === 'object') {
      const config = saved as Partial<AiCommitSettings>;
      return {
        value: JSON.stringify({
          ...(typeof config.baseUrl === 'string' ? { baseUrl: config.baseUrl } : {}),
          ...(typeof config.model === 'string' ? { model: config.model } : {}),
        }),
        apiKey: typeof config.apiKey === 'string' ? config.apiKey : null,
      };
    }
  } catch { /* Invalid old settings are replaced by the normal defaults. */ }
  return { value: '{}', apiKey: null };
}

/** Synchronous UI reads, with serialized writes to the native JSON and secret files. */
export class FileBackedStorage {
  private values: Record<string, string> = {};
  private apiKey = '';
  private savedApiKey = '';
  private ready = false;
  private revision = 0;
  private savedRevision = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly driver: StorageDriver,
    private readonly legacy: Pick<Storage, 'getItem' | 'removeItem'>,
    private readonly reportError: (error: unknown) => void = () => {},
  ) {}

  async initialize(): Promise<void> {
    const [disk, savedKey] = await Promise.all([this.driver.readData(), this.driver.readApiKey()]);
    const values = { ...disk };
    for (const key of LEGACY_KEYS) {
      if (!(key in values)) {
        const old = this.legacy.getItem(key);
        if (old !== null) values[key] = old;
      }
    }
    const config = splitAiSettings(values[AI_SETTINGS_KEY] ?? null);
    const oldKey = config.apiKey ?? splitAiSettings(this.legacy.getItem(AI_SETTINGS_KEY)).apiKey;
    const apiKey = savedKey ?? oldKey ?? '';
    if (AI_SETTINGS_KEY in values) values[AI_SETTINGS_KEY] = config.value;

    // Do not delete legacy plaintext until both native stores have been written successfully.
    if (savedKey === null && apiKey) await this.driver.writeApiKey(apiKey);
    if (disk === null || JSON.stringify(disk) !== JSON.stringify(values)) {
      await this.driver.writeData(values);
    }
    for (const key of LEGACY_KEYS) this.legacy.removeItem(key);
    this.values = values;
    this.apiKey = apiKey;
    this.savedApiKey = apiKey;
    this.ready = true;
  }

  private assertReady() {
    if (!this.ready) throw new Error('本地数据尚未初始化。');
  }

  getItem(key: string): string | null {
    this.assertReady();
    return this.values[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.assertReady();
    if (this.values[key] === value) return;
    this.values = { ...this.values, [key]: value };
    this.revision++;
    void this.persist().catch(this.reportError);
  }

  getApiKey(): string {
    this.assertReady();
    return this.apiKey;
  }

  setApiKey(apiKey: string): Promise<void> {
    this.assertReady();
    if (this.apiKey === apiKey && this.savedApiKey === apiKey) return Promise.resolve();
    this.apiKey = apiKey;
    this.revision++;
    return this.persist();
  }

  private persist(): Promise<void> {
    const next = this.writes.catch(() => {}).then(async () => {
      if (this.savedRevision === this.revision && this.savedApiKey === this.apiKey) return;
      const revision = this.revision;
      const values = { ...this.values };
      const apiKey = this.apiKey;
      if (this.savedApiKey !== apiKey) {
        await this.driver.writeApiKey(apiKey);
        this.savedApiKey = apiKey;
      }
      await this.driver.writeData(values);
      this.savedRevision = revision;
    });
    this.writes = next;
    return next;
  }

  async flush(): Promise<void> {
    await this.writes.catch(() => {});
    if (this.savedRevision !== this.revision) await this.persist();
  }
}

let desktopStorage: FileBackedStorage | null = null;
let previewApiKey = '';

function reportStorageError(error: unknown) {
  window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, {
    detail: `本地数据保存失败：${error instanceof Error ? error.message : String(error)}`,
  }));
}

export async function initializeStorage(): Promise<void> {
  if (!isDesktop()) {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    const config = splitAiSettings(raw);
    previewApiKey = config.apiKey ?? '';
    if (raw !== null) localStorage.setItem(AI_SETTINGS_KEY, config.value);
    return;
  }
  const storage = new FileBackedStorage({
    readData: () => invokeCommand<Record<string, string> | null>('read_app_data'),
    writeData: values => invokeCommand<void>('write_app_data', { values }),
    readApiKey: () => invokeCommand<string | null>('read_ai_api_key'),
    writeApiKey: apiKey => invokeCommand<void>('write_ai_api_key', { apiKey }),
  }, localStorage, reportStorageError);
  await storage.initialize();
  desktopStorage = storage;
}

function nativeStorage(): FileBackedStorage {
  if (!desktopStorage) throw new Error('本地数据尚未初始化。');
  return desktopStorage;
}

export const appStorage = {
  getItem(key: string): string | null {
    return isDesktop() ? nativeStorage().getItem(key) : localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (isDesktop()) nativeStorage().setItem(key, value);
    else localStorage.setItem(key, value);
  },
};

export function readAiApiKey(): string {
  return isDesktop() ? nativeStorage().getApiKey() : previewApiKey;
}

export async function saveAiApiKey(apiKey: string): Promise<void> {
  if (isDesktop()) await nativeStorage().setApiKey(apiKey);
  else previewApiKey = apiKey;
}

export async function flushStorage(): Promise<void> {
  if (isDesktop()) await nativeStorage().flush();
}

export const getDataDirectory = () => invokeCommand<string>('get_data_directory');
export const openDataDirectory = () => invokeCommand<void>('open_data_directory');
export async function migrateDataDirectory(newDirectory: string): Promise<string> {
  await flushStorage();
  return invokeCommand<string>('migrate_data_directory', { newDirectory });
}
