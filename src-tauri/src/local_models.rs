//! Локальные модели: Ollama и LM Studio (и любой «свой» сервер с OpenAI-совместимым API).
//!
//! Что здесь:
//! - провайдер без ключа: `is_local_provider` (ollama, lmstudio и всё, что начинается с «local-»);
//!   для него AIDE не обращается к хранилищу ключей и не шлёт заголовок Authorization;
//! - `local_probe`: проверяет, запущены ли Ollama и LM Studio на этом компьютере, и возвращает их модели
//!   (размер, поддержка инструментов, длина контекста) — всё нужное, чтобы выбрать модель, которая потянет агента;
//! - понятная ошибка, когда сервер не запущен.
//!
//! Безопасность: `local_probe` ходит только на адреса этого компьютера (localhost, 127.x, ::1) по http,
//! без учётных данных в адресе; произвольные адреса из интерфейса сюда не попадают.

use std::collections::HashSet;
use std::time::Duration;

use futures_util::future::join_all;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const PROBE_TIMEOUT: Duration = Duration::from_millis(2500);
const MAX_MODELS: usize = 60;
const MAX_SHOW_CALLS: usize = 24;

/// Провайдеры, которым ключ не нужен.
pub fn is_local_provider(id: &str) -> bool {
    matches!(id, "ollama" | "lmstudio") || id.starts_with("local-")
}

/// Authorization только если ключ есть: пустой «Bearer » некоторые серверы отвергают.
pub fn bearer(req: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    if key.is_empty() {
        req
    } else {
        req.bearer_auth(key)
    }
}

/// Если локальный сервер не отвечает — говорим об этом прямо и подсказываем, что включить.
pub fn explain(provider_id: &str, base_url: &str, err: String) -> String {
    if is_local_provider(provider_id) && (err.starts_with("Запрос не удался") || err.starts_with("Запрос к")) {
        let hint = match provider_id {
            "ollama" => "Запустите Ollama (приложение или команда `ollama serve`).",
            "lmstudio" => "В LM Studio откройте вкладку Developer и нажмите Start Server.",
            _ => "Запустите сервер модели и проверьте адрес и порт.",
        };
        return format!("Локальный сервер не отвечает ({base_url}). {hint}");
    }
    err
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeTarget {
    id: String,
    base_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    id: String,
    size_bytes: Option<u64>,
    params: Option<String>,
    quant: Option<String>,
    /// Умеет вызывать инструменты (нужно агенту). None — сервер не сообщает.
    tools: Option<bool>,
    /// Длина контекста. Если `context_running` — это контекст, с которым модель сейчас запущена (его и получит агент),
    /// иначе — максимум модели: реальный зависит от настроек сервера (у Ollama по умолчанию часто всего 4096).
    context: Option<u64>,
    context_running: bool,
    loaded: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalServer {
    id: String,
    name: String,
    base_url: String,
    running: bool,
    version: Option<String>,
    models: Vec<LocalModel>,
    error: Option<String>,
}

/// Адрес сервера → его «корень» (без /v1), только если это этот же компьютер.
fn loopback_origin(base_url: &str) -> Result<String, String> {
    let u = url::Url::parse(base_url.trim()).map_err(|_| "некорректный адрес".to_string())?;
    if u.scheme() != "http" || !u.username().is_empty() || u.password().is_some() || u.query().is_some() || u.fragment().is_some() {
        return Err("нужен простой адрес http://localhost:порт".into());
    }
    let local = match u.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if !local {
        return Err("проверка работает только для серверов на этом компьютере".into());
    }
    Ok(u.origin().ascii_serialization())
}

async fn get_json(client: &Client, url: &str) -> Result<Value, String> {
    let resp = client.get(url).timeout(PROBE_TIMEOUT).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

/// Модели Ollama из /api/tags (без проверки возможностей).
fn parse_ollama_tags(v: &Value, loaded: &HashSet<String>) -> Vec<LocalModel> {
    v["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|m| {
                    let id = m["name"].as_str().or_else(|| m["model"].as_str())?.to_string();
                    Some(LocalModel {
                        size_bytes: m["size"].as_u64(),
                        params: m["details"]["parameter_size"].as_str().map(String::from),
                        quant: m["details"]["quantization_level"].as_str().map(String::from),
                        tools: None,
                        context: None,
                        context_running: false,
                        loaded: loaded.contains(&id),
                        id,
                    })
                })
                .take(MAX_MODELS)
                .collect()
        })
        .unwrap_or_default()
}

