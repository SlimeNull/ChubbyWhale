//! What is the user doing right now? Foreground app + window title + idle time.
//!
//! On macOS, window titles of other apps are only visible after the user grants
//! "Screen Recording" permission; without it we still get the app name.

use serde::Serialize;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    app_name: String,
    title: String,
    process_path: String,
    is_self: bool,
    idle_secs: u64,
}

#[tauri::command]
pub fn activity() -> Activity {
    let idle_secs = user_idle::UserIdle::get_time().map(|t| t.as_seconds()).unwrap_or(0);
    match active_win_pos_rs::get_active_window() {
        Ok(w) => Activity {
            is_self: w.process_id == std::process::id() as u64,
            app_name: w.app_name,
            title: w.title,
            process_path: w.process_path.to_string_lossy().into_owned(),
            idle_secs,
        },
        Err(()) => Activity { idle_secs, ..Default::default() },
    }
}

#[cfg(target_os = "macos")]
mod mac {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }
}

/// Whether window titles are readable. Always true outside macOS.
#[tauri::command]
pub fn title_permission() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        mac::CGPreflightScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// Ask macOS for Screen Recording permission (shows the system prompt once).
#[tauri::command]
pub fn request_title_permission() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        mac::CGRequestScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    true
}
