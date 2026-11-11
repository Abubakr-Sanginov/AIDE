use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::time::timeout as tokio_timeout;

const KEYRING_SERVICE: &str = "aide";
pub(crate) const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Default)]
pub struct AiCancels(pub Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

#[derive(Serialize, Clone)]
pub(crate) struct AiChunk {
    request_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct AiThinking {
    pub(crate) request_id: String,
    pub(crate) text: String,
}

/// Tokens spent by a request (all steps of an agent run added up).
#[derive(Serialize, Clone, Copy, Default, Debug)]
pub(crate) struct Usage {
    pub(crate) input: u64,
    pub(crate) output: u64,
    /// Part of `input` served from the provider's prompt cache (cheaper).
    pub(crate) cached: u64,
}

impl Usage {
    pub(crate) fn add(&mut self, other: Usage) {
        self.input += other.input;
        self.output += other.output;
        self.cached += other.cached;
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.input == 0 && self.output == 0
    }
}

/// OpenAI-compatible: the last stream chunk carries `usage` (asked for with stream_options where supported).
pub(crate) fn usage_openai(v: &serde_json::Value) -> Option<Usage> {
    let u = v.get("usage")?;
    if !u.is_object() {
        return None;
    }
    Some(Usage {
        input: u["prompt_tokens"].as_u64().unwrap_or(0),
        output: u["completion_tokens"].as_u64().unwrap_or(0),
        cached: u["prompt_tokens_details"]["cached_tokens"].as_u64().unwrap_or(0),
    })
}

/// Google Gemini: `usageMetadata` on stream chunks (the last one is the total).
pub(crate) fn usage_google(v: &serde_json::Value) -> Option<Usage> {
    let u = v.get("usageMetadata")?;
    if !u.is_object() {
        return None;
    }
    Some(Usage {
        input: u["promptTokenCount"].as_u64().unwrap_or(0),
        output: u["candidatesTokenCount"].as_u64().unwrap_or(0) + u["thoughtsTokenCount"].as_u64().unwrap_or(0),
        cached: u["cachedContentTokenCount"].as_u64().unwrap_or(0),
    })
}

/// Anthropic: `message_start` has the input side, `message_delta` the running output count.
pub(crate) fn usage_anthropic(v: &serde_json::Value, current: &mut Usage) {
    match v["type"].as_str() {
        Some("message_start") => {
            let u = &v["message"]["usage"];
            let read = u["cache_read_input_tokens"].as_u64().unwrap_or(0);
            current.input = u["input_tokens"].as_u64().unwrap_or(0) + u["cache_creation_input_tokens"].as_u64().unwrap_or(0) + read;
            current.cached = read;
            current.output = u["output_tokens"].as_u64().unwrap_or(0);
        }
        Some("message_delta") => {
            let u = &v["usage"];
            if let Some(o) = u["output_tokens"].as_u64() {
                current.output = o;
            }
            if let Some(i) = u["input_tokens"].as_u64() {
                if i > 0 {
                    current.input = i + u["cache_creation_input_tokens"].as_u64().unwrap_or(0) + u["cache_read_input_tokens"].as_u64().unwrap_or(0);
                }
            }
        }
        _ => {}
    }
}

/// Providers known to accept `stream_options.include_usage`; for others the usage is read only when they send it anyway.
/// Ollama и LM Studio понимают stream_options.include_usage; чужие «local-*» серверы не трогаем: часть из них
/// отвергает неизвестные поля.
pub(crate) fn supports_stream_usage_for(provider_id: &str, base_url: &str) -> bool {
    matches!(provider_id, "ollama" | "lmstudio") || supports_stream_usage(base_url)
}

pub(crate) fn supports_stream_usage(base_url: &str) -> bool {
    ["api.openai.com", "openrouter.ai", "api.groq.com", "api.deepseek.com", "api.mistral.ai", "api.x.ai", "api.together.xyz"]
        .iter()
        .any(|h| base_url.contains(h))
}

#[derive(Serialize, Clone)]
pub(crate) struct AiDone {
    pub(crate) request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) iterations: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) usage: Option<Usage>,
}

