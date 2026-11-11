//! Мост «агент → интерфейс AIDE». Инструменты `app_state`, `app_navigate` и `design_control`
//! выполняются во фронтенде (там живут сторы дизайна, вкладок и панелей), а Rust только
//! доставляет вызов, ждёт ответ и отдаёт его модели. Этот мост пользуются и обычный агент,
//! и роли экипажа Kins: у них один и тот же бэкенд агента.
//!
//! Безопасность: аргументы приходят от модели и считаются недоверенными. Фронтенд проверяет
//! их сам (пути только внутри проекта, HTML дизайна проходит санитайзер). Действия, которые
//! пишут файлы на диск, подтверждаются так же, как запись файлов (см. `needs_confirmation`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

const REPLY_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_REPLY_CHARS: usize = 12_000;

type Reply = Result<String, String>;

#[derive(Default)]
pub struct AppBridge(Mutex<HashMap<String, oneshot::Sender<Reply>>>);

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn is_bridge_tool(name: &str) -> bool {
    matches!(name, "app_state" | "app_navigate" | "design_control")
}

/// Действия, которые пишут на диск или необратимы. Остальное (смена панели, правка макета)
/// обратимо: макет откатывается через undo, панели переключаются обратно.
pub fn needs_confirmation(name: &str, args: &Value) -> bool {
    name == "design_control"
        && matches!(
            args.get("action").and_then(Value::as_str),
            Some("save_to_project")
        )
}

/// Отправляет вызов во фронтенд и ждёт ответ.
pub async fn call(app: &AppHandle, name: &str, args: &Value) -> Result<String, String> {
    let id = format!("ab{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel::<Reply>();
    app.state::<AppBridge>().0.lock().unwrap().insert(id.clone(), tx);
    if app
        .emit("app-bridge", json!({ "id": id, "tool": name, "args": args }))
        .is_err()
    {
        app.state::<AppBridge>().0.lock().unwrap().remove(&id);
        return Err("Не удалось передать команду интерфейсу".into());
    }
    match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
        Ok(Ok(reply)) => reply.map(|t| t.chars().take(MAX_REPLY_CHARS).collect()),
        Ok(Err(_)) => Err("Интерфейс не ответил на команду".into()),
        Err(_) => {
            app.state::<AppBridge>().0.lock().unwrap().remove(&id);
            Err("Интерфейс не ответил за 45 секунд (окно AIDE открыто?)".into())
        }
    }
}

/// Ответ фронтенда на вызов моста.
#[tauri::command]
pub fn app_bridge_reply(bridge: State<AppBridge>, id: String, ok: bool, text: String) -> Result<(), String> {
    if let Some(tx) = bridge.0.lock().unwrap().remove(&id) {
        let _ = tx.send(if ok { Ok(text) } else { Err(text) });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_tool_names_are_recognised() {
        for n in ["app_state", "app_navigate", "design_control"] {
            assert!(is_bridge_tool(n));
        }
        assert!(!is_bridge_tool("write_file"));
        assert!(!is_bridge_tool("browser_eval"));
    }

    #[test]
    fn only_disk_writing_design_actions_need_confirmation() {
        assert!(needs_confirmation("design_control", &json!({ "action": "save_to_project" })));
        assert!(!needs_confirmation("design_control", &json!({ "action": "set_html" })));
        assert!(!needs_confirmation("design_control", &json!({ "action": "undo" })));
        assert!(!needs_confirmation("app_navigate", &json!({ "mode": "design" })));
        assert!(!needs_confirmation("design_control", &json!({})));
    }
}