/// Из /api/ps: какие модели запущены и с каким контекстом (поле есть у новых версий Ollama).
fn parse_ollama_ps(v: &Value) -> std::collections::HashMap<String, Option<u64>> {
    v["models"]
        .as_array()
        .map(|a| a.iter().filter_map(|m| Some((m["name"].as_str()?.to_string(), m["context_length"].as_u64()))).collect())
        .unwrap_or_default()
}

/// Из ответа /api/show: (умеет инструменты, это модель для текста, длина контекста).
fn parse_ollama_show(v: &Value) -> (Option<bool>, bool, Option<u64>) {
    let caps: Option<Vec<&str>> = v["capabilities"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect());
    let tools = caps.as_ref().map(|c| c.contains(&"tools"));
    // Модели только для эмбеддингов агенту не нужны.
    let text = caps.as_ref().map(|c| c.contains(&"completion") || !c.contains(&"embedding")).unwrap_or(true);
    let ctx = v["model_info"]
        .as_object()
        .and_then(|o| o.iter().find(|(k, _)| k.ends_with(".context_length")).and_then(|(_, n)| n.as_u64()));
    (tools, text, ctx)
}

/// Модели LM Studio из /api/v0/models. Эмбеддинги пропускаются.
fn parse_lmstudio(v: &Value) -> Vec<LocalModel> {
    v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|m| m["type"].as_str() != Some("embeddings"))
                .filter_map(|m| {
                    let id = m["id"].as_str()?.to_string();
                    let loaded = m["state"].as_str() == Some("loaded");
                    let tools = m["capabilities"].as_array().map(|c| c.iter().any(|x| x.as_str() == Some("tool_use")));
                    Some(LocalModel {
                        id,
                        size_bytes: None,
                        params: None,
                        quant: m["quantization"].as_str().map(String::from),
                        tools,
                        context: if loaded { m["loaded_context_length"].as_u64() } else { m["max_context_length"].as_u64() },
                        context_running: loaded && m["loaded_context_length"].as_u64().is_some(),
                        loaded,
                    })
                })
                .take(MAX_MODELS)
                .collect()
        })
        .unwrap_or_default()
}

async fn probe_ollama(client: &Client, base_url: &str, origin: &str) -> LocalServer {
    let mut s = LocalServer { id: "ollama".into(), name: "Ollama".into(), base_url: base_url.into(), running: false, version: None, models: Vec::new(), error: None };
    let tags = match get_json(client, &format!("{origin}/api/tags")).await {
        Ok(v) => v,
        Err(e) => {
            s.error = Some(e);
            return s;
        }
    };
    s.running = true;
    let (version_url, ps_url) = (format!("{origin}/api/version"), format!("{origin}/api/ps"));
    let (version, ps) = tokio::join!(get_json(client, &version_url), get_json(client, &ps_url));
    s.version = version.ok().and_then(|v| v["version"].as_str().map(String::from));
    let running = ps.ok().map(|v| parse_ollama_ps(&v)).unwrap_or_default();
    let loaded: HashSet<String> = running.keys().cloned().collect();
    let mut models = parse_ollama_tags(&tags, &loaded);
    // Возможности каждой модели — отдельным запросом, параллельно и с ограничением.
    let shows = join_all(models.iter().take(MAX_SHOW_CALLS).map(|m| {
        let url = format!("{origin}/api/show");
        let body = json!({ "model": m.id });
        async move {
            let resp = client.post(url).timeout(PROBE_TIMEOUT).json(&body).send().await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            resp.json::<Value>().await.ok()
        }
    }))
    .await;
    let mut skip = HashSet::new();
    for (i, show) in shows.into_iter().enumerate() {
        if let Some(v) = show {
            let (tools, text, ctx) = parse_ollama_show(&v);
            if !text {
                skip.insert(i);
            }
            models[i].tools = tools;
            models[i].context = ctx;
        }
    }
    // Запущенной модели агент получит именно тот контекст, с которым она запущена, а не максимум из описания модели.
    for m in &mut models {
        if let Some(Some(ctx)) = running.get(&m.id) {
            m.context = Some(*ctx);
            m.context_running = true;
        }
    }
    s.models = models.into_iter().enumerate().filter(|(i, _)| !skip.contains(i)).map(|(_, m)| m).collect();
    s
}

