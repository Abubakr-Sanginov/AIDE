//! Подписка Qoder в AIDE официальным путём: запускаем Qoder CLI самого пользователя в режиме ACP
//! (`qodercli --acp`, JSON-RPC по stdin/stdout) — так Qoder подключается к сторонним редакторам.
//!
//! AIDE не читает и не расшифровывает вход приложения Qoder и не обращается к его API напрямую: CLI пользуется
//! своим входом (`qodercli login`) или персональным токеном, который пользователь сам выпустил для таких
//! инструментов (переменная `QODER_PERSONAL_ACCESS_TOKEN`). Токен лежит в хранилище ключей и уходит только в
//! окружение запущенного CLI.

use std::collections::HashMap;
use std::ffi::OsString;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

use crate::agent_service::AgentRequest;
use crate::ai_service::{self, AiCancels, AiDone, AiError, Attachment, ChatMessage, ChatRequest};
use crate::terminal::PermissionRequests;

pub(crate) const KIND: &str = "qoder";
/// Имя записи в хранилище ключей. Точка не разрешена в id своих провайдеров, поэтому чужой ключ сюда не попадёт.
const TOKEN_ENTRY: &str = "qoder.pat";
const TOKEN_ENV: &str = "QODER_PERSONAL_ACCESS_TOKEN";
/// Уровни моделей из документации Qoder: на случай, если CLI не перечислит модели сам.
const DOC_MODELS: [&str; 4] = ["auto", "ultimate", "performance", "efficient"];

const MAX_LINE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PROMPT_HISTORY_CHARS: usize = 200_000;
const MAX_ATTACHMENTS: usize = 20;
const MAX_EVENT_CHARS: usize = 600;
const MAX_ASK_CHARS: usize = 4_000;
const MAX_STDERR_CHARS: usize = 1_500;
const START_TIMEOUT: Duration = Duration::from_secs(90);

/* ───────────── поиск Qoder CLI ───────────── */

/// Чем запускать CLI: программа и первые аргументы. Оболочка не участвует.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cli {
    pub program: PathBuf,
    pub prefix: Vec<OsString>,
    /// Что показать пользователю.
    pub found_at: PathBuf,
}

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

/// Ищет CLI в перечисленных папках. Относительные пути пропускаются: иначе «qodercli» из открытого проекта
/// мог бы запуститься вместо настоящего.
pub(crate) fn find_cli_in(path_dirs: &[PathBuf], home_dirs: &[PathBuf]) -> Option<Cli> {
    let direct = |p: PathBuf| p.is_file().then(|| Cli { program: p.clone(), prefix: Vec::new(), found_at: p });
    // `qoder` без «cli» может быть запускателем редактора Qoder, поэтому берётся только из папок самого CLI.
    let all = home_dirs.iter().map(|d| (d, true)).chain(path_dirs.iter().map(|d| (d, false)));
    for (dir, own) in all {
        if !dir.is_absolute() {
            continue;
        }
        if let Some(c) = direct(dir.join(format!("qodercli{EXE}"))) {
            return Some(c);
        }
        if own {
            if let Some(c) = direct(dir.join(format!("qoder{EXE}"))) {
                return Some(c);
            }
        }
        // npm на Windows кладёт .cmd-обёртку. Её запуск идёт через cmd.exe, поэтому вызываем node напрямую.
        if cfg!(windows) {
            let script = dir.join("node_modules").join("@qoder-ai").join("qodercli").join("bundle").join("qodercli.js");
            if script.is_file() {
                let node = std::iter::once(dir)
                    .chain(path_dirs.iter().filter(|d| d.is_absolute()))
                    .map(|d| d.join("node.exe"))
                    .find(|p| p.is_file())?;
                return Some(Cli { program: node, prefix: vec![script.clone().into_os_string()], found_at: script });
            }
        }
    }
    None
}

fn find_cli(home: &Path) -> Option<Cli> {
    let path_dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let mut own = vec![
        home.join(".local/bin"),
        home.join(".qoder/bin/qodercli"),
        home.join(".qoder/local"),
    ];
    let mut extra = path_dirs;
    if cfg!(windows) {
        // Установили через npm, пока AIDE был открыт: PATH процесса ещё старый.
        extra.push(home.join("AppData/Roaming/npm"));
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            extra.push(PathBuf::from(pf).join("nodejs"));
        }
    } else {
        own.push(PathBuf::from("/usr/local/bin"));
    }
    find_cli_in(&extra, &own)
}

