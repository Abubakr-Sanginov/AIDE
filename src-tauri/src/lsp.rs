//! Языковые серверы (LSP): автодополнение по типам, переход к определению, ошибки в редакторе, переименование.
//!
//! Сервером владеет Rust, а не вкладка редактора:
//! - процесс запускается один на язык и проект, рукопожатие `initialize` делает AIDE сам;
//!   редактор (@codemirror/lsp-client) при подключении получает уже готовый ответ;
//! - служебные запросы сервера (configuration, registerCapability, …) тоже отвечает AIDE;
//! - ошибки (`publishDiagnostics`) кэшируются по файлам — их видит агент через инструмент get_diagnostics,
//!   даже если файл не открыт в редакторе (тогда AIDE ненадолго открывает его у сервера сам).
//!
//! Безопасность: серверы берутся только из установленных программ (PATH и стандартные папки тулчейнов),
//! никогда из папки проекта — чужой репозиторий не может подсунуть свой «сервер». Сообщения ограничены по размеру.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_AGENT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const INIT_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_DIAGNOSTICS_LISTED: usize = 60;

struct ServerSpec {
    id: &'static str,
    name: &'static str,
    /// Варианты программы: (имя, аргументы). Берётся первая найденная.
    candidates: &'static [(&'static str, &'static [&'static str])],
    /// Расширение файла → languageId.
    exts: &'static [(&'static str, &'static str)],
    install: &'static str,
}

const SERVERS: &[ServerSpec] = &[
    ServerSpec {
        id: "typescript",
        name: "TypeScript / JavaScript",
        candidates: &[("typescript-language-server", &["--stdio"])],
        exts: &[
            ("ts", "typescript"), ("mts", "typescript"), ("cts", "typescript"), ("tsx", "typescriptreact"),
            ("js", "javascript"), ("mjs", "javascript"), ("cjs", "javascript"), ("jsx", "javascriptreact"),
        ],
        install: "npm install -g typescript-language-server typescript",
    },
    ServerSpec {
        id: "rust",
        name: "Rust",
        candidates: &[("rust-analyzer", &[])],
        exts: &[("rs", "rust")],
        install: "rustup component add rust-analyzer",
    },
    ServerSpec {
        id: "python",
        name: "Python",
        candidates: &[("pyright-langserver", &["--stdio"]), ("basedpyright-langserver", &["--stdio"]), ("pylsp", &[])],
        exts: &[("py", "python"), ("pyi", "python")],
        install: "npm install -g pyright",
    },
    ServerSpec {
        id: "go",
        name: "Go",
        candidates: &[("gopls", &[])],
        exts: &[("go", "go")],
        install: "go install golang.org/x/tools/gopls@latest",
    },
    ServerSpec {
        id: "cpp",
        name: "C / C++",
        candidates: &[("clangd", &[])],
        exts: &[("c", "c"), ("h", "cpp"), ("cpp", "cpp"), ("cc", "cpp"), ("cxx", "cpp"), ("hpp", "cpp"), ("hh", "cpp"), ("hxx", "cpp")],
        install: "winget install LLVM.LLVM",
    },
    ServerSpec {
        id: "css",
        name: "CSS / SCSS / Less",
        candidates: &[("vscode-css-language-server", &["--stdio"])],
        exts: &[("css", "css"), ("scss", "scss"), ("less", "less")],
        install: "npm install -g vscode-langservers-extracted",
    },
    ServerSpec {
        id: "html",
        name: "HTML",
        candidates: &[("vscode-html-language-server", &["--stdio"])],
        exts: &[("html", "html"), ("htm", "html")],
        install: "npm install -g vscode-langservers-extracted",
    },
    ServerSpec {
        id: "json",
        name: "JSON",
        candidates: &[("vscode-json-language-server", &["--stdio"])],
        exts: &[("json", "json"), ("jsonc", "jsonc")],
        install: "npm install -g vscode-langservers-extracted",
    },
];

