//! Инструмент `update_plan`: план работы агента.
//!
//! Для сложной задачи агент сначала записывает короткий план, а по ходу работы отмечает шаги выполненными.
//! Инструмент ничего не меняет на компьютере: он проверяет шаги и возвращает их в виде строк «[x] / [~] / [ ]»,
//! которые интерфейс показывает в чате и во вкладке «Контекст». Шаги — текст модели, поэтому они чистятся и ограничиваются.

use serde_json::Value;

pub const MAX_STEPS: usize = 12;
const MAX_STEP_CHARS: usize = 140;

#[derive(Debug, PartialEq, Clone, Copy)]
enum Status {
    Pending,
    Active,
    Done,
}

fn status_of(raw: Option<&str>) -> Status {
    match raw.map(|s| s.trim().to_lowercase()).as_deref() {
        Some("done" | "completed" | "complete" | "x") => Status::Done,
        Some("in_progress" | "active" | "doing" | "current") => Status::Active,
        _ => Status::Pending,
    }
}

fn clean(text: &str) -> String {
    let flat: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(MAX_STEP_CHARS).collect()
}

/// Список шагов из аргументов. Слабые модели присылают его по-разному: под другим именем (plan, items, tasks, todos),
/// строкой с JSON внутри или самим массивом без обёртки, поэтому понимаем всё это, а не отвечаем ошибкой.
fn steps_of(args: &Value) -> Option<Vec<Value>> {
    fn as_list(v: &Value, depth: u8) -> Option<Vec<Value>> {
        match v {
            Value::Array(a) => Some(a.clone()),
            Value::String(s) if depth < 2 => serde_json::from_str::<Value>(s.trim()).ok().and_then(|inner| as_list(&inner, depth + 1)),
            Value::Object(o) if depth < 2 => ["steps", "plan", "items", "tasks", "todos"].iter().find_map(|k| o.get(*k)).and_then(|inner| as_list(inner, depth + 1)),
            _ => None,
        }
    }
    as_list(args, 0)
}

/// Остались ли в результате `update_plan` невыполненные шаги (строки «[ ]» или «[~]»).
pub fn has_pending(result: &str) -> bool {
    result.lines().any(|l| l.starts_with("[ ] ") || l.starts_with("[~] "))
}

/// Ответ без вызова инструмента, который лишь объявляет следующее действие («Проверю файл и соберу таймлайн.»):
/// работа на самом деле не закончена. Смотрим на последнюю строку: короткая, не вопрос и без слов о завершении.
pub fn announces_action(text: &str) -> bool {
    let Some(last) = text.lines().map(str::trim).rev().find(|l| !l.is_empty()) else { return false };
    if last.chars().count() > 300 || last.ends_with('?') || last.ends_with("```") {
        return false;
    }
    let l = last.to_lowercase();
    const DONE: [&str; 12] = ["готово", "сделано", "выполнено", "завершено", "завершил", "завершила", "исправил", "добавил", "создал", "done", "completed", "finished"];
    if DONE.iter().any(|w| l.contains(w)) {
        return false;
    }
    // Только глаголы будущего времени от первого лица: «сейчас», «теперь», «далее» бывают и в рассказе о готовом.
    const FUTURE: [&str; 17] = [
        "проверю", "соберу", "сделаю", "добавлю", "запущу", "исправлю", "создам", "начну", "напишу", "изменю", "обновлю", "прочитаю",
        "посмотрю", "открою", "i'll ", "i will ", "let me ",
    ];
    l.ends_with(':') || FUTURE.iter().any(|w| l.contains(w))
}

