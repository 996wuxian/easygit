use serde::Serialize;
use std::{fs, io::Read, path::Path, process::Command};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScripts {
    pub package_found: bool,
    pub manager: String,
    pub scripts: Vec<ProjectScript>,
}

#[derive(Debug, Serialize)]
pub struct ProjectScript {
    pub name: String,
    pub command: String,
}

fn read_at(root: &Path) -> Result<ProjectScripts, String> {
    let mut info = ProjectScripts {
        package_found: false,
        manager: "npm".into(),
        scripts: vec![],
    };
    let file = match fs::File::open(root.join("package.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(info),
        Err(error) => return Err(format!("无法读取 package.json：{error}")),
    };
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("package.json 超过 1 MB，无法读取脚本。".into());
    }
    let manifest: serde_json::Value =
        serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes))
            .map_err(|error| format!("package.json 格式错误：{error}"))?;
    if !manifest.is_object() {
        return Err("package.json 必须是一个 JSON 对象。".into());
    }
    info.package_found = true;
    if let Some(declared) = manifest
        .get("packageManager")
        .and_then(|value| value.as_str())
    {
        let name = declared.split('@').next().unwrap_or_default();
        if !matches!(name, "npm" | "pnpm" | "yarn" | "bun") {
            return Err(format!("暂不支持 packageManager：{declared}"));
        }
        info.manager = name.into();
    } else {
        for (lock, manager) in [
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lock", "bun"),
            ("bun.lockb", "bun"),
            ("package-lock.json", "npm"),
            ("npm-shrinkwrap.json", "npm"),
        ] {
            if root.join(lock).is_file() {
                info.manager = manager.into();
                break;
            }
        }
    }
    if let Some(scripts) = manifest.get("scripts").filter(|value| !value.is_null()) {
        let scripts = scripts
            .as_object()
            .ok_or("package.json 的 scripts 必须是一个对象。")?;
        for (name, value) in scripts {
            let command = value
                .as_str()
                .ok_or_else(|| format!("脚本 {name} 的命令必须是字符串。"))?;
            if !name.is_empty() && !command.trim().is_empty() {
                info.scripts.push(ProjectScript {
                    name: name.clone(),
                    command: command.into(),
                });
            }
        }
    }
    info.scripts.sort_by_key(|script| {
        (
            match script.name.as_str() {
                "dev" => 0,
                "start" => 1,
                "serve" => 2,
                _ => 3,
            },
            script.name.clone(),
        )
    });
    Ok(info)
}

pub fn read_scripts(path: &str) -> Result<ProjectScripts, String> {
    read_at(&crate::git::repository_root(path)?)
}

// Script names become arguments to a package-manager shim, never shell code.
// Restrict names to portable npm-style identifiers to also protect cmd shims.
fn validate_script_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.starts_with('-')
        || !name
            .chars()
            .all(|character| character.is_alphanumeric() || ":._/@-".contains(character))
    {
        return Err("脚本名包含终端不支持的特殊字符，请使用字母、数字或 : . _ / @ -。".into());
    }
    Ok(())
}

fn validate_run(
    root: &Path,
    name: &str,
    expected_command: &str,
    expected_manager: &str,
) -> Result<String, String> {
    validate_script_name(name)?;
    let info = read_at(root)?;
    let script = info
        .scripts
        .iter()
        .find(|script| script.name == name)
        .ok_or("此脚本已被移除，请刷新脚本列表。")?;
    if script.command != expected_command || info.manager != expected_manager {
        return Err("脚本或包管理器已变化，请刷新脚本列表后重试。".into());
    }
    Ok(info.manager)
}

#[cfg(windows)]
fn powershell_script(root: &Path, manager: &str, name: &str) -> String {
    let raw = root.to_string_lossy();
    let directory = if let Some(unc) = raw.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        raw.strip_prefix("\\\\?\\").unwrap_or(&raw).to_owned()
    };
    let executable = if manager == "bun" {
        "bun.exe".to_owned()
    } else {
        format!("{manager}.cmd")
    };
    let quote = |value: &str| format!("'{}'", value.replace('\'', "''"));
    format!("$ErrorActionPreference = 'Stop'; try {{ Set-Location -LiteralPath {}; Write-Host {}; & {} 'run' {}; if ($LASTEXITCODE -ne 0) {{ Write-Host ('Script exited with code ' + $LASTEXITCODE) -ForegroundColor Red }} }} catch {{ Write-Host $_.Exception.Message -ForegroundColor Red }}", quote(&directory), quote(&format!("{manager} run {name}")), quote(&executable), quote(name))
}

#[cfg(windows)]
fn terminal_command(root: &Path, manager: &str, name: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NoExit",
            "-Command",
            &powershell_script(root, manager, name),
        ])
        .current_dir(root)
        .creation_flags(0x00000010);
    command
}

#[cfg(not(windows))]
fn shell_script(root: &Path, manager: &str, name: &str) -> String {
    let quote = |value: &str| format!("'{}'", value.replace('\'', "'\\''"));
    format!(
        "cd -- {} && {} run {}; exec \"${{SHELL:-/bin/sh}}\"",
        quote(&root.to_string_lossy()),
        quote(manager),
        quote(name)
    )
}

fn launch_terminal(root: &Path, manager: &str, name: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        terminal_command(root, manager, name)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开 PowerShell 终端：{error}"))
    }
    #[cfg(target_os = "macos")]
    {
        let script = shell_script(root, manager, name);
        let escaped = script.replace('\\', "\\\\").replace('"', "\\\"");
        let command =
            format!("tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell");
        Command::new("osascript")
            .args(["-e", &command])
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开终端：{error}"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let script = shell_script(root, manager, name);
        for terminal in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            let mut command = Command::new(terminal);
            if terminal == "gnome-terminal" {
                command.arg("--");
            } else {
                command.arg("-e");
            }
            match command
                .args(["sh", "-c", &script])
                .current_dir(root)
                .spawn()
            {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("无法打开终端：{error}")),
            }
        }
        Err("未找到终端，请安装系统终端后重试。".into())
    }
}

