//! Самопроверка агента: после правок AIDE сам запускает быстрые проверки проекта (типы, линтер, тесты,
//! cargo check, …), а если они падают — возвращает ошибки модели, чтобы она их исправила.
//! Так даже слабая модель не сдаёт работу, которая не компилируется.
//!
//! Что запускать:
//! 1. `.aide/checks.json` в проекте: `{ "commands": ["npm run lint"], "timeoutSeconds": 300 }`
//!    (или `{ "enabled": false }`, чтобы отключить проверки для проекта);
//! 2. иначе — автоопределение по изменённым файлам и проекту (package.json, tsconfig, Cargo.toml, go.mod, .py).
//!
//! Безопасность: команды из проекта — недоверенные. Перед запуском всегда спрашиваем пользователя
//! (кроме режима «Свобода»), показывая команды целиком; в команды не подставляются имена файлов,
//! кроме строго проверенных путей.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

/// Сколько раз за один запрос можно запустить проверки (между ними модель исправляет ошибки).
pub const MAX_ROUNDS: u32 = 4;
const DEFAULT_TIMEOUT_SECS: u64 = 300;
const MAX_TIMEOUT_SECS: u64 = 900;
const MAX_COMMANDS: usize = 6;
const MAX_COMMAND_LEN: usize = 300;
const MAX_PY_FILES: usize = 20;
/// Сколько вывода одной упавшей проверки отдаём модели (голова + хвост).
const MAX_OUTPUT_PER_CHECK: usize = 4_000;
pub const CONFIG_PATH: &str = ".aide/checks.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub command: String,
    pub timeout: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Passed,
    Failed,
    TimedOut,
    /// Не удалось даже запустить (нет программы и т.п.).
    Error(String),
}

#[derive(Debug, Clone)]
pub struct CheckResult {
    pub command: String,
    pub outcome: Outcome,
    pub output: String,
}

/// Запоминает файлы, которые агент поменял инструментами правки.
pub fn track(changed: &mut BTreeSet<String>, tool: &str, args: &Value) {
    if matches!(tool, "write_file" | "create_file" | "apply_edit" | "delete_file") {
        if let Some(p) = args.get("path").and_then(Value::as_str) {
            let p = p.trim().replace('\\', "/");
            if !p.is_empty() {
                changed.insert(p);
            }
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    commands: Vec<String>,
    #[serde(default)]
    timeout_seconds: Option<u64>,
}

fn valid_command(c: &str) -> bool {
    let c = c.trim();
    !c.is_empty() && c.len() <= MAX_COMMAND_LEN && !c.chars().any(|ch| ch == '\n' || ch == '\r' || ch == '\0')
}

/// Проверки для этого проекта и этих изменений. Пустой список — проверять нечего.
pub fn plan(root: &Path, changed: &BTreeSet<String>) -> Result<Vec<Check>, String> {
    let config_file = root.join(CONFIG_PATH);
    if config_file.is_file() {
        let text = std::fs::read_to_string(&config_file).map_err(|e| format!("{CONFIG_PATH}: {e}"))?;
        if text.len() > 64 * 1024 {
            return Err(format!("{CONFIG_PATH}: файл слишком большой"));
        }
        let cfg: Config = serde_json::from_str(&text).map_err(|e| format!("{CONFIG_PATH}: {e}"))?;
        if cfg.enabled == Some(false) {
            return Ok(Vec::new());
        }
        let timeout = cfg.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(5, MAX_TIMEOUT_SECS);
        if !cfg.commands.is_empty() {
            if cfg.commands.len() > MAX_COMMANDS {
                return Err(format!("{CONFIG_PATH}: не больше {MAX_COMMANDS} команд"));
            }
            if let Some(bad) = cfg.commands.iter().find(|c| !valid_command(c)) {
                return Err(format!("{CONFIG_PATH}: недопустимая команда «{}»", bad.chars().take(60).collect::<String>()));
            }
            return Ok(cfg.commands.iter().map(|c| Check { command: c.trim().to_string(), timeout }).collect());
        }
    }
    Ok(detect(root, changed))
}

fn ext_of(p: &str) -> String {
    Path::new(p).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}
fn file_name(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

/// Безопасный путь для подстановки в команду: только латиница, цифры и . _ - /, без «..» и абсолютных путей.
fn shell_safe_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.starts_with('-')
        && !p.split('/').any(|s| s == "..")
        && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
}

fn package_manager(root: &Path) -> &'static str {
    if root.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if root.join("yarn.lock").is_file() {
        "yarn"
    } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
        "bun"
    } else {
        "npm"
    }
}