#[derive(Serialize, Clone)]
pub(crate) struct AiError {
    pub(crate) request_id: String,
    pub(crate) message: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    pub mime: String,
    pub data: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub provider_id: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub context: Option<String>,
    pub auth: Option<String>,
    pub user_agent: Option<String>,
    /// Свой системный промпт (например, у раздела «Дизайн»). Без него используется общий промпт IDE.
    #[serde(default)]
    pub system: Option<String>,
    /// Лимит токенов ответа (используется там, где API его требует, — у Anthropic).
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// Сколько ждём очередную порцию потока. Модели с долгими размышлениями и очередь у
/// провайдера могут молчать минутами, поэтому лимит большой; по его истечении — ошибка.
pub(crate) const STREAM_IDLE_SECS: u64 = 600;

pub(crate) fn idle_timeout_message() -> String {
    format!(
        "Провайдер не присылал данные дольше {} минут. Попробуйте ещё раз или выберите другую модель.",
        STREAM_IDLE_SECS / 60
    )
}

fn request_system(request: &ChatRequest) -> String {
    match &request.system {
        Some(custom) if !custom.trim().is_empty() => {
            let mut prompt = custom.clone();
            if let Some(ctx) = &request.context {
                if !ctx.trim().is_empty() {
                    prompt.push_str("\n\n");
                    prompt.push_str(ctx);
                }
            }
            prompt
        }
        _ => system_prompt(&request.context),
    }
}

fn system_prompt(context: &Option<String>) -> String {
    let mut prompt = "Ты — ИИ-ассистент, встроенный в IDE AIDE. \
Отвечай на языке пользователя, по существу и без лишних слов. \
Код оформляй в блоках с указанием языка (например ```python)."
        .to_string();
    if let Some(ctx) = context {
        if !ctx.trim().is_empty() {
            prompt.push_str("\n\nКонтекст — активный файл пользователя:\n");
            prompt.push_str(ctx);
        }
    }
    prompt
}

pub(crate) fn truncate(s: &str, max: usize) -> String {
    let count = s.chars().count();
    let chars: String = s.chars().take(max).collect();
    if count > max {
        format!("{chars}…")
    } else {
        chars
    }
}

const MAX_ATTACH_TEXT_CHARS: usize = 20_000;

pub fn is_image_mime(mime: &str) -> bool {
    mime.starts_with("image/")
}

pub fn is_text_like(mime: &str, name: &str) -> bool {
    if mime.starts_with("text/") {
        return true;
    }
    let lower = name.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    matches!(
        ext,
        "json" | "xml" | "yaml" | "yml" | "js" | "mjs" | "cjs" | "ts" | "tsx"
            | "jsx" | "css" | "html" | "htm" | "csv" | "md" | "markdown" | "py"
            | "rs" | "go" | "java" | "c" | "h" | "cpp" | "hpp" | "cs" | "rb"
            | "php" | "sh" | "bat" | "ps1" | "sql" | "toml" | "ini" | "cfg"
            | "conf" | "log" | "txt" | "env" | "gitignore" | "svg" | "lock"
            | "properties" | "proto" | "gradle" | "svelte" | "vue" | "astro"
            | "scss" | "less" | "dockerfile" | "makefile" | "cmake" | "r" | "lua"
            | "zig" | "swift" | "kt" | "kts" | "dart" | "ex" | "exs" | "ml" | "fs"
            | "v" | "vsh" | "nim" | "d" | "cr" | "jl" | "hs" | "lhs" | "asm"
    )
}

fn base64_decode(data: &str) -> Vec<u8> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.decode(data).unwrap_or_default()
}

fn data_url(mime: &str, data: &str) -> String {
    let mime = if mime.is_empty() { "image/png" } else { mime };
    format!("data:{mime};base64,{data}")
}

fn attachment_text_block(att: &Attachment) -> Value {
    let size = att.size.unwrap_or(0);
    let bytes = base64_decode(&att.data);
    if is_text_like(&att.mime, &att.name) && !bytes.is_empty() {
        let text = String::from_utf8_lossy(&bytes);
        serde_json::json!({
            "type": "text",
            "text": format!("[Файл: {}]\n{}", att.name, truncate(&text, MAX_ATTACH_TEXT_CHARS)),
        })
    } else {
        serde_json::json!({
            "type": "text",
            "text": format!("[Файл: {} ({}), {} байт]", att.name, att.mime, size),
        })
    }
}

pub fn attachment_openai_block(att: &Attachment) -> Value {
    if is_image_mime(&att.mime) {
        serde_json::json!({
            "type": "image_url",
            "image_url": { "url": data_url(&att.mime, &att.data) },
        })
    } else {
        attachment_text_block(att)
    }
}

pub fn attachment_anthropic_block(att: &Attachment) -> Value {
    if is_image_mime(&att.mime) {
        let mime = if att.mime.is_empty() {
            "image/png".to_string()
        } else {
            att.mime.clone()
        };
        serde_json::json!({
            "type": "image",
            "source": { "type": "base64", "media_type": mime, "data": att.data },
        })
    } else {
        attachment_text_block(att)
    }
}

