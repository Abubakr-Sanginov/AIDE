//! Подписки ИИ-агентов на этом компьютере: какие агенты установлены, в каком они аккаунте и на каком тарифе.
//!
//! Известные агенты (Claude Code, Codex, Gemini CLI, Copilot, Cursor и другие) ищутся по своим папкам. Неизвестные
//! находятся общим способом: в папках настроек пользователя ищутся файлы входа (`auth.json`, `credentials.json`,
//! `oauth_creds.json` и подобные), и из них достаётся то, что похоже на тариф и аккаунт.
//!
//! Безопасность. Файлы входа содержат секреты, поэтому:
//! * читаются только локальные файлы небольшого размера, ничего не отправляется по сети и не пишется на диск;
//! * значения полей, похожих на секрет (token, secret, password, key, cookie, session…), никогда не возвращаются:
//!   наружу идёт только тариф, аккаунт (адрес маскируется), срок действия входа и несколько безобидных фактов;
//! * у токенов JWT читаются только разрешённые поля (почта, тариф, срок), сам токен никуда не попадает;
//! * это команда интерфейса настроек, а не инструмент агента: модель эти данные не видит.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;

const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_ROOT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DIRS: usize = 700;
const MAX_FILES_PER_DIR: usize = 40;
const MAX_NODES: usize = 4000;
const MAX_DEPTH: usize = 8;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct AgentAccount {
    pub id: String,
    pub name: String,
    /// Известный агент (из списка) или найденный общим способом.
    pub known: bool,
    /// Где лежат его данные, с «~» вместо домашней папки.
    pub location: String,
    pub plan: Option<String>,
    /// Аккаунт; адрес почты замаскирован.
    pub account: Option<String>,
    /// Когда истекает вход (Unix-время, мс), если в файле есть срок.
    pub expires_at: Option<i64>,
    /// Прочие безобидные факты: (название, значение).
    pub facts: Vec<(String, String)>,
    /// Найдены данные входа (токен или ключ), сами они не возвращаются.
    pub signed_in: bool,
}

/* ───────────── чистая логика ───────────── */

/// Нужно ли скрыть значение поля с таким именем: оно может быть секретом.
pub fn is_secret_key(key: &str) -> bool {
    let k = key.to_lowercase();
    ["token", "secret", "passw", "cookie", "apikey", "api_key", "api-key", "private", "bearer", "signature", "session", "auth_key", "authkey", "credential_value"]
        .iter()
        .any(|s| k.contains(s))
        || k == "key"
        || k.ends_with("_key")
        || k.ends_with("key") && k.len() <= 6
}

/// Похоже ли значение на секрет (длинная строка без пробелов из символов ключей).
pub fn looks_like_secret(value: &str) -> bool {
    let v = value.trim();
    v.len() >= 32 && !v.contains(char::is_whitespace) && v.chars().all(|c| c.is_ascii_alphanumeric() || "_-./+=:".contains(c))
}

/// «ab***@gmail.com»: по маске видно, чей аккаунт, но почту не прочитать с экрана целиком.
pub fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((name, domain)) if !name.is_empty() && !domain.is_empty() => {
            let head: String = name.chars().take(2).collect();
            format!("{head}***@{domain}")
        }
        _ => email.chars().take(2).collect::<String>() + "***",
    }
}

/// Тариф в читаемом виде: «max» → «Max», «chatgpt_plus» → «Plus».
pub fn plan_label(raw: &str) -> String {
    let r = raw.trim().to_lowercase();
    let r = r.trim_start_matches("chatgpt_").trim_start_matches("claude_").replace(['_', '-'], " ");
    let mut c = r.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Содержимое (payload) JWT как JSON; подпись не проверяется и не нужна: токен только читается как данные.
pub fn jwt_payload(token: &str) -> Option<Value> {
    let t = token.trim();
    if !t.starts_with("eyJ") {
        return None;
    }
    let mut parts = t.split('.');
    let (_, payload, _) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || payload.len() > 20_000 {
        return None;
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Default, Debug)]
pub struct Facts {
    pub plan: Option<String>,
    pub email: Option<String>,
    /// Unix-время, мс.
    pub expires_ms: Option<i64>,
    pub extra: Vec<(String, String)>,
    pub has_secret: bool,
}

impl Facts {
    fn add_extra(&mut self, k: &str, v: &str) {
        if self.extra.len() < 8 && !self.extra.iter().any(|(a, _)| a == k) {
            self.extra.push((k.to_string(), v.to_string()));
        }
    }
    fn found_any(&self) -> bool {
        self.plan.is_some() || self.email.is_some() || self.has_secret
    }
}

fn to_ms(n: f64) -> Option<i64> {
    if !n.is_finite() || n <= 0.0 {
        return None;
    }
    // Секунды (10 цифр) или миллисекунды (13 цифр).
    Some(if n < 1e11 { (n * 1000.0) as i64 } else { n as i64 })
}

fn short(value: &str) -> Option<String> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > 80 || looks_like_secret(v) {
        None
    } else {
        Some(v.to_string())
    }
}

