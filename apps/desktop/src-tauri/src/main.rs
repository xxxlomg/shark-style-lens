use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    path::BaseDirectory,
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const GITEE_URL: &str = "https://gitee.com/xxxlomg/shark-style-lens.git";
const GITHUB_URL: &str = "https://github.com/xxxlomg/shark-style-lens";

struct ApiProcess {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    port: Arc<Mutex<Option<u16>>>,
}

#[tauri::command]
fn get_api_port(state: State<'_, ApiProcess>) -> Result<u16, String> {
    state
        .port
        .lock()
        .map_err(|_| "API sidecar state is unavailable".to_string())?
        .ok_or_else(|| "API sidecar is still starting".to_string())
}

#[tauri::command]
fn open_extension_install_page(
    app: tauri::AppHandle,
    state: State<'_, ApiProcess>,
) -> Result<(), String> {
    let port = state
        .port
        .lock()
        .map_err(|_| "API sidecar state is unavailable".to_string())?
        .ok_or_else(|| "API sidecar is still starting".to_string())?;
    let install_page = format!("http://127.0.0.1:{port}/");

    // Hand the ZIP download to a normal browser where attachment downloads
    // are visible and reliable for users.
    #[allow(deprecated)]
    app.shell()
        .open(install_page, None)
        .map_err(|error| format!("Unable to open the browser: {error}"))
}

#[tauri::command]
fn open_gitee_page(app: tauri::AppHandle) -> Result<(), String> {
    #[allow(deprecated)]
    app.shell()
        .open(GITEE_URL, None)
        .map_err(|error| format!("Unable to open Gitee: {error}"))
}

#[tauri::command]
fn open_github_page(app: tauri::AppHandle) -> Result<(), String> {
    #[allow(deprecated)]
    app.shell()
        .open(GITHUB_URL, None)
        .map_err(|error| format!("Unable to open GitHub: {error}"))
}

fn stop_api(app: &tauri::AppHandle) {
    let state = app.state::<ApiProcess>();
    if let Ok(mut process) = state.child.lock() {
        if let Some(child) = process.take() {
            let _ = child.kill();
        }
    };
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ApiProcess {
            child: Mutex::new(None),
            port: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            get_api_port,
            open_extension_install_page,
            open_gitee_page,
            open_github_page
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "打开 StyleLens", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 StyleLens", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("default window icon is missing"),
                )
                .tooltip("StyleLens")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let public_dir = app
                .path()
                .resolve("resources/stylelens-public", BaseDirectory::Resource)
                .expect("unable to resolve StyleLens public resources");
            let (mut events, child) = app
                .shell()
                .sidecar("stylelens-api")
                .expect("StyleLens API sidecar is not bundled")
                // The browser extension has no Tauri bridge, so the local API
                // needs one stable loopback port for config and analysis calls.
                .env("PORT", "3001")
                .env("STYLELENS_API_SECRET", "stylelens-dev")
                .env("STYLELENS_ENV_FILE", "")
                .env("STYLELENS_CONFIG_ONLY", "1")
                .env(
                    "STYLELENS_PUBLIC_DIR",
                    public_dir.to_string_lossy().as_ref(),
                )
                .spawn()
                .expect("unable to start StyleLens API sidecar");

            if let Ok(mut process) = app.state::<ApiProcess>().child.lock() {
                *process = Some(child);
            }

            let api_state = app.state::<ApiProcess>().inner().port.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let output = String::from_utf8_lossy(&bytes);
                            if let Some(port) = parse_api_port(&output) {
                                if let Ok(mut value) = api_state.lock() {
                                    *value = Some(port);
                                }
                            }
                            println!("[StyleLens API] {output}");
                        }
                        CommandEvent::Error(error) => {
                            eprintln!("[StyleLens API] sidecar error: {error}")
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[StyleLens API] sidecar exited: {payload:?}")
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building StyleLens desktop application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            stop_api(app_handle);
        }
    });
}

fn parse_api_port(output: &str) -> Option<u16> {
    let marker = "http://127.0.0.1:";
    let start = output.find(marker)? + marker.len();
    let digits: String = output[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    let port = digits.parse::<u16>().ok()?;
    (port > 0).then_some(port)
}