pub fn attachment_google_part(att: &Attachment) -> Value {
    if is_image_mime(&att.mime) {
        let mime = if att.mime.is_empty() {
            "image/png".to_string()
        } else {
            att.mime.clone()
        };
        serde_json::json!({
            "inline_data": { "mime_type": mime, "data": att.data },
        })
    } else {
        attachment_text_block(att)
    }
}

/// Контент сообщения: строка, если вложений нет; иначе массив блоков.
pub fn message_content_json(m: &ChatMessage) -> Value {
    if m.attachments.is_empty() {
        serde_json::json!(m.content)
    } else {
        let mut blocks = Vec::new();
        if !m.content.trim().is_empty() {
            blocks.push(serde_json::json!({ "type": "text", "text": m.content }));
        }
        for att in &m.attachments {
            blocks.push(attachment_openai_block(att));
        }
        serde_json::json!(blocks)
    }
}

/// Парти-блоки Google для сообщения с вложениями.
pub fn message_google_parts(m: &ChatMessage) -> Vec<Value> {
    let mut parts = Vec::new();
    if !m.content.trim().is_empty() {
        parts.push(serde_json::json!({ "text": m.content }));
    }
    for att in &m.attachments {
        parts.push(attachment_google_part(att));
    }
    parts
}

/// Блоки Anthropic для сообщения с вложениями.
pub fn message_anthropic_blocks(m: &ChatMessage) -> Value {
    let mut blocks = Vec::new();
    if !m.content.trim().is_empty() {
        blocks.push(serde_json::json!({ "type": "text", "text": m.content }));
    }
    for att in &m.attachments {
        blocks.push(attachment_anthropic_block(att));
    }
    serde_json::json!(blocks)
}

pub(crate) fn anthropic_auth(
    req: reqwest::RequestBuilder,
    key: &str,
    auth: Option<&str>,
) -> reqwest::RequestBuilder {
    if auth == Some("bearer") {
        req.bearer_auth(key)
    } else {
        req.header("x-api-key", key)
    }
}

pub(crate) fn with_ua(req: reqwest::RequestBuilder, ua: Option<&str>) -> reqwest::RequestBuilder {
    match ua {
        Some(ua) if !ua.is_empty() => req.header("User-Agent", ua),
        _ => req,
    }
}

pub(crate) fn api_key(provider_id: &str) -> Result<String, String> {
    // Локальные модели (Ollama, LM Studio, local-*) работают без ключа: к хранилищу ключей не обращаемся.
    if crate::local_models::is_local_provider(provider_id) {
        return Ok(String::new());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider_id).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err("API-ключ не настроен: откройте Настройки".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_api_key(provider_id: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider_id).map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| format!("Не удалось записать ключ в хранилище Windows: {e}"))?;
    // Проверяем чтением, что ключ действительно сохранился (иначе он «пропадёт» после перезапуска).
    match entry.get_password() {
        Ok(saved) if saved == key => Ok(()),
        Ok(_) => Err("Хранилище Windows вернуло другое значение ключа (возможно, ключ слишком длинный)".into()),
        Err(e) => Err(format!("Ключ записан, но не читается обратно: {e}")),
    }
}

#[tauri::command]
pub fn get_api_key(provider_id: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider_id).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_api_key(provider_id: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider_id).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cancel_chat(cancels: State<AiCancels>, request_id: String) {
    if let Some(cancel) = cancels.0.lock().unwrap().get(&request_id) {
        cancel.store(true, Ordering::Relaxed);
    }
}

pub(crate) async fn ensure_ok(resp: reqwest::Response, what: &str) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("{what} ошибка {status}: {}", truncate(&text, 400)))
    }
}