pub fn run_script(
    path: &str,
    name: &str,
    expected_command: &str,
    expected_manager: &str,
) -> Result<(), String> {
    let root = crate::git::repository_root(path)?;
    let manager = validate_run(&root, name, expected_command, expected_manager)?;
    launch_terminal(&root, &manager, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(root: &Path, value: serde_json::Value) {
        fs::write(
            root.join("package.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn lists_real_scripts_and_prefers_declared_manager() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::write(root.join("yarn.lock"), "").unwrap();
        manifest(
            root,
            serde_json::json!({"packageManager": "pnpm@10.2.0", "scripts": {"test": "vitest run", "dev": "vite", "start": "node app.js", "empty": " "}}),
        );
        let info = read_at(root).unwrap();
        assert!(info.package_found);
        assert_eq!(info.manager, "pnpm");
        assert_eq!(
            info.scripts
                .iter()
                .map(|script| script.name.as_str())
                .collect::<Vec<_>>(),
            ["dev", "start", "test"]
        );
        assert_eq!(info.scripts[0].command, "vite");
    }

    #[test]
    fn detects_all_supported_lockfiles_and_npm_fallback() {
        for (lock, expected) in [
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lock", "bun"),
            ("bun.lockb", "bun"),
            ("package-lock.json", "npm"),
            ("npm-shrinkwrap.json", "npm"),
            ("none", "npm"),
        ] {
            let directory = tempfile::tempdir().unwrap();
            manifest(
                directory.path(),
                serde_json::json!({"scripts": {"dev": "vite"}}),
            );
            fs::write(directory.path().join(lock), "").unwrap();
            assert_eq!(read_at(directory.path()).unwrap().manager, expected);
        }
    }

    #[test]
    fn handles_missing_empty_invalid_and_bom_manifests() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        assert!(!read_at(root).unwrap().package_found);
        manifest(root, serde_json::json!({"scripts": {}}));
        assert!(read_at(root).unwrap().scripts.is_empty());
        fs::write(
            root.join("package.json"),
            b"\xef\xbb\xbf{\"scripts\":{\"dev\":\"vite\"}}",
        )
        .unwrap();
        assert_eq!(read_at(root).unwrap().scripts.len(), 1);
        fs::write(root.join("package.json"), "{broken").unwrap();
        assert!(read_at(root).unwrap_err().contains("格式错误"));
        manifest(root, serde_json::json!({"scripts": {"dev": 1}}));
        assert!(read_at(root).is_err());
        manifest(root, serde_json::json!({"packageManager": "unknown@1"}));
        assert!(read_at(root).is_err());
    }

    #[test]
    fn refuses_stale_removed_and_shell_special_script_names() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        manifest(
            root,
            serde_json::json!({"scripts": {"dev": "vite", "tauri:dev": "tauri dev"}}),
        );
        assert_eq!(
            validate_run(root, "tauri:dev", "tauri dev", "npm").unwrap(),
            "npm"
        );
        assert!(validate_run(root, "dev", "old command", "npm").is_err());
        assert!(validate_run(root, "dev", "vite", "pnpm").is_err());
        assert!(validate_run(root, "deleted", "vite", "npm").is_err());
        for name in [
            "dev;whoami",
            "dev&whoami",
            "$(whoami)",
            "dev\nwhoami",
            "--script-shell=evil",
            "dev'",
            "dev%PATH%",
        ] {
            assert!(validate_script_name(name).is_err(), "{name}");
        }
        assert!(validate_script_name("开发:本地").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn powershell_uses_literal_directory_and_keeps_terminal_open() {
        let root = Path::new("C:\\work\\project's & demo");
        let command = terminal_command(root, "pnpm", "tauri:dev");
        let args = command
            .get_args()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(args.iter().any(|value| value == "-NoExit"));
        assert!(args
            .last()
            .unwrap()
            .contains("Set-Location -LiteralPath 'C:\\work\\project''s & demo'"));
        assert!(args
            .last()
            .unwrap()
            .contains("& 'pnpm.cmd' 'run' 'tauri:dev'"));
        assert_eq!(command.get_current_dir(), Some(root));
        assert!(
            powershell_script(Path::new("\\\\?\\UNC\\server\\share"), "bun", "dev")
                .contains("'\\\\server\\share'")
        );
    }

    #[cfg(windows)]
    #[test]
    fn npm_script_actually_runs_in_the_project_directory() {
        use std::os::windows::process::CommandExt;
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("project's & demo");
        fs::create_dir(&root).unwrap();
        manifest(
            &root,
            serde_json::json!({"name": "easygit-script-test", "version": "1.0.0", "scripts": {"verify:cwd": "node -e \"require('fs').writeFileSync('script-ran.txt', process.cwd())\""}}),
        );
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-Command",
                &powershell_script(&root, "npm", "verify:cwd"),
            ])
            .env("npm_config_update_notifier", "false")
            .creation_flags(0x08000000);
        let result =
            crate::process::output_with_timeout(&mut command, std::time::Duration::from_secs(30))
                .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let actual = fs::read_to_string(root.join("script-ran.txt")).unwrap_or_else(|error| {
            panic!(
                "{error}\n{}\n{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            )
        });
        assert_eq!(
            Path::new(&actual).canonicalize().unwrap(),
            root.canonicalize().unwrap()
        );
    }
}