fn saved_token() -> Option<String> {
    let entry = keyring::Entry::new("aide", TOKEN_ENTRY).ok()?;
    entry.get_password().ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

#[derive(Serialize)]
pub struct QoderStatus {
    /// Путь к найденному Qoder CLI.
    pub cli: Option<String>,
    /// Найдено настольное приложение Qoder (по папке данных; содержимое не читается).
    pub desktop: bool,
    /// Персональный токен сохранён в AIDE.
    pub token_saved: bool,
    /// Персональный токен задан переменной окружения.
    pub token_env: bool,
}

#[tauri::command]
pub async fn qoder_status() -> Result<QoderStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = dirs_next::home_dir().ok_or("Не удалось определить домашнюю папку")?;
        Ok(QoderStatus {
            cli: find_cli(&home).map(|c| c.found_at.to_string_lossy().into_owned()),
            desktop: ["AppData/Roaming/com.qoder.app.stable", "AppData/Roaming/Qoder", "Library/Application Support/com.qoder.app.stable"]
                .iter()
                .any(|d| home.join(d).is_dir()),
            token_saved: saved_token().is_some(),
            token_env: crate::agent_accounts::lookup_env(TOKEN_ENV).is_some(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn qoder_set_token(token: String) -> Result<(), String> {
    let token = token.trim().to_string();
    if token.len() < 8 || token.len() > 2000 || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Это не похоже на персональный токен Qoder: вставьте его целиком, без пробелов".into());
    }
    ai_service::set_api_key(TOKEN_ENTRY.into(), token)
}

#[tauri::command]
pub fn qoder_clear_token() -> Result<(), String> {
    ai_service::delete_api_key(TOKEN_ENTRY.into())
}

/* ───────────── запуск ───────────── */

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Mode {
    Chat,
    Plan,
    Agent,
}

/// Имя модели уходит аргументом командной строки: только буквы, цифры и обычные разделители, без ведущего «-».
pub(crate) fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 128
        && !model.starts_with('-')
        && model.chars().all(|c| c.is_ascii_alphanumeric() || "._-:/ ()".contains(c))
}

pub(crate) fn cli_args(mode: Mode, model: Option<&str>) -> Result<Vec<String>, String> {
    // Режим разрешений задаём явно: в настройках пользователя может стоять «без вопросов», а решать должен AIDE.
    let mut args: Vec<String> = ["--acp", "--permission-mode", "default"].map(String::from).to_vec();
    if let Some(m) = model {
        if !valid_model(m) {
            return Err("Недопустимое имя модели Qoder".into());
        }
        args.push("--model".into());
        args.push(m.into());
    }
    match mode {
        Mode::Chat => args.extend(["--tools".into(), String::new()]),
        Mode::Plan => args.extend(["--disallowed-tools".into(), "Bash,Write,Edit".into()]),
        Mode::Agent => {}
    }
    Ok(args)
}

/// Убирает токен из текста, который увидит пользователь (например, из stderr CLI).
pub(crate) fn redact(text: &str, token: Option<&str>) -> String {
    let mut out = match token {
        Some(t) if !t.is_empty() => text.replace(t, "***"),
        _ => text.to_string(),
    };
    if let Ok(re) = regex::Regex::new(r"\b(pt|jt)-[A-Za-z0-9_\-]{8,}") {
        out = re.replace_all(&out, "***").into_owned();
    }
    out
}

struct Process {
    child: tokio::process::Child,
    stderr: Arc<Mutex<String>>,
    token: Option<String>,
}

impl Process {
    /// Хвост stderr без токенов: объясняет, почему CLI не запустился.
    async fn error_tail(&mut self) -> String {
        // Даём завершившемуся процессу дописать причину.
        let _ = tokio::time::timeout(Duration::from_millis(500), self.child.wait()).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let tail = self.stderr.lock().unwrap().trim().to_string();
        redact(&tail, self.token.as_deref())
    }

    /// Завершает CLI вместе с запущенными им командами.
    async fn stop(mut self) {
        #[cfg(windows)]
        if let Some(pid) = self.child.id() {
            let mut kill = tokio::process::Command::new("taskkill");
            kill.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
            kill.creation_flags(0x0800_0000);
            let _ = kill.status().await;
        }
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), self.child.wait()).await;
    }
}

type Pipes = (BufReader<tokio::process::ChildStdout>, tokio::process::ChildStdin);

fn spawn(cli: &Cli, args: &[String], cwd: &Path) -> Result<(Process, Pipes), String> {
    let mut cmd = tokio::process::Command::new(&cli.program);
    cmd.args(&cli.prefix)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Свой токен AIDE важнее; иначе — переменная окружения (в том числе заданная в Windows уже после запуска AIDE).
    let token = saved_token().or_else(|| crate::agent_accounts::lookup_env(TOKEN_ENV));
    if let Some(t) = &token {
        cmd.env(TOKEN_ENV, t);
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить Qoder CLI: {e}"))?;
    let (Some(stdin), Some(stdout), Some(mut err)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
        return Err("Нет потоков процесса Qoder CLI".into());
    };
    let stderr = Arc::new(Mutex::new(String::new()));
    let sink = stderr.clone();
    tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 2048];
        while let Ok(n) = err.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let mut s = sink.lock().unwrap();
            s.push_str(&String::from_utf8_lossy(&buf[..n]));
            let extra = s.chars().count().saturating_sub(MAX_STDERR_CHARS);
            if extra > 0 {
                *s = s.chars().skip(extra).collect();
            }
        }
    });
    Ok((Process { child, stderr, token }, (BufReader::new(stdout), stdin)))
}

/* ───────────── ACP ───────────── */

/// Что интерфейс делает с сообщениями агента.
pub(crate) trait Host: Send {
    fn update(&mut self, update: &Value);
    /// Разрешить ли действие, о котором спрашивает агент.
    fn permit(&mut self, tool_call: &Value) -> impl Future<Output = Result<bool, String>> + Send;
}

pub(crate) struct Acp<R, W> {
    reader: R,
    writer: W,
    next_id: u64,
    cancel: Arc<AtomicBool>,
    pub session: Option<String>,
}

#[derive(Debug)]
pub(crate) struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    fn local(message: impl Into<String>) -> Self {
        RpcError { code: 0, message: message.into() }
    }
}

/// Понятный текст ошибки; про вход — с подсказкой, что сделать.
pub(crate) fn explain(error: &RpcError) -> String {
    if error.message == "canceled" {
        return "canceled".into();
    }
    let text = ai_service::truncate(&error.message, 600);
    let low = error.message.to_lowercase();
    let auth = error.code == -32000 && low.contains("auth")
        || ["not logged in", "not signed in", "unauthorized", "authentication required", "auth_required", "please log in", "please login", "401"]
            .iter()
            .any(|m| low.contains(m));
    if auth {
        format!("Qoder CLI не вошёл в аккаунт. Выполните в терминале «qodercli login» или сохраните персональный токен в настройках провайдера Qoder (qoder.com/account/integrations). Ответ CLI: {text}")
    } else if error.code == 0 {
        text
    } else {
        format!("Qoder: {text}")
    }
}

