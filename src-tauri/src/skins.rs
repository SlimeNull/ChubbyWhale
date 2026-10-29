//! Skins: one fixed directory per skin (see docs/STRUCTURE.md, "皮肤").
//!
//! Built-in skins ship as app resources (`skins/<id>/`); imported ones live in
//! `<app data>/skins/<id>/`. The frontend reads every skin file through
//! `skin_file`, so built-in and imported skins load the same way in dev and
//! release builds. Skins are exported and imported as .zip packages.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// The skin every other one falls back to (missing lines, prompts, voice settings).
pub const BASE_SKIN: &str = "standard";
const FORMAT: u64 = 1;
/// File types a skin may contain.
const ALLOWED_EXT: &[&str] = &["json", "webp", "png", "mp3", "ogg", "wav", "m4a", "txt", "md"];
const MAX_FILES: usize = 400;
const MAX_FILE_BYTES: u64 = 16 << 20;
const MAX_TOTAL_BYTES: u64 = 96 << 20;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkinMeta {
    #[serde(default)]
    pub format: u64,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinInfo {
    #[serde(flatten)]
    meta: SkinMeta,
    builtin: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    path: String,
    #[serde(flatten)]
    meta: SkinMeta,
    /// A user skin with this id is already installed (importing replaces it).
    exists: bool,
}

/// A validated skin package: its metadata and files (paths relative to the skin root).
#[derive(Debug)]
pub struct Package {
    pub meta: SkinMeta,
    pub files: Vec<(String, Vec<u8>)>,
}

pub fn valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// `a/b.webp` style path inside a skin: relative, no `..`, no odd characters.
fn safe_rel(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains('\\') {
        return None;
    }
    let p = Path::new(path);
    let ok = p.components().all(|c| match c {
        Component::Normal(s) => s.to_str().is_some_and(|s| !s.starts_with('.')),
        _ => false,
    });
    ok.then(|| p.to_path_buf())
}

fn builtin_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().resource_dir().map_err(|e| e.to_string())?.join("skins"))
}

fn user_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("skins"))
}

fn read_meta(dir: &Path) -> Option<SkinMeta> {
    serde_json::from_slice(&fs::read(dir.join("skin.json")).ok()?).ok()
}

/// Directory of an installed skin, and whether it is built in.
fn skin_dir(app: &AppHandle, id: &str) -> Result<(PathBuf, bool), String> {
    if !valid_id(id) {
        return Err(format!("无效的皮肤 id：{id}"));
    }
    let builtin = builtin_root(app)?.join(id);
    if builtin.join("skin.json").is_file() {
        return Ok((builtin, true));
    }
    let user = user_root(app)?.join(id);
    if user.join("skin.json").is_file() {
        return Ok((user, false));
    }
    Err(format!("找不到皮肤：{id}"))
}

/// Every sprite a skin must have: the ones in the base skin's sprites/manifest.json.
fn required_sprites(app: &AppHandle) -> Result<Vec<String>, String> {
    let base = builtin_root(app)?.join(BASE_SKIN).join("sprites/manifest.json");
    let m: Value = serde_json::from_slice(&fs::read(&base).map_err(|e| format!("{}: {e}", base.display()))?).map_err(|e| e.to_string())?;
    Ok(sprite_names(&m))
}

fn sprite_names(manifest: &Value) -> Vec<String> {
    ["poses", "variants"]
        .iter()
        .filter_map(|k| manifest[k].as_object())
        .flat_map(|o| o.keys().cloned())
        .collect()
}

fn list_dir(root: &Path, builtin: bool, out: &mut Vec<SkinInfo>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    let mut found: Vec<SkinInfo> = entries
        .flatten()
        .filter_map(|e| {
            let meta = read_meta(&e.path())?;
            (valid_id(&meta.id) && e.file_name().to_str() == Some(meta.id.as_str())).then_some(SkinInfo { meta, builtin })
        })
        .collect();
    found.sort_by(|a, b| (a.meta.id != BASE_SKIN, &a.meta.name).cmp(&(b.meta.id != BASE_SKIN, &b.meta.name)));
    out.extend(found);
}