#[tauri::command]
pub async fn list_models(
    kind: String,
    base_url: String,
    provider_id: String,
    auth: Option<String>,
    user_agent: Option<String>,
) -> Result<Vec<String>, String> {
    let key = api_key(&provider_id)?;
    let client = new_client()?;
    let ids = match kind.as_str() {
        "anthropic" => {
            let resp = with_ua(
                anthropic_auth(
                    client
                        .get(format!("{base_url}/v1/models"))
                        .header("anthropic-version", ANTHROPIC_VERSION),
                    &key,
                    auth.as_deref(),
                ),
                user_agent.as_deref(),
            )
            .send()
                .await
                .map_err(|e| format!("Запрос к {base_url} не удался: {e}"))?;
            let resp = ensure_ok(resp, "Anthropic").await?;
            let value: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            value["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        }
        "google" => {
            let resp = with_ua(
                client
                    .get(format!("{base_url}/v1beta/models"))
                    .query(&[("key", &key)]),
                user_agent.as_deref(),
            )
            .send()
                .await
                .map_err(|e| format!("Запрос к {base_url} не удался: {e}"))?;
            let resp = ensure_ok(resp, "Google").await?;
            let value: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            value["models"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            m["name"]
                                .as_str()
                                .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        _ => {
            let resp = with_ua(
                crate::local_models::bearer(client.get(format!("{base_url}/models")), &key),
                user_agent.as_deref(),
            )
            .send()
                .await
                .map_err(|e| crate::local_models::explain(&provider_id, &base_url, format!("Запрос к {base_url} не удался: {e}")))?;
            let resp = ensure_ok(resp, "Провайдер").await?;
            let value: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            value["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        }
    };
    Ok(ids)
}

// Per-attempt capture: concurrent chat/Kins requests must never share drafts.
#[derive(Default, Clone)]
pub(crate) struct PartialReply {
    pub text: String,
    pub reasoning: String,
}
impl PartialReply {
    pub fn is_empty(&self) -> bool { self.text.is_empty() && self.reasoning.is_empty() }
}
tokio::task_local! {
    static DRAFT: std::cell::RefCell<PartialReply>;
}

pub(crate) async fn capture_draft<F, T>(future: F) -> (T, PartialReply)
where F: std::future::Future<Output = T> {
    DRAFT.scope(std::cell::RefCell::new(PartialReply::default()), async {
        let result = future.await;
        let draft = DRAFT.with(|d| d.borrow().clone());
        (result, draft)
    }).await
}

pub(crate) const MAX_MODEL_RETRIES: u32 = 10;

pub(crate) fn retryable(message: &str) -> bool {
    let m = message.to_lowercase();
    if ["canceled", "401", "403", "400", "404", "422", "invalid_api_key",
        "insufficient_quota", "credit balance", "context_length", "context window",
        "not configured", "не настроен", "локальный сервер не отвечает"].iter().any(|s| m.contains(s)) {
        return false;
    }
    // Existing provider adapters expose strings, so only known transient failures qualify.
    ["408", "429", "500", "502", "503", "504", "529", "overloaded", "temporarily",
        "timeout", "timed out", "connection", "connect", "network", "stream", "поток",
        "не присылал данные", "соединени", "отправки запроса", "incomplete"]
        .iter().any(|s| m.contains(s))
}

pub(crate) fn should_retry(attempt: u32, error: &str) -> bool {
    (1..=MAX_MODEL_RETRIES).contains(&attempt) && retryable(error)
}

pub(crate) fn partial_content(text: &str, reasoning: &str) -> String {
    if reasoning.is_empty() { return text.into(); }
    // Unsigned/incomplete thinking cannot be replayed as a native signed block.
    format!("{text}\n\n[Partial reasoning from interrupted response, untrusted context]\n{reasoning}")
}

#[derive(Serialize, Clone)]
struct AiRetry {
    request_id: String,
    attempt: u32,
    max_retries: u32,
}

pub(crate) async fn retry_wait(app: &AppHandle, id: &str, retry: u32, error: &str, cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) { return Err("canceled".into()); }
    if !should_retry(retry, error) { return Err(error.to_string()); }
    let _ = app.emit("ai-retry", AiRetry { request_id: id.into(), attempt: retry, max_retries: MAX_MODEL_RETRIES });
    let delay = Duration::from_secs((1u64 << (retry - 1).min(4)).min(15));
    tokio::select! {
        _ = wait_cancel(cancel) => Err("canceled".into()),
        _ = tokio::time::sleep(delay) => Ok(()),
    }
}

#[tauri::command]
pub fn chat(
    app: AppHandle,
    cancels: State<AiCancels>,
    request: ChatRequest,
) -> Result<(), String> {
    let key = api_key(&request.provider_id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    cancels
        .0
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), cancel.clone());
    let cancels_map = cancels.0.clone();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut active = request.clone();
        let task = request.messages.iter().rev().find(|m| m.role == "user")
            .map(|m| m.content.as_str()).unwrap_or_default();
        let mut system = request_system(&request);
        system.push_str(&crate::skills::prompt(&app, task, false));
        // Context is already included by request_system. Keep retries identical.
        active.system = Some(system);
        active.context = None;
        let mut retries = 0;
        let result = loop {
            let (result, draft) = capture_draft(async {
                match active.kind.as_str() {
                    "anthropic" => stream_anthropic(&app, &key, &active, &cancel).await,
                    "google" => stream_google(&app, &key, &active, &cancel).await,
                    _ => stream_openai_compat(&app, &key, &active, &cancel).await,
                }
            }).await;
            match result {
                Ok(usage) => break Ok(usage),
                Err(error) => {
                    retries += 1;
                    if let Err(error) = retry_wait(&app, &request.request_id, retries, &error, &cancel).await {
                        break Err(error);
                    }
                    if !draft.is_empty() {
                        active.messages.push(ChatMessage { role: "assistant".into(), content: if active.kind == "openai" { draft.text.clone() } else { partial_content(&draft.text, &draft.reasoning) }, reasoning_content: Some(draft.reasoning), attachments: Vec::new() });
                        active.messages.push(ChatMessage {
                            role: "user".into(), content: "Соединение прервалось. Продолжи незавершённый ответ без повторения уже написанного.".into(), reasoning_content: None, attachments: Vec::new(),
                        });
                        emit_chunk(&app, &request.request_id, "\n\n");
                    }
                }
            }
        };
        cancels_map.lock().unwrap().remove(&request.request_id);
        match result {
            Ok(usage) => {
                let _ = app.emit(
                    "ai-done",
                    AiDone {
                        request_id: request.request_id,
                        iterations: None,
                        usage: if usage.is_empty() { None } else { Some(usage) },
                    },
                );
            }
            Err(message) => {
                let _ = app.emit(
                    "ai-error",
                    AiError {
                        request_id: request.request_id,
                        message,
                    },
                );
            }
        }
    });
    Ok(())
}

pub(crate) fn new_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn canceled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::Relaxed)
}

