mod agent_service;
mod ai_service;
mod app_bridge;
mod fs_commands;
mod git_service;
mod kv_store;
mod terminal;
mod browse;
mod browser_view;
mod agent_accounts;
mod browser_viewport;
mod computer;
mod mcp;
mod project_context;
mod skills;
mod skills_remote;
mod checkpoints;
mod speech;
mod ext_host;
mod extensions;
mod web_fetch;
mod verify;
mod lsp;
mod local_models;
mod code_index;

use std::{fs, path::PathBuf, sync::Mutex};

use notify::Watcher;
use tauri::{Emitter, Manager, State};

/// Корень открытого проекта. Все fs-команды проверяют путь против него,
/// чтобы webview не мог трогать файлы вне рабочей области.
#[derive(Default)]
pub struct WorkspaceRoot(pub Mutex<Option<PathBuf>>);

/// Живой watcher открытого проекта (пересоздаётся при открытии новой папки).
#[derive(Default)]
pub struct FsWatcher(pub Mutex<Option<notify::RecommendedWatcher>>);

// События из этих папок не нужны: их тысячи и они только шумят.
const WATCH_IGNORE: [&str; 2] = ["node_modules", ".git"];

#[tauri::command]
fn open_workspace(
    app: tauri::AppHandle,
    root: State<WorkspaceRoot>,
    watcher_state: State<FsWatcher>,
    path: String,
) -> Result<(), String> {
    let canonical = strip_verbatim(PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?);
    if !canonical.is_dir() {
        return Err("Выбранный путь не является папкой".into());
    }

    // Запускаем watcher; старый экземпляр удаляется при записи нового.
    let handle = app.clone();
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            let Ok(event) = res else { return };
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .filter(|p| !WATCH_IGNORE.iter().any(|dir| p.contains(dir)))
                .collect();
            if !paths.is_empty() {
                let _ = handle.emit("fs-change", paths);
            }
        })
        .map_err(|e| e.to_string())?;
    watcher
        .watch(&canonical, notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Photos, videos and PDFs are shown through the asset protocol, which may read ONLY the open project:
    // the previous project is withdrawn from the scope and the new one allowed.
    {
        let scope = app.asset_protocol_scope();
        if let Some(old) = root.0.lock().unwrap().clone() {
            let _ = scope.forbid_directory(&old, true);
        }
        scope.allow_directory(&canonical, true).map_err(|e| e.to_string())?;
    }

    // Другой проект — языковые серверы прошлого больше не нужны.
    let changed = root.0.lock().unwrap().as_ref() != Some(&canonical);
    *root.0.lock().unwrap() = Some(canonical);
    *watcher_state.0.lock().unwrap() = Some(watcher);
    if changed {
        lsp::stop_all(&app);
    }
    Ok(())
}

// canonicalize() на Windows возвращает пути с префиксом \\?\ (verbatim).
// Убираем его, чтобы пути совпадали с тем, что отдаёт notify и видит пользователь.
pub fn strip_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest.to_string())
    } else {
        path
    }
}

const MAX_CHAT_HISTORY_BYTES: usize = 32 * 1024 * 1024;

/// Имя файла истории чата проекта. `scope` приходит из webview, поэтому принимается
/// только в том виде, который строит фронтенд (хеш пути): 1-32 символа [a-z0-9-].
/// Всё остальное — попытка подставить чужой путь — отклоняется, а не чинится.
fn chat_history_file(scope: Option<&str>) -> Result<String, String> {
    let Some(scope) = scope.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok("chat_history.json".into());
    };
    let valid = scope.len() <= 32
        && scope
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err("Некорректный идентификатор проекта".into());
    }
    Ok(format!("chat_history-{scope}.json"))
}

fn chat_history_path(app: &tauri::AppHandle, scope: Option<&str>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Не удалось определить директорию конфигурации: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(chat_history_file(scope)?))
}

