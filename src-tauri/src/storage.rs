use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

const DATA_FILE: &str = "app-data.json";
const DATA_BACKUP: &str = "app-data-backup.json";
const SECRET_FILE: &str = "ai-api-key.dpapi";
const SECRET_BACKUP: &str = "ai-api-key-backup.dpapi";
const DIRECTORY_CONFIG: &str = "data-directory.json";
const DATA_FILES: &[&str] = &[DATA_FILE, DATA_BACKUP, SECRET_FILE, SECRET_BACKUP];
static STORAGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
struct AppData {
    version: u32,
    values: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct SecretData {
    version: u32,
    api_key: String,
}

struct DataStore {
    config_root: PathBuf,
    default_directory: PathBuf,
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("数据文件路径无效。")?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建数据目录：{error}"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    file.write_all(content).map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取本地数据：{error}")),
    }
}

fn parse_data(bytes: &[u8]) -> Result<HashMap<String, String>, String> {
    let data: AppData = serde_json::from_slice(bytes).map_err(|_| "应用数据文件格式无效。")?;
    if data.version != 1 {
        return Err("应用数据版本不受支持，请更新 easygit。".to_owned());
    }
    Ok(data.values)
}

fn parse_secret(bytes: &[u8]) -> Result<String, String> {
    let mut plain = unprotect(bytes)?;
    let parsed = serde_json::from_slice::<SecretData>(&plain);
    plain.fill(0);
    let secret = parsed.map_err(|_| "密钥文件格式无效。")?;
    if secret.version != 1 {
        return Err("密钥文件版本不受支持。".to_owned());
    }
    Ok(secret.api_key)
}