fn spec(id: &str) -> Option<&'static ServerSpec> {
    SERVERS.iter().find(|s| s.id == id)
}

/// Сервер и languageId для файла по расширению.
fn spec_for_path(path: &str) -> Option<(&'static ServerSpec, &'static str)> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    SERVERS.iter().find_map(|s| s.exts.iter().find(|(e, _)| *e == ext).map(|(_, lang)| (s, *lang)))
}

/// Папки, где ищем программу: PATH (только абсолютные пути — без текущей папки) и стандартные места тулчейнов.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).filter(|d| d.is_absolute()).collect())
        .unwrap_or_default();
    if let Some(home) = dirs_next::home_dir() {
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join("go").join("bin"));
        dirs.push(home.join(".local").join("bin"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs
}

fn find_program(name: &str) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat"] } else { &[""] };
    search_dirs()
        .into_iter()
        .flat_map(|d| exts.iter().map(move |e| d.join(format!("{name}{e}"))))
        .find(|p| p.is_file())
}

fn resolve(spec: &ServerSpec) -> Option<(PathBuf, &'static [&'static str])> {
    spec.candidates.iter().find_map(|(name, args)| find_program(name).map(|p| (p, *args)))
}

/// Ключ файла для кэша: путь в нижнем регистре (Windows) с прямыми слэшами — сервер может прислать тот же файл
/// как `file:///d%3A/...` или `file:///D:/...`.
fn key_of_uri(uri: &str) -> String {
    let path = url::Url::parse(uri).ok().and_then(|u| u.to_file_path().ok());
    let s = match path {
        Some(p) => p.to_string_lossy().replace('\\', "/"),
        None => uri.to_string(),
    };
    if cfg!(windows) { s.to_lowercase() } else { s }
}

fn uri_of_path(path: &Path) -> Result<String, String> {
    url::Url::from_file_path(path).map(|u| u.to_string()).map_err(|_| "некорректный путь файла".to_string())
}

#[derive(Clone, Copy, PartialEq)]
enum Owner {
    Client,
    Agent,
}

struct Session {
    server_id: &'static str,
    root: PathBuf,
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    init_result: Mutex<Option<Value>>,
    /// key → (когда пришло, диагностики сервера как есть).
    diagnostics: Mutex<HashMap<String, (Instant, Vec<Value>)>>,
    /// Кто держит документ открытым у сервера: key → (owner, исходный uri).
    open: Mutex<HashMap<String, (Owner, String)>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    next_id: AtomicU64,
    alive: AtomicBool,
    /// Последние строки stderr сервера — для понятной ошибки, если он упал при запуске.
    stderr_tail: Mutex<String>,
}