fn take_claims(payload: &Value, facts: &mut Facts) {
    if let Some(e) = payload.get("email").and_then(Value::as_str) {
        if facts.email.is_none() && e.contains('@') {
            facts.email = Some(e.to_string());
        }
    }
    if let Some(exp) = payload.get("exp").and_then(Value::as_f64) {
        if facts.expires_ms.is_none() {
            facts.expires_ms = to_ms(exp);
        }
    }
    // Токены OpenAI хранят тариф ChatGPT в отдельном объекте.
    if let Some(auth) = payload.get("https://api.openai.com/auth").and_then(Value::as_object) {
        if let Some(p) = auth.get("chatgpt_plan_type").and_then(Value::as_str) {
            if facts.plan.is_none() {
                facts.plan = Some(plan_label(p));
            }
        }
        if let Some(until) = auth.get("chatgpt_subscription_active_until").and_then(Value::as_str) {
            if let Some(v) = short(until) {
                facts.add_extra("Подписка до", &v.chars().take(10).collect::<String>());
            }
        }
    }
    for k in ["plan", "tier", "subscription", "subscription_tier", "plan_type"] {
        if let Some(v) = payload.get(k).and_then(Value::as_str) {
            if facts.plan.is_none() {
                facts.plan = short(v).map(|p| plan_label(&p));
            }
        }
    }
}

const PLAN_KEYS: [&str; 5] = ["subscriptiontype", "plantype", "plan", "subscription", "membershiptype"];

/// Достаёт из JSON тариф, аккаунт, срок и безобидные факты. Секреты не возвращаются.
pub fn extract_facts(value: &Value) -> Facts {
    let mut facts = Facts::default();
    let mut budget = MAX_NODES;
    walk(value, &mut facts, 0, &mut budget);
    facts
}

fn walk(v: &Value, facts: &mut Facts, depth: usize, budget: &mut usize) {
    if depth > MAX_DEPTH || *budget == 0 {
        return;
    }
    *budget -= 1;
    match v {
        Value::Object(map) => {
            for (k, val) in map {
                let kl = k.to_lowercase();
                let kn: String = kl.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
                match val {
                    Value::String(s) => {
                        if let Some(payload) = jwt_payload(s) {
                            facts.has_secret = true;
                            take_claims(&payload, facts);
                            continue;
                        }
                        if is_secret_key(k) {
                            if !s.trim().is_empty() {
                                facts.has_secret = true;
                            }
                            continue;
                        }
                        let Some(text) = short(s) else { continue };
                        if PLAN_KEYS.contains(&kn.as_str()) || kn.ends_with("plan") || kn.contains("subscriptiontype") {
                            if facts.plan.is_none() {
                                facts.plan = Some(plan_label(&text));
                            }
                        } else if kn.contains("email") || kn == "login" || kn == "username" {
                            if facts.email.is_none() && text.contains('@') {
                                facts.email = Some(text);
                            } else if !text.contains('@') {
                                facts.add_extra("Аккаунт", &text);
                            }
                        } else if kn.contains("tier") {
                            facts.add_extra("Уровень", &text);
                        } else if kn.contains("authtype") || kn == "authmethod" || kn == "loginmethod" {
                            facts.add_extra("Вход", &text);
                        } else if kn.contains("billingtype") || kn.contains("accounttype") {
                            facts.add_extra("Оплата", &text);
                        } else if kn.contains("organizationname") || kn == "orgname" || kn == "organization" {
                            facts.add_extra("Организация", &text);
                        } else if kn.contains("expire") || kn.contains("until") {
                            if kn.contains("subscription") {
                                facts.add_extra("Подписка до", &text.chars().take(10).collect::<String>());
                            }
                        }
                    }
                    Value::Number(n) => {
                        if (kn.contains("expiresat") || kn == "expiry" || kn == "expirydate" || kn == "expiresin" && false) && !is_secret_key(k) {
                            if facts.expires_ms.is_none() {
                                facts.expires_ms = n.as_f64().and_then(to_ms);
                            }
                        }
                    }
                    Value::Object(_) | Value::Array(_) => {
                        // Раздел целиком секретный (например, "tokens"): внутрь не заходим, только отмечаем, что вход есть.
                        if is_secret_key(k) && !matches!(&kl[..], "tokens") {
                            facts.has_secret = true;
                            continue;
                        }
                        walk(val, facts, depth + 1, budget);
                    }
                    _ => {}
                }
            }
        }
        Value::Array(items) => {
            for item in items.iter().take(20) {
                walk(item, facts, depth + 1, budget);
            }
        }
        _ => {}
    }
}

