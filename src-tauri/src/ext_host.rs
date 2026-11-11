//! Хост расширений: отдельный процесс Node.js, в котором работают расширения VS Code
//! (код хоста — `exthost/host.js` и `exthost/vscode.js`, там же реализован модуль `vscode`).
//!
//! ВАЖНО для безопасности: расширение — это обычный код с правами пользователя (так же, как
//! в VS Code). Поэтому:
//!   * ничего не запускается, пока пользователь явно не ДОВЕРИЛ конкретному расширению;
//!     список доверенных хранится в файле и проверяется здесь, а не только в интерфейсе;
//!   * хост получает только доверенные расширения (`exthost_extensions`);
//!   * хост запускается с аргументами из фиксированного набора, пути берутся из папки данных
//!     приложения; сообщения от интерфейса к хосту проверяются (JSON-объект известного типа).

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::WorkspaceRoot;

const HOST_JS: &str = include_str!("../exthost/host.js");
const VSCODE_JS: &str = include_str!("../exthost/vscode.js");
const PKG_JSON: &str = include_str!("../exthost/package.json");
const ESM_HOOKS: &str = include_str!("../exthost/esm-hooks.mjs");
const MAX_LINE: usize = 16 * 1024 * 1024;

struct Session {
    stdin: ChildStdin,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
pub struct HostState(Mutex<Option<Session>>);

#[derive(Serialize, Clone)]
struct Line {
    line: String,
}

#[derive(Serialize, Clone)]
struct Exit {
    code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    extensions_dir: String,
    data_dir: String,
    app_root: String,
    node_path: Option<String>,
    node_version: Option<String>,
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !s.starts_with('.')
}

fn data_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn find_node() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(var) {
            dirs.push(PathBuf::from(p).join("nodejs"));
        }
    }
    dirs.into_iter().map(|d| d.join(if cfg!(windows) { "node.exe" } else { "node" })).find(|p| p.is_file())
}

fn node_version(node: &Path) -> Option<String> {
    let out = Command::new(node).arg("--version").stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().chars().take(30).collect())
}

fn trust_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("trusted-extensions.json"))
}