impl Session {
    fn write(&self, msg: &Value) -> Result<(), String> {
        let body = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
        let mut w = self.stdin.lock().map_err(|_| "LSP: канал недоступен")?;
        write!(w, "Content-Length: {}\r\n\r\n", body.len()).map_err(|e| e.to_string())?;
        w.write_all(&body).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    /// Собственный запрос AIDE к серверу (id вида "aide-N", не пересекается с числовыми id редактора).
    fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = format!("aide-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        self.write(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let resp = rx.recv_timeout(timeout).map_err(|e| {
            self.pending.lock().unwrap().remove(&id);
            match e {
                // Процесс завершился, не ответив: показываем, что он успел написать в stderr.
                mpsc::RecvTimeoutError::Disconnected => {
                    let tail = self.stderr_tail.lock().map(|t| t.trim().to_string()).unwrap_or_default();
                    if tail.is_empty() {
                        format!("LSP {}: сервер завершился сразу после запуска", self.server_id)
                    } else {
                        format!("LSP {}: сервер завершился: {tail}", self.server_id)
                    }
                }
                mpsc::RecvTimeoutError::Timeout => format!("LSP {}: нет ответа на {method}", self.server_id),
            }
        })?;
        if let Some(err) = resp.get("error") {
            return Err(format!("LSP {}: {}", self.server_id, err["message"].as_str().unwrap_or("ошибка")));
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    fn kill(&self) {
        self.alive.store(false, Ordering::Relaxed);
        let _ = self.write(&json!({ "jsonrpc": "2.0", "id": "aide-shutdown", "method": "shutdown" }));
        let _ = self.notify("exit", Value::Null);
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

#[derive(Default)]
pub struct LspState {
    sessions: Mutex<HashMap<&'static str, Arc<Session>>>,
    /// Очередь сообщений редактора на каждый сервер: один поток отправляет их строго по порядку
    /// (параллельные вызовы команд могли бы переставить didChange местами).
    outbox: Mutex<HashMap<&'static str, mpsc::Sender<String>>>,
}

#[derive(Serialize, Clone)]
struct LspMessage<'a> {
    server: &'a str,
    message: String,
}

#[derive(Serialize, Clone)]
struct LspStatus<'a> {
    server: &'a str,
    state: &'a str,
    message: String,
}

fn emit_status(app: &AppHandle, server: &str, state: &str, message: impl Into<String>) {
    let _ = app.emit("lsp-status", LspStatus { server, state, message: message.into() });
}

/// Возможности клиента: то, что умеет @codemirror/lsp-client, плюс приём диагностики.
fn client_capabilities() -> Value {
    json!({
        "general": { "markdown": { "parser": "marked" }, "positionEncodings": ["utf-16"] },
        "textDocument": {
            "synchronization": { "didSave": true, "dynamicRegistration": false },
            "completion": {
                "completionItem": { "snippetSupport": true, "documentationFormat": ["markdown", "plaintext"], "insertReplaceSupport": false },
                "completionList": { "itemDefaults": ["commitCharacters", "editRange", "insertTextFormat"] },
                "completionItemKind": { "valueSet": [] },
                "contextSupport": true
            },
            "hover": { "contentFormat": ["markdown", "plaintext"] },
            "formatting": {},
            "rename": {},
            "signatureHelp": {
                "contextSupport": true,
                "signatureInformation": { "documentationFormat": ["markdown", "plaintext"], "parameterInformation": { "labelOffsetSupport": true }, "activeParameterSupport": true }
            },
            "definition": {}, "declaration": {}, "implementation": {}, "typeDefinition": {}, "references": {},
            "publishDiagnostics": { "relatedInformation": false, "versionSupport": true }
        },
        "window": { "showMessage": {}, "workDoneProgress": true },
        "workspace": { "configuration": true, "workspaceFolders": true, "applyEdit": false }
    })
}

/// Ответ на служебный запрос сервера: AIDE отвечает сам, редактор их не видит.
fn answer_server_request(session: &Session, msg: &Value) {
    let id = msg["id"].clone();
    let method = msg["method"].as_str().unwrap_or("");
    let reply = match method {
        "workspace/configuration" => {
            let n = msg["params"]["items"].as_array().map(|a| a.len()).unwrap_or(0);
            json!({ "jsonrpc": "2.0", "id": id, "result": vec![Value::Null; n] })
        }
        "workspace/workspaceFolders" => {
            let uri = uri_of_path(&session.root).unwrap_or_default();
            let name = session.root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            json!({ "jsonrpc": "2.0", "id": id, "result": [{ "uri": uri, "name": name }] })
        }
        "client/registerCapability" | "client/unregisterCapability" | "window/workDoneProgress/create"
        | "window/showMessageRequest" | "workspace/diagnostic/refresh" | "workspace/semanticTokens/refresh"
        | "workspace/inlayHint/refresh" | "workspace/codeLens/refresh" => json!({ "jsonrpc": "2.0", "id": id, "result": null }),
        "workspace/applyEdit" => json!({ "jsonrpc": "2.0", "id": id, "result": { "applied": false } }),
        _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not supported" } }),
    };
    let _ = session.write(&reply);
}

fn read_message(reader: &mut impl BufRead) -> Option<Value> {
    let mut len: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("Content-Length:") {
            len = v.trim().parse().ok();
        }
    }
    let len = len?;
    if len > MAX_MESSAGE_BYTES {
        return None;
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

fn reader_loop(app: AppHandle, session: Arc<Session>, stdout: std::process::ChildStdout) {
    let mut reader = BufReader::new(stdout);
    while let Some(msg) = read_message(&mut reader) {
        let has_method = msg.get("method").is_some();
        let has_id = msg.get("id").map(|i| !i.is_null()).unwrap_or(false);
        if has_method && has_id {
            answer_server_request(&session, &msg);
            continue;
        }
        if !has_method {
            // Ответ: на запрос AIDE — во внутреннюю очередь, на запрос редактора — в редактор.
            if let Some(id) = msg["id"].as_str().filter(|i| i.starts_with("aide-")) {
                if let Some(tx) = session.pending.lock().unwrap().remove(id) {
                    let _ = tx.send(msg);
                }
                continue;
            }
        } else if msg["method"] == "textDocument/publishDiagnostics" {
            if let Some(uri) = msg["params"]["uri"].as_str() {
                let list = msg["params"]["diagnostics"].as_array().cloned().unwrap_or_default();
                session.diagnostics.lock().unwrap().insert(key_of_uri(uri), (Instant::now(), list));
            }
        }
        let _ = app.emit("lsp-message", LspMessage { server: session.server_id, message: msg.to_string() });
    }
    // Процесс завершился: ожидающие ответа запросы AIDE не должны ждать до таймаута. Даём stderr дочитаться.
    std::thread::sleep(Duration::from_millis(150));
    session.pending.lock().unwrap().clear();
    if session.alive.swap(false, Ordering::Relaxed) {
        let state = app.state::<LspState>();
        let mut map = state.sessions.lock().unwrap();
        if map.get(session.server_id).is_some_and(|s| Arc::ptr_eq(s, &session)) {
            map.remove(session.server_id);
        }
        emit_status(&app, session.server_id, "stopped", "сервер завершился");
    }
}

fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<crate::WorkspaceRoot>();
    crate::fs_commands::workspace_root(&state)
}

/// Запущенный и инициализированный сервер для текущего проекта (запускает при необходимости). Блокирующая.
fn ensure(app: &AppHandle, server_id: &str) -> Result<Arc<Session>, String> {
    let spec = spec(server_id).ok_or("неизвестный языковой сервер")?;
    let root = workspace_root(app)?;
    {
        let state = app.state::<LspState>();
        let map = state.sessions.lock().unwrap();
        if let Some(s) = map.get(spec.id) {
            if s.root == root && s.alive.load(Ordering::Relaxed) {
                let s = s.clone();
                drop(map);
                wait_ready(&s)?;
                return Ok(s);
            }
        }
    }
    let (program, args) = resolve(spec)
        .ok_or_else(|| format!("Языковой сервер {} не установлен. Установите: {}", spec.name, spec.install))?;
    emit_status(app, spec.id, "starting", program.to_string_lossy());

    let mut cmd = Command::new(&program);
    cmd.args(args).current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить {}: {e}", program.to_string_lossy()))?;
    let stdin = child.stdin.take().ok_or("stdin недоступен")?;
    let stdout = child.stdout.take().ok_or("stdout недоступен")?;
    let stderr = child.stderr.take();
    let session = Arc::new(Session {
        server_id: spec.id,
        root: root.clone(),
        stdin: Mutex::new(stdin),
        child: Mutex::new(child),
        init_result: Mutex::new(None),
        diagnostics: Mutex::new(HashMap::new()),
        open: Mutex::new(HashMap::new()),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        alive: AtomicBool::new(true),
        stderr_tail: Mutex::new(String::new()),
    });
    let old = {
        let state = app.state::<LspState>();
        let previous = state.sessions.lock().unwrap().insert(spec.id, session.clone());
        previous
    };
    if let Some(old) = old {
        std::thread::spawn(move || old.kill());
    }
    let (app2, s2) = (app.clone(), session.clone());
    std::thread::spawn(move || reader_loop(app2, s2, stdout));
    if let Some(mut err) = stderr {
        // Канал надо вычитывать, иначе сервер встанет на заполненном буфере. Храним только хвост — для текста ошибки.
        let s3 = session.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = err.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if let Ok(mut tail) = s3.stderr_tail.lock() {
                    tail.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if tail.len() > 600 {
                        let cut = tail.len() - 600;
                        let cut = (cut..tail.len()).find(|i| tail.is_char_boundary(*i)).unwrap_or(tail.len());
                        tail.drain(..cut);
                    }
                }
            }
        });
    }

    let root_uri = uri_of_path(&root)?;
    let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let params = json!({
        "processId": std::process::id(),
        "clientInfo": { "name": "AIDE" },
        "rootUri": root_uri,
        "rootPath": root.to_string_lossy(),
        "workspaceFolders": [{ "uri": root_uri, "name": name }],
        "capabilities": client_capabilities(),
    });
    match session.request("initialize", params, INIT_TIMEOUT) {
        Ok(result) => {
            *session.init_result.lock().unwrap() = Some(result);
            session.notify("initialized", json!({}))?;
            emit_status(app, spec.id, "ready", "");
            Ok(session)
        }
        Err(e) => {
            // Частый случай: есть только заглушка программы (например, прокси rustup без компонента rust-analyzer).
            let e = format!("{e}. Проверьте установку: {}", spec.install);
            emit_status(app, spec.id, "error", e.clone());
            let state = app.state::<LspState>();
            state.sessions.lock().unwrap().remove(spec.id);
            session.kill();
            Err(e)
        }
    }
}