impl DataStore {
    fn for_app(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            config_root: app
                .path()
                .app_config_dir()
                .map_err(|error| error.to_string())?,
            default_directory: app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("data"),
        })
    }

    fn directory(&self) -> Result<PathBuf, String> {
        let config = read_optional(&self.config_root.join(DIRECTORY_CONFIG))?;
        let directory = if let Some(bytes) = config {
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|_| "数据目录配置损坏，请检查 data-directory.json。")?;
            let path = value
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .ok_or("数据目录配置必须包含有效的绝对路径。")?;
            path
        } else {
            self.default_directory.clone()
        };
        fs::create_dir_all(&directory).map_err(|error| format!("无法访问数据目录：{error}"))?;
        Ok(directory)
    }

    fn save_directory(&self, directory: &Path) -> Result<(), String> {
        let config = serde_json::to_vec_pretty(&serde_json::json!({ "path": directory }))
            .map_err(|error| error.to_string())?;
        atomic_write(
            &self.config_root.join("data-directory.txt"),
            directory.to_string_lossy().as_bytes(),
        )?;
        atomic_write(&self.config_root.join(DIRECTORY_CONFIG), &config)
    }

    fn load_data(&self) -> Result<Option<HashMap<String, String>>, String> {
        let directory = self.directory()?;
        let primary = read_optional(&directory.join(DATA_FILE))?;
        let backup = read_optional(&directory.join(DATA_BACKUP))?;
        if let Some(ref bytes) = primary {
            if let Ok(data) = parse_data(bytes) {
                return Ok(Some(data));
            }
        }
        if let Some(ref bytes) = backup {
            return parse_data(bytes)
                .map(Some)
                .map_err(|_| "应用数据和备份均无法读取，已停止写入以保留原文件。".to_owned());
        }
        if primary.is_some() {
            return Err("应用数据损坏且没有可用备份，已停止写入以保留原文件。".to_owned());
        }
        Ok(None)
    }

    fn save_data(&self, values: HashMap<String, String>) -> Result<(), String> {
        if values
            .get("easygit.ai-commit-settings.v1")
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .and_then(|value| value.get("apiKey").cloned())
            .is_some()
        {
            return Err("API Key 必须使用独立的加密存储。".to_owned());
        }
        let directory = self.directory()?;
        let document = AppData { version: 1, values };
        let content = serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?;
        if let Some(current) = read_optional(&directory.join(DATA_FILE))? {
            if let Ok(previous) = parse_data(&current) {
                if previous == document.values {
                    return Ok(());
                }
                atomic_write(&directory.join(DATA_BACKUP), &current)?;
            }
        }
        atomic_write(&directory.join(DATA_FILE), &content)
    }

    fn load_api_key(&self) -> Result<Option<String>, String> {
        let directory = self.directory()?;
        let primary = read_optional(&directory.join(SECRET_FILE))?;
        let backup = read_optional(&directory.join(SECRET_BACKUP))?;
        if let Some(ref bytes) = primary {
            if let Ok(secret) = parse_secret(bytes) {
                return Ok(Some(secret));
            }
        }
        if let Some(bytes) = backup {
            return parse_secret(&bytes)
                .map(Some)
                .map_err(|_| "密钥及其备份无法解密，请使用保存密钥时的系统账户。".to_owned());
        }
        if primary.is_some() {
            return Err("密钥无法解密，请使用保存密钥时的系统账户。".to_owned());
        }
        Ok(None)
    }

    fn save_api_key(&self, api_key: String) -> Result<(), String> {
        let directory = self.directory()?;
        let clearing = api_key.is_empty();
        let mut plain = serde_json::to_vec(&SecretData {
            version: 1,
            api_key,
        })
        .map_err(|error| error.to_string())?;
        let encrypted = protect(&plain);
        plain.fill(0);
        let encrypted = encrypted?;
        if clearing {
            atomic_write(&directory.join(SECRET_BACKUP), &encrypted)?;
        } else if let Some(current) = read_optional(&directory.join(SECRET_FILE))? {
            if parse_secret(&current).is_ok() {
                atomic_write(&directory.join(SECRET_BACKUP), &current)?;
            }
        }
        atomic_write(&directory.join(SECRET_FILE), &encrypted)
    }

    fn migrate(&self, new_directory: &str) -> Result<PathBuf, String> {
        let target = PathBuf::from(new_directory.trim());
        if !target.is_absolute() || target.parent().is_none() {
            return Err("数据目录必须是绝对路径，且不能是磁盘根目录。".to_owned());
        }
        let source = fs::canonicalize(self.directory()?).map_err(|error| error.to_string())?;
        fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        let target_absolute = fs::canonicalize(&target).map_err(|error| error.to_string())?;
        if target_absolute.parent().is_none() {
            return Err("数据目录不能是磁盘根目录。".to_owned());
        }
        if target_absolute == source {
            return self.directory();
        }
        if target_absolute.starts_with(&source) || source.starts_with(&target_absolute) {
            return Err("新旧数据目录不能互相包含。".to_owned());
        }
        if DATA_FILES.iter().any(|name| target.join(name).exists()) {
            return Err("目标目录已包含 easygit 数据，请选择其他目录以避免覆盖。".to_owned());
        }
        let mut created = Vec::new();
        let result = (|| {
            for name in DATA_FILES {
                if let Some(bytes) = read_optional(&source.join(name))? {
                    let path = target.join(name);
                    let mut file = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&path)
                        .map_err(|error| error.to_string())?;
                    created.push(path);
                    file.write_all(&bytes).map_err(|error| error.to_string())?;
                    file.sync_all().map_err(|error| error.to_string())?;
                }
            }
            self.save_directory(&target)
        })();
        if let Err(error) = result {
            for path in created {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
        Ok(target)
    }
}

#[cfg(windows)]
fn crypt(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let mut input = bytes.to_vec();
    let mut entropy = b"easygit.ai-api-key.v1".to_vec();
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI binds the ciphertext to the current Windows user; no embedded encryption key is used.
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &input_blob,
                std::ptr::null(),
                &entropy_blob,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input_blob,
                std::ptr::null_mut(),
                &entropy_blob,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    input.fill(0);
    if success == 0 {
        return Err(format!(
            "Windows 系统密钥保护失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let result = unsafe {
        let content = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let result = content.to_vec();
        content.fill(0);
        LocalFree(output.pbData.cast());
        result
    };
    Ok(result)
}

#[cfg(windows)]
fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    crypt(bytes, true)
}
#[cfg(windows)]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    crypt(bytes, false)
}
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台尚未接入系统密钥保护。".to_owned())
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台无法解密 Windows DPAPI 密钥文件。".to_owned())
}

fn with_store<T>(
    app: &tauri::AppHandle,
    task: impl FnOnce(DataStore) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| "本地存储锁不可用。".to_owned())?;
    task(DataStore::for_app(app)?)
}

#[tauri::command]
pub fn read_app_data(app: tauri::AppHandle) -> Result<Option<HashMap<String, String>>, String> {
    with_store(&app, |store| store.load_data())
}

