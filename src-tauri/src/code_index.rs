//! Индекс кода: агент (и человек) находит нужные файлы и места сам, а не листает папки вслепую.
//!
//! Что внутри:
//! - символы (функции, классы, типы, константы, методы) — по строкам, регулярными выражениями для основных языков;
//! - ранжированный поиск (BM25) по фрагментам файлов: имена разбиваются по camelCase и snake_case,
//!   имена символов и пути файлов весят больше обычного текста — запрос «user login» находит `loginUser` и `auth/login.ts`;
//! - карта проекта: какие файлы есть и что в них определено, самые «востребованные» файлы — первыми.
//!
//! Индекс живёт в памяти и строится при первом обращении; перед каждым запросом дёшево обновляется
//! (сравнение размера и времени изменения файлов), поэтому правки агента видны сразу, без наблюдателя за файлами.
//!
//! Безопасность: индексируются только известные текстовые расширения (файлы `.env`, ключи и бинарники не попадают),
//! учитывается .gitignore, размеры и количество файлов ограничены; пути из запросов агента служат только фильтром
//! по уже проиндексированным путям — на диск они не попадают.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 400 * 1024;
const MAX_JSON_BYTES: u64 = 100 * 1024;
const MAX_AVG_LINE: usize = 300;
const CHUNK_LINES: usize = 30;
const CHUNK_STRIDE: usize = 24;
const W_BODY: u16 = 2;
const W_SYMBOL: u16 = 6;
const W_PATH: u16 = 3;
const SKIP_DIRS: [&str; 22] = [
    "node_modules", "target", "dist", "build", "out", "coverage", "vendor", "venv", "__pycache__", "bower_components",
    "Pods", "obj", "bin", "packages", "site-packages", "tmp", "temp", "logs", "release", "artifacts", "deps", "third_party",
];
const SKIP_FILES: [&str; 8] = [
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "composer.lock", "Gemfile.lock", "poetry.lock", "bun.lockb",
];
const NO_EXT_NAMES: [&str; 7] = ["Dockerfile", "Makefile", "README", "LICENSE", "Procfile", "Rakefile", "Gemfile"];
const KEYWORDS: [&str; 28] = [
    "if", "for", "while", "switch", "catch", "return", "function", "else", "do", "with", "await", "typeof", "new", "sizeof",
    "throw", "delete", "case", "using", "namespace", "foreach", "elseif", "unless", "until", "when", "match", "loop", "fn", "in",
];
const QUERY_STOP: [&str; 31] = [
    "the", "an", "of", "in", "to", "for", "and", "or", "is", "are", "do", "does", "where", "how", "what", "which", "when", "with",
    "that", "this", "from", "by", "on", "at", "as", "be", "it", "its", "code", "file", "files",
];

/* ───────────── Types ───────────── */

#[derive(Clone, Debug)]
struct Symbol {
    name: String,
    kind: &'static str,
    line: u32,
    container: Option<String>,
    sig: String,
}

struct Chunk {
    start: u32,
    end: u32,
    len: u32,
    /// (id термина, вес), по возрастанию id.
    terms: Vec<(u32, u16)>,
}

struct FileEntry {
    mtime_ms: u64,
    size: u64,
    lang: &'static str,
    lines: u32,
    symbols: Vec<Symbol>,
    chunks: Vec<Chunk>,
}

pub struct Index {
    root: PathBuf,
    files: HashMap<String, FileEntry>,
    dict: HashMap<String, u32>,
    df: Vec<u32>,
    total_chunks: usize,
    total_len: u64,
    truncated: bool,
    last_build_ms: u64,
    updated_at: u64,
}

#[derive(Default)]
pub struct CodeIndexState(Mutex<Option<Index>>);

struct Listed {
    rel: String,
    abs: PathBuf,
    size: u64,
    mtime_ms: u64,
}

struct ParsedChunk {
    start: u32,
    end: u32,
    len: u32,
    counts: HashMap<String, u16>,
}

