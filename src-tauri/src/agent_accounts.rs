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
                        // Идентификатор аккаунта (accountId, userId): это не секрет, но признак того, что вход был.
                        if ["accountid", "userid"].contains(&kn.as_str()) && s.trim().len() >= 6 {
                            facts.has_secret = true;
                            let id: String = s.trim().chars().take(6).collect();
                            facts.add_extra("Аккаунт", &format!("{id}…"));
                            continue;
                        }
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
    // Настольные агенты (например DeepAI Code) держат аккаунт и модели в своих файлах данных.
    "models.json", "ownership.json",
];

/// Папки внутри данных агента, в которые не заходим: кэши, вложения, профили браузера (там всё зашифровано) и т. п.
const SKIP_DIRS: &[&str] = &[
    "cache", "caches", "code cache", "gpucache", "gpupersistentcache", "dawngraphitecache", "dawnwebgpucache", "shadercache", "grshadercache",
    "indexeddb", "local storage", "session storage", "service worker", "blob_storage", "partitions", "network", "webstorage", "shared dictionary",
    "node_modules", "attachments", "worktrees", "scratch", "bin", "logs", "log", "crashpad", "extensions", "history", "sessions", "projects", "todos",
];
const MAX_SCAN_DEPTH: usize = 5;
const MAX_SCAN_DIRS: usize = 200;

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

/// Файлы входа в папке агента (сама папка и подпапки на один уровень вглубь).
fn cred_files(dir: &Path) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Поиск в ширину на несколько уровней вглубь: данные настольных агентов лежат глубоко (userdata/deepai/pi/deepai/…).
    let mut queue: std::collections::VecDeque<(PathBuf, usize)> = std::collections::VecDeque::new();
    queue.push_back((dir.to_path_buf(), 0));
    let mut visited = 0usize;
    while let Some((d, depth)) = queue.pop_front() {
        visited += 1;
        if visited > MAX_SCAN_DIRS {
            break;
        }
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten().take(MAX_FILES_PER_DIR * 3) {
            let name = e.file_name().to_string_lossy().to_lowercase();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() && !ft.is_symlink() {
                if depth < MAX_SCAN_DEPTH && !SKIP_DIRS.contains(&name.as_str()) {
                    queue.push_back((e.path(), depth + 1));
                }
            } else if ft.is_file() && CRED_FILES.contains(&name.as_str()) {
                candidates.push(e.path());
            }
        }
    }
    candidates.truncate(MAX_FILES_PER_DIR);
    candidates
}