async fn probe_lmstudio(client: &Client, base_url: &str, origin: &str) -> LocalServer {
    let mut s = LocalServer { id: "lmstudio".into(), name: "LM Studio".into(), base_url: base_url.into(), running: false, version: None, models: Vec::new(), error: None };
    // /api/v0/models отдаёт возможности и длину контекста; на старых версиях его нет — тогда хотя бы список из /v1/models.
    match get_json(client, &format!("{origin}/api/v0/models")).await {
        Ok(v) => {
            s.running = true;
            s.models = parse_lmstudio(&v);
        }
        Err(first) => match get_json(client, &format!("{origin}/v1/models")).await {
            Ok(v) => {
                s.running = true;
                s.models = v["data"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|m| m["id"].as_str())
                            .filter(|id| !id.contains("embed"))
                            .take(MAX_MODELS)
                            .map(|id| LocalModel { id: id.into(), size_bytes: None, params: None, quant: None, tools: None, context: None, context_running: false, loaded: false })
                            .collect()
                    })
                    .unwrap_or_default();
            }
            Err(_) => s.error = Some(first),
        },
    }
    s
}

/// Проверяет, запущены ли Ollama и LM Studio на этом компьютере, и перечисляет их модели.
#[tauri::command]
pub async fn local_probe(targets: Vec<ProbeTarget>) -> Result<Vec<LocalServer>, String> {
    let client = Client::builder().connect_timeout(Duration::from_millis(1200)).build().map_err(|e| e.to_string())?;
    let mut jobs = Vec::new();
    for t in targets.iter().take(4) {
        if t.id != "ollama" && t.id != "lmstudio" {
            return Err("неизвестный локальный сервер".into());
        }
        let origin = loopback_origin(&t.base_url)?;
        jobs.push((t.id.clone(), t.base_url.trim().trim_end_matches('/').to_string(), origin));
    }
    let results = join_all(jobs.iter().map(|(id, base, origin)| {
        let client = &client;
        async move {
            if id == "ollama" {
                probe_ollama(client, base, origin).await
            } else {
                probe_lmstudio(client, base, origin).await
            }
        }
    }))
    .await;
    Ok(results)
}

/* ───────────── Версия модели с большим контекстом ───────────── */

// Ollama по умолчанию запускает модель с контекстом 4096 токенов, а запросы через /v1 его изменить не могут. Агенту этого
// мало: начало разговора (инструкции и вопрос) молча отбрасывается. Выход без перезапуска сервера — производная модель с
// параметром num_ctx: она делит веса с исходной (ничего не скачивается), а параметр действует на все запросы.

/// Метка в имени версии, созданной AIDE: «gemma4:12b-aide-16k». По ней же разрешено удаление: чужие модели не трогаем.
const VARIANT_MARK: &str = "-aide-";
const DEFAULT_VARIANT_CTX: u32 = 16_384;
const MIN_VARIANT_CTX: u32 = 8_192;
const MAX_VARIANT_CTX: u32 = 131_072;

