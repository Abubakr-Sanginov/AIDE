//! Контекст для агента: правила проекта (AGENTS.md, CLAUDE.md в корне открытой папки) и личная
//! «память» пользователя (заметки о предпочтениях в папке данных приложения).
//!
//! Файлы читаются заново на каждый запрос, только из рабочей области (та же проверка границ, что у
//! инструментов), с лимитом размера. Это инструкции владельца проекта, но не команды выше защиты:
//! агент по-прежнему работает через гейт разрешений и откат правок.

use std::fs;

use tauri::{AppHandle, Manager};

const MAX_RULES_CHARS: usize = 12_000;
const MAX_MEMORY_CHARS: usize = 20_000;
const RULE_FILES: [&str; 2] = ["AGENTS.md", "CLAUDE.md"];

fn memory_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.join("memory.md"))
}

#[tauri::command]
pub fn memory_get(app: AppHandle) -> String {
    memory_path(&app).ok().and_then(|p| fs::read_to_string(p).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn memory_set(app: AppHandle, text: String) -> Result<(), String> {
    if text.chars().count() > MAX_MEMORY_CHARS {
        return Err(format!("Память: не больше {MAX_MEMORY_CHARS} символов"));
    }
    fs::write(memory_path(&app)?, text).map_err(|e| e.to_string())
}

/// Обрезает текст до лимита по границе строки и говорит, что он сокращён.
pub(crate) fn cut_with_note(text: &str, limit: usize, what: &str) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let head: String = text.chars().take(limit).collect();
    let head = match head.rfind('\n') {
        Some(i) if i > limit / 2 => head[..i].to_string(),
        _ => head,
    };
    format!("{head}
…[{what} сокращены для экономии контекста; при необходимости прочитай файл целиком через read_file]")
}

/// Собирает дополнение к промпту: память и правила проекта, каждое не длиннее своего лимита.
pub(crate) fn build_extra(memory: &str, rules: &[(&str, String)], memory_limit: usize, rules_limit: usize) -> String {
    let mut out = String::new();
    if !memory.trim().is_empty() {
        out.push_str("

Память пользователя (его заметки и предпочтения):
");
        out.push_str(&cut_with_note(memory, memory_limit, "заметки"));
    }
    for (name, text) in rules {
        out.push_str(&format!("

Правила проекта ({name}, их написал владелец проекта; следуй им в рамках задачи):
"));
        out.push_str(&cut_with_note(text, rules_limit, "правила"));
    }
    out
}

fn extra_prompt_limited(app: &AppHandle, memory_limit: usize, rules_limit: usize) -> String {
    let memory = memory_get(app.clone());
    let mut rules: Vec<(&str, String)> = Vec::new();
    if let Ok(root) = crate::fs_commands::workspace_root(&app.state::<crate::WorkspaceRoot>()) {
        for name in RULE_FILES {
            let Ok(p) = crate::fs_commands::resolve_existing(&root, name) else { continue };
            let Ok(text) = fs::read_to_string(&p) else { continue };
            if !text.trim().is_empty() {
                rules.push((name, text));
            }
        }
    }
    build_extra(&memory, &rules, memory_limit, rules_limit)
}

/// Текст, который добавляется к системному промпту агента.
pub fn extra_prompt(app: &AppHandle) -> String {
    extra_prompt_limited(app, MAX_MEMORY_CHARS, MAX_RULES_CHARS)
}

/// То же для небольших моделей с маленьким контекстом (локальные Ollama и LM Studio): правила и память короче.
pub fn extra_prompt_compact(app: &AppHandle) -> String {
    extra_prompt_limited(app, 1_200, 2_500)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_kept_as_is() {
        assert_eq!(cut_with_note("abc", 10, "правила"), "abc");
    }

    #[test]
    fn long_text_is_cut_on_a_line_boundary_with_a_note() {
        let text = (1..=200).map(|i| format!("rule number {i}")).collect::<Vec<_>>().join("
");
        let cut = cut_with_note(&text, 300, "правила");
        let body = cut.split("
…[").next().unwrap();
        assert!(body.chars().count() <= 300);
        assert!(body.ends_with(|c: char| c.is_ascii_digit()), "режем по целой строке: {body}");
        assert!(cut.contains("правила сокращены") && cut.contains("read_file"));
        // кириллица режется по символам, а не по байтам
        let ru = "я".repeat(500);
        assert!(cut_with_note(&ru, 100, "заметки").starts_with(&"я".repeat(100)));
    }

    #[test]
    fn extra_prompt_respects_both_limits() {
        let rules = vec![("AGENTS.md", "x
".repeat(5000))];
        let full = build_extra(&"m
".repeat(5000), &rules, 20_000, 12_000);
        let compact = build_extra(&"m
".repeat(5000), &rules, 1_200, 2_500);
        // Лимиты считаются в символах, а не в байтах (кириллица — два байта на символ).
        assert!(full.chars().count() > 9_000);
        assert!(compact.chars().count() < 4_200, "{}", compact.chars().count());
        assert!(compact.contains("Правила проекта (AGENTS.md") && compact.contains("Память пользователя"));
        assert_eq!(build_extra("", &[], 10, 10), "");
    }
}