/// Resolves as soon as the user pressed Stop. Polled every 60 ms, so a stop is noticed even while the
/// provider is silent (waiting for the first token, a long thought, a stalled connection).
pub(crate) async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}

/// Sends the request, but gives up the moment Stop is pressed: dropping the pending request closes the
/// connection, so the provider stops generating (and billing) right away.
pub(crate) trait SendCancellable {
    async fn send_c(self, cancel: &AtomicBool) -> Result<reqwest::Response, String>;
}

impl SendCancellable for reqwest::RequestBuilder {
    async fn send_c(self, cancel: &AtomicBool) -> Result<reqwest::Response, String> {
        tokio::select! {
            r = self.send() => r.map_err(|e| format!("Запрос не удался: {e}")),
            _ = wait_cancel(cancel) => Err("canceled".into()),
        }
    }
}

/// Next piece of the response body, or an error on Stop / a silent connection / a broken stream.
/// Returning an error drops the stream, which closes the connection to the provider.
pub(crate) async fn next_or_cancel<S, B>(stream: &mut S, cancel: &AtomicBool) -> Result<Option<B>, String>
where
    S: futures_util::Stream<Item = Result<B, reqwest::Error>> + Unpin,
{
    tokio::select! {
        r = tokio_timeout(Duration::from_secs(STREAM_IDLE_SECS), stream.next()) => match r {
            Ok(Some(Ok(c))) => Ok(Some(c)),
            Ok(Some(Err(e))) => Err(format!("Ошибка потока ответа: {e}")),
            Ok(None) => Ok(None),
            Err(_) => Err(idle_timeout_message()),
        },
        _ = wait_cancel(cancel) => Err("canceled".into()),
    }
}

async fn stream_openai_compat(
    app: &AppHandle,
    key: &str,
    request: &ChatRequest,
    cancel: &AtomicBool,
) -> Result<Usage, String> {
    let client = new_client()?;
    let mut body_messages = vec![serde_json::json!({
        "role": "system",
        "content": request_system(request)
    })];
    for m in &request.messages {
        let mut msg = serde_json::json!({ "role": m.role, "content": message_content_json(m) });
        if m.role == "assistant" {
            msg["reasoning_content"] =
                serde_json::json!(m.reasoning_content.clone().unwrap_or_default());
        }
        body_messages.push(msg);
    }
    let body = serde_json::json!({
        "model": request.model,
        "messages": body_messages,
        "stream": true,
    });
    let mut body = body;
    if supports_stream_usage_for(&request.provider_id, &request.base_url) {
        body["stream_options"] = serde_json::json!({ "include_usage": true });
    }
    let mut usage = Usage::default();

    let resp = with_ua(
        crate::local_models::bearer(client.post(format!("{}/chat/completions", request.base_url)), key),
        request.user_agent.as_deref(),
    )
    .json(&body)
    .send_c(cancel)
        .await
        .map_err(|e| crate::local_models::explain(&request.provider_id, &request.base_url, e))?;
    let resp = ensure_ok(resp, "Провайдер").await?;

    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    loop {
        let chunk = match next_or_cancel(&mut stream, cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        if canceled(cancel) {
            return Err("canceled".into());
        }
        buf.extend_from_slice(&chunk);
        for line in split_sse_lines(&mut buf) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                return Ok(usage);
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            if let Some(message) = value["error"]["message"].as_str() {
                return Err(message.to_string());
            }
            if let Some(u) = usage_openai(&value) {
                usage = u;
            }
            if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
                emit_chunk(app, &request.request_id, text);
            }
            // «reasoning_content» у большинства серверов и LM Studio, «reasoning» у Ollama.
            let thinking = value["choices"][0]["delta"]["reasoning_content"]
                .as_str()
                .or_else(|| value["choices"][0]["delta"]["reasoning"].as_str());
            if let Some(text) = thinking {
                emit_thinking(app, &request.request_id, text);
            }
        }
    }
    Err("incomplete provider stream".into())
}