fn valid_model_name(name: &str) -> bool {
    let ok_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-');
    !name.is_empty()
        && name.len() <= 120
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(ok_char)
        && !name.contains("..")
        && !name.contains("//")
}

fn variant_name(base: &str, num_ctx: u32) -> String {
    format!("{base}{VARIANT_MARK}{}k", num_ctx / 1024)
}

fn is_aide_variant(name: &str) -> bool {
    match name.rsplit_once(VARIANT_MARK) {
        Some((base, k)) => !base.is_empty() && k.len() > 1 && k.ends_with('k') && k[..k.len() - 1].chars().all(|c| c.is_ascii_digit()),
        None => false,
    }
}

/// Ответ /api/create: одна JSON-строка (или несколько, если сервер всё же стримит) со статусом либо ошибкой.
fn parse_create_response(text: &str) -> Result<(), String> {
    let mut ok = false;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if let Some(e) = v["error"].as_str() {
            return Err(e.to_string());
        }
        if v["status"].as_str() == Some("success") {
            ok = true;
        }
    }
    if ok {
        Ok(())
    } else {
        Err("Ollama не подтвердил создание модели".into())
    }
}

fn error_text(body: &str, status: reqwest::StatusCode) -> String {
    serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"].as_str().map(String::from)).unwrap_or_else(|| format!("HTTP {status}"))
}

/// Создаёт в Ollama версию модели с большим контекстом (по умолчанию 16K) и возвращает её имя.
#[tauri::command]
pub async fn local_ollama_variant(base_url: String, model: String, num_ctx: Option<u32>) -> Result<String, String> {
    let origin = loopback_origin(&base_url)?;
    if !valid_model_name(&model) {
        return Err("недопустимое имя модели".into());
    }
    if is_aide_variant(&model) {
        return Err("это уже версия, созданная AIDE".into());
    }
    let ctx = num_ctx.unwrap_or(DEFAULT_VARIANT_CTX);
    if !(MIN_VARIANT_CTX..=MAX_VARIANT_CTX).contains(&ctx) || ctx % 1024 != 0 {
        return Err(format!("контекст должен быть от {MIN_VARIANT_CTX} до {MAX_VARIANT_CTX} токенов, кратно 1024"));
    }
    let client = Client::builder().connect_timeout(Duration::from_millis(1500)).build().map_err(|e| e.to_string())?;
    // Больше, чем умеет сама модель, поставить нельзя: Ollama это не отвергнет, но модель начнёт путаться.
    let show = client
        .post(format!("{origin}/api/show"))
        .timeout(PROBE_TIMEOUT)
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|e| format!("Ollama не отвечает: {e}"))?;
    if !show.status().is_success() {
        return Err(format!("Модель «{model}» не найдена в Ollama"));
    }
    let info: Value = show.json().await.map_err(|e| e.to_string())?;
    if let (_, _, Some(max)) = parse_ollama_show(&info) {
        if ctx as u64 > max {
            return Err(format!("Модель поддерживает контекст не больше {max} токенов"));
        }
    }
    let name = variant_name(&model, ctx);
    let resp = client
        .post(format!("{origin}/api/create"))
        .timeout(Duration::from_secs(120))
        .json(&json!({ "model": name, "from": model, "parameters": { "num_ctx": ctx }, "stream": false }))
        .send()
        .await
        .map_err(|e| format!("Ollama не отвечает: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Ollama не создал версию: {}", error_text(&body, status)));
    }
    parse_create_response(&body)?;
    Ok(name)
}