#[tauri::command]
pub fn write_app_data(
    app: tauri::AppHandle,
    values: HashMap<String, String>,
) -> Result<(), String> {
    with_store(&app, |store| store.save_data(values))
}

#[tauri::command]
pub fn read_ai_api_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    with_store(&app, |store| store.load_api_key())
}

#[tauri::command]
pub fn write_ai_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    with_store(&app, |store| store.save_api_key(api_key))
}

#[tauri::command]
pub fn get_data_directory(app: tauri::AppHandle) -> Result<String, String> {
    with_store(&app, |store| {
        Ok(store.directory()?.to_string_lossy().into_owned())
    })
}

#[tauri::command]
pub fn migrate_data_directory(
    app: tauri::AppHandle,
    new_directory: String,
) -> Result<String, String> {
    with_store(&app, |store| {
        Ok(store
            .migrate(&new_directory)?
            .to_string_lossy()
            .into_owned())
    })
}

#[tauri::command]
pub fn open_data_directory(app: tauri::AppHandle) -> Result<(), String> {
    let directory = with_store(&app, |store| store.directory())?;
    #[cfg(windows)]
    let result = std::process::Command::new("explorer")
        .arg(directory)
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(directory).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(directory)
        .spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(root: &Path) -> DataStore {
        DataStore {
            config_root: root.join("config"),
            default_directory: root.join("data"),
        }
    }

    #[test]
    fn restores_backup_without_replacing_it_with_corrupt_data() {
        let root = tempfile::tempdir().unwrap();
        let store = store(root.path());
        let first = HashMap::from([("theme".to_owned(), "dark".to_owned())]);
        store.save_data(first.clone()).unwrap();
        store
            .save_data(HashMap::from([("theme".to_owned(), "light".to_owned())]))
            .unwrap();
        fs::write(root.path().join("data").join(DATA_FILE), "broken").unwrap();
        assert_eq!(store.load_data().unwrap(), Some(first.clone()));
        store.save_data(first.clone()).unwrap();
        assert_eq!(store.load_data().unwrap(), Some(first));
    }

    #[test]
    fn migration_keeps_source_and_rejects_conflicting_or_nested_targets() {
        let root = tempfile::tempdir().unwrap();
        let store = store(root.path());
        let data = HashMap::from([("theme".to_owned(), "dark".to_owned())]);
        store.save_data(data.clone()).unwrap();
        let original = store.directory().unwrap();
        assert!(store
            .migrate(original.join("nested").to_str().unwrap())
            .is_err());
        let target = root.path().join("migrated");
        store.migrate(target.to_str().unwrap()).unwrap();
        assert_eq!(store.load_data().unwrap(), Some(data.clone()));
        assert!(original.join(DATA_FILE).exists());
        assert!(store.migrate(original.to_str().unwrap()).is_err());
        assert_eq!(store.load_data().unwrap(), Some(data));
    }

    #[test]
    fn refuses_plaintext_keys_in_application_json() {
        let root = tempfile::tempdir().unwrap();
        assert!(store(root.path())
            .save_data(HashMap::from([(
                "easygit.ai-commit-settings.v1".to_owned(),
                r#"{"apiKey":"test-only"}"#.to_owned()
            )]))
            .is_err());
    }

    #[cfg(windows)]
    #[test]
    fn api_key_is_encrypted_and_survives_directory_migration() {
        let root = tempfile::tempdir().unwrap();
        let store = store(root.path());
        let key = "test-only-api-key";
        store.save_api_key(key.to_owned()).unwrap();
        let bytes = fs::read(store.directory().unwrap().join(SECRET_FILE)).unwrap();
        assert!(!bytes.windows(key.len()).any(|part| part == key.as_bytes()));
        assert_eq!(store.load_api_key().unwrap().as_deref(), Some(key));
        store
            .migrate(root.path().join("other").to_str().unwrap())
            .unwrap();
        assert_eq!(store.load_api_key().unwrap().as_deref(), Some(key));
        store.save_api_key(String::new()).unwrap();
        assert_eq!(store.load_api_key().unwrap().as_deref(), Some(""));
        fs::write(store.directory().unwrap().join(SECRET_FILE), "broken").unwrap();
        assert_eq!(store.load_api_key().unwrap().as_deref(), Some(""));
    }
}