/// Выбирает вариант ответа на запрос разрешения. Только «один раз»: правило «всегда» AIDE за пользователя не ставит.
pub(crate) fn permission_outcome(params: &Value, allow: bool) -> Value {
    let wanted = if allow { "allow_once" } else { "reject_once" };
    let option = params["options"]
        .as_array()
        .and_then(|list| list.iter().find(|o| o["kind"] == wanted))
        .and_then(|o| o["optionId"].as_str());
    match option {
        Some(id) => json!({ "outcome": { "outcome": "selected", "optionId": id } }),
        None => json!({ "outcome": { "outcome": "cancelled" } }),
    }
}

impl<R: AsyncBufRead + Unpin + Send, W: AsyncWrite + Unpin + Send> Acp<R, W> {
    pub fn new(reader: R, writer: W, cancel: Arc<AtomicBool>) -> Self {
        Acp { reader, writer, next_id: 1, cancel, session: None }
    }

    async fn send(&mut self, message: &Value) -> Result<(), RpcError> {
        let mut line = message.to_string();
        line.push('\n');
        let io = async {
            self.writer.write_all(line.as_bytes()).await?;
            self.writer.flush().await
        };
        io.await.map_err(|e| RpcError::local(format!("Qoder CLI закрыл соединение: {e}")))
    }

    /// Следующая строка; ошибка при «Стоп», долгом молчании или конце потока.
    async fn line(&mut self, idle: Duration) -> Result<String, RpcError> {
        let mut buf = Vec::new();
        let read = (&mut self.reader).take(MAX_LINE_BYTES);
        let mut read = read;
        let n = tokio::select! {
            _ = ai_service::wait_cancel(&self.cancel) => return Err(RpcError::local("canceled")),
            r = tokio::time::timeout(idle, read.read_until(b'\n', &mut buf)) => match r {
                Err(_) => return Err(RpcError::local("Qoder CLI слишком долго не отвечает")),
                Ok(r) => r.map_err(|e| RpcError::local(format!("Ошибка чтения от Qoder CLI: {e}")))?,
            },
        };
        if n == 0 {
            return Err(RpcError::local("Qoder CLI завершился, не ответив"));
        }
        if n as u64 >= MAX_LINE_BYTES && !buf.ends_with(b"\n") {
            return Err(RpcError::local("Qoder CLI прислал слишком длинное сообщение"));
        }
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    /// Запрос и ожидание ответа; по пути обрабатываются уведомления и вопросы агента.
    pub async fn call<H: Host>(&mut self, method: &str, params: Value, idle: Duration, host: &mut H) -> Result<Value, RpcError> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await?;
        loop {
            let line = self.line(idle).await?;
            // Всё, что не JSON (случайный вывод в stdout), пропускаем.
            let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { continue };
            match (msg.get("method").and_then(Value::as_str), msg.get("id")) {
                (Some("session/update"), None) => host.update(&msg["params"]["update"]),
                (Some("session/request_permission"), Some(rid)) => {
                    let allow = host.permit(&msg["params"]["toolCall"]).await;
                    let outcome = match &allow {
                        Ok(a) => permission_outcome(&msg["params"], *a),
                        Err(_) => json!({ "outcome": { "outcome": "cancelled" } }),
                    };
                    self.send(&json!({ "jsonrpc": "2.0", "id": rid, "result": outcome })).await?;
                    allow.map_err(RpcError::local)?;
                }
                // Файлы и терминал клиента мы не объявляли: на такие запросы отвечаем отказом.
                (Some(_), Some(rid)) => {
                    let reply = json!({ "jsonrpc": "2.0", "id": rid, "error": { "code": -32601, "message": "Not supported by this client" } });
                    self.send(&reply).await?;
                }
                (None, Some(rid)) if rid.as_u64() == Some(id) => {
                    if let Some(e) = msg.get("error") {
                        let mut message = e["message"].as_str().unwrap_or("неизвестная ошибка").to_string();
                        if let Some(d) = e.get("data").filter(|d| !d.is_null()) {
                            message = format!("{message}: {}", ai_service::truncate(&d.to_string(), 300));
                        }
                        return Err(RpcError { code: e["code"].as_i64().unwrap_or(-1), message });
                    }
                    return Ok(msg["result"].clone());
                }
                _ => {}
            }
        }
    }

    /// initialize + session/new. Возвращает (возможности агента, ответ о новой сессии).
    pub async fn open<H: Host>(&mut self, cwd: &Path, host: &mut H) -> Result<(Value, Value), RpcError> {
        let init = self
            .call(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false },
                    "clientInfo": { "name": "aide", "title": "AIDE", "version": env!("CARGO_PKG_VERSION") },
                }),
                START_TIMEOUT,
                host,
            )
            .await?;
        if init["protocolVersion"].as_u64() != Some(1) {
            return Err(RpcError::local("Эта версия Qoder CLI говорит на другой версии протокола ACP: обновите CLI и AIDE"));
        }
        let session = self.call("session/new", json!({ "cwd": cwd.to_string_lossy(), "mcpServers": [] }), START_TIMEOUT, host).await?;
        let id = session["sessionId"].as_str().ok_or_else(|| RpcError::local("Qoder CLI не вернул номер сессии"))?;
        self.session = Some(id.to_string());
        Ok((init, session))
    }

    pub async fn prompt<H: Host>(&mut self, blocks: Vec<Value>, host: &mut H) -> Result<String, RpcError> {
        let session = self.session.clone().ok_or_else(|| RpcError::local("нет сессии Qoder"))?;
        let idle = Duration::from_secs(ai_service::STREAM_IDLE_SECS);
        let result = self.call("session/prompt", json!({ "sessionId": session, "prompt": blocks }), idle, host).await;
        if matches!(&result, Err(e) if e.message == "canceled") {
            let note = json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": session } });
            let _ = tokio::time::timeout(Duration::from_secs(1), self.send(&note)).await;
        }
        Ok(result?["stopReason"].as_str().unwrap_or("end_turn").to_string())
    }
}