/// Автоопределение: только быстрые проверки, без полной сборки и без серверов.
fn detect(root: &Path, changed: &BTreeSet<String>) -> Vec<Check> {
    let check = |command: String| Check { command, timeout: DEFAULT_TIMEOUT_SECS };
    let mut out = Vec::new();
    let exts: BTreeSet<String> = changed.iter().map(|p| ext_of(p)).collect();
    let names: BTreeSet<&str> = changed.iter().map(|p| file_name(p)).collect();
    let any_ext = |list: &[&str]| list.iter().any(|e| exts.contains(*e));

    // JavaScript / TypeScript
    let js_changed = any_ext(&["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro"])
        || names.contains("package.json")
        || names.iter().any(|n| n.starts_with("tsconfig"));
    if js_changed && root.join("package.json").is_file() {
        let pm = package_manager(root);
        let scripts: serde_json::Map<String, Value> = std::fs::read_to_string(root.join("package.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.get("scripts").and_then(Value::as_object).cloned())
            .unwrap_or_default();
        let script = |name: &str| scripts.get(name).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        if script("typecheck").is_some() {
            out.push(check(format!("{pm} run typecheck")));
        } else if script("type-check").is_some() {
            out.push(check(format!("{pm} run type-check")));
        } else if root.join("tsconfig.json").is_file() && root.join("node_modules").join("typescript").is_dir() {
            out.push(check(match pm {
                "pnpm" => "pnpm exec tsc --noEmit".into(),
                "yarn" => "yarn tsc --noEmit".into(),
                "bun" => "bunx tsc --noEmit".into(),
                _ => "npx --no-install tsc --noEmit".into(),
            }));
        }
        if script("lint").is_some() {
            out.push(check(format!("{pm} run lint")));
        }
        // npm init кладёт заглушку «no test specified», она всегда падает — её не запускаем.
        if let Some(test) = script("test") {
            if !test.contains("no test specified") {
                out.push(check(format!("{pm} test")));
            }
        }
    }

    // Rust: корень или Tauri-проект (src-tauri/)
    if any_ext(&["rs"]) || names.contains("Cargo.toml") {
        if root.join("Cargo.toml").is_file() {
            out.push(check("cargo check".into()));
        } else if root.join("src-tauri").join("Cargo.toml").is_file() {
            out.push(check("cargo check --manifest-path src-tauri/Cargo.toml".into()));
        }
    }

    // Go
    if any_ext(&["go"]) && root.join("go.mod").is_file() {
        out.push(check("go vet ./...".into()));
    }

    // Python: синтаксис изменённых файлов (без запуска кода проекта)
    let py: Vec<&String> = changed
        .iter()
        .filter(|p| ext_of(p) == "py" && shell_safe_path(p) && root.join(p).is_file())
        .take(MAX_PY_FILES)
        .collect();
    if !py.is_empty() {
        let files = py.iter().map(|p| p.as_str()).collect::<Vec<_>>().join(" ");
        let python = if cfg!(windows) { "python" } else { "python3" };
        out.push(check(format!("{python} -m py_compile {files}")));
    }

    out.truncate(MAX_COMMANDS);
    out
}

/// Голова и хвост длинного вывода: ошибки компилятора обычно в начале, итог тестов — в конце.
fn head_tail(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let half = max / 2;
    let head: String = s.chars().take(half).collect();
    let tail: String = s.chars().rev().take(half).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{head}\n…[вывод сокращён]…\n{tail}")
}

/// Запускает проверки по очереди (блокирующе — вызывать из spawn_blocking). Останавливается на первой упавшей:
/// следующие проверки после ошибки типов обычно только повторяют её.
pub fn run(root: &Path, checks: &[Check], mut on_output: impl FnMut(&str, &str)) -> Vec<CheckResult> {
    let mut results = Vec::new();
    for c in checks {
        on_output(&c.command, "");
        // CI=1: тестовые раннеры не уходят в режим наблюдения и не ждут ввода.
        let res = crate::terminal::run_shell_status(root, &c.command, c.timeout, &[("CI", "1")]);
        let (outcome, output) = match res {
            Ok((Some(true), out)) => (Outcome::Passed, out),
            Ok((Some(false), out)) => (Outcome::Failed, out),
            Ok((None, out)) => (Outcome::TimedOut, out),
            Err(e) => (Outcome::Error(e.clone()), e),
        };
        on_output(&c.command, &output);
        let stop = outcome != Outcome::Passed;
        results.push(CheckResult { command: c.command.clone(), outcome, output });
        if stop {
            break;
        }
    }
    results
}

pub fn all_passed(results: &[CheckResult]) -> bool {
    results.iter().all(|r| r.outcome == Outcome::Passed)
}

/// Короткая сводка для строки действия в чате.
pub fn summary(results: &[CheckResult]) -> String {
    results
        .iter()
        .map(|r| {
            let mark = match &r.outcome {
                Outcome::Passed => "✓",
                Outcome::Failed => "✗",
                Outcome::TimedOut => "⏱",
                Outcome::Error(_) => "!",
            };
            format!("{mark} {}", r.command)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Сообщение модели с ошибками, которые нужно исправить.
pub fn failure_prompt(results: &[CheckResult], round: u32) -> String {
    let mut s = String::from(
        "Автопроверка после твоих правок не прошла. Исправь причину ошибок в коде (не отключай проверки, \
не удаляй тесты и не ослабляй типы ради зелёного результата), затем снова дай итоговый ответ — \
проверки запустятся автоматически.\n",
    );
    s.push_str(&format!("Попытка {round} из {}.\n", MAX_ROUNDS - 1));
    for r in results {
        let status = match &r.outcome {
            Outcome::Passed => "прошла".to_string(),
            Outcome::Failed => "упала".to_string(),
            Outcome::TimedOut => "прервана по таймауту".to_string(),
            Outcome::Error(e) => format!("не запустилась: {e}"),
        };
        s.push_str(&format!("\n$ {} — {status}\n", r.command));
        if r.outcome != Outcome::Passed {
            s.push_str(&head_tail(&r.output, MAX_OUTPUT_PER_CHECK));
            s.push('\n');
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("aide-verify-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn set(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tracks_only_editing_tools() {
        let mut c = BTreeSet::new();
        track(&mut c, "write_file", &serde_json::json!({ "path": "src\\a.ts" }));
        track(&mut c, "read_file", &serde_json::json!({ "path": "src/b.ts" }));
        track(&mut c, "apply_edit", &serde_json::json!({ "path": "  " }));
        assert_eq!(c, set(&["src/a.ts"]));
    }

    #[test]
    fn detects_js_scripts_and_skips_placeholder_test() {
        let root = tmp("js");
        fs::write(root.join("package.json"), r#"{"scripts":{"lint":"eslint .","test":"echo \"Error: no test specified\" && exit 1"}}"#).unwrap();
        fs::write(root.join("pnpm-lock.yaml"), "").unwrap();
        let checks = plan(&root, &set(&["src/app.tsx"])).unwrap();
        let cmds: Vec<_> = checks.iter().map(|c| c.command.as_str()).collect();
        assert_eq!(cmds, vec!["pnpm run lint"]);
    }

    #[test]
    fn nothing_to_check_for_docs_only() {
        let root = tmp("docs");
        fs::write(root.join("package.json"), r#"{"scripts":{"lint":"eslint ."}}"#).unwrap();
        assert!(plan(&root, &set(&["README.md"])).unwrap().is_empty());
    }

    #[test]
    fn tauri_rust_and_safe_python_paths() {
        let root = tmp("rs");
        fs::create_dir_all(root.join("src-tauri")).unwrap();
        fs::write(root.join("src-tauri/Cargo.toml"), "[package]").unwrap();
        fs::write(root.join("ok.py"), "x = 1").unwrap();
        fs::write(root.join("bad name.py"), "x = 1").unwrap();
        let checks = plan(&root, &set(&["src-tauri/src/lib.rs", "ok.py", "bad name.py", "../evil.py"])).unwrap();
        let cmds: Vec<_> = checks.iter().map(|c| c.command.clone()).collect();
        assert_eq!(cmds[0], "cargo check --manifest-path src-tauri/Cargo.toml");
        assert!(cmds[1].ends_with("-m py_compile ok.py"), "{cmds:?}");
        assert_eq!(cmds.len(), 2);
    }

    #[test]
    fn config_overrides_and_validates() {
        let root = tmp("cfg");
        fs::create_dir_all(root.join(".aide")).unwrap();
        fs::write(root.join(CONFIG_PATH), r#"{"commands":["make check"],"timeoutSeconds":99999}"#).unwrap();
        let checks = plan(&root, &set(&["a.c"])).unwrap();
        assert_eq!(checks, vec![Check { command: "make check".into(), timeout: MAX_TIMEOUT_SECS }]);

        fs::write(root.join(CONFIG_PATH), r#"{"commands":["a\nb"]}"#).unwrap();
        assert!(plan(&root, &set(&["a.c"])).is_err());

        fs::write(root.join(CONFIG_PATH), r#"{"enabled":false,"commands":["make check"]}"#).unwrap();
        assert!(plan(&root, &set(&["a.c"])).unwrap().is_empty());
    }

    #[test]
    fn prompt_keeps_head_and_tail() {
        let long = format!("FIRST {}\nLAST", "x".repeat(20_000));
        let r = vec![CheckResult { command: "npm test".into(), outcome: Outcome::Failed, output: long }];
        let p = failure_prompt(&r, 1);
        assert!(p.contains("FIRST") && p.contains("LAST") && p.contains("сокращён"));
        assert!(p.len() < 12_000);
        assert!(!all_passed(&r));
    }
}
