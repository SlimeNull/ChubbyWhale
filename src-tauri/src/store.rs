//! Tiny JSON document store in the app data directory (settings, memory).

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const NAMES: &[&str] = &["settings", "memory"];

fn path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !NAMES.contains(&name) {
        return Err(format!("unknown store: {name}"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn store_load(app: AppHandle, name: String) -> Result<Option<Value>, String> {
    let p = path(&app, &name)?;
    match fs::read_to_string(&p) {
        Ok(text) => Ok(serde_json::from_str(&text).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn store_save(app: AppHandle, name: String, value: Value) -> Result<(), String> {
    let p = path(&app, &name)?;
    let tmp = p.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn data_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Dev builds only: write a canvas snapshot, audio render or log line into the
/// data dir so output can be checked without screen-capture permission.
#[tauri::command]
pub fn debug_dump(app: AppHandle, name: String, data: String) -> Result<(), String> {
    if !cfg!(debug_assertions) || !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Ok(());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("debug");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // "data:<mime>;base64,..." is written as binary (PNG snapshots, WAV renders); anything else is appended as a log line.
    let payload = data.strip_prefix("data:").and_then(|d| d.split_once(";base64,")).map(|(_, b64)| b64);
    let bytes = match payload {
        Some(b64) => base64_decode(b64)?,
        None => {
            let mut line = data.into_bytes();
            line.push(b'\n');
            use std::io::Write;
            let mut f = fs::OpenOptions::new().create(true).append(true).open(dir.join(&name)).map_err(|e| e.to_string())?;
            return f.write_all(&line).map_err(|e| e.to_string());
        }
    };
    fs::write(dir.join(name), bytes).map_err(|e| e.to_string())
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0);
    for c in s.bytes().filter(|&c| c != b'=') {
        let v = T.iter().position(|&t| t == c).ok_or("bad base64")? as u32;
        buf = buf << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}