/// Удаляет версию, созданную AIDE (…-aide-16k). Исходная модель и любые чужие модели не затрагиваются.
#[tauri::command]
pub async fn local_ollama_delete_variant(base_url: String, model: String) -> Result<(), String> {
    let origin = loopback_origin(&base_url)?;
    if !valid_model_name(&model) || !is_aide_variant(&model) {
        return Err("Можно удалять только версии, созданные AIDE (имя вида …-aide-16k)".into());
    }
    let client = Client::builder().connect_timeout(Duration::from_millis(1500)).build().map_err(|e| e.to_string())?;
    let resp = client
        .delete(format!("{origin}/api/delete"))
        .timeout(Duration::from_secs(30))
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|e| format!("Ollama не отвечает: {e}"))?;
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    Err(format!("Ollama не удалил версию: {}", error_text(&body, status)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variant_names_and_the_delete_guard() {
        assert_eq!(variant_name("gemma4:12b", 16384), "gemma4:12b-aide-16k");
        assert_eq!(variant_name("llama3", 8192), "llama3-aide-8k");
        for ok in ["gemma4:12b-aide-16k", "x-aide-128k"] {
            assert!(is_aide_variant(ok), "{ok}");
        }
        for bad in ["gemma4:12b", "-aide-16k", "x-aide-k", "x-aide-16", "x-aide-1a6k", "qwen-aide-16k-extra", ""] {
            assert!(!is_aide_variant(bad), "{bad}");
        }
    }

    #[test]
    fn model_names_are_validated() {
        for ok in ["gemma4:12b", "library/llama3.2:3b", "qwen2.5-coder_7b"] {
            assert!(valid_model_name(ok), "{ok}");
        }
        for bad in ["", "-x", ":x", "a b", "a/../b", "a//b", "a;rm", "a\"b", "é", &"a".repeat(121)] {
            assert!(!valid_model_name(bad), "{bad}");
        }
    }

    #[test]
    fn create_response_is_parsed() {
        assert!(parse_create_response("{\"status\":\"success\"}").is_ok());
        assert!(parse_create_response("{\"status\":\"using existing layer\"}\n{\"status\":\"success\"}\n").is_ok());
        assert_eq!(parse_create_response("{\"error\":\"model not found\"}").unwrap_err(), "model not found");
        assert!(parse_create_response("{\"status\":\"creating\"}").is_err());
        assert!(parse_create_response("").is_err());
    }

    #[tokio::test]
    async fn variant_commands_refuse_bad_requests_without_network() {
        let url = "http://127.0.0.1:1/v1".to_string();
        let e = local_ollama_variant("http://example.com/v1".into(), "m".into(), None).await.unwrap_err();
        assert!(!e.is_empty());
        assert!(local_ollama_variant(url.clone(), "m;x".into(), None).await.is_err());
        assert!(local_ollama_variant(url.clone(), "m-aide-16k".into(), None).await.unwrap_err().contains("AIDE"));
        assert!(local_ollama_variant(url.clone(), "m".into(), Some(100)).await.unwrap_err().contains("контекст"));
        assert!(local_ollama_variant(url.clone(), "m".into(), Some(10_000)).await.is_err());
        assert!(local_ollama_delete_variant(url.clone(), "gemma4:12b".into()).await.unwrap_err().contains("AIDE"));
        assert!(local_ollama_delete_variant("http://example.com".into(), "m-aide-16k".into()).await.is_err());
    }

    #[test]
    fn local_provider_ids() {
        assert!(is_local_provider("ollama") && is_local_provider("lmstudio") && is_local_provider("local-llama-cpp"));
        assert!(!is_local_provider("openai") && !is_local_provider("localhost") && !is_local_provider("my-local"));
    }

    #[test]
    fn probe_only_reaches_this_computer() {
        assert_eq!(loopback_origin("http://127.0.0.1:11434/v1").unwrap(), "http://127.0.0.1:11434");
        assert_eq!(loopback_origin("http://localhost:1234/v1/").unwrap(), "http://localhost:1234");
        assert!(loopback_origin("http://[::1]:1234/v1").is_ok());
        for bad in [
            "http://192.168.1.5:11434/v1",
            "http://example.com/v1",
            "http://169.254.169.254/latest",
            "https://127.0.0.1:11434",
            "http://user:pw@127.0.0.1:11434",
            "http://localhost.evil.com/v1",
            "file:///etc/passwd",
            "not a url",
        ] {
            assert!(loopback_origin(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn explains_unreachable_local_server_but_not_remote_errors() {
        let e = explain("ollama", "http://127.0.0.1:11434/v1", "Запрос не удался: error sending request".into());
        assert!(e.starts_with("Локальный сервер не отвечает") && e.contains("Ollama"));
        let lm = explain("lmstudio", "http://127.0.0.1:1234/v1", "Запрос к http://x не удался: boom".into());
        assert!(lm.contains("Start Server"));
        // Не «не удался» (например, 404 «модель не найдена») и не локальный провайдер — без изменений.
        assert_eq!(explain("ollama", "u", "Провайдер ошибка 404: model not found".into()), "Провайдер ошибка 404: model not found");
        assert_eq!(explain("openai", "u", "Запрос не удался: x".into()), "Запрос не удался: x");
    }

    #[test]
    fn parses_ollama_tags_and_show() {
        let tags = json!({ "models": [
            { "name": "qwen3:8b", "size": 5_200_000_000u64, "details": { "parameter_size": "8.2B", "quantization_level": "Q4_K_M" } },
            { "name": "nomic-embed-text:latest", "size": 274_000_000u64, "details": {} },
        ]});
        let loaded: HashSet<String> = ["qwen3:8b".to_string()].into();
        let m = parse_ollama_tags(&tags, &loaded);
        assert_eq!(m.len(), 2);
        assert!(m[0].loaded && !m[1].loaded);
        assert_eq!(m[0].params.as_deref(), Some("8.2B"));
        let show = json!({ "capabilities": ["completion", "tools", "thinking"], "model_info": { "general.architecture": "qwen3", "qwen3.context_length": 40960 } });
        assert_eq!(parse_ollama_show(&show), (Some(true), true, Some(40960)));
        let embed = json!({ "capabilities": ["embedding"] });
        assert_eq!(parse_ollama_show(&embed), (Some(false), false, None));
        // Старый Ollama без поля capabilities: не гадаем.
        assert_eq!(parse_ollama_show(&json!({})), (None, true, None));
    }

    #[test]
    fn running_context_comes_from_ps_not_from_the_model_maximum() {
        let ps = json!({ "models": [{ "name": "gemma4:12b", "size_vram": 3_965_787_830u64, "context_length": 4096 }, { "name": "old:1b" }] });
        let running = parse_ollama_ps(&ps);
        assert_eq!(running.get("gemma4:12b"), Some(&Some(4096)));
        // старый Ollama не сообщает контекст: модель запущена, но длина неизвестна
        assert_eq!(running.get("old:1b"), Some(&None));
        assert!(parse_ollama_ps(&json!({})).is_empty());
    }

    #[test]
    fn parses_lmstudio_models() {
        let v = json!({ "data": [
            { "id": "qwen2.5-coder-7b-instruct", "type": "llm", "state": "loaded", "quantization": "Q4_K_M", "max_context_length": 32768, "loaded_context_length": 4096, "capabilities": ["tool_use"] },
            { "id": "gemma-3-4b", "type": "vlm", "state": "not-loaded", "max_context_length": 131072 },
            { "id": "text-embedding-nomic", "type": "embeddings", "state": "not-loaded" },
        ]});
        let m = parse_lmstudio(&v);
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].loaded, m[0].context, m[0].tools, m[0].context_running), (true, Some(4096), Some(true), true));
        assert_eq!((m[1].loaded, m[1].context, m[1].tools, m[1].context_running), (false, Some(131072), None, false));
    }

    #[test]
    fn empty_key_sends_no_authorization() {
        let c = Client::new();
        let none = bearer(c.get("http://127.0.0.1:1/x"), "").build().unwrap();
        assert!(none.headers().get("authorization").is_none());
        let some = bearer(c.get("http://127.0.0.1:1/x"), "k").build().unwrap();
        assert_eq!(some.headers().get("authorization").unwrap(), "Bearer k");
    }
}