/// Installed skins: built-in ones first (the base skin first of all), then imported ones.
#[tauri::command]
pub fn skin_list(app: AppHandle) -> Result<Vec<SkinInfo>, String> {
    let mut out = Vec::new();
    list_dir(&builtin_root(&app)?, true, &mut out);
    let builtin: HashSet<String> = out.iter().map(|s| s.meta.id.clone()).collect();
    let mut user = Vec::new();
    list_dir(&user_root(&app)?, false, &mut user);
    out.extend(user.into_iter().filter(|s| !builtin.contains(&s.meta.id)));
    Ok(out)
}

/// One file of a skin, as raw bytes.
#[tauri::command]
pub fn skin_file(app: AppHandle, id: String, path: String) -> Result<tauri::ipc::Response, String> {
    let rel = safe_rel(&path).ok_or_else(|| format!("无效的路径：{path}"))?;
    let (dir, _) = skin_dir(&app, &id)?;
    let bytes = fs::read(dir.join(&rel)).map_err(|e| format!("{id}/{path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Check a .zip skin package. `required` are the sprite names it must contain.
pub fn read_package(zip_bytes: &[u8], required: &[String]) -> Result<Package, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|e| format!("不是有效的 zip 压缩包：{e}"))?;
    if zip.len() > MAX_FILES * 2 {
        return Err("压缩包里的文件太多".into());
    }
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let name = f.name().map_err(|e| format!("压缩包里有无法识别的文件名：{e}"))?.into_owned();
        // Clutter that zip tools on macOS / Windows add.
        if name.starts_with("__MACOSX/") || name.rsplit('/').next().is_some_and(|n| n.starts_with('.') || n.eq_ignore_ascii_case("Thumbs.db")) {
            continue;
        }
        if f.enclosed_name().is_none() || safe_rel(&name).is_none() {
            return Err(format!("压缩包里有不安全的路径：{name}"));
        }
        if f.size() > MAX_FILE_BYTES {
            return Err(format!("文件太大：{name}"));
        }
        total += f.size();
        if total > MAX_TOTAL_BYTES {
            return Err("压缩包解压后太大".into());
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        // Read at most the declared size (+1 to notice a lying header).
        (&mut f).take(MAX_FILE_BYTES + 1).read_to_end(&mut data).map_err(|e| format!("{name}: {e}"))?;
        if data.len() as u64 > MAX_FILE_BYTES {
            return Err(format!("文件太大：{name}"));
        }
        entries.push((name, data));
    }
    if entries.len() > MAX_FILES {
        return Err("压缩包里的文件太多".into());
    }

    // Zipping the folder itself (not its contents) puts everything under one top folder.
    if !entries.iter().any(|(n, _)| n == "skin.json") {
        let top = entries.first().and_then(|(n, _)| n.split_once('/')).map(|(t, _)| format!("{t}/"));
        match top {
            Some(t) if entries.iter().all(|(n, _)| n.starts_with(&t)) && entries.iter().any(|(n, _)| *n == format!("{t}skin.json")) => {
                for (n, _) in &mut entries {
                    *n = n[t.len()..].to_string();
                }
            }
            _ => return Err("压缩包里没有 skin.json".into()),
        }
    }

    let files: BTreeMap<String, Vec<u8>> = entries.into_iter().collect();
    for name in files.keys() {
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        if !ALLOWED_EXT.contains(&ext.as_str()) {
            return Err(format!("不支持的文件类型：{name}"));
        }
    }
    let json = |name: &str| -> Result<Value, String> { serde_json::from_slice(&files[name]).map_err(|e| format!("{name} 不是有效的 JSON：{e}")) };
    for name in files.keys().filter(|n| n.ends_with(".json")) {
        json(name)?;
    }

    let meta: SkinMeta = serde_json::from_value(json("skin.json")?).map_err(|e| format!("skin.json 缺少字段：{e}"))?;
    if !valid_id(&meta.id) {
        return Err(format!("skin.json 里的 id「{}」无效：只能用小写字母、数字、- 和 _，最长 40 个字符", meta.id));
    }
    if meta.name.trim().is_empty() {
        return Err("skin.json 里缺少 name".into());
    }
    if meta.format > FORMAT {
        return Err(format!("这个皮肤需要更新版本的大肥鱼（格式 {}）", meta.format));
    }

    if !files.contains_key("sprites/manifest.json") {
        return Err("缺少 sprites/manifest.json".into());
    }
    let manifest = json("sprites/manifest.json")?;
    let listed: HashSet<String> = sprite_names(&manifest).into_iter().collect();
    let missing: Vec<&str> = required
        .iter()
        .filter(|n| !listed.contains(*n) || !files.contains_key(&format!("sprites/{n}.webp")))
        .map(String::as_str)
        .collect();
    if !missing.is_empty() {
        return Err(format!("缺少这些图像：{}", missing.join("、")));
    }
    Ok(Package { meta, files: files.into_iter().collect() })
}

/// Zip a skin directory (relative paths, `/` separators).
pub fn pack_dir(dir: &Path) -> Result<Vec<u8>, String> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for e in fs::read_dir(dir)? {
            let p = e?.path();
            if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.')) {
                continue;
            }
            if p.is_dir() {
                walk(base, &p, out)?;
            } else {
                out.push(p.strip_prefix(base).unwrap_or(&p).to_path_buf());
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(dir, dir, &mut files).map_err(|e| e.to_string())?;
    files.sort();
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for rel in files {
        let name = rel.components().filter_map(|c| c.as_os_str().to_str()).collect::<Vec<_>>().join("/");
        // Images and audio are compressed already.
        let method = if name.ends_with(".json") || name.ends_with(".txt") || name.ends_with(".md") {
            zip::CompressionMethod::Deflated
        } else {
            zip::CompressionMethod::Stored
        };
        let opts = zip::write::SimpleFileOptions::default().compression_method(method);
        zip.start_file(&name, opts).map_err(|e| e.to_string())?;
        zip.write_all(&fs::read(dir.join(&rel)).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

/// Let the user pick a skin package; validates it but doesn't install it yet.
#[tauri::command]
pub async fn skin_import_pick(app: AppHandle, window: WebviewWindow) -> Result<Option<ImportPreview>, String> {
    let Some(picked) = app.dialog().file().set_parent(&window).set_title("导入皮肤").add_filter("大肥鱼皮肤", &["zip"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let pkg = read_package(&fs::read(&path).map_err(|e| e.to_string())?, &required_sprites(&app)?)?;
    if builtin_root(&app)?.join(&pkg.meta.id).exists() {
        return Err(format!("「{}」和内置皮肤重名（id：{}），请在 skin.json 里换一个 id", pkg.meta.name, pkg.meta.id));
    }
    let exists = user_root(&app)?.join(&pkg.meta.id).exists();
    Ok(Some(ImportPreview { path: path.to_string_lossy().into_owned(), meta: pkg.meta, exists }))
}

/// Install a package checked by `skin_import_pick` (replacing an imported skin with the same id).
#[tauri::command]
pub async fn skin_import_install(app: AppHandle, path: String) -> Result<SkinMeta, String> {
    let pkg = read_package(&fs::read(&path).map_err(|e| e.to_string())?, &required_sprites(&app)?)?;
    if builtin_root(&app)?.join(&pkg.meta.id).exists() {
        return Err("不能覆盖内置皮肤".into());
    }
    let root = user_root(&app)?;
    // Unpack next to the target, then swap, so a failed import never leaves half a skin.
    let tmp = root.join(format!(".import-{}", pkg.meta.id));
    let _ = fs::remove_dir_all(&tmp);
    for (name, data) in &pkg.files {
        let p = tmp.join(safe_rel(name).ok_or("bad path")?);
        fs::create_dir_all(p.parent().unwrap_or(&tmp)).map_err(|e| e.to_string())?;
        fs::write(&p, data).map_err(|e| e.to_string())?;
    }
    let dest = root.join(&pkg.meta.id);
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(pkg.meta)
}

/// Save a skin as a .zip package where the user chooses. Returns the path, or None if cancelled.
#[tauri::command]
pub async fn skin_export(app: AppHandle, window: WebviewWindow, id: String) -> Result<Option<String>, String> {
    let (dir, _) = skin_dir(&app, &id)?;
    let name = read_meta(&dir).map(|m| m.name).unwrap_or(id.clone());
    let file_name: String = name.chars().map(|c| if r#"/\:*?"<>|"#.contains(c) { '_' } else { c }).collect();
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("导出皮肤")
        .set_file_name(format!("{file_name}.zip"))
        .add_filter("大肥鱼皮肤", &["zip"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, pack_dir(&dir)?).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Remove an imported skin (built-in ones can't be removed).
#[tauri::command]
pub fn skin_delete(app: AppHandle, id: String) -> Result<(), String> {
    let (dir, builtin) = skin_dir(&app, &id)?;
    if builtin {
        return Err("内置皮肤不能删除".into());
    }
    fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standard() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../skins/standard")
    }

    fn required() -> Vec<String> {
        sprite_names(&serde_json::from_slice(&fs::read(standard().join("sprites/manifest.json")).unwrap()).unwrap())
    }

    /// Re-zip `files` (optionally under a top folder), dropping or replacing some entries.
    fn rezip(prefix: &str, edit: impl Fn(&str, &[u8]) -> Option<Vec<u8>>, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let pkg = read_package(&pack_dir(&standard()).unwrap(), &required()).unwrap();
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        for (name, data) in &pkg.files {
            if let Some(d) = edit(name, data) {
                zip.start_file(format!("{prefix}{name}"), opts).unwrap();
                zip.write_all(&d).unwrap();
            }
        }
        for (name, data) in extra {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn standard_skin_round_trips() {
        let pkg = read_package(&pack_dir(&standard()).unwrap(), &required()).unwrap();
        assert_eq!(pkg.meta.id, BASE_SKIN);
        for f in ["skin.json", "lines.json", "voice.json", "prompts.json", "opinions.json", "sprites/idle.webp"] {
            assert!(pkg.files.iter().any(|(n, _)| n == f), "{f} missing");
        }
    }

    #[test]
    fn every_builtin_skin_is_a_valid_package() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../skins");
        let mut n = 0;
        for e in fs::read_dir(&root).unwrap().flatten() {
            let pkg = read_package(&pack_dir(&e.path()).unwrap(), &required()).unwrap_or_else(|err| panic!("{}: {err}", e.path().display()));
            assert_eq!(e.file_name().to_str(), Some(pkg.meta.id.as_str()), "folder name must be the id");
            n += 1;
        }
        assert!(n >= 2, "expected the standard skin and at least one more");
    }

    #[test]
    fn accepts_a_top_folder_and_os_clutter() {
        let z = rezip("我的皮肤/", |_, d| Some(d.to_vec()), &[("__MACOSX/._skin.json", b"x"), ("我的皮肤/.DS_Store", b"x")]);
        let pkg = read_package(&z, &required()).unwrap();
        assert!(pkg.files.iter().any(|(n, _)| n == "skin.json"));
    }

    #[test]
    fn rejects_missing_sprites() {
        let z = rezip("", |n, d| (n != "sprites/peek.webp").then(|| d.to_vec()), &[]);
        let err = read_package(&z, &required()).unwrap_err();
        assert!(err.contains("peek"), "{err}");
    }

    #[test]
    fn rejects_unsafe_paths_and_types() {
        let z = rezip("", |_, d| Some(d.to_vec()), &[("../evil.json", b"{}")]);
        assert!(read_package(&z, &required()).unwrap_err().contains("不安全"));
        let z = rezip("", |_, d| Some(d.to_vec()), &[("run.exe", b"MZ")]);
        assert!(read_package(&z, &required()).unwrap_err().contains("不支持"));
    }

    #[test]
    fn rejects_bad_ids_and_json() {
        let z = rezip("", |n, d| Some(if n == "skin.json" { br#"{"id":"Bad Id","name":"x"}"#.to_vec() } else { d.to_vec() }), &[]);
        assert!(read_package(&z, &required()).unwrap_err().contains("无效"));
        let z = rezip("", |n, d| Some(if n == "lines.json" { b"{oops".to_vec() } else { d.to_vec() }), &[]);
        assert!(read_package(&z, &required()).unwrap_err().contains("lines.json"));
    }

    #[test]
    fn ids_and_paths() {
        assert!(valid_id("standard") && valid_id("my_skin-2"));
        assert!(!valid_id("") && !valid_id("Upper") && !valid_id("a/b") && !valid_id(&"x".repeat(41)));
        assert!(safe_rel("sprites/idle.webp").is_some());
        for bad in ["../x", "/etc/passwd", "a/../../b", "a\\b", ".hidden", "a/.git/config", ""] {
            assert!(safe_rel(bad).is_none(), "{bad}");
        }
    }
}
