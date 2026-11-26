//! Журнал действий режима «Компьютер»: что агент делал мышью и клавиатурой, когда и чем закончилось.
//!
//! Нужен, чтобы человек мог разобраться, что именно двигало курсор и нажимало клавиши (особенно когда агент работал
//! без присмотра). Хранится только у вас на компьютере; введённый текст в журнал не попадает (только его длина),
//! у ссылок отбрасывается всё после «?»; последние 500 записей.

use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_ENTRIES: usize = 500;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    /// Unix-время, мс.
    pub ts: i64,
    pub tool: String,
    pub summary: String,
    pub ok: bool,
    /// Причина, если действие не удалось.
    pub note: String,
}

static LOG: Mutex<Option<VecDeque<Entry>>> = Mutex::new(None);

fn path() -> Option<PathBuf> {
    dirs_next::data_dir().map(|d| d.join("dev.aide.app").join("computer-log.jsonl"))
}

/* ───────────── чистая логика ───────────── */

fn cut(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    if s.chars().count() > n { format!("{t}…") } else { t }
}

/// Ссылка без параметров и фрагмента: в них бывают токены.
fn strip_query(target: &str) -> String {
    target.split(['?', '#']).next().unwrap_or("").to_string()
}

/// Короткое описание действия для журнала. Введённый текст не записывается, только его длина.
pub fn summarize(tool: &str, args: &Value) -> String {
    let num = |k: &str| args.get(k).and_then(Value::as_f64).map(|v| v.round() as i64);
    let text = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("");
    let at = |xk: &str, yk: &str| match (num(xk), num(yk)) {
        (Some(x), Some(y)) => format!("({x}, {y})"),
        _ => "(?)".into(),
    };
    match tool {
        "computer_screenshot" => "снимок экрана".into(),
        "computer_wait" => format!("пауза {} с", args.get("seconds").and_then(Value::as_f64).unwrap_or(1.0)),
        "computer_windows" => "список окон".into(),
        "computer_focus_window" => format!("окно «{}» вперёд", cut(text("title"), 60)),
        "computer_move" => format!("курсор в {}", at("x", "y")),
        "computer_click" => {
            let button = args.get("button").and_then(Value::as_str).unwrap_or("left");
            let count = args.get("count").and_then(Value::as_u64).unwrap_or(1);
            format!("клик {button} ×{count} в {}", at("x", "y"))
        }
        "computer_drag" => format!("перетаскивание {} → {}", at("x", "y"), at("to_x", "to_y")),
        "computer_scroll" => format!("прокрутка в {} (dx={}, dy={})", at("x", "y"), num("dx").unwrap_or(0), num("dy").unwrap_or(0)),
        "computer_type" => format!("ввод текста, {} симв.", text("text").chars().count()),
        "computer_key" => format!("клавиши {}", cut(text("keys"), 40)),
        "computer_open" => {
            let target = crate::computer::open_arg(args).unwrap_or("");
            format!("запуск {}", cut(&strip_query(target), 120))
        }
        other => cut(other, 40),
    }
}

/* ───────────── хранение ───────────── */

fn load() -> VecDeque<Entry> {
    let Some(p) = path() else { return VecDeque::new() };
    let Ok(text) = fs::read_to_string(p) else { return VecDeque::new() };
    let mut out: VecDeque<Entry> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    while out.len() > MAX_ENTRIES {
        out.pop_front();
    }
    out
}

fn with_log<T>(f: impl FnOnce(&mut VecDeque<Entry>) -> T) -> T {
    let mut g = LOG.lock().unwrap();
    let log = g.get_or_insert_with(load);
    f(log)
}

/// Записывает результат действия агента.
pub fn record(tool: &str, summary: String, result: &Result<(String, Vec<crate::agent_service::AiScreenshot>), String>) {
    let entry = Entry {
        ts: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0),
        tool: tool.to_string(),
        summary,
        ok: result.is_ok(),
        note: result.as_ref().err().map(|e| cut(e, 160)).unwrap_or_default(),
    };
    let line = serde_json::to_string(&entry).unwrap_or_default();
    let trim = with_log(|log| {
        log.push_back(entry);
        let over = log.len() > MAX_ENTRIES;
        while log.len() > MAX_ENTRIES {
            log.pop_front();
        }
        over.then(|| log.iter().filter_map(|e| serde_json::to_string(e).ok()).collect::<Vec<_>>().join("\n") + "\n")
    });
    let Some(p) = path() else { return };
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match trim {
        // Файл разросся: переписываем его последними записями.
        Some(all) => {
            let _ = fs::write(&p, all);
        }
        None => {
            if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&p) {
                let _ = writeln!(f, "{line}");
            }
        }
    }
}

#[tauri::command]
pub fn computer_log_list(limit: Option<usize>) -> Vec<Entry> {
    let n = limit.unwrap_or(200).clamp(1, MAX_ENTRIES);
    with_log(|log| log.iter().rev().take(n).cloned().collect())
}

#[tauri::command]
pub fn computer_log_clear() -> Result<(), String> {
    with_log(|log| log.clear());
    if let Some(p) = path() {
        if p.exists() {
            fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn typed_text_never_reaches_the_log_only_its_length() {
        let s = summarize("computer_type", &json!({"text": "мой пароль 12345"}));
        assert_eq!(s, "ввод текста, 16 симв.");
        assert!(!s.contains("пароль") && !s.contains("12345"));
    }

    #[test]
    fn summaries_say_what_and_where() {
        assert_eq!(summarize("computer_click", &json!({"x": 100.4, "y": 200.6, "button": "right", "count": 2})), "клик right ×2 в (100, 201)");
        assert_eq!(summarize("computer_click", &json!({"x": 5, "y": 6})), "клик left ×1 в (5, 6)");
        assert_eq!(summarize("computer_drag", &json!({"x": 1, "y": 2, "to_x": 3, "to_y": 4})), "перетаскивание (1, 2) → (3, 4)");
        assert_eq!(summarize("computer_key", &json!({"keys": "ctrl+s"})), "клавиши ctrl+s");
        assert_eq!(summarize("computer_screenshot", &json!({})), "снимок экрана");
        assert_eq!(summarize("computer_click", &json!({})), "клик left ×1 в (?)");
        assert!(summarize("computer_focus_window", &json!({"title": "я".repeat(200)})).chars().count() < 80);
    }

    #[test]
    fn links_lose_their_query_and_fragment() {
        let s = summarize("computer_open", &json!({"target": "https://x.example/path?token=SECRET#frag"}));
        assert_eq!(s, "запуск https://x.example/path");
        assert!(!s.contains("SECRET"));
        assert_eq!(summarize("computer_open", &json!({"app_name": "Telegram"})), "запуск Telegram");
    }

    #[test]
    fn long_text_is_cut_with_an_ellipsis() {
        assert_eq!(cut("abc", 5), "abc");
        assert_eq!(cut("abcdef", 3), "abc…");
    }
}