struct Parsed {
    rel: String,
    mtime_ms: u64,
    size: u64,
    lang: &'static str,
    lines: u32,
    symbols: Vec<Symbol>,
    chunks: Vec<ParsedChunk>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub files: usize,
    pub lines: u64,
    pub symbols: usize,
    pub chunks: usize,
    pub terms: usize,
    pub truncated: bool,
    pub build_ms: u64,
    pub updated_at: u64,
    pub languages: Vec<(String, usize)>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub score: f32,
    pub symbols: Vec<String>,
    pub snippet: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymbolHit {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub container: Option<String>,
    pub signature: String,
}

/* ───────────── Tokens ───────────── */

fn stem(t: &str) -> String {
    if t.len() > 3 && t.ends_with('s') && !t.ends_with("ss") && !t.ends_with("us") && !t.ends_with("is") {
        t[..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

/// Части идентификатора: snake_case и camelCase/PascalCase, буквы и цифры отдельно (HTTPServer → http, server).
fn split_parts(run: &str) -> Vec<String> {
    let mut parts = Vec::new();
    for piece in run.split('_').filter(|p| !p.is_empty()) {
        let chars: Vec<char> = piece.chars().collect();
        let mut cur = String::new();
        for i in 0..chars.len() {
            let c = chars[i];
            if i > 0 {
                let p = chars[i - 1];
                let next_lower = chars.get(i + 1).is_some_and(|n| n.is_lowercase());
                let boundary = (p.is_lowercase() && c.is_uppercase())
                    || (p.is_uppercase() && c.is_uppercase() && next_lower)
                    || (p.is_alphabetic() != c.is_alphabetic() && (p.is_numeric() || c.is_numeric()));
                if boundary && !cur.is_empty() {
                    parts.push(std::mem::take(&mut cur));
                }
            }
            cur.push(c);
        }
        if !cur.is_empty() {
            parts.push(cur);
        }
    }
    parts
}

/// Все термины текста с весом: каждая часть идентификатора и, для составных, идентификатор целиком.
fn add_tokens(text: &str, weight: u16, counts: &mut HashMap<String, u16>) {
    let mut run = String::new();
    let flush = |run: &mut String, counts: &mut HashMap<String, u16>| {
        if run.is_empty() {
            return;
        }
        if run.chars().count() <= 64 && run.chars().any(|c| c.is_alphabetic()) {
            let parts = split_parts(run);
            for p in &parts {
                let t = p.to_lowercase();
                if t.chars().count() >= 2 && t.chars().count() <= 32 && t.chars().any(|c| c.is_alphabetic()) {
                    *counts.entry(stem(&t)).or_insert(0) += weight;
                }
            }
            if parts.len() > 1 {
                let whole = run.replace('_', "").to_lowercase();
                if whole.chars().count() <= 48 {
                    *counts.entry(whole).or_insert(0) += weight;
                }
            }
        }
        run.clear();
    };
    for c in text.chars() {
        if c.is_alphanumeric() || c == '_' {
            run.push(c);
        } else {
            flush(&mut run, counts);
        }
    }
    flush(&mut run, counts);
}

fn query_terms(query: &str) -> Vec<String> {
    let mut counts = HashMap::new();
    add_tokens(query, 1, &mut counts);
    let mut v: Vec<String> = counts.into_keys().filter(|t| !QUERY_STOP.contains(&t.as_str())).collect();
    v.sort();
    v
}

/* ───────────── Languages and symbols ───────────── */

fn lang_of(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    if NO_EXT_NAMES.contains(&name) {
        return Some("text");
    }
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" | "vue" | "svelte" | "astro" => "js",
        "py" | "pyi" => "py",
        "rs" => "rs",
        "go" => "go",
        "java" | "kt" | "kts" | "cs" | "scala" | "groovy" => "java",
        "swift" | "php" | "rb" | "lua" | "dart" => "script",
        "c" | "h" | "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "c",
        "md" | "mdx" => "md",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "sh",
        "css" | "scss" | "less" | "html" | "htm" | "xml" | "json" | "jsonc" | "yaml" | "yml" | "toml" | "txt" | "ini" | "cfg" | "ps1"
        | "bat" | "cmd" | "svg" | "graphql" | "proto" => "text",
        _ => return None,
    })
}

enum KindSrc {
    Fixed(&'static str),
    Group(usize),
}

struct SymRule {
    re: Regex,
    kind: KindSrc,
    name: usize,
    container: Option<usize>,
    class_like: bool,
    needs_container: bool,
}

fn rule(pat: &str, kind: KindSrc, name: usize) -> SymRule {
    SymRule { re: Regex::new(pat).expect("symbol regex"), kind, name, container: None, class_like: false, needs_container: false }
}
fn class_rule(pat: &str, kind: KindSrc, name: usize) -> SymRule {
    SymRule { class_like: true, ..rule(pat, kind, name) }
}

fn rules() -> &'static HashMap<&'static str, Vec<SymRule>> {
    static RULES: OnceLock<HashMap<&'static str, Vec<SymRule>>> = OnceLock::new();
    RULES.get_or_init(|| {
        use KindSrc::{Fixed, Group};
        let mut m: HashMap<&'static str, Vec<SymRule>> = HashMap::new();
        let id = r"[A-Za-z_$][\w$]*";
        m.insert("js", vec![
            class_rule(&format!(r"^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+({id})"), Fixed("class"), 1),
            class_rule(&format!(r"^\s*(?:export\s+)?(?:declare\s+)?interface\s+({id})"), Fixed("interface"), 1),
            rule(&format!(r"^\s*(?:export\s+)?(?:declare\s+)?type\s+({id})\s*(?:<[^=]*>)?\s*="), Fixed("type"), 1),
            rule(&format!(r"^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+({id})"), Fixed("enum"), 1),
            rule(&format!(r"^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*({id})"), Fixed("function"), 1),
            rule(&format!(r"^\s*(?:export\s+)?(?:const|let|var)\s+({id})\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|{id}\s*=>)"), Fixed("function"), 1),
            rule(&format!(r"^\s*export\s+(?:const|let|var)\s+({id})"), Fixed("const"), 1),
            SymRule {
                needs_container: true,
                ..rule(&format!(r"^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*(?:\*\s*)?({id})\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{{;=]+)?\{{"), Fixed("method"), 1)
            },
        ]);
        m.insert("py", vec![
            class_rule(r"^\s*class\s+([A-Za-z_]\w*)", Fixed("class"), 1),
            rule(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)", Fixed("function"), 1),
            rule(r"^([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=", Fixed("const"), 1),
        ]);
        let vis = r"(?:pub(?:\([^)]*\))?\s+)?";
        m.insert("rs", vec![
            rule(&format!(r#"^\s*{vis}(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)"#), Fixed("function"), 1),
            class_rule(&format!(r"^\s*{vis}struct\s+([A-Za-z_]\w*)"), Fixed("struct"), 1),
            class_rule(&format!(r"^\s*{vis}enum\s+([A-Za-z_]\w*)"), Fixed("enum"), 1),
            class_rule(&format!(r"^\s*{vis}trait\s+([A-Za-z_]\w*)"), Fixed("trait"), 1),
            class_rule(r"^\s*(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:[\w:<>,\s&'+?]+?\s+for\s+)?([A-Za-z_]\w*)", Fixed("impl"), 1),
            rule(&format!(r"^\s*{vis}type\s+([A-Za-z_]\w*)"), Fixed("type"), 1),
            rule(&format!(r"^\s*{vis}mod\s+([A-Za-z_]\w*)\s*[{{;]"), Fixed("mod"), 1),
            rule(&format!(r"^\s*{vis}(?:const|static)\s+(?:mut\s+)?([A-Z_][A-Z0-9_]*)\s*:"), Fixed("const"), 1),
        ]);
        m.insert("go", vec![
            SymRule { container: Some(1), ..rule(r"^func\s+(?:\(\s*(?:\w+\s+)?\*?(\w+)(?:\[[^\]]*\])?\s*\)\s*)?([A-Za-z_]\w*)", Fixed("function"), 2) },
            class_rule(r"^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b", Fixed("type"), 1),
            rule(r"^type\s+([A-Za-z_]\w*)\s", Fixed("type"), 1),
            rule(r"^(?:const|var)\s+([A-Za-z_]\w*)\s", Fixed("const"), 1),
        ]);
        let cstyle = r"^\s*(?:[\w<>\[\],.?*&:]+\s+)+\**&?([A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:throws\s+[\w.,\s]+)?\s*\{?\s*$";
        m.insert("java", vec![
            class_rule(r"^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inner|annotation)\s+)*(class|interface|enum|struct|object|trait|record|namespace)\s+([A-Za-z_]\w*)", Group(1), 2),
            rule(r"^\s*(?:(?:public|private|protected|internal|override|open|suspend|inline|abstract|final)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?([A-Za-z_]\w*)", Fixed("function"), 1),
            rule(cstyle, Fixed("method"), 1),
        ]);
        m.insert("script", vec![
            class_rule(r"^\s*(?:(?:public|private|protected|internal|open|final|abstract|static|export)\s+)*(class|struct|enum|protocol|extension|interface|trait|module|namespace)\s+([A-Za-z_]\w*)", Group(1), 2),
            rule(r"^\s*(?:(?:public|private|protected|internal|open|final|static|override|mutating|async)\s+)*(?:function|func|def|fn)\s+(?:self\.)?([A-Za-z_]\w*[?!]?)", Fixed("function"), 1),
        ]);
        m.insert("c", vec![
            class_rule(r"^\s*(?:template\s*<[^>]*>\s*)?(class|struct|enum(?:\s+class)?|union|namespace)\s+([A-Za-z_]\w*)", Group(1), 2),
            rule(cstyle, Fixed("function"), 1),
        ]);
        m.insert("sql", vec![rule(r#"(?i)^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|function|procedure|index|trigger)\s+(?:if\s+not\s+exists\s+)?["`\[]?([\w.]+)"#, Group(1), 2)]);
        m.insert("sh", vec![rule(r"^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?", Fixed("function"), 1)]);
        m
    })
}

/// Насколько файл «обычно по делу» для поиска по коду. Файлы переводов, снимков и сгенерированные содержат каждое слово
/// интерфейса и вытесняли бы настоящий код; документация и данные уступают коду, но находятся, если кода по теме нет.
fn file_prior(rel: &str, lang: &str) -> f32 {
    let lower = rel.to_lowercase();
    let mut prior = 1.0f32;
    if ["/i18n/", "/locales/", "/locale/", "translations", "/fixtures/", "snapshots", "/generated/", "changelog"].iter().any(|m| lower.contains(m)) || lower.starts_with("i18n/") || lower.starts_with("locales/") {
        prior *= 0.5;
    }
    if lang == "md" || lang == "text" {
        prior *= 0.8;
    }
    prior
}

fn clip(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(max).collect::<String>())
    }
}

fn indent_of(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ' || *c == '\t').map(|c| if c == '\t' { 4 } else { 1 }).sum()
}

fn extract_symbols(lang: &str, lines: &[&str]) -> Vec<Symbol> {
    let mut out = Vec::new();
    if lang == "md" {
        static HEAD: OnceLock<Regex> = OnceLock::new();
        let re = HEAD.get_or_init(|| Regex::new(r"^(#{1,4})\s+(.+?)\s*#*\s*$").expect("md regex"));
        for (i, l) in lines.iter().enumerate() {
            if let Some(c) = re.captures(l) {
                let level = c[1].len();
                out.push(Symbol {
                    name: clip(&c[2], 80),
                    kind: "section",
                    line: i as u32 + 1,
                    container: if level > 2 { Some("…".into()) } else { None },
                    sig: clip(l, 140),
                });
            }
        }
        return out;
    }
    let Some(list) = rules().get(lang) else { return out };
    let mut stack: Vec<(usize, String)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.len() > MAX_AVG_LINE {
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('*') || trimmed.starts_with("/*") || (lang == "py" && trimmed.starts_with('#')) {
            continue;
        }
        let ind = indent_of(line);
        while stack.last().is_some_and(|(i0, _)| *i0 >= ind) {
            stack.pop();
        }
        for r in list {
            if r.needs_container && stack.is_empty() {
                continue;
            }
            let Some(c) = r.re.captures(line) else { continue };
            let name = c.get(r.name).map(|m| m.as_str()).unwrap_or("");
            if name.is_empty() || KEYWORDS.contains(&name) {
                continue;
            }
            let kind: &'static str = match &r.kind {
                KindSrc::Fixed(k) => k,
                KindSrc::Group(g) => match c.get(*g).map(|m| m.as_str().to_lowercase()).as_deref() {
                    Some("class") => "class",
                    Some("interface") => "interface",
                    Some("struct") => "struct",
                    Some("enum") | Some("enum class") => "enum",
                    Some("trait") => "trait",
                    Some("table") => "table",
                    Some("view") => "view",
                    Some("function") | Some("procedure") => "function",
                    Some("namespace") | Some("module") => "namespace",
                    _ => "type",
                },
            };
            let mut container = r.container.and_then(|g| c.get(g)).map(|m| m.as_str().to_string()).or_else(|| stack.last().map(|(_, n)| n.clone()));
            if r.class_like && kind != "namespace" {
                stack.push((ind, name.to_string()));
            }
            if kind == "namespace" {
                container = None;
            }
            out.push(Symbol { name: name.to_string(), kind, line: i as u32 + 1, container, sig: clip(line, 140) });
            break;
        }
    }
    out
}

/* ───────────── Walking the project ───────────── */

struct IgnoreRule {
    re: Regex,
    dir_only: bool,
    negate: bool,
}

fn glob_to_regex(glob: &str, anchored: bool) -> Option<Regex> {
    let mut re = String::from(if anchored { "^" } else { "(?:^|/)" });
    let chars: Vec<char> = glob.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' if chars.get(i + 1) == Some(&'*') => {
                if chars.get(i + 2) == Some(&'/') {
                    re.push_str("(?:.*/)?");
                    i += 3;
                } else {
                    re.push_str(".*");
                    i += 2;
                }
                continue;
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    re.push('$');
    Regex::new(&re).ok()
}

fn parse_gitignore(text: &str) -> Vec<IgnoreRule> {
    let mut rules = Vec::new();
    for raw in text.lines() {
        let mut l = raw.trim_end();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        let negate = l.starts_with('!');
        if negate {
            l = &l[1..];
        }
        let dir_only = l.ends_with('/');
        let l = l.trim_end_matches('/');
        let anchored = l.starts_with('/') || l.contains('/');
        let l = l.trim_start_matches('/');
        if l.is_empty() {
            continue;
        }
        if let Some(re) = glob_to_regex(l, anchored) {
            rules.push(IgnoreRule { re, dir_only, negate });
        }
    }
    rules
}

type IgnoreSet = Vec<Arc<(String, Vec<IgnoreRule>)>>;

fn ignored(stack: &IgnoreSet, rel: &str, is_dir: bool) -> bool {
    let mut result = false;
    for entry in stack {
        let (base, rules) = (&entry.0, &entry.1);
        let sub = if base.is_empty() {
            rel
        } else if let Some(s) = rel.strip_prefix(base.as_str()).and_then(|s| s.strip_prefix('/')) {
            s
        } else {
            continue;
        };
        for r in rules {
            if r.dir_only && !is_dir {
                continue;
            }
            if r.re.is_match(sub) {
                result = !r.negate;
            }
        }
    }
    result
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn walk(root: &Path) -> (Vec<Listed>, bool) {
    let mut out = Vec::new();
    // (папка, путь от корня, правила .gitignore родителей); .gitignore папки действует на неё и всё внутри.
    let mut stack: Vec<(PathBuf, String, IgnoreSet)> = vec![(root.to_path_buf(), String::new(), Vec::new())];
    while let Some((dir, rel_dir, mut ign)) = stack.pop() {
        if let Ok(text) = std::fs::read_to_string(dir.join(".gitignore")) {
            if text.len() < 256 * 1024 {
                ign.push(Arc::new((rel_dir.clone(), parse_gitignore(&text))));
            }
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue; // ссылки не обходим: они могут вести за пределы проекта
            }
            let rel = if rel_dir.is_empty() { name.clone() } else { format!("{rel_dir}/{name}") };
            if ft.is_dir() {
                if SKIP_DIRS.contains(&name.as_str()) || (name.starts_with('.') && name != ".github") || ignored(&ign, &rel, true) {
                    continue;
                }
                stack.push((e.path(), rel, ign.clone()));
            } else if ft.is_file() {
                if SKIP_FILES.contains(&name.as_str()) || name.ends_with(".min.js") || name.ends_with(".map") || name.ends_with(".lock") || name.starts_with(".env") {
                    continue;
                }
                if lang_of(&rel).is_none() || ignored(&ign, &rel, false) {
                    continue;
                }
                let Ok(meta) = e.metadata() else { continue };
                let limit = if rel.ends_with(".json") || rel.ends_with(".jsonc") { MAX_JSON_BYTES } else { MAX_FILE_BYTES };
                if meta.len() == 0 || meta.len() > limit {
                    continue;
                }
                if out.len() >= MAX_FILES {
                    return (out, true);
                }
                out.push(Listed { rel, abs: e.path(), size: meta.len(), mtime_ms: mtime_ms(&meta) });
            }
        }
    }
    (out, false)
}

/* ───────────── Parsing a file ───────────── */

fn parse_file(l: &Listed) -> Option<Parsed> {
    let lang = lang_of(&l.rel)?;
    let bytes = std::fs::read(&l.abs).ok()?;
    if bytes.len() as u64 > MAX_FILE_BYTES || bytes.contains(&0) {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() || text.len() / lines.len() > MAX_AVG_LINE {
        return None; // минифицированный или сгенерированный файл
    }
    let symbols = extract_symbols(lang, &lines);
    let mut path_tokens = HashMap::new();
    add_tokens(&l.rel.replace('/', " ").replace('.', " "), W_PATH, &mut path_tokens);
    let mut chunks = Vec::new();
    let n = lines.len();
    let mut start = 0;
    loop {
        let end = (start + CHUNK_LINES).min(n);
        let mut counts: HashMap<String, u16> = path_tokens.clone();
        for line in &lines[start..end] {
            if line.len() <= MAX_AVG_LINE * 2 {
                add_tokens(line, W_BODY, &mut counts);
            }
        }
        for s in symbols.iter().filter(|s| (s.line as usize) > start && (s.line as usize) <= end) {
            add_tokens(&s.name, W_SYMBOL, &mut counts);
        }
        let len: u32 = counts.values().map(|w| *w as u32).sum();
        chunks.push(ParsedChunk { start: start as u32 + 1, end: end as u32, len, counts });
        if end >= n {
            break;
        }
        start += CHUNK_STRIDE;
    }
    Some(Parsed { rel: l.rel.clone(), mtime_ms: l.mtime_ms, size: l.size, lang, lines: n as u32, symbols, chunks })
}

/* ───────────── The index ───────────── */

impl Index {
    pub fn new(root: PathBuf) -> Self {
        Index { root, files: HashMap::new(), dict: HashMap::new(), df: Vec::new(), total_chunks: 0, total_len: 0, truncated: false, last_build_ms: 0, updated_at: 0 }
    }

    fn remove(&mut self, rel: &str) {
        if let Some(f) = self.files.remove(rel) {
            for c in &f.chunks {
                for (t, _) in &c.terms {
                    if let Some(d) = self.df.get_mut(*t as usize) {
                        *d = d.saturating_sub(1);
                    }
                }
                self.total_len = self.total_len.saturating_sub(c.len as u64);
            }
            self.total_chunks = self.total_chunks.saturating_sub(f.chunks.len());
        }
    }

    fn insert(&mut self, p: Parsed) {
        self.remove(&p.rel);
        let mut chunks = Vec::with_capacity(p.chunks.len());
        for c in p.chunks {
            let mut terms: Vec<(u32, u16)> = Vec::with_capacity(c.counts.len());
            for (tok, w) in c.counts {
                let next = self.dict.len() as u32;
                let id = *self.dict.entry(tok).or_insert(next);
                if id as usize >= self.df.len() {
                    self.df.push(0);
                }
                self.df[id as usize] += 1;
                terms.push((id, w));
            }
            terms.sort_unstable_by_key(|(id, _)| *id);
            self.total_len += c.len as u64;
            self.total_chunks += 1;
            chunks.push(Chunk { start: c.start, end: c.end, len: c.len, terms });
        }
        self.files.insert(p.rel, FileEntry { mtime_ms: p.mtime_ms, size: p.size, lang: p.lang, lines: p.lines, symbols: p.symbols, chunks });
    }

    /// Приводит индекс в соответствие с диском: новые и изменённые файлы разбираются заново, удалённые уходят.
    pub fn refresh(&mut self) {
        let started = Instant::now();
        let (listing, truncated) = walk(&self.root);
        self.truncated = truncated;
        let present: HashSet<&str> = listing.iter().map(|l| l.rel.as_str()).collect();
        let gone: Vec<String> = self.files.keys().filter(|k| !present.contains(k.as_str())).cloned().collect();
        let mut changed = !gone.is_empty();
        for g in gone {
            self.remove(&g);
        }
        let todo: Vec<&Listed> = listing
            .iter()
            .filter(|l| self.files.get(&l.rel).map(|f| f.mtime_ms != l.mtime_ms || f.size != l.size).unwrap_or(true))
            .collect();
        if !todo.is_empty() {
            changed = true;
            let next = AtomicUsize::new(0);
            let results: Mutex<Vec<Parsed>> = Mutex::new(Vec::new());
            let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(1, 8).min(todo.len());
            std::thread::scope(|s| {
                for _ in 0..workers {
                    s.spawn(|| {
                        let mut local = Vec::new();
                        loop {
                            let i = next.fetch_add(1, Ordering::Relaxed);
                            let Some(l) = todo.get(i) else { break };
                            if let Some(p) = parse_file(l) {
                                local.push(p);
                            }
                        }
                        results.lock().unwrap_or_else(|e| e.into_inner()).extend(local);
                    });
                }
            });
            let parsed = results.into_inner().unwrap_or_else(|e| e.into_inner());
            // Файл, который теперь не разбирается (стал бинарным), должен уйти из индекса.
            let parsed_set: HashSet<String> = parsed.iter().map(|p| p.rel.clone()).collect();
            for l in &todo {
                if !parsed_set.contains(&l.rel) {
                    self.remove(&l.rel);
                }
            }
            for p in parsed {
                self.insert(p);
            }
        }
        if changed {
            self.last_build_ms = started.elapsed().as_millis() as u64;
            self.updated_at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        }
    }

    pub fn status(&self) -> IndexStatus {
        let mut langs: HashMap<&str, usize> = HashMap::new();
        for f in self.files.values() {
            *langs.entry(f.lang).or_insert(0) += 1;
        }
        let mut languages: Vec<(String, usize)> = langs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        languages.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        IndexStatus {
            files: self.files.len(),
            lines: self.files.values().map(|f| f.lines as u64).sum(),
            symbols: self.files.values().map(|f| f.symbols.len()).sum(),
            chunks: self.total_chunks,
            terms: self.df.iter().filter(|d| **d > 0).count(),
            truncated: self.truncated,
            build_ms: self.last_build_ms,
            updated_at: self.updated_at,
            languages,
        }
    }

    /// Ранжированный поиск (BM25) по фрагментам; в выдаче — лучший фрагмент каждого файла.
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let terms = query_terms(query);
        if terms.is_empty() || self.total_chunks == 0 {
            return Vec::new();
        }
        let n = self.total_chunks as f32;
        let avg = (self.total_len as f32 / n).max(1.0);
        let q: Vec<(u32, f32)> = terms
            .iter()
            .filter_map(|t| self.dict.get(t).map(|id| (*id, self.df[*id as usize])))
            .filter(|(_, df)| *df > 0)
            .map(|(id, df)| (id, (1.0 + (n - df as f32 + 0.5) / (df as f32 + 0.5)).ln()))
            .collect();
        if q.is_empty() {
            return Vec::new();
        }
        let (k1, b) = (1.4f32, 0.75f32);
        let mut best: Vec<(f32, &str, &Chunk)> = Vec::new();
        for (rel, f) in &self.files {
            let mut top: Option<(f32, &Chunk)> = None;
            let prior = file_prior(rel, f.lang);
            for c in &f.chunks {
                let mut score = 0.0f32;
                let mut matched = 0usize;
                for (id, idf) in &q {
                    if let Ok(pos) = c.terms.binary_search_by_key(id, |(t, _)| *t) {
                        let tf = c.terms[pos].1 as f32 / W_BODY as f32;
                        score += idf * (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * c.len as f32 / avg));
                        matched += 1;
                    }
                }
                if matched == 0 {
                    continue;
                }
                score *= (0.4 + 0.6 * matched as f32 / terms.len() as f32) * prior;
                if top.is_none_or(|(s, _)| score > s) {
                    top = Some((score, c));
                }
            }
            if let Some((s, c)) = top {
                best.push((s, rel.as_str(), c));
            }
        }
        best.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(b.1)));
        best.truncate(limit);
        best.into_iter()
            .map(|(score, rel, c)| {
                let f = &self.files[rel];
                let mut in_chunk: Vec<(usize, &Symbol)> = f
                    .symbols
                    .iter()
                    .filter(|s| s.line >= c.start && s.line <= c.end)
                    .map(|s| {
                        let mut counts = HashMap::new();
                        add_tokens(&s.name, 1, &mut counts);
                        (terms.iter().filter(|t| counts.contains_key(t.as_str())).count(), s)
                    })
                    .collect();
                in_chunk.sort_by(|a, b| b.0.cmp(&a.0)); // стабильно: при равенстве порядок в файле
                let symbols: Vec<String> = in_chunk.into_iter().take(4).map(|(_, s)| s.name.clone()).collect();
                SearchHit { path: rel.to_string(), start_line: c.start, end_line: c.end, score, symbols, snippet: self.snippet(rel, c, &terms) }
            })
            .collect()
    }

    /// Несколько строк вокруг самой подходящей строки фрагмента (читаются с диска: в индексе текста нет).
    fn snippet(&self, rel: &str, c: &Chunk, terms: &[String]) -> String {
        let Ok(text) = std::fs::read_to_string(self.root.join(rel)) else { return String::new() };
        let lines: Vec<&str> = text.lines().collect();
        let (s, e) = ((c.start as usize).saturating_sub(1), (c.end as usize).min(lines.len()));
        if s >= e {
            return String::new();
        }
        let want: HashSet<&str> = terms.iter().map(|t| t.as_str()).collect();
        let mut best = (0usize, s);
        for (i, line) in lines.iter().enumerate().take(e).skip(s) {
            let mut counts = HashMap::new();
            add_tokens(line, 1, &mut counts);
            let hits = counts.keys().filter(|k| want.contains(k.as_str())).count();
            if hits > best.0 {
                best = (hits, i);
            }
        }
        let from = best.1.saturating_sub(1).max(s);
        let to = (from + 5).min(e);
        (from..to).map(|i| format!("{:>5}| {}", i + 1, clip(lines[i], 150))).collect::<Vec<_>>().join("\n")
    }

    /// Где определено имя: точное совпадение, потом начало имени, потом часть, потом все слова запроса.
    pub fn find_symbols(&self, query: &str, limit: usize) -> Vec<SymbolHit> {
        let q = query.trim().trim_matches(|c: char| c == '(' || c == ')' || c == '`' || c == '"').to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        let qterms = query_terms(&q);
        let mut found: Vec<(u32, &String, &Symbol)> = Vec::new();
        for (rel, f) in &self.files {
            for s in &f.symbols {
                let name = s.name.to_lowercase();
                let rank = if name == q {
                    100
                } else if name.starts_with(&q) {
                    80
                } else if name.contains(&q) {
                    60
                } else if !qterms.is_empty() {
                    let mut counts = HashMap::new();
                    add_tokens(&s.name, 1, &mut counts);
                    if qterms.iter().all(|t| counts.contains_key(t)) { 50 } else { 0 }
                } else {
                    0
                };
                if rank > 0 {
                    let top_bonus = if s.container.is_none() { 5 } else { 0 };
                    found.push((rank + top_bonus, rel, s));
                }
            }
        }
        found.sort_by(|a, b| b.0.cmp(&a.0).then(a.2.name.len().cmp(&b.2.name.len())).then(a.1.cmp(b.1)).then(a.2.line.cmp(&b.2.line)));
        found.truncate(limit);
        found
            .into_iter()
            .map(|(_, rel, s)| SymbolHit { path: rel.clone(), name: s.name.clone(), kind: s.kind.to_string(), line: s.line, container: s.container.clone(), signature: s.sig.clone() })
            .collect()
    }

    /// Насколько имя «востребовано»: сколько фрагментов проекта его упоминают. Короткие имена (T, $, id) встречаются везде
    /// и ничего не говорят о файле — их вес нулевой.
    fn symbol_weight(&self, name: &str) -> u32 {
        if name.chars().filter(|c| c.is_alphanumeric()).count() < 4 {
            return 0;
        }
        let whole = name.to_lowercase();
        let df = self.dict.get(&whole).or_else(|| self.dict.get(&stem(&whole))).map(|id| self.df[*id as usize]).unwrap_or(0);
        3 + df.min(40)
    }

    /// Обзор по папкам для большого проекта: самые крупные папки раскрываются глубже, у каждой — число файлов и самые
    /// «востребованные» имена. Дальше модель сама уточняет путь (project_map с path), как в обычном проводнике.
    fn overview(&self, scoped: &[(&String, &FileEntry)], prefix: &str, budget: usize) -> String {
        let base = prefix.split('/').filter(|c| !c.is_empty()).count();
        let dir_of = |rel: &str| -> Vec<String> {
            let mut parts: Vec<String> = rel.split('/').map(String::from).collect();
            parts.pop();
            parts
        };
        let key_at = |dir: &[String], depth: usize| -> String { dir[..dir.len().min(depth)].join("/") };
        // группа: (глубина, ключ-папка, индексы файлов)
        let mut groups: Vec<(usize, String, Vec<usize>)> = Vec::new();
        {
            let mut by: std::collections::BTreeMap<String, Vec<usize>> = Default::default();
            for (i, (rel, _)) in scoped.iter().enumerate() {
                by.entry(key_at(&dir_of(rel), base + 1)).or_default().push(i);
            }
            for (k, v) in by {
                groups.push((base + 1, k, v));
            }
        }
        let max_groups = (budget / 190).clamp(8, 40);
        for _ in 0..60 {
            if groups.len() >= max_groups {
                break;
            }
            // самая крупная папка, которую ещё можно раскрыть глубже
            let Some((gi, _)) = groups
                .iter()
                .enumerate()
                .filter(|(_, (d, _, files))| files.len() > 12 && files.iter().any(|i| dir_of(scoped[*i].0).len() > *d))
                .max_by_key(|(_, (_, _, files))| files.len())
            else {
                break;
            };
            let (d, key, files) = groups.swap_remove(gi);
            let mut by: std::collections::BTreeMap<String, Vec<usize>> = Default::default();
            for i in files {
                let dir = dir_of(scoped[i].0);
                let k = if dir.len() > d { key_at(&dir, d + 1) } else { key.clone() };
                by.entry(k).or_default().push(i);
            }
            for (k, v) in by {
                groups.push((d + 1, k, v));
            }
        }
        groups.sort_by(|a, b| a.1.cmp(&b.1));
        let mut out = format!(
            "Карта проекта{} (обзор по папкам): файлов {}. Проект большой, поэтому показаны папки и самые заметные имена в них. Чтобы увидеть файлы и определения папки, вызови project_map с path (например path=\"{}\"). Чтобы найти конкретное место — search_code или find_symbol.
",
            if prefix.is_empty() { String::new() } else { format!(" «{prefix}»") },
            scoped.len(),
            groups.iter().find(|g| !g.1.is_empty()).map(|g| g.1.as_str()).unwrap_or("src")
        );
        for (_, key, files) in &groups {
            let mut names: Vec<(u32, &str)> = files
                .iter()
                .flat_map(|i| scoped[*i].1.symbols.iter().filter(|s| s.container.is_none()).map(|s| (self.symbol_weight(&s.name), s.name.as_str())))
                .filter(|(w, _)| *w > 0)
                .collect();
            names.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
            let mut seen = HashSet::new();
            let top: Vec<&str> = names.into_iter().filter(|(_, n)| seen.insert(*n)).take(6).map(|(_, n)| n).collect();
            let label = if key.is_empty() { "(корень)".to_string() } else { format!("{key}/") };
            let line = if top.is_empty() { format!("{label} ({} файлов)", files.len()) } else { format!("{label} ({} файлов): {}", files.len(), top.join(", ")) };
            out.push_str(&clip(&line, 220));
            out.push_str("\n");
        }
        out.trim_end().to_string()
    }

    /// Карта проекта: файлы и то, что в них определено. Если не влезает в бюджет — сначала самые востребованные файлы.
    pub fn project_map(&self, prefix: &str, budget: usize) -> String {
        let prefix = prefix.trim().replace('\\', "/");
        let prefix = prefix.trim_start_matches("./").trim_matches('/');
        let scoped: Vec<(&String, &FileEntry)> = self
            .files
            .iter()
            .filter(|(rel, _)| prefix.is_empty() || *rel == prefix || rel.starts_with(&format!("{prefix}/")))
            .collect();
        if scoped.is_empty() {
            return format!("В индексе нет файлов в «{prefix}». Проверь путь командой list_dir.");
        }
        let importance = |f: &FileEntry| -> u32 { f.symbols.iter().filter(|s| s.container.is_none()).map(|s| self.symbol_weight(&s.name)).sum() };
        let line_for = |rel: &str, f: &FileEntry| -> String {
            let mut parts: Vec<String> = Vec::new();
            let top: Vec<&Symbol> = f.symbols.iter().filter(|s| s.container.is_none() && s.name.chars().filter(|c| c.is_alphanumeric()).count() >= 2).collect();
            for s in top.iter().take(10) {
                if matches!(s.kind, "class" | "struct" | "impl" | "trait" | "interface" | "enum") {
                    let methods: Vec<&str> = f.symbols.iter().filter(|m| m.container.as_deref() == Some(s.name.as_str())).take(5).map(|m| m.name.as_str()).collect();
                    parts.push(if methods.is_empty() { s.name.clone() } else { format!("{}{{{}}}", s.name, methods.join(",")) });
                } else {
                    parts.push(s.name.clone());
                }
            }
            if top.len() > 10 {
                parts.push(format!("+{}", top.len() - 10));
            }
            let l = format!("{rel}: {}", parts.join(", "));
            clip(&l, 260)
        };
        let mut with_syms: Vec<(&String, &FileEntry, u32)> = scoped.iter().filter(|(_, f)| f.symbols.iter().any(|s| s.container.is_none())).map(|(r, f)| (*r, *f, importance(f))).collect();
        let others: Vec<&&String> = { let mut v: Vec<&&String> = scoped.iter().filter(|(_, f)| !f.symbols.iter().any(|s| s.container.is_none())).map(|(r, _)| r).collect(); v.sort(); v };
        with_syms.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(b.0)));
        let mut used = 0usize;
        let mut shown: Vec<(&String, String)> = Vec::new();
        for (rel, f, _) in &with_syms {
            let l = line_for(rel, f);
            if used + l.len() + 1 > budget {
                break;
            }
            used += l.len() + 1;
            shown.push((rel, l));
        }
        shown.sort_by(|a, b| a.0.cmp(b.0));
        let hidden = with_syms.len() - shown.len();
        if hidden > 0 && scoped.len() > 40 {
            return self.overview(&scoped, prefix, budget);
        }
        let mut out = format!(
            "Карта проекта{}: файлов {}, с определениями {}. Формат: файл: что в нём определено (класс{{методы}}).\n",
            if prefix.is_empty() { String::new() } else { format!(" «{prefix}»") },
            scoped.len(),
            with_syms.len()
        );
        out.push_str(&shown.iter().map(|(_, l)| l.as_str()).collect::<Vec<_>>().join("\n"));
        if hidden > 0 {
            out.push_str(&format!("\n… ещё {hidden} файлов с определениями не поместились. Уточни путь (параметр path) или ищи через search_code."));
        }
        let room = budget.saturating_sub(used);
        if !others.is_empty() && room > 120 {
            let mut names = String::new();
            let mut count = 0;
            for o in &others {
                if names.len() + o.len() + 2 > room.min(1200) {
                    break;
                }
                names.push_str(o);
                names.push_str(", ");
                count += 1;
            }
            if count > 0 {
                out.push_str(&format!("\nПрочие файлы ({} из {}): {}", count, others.len(), names.trim_end_matches(", ")));
            }
        }
        out
    }
}