async fn stream_anthropic(
    app: &AppHandle,
    key: &str,
    request: &ChatRequest,
    cancel: &AtomicBool,
) -> Result<Usage, String> {
    let client = new_client()?;
    let mut usage = Usage::default();
    let messages = request
        .messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": message_anthropic_blocks(m) }))
        .collect::<Vec<_>>();

    // Длинные ответы (дизайн) требуют большого лимита; у старых моделей он ниже, поэтому
    // при отказе по max_tokens пробуем меньшие значения.
    let wanted = request.max_tokens.unwrap_or(4096);
    let mut limits = vec![wanted];
    for fallback in [8192u32, 4096] {
        if fallback < wanted {
            limits.push(fallback);
        }
    }
    let mut last_error = String::new();
    let mut accepted = None;
    for max_tokens in limits {
        let body = serde_json::json!({
            "model": request.model,
            "system": request_system(request),
            "max_tokens": max_tokens,
            "stream": true,
            "messages": messages.clone(),
        });
        let resp = with_ua(
            anthropic_auth(
                client
                    .post(format!("{}/v1/messages", request.base_url))
                    .header("anthropic-version", ANTHROPIC_VERSION),
                key,
                request.auth.as_deref(),
            ),
            request.user_agent.as_deref(),
        )
        .json(&body)
        .send_c(cancel)
        .await?;
        match ensure_ok(resp, "Anthropic").await {
            Ok(r) => {
                accepted = Some(r);
                break;
            }
            Err(e) if e.to_lowercase().contains("max_tokens") => last_error = e,
            Err(e) => return Err(e),
        }
    }
    let resp = accepted.ok_or(last_error)?;

    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    loop {
        let chunk = match next_or_cancel(&mut stream, cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        if canceled(cancel) {
            return Err("canceled".into());
        }
        buf.extend_from_slice(&chunk);
        for line in split_sse_lines(&mut buf) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(data.trim()) else {
                continue;
            };
            if value["type"] == "error" {
                let message = value["error"]["message"]
                    .as_str()
                    .unwrap_or("неизвестная ошибка Anthropic");
                return Err(message.to_string());
            }
            usage_anthropic(&value, &mut usage);
            if value["type"] == "message_stop" { return Ok(usage); }
            if value["type"] == "content_block_delta" && value["delta"]["type"] == "text_delta" {
                if let Some(text) = value["delta"]["text"].as_str() {
                    emit_chunk(app, &request.request_id, text);
                }
            }
            if value["type"] == "content_block_delta" && value["delta"]["type"] == "thinking_delta" {
                if let Some(text) = value["delta"]["thinking"].as_str() {
                    emit_thinking(app, &request.request_id, text);
                }
            }
        }
    }
    Err("incomplete provider stream".into())
}