fn wait_ready(s: &Session) -> Result<(), String> {
    let start = Instant::now();
    while s.init_result.lock().unwrap().is_none() {
        if !s.alive.load(Ordering::Relaxed) || start.elapsed() > INIT_TIMEOUT {
            return Err(format!("LSP {}: сервер не запустился", s.server_id));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

/// Останавливает все серверы (смена проекта, выход из приложения).
pub fn stop_all(app: &AppHandle) {
    let sessions: Vec<Arc<Session>> = {
        let state = app.state::<LspState>();
        let mut map = state.sessions.lock().unwrap();
        map.drain().map(|(_, s)| s).collect()
    };
    for s in sessions {
        std::thread::spawn(move || s.kill());
    }
}

/* ───────────── Commands for the editor ───────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    id: &'static str,
    name: &'static str,
    command: Option<String>,
    install: &'static str,
    extensions: Vec<&'static str>,
    running: bool,
}

#[tauri::command]
pub fn lsp_servers(state: State<LspState>) -> Vec<ServerInfo> {
    let running: HashSet<&str> = state.sessions.lock().unwrap().keys().copied().collect();
    SERVERS
        .iter()
        .map(|s| ServerInfo {
            id: s.id,
            name: s.name,
            command: resolve(s).map(|(p, _)| p.to_string_lossy().to_string()),
            install: s.install,
            extensions: s.exts.iter().map(|(e, _)| *e).collect(),
            running: running.contains(s.id),
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileServer {
    server: &'static str,
    language_id: &'static str,
    uri: String,
    available: bool,
    install: &'static str,
}

/// Какой сервер обслуживает файл, его URI и установлен ли сервер.
#[tauri::command]
pub fn lsp_for_path(path: String) -> Option<FileServer> {
    let (spec, language_id) = spec_for_path(&path)?;
    let uri = uri_of_path(Path::new(&path)).ok()?;
    Some(FileServer { server: spec.id, language_id, uri, available: resolve(spec).is_some(), install: spec.install })
}

/// Путь файла по URI (для перехода к определению в другом файле).
#[tauri::command]
pub fn lsp_path_for_uri(uri: String) -> Option<String> {
    url::Url::parse(&uri).ok()?.to_file_path().ok().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn lsp_start(app: AppHandle, server: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ensure(&app, &server).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// Сообщение от редактора: только кладётся в очередь сервера, отправляет его поток очереди.
#[tauri::command]
pub fn lsp_send(app: AppHandle, state: State<LspState>, server: String, message: String) -> Result<(), String> {
    if message.len() > MAX_MESSAGE_BYTES {
        return Err("LSP: сообщение слишком большое".into());
    }
    let spec = spec(&server).ok_or("неизвестный языковой сервер")?;
    let mut outbox = state.outbox.lock().unwrap();
    let tx = outbox.entry(spec.id).or_insert_with(|| {
        let (tx, rx) = mpsc::channel::<String>();
        let app = app.clone();
        std::thread::spawn(move || {
            for message in rx {
                if let Err(e) = handle_client_message(&app, spec.id, &message) {
                    emit_status(&app, spec.id, "error", e);
                }
            }
        });
        tx
    });
    tx.send(message).map_err(|_| "LSP: очередь закрыта".to_string())
}

/// `initialize` отвечаем из кэша (сервер уже инициализирован), `initialized`/`shutdown`/`exit` не пересылаем
/// (сервер общий), открытия и закрытия документов отслеживаем.
fn handle_client_message(app: &AppHandle, server: &str, message: &str) -> Result<(), String> {
    let session = ensure(app, server)?;
    let msg: Value = serde_json::from_str(message).map_err(|e| format!("LSP: {e}"))?;
    let method = msg["method"].as_str().unwrap_or("");
    let reply = |result: Value| {
        let m = json!({ "jsonrpc": "2.0", "id": msg["id"].clone(), "result": result });
        let _ = app.emit("lsp-message", LspMessage { server: session.server_id, message: m.to_string() });
    };
    match method {
        "initialize" => {
            // Новый редактор подключился: документы прошлого подключения закрываем, чтобы не было двойного didOpen.
            let stale: Vec<String> = {
                let mut open = session.open.lock().unwrap();
                let keys: Vec<String> = open.iter().filter(|(_, (o, _))| *o == Owner::Client).map(|(k, _)| k.clone()).collect();
                keys.iter().filter_map(|k| open.remove(k).map(|(_, uri)| uri)).collect()
            };
            for uri in stale {
                let _ = session.notify("textDocument/didClose", json!({ "textDocument": { "uri": uri } }));
            }
            let result = session.init_result.lock().unwrap().clone().unwrap_or(Value::Null);
            reply(result);
            Ok(())
        }
        "initialized" | "exit" => Ok(()),
        "shutdown" => {
            reply(Value::Null);
            Ok(())
        }
        "textDocument/didOpen" => {
            let uri = msg["params"]["textDocument"]["uri"].as_str().unwrap_or("").to_string();
            let key = key_of_uri(&uri);
            let prev = session.open.lock().unwrap().insert(key, (Owner::Client, uri.clone()));
            if let Some((_, old_uri)) = prev {
                let _ = session.notify("textDocument/didClose", json!({ "textDocument": { "uri": old_uri } }));
            }
            session.write(&msg)
        }
        "textDocument/didClose" => {
            let uri = msg["params"]["textDocument"]["uri"].as_str().unwrap_or("");
            session.open.lock().unwrap().remove(&key_of_uri(uri));
            session.write(&msg)
        }
        _ => session.write(&msg),
    }
}

#[tauri::command]
pub fn lsp_stop(state: State<LspState>, server: String) {
    let s = state.sessions.lock().unwrap().remove(server.as_str());
    if let Some(s) = s {
        std::thread::spawn(move || s.kill());
    }
}

/* ───────────── Agent tool: get_diagnostics ───────────── */

fn severity(d: &Value) -> &'static str {
    match d["severity"].as_u64().unwrap_or(1) {
        1 => "error",
        2 => "warning",
        3 => "info",
        _ => "hint",
    }
}

fn format_diags(rel: &str, list: &[Value], out: &mut Vec<String>, only_problems: bool) {
    for d in list {
        let sev = severity(d);
        if only_problems && !matches!(sev, "error" | "warning") {
            continue;
        }
        let line = d["range"]["start"]["line"].as_u64().unwrap_or(0) + 1;
        let col = d["range"]["start"]["character"].as_u64().unwrap_or(0) + 1;
        let msg = d["message"].as_str().unwrap_or("").replace('\n', " ");
        let source = d["source"].as_str().unwrap_or("");
        let code = match &d["code"] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        let tag = match (source.is_empty(), code.is_empty()) {
            (true, true) => String::new(),
            (false, true) => format!(" [{source}]"),
            (true, false) => format!(" [{code}]"),
            (false, false) => format!(" [{source} {code}]"),
        };
        out.push(format!("{rel}:{line}:{col} {sev}: {msg}{tag}"));
    }
}

fn rel_path(root: &Path, key: &str) -> String {
    let root_key = {
        let s = root.to_string_lossy().replace('\\', "/");
        if cfg!(windows) { s.to_lowercase() } else { s }
    };
    key.strip_prefix(&root_key).map(|r| r.trim_start_matches('/').to_string()).unwrap_or_else(|| key.to_string())
}

/// Ошибки и предупреждения языкового сервера. С `path` — для одного файла (откроет его у сервера, если надо),
/// без него — всё, что сервер уже сообщил по проекту. Блокирующая: вызывать вне async-рантайма.
pub fn agent_diagnostics(app: &AppHandle, path: Option<&str>) -> Result<String, String> {
    let root = workspace_root(app)?;
    let Some(path) = path.filter(|p| !p.trim().is_empty()) else {
        let mut out = Vec::new();
        let sessions: Vec<Arc<Session>> = app.state::<LspState>().sessions.lock().unwrap().values().cloned().collect();
        for s in sessions {
            let diags = s.diagnostics.lock().unwrap().clone();
            let mut keys: Vec<_> = diags.keys().cloned().collect();
            keys.sort();
            for k in keys {
                format_diags(&rel_path(&root, &k), &diags[&k].1, &mut out, true);
            }
        }
        if out.is_empty() {
            return Ok("Языковые серверы не сообщают об ошибках в открытых файлах. Чтобы проверить конкретный файл, передай path.".into());
        }
        let total = out.len();
        out.truncate(MAX_DIAGNOSTICS_LISTED);
        if total > MAX_DIAGNOSTICS_LISTED {
            out.push(format!("…и ещё {}", total - MAX_DIAGNOSTICS_LISTED));
        }
        return Ok(out.join("\n"));
    };

    let file = crate::fs_commands::resolve_existing(&root, path)?;
    if !file.is_file() {
        return Err("Это не файл".into());
    }
    let (spec, language_id) = spec_for_path(&file.to_string_lossy())
        .ok_or("Для файлов этого типа языкового сервера нет.")?;
    let session = ensure(app, spec.id)?;
    let uri = uri_of_path(&file)?;
    let key = key_of_uri(&uri);
    let asked = Instant::now();
    let opened_by_client = session.open.lock().unwrap().get(&key).is_some_and(|(o, _)| *o == Owner::Client);

    // Ждём свежую диагностику: открыт в редакторе — недолго (правка уже ушла серверу), иначе открываем сами.
    let wait = if opened_by_client {
        Duration::from_secs(3)
    } else {
        let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
        if meta.len() > MAX_AGENT_FILE_BYTES {
            return Err("Файл слишком большой для проверки языковым сервером".into());
        }
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        session.open.lock().unwrap().insert(key.clone(), (Owner::Agent, uri.clone()));
        session.notify(
            "textDocument/didOpen",
            json!({ "textDocument": { "uri": uri, "languageId": language_id, "version": 1, "text": text } }),
        )?;
        // rust-analyzer запускает cargo check по сохранению.
        let _ = session.notify("textDocument/didSave", json!({ "textDocument": { "uri": uri } }));
        Duration::from_secs(20)
    };
    let mut fresh = false;
    let start = Instant::now();
    while start.elapsed() < wait {
        if session.diagnostics.lock().unwrap().get(&key).is_some_and(|(t, _)| *t >= asked) {
            fresh = true;
            // Серверы часто шлют несколько волн (быстрая и полная проверка) — даём ещё немного времени.
            std::thread::sleep(Duration::from_millis(800));
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !opened_by_client {
        let still_ours = session.open.lock().unwrap().get(&key).is_some_and(|(o, _)| *o == Owner::Agent);
        if still_ours {
            session.open.lock().unwrap().remove(&key);
            let _ = session.notify("textDocument/didClose", json!({ "textDocument": { "uri": uri } }));
        }
    }
    let list = session.diagnostics.lock().unwrap().get(&key).map(|(_, l)| l.clone()).unwrap_or_default();
    let rel = rel_path(&root, &key);
    let mut out = Vec::new();
    format_diags(&rel, &list, &mut out, false);
    if out.is_empty() {
        return Ok(if fresh || opened_by_client {
            format!("{rel}: ошибок нет ({})", spec.name)
        } else {
            format!("{rel}: сервер {} не прислал результатов за отведённое время — возможно, ещё индексирует проект", spec.name)
        });
    }
    out.truncate(MAX_DIAGNOSTICS_LISTED);
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_extensions_to_servers() {
        assert_eq!(spec_for_path("src/App.tsx").map(|(s, l)| (s.id, l)), Some(("typescript", "typescriptreact")));
        assert_eq!(spec_for_path("C:\\x\\main.RS").map(|(s, l)| (s.id, l)), Some(("rust", "rust")));
        assert!(spec_for_path("README.md").is_none());
        assert!(spec_for_path("Makefile").is_none());
    }

    #[test]
    fn uri_keys_match_across_encodings() {
        if cfg!(windows) {
            assert_eq!(key_of_uri("file:///D:/Projects/a.ts"), key_of_uri("file:///d%3A/Projects/a.ts"));
            assert_eq!(key_of_uri("file:///D:/Projects/a.ts"), "d:/projects/a.ts");
        } else {
            assert_eq!(key_of_uri("file:///tmp/a%20b.ts"), "/tmp/a b.ts");
        }
    }

    #[test]
    fn frames_round_trip() {
        let body = br#"{"jsonrpc":"2.0","method":"x","params":{"n":1}}"#;
        let mut data = format!("Content-Length: {}\r\nContent-Type: application/vscode-jsonrpc\r\n\r\n", body.len()).into_bytes();
        data.extend_from_slice(body);
        let mut r = std::io::Cursor::new(data);
        let v = read_message(&mut r).unwrap();
        assert_eq!(v["params"]["n"], 1);
        assert!(read_message(&mut r).is_none());
    }

    #[test]
    fn diagnostics_are_formatted() {
        let d = vec![json!({ "range": { "start": { "line": 2, "character": 4 } }, "severity": 1, "message": "Type 'string' is not assignable\nto 'number'", "source": "ts", "code": 2322 })];
        let mut out = Vec::new();
        format_diags("src/a.ts", &d, &mut out, true);
        assert_eq!(out, vec!["src/a.ts:3:5 error: Type 'string' is not assignable to 'number' [ts 2322]".to_string()]);
    }

    #[test]
    fn program_search_ignores_relative_path_entries() {
        assert!(search_dirs().iter().all(|d| d.is_absolute()));
    }
}