fn read_trust<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<String> {
    trust_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .map(|v| v.into_iter().filter(|s| valid_id(s)).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn exthost_info(app: AppHandle) -> Result<HostInfo, String> {
    let dir = data_dir(&app)?;
    let node = find_node();
    Ok(HostInfo {
        extensions_dir: dir.join("extensions").to_string_lossy().to_string(),
        data_dir: dir.join("exthost-data").to_string_lossy().to_string(),
        app_root: dir.to_string_lossy().to_string(),
        node_version: node.as_deref().and_then(node_version),
        node_path: node.map(|p| p.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn ext_trust_list(app: AppHandle) -> Vec<String> {
    read_trust(&app)
}

#[tauri::command]
pub fn ext_trust_set(app: AppHandle, id: String, trusted: bool) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Некорректное имя расширения".into());
    }
    let mut list = read_trust(&app);
    list.retain(|x| x != &id);
    if trusted {
        list.push(id);
    }
    list.sort();
    let path = trust_path(&app)?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

/// Доверенные И установленные расширения: id, папка и package.json (текст) для инициализации хоста.
#[tauri::command]
pub fn exthost_extensions(app: AppHandle) -> Result<Vec<HashMap<String, String>>, String> {
    let root = data_dir(&app)?.join("extensions");
    let mut out = Vec::new();
    for id in read_trust(&app) {
        let dir = root.join(&id);
        let Ok(manifest) = fs::read_to_string(dir.join("package.json")) else { continue };
        let mut m = HashMap::new();
        m.insert("id".to_string(), id);
        m.insert("dir".to_string(), dir.to_string_lossy().to_string());
        m.insert("manifest".to_string(), manifest.trim_start_matches('\u{feff}').to_string());
        out.push(m);
    }
    Ok(out)
}

fn write_host_files(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("host.js"), HOST_JS).map_err(|e| e.to_string())?;
    fs::write(dir.join("vscode.js"), VSCODE_JS).map_err(|e| e.to_string())?;
    fs::write(dir.join("package.json"), PKG_JSON).map_err(|e| e.to_string())?;
    fs::write(dir.join("esm-hooks.mjs"), ESM_HOOKS).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn exthost_start(app: AppHandle, state: State<HostState>, root: State<WorkspaceRoot>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }
    let node = find_node().ok_or("Для расширений нужен Node.js. Установите его с nodejs.org и перезапустите AIDE.")?;
    let base = data_dir(&app)?;
    let host_dir = base.join("exthost");
    write_host_files(&host_dir)?;
    fs::create_dir_all(base.join("exthost-data")).map_err(|e| e.to_string())?;
    let cwd = crate::fs_commands::workspace_root(&root).unwrap_or_else(|_| base.clone());

    let mut cmd = Command::new(node);
    cmd.args(["--max-old-space-size=2048", "host.js"]).current_dir(&host_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.env("AIDE_WORKSPACE", &cwd);
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Не удалось запустить Node.js: {e}"))?;
    let stdin = child.stdin.take().ok_or("Нет входа процесса")?;
    let stdout = child.stdout.take().ok_or("Нет выхода процесса")?;
    let stderr = child.stderr.take().ok_or("Нет потока ошибок")?;
    let child = Arc::new(Mutex::new(child));
    *guard = Some(Session { stdin, child: child.clone() });
    drop(guard);

    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.by_ref().take(MAX_LINE as u64 + 1).read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if buf.len() > MAX_LINE {
                let mut skip = Vec::new();
                let _ = reader.read_until(b'\n', &mut skip);
                continue;
            }
            let line = String::from_utf8_lossy(&buf).trim().to_string();
            if !line.is_empty() {
                let _ = app_out.emit("exthost-line", Line { line });
            }
        }
        let code = child.lock().ok().and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        *app_out.state::<HostState>().0.lock().unwrap() = None;
        let _ = app_out.emit("exthost-exit", Exit { code });
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok).take(5000) {
            let _ = app.emit("exthost-stderr", Line { line: line.chars().take(2000).collect() });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn exthost_send(state: State<HostState>, line: String) -> Result<(), String> {
    if line.len() > MAX_LINE || line.contains('\n') {
        return Err("Недопустимое сообщение".into());
    }
    let v: Value = serde_json::from_str(&line).map_err(|_| "Некорректное сообщение".to_string())?;
    if !matches!(v.get("t").and_then(Value::as_str), Some("n") | Some("q") | Some("r")) {
        return Err("Недопустимый тип сообщения".into());
    }
    let mut guard = state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("Хост расширений не запущен")?;
    session.stdin.write_all(line.as_bytes()).and_then(|_| session.stdin.write_all(b"\n")).and_then(|_| session.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn exthost_stop(state: State<HostState>) {
    if let Some(s) = state.0.lock().unwrap().take() {
        if let Ok(mut c) = s.child.lock() {
            let _ = c.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_files_are_present() {
        assert!(HOST_JS.contains("AIDE extension host"));
        assert!(VSCODE_JS.contains("createVscode"));
        assert!(PKG_JSON.contains("commonjs"));
    }

    #[test]
    fn shim_is_injected_first() {
        assert!(inject_shim("<html><head><meta></head></html>").starts_with("<html><head><script src=\"/__shim.js\"></script><meta>"));
        assert!(inject_shim("<p>x</p>").starts_with("<script src=\"/__shim.js\"></script><p>"));
    }

    #[test]
    fn extension_files_cannot_escape() {
        let dir = std::env::temp_dir().join(format!("aide-wv-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("ext/media")).unwrap();
        fs::write(dir.join("ext/media/a.js"), "1").unwrap();
        fs::write(dir.join("secret.txt"), "s").unwrap();
        let base = dir.join("ext").canonicalize().unwrap();
        let ok = |p: &[&str]| safe_join(&base, &p.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert!(ok(&["media", "a.js"]).is_some());
        assert!(ok(&["..", "secret.txt"]).is_none());
        assert!(ok(&["media", "..", "..", "secret.txt"]).is_none());
        assert!(ok(&["media\\a.js"]).is_none());
        assert!(ok(&["C:", "x"]).is_none());
        assert!(ok(&["media"]).is_none(), "directories are not served");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ids_validated() {
        assert!(valid_id("esbenp.prettier-vscode"));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a b"));
    }
}

/* ── веб-вью расширений: схема aideext ─────────────────────────────── */

const SHIM_JS: &str = include_str!("../exthost/webview-shim.js");

/// HTML, который расширение задало веб-вью (id -> html). Отдаётся по aideext://…/__webview/<id>.
#[derive(Default)]
pub struct WebviewHtml(Mutex<HashMap<String, String>>);

#[tauri::command]
pub fn webview_set_html(state: State<WebviewHtml>, id: String, html: String) -> Result<(), String> {
    if !valid_id(&id) || html.len() > 16 * 1024 * 1024 {
        return Err("Недопустимое веб-вью".into());
    }
    let mut map = state.0.lock().unwrap();
    if map.len() > 200 {
        map.clear();
    }
    map.insert(id, html);
    Ok(())
}

#[tauri::command]
pub fn webview_drop(state: State<WebviewHtml>, id: String) {
    state.0.lock().unwrap().remove(&id);
}

fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" | "cjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn reply(status: u16, mime: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// Прослойка подключается первой и внешним скриптом: так её не блокирует CSP страницы.
fn inject_shim(html: &str) -> String {
    let tag = "<script src=\"/__shim.js\"></script>";
    match html.to_lowercase().find("<head>") {
        Some(i) => format!("{}{}{}", &html[..i + 6], tag, &html[i + 6..]),
        None => format!("{tag}{html}"),
    }
}

/// Файл внутри папки расширения: без `..`, дисков и обратных слэшей, итоговый путь не выходит за `base`.
fn safe_join(base: &Path, parts: &[String]) -> Option<PathBuf> {
    let mut full = base.to_path_buf();
    for seg in parts {
        if seg.is_empty() || seg == ".." || seg == "." || seg.contains('\\') || seg.contains(':') || seg.contains('\0') {
            return None;
        }
        full.push(seg);
    }
    let full = full.canonicalize().ok()?;
    (full.starts_with(base) && full.is_file()).then_some(full)
}

/// Обработчик схемы `aideext`: документ веб-вью, скрипт-прослойка и файлы ДОВЕРЕННЫХ расширений.
pub fn serve_webview<R: tauri::Runtime>(ctx: tauri::UriSchemeContext<'_, R>, req: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let app = ctx.app_handle();
    let path = req.uri().path().to_string();
    let decode = |s: &str| percent_encoding::percent_decode_str(s).decode_utf8_lossy().to_string();
    let parts: Vec<String> = path.split('/').filter(|s| !s.is_empty()).map(decode).collect();
    if parts.is_empty() {
        return reply(404, "text/plain", b"not found".to_vec());
    }
    if parts[0] == "__shim.js" {
        return reply(200, "application/javascript; charset=utf-8", SHIM_JS.as_bytes().to_vec());
    }
    if parts[0] == "__webview" && parts.len() == 2 {
        let html = app.state::<WebviewHtml>().0.lock().unwrap().get(&parts[1]).cloned().unwrap_or_default();
        return reply(200, "text/html; charset=utf-8", inject_shim(&html).into_bytes());
    }
    // /<id расширения>/<путь внутри расширения>
    let id = &parts[0];
    if !valid_id(id) || !read_trust(app).iter().any(|t| t == id) {
        return reply(403, "text/plain", b"forbidden".to_vec());
    }
    let Ok(root) = data_dir(app).map(|d| d.join("extensions").join(id)) else { return reply(500, "text/plain", Vec::new()) };
    let Ok(base) = root.canonicalize() else { return reply(404, "text/plain", b"not found".to_vec()) };
    let Some(full) = safe_join(&base, &parts[1..]) else { return reply(404, "text/plain", b"not found".to_vec()) };
    match fs::read(&full) {
        Ok(bytes) => reply(200, mime_of(&full), bytes),
        Err(_) => reply(404, "text/plain", b"not found".to_vec()),
    }
}