/// Проверяет аргументы и возвращает текст результата: заголовок и по строке на шаг.
pub fn run(args: &Value) -> Result<String, String> {
    let steps = steps_of(args).ok_or("не хватает массива «steps»: передай {\"steps\": [{\"text\": \"…\", \"status\": \"pending\"}, …]}")?;
    let steps = &steps;
    if steps.is_empty() {
        return Err("План пуст: укажи хотя бы один шаг".into());
    }
    if steps.len() > MAX_STEPS {
        return Err(format!("В плане не больше {MAX_STEPS} шагов: объедини мелкие"));
    }
    let mut parsed: Vec<(Status, String)> = Vec::new();
    for s in steps {
        let (text, status) = match s {
            Value::String(t) => (clean(t), Status::Pending),
            Value::Object(o) => (clean(o.get("text").and_then(Value::as_str).unwrap_or("")), status_of(o.get("status").and_then(Value::as_str))),
            _ => return Err("Шаг плана — строка или объект {text, status}".into()),
        };
        if text.is_empty() {
            return Err("У шага плана пустой текст".into());
        }
        parsed.push((status, text));
    }
    // Одновременно в работе один шаг: лишние «в процессе» возвращаются в ожидание.
    let mut seen_active = false;
    for (st, _) in parsed.iter_mut() {
        if *st == Status::Active {
            if seen_active {
                *st = Status::Pending;
            }
            seen_active = true;
        }
    }
    let done = parsed.iter().filter(|(s, _)| *s == Status::Done).count();
    let mut out = format!("План обновлён: {done}/{} выполнено.", parsed.len());
    for (st, text) in &parsed {
        let mark = match st {
            Status::Done => "[x]",
            Status::Active => "[~]",
            Status::Pending => "[ ]",
        };
        out.push('\n');
        out.push_str(mark);
        out.push(' ');
        out.push_str(text);
    }
    if done == parsed.len() {
        out.push_str("\nВсе шаги выполнены: можно давать итоговый ответ.");
    } else {
        out.push_str("\nПродолжай по плану; после каждого шага вызывай update_plan с новыми статусами.");
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_plan_is_returned_as_marked_lines() {
        let r = run(&json!({ "steps": [
            { "text": "Прочитать Menu.tsx", "status": "done" },
            { "text": "Добавить карточки", "status": "in_progress" },
            { "text": "Запустить тесты" },
        ] }))
        .unwrap();
        let lines: Vec<&str> = r.lines().collect();
        assert_eq!(lines[0], "План обновлён: 1/3 выполнено.");
        assert_eq!(&lines[1..4], ["[x] Прочитать Menu.tsx", "[~] Добавить карточки", "[ ] Запустить тесты"]);
        assert!(lines[4].contains("update_plan"));
    }

    #[test]
    fn finished_plan_says_so_and_plain_strings_work() {
        let r = run(&json!({ "steps": [{ "text": "a", "status": "completed" }, { "text": "b", "status": "x" }] })).unwrap();
        assert!(r.contains("2/2") && r.contains("итоговый ответ"));
        let r = run(&json!({ "steps": ["один", "два"] })).unwrap();
        assert!(r.contains("[ ] один") && r.contains("0/2"));
    }

    #[test]
    fn only_one_step_stays_in_progress() {
        let r = run(&json!({ "steps": [{ "text": "a", "status": "active" }, { "text": "b", "status": "doing" }] })).unwrap();
        assert_eq!(r.matches("[~]").count(), 1);
        assert!(r.contains("[ ] b"));
    }

    #[test]
    fn sloppy_arguments_are_understood() {
        // под другим именем, строкой с JSON, обёрнутым в объект, самим массивом
        for args in [
            json!({ "plan": [{ "text": "a" }, { "text": "b", "status": "done" }] }),
            json!({ "steps": "[{\"text\": \"a\"}, {\"text\": \"b\", \"status\": \"done\"}]" }),
            json!({ "steps": { "items": [{ "text": "a" }, { "text": "b", "status": "done" }] } }),
            json!([{ "text": "a" }, { "text": "b", "status": "done" }]),
            json!("[{\"text\": \"a\"}, {\"text\": \"b\", \"status\": \"done\"}]"),
        ] {
            let r = run(&args).unwrap_or_else(|e| panic!("{args}: {e}"));
            assert!(r.contains("1/2") && r.contains("[ ] a") && r.contains("[x] b"), "{args}: {r}");
        }
        assert!(run(&json!({ "steps": "not json" })).is_err());
        assert!(run(&json!(5)).is_err());
        // у ошибки есть подсказка с правильной формой
        assert!(run(&json!({})).unwrap_err().contains("steps"));
    }

    #[test]
    fn unfinished_plans_are_detected_in_the_result() {
        assert!(has_pending("План обновлён: 1/3 выполнено.\n[x] a\n[~] b\n[ ] c"));
        assert!(has_pending("План обновлён: 2/3 выполнено.\n[x] a\n[x] b\n[ ] c"));
        assert!(!has_pending("План обновлён: 2/2 выполнено.\n[x] a\n[x] b\nВсе шаги выполнены: можно давать итоговый ответ."));
        assert!(!has_pending("ОШИБКА: план пуст"));
    }

    #[test]
    fn an_announced_action_without_a_tool_call_is_noticed() {
        // фраза из жизни: модель пообещала и остановилась
        assert!(announces_action("Проверю текущий файл и соберу непрерывный таймлайн с автопереключением клипов."));
        assert!(announces_action("Нашёл проблему. Исправлю её сейчас:"));
        assert!(announces_action("Хорошо.\n\nI'll update the config next."));
        assert!(announces_action("Let me check the file first"));
        // итог, вопрос, длинный абзац и пустота — не обещание
        assert!(!announces_action("Готово: добавил карточки, тесты проходят."));
        assert!(!announces_action("Какой стиль выбрать?"));
        assert!(!announces_action("Теперь всё работает, проверено на трёх экранах."));
        assert!(!announces_action(&format!("{} проверю", "слово ".repeat(80))));
        assert!(!announces_action(""));
        assert!(!announces_action("Результат:\n\n```\nok\n```"));
    }

    #[test]
    fn bad_plans_are_refused_and_text_is_cleaned() {
        assert!(run(&json!({})).is_err());
        assert!(run(&json!({ "steps": [] })).is_err());
        assert!(run(&json!({ "steps": [{ "text": "   " }] })).is_err());
        assert!(run(&json!({ "steps": [5] })).is_err());
        let many: Vec<Value> = (0..13).map(|i| json!(format!("шаг {i}"))).collect();
        assert!(run(&json!({ "steps": many })).is_err());
        // переводы строк и управляющие символы не ломают строки результата, длина ограничена
        let r = run(&json!({ "steps": [{ "text": format!("первая\nстрока\u{0}{}", "я".repeat(500)) }] })).unwrap();
        let body = r.lines().nth(1).unwrap();
        assert!(body.starts_with("[ ] первая строка") && body.chars().count() <= 4 + MAX_STEP_CHARS);
        assert_eq!(r.lines().filter(|l| l.starts_with("[ ]")).count(), 1);
    }
}