/* ───────────── поиск агентов ───────────── */

struct Known {
    id: &'static str,
    name: &'static str,
    /// Папки относительно домашней (на Windows данные приложений тоже лежат под ней: AppData\Roaming, AppData\Local).
    dirs: &'static [&'static str],
}

const KNOWN: &[Known] = &[
    Known { id: "claude-code", name: "Claude Code", dirs: &[".claude"] },
    Known { id: "codex", name: "Codex (OpenAI)", dirs: &[".codex", ".config/codex"] },
    Known { id: "gemini", name: "Gemini CLI", dirs: &[".gemini"] },
    Known { id: "copilot", name: "GitHub Copilot", dirs: &[".config/github-copilot", "AppData/Local/github-copilot", ".copilot"] },
    Known { id: "opencode", name: "OpenCode", dirs: &[".local/share/opencode", ".config/opencode", "AppData/Roaming/opencode", ".opencode"] },
    Known { id: "cursor", name: "Cursor", dirs: &[".cursor", "AppData/Roaming/Cursor"] },
    Known { id: "windsurf", name: "Windsurf", dirs: &[".codeium", "AppData/Roaming/Windsurf"] },
    Known { id: "qwen", name: "Qwen Code", dirs: &[".qwen"] },
    Known { id: "factory", name: "Factory Droid", dirs: &[".factory"] },
    Known { id: "cline", name: "Cline", dirs: &[".cline"] },
    Known { id: "continue", name: "Continue", dirs: &[".continue"] },
    Known { id: "amp", name: "Amp", dirs: &[".config/amp", ".local/share/amp"] },
    Known { id: "goose", name: "Goose", dirs: &[".config/goose"] },
    Known { id: "antigravity", name: "Antigravity", dirs: &["AppData/Roaming/Antigravity", ".antigravity"] },
];

/// Файлы, в которых агенты обычно хранят вход или настройки аккаунта.
const CRED_FILES: &[&str] = &[
    ".credentials.json", "credentials.json", "auth.json", "oauth_creds.json", "oauth.json", "hosts.json", "apps.json",
    "token.json", "tokens.json", "account.json", "user.json", "profile.json", "settings.json", "config.json",
];

/// Папки, которые заведомо не про ИИ-агентов: их не разбираем.
const NOT_AGENTS: &[&str] = &[
    "aws", "azure", "docker", "npm", "ssh", "gnupg", "kube", "git", "cargo", "rustup", "cache", "conda", "dotnet", "gradle", "m2",
    "nuget", "pnpm", "yarn", "bun", "node", "nvm", "vscode", "idea", "android", "expo", "electron-gyp", "config", "local", "bash",
    "microsoft", "windows", "google", "mozilla", "chrome", "edge", "adobe", "steam", "discord", "telegram", "slack", "spotify",
    "temp", "tmp", "packages", "programs", "python", "pip", "ipython", "jupyter", "matplotlib", "gh", "github", "gcloud", "firebase",
];

