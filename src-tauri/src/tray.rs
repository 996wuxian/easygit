use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Window, WindowEvent,
};

const QUIT_REQUESTED: &str = "easygit://quit-requested";

#[derive(Default)]
struct TrayState {
    frontend_ready: AtomicBool,
}

#[tauri::command]
pub fn register_window_lifecycle(app: AppHandle) {
    app.state::<TrayState>()
        .frontend_ready
        .store(true, Ordering::Release);
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不可用。".to_owned())?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

// Called only after the frontend has flushed its pending drafts/settings writes.
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

fn restore(app: &AppHandle) {
    if let Err(error) = show_main_window(app.clone()) {
        eprintln!("无法显示 easygit：{error}");
    }
}

fn request_exit(app: &AppHandle) {
    if !app
        .state::<TrayState>()
        .frontend_ready
        .load(Ordering::Acquire)
    {
        // Startup failed or has not loaded frontend state yet: keep Quit usable.
        app.exit(0);
    } else if let Err(error) = app.emit_to("main", QUIT_REQUESTED, ()) {
        eprintln!("无法请求退出 easygit：{error}");
        restore(app);
    }
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(TrayState::default());
    let show = MenuItem::with_id(app, "easygit.show", "显示窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "easygit.quit", "退出 easygit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("未配置应用图标。")?;
    TrayIconBuilder::with_id("easygit.tray")
        .icon(icon)
        .tooltip("easygit · 点击打开，右键退出")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "easygit.show" => restore(app),
            "easygit.quit" => request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                restore(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        // Also covers Alt+F4 and closing before the webview has initialized.
        api.prevent_close();
        if let Err(error) = window.hide() {
            eprintln!("无法隐藏 easygit：{error}");
        }
    }
}
