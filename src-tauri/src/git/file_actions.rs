use super::{files::safe_path, snapshot, with_repository, RepositorySnapshot};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedProjectEntry {
    pub snapshot: Option<RepositorySnapshot>,
    pub refresh_error: Option<String>,
}

fn entry_path(root: &Path, file: &str) -> Result<PathBuf, String> {
    let target = safe_path(root, file, false)?;
    if !target.is_file() && !target.is_dir() {
        return Err("请选择普通文件或目录。".into());
    }
    Ok(target)
}

fn display_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(unc) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        path.strip_prefix("\\\\?\\").unwrap_or(&path).into()
    }
}

pub fn project_entry_path(path: &str, file: &str) -> Result<String, String> {
    with_repository(path, |root| Ok(display_path(&entry_path(root, file)?)))
}

pub fn reveal_project_entry(path: &str, file: &str) -> Result<(), String> {
    with_repository(path, |root| {
        let target = entry_path(root, file)?;
        #[cfg(windows)]
        let mut command = {
            use std::os::windows::process::CommandExt;
            let mut command = Command::new("explorer.exe");
            command
                .arg("/select,")
                .arg(display_path(&target))
                .creation_flags(0x08000000);
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = Command::new("open");
            command.arg("-R").arg(&target);
            command
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let mut command = {
            let mut command = Command::new("xdg-open");
            command.arg(target.parent().ok_or("文件目录无效。")?);
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("无法打开文件所在位置：{error}"))?;
        Ok(())
    })
}

#[cfg(any(windows, test))]
fn action_script(target: &Path, action: &str) -> String {
    let path = display_path(target).replace('\'', "''");
    let body = if action == "copy" {
        format!("Add-Type -AssemblyName System.Windows.Forms; $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add('{path}'); [System.Windows.Forms.Clipboard]::SetFileDropList($files)")
    } else {
        let method = if action == "directory" {
            "DeleteDirectory"
        } else {
            "DeleteFile"
        };
        format!("Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::{method}('{path}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)")
    };
    format!("$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); try {{ {body} }} catch {{ [Console]::Error.Write($_.Exception.Message); exit 1 }}")
}

#[cfg(windows)]
fn run_action(target: &Path, action: &str) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{os::windows::process::CommandExt, time::Duration};
    let script = action_script(target, action);
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let powershell =
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("无法定位 Windows 系统目录。")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = Command::new(powershell);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-EncodedCommand",
            &STANDARD.encode(bytes),
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null());
    let result = crate::process::output_with_limit(
        &mut command,
        Duration::from_secs(if action == "copy" { 15 } else { 120 }),
        64 * 1024,
        64 * 1024,
    )
    .map_err(|error| format!("无法执行文件操作：{error}"))?;
    if !result.status.success() {
        return Err(format!(
            "文件操作失败：{}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn run_action(_target: &Path, _action: &str) -> Result<(), String> {
    Err("当前平台暂不支持系统文件复制和回收站删除。".into())
}

pub fn copy_project_entry(path: &str, file: &str) -> Result<(), String> {
    with_repository(path, |root| run_action(&entry_path(root, file)?, "copy"))
}

// A directory deletion must not reach Git metadata, nested repositories or links.
fn deletion_target(root: &Path, file: &str, directory: bool) -> Result<PathBuf, String> {
    let target = entry_path(root, file)?;
    if target.is_dir() != directory {
        return Err("文件类型已变化，请刷新目录后重试。".into());
    }
    let mut pending = vec![file.to_owned()];
    let mut checked = 0;
    while let Some(relative) = pending.pop() {
        checked += 1;
        if checked > 100_000 {
            return Err("目录内容过多，请使用系统文件管理器删除。".into());
        }
        let path = entry_path(root, &relative)?;
        if path.is_dir() {
            for child in fs::read_dir(path).map_err(|error| error.to_string())? {
                let child = child.map_err(|error| error.to_string())?;
                let name = child
                    .file_name()
                    .into_string()
                    .map_err(|_| "暂不支持非 UTF-8 文件名。")?;
                pending.push(format!("{relative}/{name}"));
            }
        }
    }
    // Revalidate the absolute target after checking its descendants.
    entry_path(root, file)
}

pub fn delete_project_entry(
    path: &str,
    file: &str,
    directory: bool,
) -> Result<DeletedProjectEntry, String> {
    with_repository(path, |root| {
        let target = deletion_target(root, file, directory)?;
        run_action(&target, if directory { "directory" } else { "file" })?;
        let (snapshot, refresh_error) = match snapshot(root) {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        };
        Ok(DeletedProjectEntry {
            snapshot,
            refresh_error,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn recycling_files_updates_status_without_modifying_the_index() {
        use super::super::{create_commit, run, stage_files};
        let repository = super::super::tests::repo();
        let root = repository.path();
        let path = root.to_str().unwrap();
        let file = "中文 O'Brien [1].txt";
        fs::write(root.join(file), "committed").unwrap();
        stage_files(path, &[file.into()]).unwrap();
        create_commit(path, "fixture").unwrap();
        fs::write(root.join(file), "staged").unwrap();
        stage_files(path, &[file.into()]).unwrap();
        let index = run(root, &["show", &format!(":{file}")]).unwrap();
        let result = delete_project_entry(path, file, false).unwrap();
        assert!(!root.join(file).exists());
        assert!(result.refresh_error.is_none());
        assert!(result
            .snapshot
            .unwrap()
            .files
            .iter()
            .any(|entry| entry.path == file && entry.unstaged));
        assert_eq!(run(root, &["show", &format!(":{file}")]).unwrap(), index);
    }

    #[cfg(windows)]
    #[test]
    fn recycling_directories_removes_their_contents() {
        let repository = super::super::tests::repo();
        let root = repository.path();
        fs::create_dir_all(root.join("文件夹/child")).unwrap();
        fs::write(root.join("文件夹/child/item.txt"), "fixture").unwrap();
        let result = delete_project_entry(root.to_str().unwrap(), "文件夹", true).unwrap();
        assert!(!root.join("文件夹").exists());
        assert!(result.refresh_error.is_none());
    }

    #[test]
    fn deletion_validation_protects_repository_boundaries_and_types() {
        let repository = super::super::tests::repo();
        let root = repository.path().canonicalize().unwrap();
        fs::create_dir(root.join("folder")).unwrap();
        fs::write(root.join("folder/文件.png"), "image").unwrap();
        assert!(deletion_target(&root, "folder", true).is_ok());
        assert!(deletion_target(&root, "folder/文件.png", false).is_ok());
        for file in ["", ".", "../outside", ".git/config", "file:stream"] {
            assert!(deletion_target(&root, file, false).is_err(), "{file}");
        }
        assert!(deletion_target(&root, "folder", false).is_err());
        assert!(deletion_target(&root, "folder/文件.png", true).is_err());
        fs::create_dir(root.join("folder/nested")).unwrap();
        fs::write(root.join("folder/nested/.git"), "gitdir: somewhere").unwrap();
        assert!(deletion_target(&root, "folder", true).is_err());
        assert!(root.join("folder/文件.png").exists());
    }

    #[test]
    fn scripts_treat_unicode_and_shell_characters_as_literal_paths() {
        let target = Path::new("C:/项目/O'Brien;$folder[1]/图.png");
        let copy = action_script(target, "copy");
        assert!(copy.contains("O''Brien;$folder[1]/图.png'"));
        assert!(copy.contains("SetFileDropList"));
        for (kind, method) in [("file", "DeleteFile"), ("directory", "DeleteDirectory")] {
            let script = action_script(target, kind);
            assert!(script.contains(method));
            assert!(script.contains("SendToRecycleBin"));
            assert!(!script.contains("DeletePermanently"));
        }
    }

    #[test]
    fn absolute_paths_omit_windows_device_prefixes() {
        assert_eq!(
            display_path(Path::new("\\\\?\\C:\\项目\\图.png")),
            "C:\\项目\\图.png"
        );
        assert_eq!(
            display_path(Path::new("\\\\?\\UNC\\server\\share\\图.png")),
            "\\\\server\\share\\图.png"
        );
    }
}