#[tauri::command]
fn save_chat_history(
    app: tauri::AppHandle,
    messages: String,
    scope: Option<String>,
) -> Result<(), String> {
    if messages.len() > MAX_CHAT_HISTORY_BYTES {
        return Err("История чата слишком велика для сохранения".into());
    }
    let path = chat_history_path(&app, scope.as_deref())?;
    fs::write(&path, messages).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_chat_history(app: tauri::AppHandle, scope: Option<String>) -> Result<String, String> {
    let path = chat_history_path(&app, scope.as_deref())?;
    if path.exists() {
        return fs::read_to_string(&path).map_err(|e| e.to_string());
    }
    // Один раз переносим общий файл прошлых версий в первый открытый проект:
    // иначе он продолжал бы подмешиваться в чат любого проекта.
    if scope.as_deref().map(str::trim).is_some_and(|s| !s.is_empty()) {
        let legacy = chat_history_path(&app, None)?;
        if legacy.exists() {
            let text = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
            let _ = fs::rename(&legacy, &path);
            return Ok(text);
        }
    }
    Ok("[]".into())
}

#[derive(serde::Serialize)]
struct CliToolInfo {
    id: String,
    name: String,
    kind: String,
    api_key: Option<String>,
    base_url: Option<String>,
    auth: String,
    model: Option<String>,
}

#[tauri::command]
fn detect_cli_tools() -> Vec<CliToolInfo> {
    let mut tools = Vec::new();
    let home = dirs().unwrap_or_default();
    let appdata = std::env::var("APPDATA").ok().map(PathBuf::from);

    // Codex (OpenAI CLI) — ~/.codex/auth.json, ~/.codex/config.toml
    let codex_dirs = [home.join(".codex"), home.join(".config").join("codex")];
    let mut codex_key = None;
    for codex_dir in &codex_dirs {
        if codex_dir.exists() {
            codex_key = read_codex_key(codex_dir);
            if codex_key.is_some() {
                break;
            }
        }
    }
    tools.push(CliToolInfo {
        id: "codex".into(),
        name: "Codex (OpenAI)".into(),
        kind: "openai".into(),
        api_key: codex_key,
        base_url: Some("https://api.openai.com/v1".into()),
        auth: "key".into(),
        model: None,
    });

    // OpenCode — config opencode.json[c] (provider base URLs) + auth.json (keys)
    let mut opencode_dirs: Vec<PathBuf> = vec![
        home.join(".opencode"),
        home.join(".local").join("share").join("opencode"),
        home.join(".config").join("opencode"),
    ];
    if let Some(ap) = &appdata {
        opencode_dirs.push(ap.join("opencode"));
    }
    let mut cfg: Option<serde_json::Value> = None;
    let mut auth: Option<serde_json::Value> = None;
    let mut opencode_installed = false;
    for dir in &opencode_dirs {
        if !dir.exists() {
            continue;
        }
        opencode_installed = true;
        if cfg.is_none() {
            for f in [dir.join("opencode.jsonc"), dir.join("opencode.json")] {
                if let Some(v) = parse_jsonc(&f) {
                    cfg = Some(v);
                    break;
                }
            }
        }
        if auth.is_none() {
            let f = dir.join("auth.json");
            if let Ok(content) = fs::read_to_string(&f) {
                auth = serde_json::from_str(&content).ok();
            }
        }
    }
    // OpenCode Zen — opencode's built-in provider; free models work with a "public" key
    let zen_key = auth
        .as_ref()
        .and_then(|a| a.get("opencode"))
        .and_then(|e| {
            if e.get("type").and_then(|t| t.as_str()) == Some("api") {
                e.get("key").and_then(|k| k.as_str())
            } else {
                None
            }
        })
        .map(String::from)
        .unwrap_or_else(|| "public".to_string());
    if let (Some(cfg), Some(auth)) = (cfg, auth) {
        let auth_obj = auth.as_object();
        if let Some(providers) = cfg.get("provider").and_then(|p| p.as_object()) {
            for (pid, pcfg) in providers {
                let base = pcfg
                    .pointer("/options/baseURL")
                    .or_else(|| pcfg.pointer("/options/baseUrl"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim_end_matches('/').to_string());
                let name = pcfg
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(pid)
                    .to_string();
                let model = pcfg
                    .get("models")
                    .and_then(|m| m.as_object())
                    .and_then(|m| m.keys().next())
                    .cloned();
                let kind = match pcfg
                    .get("npm")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                {
                    s if s.contains("anthropic") => "anthropic",
                    s if s.contains("google") => "google",
                    _ => "openai",
                };
                let key = auth_obj.and_then(|o| o.get(pid)).and_then(|e| {
                    if e.get("type").and_then(|t| t.as_str()) == Some("api") {
                        e.get("key").and_then(|k| k.as_str()).map(String::from)
                    } else {
                        None
                    }
                });
                if let (Some(base), Some(key)) = (base, key) {
                    tools.push(CliToolInfo {
                        id: format!("opencode-{pid}"),
                        name: format!("OpenCode · {name}"),
                        kind: kind.into(),
                        api_key: Some(key),
                        base_url: Some(base),
                        auth: "key".into(),
                        model,
                    });
                }
            }
        }
    }

    if opencode_installed {
        tools.push(CliToolInfo {
            id: "opencode".into(),
            name: "OpenCode Zen".into(),
            kind: "openai".into(),
            api_key: Some(zen_key),
            base_url: Some("https://opencode.ai/zen/v1".into()),
            auth: "key".into(),
            model: None,
        });
    }

    tools
}

fn parse_jsonc(path: &PathBuf) -> Option<serde_json::Value> {
    let content = fs::read_to_string(path).ok()?;
    let bytes = content.as_bytes();
    let mut out = String::with_capacity(content.len());
    let mut i = 0;
    let mut in_str = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            out.push(c as char);
            if c == b'\\' && i + 1 < bytes.len() {
                out.push(bytes[i + 1] as char);
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == b'"' {
            in_str = true;
            out.push('"');
            i += 1;
            continue;
        }
        if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    serde_json::from_str(&out).ok()
}

fn dirs() -> Option<PathBuf> {
    dirs_next::home_dir()
}

fn read_json_key(path: &PathBuf, keys: &[&str]) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let mut current = &v;
    for key in keys {
        current = current.get(*key)?;
    }
    match current {
        serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn read_codex_key(dir: &PathBuf) -> Option<String> {
    // auth.json: { "OPENAI_API_KEY": "sk-...", "tokens": { ... } }
    let auth = dir.join("auth.json");
    for keys in [
        &["OPENAI_API_KEY"][..],
        &["api_key"][..],
        &["openai_api_key"][..],
    ] {
        if let Some(key) = read_json_key(&auth, keys) {
            return Some(key);
        }
    }
    // config.toml: api_key = "sk-..."
    for cfg in [dir.join("config.toml"), dir.join("config.json")] {
        if let Some(key) = read_toml_key(&cfg, "api_key") {
            return Some(key);
        }
    }
    None
}

fn read_toml_key(path: &PathBuf, key: &str) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start_matches('=').trim();
            let rest = rest.trim_matches('"').trim_matches('\'');
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(WorkspaceRoot::default())
        .manage(FsWatcher::default())
        .manage(ai_service::AiCancels::default())
        .manage(terminal::Terminal::default())
        .manage(terminal::PermissionRequests::default())
        .manage(terminal::QuestionRequests::default())
        .manage(browser_view::BrowserTabs::default())
        .manage(kv_store::KvLock::default())
        .manage(mcp::McpState::default())
        .manage(app_bridge::AppBridge::default())
        .manage(checkpoints::Checkpoints::default())
        .manage(lsp::LspState::default())
        .manage(code_index::CodeIndexState::default())
        .manage(ext_host::HostState::default())
        .manage(ext_host::WebviewHtml::default())
        .register_uri_scheme_protocol("aideext", ext_host::serve_webview)
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            fs_commands::list_dir,
            fs_commands::read_file,
            fs_commands::write_file,
            fs_commands::create_entry,
            fs_commands::delete_entry,
            fs_commands::delete_entries,
            fs_commands::trash_entries,
            fs_commands::rename_entry,
            fs_commands::search_project,
            fs_commands::git_branch,
            git_service::git_status,
            git_service::git_show,
            git_service::git_stage,
            git_service::git_unstage,
            git_service::git_discard,
            git_service::git_commit,
            git_service::git_diff_file,
            git_service::git_log,
            git_service::git_branches,
            git_service::git_checkout,
            ai_service::chat,
            ai_service::list_models,
            ai_service::cancel_chat,
            agent_service::agent_chat,
            ai_service::set_api_key,
            ai_service::get_api_key,
            ai_service::delete_api_key,
            save_chat_history,
            load_chat_history,
            kv_store::kv_load,
            checkpoints::agent_undo,
            project_context::memory_get,
            project_context::memory_set,
            mcp::mcp_list,
            mcp::mcp_save,
            mcp::mcp_remove,
            mcp::mcp_set_enabled,
            mcp::mcp_restart,
            speech::stt_has_key,
            speech::stt_save_key,
            speech::stt_clear_key,
            speech::stt_transcribe,
            browser_view::bv_open,
            browser_view::bv_bounds,
            browser_view::bv_info,
            browser_view::bv_visible,
            browser_view::bv_navigate,
            browser_view::bv_action,
            browser_view::bv_close,
            browser_view::bv_devtools,
            browser_view::bv_console,
            browser_view::bv_eval,
            browser_view::bv_screenshot_cmd,
            browser_view::bv_tabs,
            browser_view::bv_activate,
            browser_view::bv_close_tab,
            browser_view::bv_snapshot,
            browser_view::bv_viewport,
            browser_view::bv_viewport_get,
            ext_host::exthost_info,
            ext_host::ext_trust_list,
            ext_host::ext_trust_set,
            ext_host::exthost_extensions,
            ext_host::exthost_start,
            ext_host::exthost_send,
            ext_host::exthost_stop,
            ext_host::webview_set_html,
            ext_host::webview_drop,
            extensions::ext_search,
            extensions::ext_install,
            extensions::ext_list,
            extensions::ext_remove,
            extensions::ext_read,
            kv_store::kv_save,
            web_fetch::fetch_site,
            skills::skills_list,
            skills::skills_set_enabled,
            skills::skills_read,
            skills::skills_remove,
            skills_remote::skills_search,
            skills_remote::skills_parse_input,
            skills_remote::skills_repo,
            skills_remote::skills_preview,
            skills_remote::skills_install,
            detect_cli_tools,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_kill,
            terminal::terminal_resize,
            terminal::terminal_shells,
            terminal::respond_permission,
            terminal::respond_question,
            app_bridge::app_bridge_reply,
            local_models::local_probe,
            agent_accounts::scan_agent_accounts,
            agent_accounts::list_agent_keys,
            agent_accounts::import_agent_key,
            agent_accounts::list_agent_models,
            local_models::local_ollama_variant,
            local_models::local_ollama_delete_variant,
            code_index::code_index_status,
            code_index::code_index_rebuild,
            code_index::code_index_search,
            code_index::code_index_symbols,
            lsp::lsp_servers,
            lsp::lsp_for_path,
            lsp::lsp_path_for_uri,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
        ])
        .setup(|app| {
            mcp::autostart(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            terminal::kill_on_exit(app_handle);
            lsp::stop_all(app_handle);
            mcp::kill_all(app_handle);
        }
    });
}
