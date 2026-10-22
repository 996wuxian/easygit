#[cfg(target_os = "windows")]
#[path = "../src/tray.rs"]
mod tray;

#[cfg(target_os = "windows")]
use std::{
    thread,
    time::{Duration, Instant},
};
#[cfg(target_os = "windows")]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
fn wait_for(label: &str, condition: impl Fn() -> bool) {
    let start = Instant::now();
    while !condition() {
        assert!(
            start.elapsed() < Duration::from_secs(4),
            "timed out: {label}"
        );
        thread::sleep(Duration::from_millis(30));
    }
}

#[cfg(target_os = "windows")]
fn main() {
    eprintln!("Starting isolated native tray check...");
    let data = tempfile::tempdir().unwrap();
    let webview_data = data.path().join("webview");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!("dev.easygit.tray-smoke-{}", std::process::id());
    let (send, receive) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .on_window_event(tray::on_window_event)
        .setup(move |app| {
            eprintln!("Creating blank test window...");
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse()?),
            )
            .title("easygit tray smoke test")
            .data_directory(webview_data)
            .visible(false)
            .build()?;
            eprintln!("Creating tray...");
            tray::setup(app)?;
            eprintln!("Checking hide and restore...");
            let app = app.handle().clone();
            thread::spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    tray::register_window_lifecycle(app.clone());
                    assert!(app.tray_by_id("easygit.tray").is_some());
                    tray::show_main_window(app.clone()).unwrap();
                    wait_for("show", || window.is_visible().unwrap());
                    window.close().unwrap();
                    wait_for("close hides", || !window.is_visible().unwrap());
                    assert!(app.get_webview_window("main").is_some());
                    assert!(app.tray_by_id("easygit.tray").is_some());
                    tray::show_main_window(app.clone()).unwrap();
                    wait_for("restore after close", || window.is_visible().unwrap());
                    window.maximize().unwrap();
                    wait_for("maximize", || window.is_maximized().unwrap());
                    window.close().unwrap();
                    wait_for("maximized close hides", || !window.is_visible().unwrap());
                    tray::show_main_window(app.clone()).unwrap();
                    wait_for("restore maximized", || {
                        window.is_visible().unwrap() && window.is_maximized().unwrap()
                    });
                    window.minimize().unwrap();
                    wait_for("native minimize hides", || !window.is_visible().unwrap());
                    tray::show_main_window(app.clone()).unwrap();
                    wait_for("restore after minimize", || {
                        window.is_visible().unwrap() && !window.is_minimized().unwrap()
                    });
                    window.hide().unwrap();
                    wait_for("titlebar minimize hides", || !window.is_visible().unwrap());
                    tray::show_main_window(app.clone()).unwrap();
                    wait_for("restore after hide", || window.is_visible().unwrap());
                }));
                let passed = result.is_ok();
                send.send(passed).unwrap();
                if passed {
                    tray::exit_app(app);
                } else {
                    app.exit(1);
                }
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    assert_eq!(app.run_return(|_, _| {}), 0);
    assert!(receive.recv_timeout(Duration::from_secs(2)).unwrap());
    println!("PASS: tray created; close and native/titlebar minimize hide without destruction; restore preserves maximization; explicit quit exits.");
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("This smoke check requires an interactive Windows desktop.");
}