const AI_WORDS: &[&str] = &[
    "ai", "llm", "gpt", "agent", "agents", "copilot", "assistant", "claude", "codex", "gemini", "cursor", "windsurf", "cline",
    "aider", "kimi", "qwen", "mistral", "deepseek", "grok", "perplexity", "genspark", "accio", "codebuddy", "cagent", "dust", "droid",
    "opencode", "antigravity", "openrouter", "anthropic", "openai", "chatgpt", "crush", "goose", "zed", "tabnine", "codeium", "continue",
];

fn name_tokens(name: &str) -> Vec<String> {
    name.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|t| !t.is_empty()).map(String::from).collect()
}

/// Похоже ли название папки на ИИ-агента: слово из списка целиком, длинное слово внутри («genspark-tool-cli»,
/// «codebuddy») или окончание ai/llm/gpt у длинного слова («coolai», «freellmapi»).
fn is_ai_name(name: &str) -> bool {
    name_tokens(name).iter().any(|t| {
        AI_WORDS.contains(&t.as_str())
            || AI_WORDS.iter().any(|w| w.len() >= 5 && t.contains(w))
            || (t.len() >= 5 && (t.ends_with("ai") || t.contains("llm") || t.ends_with("gpt")))
    })
}

fn is_denied(name: &str) -> bool {
    let toks = name_tokens(name);
    toks.len() == 1 && NOT_AGENTS.contains(&toks[0].as_str()) || NOT_AGENTS.contains(&name.trim_start_matches('.').to_lowercase().as_str())
}

fn pretty_name(dir: &str) -> String {
    let n = dir.trim_start_matches('.').trim_start_matches('@');
    let mut c = n.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => dir.to_string(),
    }
}

fn read_json(path: &Path, limit: u64) -> Option<Value> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit {
        return None;
    }
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Факты из файлов входа в папке агента (сама папка и подпапки на один уровень вглубь).
fn scan_dir(dir: &Path, files_read: &mut usize) -> Facts {
    let mut total = Facts::default();
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut sub: Vec<PathBuf> = vec![dir.to_path_buf()];
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten().take(60) {
            if e.file_type().map(|t| t.is_dir() && !t.is_symlink()).unwrap_or(false) {
                sub.push(e.path());
            }
        }
    }
    for d in sub.iter().take(30) {
        if let Ok(rd) = fs::read_dir(d) {
            for e in rd.flatten().take(MAX_FILES_PER_DIR) {
                let name = e.file_name().to_string_lossy().to_lowercase();
                if CRED_FILES.contains(&name.as_str()) {
                    candidates.push(e.path());
                }
            }
        }
    }
    for f in candidates {
        if *files_read >= 400 {
            break;
        }
        *files_read += 1;
        let Some(v) = read_json(&f, MAX_FILE_BYTES) else { continue };
        merge(&mut total, extract_facts(&v));
    }
    total
}

fn merge(into: &mut Facts, from: Facts) {
    if into.plan.is_none() {
        into.plan = from.plan;
    }
    if into.email.is_none() {
        into.email = from.email;
    }
    if into.expires_ms.is_none() {
        into.expires_ms = from.expires_ms;
    }
    into.has_secret |= from.has_secret;
    for (k, v) in from.extra {
        into.add_extra(&k, &v);
    }
}

fn display(home: &Path, p: &Path) -> String {
    match p.strip_prefix(home) {
        Ok(rest) => format!("~\\{}", rest.to_string_lossy().replace('/', "\\")),
        Err(_) => p.to_string_lossy().into_owned(),
    }
}

fn to_account(id: String, name: String, known: bool, location: String, f: Facts) -> AgentAccount {
    AgentAccount {
        id,
        name,
        known,
        location,
        signed_in: f.has_secret || f.email.is_some() || f.plan.is_some(),
        plan: f.plan,
        account: f.email.as_deref().map(mask_email),
        expires_at: f.expires_ms,
        facts: f.extra,
    }
}

/// Домашний файл вида `.claude.json`: там Claude Code хранит данные аккаунта.
fn root_files(home: &Path) -> Vec<(String, Facts)> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(home) {
        for e in rd.flatten().take(400) {
            let name = e.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if !lower.starts_with('.') || !lower.ends_with(".json") || lower.contains("backup") || !is_ai_name(&lower) {
                continue;
            }
            if let Some(v) = read_json(&e.path(), MAX_ROOT_FILE_BYTES) {
                let f = extract_facts(&v);
                if f.found_any() {
                    out.push((name, f));
                }
            }
        }
    }
    out
}