async fn stream_google(
    app: &AppHandle,
    key: &str,
    request: &ChatRequest,
    cancel: &AtomicBool,
) -> Result<Usage, String> {
    let client = new_client()?;
    let mut usage = Usage::default();
    let system = request_system(request);
    let contents: Vec<_> = request
        .messages
        .iter()
        .map(|m| {
            let parts = if m.attachments.is_empty() {
                vec![serde_json::json!({ "text": m.content })]
            } else {
                message_google_parts(m)
            };
            serde_json::json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": parts,
            })
        })
        .collect();
    let mut body = serde_json::json!({ "contents": contents });
    if !system.is_empty() {
        body["system_instruction"] = serde_json::json!({ "parts": [{ "text": system }] });
    }

    let url = format!(
        "{}/v1beta/models/{}:streamGenerateContent",
        request.base_url, request.model
    );
    let resp = with_ua(
        client
            .post(url)
            .query(&[("alt", "sse"), ("key", key)]),
        request.user_agent.as_deref(),
    )
    .json(&body)
    .send_c(cancel)
        .await?;
    let resp = ensure_ok(resp, "Google").await?;

    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    loop {
        let chunk = match next_or_cancel(&mut stream, cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        if canceled(cancel) {
            return Err("canceled".into());
        }
        buf.extend_from_slice(&chunk);
        for line in split_sse_lines(&mut buf) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(data.trim()) else {
                continue;
            };
            if let Some(message) = value["error"]["message"].as_str() {
                return Err(message.to_string());
            }
            if let Some(u) = usage_google(&value) {
                usage = u;
            }
            if let Some(parts) = value["candidates"][0]["content"]["parts"].as_array() {
                for part in parts {
                    if part["thought"].as_bool() == Some(true) {
                        if let Some(text) = part["text"].as_str() {
                            emit_thinking(app, &request.request_id, text);
                        }
                    } else if let Some(text) = part["text"].as_str() {
                        emit_chunk(app, &request.request_id, text);
                    }
                }
            }
            if value["candidates"][0]["finishReason"].as_str().is_some() { return Ok(usage); }
        }
    }
    Err("incomplete provider stream".into())
}

pub(crate) fn emit_chunk(app: &AppHandle, request_id: &str, text: &str) {
    let _ = DRAFT.try_with(|d| d.borrow_mut().text.push_str(text));
    if !text.is_empty() {
        let _ = app.emit(
            "ai-chunk",
            AiChunk {
                request_id: request_id.to_string(),
                text: text.to_string(),
            },
        );
    }
}

pub(crate) fn emit_thinking(app: &AppHandle, request_id: &str, text: &str) {
    let _ = DRAFT.try_with(|d| d.borrow_mut().reasoning.push_str(text));
    if !text.is_empty() {
        let _ = app.emit(
            "ai-thinking",
            AiThinking {
                request_id: request_id.to_string(),
                text: text.to_string(),
            },
        );
    }
}

