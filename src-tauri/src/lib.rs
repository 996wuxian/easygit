mod git;
mod process;

use git::{BootstrapInfo, RepositorySnapshot};

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
}

#[tauri::command]
async fn bootstrap() -> BootstrapInfo {
    tauri::async_runtime::spawn_blocking(git::bootstrap)
        .await
        .unwrap_or_else(|error| BootstrapInfo {
            git_available: false,
            git_version: None,
            error: Some(error.to_string()),
        })
}

#[tauri::command]
async fn open_repository(path: String) -> Result<RepositorySnapshot, String> {
    blocking(move || git::open_repository(&path)).await
}

#[tauri::command]
async fn read_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    blocking(move || git::read_diff(&path, &file, staged)).await
}

#[tauri::command]
async fn stage_files(path: String, files: Vec<String>) -> Result<RepositorySnapshot, String> {
    blocking(move || git::stage_files(&path, &files)).await
}

#[tauri::command]
async fn unstage_files(path: String, files: Vec<String>) -> Result<RepositorySnapshot, String> {
    blocking(move || git::unstage_files(&path, &files)).await
}

#[tauri::command]
async fn discard_changes(path: String, files: Vec<String>) -> Result<RepositorySnapshot, String> {
    blocking(move || git::discard_changes(&path, &files)).await
}

#[tauri::command]
async fn create_commit(path: String, message: String) -> Result<RepositorySnapshot, String> {
    blocking(move || git::create_commit(&path, &message)).await
}

#[tauri::command]
async fn checkout_branch(path: String, branch: String) -> Result<RepositorySnapshot, String> {
    blocking(move || git::checkout_branch(&path, &branch)).await
}

#[tauri::command]
async fn fetch_repository(path: String) -> Result<RepositorySnapshot, String> {
    blocking(move || git::fetch_repository(&path)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            open_repository,
            read_diff,
            stage_files,
            unstage_files,
            discard_changes,
            create_commit,
            checkout_branch,
            fetch_repository
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 easygit");
}