/// Основная работа: известные агенты по списку, неизвестные общим поиском. Только чтение.
pub fn scan(home: &Path) -> Vec<AgentAccount> {
    let mut out: Vec<AgentAccount> = Vec::new();
    let mut files_read = 0usize;
    let mut used_dirs: HashSet<PathBuf> = HashSet::new();
    let roots = root_files(home);

    for k in KNOWN {
        let mut found: Option<(PathBuf, Facts)> = None;
        let mut any_dir: Option<PathBuf> = None;
        for rel in k.dirs {
            let d = home.join(rel);
            if !d.is_dir() {
                continue;
            }
            used_dirs.insert(d.clone());
            any_dir.get_or_insert_with(|| d.clone());
            let f = scan_dir(&d, &mut files_read);
            if f.found_any() && found.is_none() {
                found = Some((d, f));
            }
        }
        let Some(dir) = any_dir else { continue };
        let (loc, mut facts) = match found {
            Some((d, f)) => (d, f),
            None => (dir, Facts::default()),
        };
        // Данные аккаунта Claude Code лежат ещё и в ~/.claude.json
        if k.id == "claude-code" {
            for (name, f) in &roots {
                if name.to_lowercase().starts_with(".claude") {
                    let copy = Facts { plan: f.plan.clone(), email: f.email.clone(), expires_ms: f.expires_ms, extra: f.extra.clone(), has_secret: f.has_secret };
                    merge(&mut facts, copy);
                }
            }
        }
        out.push(to_account(k.id.into(), k.name.into(), true, display(home, &loc), facts));
    }

    // Неизвестные: папки настроек пользователя.
    let mut candidates: Vec<PathBuf> = Vec::new();
    let bases = [home.to_path_buf(), home.join(".config"), home.join(".local/share"), home.join("AppData/Roaming"), home.join("AppData/Local")];
    for (i, base) in bases.iter().enumerate() {
        if let Ok(rd) = fs::read_dir(base) {
            for e in rd.flatten().take(500) {
                let name = e.file_name().to_string_lossy().into_owned();
                // В домашней папке интересны только скрытые (.name); в остальных — любые.
                if i == 0 && !name.starts_with('.') {
                    continue;
                }
                if !e.file_type().map(|t| t.is_dir() && !t.is_symlink()).unwrap_or(false) || is_denied(&name) {
                    continue;
                }
                candidates.push(e.path());
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    for d in candidates.into_iter().take(MAX_DIRS) {
        if used_dirs.contains(&d) {
            continue;
        }
        let name = d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let f = scan_dir(&d, &mut files_read);
        // Показываем папку, если в ней нашёлся тариф, либо по названию она похожа на ИИ-агента (тогда даже без читаемого входа:
        // человек увидит, что такой агент есть, и что про его подписку из файлов ничего не узнать).
        let worth = f.plan.is_some() || is_ai_name(&name);
        if !worth {
            continue;
        }
        out.push(to_account(format!("found-{}", name.trim_start_matches('.').to_lowercase()), pretty_name(&name), false, display(home, &d), f));
    }
    // Домашние файлы вида .something.json, которых нет среди известных.
    for (name, f) in roots {
        let base = name.trim_start_matches('.').trim_end_matches(".json").to_string();
        if out.iter().any(|a| a.id.contains(&base.to_lowercase())) {
            continue;
        }
        let loc = display(home, &home.join(&name));
        out.push(to_account(format!("found-{}", base.to_lowercase()), pretty_name(&base), false, loc, f));
    }
    out.sort_by(|a, b| (!a.known, a.name.to_lowercase()).cmp(&(!b.known, b.name.to_lowercase())));
    out
}

/// Команда для настроек: ничего не пишет, ничего не отправляет.
#[tauri::command]
pub async fn scan_agent_accounts() -> Result<Vec<AgentAccount>, String> {
    let home = dirs_next::home_dir().ok_or("Не удалось определить домашнюю папку")?;
    tauri::async_runtime::spawn_blocking(move || scan(&home)).await.map_err(|e| format!("сканирование прервалось: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn jwt(payload: Value) -> String {
        let enc = |v: &Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(v).unwrap());
        format!("eyJhbGciOiJub25lIn0.{}.sig", enc(&payload))
    }

    #[test]
    fn secrets_are_recognised_by_name_and_by_shape() {
        for k in ["access_token", "refreshToken", "apiKey", "API_KEY", "client_secret", "password", "key", "OPENAI_API_KEY", "sessionKey", "cookie"] {
            assert!(is_secret_key(k), "{k}");
        }
        for k in ["plan", "email", "subscriptionType", "expiresAt", "selectedAuthType", "tier", "name"] {
            assert!(!is_secret_key(k), "{k}");
        }
        assert!(looks_like_secret("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"));
        assert!(!looks_like_secret("Max plan with extras"));
        assert!(!looks_like_secret("user@example.com"));
    }

    #[test]
    fn emails_are_masked_and_plans_are_readable() {
        assert_eq!(mask_email("alexander@gmail.com"), "al***@gmail.com");
        assert_eq!(mask_email("x@y.org"), "x***@y.org");
        assert_eq!(mask_email("noemail"), "no***");
        assert_eq!(plan_label("max"), "Max");
        assert_eq!(plan_label("chatgpt_plus"), "Plus");
        assert_eq!(plan_label("claude_pro"), "Pro");
        assert_eq!(plan_label("team_plan"), "Team plan");
        assert_eq!(plan_label(""), "");
    }

    #[test]
    fn jwt_payloads_are_decoded_only_when_well_formed() {
        let t = jwt(json!({"email": "a@b.c", "exp": 1900000000}));
        assert_eq!(jwt_payload(&t).unwrap()["email"], "a@b.c");
        for bad in ["", "abc", "eyJ.only", "eyJhbGciOi.@@@.sig", "eyJa.eyJb.c.d"] {
            assert!(jwt_payload(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn claude_code_credentials_give_plan_and_expiry_but_no_secrets() {
        let v = json!({"claudeAiOauth": {"accessToken": "sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "refreshToken": "sk-ant-ort01-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "expiresAt": 1900000000000i64, "scopes": ["user:inference"], "subscriptionType": "max", "rateLimitTier": "default_claude_max_5x"}});
        let f = extract_facts(&v);
        assert_eq!(f.plan.as_deref(), Some("Max"));
        assert_eq!(f.expires_ms, Some(1900000000000));
        assert!(f.has_secret);
        assert!(f.extra.iter().any(|(k, v)| k == "Уровень" && v == "default_claude_max_5x"));
        let dump = format!("{f:?}");
        assert!(!dump.contains("sk-ant"), "секрет попал в результат: {dump}");
    }

    #[test]
    fn codex_tokens_give_email_and_chatgpt_plan() {
        let id = jwt(json!({"email": "me@example.com", "exp": 1900000000, "https://api.openai.com/auth": {"chatgpt_plan_type": "plus", "chatgpt_subscription_active_until": "2026-12-01T00:00:00+00:00"}}));
        let v = json!({"OPENAI_API_KEY": null, "tokens": {"id_token": id, "access_token": "eyJabc.def.ghi", "refresh_token": "rt_secretsecretsecretsecretsecretsecret"}});
        let f = extract_facts(&v);
        assert_eq!(f.plan.as_deref(), Some("Plus"));
        assert_eq!(f.email.as_deref(), Some("me@example.com"));
        assert_eq!(f.expires_ms, Some(1900000000000));
        assert!(f.extra.iter().any(|(k, v)| k == "Подписка до" && v == "2026-12-01"));
        let dump = format!("{f:?}");
        assert!(!dump.contains("rt_secret") && !dump.contains("eyJ"), "{dump}");
    }

    #[test]
    fn unknown_formats_still_yield_plan_and_account() {
        let v = json!({"user": {"email": "z@z.io", "plan": "pro_annual"}, "sessionToken": "x".repeat(40)});
        let f = extract_facts(&v);
        assert_eq!(f.plan.as_deref(), Some("Pro annual"));
        assert_eq!(f.email.as_deref(), Some("z@z.io"));
        assert!(f.has_secret);
        // тариф может лежать под другим именем поля
        assert_eq!(extract_facts(&json!({"meta": {"membershipType": "enterprise"}})).plan.as_deref(), Some("Enterprise"));
        // ничего не нашлось: пусто
        let none = extract_facts(&json!({"theme": "dark", "fontSize": 14}));
        assert!(!none.found_any());
        // большие и глубокие документы не вешают разбор
        let mut deep = json!("leaf");
        for _ in 0..50 {
            deep = json!({"a": deep});
        }
        let _ = extract_facts(&deep);
        let wide = Value::Array((0..5000).map(|i| json!({"plan": format!("p{i}")})).collect());
        let _ = extract_facts(&wide);
    }

    #[test]
    fn scan_finds_known_and_unknown_agents_in_a_fake_home() {
        let home = std::env::temp_dir().join(format!("aide-accounts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        let w = |rel: &str, v: Value| {
            let p = home.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, serde_json::to_string(&v).unwrap()).unwrap();
        };
        w(".claude/.credentials.json", json!({"claudeAiOauth": {"accessToken": "t".repeat(50), "subscriptionType": "pro", "expiresAt": 1900000000000i64}}));
        w(".claude.json", json!({"oauthAccount": {"emailAddress": "boss@corp.com", "organizationName": "Corp"}}));
        w(".codex/auth.json", json!({"OPENAI_API_KEY": "sk-".to_string() + &"a".repeat(40)}));
        w(".zzagent/auth.json", json!({"account": {"email": "u@x.com", "plan": "team"}, "token": "q".repeat(40)}));
        w(".my-assistant/credentials.json", json!({"access_token": "r".repeat(40)}));
        w(".docker/config.json", json!({"auths": {"x": {"auth": "y".repeat(40)}}}));
        w(".notes/settings.json", json!({"theme": "dark"}));
        w("AppData/Roaming/CoolAI/auth.json", json!({"tier": "free", "apiKey": "k".repeat(40)}));

        let list = scan(&home);
        let by = |id: &str| list.iter().find(|a| a.id == id);
        let claude = by("claude-code").expect("Claude Code");
        assert!(claude.known && claude.signed_in);
        assert_eq!(claude.plan.as_deref(), Some("Pro"));
        assert_eq!(claude.account.as_deref(), Some("bo***@corp.com"));
        assert!(claude.facts.iter().any(|(k, v)| k == "Организация" && v == "Corp"));
        let codex = by("codex").expect("Codex");
        assert!(codex.signed_in && codex.plan.is_none());
        let unknown = by("found-zzagent");
        assert!(unknown.is_some(), "{list:#?}");
        assert!(!unknown.unwrap().known);
        assert_eq!(unknown.unwrap().plan.as_deref(), Some("Team"));
        assert!(by("found-my-assistant").is_some(), "имя с «assistant» и вход: показать");
        assert!(by("found-docker").is_none() && by("found-notes").is_none(), "не агенты: не показывать");
        // агент по названию без файлов входа всё равно виден, но «не вошёл»
        fs::create_dir_all(home.join(".agentx")).unwrap();
        let again = scan(&home);
        let ax = again.iter().find(|a| a.id == "found-agentx").expect("agentx");
        assert!(!ax.signed_in && ax.plan.is_none());
        assert!(by("found-coolai").is_some());
        // ни один секрет не попал в ответ
        let dump = format!("{list:?}");
        for secret in ["tttttttttt", "aaaaaaaaaa", "qqqqqqqqqq", "rrrrrrrrrr", "kkkkkkkkkk", "yyyyyyyyyy"] {
            assert!(!dump.contains(secret), "секрет в ответе: {secret}");
        }
        assert!(!dump.contains("boss@corp.com"), "почта не замаскирована");
        let _ = fs::remove_dir_all(&home);
    }

    /// Живая проверка на этом компьютере: печатает только имена, тарифы и маски (запуск вручную с --ignored --nocapture).
    #[test]
    #[ignore]
    fn live_scan_this_computer() {
        let home = dirs_next::home_dir().unwrap();
        let t = std::time::Instant::now();
        let list = scan(&home);
        println!("найдено {} за {:?}", list.len(), t.elapsed());
        for a in &list {
            println!("{} | {} | known={} | plan={:?} | account={:?} | expires={:?} | signed_in={} | {} | {:?}", a.id, a.name, a.known, a.plan, a.account, a.expires_at, a.signed_in, a.location, a.facts);
        }
    }
}