/// Факты из файлов входа в папке агента.
fn scan_dir(dir: &Path, files_read: &mut usize) -> Facts {
    let mut total = Facts::default();
    for f in cred_files(dir) {
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
    let mut by_id: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for d in candidates.into_iter().take(MAX_DIRS) {
        if used_dirs.contains(&d) {
            continue;
        }
        let name = d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let lower = name.to_lowercase();
        if ["updater", "cache", "crashpad", "logs", "temp"].iter().any(|w| lower.contains(w)) {
            continue;
        }
        let f = scan_dir(&d, &mut files_read);
        // Показываем папку, если в ней нашёлся тариф, либо по названию она похожа на ИИ-агента (тогда даже без читаемого входа:
        // человек увидит, что такой агент есть, и что про его подписку из файлов ничего не узнать).
        let worth = f.plan.is_some() || is_ai_name(&name);
        if !worth {
            continue;
        }
        let id = format!("found-{}", name.trim_start_matches('.').to_lowercase());
        // Папка с тем же именем в двух местах (в домашней и в AppData) — один агент.
        if let Some(&i) = by_id.get(&id) {
            let extra = to_account(id, String::new(), false, String::new(), f);
            let a = &mut out[i];
            if a.plan.is_none() {
                a.plan = extra.plan;
            }
            if a.account.is_none() {
                a.account = extra.account;
            }
            a.signed_in |= extra.signed_in;
            continue;
        }
        by_id.insert(id.clone(), out.len());
        out.push(to_account(id, pretty_name(&name), false, display(home, &d), f));
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

/* ───────────── Подключение ключа другого агента как провайдера ───────────── */
//
// Человек может взять ключ или токен, который сохранил какой-то агент, и подключить его в AIDE как провайдера ИИ.
// Само значение секрета при этом не покидает Rust: интерфейс получает только описание («поле, длина, куда
// похоже»), а запись в хранилище ключей Windows делает команда `import_agent_key`.
// Claude Code, Codex и Gemini CLI исключены: их вход привязан к их приложениям и вне них не работает.

/// Агенты, чей вход нельзя использовать вне их собственных приложений.
const BLOCKED_AGENTS: &[&str] = &["claude-code", "codex", "gemini"];
/// Папки (и файлы в домашней), по которым запрет проверяется ещё и по пути, а не только по имени агента.
const BLOCKED_PATHS: &[&str] = &[".claude", ".claude.json", ".codex", ".gemini"];
const MAX_CANDIDATES: usize = 20;
const BLOCKED_NOTE: &str = "Вход Claude Code, Codex и Gemini CLI привязан к их приложениям и вне них не работает: такой токен нельзя использовать как ключ в AIDE.";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct KeyCandidate {
    /// «файл|путь внутри JSON»: по нему команда подключения находит значение заново.
    pub id: String,
    pub file: String,
    /// Читаемое имя поля: «tokens.api_key».
    pub field: String,
    /// Начало значения (не больше 4 символов) и длина: чтобы человек узнал ключ, но не прочитал его.
    pub preview: String,
    /// Протокол провайдера: openai (совместимый), anthropic или google.
    pub kind: String,
    /// Предполагаемый адрес API (из файла или по виду ключа).
    pub base_url: Option<String>,
    /// Если ключ использовать нельзя: почему.
    pub blocked: Option<String>,
}

pub fn pointer_to_field(pointer: &str) -> String {
    pointer.trim_start_matches('/').replace('/', ".")
}

/// Все значения, похожие на ключи или токены: (путь в JSON, значение). Токены обновления (refresh) пропускаются:
/// как ключ они не годятся.
pub fn collect_secrets(value: &Value) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut budget = MAX_NODES;
    collect(value, "", 0, &mut out, &mut budget);
    out
}

fn collect(v: &Value, pointer: &str, depth: usize, out: &mut Vec<(String, String)>, budget: &mut usize) {
    if depth > MAX_DEPTH || *budget == 0 || out.len() >= 40 {
        return;
    }
    *budget -= 1;
    match v {
        Value::Object(map) => {
            for (k, val) in map {
                let p = format!("{pointer}/{}", k.replace('~', "~0").replace('/', "~1"));
                match val {
                    Value::String(s) => {
                        let s = s.trim();
                        let kl = k.to_lowercase();
                        if kl.contains("refresh") || s.len() < 16 || s.len() > 4000 || s.contains(char::is_whitespace) {
                            continue;
                        }
                        // Только то, что названо ключом или токеном: идентификаторы, хэши, адреса и UUID — не ключи.
                        let keyish = is_secret_key(k) || kl.ends_with("key") || kl.ends_with("token") || kl.contains("apikey");
                        if keyish && !not_a_key(s) {
                            out.push((p, s.to_string()));
                        }
                    }
                    Value::Object(_) | Value::Array(_) => collect(val, &p, depth + 1, out, budget),
                    _ => {}
                }
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate().take(20) {
                collect(item, &format!("{pointer}/{i}"), depth + 1, out, budget);
            }
        }
        _ => {}
    }
}

/// Значения, которые лежат под «ключевым» именем, но ключом не являются: адреса, имена переменных окружения,
/// зашифрованные приложением блоки (Electron safeStorage: «v10…», в base64 «djEw…»).
pub fn not_a_key(value: &str) -> bool {
    let v = value.trim();
    let env_name = v.len() <= 100 && v.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') && v.chars().any(|c| c.is_ascii_uppercase());
    v.starts_with("http://") || v.starts_with("https://") || env_name || v.starts_with("djEw") || v.starts_with("v10") || v.starts_with("v11")
}

#[derive(Debug, PartialEq)]
pub struct TokenClass {
    pub kind: &'static str,
    pub base_url: Option<&'static str>,
    pub blocked: Option<&'static str>,
}

/// По виду значения: что это за ключ, куда он, по всей видимости, относится и можно ли его использовать.
pub fn classify_token(secret: &str) -> TokenClass {
    let ok = |kind, base_url| TokenClass { kind, base_url, blocked: None };
    let no = |reason| TokenClass { kind: "openai", base_url: None, blocked: Some(reason) };
    if secret.starts_with("sk-ant-oat") || secret.starts_with("sk-ant-ort") {
        return no("Токен подписки Claude: его можно использовать только в Claude Code");
    }
    if secret.starts_with("ya29.") || secret.starts_with("1//") {
        return no("Токен входа Google (Gemini): вне Gemini CLI он не работает");
    }
    if let Some(p) = jwt_payload(secret) {
        // Сессии ChatGPT и Codex.
        let s = p.to_string().to_lowercase();
        if s.contains("api.openai.com/auth") || s.contains("chatgpt") || s.contains("auth.openai.com") {
            return no("Токен входа ChatGPT/Codex: вне Codex он не работает как ключ");
        }
        return ok("openai", None);
    }
    if secret.starts_with("sk-ant-") {
        return ok("anthropic", Some("https://api.anthropic.com"));
    }
    if secret.starts_with("sk-or-") {
        return ok("openai", Some("https://openrouter.ai/api/v1"));
    }
    if secret.starts_with("gsk_") {
        return ok("openai", Some("https://api.groq.com/openai/v1"));
    }
    if secret.starts_with("xai-") {
        return ok("openai", Some("https://api.x.ai/v1"));
    }
    if secret.starts_with("pplx-") {
        return ok("openai", Some("https://api.perplexity.ai"));
    }
    if secret.starts_with("AIza") {
        return ok("google", Some("https://generativelanguage.googleapis.com"));
    }
    if secret.starts_with("sk-") {
        return ok("openai", Some("https://api.openai.com/v1"));
    }
    ok("openai", None)
}

/// Адрес API, который агент сам записал в файле (baseURL, endpoint…): только https или http на этом компьютере.
pub fn guess_base_url(value: &Value) -> Option<String> {
    fn find(v: &Value, depth: usize, budget: &mut usize) -> Option<String> {
        if depth > MAX_DEPTH || *budget == 0 {
            return None;
        }
        *budget -= 1;
        match v {
            Value::Object(map) => {
                for (k, val) in map {
                    let kn: String = k.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
                    if let Value::String(s) = val {
                        if ["baseurl", "apibase", "apiurl", "endpoint", "baseuri", "apiendpoint"].contains(&kn.as_str()) {
                            let t = s.trim().trim_end_matches('/');
                            let local = t.starts_with("http://localhost") || t.starts_with("http://127.0.0.1");
                            if (t.starts_with("https://") || local) && t.len() <= 200 && !t.contains(char::is_whitespace) {
                                return Some(t.to_string());
                            }
                        }
                    }
                }
                map.values().find_map(|x| find(x, depth + 1, budget))
            }
            Value::Array(a) => a.iter().take(10).find_map(|x| find(x, depth + 1, budget)),
            _ => None,
        }
    }
    let mut budget = MAX_NODES;
    find(value, 0, &mut budget)
}

/// Адрес API для ключа по пути `pointer`: ближайший объект выше по дереву, где записан baseUrl; если такого нет, то
/// общий адрес файла, но только когда он в файле один.
pub fn base_url_near(value: &Value, pointer: &str) -> Option<String> {
    let mut parts: Vec<&str> = pointer.trim_start_matches('/').split('/').collect();
    while !parts.is_empty() {
        parts.pop();
        let p = if parts.is_empty() { String::new() } else { format!("/{}", parts.join("/")) };
        if let Some(obj) = value.pointer(&p) {
            if obj.is_object() {
                // Только прямые поля этого объекта.
                let direct = match obj {
                    Value::Object(m) => Value::Object(m.iter().filter(|(_, v)| v.is_string()).map(|(k, v)| (k.clone(), v.clone())).collect()),
                    _ => Value::Null,
                };
                if let Some(u) = guess_base_url(&direct) {
                    return Some(u);
                }
            }
        }
    }
    let mut all = Vec::new();
    collect_urls(value, 0, &mut all);
    all.sort();
    all.dedup();
    if all.len() == 1 { all.pop() } else { None }
}

fn collect_urls(v: &Value, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_DEPTH || out.len() > 20 {
        return;
    }
    match v {
        Value::Object(m) => {
            if let Some(u) = guess_base_url(&Value::Object(m.iter().filter(|(_, v)| v.is_string()).map(|(k, v)| (k.clone(), v.clone())).collect())) {
                out.push(u);
            }
            for x in m.values() {
                collect_urls(x, depth + 1, out);
            }
        }
        Value::Array(a) => a.iter().take(20).for_each(|x| collect_urls(x, depth + 1, out)),
        _ => {}
    }
}

/// Протокол по адресу: «…/anthropic» — Anthropic-совместимый, googleapis — Google; иначе по виду ключа.
pub fn kind_for_url(url: &str, fallback: &str) -> String {
    let u = url.to_lowercase();
    if u.contains("anthropic") {
        "anthropic".into()
    } else if u.contains("generativelanguage.googleapis.com") {
        "google".into()
    } else {
        fallback.into()
    }
}

fn preview(secret: &str) -> String {
    let head: String = secret.chars().take(4.min(secret.chars().count() / 4)).collect();
    format!("{head}… ({} симв.)", secret.chars().count())
}

fn is_blocked_path(home: &Path, file: &Path) -> bool {
    match file.strip_prefix(home) {
        Ok(rest) => rest.components().any(|c| {
            let n = c.as_os_str().to_string_lossy().to_lowercase();
            BLOCKED_PATHS.contains(&n.as_str()) || n.starts_with("claude") || n.starts_with(".claude")
        }),
        Err(_) => false,
    }
}

/// Агент, вход которого использовать нельзя: из списка и всё, что называется claude… (приложение, данные, CLI).
pub fn agent_blocked(id: &str) -> bool {
    BLOCKED_AGENTS.contains(&id) || id.starts_with("found-claude") || id == "found-codex" || id == "found-gemini"
}

/// Папки агента по его id (известный — по списку, найденный общим способом — по имени папки).
fn agent_dirs(home: &Path, id: &str) -> Vec<PathBuf> {
    if let Some(k) = KNOWN.iter().find(|k| k.id == id) {
        return k.dirs.iter().map(|d| home.join(d)).filter(|d| d.is_dir()).collect();
    }
    let Some(name) = id.strip_prefix("found-") else { return Vec::new() };
    let mut out = Vec::new();
    for base in [home.to_path_buf(), home.join(".config"), home.join(".local/share"), home.join("AppData/Roaming"), home.join("AppData/Local")] {
        if let Ok(rd) = fs::read_dir(&base) {
            for e in rd.flatten().take(500) {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if n.trim_start_matches('.') == name && e.file_type().map(|t| t.is_dir() && !t.is_symlink()).unwrap_or(false) {
                    out.push(e.path());
                }
            }
        }
    }
    out
}

/// Ключи, найденные у агента. Сами значения не возвращаются.
pub fn list_keys(home: &Path, agent_id: &str) -> Result<Vec<KeyCandidate>, String> {
    if agent_blocked(agent_id) {
        return Err(BLOCKED_NOTE.into());
    }
    let mut files: Vec<PathBuf> = Vec::new();
    for d in agent_dirs(home, agent_id) {
        files.extend(cred_files(&d));
    }
    if let Some(name) = agent_id.strip_prefix("found-") {
        // Файл вида ~/.name.json в домашней папке.
        let f = home.join(format!(".{name}.json"));
        if f.is_file() {
            files.push(f);
        }
    }
    let mut out = Vec::new();
    for f in files {
        if is_blocked_path(home, &f) {
            continue;
        }
        let limit = if f.parent() == Some(home) { MAX_ROOT_FILE_BYTES } else { MAX_FILE_BYTES };
        let Some(v) = read_json(&f, limit) else { continue };
        let mut seen: HashSet<String> = HashSet::new();
        for (ptr, secret) in collect_secrets(&v) {
            // Один и тот же ключ часто записан дважды (apiKey и apiKeyPool.0.key): показываем один раз.
            if !seen.insert(secret.clone()) {
                continue;
            }
            let c = classify_token(&secret);
            let file = display(home, &f);
            let base_url = base_url_near(&v, &ptr).or_else(|| c.base_url.map(String::from));
            let kind = base_url.as_deref().map(|u| kind_for_url(u, c.kind)).unwrap_or_else(|| c.kind.into());
            out.push(KeyCandidate {
                id: format!("{file}|{ptr}"),
                file,
                field: pointer_to_field(&ptr),
                preview: preview(&secret),
                kind,
                base_url,
                blocked: c.blocked.map(String::from),
            });
            if out.len() >= MAX_CANDIDATES {
                return Ok(out);
            }
        }
    }
    Ok(out)
}

/// Идентификатор провайдера для подключённого ключа: всегда с префиксом `agent-`, чтобы нельзя было перезаписать ключ
/// существующего провайдера (openai, anthropic…).
pub fn valid_provider_id(id: &str) -> bool {
    id.len() >= 8
        && id.len() <= 40
        && id.starts_with("agent-")
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.ends_with('-')
}

/// Читает выбранный ключ из файла и отдаёт его в `store` (запись в хранилище ключей). Значение никуда больше не уходит.
pub fn import_key(home: &Path, candidate_id: &str, provider_id: &str, store: impl FnOnce(&str, &str) -> Result<(), String>) -> Result<(), String> {
    if !valid_provider_id(provider_id) {
        return Err("Некорректный идентификатор провайдера (agent-…)".into());
    }
    let (file_disp, pointer) = candidate_id.split_once('|').ok_or("Некорректный выбор ключа")?;
    let rest = file_disp.strip_prefix("~\\").or_else(|| file_disp.strip_prefix("~/")).ok_or("Файл должен лежать в вашей домашней папке")?;
    if rest.split(['\\', '/']).any(|p| p == ".." || p.is_empty()) {
        return Err("Некорректный путь к файлу".into());
    }
    let home_canon = home.canonicalize().map_err(|e| e.to_string())?;
    let file = home.join(rest.replace('\\', "/")).canonicalize().map_err(|_| "Файл не найден".to_string())?;
    let file = crate::strip_verbatim(file);
    let home_canon = crate::strip_verbatim(home_canon);
    if !file.starts_with(&home_canon) {
        return Err("Файл вне вашей домашней папки".into());
    }
    if is_blocked_path(&home_canon, &file) {
        return Err(BLOCKED_NOTE.into());
    }
    let name = file.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let in_root = file.parent() == Some(home_canon.as_path());
    let allowed = CRED_FILES.contains(&name.as_str()) || (in_root && name.starts_with('.') && name.ends_with(".json"));
    if !allowed {
        return Err("Этот файл не похож на файл входа агента".into());
    }
    let value = read_json(&file, if in_root { MAX_ROOT_FILE_BYTES } else { MAX_FILE_BYTES }).ok_or("Не удалось прочитать файл")?;
    let secret = value.pointer(pointer).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).ok_or("Значение не найдено: файл изменился?")?;
    if let Some(reason) = classify_token(secret).blocked {
        return Err(reason.into());
    }
    store(provider_id, secret)
}

#[tauri::command]
pub async fn list_agent_keys(agent_id: String) -> Result<Vec<KeyCandidate>, String> {
    let home = dirs_next::home_dir().ok_or("Не удалось определить домашнюю папку")?;
    tauri::async_runtime::spawn_blocking(move || list_keys(&home, &agent_id)).await.map_err(|e| e.to_string())?
}

/// Подключает выбранный ключ агента как провайдера: сохраняет его в хранилище ключей Windows. Адрес и протокол
/// провайдера интерфейс добавляет сам, после успешного ответа этой команды.
#[tauri::command]
pub async fn import_agent_key(candidate_id: String, provider_id: String) -> Result<(), String> {
    let home = dirs_next::home_dir().ok_or("Не удалось определить домашнюю папку")?;
    tauri::async_runtime::spawn_blocking(move || {
        import_key(&home, &candidate_id, &provider_id, |id, key| crate::ai_service::set_api_key(id.to_string(), key.to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
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

    #[test]
    fn tokens_are_classified_by_shape() {
        assert!(classify_token("sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaa").blocked.is_some());
        assert!(classify_token("sk-ant-ort01-aaaaaaaaaaaaaaaaaaaaaaaa").blocked.is_some());
        assert!(classify_token("ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxx").blocked.is_some());
        let chatgpt = jwt(json!({"https://api.openai.com/auth": {"chatgpt_plan_type": "plus"}}));
        assert!(classify_token(&chatgpt).blocked.is_some());
        // обычный JWT стороннего сервиса не запрещён
        assert!(classify_token(&jwt(json!({"sub": "user1", "iss": "https://agent.example"}))).blocked.is_none());
        assert_eq!(classify_token("sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa"), TokenClass { kind: "anthropic", base_url: Some("https://api.anthropic.com"), blocked: None });
        assert_eq!(classify_token("sk-or-v1-aaaaaaaaaaaaaaaaaaaa").base_url, Some("https://openrouter.ai/api/v1"));
        assert_eq!(classify_token("gsk_aaaaaaaaaaaaaaaaaaaaaaaa").base_url, Some("https://api.groq.com/openai/v1"));
        assert_eq!(classify_token("AIzaSyAaaaaaaaaaaaaaaaaaaaaa").kind, "google");
        assert_eq!(classify_token("sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaa").base_url, Some("https://api.openai.com/v1"));
        assert_eq!(classify_token("some-random-key-0123456789abcdef"), TokenClass { kind: "openai", base_url: None, blocked: None });
    }

    #[test]
    fn secrets_are_collected_with_their_paths_but_refresh_tokens_are_skipped() {
        let v = json!({"a/b": {"apiKey": "k".repeat(30)}, "list": [{"token": "t".repeat(30)}], "refresh_token": "r".repeat(30), "name": "short", "note": "some words here with spaces and more text", "id": "plain"});
        let found = collect_secrets(&v);
        let ptrs: Vec<&str> = found.iter().map(|(p, _)| p.as_str()).collect();
        assert!(ptrs.contains(&"/a~1b/apiKey") && ptrs.contains(&"/list/0/token"), "{ptrs:?}");
        assert!(!ptrs.iter().any(|p| p.contains("refresh")) && !ptrs.contains(&"/name") && !ptrs.contains(&"/note"));
        assert_eq!(pointer_to_field("/tokens/api_key"), "tokens.api_key");
        // путь работает как JSON Pointer
        assert_eq!(v.pointer("/a~1b/apiKey").and_then(Value::as_str), Some("k".repeat(30).as_str()));
    }

    #[test]
    fn base_urls_come_from_the_file_only_when_safe() {
        assert_eq!(guess_base_url(&json!({"provider": {"x": {"options": {"baseURL": "https://api.example.com/v1/"}}}})).as_deref(), Some("https://api.example.com/v1"));
        assert_eq!(guess_base_url(&json!({"endpoint": "http://localhost:8080/v1"})).as_deref(), Some("http://localhost:8080/v1"));
        for bad in [json!({"baseUrl": "http://evil.example.com"}), json!({"baseUrl": "ftp://x"}), json!({"baseUrl": "https://a b"}), json!({"theme": "https://fine.com"})] {
            assert_eq!(guess_base_url(&bad), None, "{bad}");
        }
    }

    #[test]
    fn provider_ids_must_be_agent_prefixed() {
        for ok in ["agent-genspark", "agent-my-tool-2"] {
            assert!(valid_provider_id(ok), "{ok}");
        }
        for bad in ["openai", "anthropic", "agent-", "agent-X", "agent_x_y_z", "agent-a/b", "agent-ends-", &format!("agent-{}", "a".repeat(40))] {
            assert!(!valid_provider_id(bad), "{bad}");
        }
    }

    #[test]
    fn importing_a_key_is_limited_to_allowed_agents_and_files() {
        let home = std::env::temp_dir().join(format!("aide-keys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        let w = |rel: &str, v: Value| {
            let p = home.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, serde_json::to_string(&v).unwrap()).unwrap();
        };
        let key = format!("sk-or-v1-{}", "a".repeat(40));
        w(".zzagent/auth.json", json!({"apiKey": key, "baseUrl": "https://api.zz.example/v1", "refresh_token": "r".repeat(40)}));
        w(".claude/.credentials.json", json!({"claudeAiOauth": {"accessToken": format!("sk-ant-oat01-{}", "b".repeat(40))}}));
        w(".codex/auth.json", json!({"OPENAI_API_KEY": format!("sk-{}", "c".repeat(40))}));
        w(".zzagent/notes.json", json!({"secretKey": "d".repeat(40)}));
        w(".gemini/oauth_creds.json", json!({"access_token": format!("ya29.{}", "e".repeat(40))}));

        // список: у разрешённого агента один ключ, адрес из файла, значения в ответе нет
        let list = list_keys(&home, "found-zzagent").unwrap();
        assert_eq!(list.len(), 1, "{list:#?}");
        assert_eq!(list[0].field, "apiKey");
        assert_eq!(list[0].base_url.as_deref(), Some("https://api.zz.example/v1"));
        assert!(list[0].blocked.is_none());
        assert!(!format!("{list:?}").contains(&"a".repeat(20)), "значение ключа попало в список");
        // запрещённые агенты
        for id in ["claude-code", "codex", "gemini"] {
            assert!(list_keys(&home, id).is_err(), "{id}");
        }

        // подключение: ключ уходит в хранилище целиком и только туда
        let mut stored: Option<(String, String)> = None;
        import_key(&home, &list[0].id, "agent-zzagent", |id, k| {
            stored = Some((id.into(), k.into()));
            Ok(())
        })
        .unwrap();
        assert_eq!(stored, Some(("agent-zzagent".into(), key.clone())));

        // отказы: чужой провайдер, обход путей, запрещённые папки, файл не из списка, подделанный путь
        let deny = |id: &str, provider: &str| import_key(&home, id, provider, |_, _| panic!("не должно дойти до записи")).unwrap_err();
        deny(&list[0].id, "openai");
        deny("~\\.zzagent\\..\\.claude\\.credentials.json|/claudeAiOauth/accessToken", "agent-x-1");
        deny("~\\.claude\\.credentials.json|/claudeAiOauth/accessToken", "agent-claude-1");
        deny("~\\.codex\\auth.json|/OPENAI_API_KEY", "agent-codex-1");
        deny("~\\.gemini\\oauth_creds.json|/access_token", "agent-gemini-1");
        deny("~\\.zzagent\\notes.json|/secretKey", "agent-notes-1");
        deny("C:\\Windows\\win.ini|/x", "agent-win-1");
        deny("~\\.zzagent\\auth.json|/nope", "agent-nope-1");
        deny("без разделителя", "agent-x-1");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn desktop_agent_with_deep_files_is_seen_as_signed_in_and_offers_its_local_proxy_key() {
        let home = std::env::temp_dir().join(format!("aide-deep-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        let w = |rel: &str, v: Value| {
            let p = home.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, serde_json::to_string(&v).unwrap()).unwrap();
        };
        w(".deepai-code/userdata/deepai/pi/deepai/auth.json", json!({}));
        w(".deepai-code/userdata/deepai/pi/deepai/models.json", json!({"providers": {"deepai": {"baseUrl": "http://127.0.0.1:51499", "apiKey": "k".repeat(64), "models": [{"id": "m1"}]}}}));
        w(".deepai-code/userdata/deepai-history/ownership.json", json!({"owners": {"u1": {"accountId": "abcdef0123456789".repeat(4)}}}));
        // кэши и вложения не разбираются, даже если там что-то похожее
        w(".deepai-code/caches/auth.json", json!({"apiKey": "z".repeat(64)}));

        let list = scan(&home);
        let a = list.iter().find(|a| a.id == "found-deepai-code").expect("deepai");
        assert!(a.signed_in, "{a:#?}");
        assert!(a.facts.iter().any(|(k, v)| k == "Аккаунт" && v == "abcdef…"), "{:?}", a.facts);
        let keys = list_keys(&home, "found-deepai-code").unwrap();
        assert_eq!(keys.len(), 1, "{keys:#?}");
        assert_eq!(keys[0].field, "providers.deepai.apiKey");
        assert_eq!(keys[0].base_url.as_deref(), Some("http://127.0.0.1:51499"));
        let dump = format!("{list:?}{keys:?}");
        assert!(!dump.contains("kkkkkkkkkk") && !dump.contains("zzzzzzzzzz") && !dump.contains("abcdef0123456789abcdef"), "секрет или полный идентификатор в ответе");
        let _ = fs::remove_dir_all(&home);
    }

    /// Живая проверка списка ключей (только описания: поле, файл, начало и длина; значения не печатаются).
    #[test]
    #[ignore]
    fn live_keys_of_found_agents() {
        let home = dirs_next::home_dir().unwrap();
        for a in scan(&home) {
            match list_keys(&home, &a.id) {
                Ok(keys) => println!("{} -> {} ключ(ей)", a.id, keys.len()),
                Err(e) => println!("{} -> отказ: {}", a.id, e.chars().take(60).collect::<String>()),
            }
            for k in list_keys(&home, &a.id).unwrap_or_default() {
                println!("    {} | {} | {} | kind={} | url={:?} | blocked={:?}", k.field, k.file, k.preview, k.kind, k.base_url, k.blocked.map(|b| b.chars().take(30).collect::<String>()));
            }
        }
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
