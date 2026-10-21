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
async fn read_staged_diff(path: String) -> Result<String, String> {
    blocking(move || git::read_staged_diff(&path)).await
}

#[tauri::command]
async fn generate_commit_message(
    api_key: String,
    base_url: String,
    model: String,
    diff: String,
) -> Result<String, String> {
    let api_key = api_key.trim().to_owned();
    let base_url = base_url.trim().trim_end_matches('/').to_owned();
    let model = model.trim().to_owned();
    if api_key.is_empty() {
        return Err("请先在偏好设置中填写 AI API Key。".to_owned());
    }
    if model.is_empty() {
        return Err("请填写 AI 模型名称。".to_owned());
    }
    if diff.trim().is_empty() {
        return Err("暂存区没有可用于生成提交信息的差异。".to_owned());
    }

    let parsed_url = reqwest::Url::parse(&base_url).map_err(|_| "AI API 地址无效。".to_owned())?;
    let local_http = parsed_url.scheme() == "http"
        && matches!(
            parsed_url.host_str(),
            Some("localhost" | "127.0.0.1" | "::1")
        );
    if parsed_url.scheme() != "https" && !local_http {
        return Err("AI API 地址必须使用 HTTPS（本机服务可使用 HTTP）。".to_owned());
    }
    let endpoint = if base_url.ends_with("/chat/completions") {
        base_url
    } else {
        format!("{base_url}/chat/completions")
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|error| format!("无法初始化 AI 请求：{error}"))?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "stream": false,
            "temperature": 0.2,
            "max_tokens": 120,
            "messages": [
                {
                    "role": "system",
                    "content": "你是 Git 提交信息助手。根据用户提供的暂存区 diff，生成一条符合 Conventional Commits 规范的提交信息。只输出一行，不要解释、不要 Markdown。格式为 type(scope): description 或 type: description。type 优先使用 feat、fix、docs、style、refactor、perf、test、build、ci、chore、revert。描述简洁准确，使用与 diff 内容一致的语言。"
                },
                {
                    "role": "user",
                    "content": format!("请为以下暂存区差异生成提交信息：\n\n{diff}")
                }
            ]
        }))
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 AI 响应失败：{error}"))?;
    let payload: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| format!("AI 服务返回了无法识别的响应（HTTP {status}）。"))?;
    if !status.is_success() {
        let detail = payload
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("请检查 API 地址、模型名称和 API Key。")
            .chars()
            .take(300)
            .collect::<String>();
        return Err(format!("AI 服务返回 HTTP {status}：{detail}"));
    }

    payload
        .pointer("/choices/0/message/content")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "AI 响应中没有提交信息。".to_owned())
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

#[tauri::command]
async fn push_repository(path: String) -> Result<RepositorySnapshot, String> {
    blocking(move || git::push_repository(&path)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            open_repository,
            read_diff,
            read_staged_diff,
            generate_commit_message,
            stage_files,
            unstage_files,
            discard_changes,
            create_commit,
            checkout_branch,
            fetch_repository,
            push_repository
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 easygit");
}
