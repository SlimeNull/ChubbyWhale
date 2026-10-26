mod activity;
mod llm;
mod motion;
mod store;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true);
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "talk", "和大肥鱼说说话", true, None::<&str>)?,
            &MenuItem::with_id(app, "toggle", if main_visible { "藏起来" } else { "叫出来" }, true, None::<&str>)?,
            &MenuItem::with_id(app, "reset", "回到屏幕角落", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
        ],
    )
}

fn open_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("settings") {
        w.show()?;
        return w.set_focus();
    }
    let w = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("大肥鱼 · 设置")
        .inner_size(480.0, 680.0)
        .min_inner_size(400.0, 480.0)
        .build()?;
    w.set_focus()
}

fn on_menu(app: &AppHandle, id: &str) {
    let main = app.get_webview_window("main");
    match id {
        "talk" => {
            if let Some(w) = &main {
                let _ = w.show();
                let _ = w.emit_to("main", "pet-menu", "talk");
            }
        }
        "toggle" => {
            if let Some(w) = &main {
                let _ = if w.is_visible().unwrap_or(true) { w.hide() } else { w.show() };
            }
            if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build_menu(app)) {
                let _ = tray.set_menu(Some(menu));
            }
        }
        "reset" => motion::place_initially(app),
        "settings" => {
            let _ = open_settings(app);
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Right-click menu on the pet itself.
#[tauri::command]
fn show_menu(window: WebviewWindow) -> tauri::Result<()> {
    let menu = build_menu(window.app_handle())?;
    window.popup_menu(&menu)
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> tauri::Result<()> {
    open_settings(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(motion::Motion::new())
        .invoke_handler(tauri::generate_handler![
            activity::activity,
            activity::title_permission,
            activity::request_title_permission,
            motion::drag_begin,
            motion::drag_end,
            motion::set_body,
            motion::set_hit_rects,
            motion::fall,
            motion::glide_by,
            motion::debug_throw,
            motion::set_pet_scale,
            store::store_load,
            store::store_save,
            store::data_dir,
            store::debug_dump,
            llm::llm_chat,
            show_menu,
            open_settings_window,
        ])
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .setup(|app| {
            // A pet shouldn't sit in the Dock / app switcher.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle();
            // Line-art whale (art/tray/whale.svg). On macOS it's a template image,
            // so the system tints it like other menu bar icons.
            #[cfg(target_os = "macos")]
            let (tray_icon, template) = (include_bytes!("../icons/tray/tray-template.png").as_slice(), true);
            #[cfg(not(target_os = "macos"))]
            let (tray_icon, template) = (include_bytes!("../icons/tray/tray-color.png").as_slice(), false);
            TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(tray_icon)?)
                .icon_as_template(template)
                .tooltip("大肥鱼 Chubby Whale")
                .menu(&build_menu(handle)?)
                .build(app)?;

            motion::place_initially(handle);
            if let Some(w) = app.get_webview_window("main") {
                app.state::<motion::Motion>().start(w);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
