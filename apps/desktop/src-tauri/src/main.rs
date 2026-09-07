#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use stylelens_desktop::{ApiServer, ApiService, ApiSettings, DEFAULT_API_PORT, DEFAULT_API_SECRET};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_shell::ShellExt;

const GITEE_URL: &str = "https://gitee.com/xxxlomg/shark-style-lens.git";
const GITHUB_URL: &str = "https://github.com/xxxlomg/shark-style-lens";

struct ApiRuntime {
    server: Mutex<Option<ApiServer>>,
    port: u16,
}

#[tauri::command]
fn get_api_port(state: State<'_, ApiRuntime>) -> Result<u16, String> {
    Ok(state.port)
}

#[tauri::command]
fn open_extension_install_page(
    app: tauri::AppHandle,
    state: State<'_, ApiRuntime>,
) -> Result<(), String> {
    let install_page = format!("http://127.0.0.1:{}/", state.port);

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
    let state = app.state::<ApiRuntime>();
    let server = state.server.lock().ok().and_then(|mut value| value.take());
    if let Some(server) = server {
        let _ = tauri::async_runtime::block_on(server.shutdown());
    }
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
        .manage(ApiRuntime {
            server: Mutex::new(None),
            port: DEFAULT_API_PORT,
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

            let settings = ApiSettings::from_env()
                .with_port(DEFAULT_API_PORT)
                .with_secret(DEFAULT_API_SECRET)
                .with_embedded_public(true);
            let server = tauri::async_runtime::block_on(ApiService::new(settings).start())
                .expect("unable to start the embedded StyleLens API");
            let port = server.local_addr().port();
            if let Ok(mut state) = app.state::<ApiRuntime>().server.lock() {
                *state = Some(server);
            } else {
                panic!("embedded StyleLens API state is unavailable");
            }
            assert_eq!(port, DEFAULT_API_PORT);
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