pub(crate) fn split_sse_lines(buf: &mut Vec<u8>) -> Vec<String> {
    let mut out = Vec::new();
    let mut idx = 0;
    while idx < buf.len() {
        if buf[idx] == b'\n' {
            out.push(String::from_utf8_lossy(&buf[..idx]).into_owned());
            buf.drain(..=idx);
            idx = 0;
        } else {
            idx += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ten_retries_then_error_and_permanent_failures_stop() {
        for n in 1..=10 { assert!(should_retry(n, "HTTP 503 temporarily unavailable")); }
        assert!(!should_retry(11, "HTTP 503 temporarily unavailable"));
        assert!(!should_retry(0, "connection reset"));
        for e in ["canceled", "HTTP 401", "HTTP 403", "HTTP 400", "insufficient_quota", "context window exceeded"] {
            assert!(!should_retry(1, e), "{e}");
        }
        assert!(should_retry(1, "incomplete provider stream"));
        assert!(should_retry(1, "connection reset"));
    }

    #[tokio::test]
    async fn interrupted_thinking_is_preserved_and_requests_are_isolated() {
        let a = capture_draft(async {
            DRAFT.with(|d| { d.borrow_mut().text.push_str("saved"); d.borrow_mut().reasoning.push_str("next step"); });
            tokio::task::yield_now().await;
            Err::<(), _>("connection reset")
        });
        let b = capture_draft(async {
            DRAFT.with(|d| d.borrow_mut().text.push_str("other"));
        });
        let ((result, draft), (_, other)) = tokio::join!(a, b);
        assert!(result.is_err());
        assert_eq!(draft.text, "saved");
        assert_eq!(draft.reasoning, "next step");
        assert_eq!(other.text, "other");
        assert!(other.reasoning.is_empty());
        assert!(partial_content(&draft.text, &draft.reasoning).contains("next step"));
    }

    fn att(name: &str, mime: &str, data: &str) -> Attachment {
        Attachment {
            name: name.to_string(),
            mime: mime.to_string(),
            data: data.to_string(),
            size: Some(data.len() as u64),
        }
    }

    #[test]
    fn image_attachment_becomes_image_url_block() {
        let m = ChatMessage {
            role: "user".into(),
            content: "Что на картинке?".into(),
            reasoning_content: None,
            attachments: vec![att("pic.png", "image/png", "aGVsbG8=")],
        };
        let value = message_content_json(&m);
        assert!(value.is_array());
        let arr = value.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[1]["type"], "image_url");
        assert_eq!(
            arr[1]["image_url"]["url"],
            "data:image/png;base64,aGVsbG8="
        );
    }

    #[test]
    fn text_file_attachment_inlines_content() {
        let m = ChatMessage {
            role: "user".into(),
            content: String::new(),
            reasoning_content: None,
            attachments: vec![att("notes.txt", "text/plain", "aGVsbG8gd29ybGQ=")],
        };
        let value = message_content_json(&m);
        let arr = value.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        let text = arr[0]["text"].as_str().unwrap();
        assert!(text.contains("notes.txt"));
        assert!(text.contains("hello world"));
    }

    #[test]
    fn binary_attachment_is_described_not_inlined() {
        let m = ChatMessage {
            role: "user".into(),
            content: String::new(),
            reasoning_content: None,
            attachments: vec![att("app.exe", "application/octet-stream", "AAAA")],
        };
        let value = message_content_json(&m);
        let arr = value.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
        let text = arr[0]["text"].as_str().unwrap();
        assert!(text.contains("app.exe"));
        assert!(!text.contains("AAAA"));
    }

    #[test]
    fn no_attachments_keeps_string_content() {
        let m = ChatMessage {
            role: "user".into(),
            content: "просто текст".into(),
            reasoning_content: None,
            attachments: vec![],
        };
        assert_eq!(message_content_json(&m), serde_json::json!("просто текст"));
    }

    #[test]
    fn google_parts_use_inline_data_for_images() {
        let m = ChatMessage {
            role: "user".into(),
            content: "описание".into(),
            reasoning_content: None,
            attachments: vec![att("p.webp", "image/webp", "WVdKeg==")],
        };
        let parts = message_google_parts(&m);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["inline_data"]["mime_type"], "image/webp");
        assert_eq!(parts[1]["inline_data"]["data"], "WVdKeg==");
    }
}
#[cfg(test)]
mod usage_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn openai_usage_comes_from_the_last_chunk() {
        let v = json!({"choices": [], "usage": {"prompt_tokens": 120, "completion_tokens": 30, "prompt_tokens_details": {"cached_tokens": 100}}});
        let u = usage_openai(&v).unwrap();
        assert_eq!((u.input, u.output, u.cached), (120, 30, 100));
        assert!(usage_openai(&json!({"choices": [{"delta": {}}]})).is_none());
    }

    #[test]
    fn anthropic_usage_adds_cache_to_input_and_tracks_output() {
        let mut u = Usage::default();
        usage_anthropic(&json!({"type": "message_start", "message": {"usage": {"input_tokens": 10, "cache_read_input_tokens": 90, "cache_creation_input_tokens": 5, "output_tokens": 1}}}), &mut u);
        assert_eq!((u.input, u.cached), (105, 90));
        usage_anthropic(&json!({"type": "message_delta", "usage": {"output_tokens": 42}}), &mut u);
        assert_eq!(u.output, 42);
    }

    #[test]
    fn google_usage_counts_thinking_as_output() {
        let u = usage_google(&json!({"usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 20, "thoughtsTokenCount": 7}})).unwrap();
        assert_eq!((u.input, u.output), (50, 27));
    }

    #[test]
    fn usage_totals_add_up() {
        let mut t = Usage::default();
        t.add(Usage { input: 5, output: 2, cached: 1 });
        t.add(Usage { input: 7, output: 3, cached: 0 });
        assert_eq!((t.input, t.output, t.cached), (12, 5, 1));
        assert!(!t.is_empty());
    }
}

#[cfg(test)]
mod cancel_tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn stop_interrupts_a_silent_stream_immediately() {
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            flag.store(true, Ordering::Relaxed);
        });
        // A provider that connected but never sends a byte: without the fix this waited for the idle timeout.
        let mut silent = futures_util::stream::pending::<Result<Vec<u8>, reqwest::Error>>();
        let started = std::time::Instant::now();
        let r = next_or_cancel(&mut silent, &cancel).await;
        assert_eq!(r.unwrap_err(), "canceled");
        assert!(started.elapsed() < Duration::from_secs(2), "stop took {:?}", started.elapsed());
    }

    #[tokio::test]
    async fn stop_interrupts_a_pending_request() {
        // 10.255.255.1 never answers: the request hangs until it is stopped.
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            flag.store(true, Ordering::Relaxed);
        });
        let req = new_client().unwrap().get("http://10.255.255.1:81/");
        let started = std::time::Instant::now();
        let r = req.send_c(&cancel).await;
        assert_eq!(r.unwrap_err(), "canceled");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