/// Модели из ответа session/new, если CLI их перечисляет.
pub(crate) fn models_from_session(session: &Value) -> Vec<String> {
    let ids = |list: &Value, key: &str| -> Vec<String> {
        list.as_array()
            .map(|a| a.iter().filter_map(|m| m[key].as_str()).filter(|m| valid_model(m)).map(String::from).collect())
            .unwrap_or_default()
    };
    let listed = ids(&session["models"]["availableModels"], "modelId");
    if !listed.is_empty() {
        return listed;
    }
    session["configOptions"]
        .as_array()
        .and_then(|o| o.iter().find(|o| o["category"] == "model" || o["id"] == "model"))
        .map(|o| ids(&o["options"], "value"))
        .unwrap_or_default()
}

/* ───────────── запрос ───────────── */

/// Один текст для новой сессии: у других провайдеров история тоже передаётся целиком с каждым запросом.
pub(crate) fn prompt_text(system: &str, context: Option<&str>, history: &[ChatMessage], request: &str) -> String {
    let mut out = String::new();
    if !system.trim().is_empty() {
        out.push_str(system.trim());
        out.push_str("\n\n");
    }
    if let Some(c) = context.filter(|c| !c.trim().is_empty()) {
        out.push_str("Контекст — активный файл пользователя:\n");
        out.push_str(c);
        out.push_str("\n\n");
    }
    // Берём последние сообщения, пока помещаются.
    let mut past: Vec<String> = Vec::new();
    let mut size = 0;
    for m in history.iter().rev() {
        let who = if m.role == "assistant" { "Ассистент" } else { "Пользователь" };
        let files: Vec<&str> = m.attachments.iter().map(|a| a.name.as_str()).collect();
        let note = if files.is_empty() { String::new() } else { format!(" [вложения: {}]", files.join(", ")) };
        let part = format!("{who}{note}: {}", m.content);
        size += part.chars().count();
        if size > MAX_PROMPT_HISTORY_CHARS {
            break;
        }
        past.push(part);
    }
    if !past.is_empty() {
        past.reverse();
        out.push_str("Предыдущая переписка:\n");
        out.push_str(&past.join("\n\n"));
        out.push_str("\n\nНовый запрос пользователя:\n");
    }
    out.push_str(request);
    out
}

pub(crate) fn prompt_blocks(text: String, attachments: &[&Attachment], images: bool) -> Vec<Value> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for a in attachments {
        if !ai_service::is_image_mime(&a.mime) {
            blocks.push(ai_service::attachment_openai_block(a));
        } else if images {
            let mime = if a.mime.is_empty() { "image/png" } else { &a.mime };
            blocks.push(json!({ "type": "image", "mimeType": mime, "data": a.data }));
        } else {
            blocks.push(json!({ "type": "text", "text": format!("[Картинка «{}» не передана: эта версия Qoder CLI не принимает изображения]", a.name) }));
        }
    }
    blocks
}

#[derive(PartialEq, Debug)]
pub(crate) enum Decision {
    Allow,
    Deny,
    Ask,
}