/* ───────────── Output for the agent ───────────── */

fn format_hits(query: &str, hits: &[SearchHit]) -> String {
    if hits.is_empty() {
        return format!("По запросу «{query}» ничего не найдено. Попробуй другие слова (имена функций и типов на английском, как в коде) или find_symbol / project_map.");
    }
    let mut out = String::new();
    for (i, h) in hits.iter().enumerate() {
        let syms = if h.symbols.is_empty() { String::new() } else { format!("  [{}]", h.symbols.join(", ")) };
        out.push_str(&format!("{}. {}:{}-{}{}\n{}\n", i + 1, h.path, h.start_line, h.end_line, syms, h.snippet));
    }
    out
}

fn format_symbols(query: &str, hits: &[SymbolHit]) -> String {
    if hits.is_empty() {
        return format!("Определений «{query}» не найдено. Попробуй часть имени или search_code.");
    }
    hits.iter()
        .map(|h| {
            let c = h.container.as_ref().map(|c| format!(" (в {c})")).unwrap_or_default();
            format!("{}:{} {} {}{}\n    {}", h.path, h.line, h.kind, h.name, c, h.signature)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/* ───────────── Tauri glue ───────────── */

fn with_index<T>(app: &AppHandle, f: impl FnOnce(&mut Index) -> T) -> Result<T, String> {
    let root = crate::fs_commands::workspace_root(&app.state::<crate::WorkspaceRoot>())?;
    let state = app.state::<CodeIndexState>();
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if guard.as_ref().map(|i| i.root != root).unwrap_or(true) {
        *guard = Some(Index::new(root));
    }
    let idx = guard.as_mut().expect("index just created");
    idx.refresh();
    Ok(f(idx))
}

/// Инструменты агента: search_code, find_symbol, project_map. Блокирующая — вызывать вне async-рантайма.
pub fn agent_tool(app: &AppHandle, name: &str, args: &Value) -> Result<String, String> {
    let text = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    match name {
        "search_code" => {
            let q = text("query");
            if q.is_empty() {
                return Err("инструмент: не хватает аргумента «query»".into());
            }
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(6).clamp(1, 15) as usize;
            with_index(app, |i| format_hits(&q, &i.search(&q, limit)))
        }
        "find_symbol" => {
            let q = text("name");
            if q.is_empty() {
                return Err("инструмент: не хватает аргумента «name»".into());
            }
            with_index(app, |i| format_symbols(&q, &i.find_symbols(&q, 15)))
        }
        "project_map" => {
            let path = text("path");
            with_index(app, |i| i.project_map(&path, 6_000))
        }
        _ => Err(format!("Неизвестный инструмент: {name}")),
    }
}

pub fn is_index_tool(name: &str) -> bool {
    matches!(name, "search_code" | "find_symbol" | "project_map")
}

#[tauri::command]
pub async fn code_index_status(app: AppHandle) -> Result<IndexStatus, String> {
    tauri::async_runtime::spawn_blocking(move || with_index(&app, |i| i.status())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn code_index_rebuild(app: AppHandle, state: State<'_, CodeIndexState>) -> Result<IndexStatus, String> {
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    tauri::async_runtime::spawn_blocking(move || with_index(&app, |i| i.status())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn code_index_search(app: AppHandle, query: String, limit: Option<usize>) -> Result<Vec<SearchHit>, String> {
    let limit = limit.unwrap_or(10).clamp(1, 30);
    tauri::async_runtime::spawn_blocking(move || with_index(&app, |i| i.search(&query, limit))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn code_index_symbols(app: AppHandle, query: String, limit: Option<usize>) -> Result<Vec<SymbolHit>, String> {
    let limit = limit.unwrap_or(30).clamp(1, 100);
    tauri::async_runtime::spawn_blocking(move || with_index(&app, |i| i.find_symbols(&query, limit))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "code_index_tests.rs"]
mod tests;