/// Те же правила, что у агента AIDE: «Спрашивать» — всё, «Авто» — всё, что меняет или запускает, «Свобода» — ничего.
pub(crate) fn decide(mode: Mode, permission: &str, kind: &str) -> Decision {
    let reads = matches!(kind, "read" | "search" | "think");
    match mode {
        Mode::Chat => Decision::Deny,
        Mode::Plan if !reads => Decision::Deny,
        _ => match permission {
            "full" => Decision::Allow,
            "ask" => Decision::Ask,
            _ if reads => Decision::Allow,
            _ => Decision::Ask,
        },
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct ToolRow {
    pub tool: String,
    pub args: String,
    pub status: String,
    pub result: String,
    pub iteration: u32,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Out {
    Text(String),
    Thought(String),
    Tool(ToolRow),
}

/// Переводит session/update в события чата AIDE.
#[derive(Default)]
pub(crate) struct Translator {
    tools: HashMap<String, ToolRow>,
    denied: Vec<String>,
    count: u32,
    wrote_text: bool,
    gap: bool,
}

fn content_text(content: &Value) -> String {
    let parts: Vec<String> = content
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| match c["type"].as_str() {
                    Some("content") => c["content"]["text"].as_str().map(String::from),
                    Some("diff") => c["path"].as_str().map(|p| format!("изменён {p}")),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    parts.join("\n")
}

fn tool_args(call: &Value, limit: usize) -> String {
    let input = &call["rawInput"];
    if !input.is_null() {
        return ai_service::truncate(&input.to_string(), limit);
    }
    let paths: Vec<&str> = call["locations"].as_array().map(|a| a.iter().filter_map(|l| l["path"].as_str()).collect()).unwrap_or_default();
    ai_service::truncate(&paths.join(", "), limit)
}

impl Translator {
    pub fn push(&mut self, update: &Value) -> Option<Out> {
        match update["sessionUpdate"].as_str()? {
            "agent_message_chunk" => {
                let text = update["content"]["text"].as_str().filter(|t| !t.is_empty())?;
                let gap = std::mem::take(&mut self.gap) && self.wrote_text;
                self.wrote_text = true;
                Some(Out::Text(if gap { format!("\n\n{text}") } else { text.to_string() }))
            }
            "agent_thought_chunk" => update["content"]["text"].as_str().filter(|t| !t.is_empty()).map(|t| Out::Thought(t.into())),
            "tool_call" | "tool_call_update" => {
                self.gap = true;
                let id = update["toolCallId"].as_str()?.to_string();
                let known = self.tools.contains_key(&id);
                let count = &mut self.count;
                let row = self.tools.entry(id.clone()).or_insert_with(|| {
                    *count += 1;
                    let name = update["title"].as_str().or_else(|| update["kind"].as_str()).unwrap_or("tool");
                    ToolRow {
                        // Название и аргументы не меняются: по ним интерфейс находит строку этого вызова.
                        tool: format!("Qoder: {}", ai_service::truncate(name, 120)),
                        args: tool_args(update, MAX_EVENT_CHARS),
                        status: "running".into(),
                        result: String::new(),
                        iteration: *count,
                    }
                });
                let before = (row.status.clone(), row.result.clone());
                match update["status"].as_str() {
                    Some("completed") => row.status = "ok".into(),
                    Some("failed") => row.status = if self.denied.contains(&id) { "denied" } else { "error" }.into(),
                    _ => {}
                }
                let text = content_text(&update["content"]);
                if !text.is_empty() {
                    row.result = ai_service::truncate(&text, MAX_EVENT_CHARS);
                }
                (!known || before != (row.status.clone(), row.result.clone())).then(|| Out::Tool(row.clone()))
            }
            _ => None,
        }
    }

    pub fn deny(&mut self, tool_call_id: &str) {
        self.denied.push(tool_call_id.to_string());
    }

    pub fn calls(&self) -> u32 {
        self.count
    }
}

/// Молчаливый хозяин: для проверки входа и списка моделей.
struct Quiet;

impl Host for Quiet {
    fn update(&mut self, _: &Value) {}
    async fn permit(&mut self, _: &Value) -> Result<bool, String> {
        Ok(false)
    }
}

struct AppHost {
    app: AppHandle,
    request_id: String,
    mode: Mode,
    permission: String,
    cancel: Arc<AtomicBool>,
    translator: Translator,
}

impl AppHost {
    fn emit_tool(&self, row: &ToolRow) {
        let _ = self.app.emit(
            "ai-tool",
            json!({ "request_id": self.request_id, "tool": row.tool, "args": row.args, "status": row.status, "result": row.result, "iteration": row.iteration }),
        );
    }

    async fn ask_user(&self, tool: String, args: String) -> Result<bool, String> {
        let (tx, mut rx) = tokio::sync::oneshot::channel::<bool>();
        self.app.state::<PermissionRequests>().0.lock().unwrap().insert(self.request_id.clone(), tx);
        let _ = self.app.emit("ai-permission", json!({ "request_id": self.request_id, "tool": tool, "args": args }));
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                self.app.state::<PermissionRequests>().0.lock().unwrap().remove(&self.request_id);
                return Err("canceled".into());
            }
            match tokio::time::timeout(Duration::from_millis(200), &mut rx).await {
                Ok(Ok(allow)) => return Ok(allow),
                Ok(Err(_)) => return Err("нет ответа на запрос разрешения".into()),
                Err(_) => continue,
            }
        }
    }
}

impl Host for AppHost {
    fn update(&mut self, update: &Value) {
        match self.translator.push(update) {
            Some(Out::Text(t)) => ai_service::emit_chunk(&self.app, &self.request_id, &t),
            Some(Out::Thought(text)) => {
                let _ = self.app.emit("ai-thinking", ai_service::AiThinking { request_id: self.request_id.clone(), text });
            }
            Some(Out::Tool(row)) => self.emit_tool(&row),
            None => {}
        }
    }

    async fn permit(&mut self, call: &Value) -> Result<bool, String> {
        let kind = call["kind"].as_str().unwrap_or("other").to_string();
        let allow = match decide(self.mode, &self.permission, &kind) {
            Decision::Allow => true,
            Decision::Deny => false,
            Decision::Ask => {
                let title = call["title"].as_str().unwrap_or(&kind);
                let name = format!("Qoder: {}", ai_service::truncate(title, 200));
                self.ask_user(name, tool_args(call, MAX_ASK_CHARS)).await?
            }
        };
        if !allow {
            if let Some(id) = call["toolCallId"].as_str() {
                self.translator.deny(id);
            }
        }
        Ok(allow)
    }
}

/// Пустая папка для чата и проверки входа: проект там не виден, и его настройки Qoder не действуют.
fn empty_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("qoder-chat");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn locate() -> Result<Cli, String> {
    let home = dirs_next::home_dir().ok_or("Не удалось определить домашнюю папку")?;
    find_cli(&home).ok_or_else(|| {
        "Qoder CLI не найден. Приложения Qoder для этого недостаточно: установите официальный CLI (в PowerShell: irm https://qoder.com/install.ps1 | iex), выполните «qodercli login» и перезапустите AIDE.".into()
    })
}

/// Список моделей. Заодно проверяет, что CLI запускается и вход действует (запрос к модели не отправляется).
pub(crate) async fn list_models(app: &AppHandle) -> Result<Vec<String>, String> {
    let cli = locate()?;
    let cwd = empty_dir(app)?;
    let (mut process, (reader, writer)) = spawn(&cli, &cli_args(Mode::Chat, None)?, &cwd)?;
    let mut acp = Acp::new(reader, writer, Arc::new(AtomicBool::new(false)));
    let opened = acp.open(&cwd, &mut Quiet).await;
    let result = match opened {
        Ok((_, session)) => {
            let listed = models_from_session(&session);
            Ok(if listed.is_empty() { DOC_MODELS.map(String::from).to_vec() } else { listed })
        }
        Err(e) => Err(with_tail(explain(&e), &mut process).await),
    };
    process.stop().await;
    result
}

async fn with_tail(message: String, process: &mut Process) -> String {
    if message == "canceled" {
        return message;
    }
    let tail = process.error_tail().await;
    let message = redact(&message, process.token.as_deref());
    if tail.is_empty() {
        message
    } else {
        format!("{message}\n{tail}")
    }
}

struct Job {
    request_id: String,
    model: String,
    mode: Mode,
    permission: String,
    cwd: PathBuf,
    system: String,
    context: Option<String>,
    history: Vec<ChatMessage>,
    instruction: String,
    attachments: Vec<Attachment>,
}

async fn run(app: &AppHandle, job: Job, cancel: Arc<AtomicBool>) -> Result<u32, String> {
    let cli = locate()?;
    let model = Some(job.model.as_str()).filter(|m| !m.is_empty());
    let (mut process, (reader, writer)) = spawn(&cli, &cli_args(job.mode, model)?, &job.cwd)?;
    let mut host = AppHost {
        app: app.clone(),
        request_id: job.request_id.clone(),
        mode: job.mode,
        permission: job.permission.clone(),
        cancel: cancel.clone(),
        translator: Translator::default(),
    };
    let mut acp = Acp::new(reader, writer, cancel);
    let result = async {
        let (init, _) = acp.open(&job.cwd, &mut host).await?;
        let images = init["agentCapabilities"]["promptCapabilities"]["image"].as_bool().unwrap_or(false);
        let text = prompt_text(&job.system, job.context.as_deref(), &job.history, &job.instruction);
        let mut attachments: Vec<&Attachment> = job.attachments.iter().collect();
        attachments.extend(job.history.iter().rev().flat_map(|m| m.attachments.iter()));
        attachments.truncate(MAX_ATTACHMENTS);
        acp.prompt(prompt_blocks(text, &attachments, images), &mut host).await
    }
    .await;
    let result = match result {
        Ok(stop) => {
            let note = match stop.as_str() {
                "max_tokens" => Some("Ответ оборван: достигнут лимит длины."),
                "max_turn_requests" => Some("Qoder остановился: достигнут лимит шагов."),
                "refusal" => Some("Qoder отказался выполнять этот запрос."),
                _ => None,
            };
            if let Some(n) = note {
                ai_service::emit_chunk(app, &job.request_id, &format!("\n\n_{n}_"));
            }
            Ok(host.translator.calls())
        }
        Err(e) => Err(with_tail(explain(&e), &mut process).await),
    };
    process.stop().await;
    result
}

fn start(app: AppHandle, cancels: &AiCancels, job: Job, agent: bool) {
    let cancel = Arc::new(AtomicBool::new(false));
    cancels.0.lock().unwrap().insert(job.request_id.clone(), cancel.clone());
    let map = cancels.0.clone();
    tauri::async_runtime::spawn(async move {
        let id = job.request_id.clone();
        let result = run(&app, job, cancel).await;
        map.lock().unwrap().remove(&id);
        match result {
            Ok(calls) => {
                let _ = app.emit("ai-done", AiDone { request_id: id, iterations: agent.then_some(calls), usage: None });
            }
            Err(message) => {
                let _ = app.emit("ai-error", AiError { request_id: id, message });
            }
        }
    });
}

const CHAT_SYSTEM: &str = "Ты отвечаешь в чате IDE AIDE. Отвечай на языке пользователя, по существу. Файлы не меняй и команды не запускай. Код оформляй в блоках с указанием языка.";
const AGENT_SYSTEM: &str = "Ты работаешь как агент внутри IDE AIDE в открытом проекте пользователя. Отвечай на языке пользователя; в конце коротко скажи, что сделано.";
const PLAN_SYSTEM: &str = "Режим планирования в IDE AIDE: изучи проект и предложи пошаговый план. Файлы не меняй и команды не запускай. Отвечай на языке пользователя.";

pub(crate) fn chat(app: AppHandle, cancels: &AiCancels, request: ChatRequest) -> Result<(), String> {
    let mut history = request.messages;
    let last = history.iter().rposition(|m| m.role == "user").ok_or("Нет сообщения пользователя")?;
    // Всё после последнего вопроса (например, оборванный ответ) в новую сессию не передаём.
    history.truncate(last + 1);
    let question = history.pop().ok_or("Нет сообщения пользователя")?;
    let cwd = empty_dir(&app)?;
    let job = Job {
        request_id: request.request_id,
        model: request.model,
        mode: Mode::Chat,
        permission: "ask".into(),
        cwd,
        system: request.system.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| CHAT_SYSTEM.into()),
        context: request.context,
        history,
        instruction: question.content,
        attachments: question.attachments,
    };
    start(app, cancels, job, false);
    Ok(())
}

pub(crate) fn agent_chat(app: AppHandle, cancels: &AiCancels, request: AgentRequest) -> Result<(), String> {
    let mode = match request.mode.as_str() {
        "plan" => Mode::Plan,
        "agent" => Mode::Agent,
        _ => return Err("С подпиской Qoder работают режимы «Чат», «План» и «Агент». Для «Компьютера» и «Студии 3D» выберите другого провайдера.".into()),
    };
    let cwd = crate::fs_commands::workspace_root(&app.state::<crate::WorkspaceRoot>()).map_err(|_| "Откройте папку проекта: агенту Qoder нужна рабочая папка".to_string())?;
    let base = if mode == Mode::Plan { PLAN_SYSTEM } else { AGENT_SYSTEM };
    let job = Job {
        request_id: request.request_id,
        model: request.model,
        mode,
        permission: request.permission_mode.unwrap_or_else(|| "auto".into()),
        cwd,
        system: request.system.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| base.into()),
        context: request.context,
        history: request.history,
        instruction: request.instruction,
        attachments: request.attachments,
    };
    start(app, cancels, job, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("aide-qoder-cli-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn touch(path: PathBuf) -> PathBuf {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn finds_the_native_cli_and_ignores_relative_folders() {
        let root = temp("native");
        let exe = touch(root.join("bin").join(format!("qodercli{EXE}")));
        let found = find_cli_in(&[PathBuf::from("."), root.join("bin")], &[]).expect("cli");
        assert_eq!(found.program, exe);
        assert!(found.prefix.is_empty());
        assert_eq!(find_cli_in(&[PathBuf::from("relative/bin")], &[]), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bare_qoder_counts_only_in_the_cli_own_folders() {
        let root = temp("bare");
        touch(root.join("bin").join(format!("qoder{EXE}")));
        assert_eq!(find_cli_in(&[root.join("bin")], &[]), None, "may be the editor launcher");
        assert!(find_cli_in(&[], &[root.join("bin")]).is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn npm_install_runs_through_node_without_cmd_exe() {
        let root = temp("npm");
        let script = touch(root.join("npm").join("node_modules").join("@qoder-ai").join("qodercli").join("bundle").join("qodercli.js"));
        touch(root.join("npm/qodercli.cmd"));
        assert_eq!(find_cli_in(&[root.join("npm")], &[]), None, "no node, nothing to run");
        let node = touch(root.join("node/node.exe"));
        let found = find_cli_in(&[root.join("npm"), root.join("node")], &[]).expect("cli");
        assert_eq!(found.program, node);
        assert_eq!(found.prefix, vec![script.into_os_string()]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn arguments_fix_the_permission_mode_and_reject_flag_like_models() {
        let chat = cli_args(Mode::Chat, Some("auto")).unwrap();
        assert_eq!(chat, ["--acp", "--permission-mode", "default", "--model", "auto", "--tools", ""]);
        assert!(cli_args(Mode::Plan, None).unwrap().contains(&"--disallowed-tools".to_string()));
        assert_eq!(cli_args(Mode::Agent, None).unwrap(), ["--acp", "--permission-mode", "default"]);
        for bad in ["--yolo", "-m", "a\nb", "a;b", "x&calc", ""] {
            assert!(cli_args(Mode::Agent, Some(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn permissions_follow_the_aide_modes() {
        assert_eq!(decide(Mode::Chat, "full", "read"), Decision::Deny);
        assert_eq!(decide(Mode::Plan, "full", "execute"), Decision::Deny);
        assert_eq!(decide(Mode::Plan, "auto", "read"), Decision::Allow);
        assert_eq!(decide(Mode::Agent, "ask", "read"), Decision::Ask);
        assert_eq!(decide(Mode::Agent, "auto", "search"), Decision::Allow);
        for risky in ["edit", "delete", "move", "execute", "fetch", "other", "switch_mode"] {
            assert_eq!(decide(Mode::Agent, "auto", risky), Decision::Ask, "{risky}");
        }
        assert_eq!(decide(Mode::Agent, "full", "execute"), Decision::Allow);
    }

    #[test]
    fn permission_answers_never_choose_always() {
        let params = json!({ "options": [
            { "optionId": "aa", "kind": "allow_always" }, { "optionId": "a1", "kind": "allow_once" }, { "optionId": "r1", "kind": "reject_once" },
        ]});
        assert_eq!(permission_outcome(&params, true)["outcome"]["optionId"], "a1");
        assert_eq!(permission_outcome(&params, false)["outcome"]["optionId"], "r1");
        let only_always = json!({ "options": [{ "optionId": "aa", "kind": "allow_always" }] });
        assert_eq!(permission_outcome(&only_always, true)["outcome"]["outcome"], "cancelled");
    }

    #[test]
    fn tokens_are_removed_from_error_text() {
        let out = redact("bad token secret-value-123 and pt-abcdefgh12345", Some("secret-value-123"));
        assert_eq!(out, "bad token *** and ***");
    }

    #[test]
    fn sign_in_errors_say_what_to_do() {
        let e = RpcError { code: -32000, message: "Authentication required".into() };
        assert!(explain(&e).contains("qodercli login"));
        let other = RpcError { code: -32603, message: "Internal error".into() };
        assert_eq!(explain(&other), "Qoder: Internal error");
    }

    #[test]
    fn models_come_from_the_session_when_listed() {
        let a = json!({ "models": { "availableModels": [{ "modelId": "auto" }, { "modelId": "--bad" }] } });
        assert_eq!(models_from_session(&a), ["auto"]);
        let b = json!({ "configOptions": [{ "id": "model", "options": [{ "value": "efficient" }] }] });
        assert_eq!(models_from_session(&b), ["efficient"]);
        assert!(models_from_session(&json!({ "sessionId": "s" })).is_empty());
    }

    #[test]
    fn prompt_keeps_system_context_history_and_request() {
        let history = vec![ChatMessage { role: "assistant".into(), content: "старый ответ".into(), reasoning_content: None, attachments: vec![] }];
        let t = prompt_text("правила", Some("file.rs"), &history, "вопрос");
        for part in ["правила", "file.rs", "Ассистент: старый ответ", "вопрос"] {
            assert!(t.contains(part), "{part}");
        }
        assert_eq!(prompt_text("", None, &[], "вопрос"), "вопрос");
    }

    #[test]
    fn images_go_only_to_agents_that_accept_them() {
        let image = Attachment { name: "a.png".into(), mime: "image/png".into(), data: "AAAA".into(), size: None };
        assert_eq!(prompt_blocks("q".into(), &[&image], true)[1]["type"], "image");
        assert_eq!(prompt_blocks("q".into(), &[&image], false)[1]["type"], "text");
    }

    #[test]
    fn tool_updates_keep_one_row_per_call() {
        let mut t = Translator::default();
        let start = json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Run tests", "kind": "execute", "status": "pending", "rawInput": { "command": "npm test" } });
        let Some(Out::Tool(first)) = t.push(&start) else { panic!() };
        assert_eq!((first.status.as_str(), first.iteration), ("running", 1));
        assert_eq!(t.push(&json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "in_progress" })), None);
        t.deny("c1");
        let Some(Out::Tool(end)) = t.push(&json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "failed", "title": "other" })) else { panic!() };
        assert_eq!((end.status.as_str(), &end.tool, &end.args), ("denied", &first.tool, &first.args));
        assert_eq!(t.calls(), 1);
    }

    #[derive(Default)]
    struct Recorder {
        translator: Translator,
        out: Vec<Out>,
        asked: Vec<String>,
    }

    impl Host for Recorder {
        fn update(&mut self, update: &Value) {
            if let Some(o) = self.translator.push(update) {
                self.out.push(o);
            }
        }
        async fn permit(&mut self, call: &Value) -> Result<bool, String> {
            self.asked.push(call["kind"].as_str().unwrap_or("").into());
            Ok(false)
        }
    }

    /// Поддельный агент ACP на другом конце канала: проверяет порядок и вид сообщений клиента.
    async fn fake_agent(stream: tokio::io::DuplexStream) {
        let (read, mut write) = tokio::io::split(stream);
        let mut lines = BufReader::new(read).lines();
        async fn say<W: AsyncWrite + Unpin>(w: &mut W, v: Value) {
            w.write_all(format!("{v}\n").as_bytes()).await.unwrap();
        }
        async fn next<R: AsyncBufRead + Unpin>(l: &mut tokio::io::Lines<R>) -> Value {
            serde_json::from_str(&l.next_line().await.unwrap().unwrap()).unwrap()
        }
        let init = next(&mut lines).await;
        assert_eq!(init["method"], "initialize");
        assert_eq!(init["params"]["clientInfo"]["name"], "aide");
        assert_eq!(init["params"]["clientCapabilities"]["terminal"], false);
        write.write_all(b"not json\n").await.unwrap();
        say(&mut write, json!({ "jsonrpc": "2.0", "id": init["id"], "result": { "protocolVersion": 1 } })).await;
        let new = next(&mut lines).await;
        assert_eq!(new["method"], "session/new");
        say(&mut write, json!({ "jsonrpc": "2.0", "id": new["id"], "result": { "sessionId": "s1" } })).await;
        let prompt = next(&mut lines).await;
        assert_eq!(prompt["params"]["sessionId"], "s1");
        say(&mut write, json!({ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "s1", "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Привет" } } } })).await;
        say(&mut write, json!({ "jsonrpc": "2.0", "id": 70, "method": "fs/read_text_file", "params": {} })).await;
        assert_eq!(next(&mut lines).await["error"]["code"], -32601);
        say(&mut write, json!({ "jsonrpc": "2.0", "id": "p1", "method": "session/request_permission", "params": { "toolCall": { "toolCallId": "c1", "kind": "execute" }, "options": [{ "optionId": "no", "kind": "reject_once" }] } })).await;
        let answer = next(&mut lines).await;
        assert_eq!(answer["id"], "p1");
        assert_eq!(answer["result"]["outcome"]["optionId"], "no");
        say(&mut write, json!({ "jsonrpc": "2.0", "id": prompt["id"], "result": { "stopReason": "end_turn" } })).await;
    }

    fn block<F: Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn talks_acp_from_start_to_answer() {
        block(async {
            let (client, server) = tokio::io::duplex(64 * 1024);
            let (read, write) = tokio::io::split(client);
            let mut acp = Acp::new(BufReader::new(read), write, Arc::new(AtomicBool::new(false)));
            let mut host = Recorder::default();
            let talk = async {
                acp.open(Path::new("."), &mut host).await.unwrap();
                acp.prompt(vec![json!({ "type": "text", "text": "hi" })], &mut host).await.unwrap()
            };
            let (stop, ()) = tokio::join!(talk, fake_agent(server));
            assert_eq!(stop, "end_turn");
            assert_eq!(host.out, [Out::Text("Привет".into())]);
            assert_eq!(host.asked, ["execute"]);
        });
    }

    #[test]
    fn stop_sends_session_cancel() {
        block(async {
            let (client, server) = tokio::io::duplex(64 * 1024);
            let (read, write) = tokio::io::split(client);
            let cancel = Arc::new(AtomicBool::new(false));
            let mut acp = Acp::new(BufReader::new(read), write, cancel.clone());
            acp.session = Some("s1".into());
            let agent = async {
                let (read, _write) = tokio::io::split(server);
                let mut lines = BufReader::new(read).lines();
                let _prompt = lines.next_line().await.unwrap();
                cancel.store(true, Ordering::Relaxed);
                let note: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(note["method"], "session/cancel");
                // Канал держим открытым, пока клиент не закончит.
                _write
            };
            let mut host = Quiet;
            let (result, _open) = tokio::join!(acp.prompt(vec![], &mut host), agent);
            assert_eq!(result.unwrap_err().message, "canceled");
        });
    }

    #[test]
    fn a_closed_agent_is_an_error_not_a_hang() {
        block(async {
            let (client, server) = tokio::io::duplex(1024);
            let (read, write) = tokio::io::split(client);
            let mut acp = Acp::new(BufReader::new(read), write, Arc::new(AtomicBool::new(false)));
            let agent = async move {
                let mut lines = BufReader::new(server).lines();
                let _ = lines.next_line().await;
            };
            let mut host = Quiet;
            let (result, ()) = tokio::join!(acp.open(Path::new("."), &mut host), agent);
            assert!(result.unwrap_err().message.contains("завершился"));
        });
    }
}
