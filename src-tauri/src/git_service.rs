//! Git-интеграция: статус, индекс, коммит и содержимое ревизий для diff-просмотра.
//!
//! Безопасность:
//! - системный `git` запускается без оболочки, аргументы передаются массивом;
//! - пути приходят только относительными к корню репозитория, без `..`/префиксов,
//!   и проверяются на выход за пределы открытой рабочей области;
//! - списки путей передаются через stdin (`--pathspec-from-file`), а pathspec
//!   трактуется буквально (`GIT_LITERAL_PATHSPECS=1`) — никаких glob-масок от клиента.
//! Команды асинхронные и выполняются в пуле блокирующих задач, чтобы долгий git
//! (хуки коммита, большой репозиторий) не подвешивал главный поток окна.

use serde::Serialize;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::State;

use crate::fs_commands::{ensure_within, workspace_root};
use crate::WorkspaceRoot;

const MAX_FILES: usize = 5000;
const MAX_PATHS: usize = 10_000;
const MAX_BLOB_BYTES: usize = 4 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 20_000;
/// Бюджет длины аргументов одного запуска git (лимит командной строки Windows ~32k).
const ARGV_BUDGET: usize = 24_000;
const MAX_BRANCH_LEN: usize = 200;
const MAX_LOG_LIMIT: u32 = 200;
/// Разделители полей/записей в `git log` и `for-each-ref` (ASCII US / RS).
const FS: char = '\u{1f}';
const RS: char = '\u{1e}';

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitFile {
    /// Путь относительно корня репозитория, разделитель `/`.
    pub path: String,
    /// Исходный путь для переименования/копирования.
    pub orig_path: Option<String>,
    /// Статус в индексе (X из porcelain): ' ', M, A, D, R, C, U, ?
    pub index: String,
    /// Статус в рабочем дереве (Y из porcelain).
    pub worktree: String,
}

#[derive(Serialize, Debug)]
pub struct GitStatus {
    /// Абсолютный путь корня репозитория.
    pub top: String,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
    pub truncated: bool,
}

fn git(cwd: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(cwd)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

fn spawn_err(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "Git не найден. Установите Git и перезапустите редактор.".into()
    } else {
        "Не удалось запустить git".into()
    }
}

/// Короткое человекочитаемое сообщение по выводу git. Сырой stderr наружу не
/// отдаётся: в нём бывают абсолютные пути и внутренние детали.
pub(crate) fn friendly_error(stderr: &[u8], stdout: &[u8]) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(stderr),
        String::from_utf8_lossy(stdout)
    )
    .to_lowercase();
    const TABLE: &[(&str, &str)] = &[
        ("not a git repository", "Папка проекта не является git-репозиторием"),
        ("nothing to commit", "Нет проиндексированных изменений для коммита"),
        ("no changes added to commit", "Нет проиндексированных изменений для коммита"),
        ("author identity unknown", "Git не знает автора: задайте user.name и user.email"),
        ("unable to auto-detect email", "Git не знает автора: задайте user.name и user.email"),
        ("index.lock", "Репозиторий занят другим процессом git"),
        ("would be overwritten", "Несохранённые изменения мешают операции"),
        ("local changes", "Несохранённые изменения мешают операции"),
        ("unmerged", "Есть неразрешённые конфликты"),
        ("conflict", "Есть неразрешённые конфликты"),
        ("invalid reference", "Ветка не найдена"),
        ("unknown revision", "Ветка не найдена"),
        ("did not match any", "Файл не найден или не отслеживается git"),
        ("pathspec", "Файл не найден или не отслеживается git"),
    ];
    for (needle, msg) in TABLE {
        if text.contains(needle) {
            return (*msg).to_string();
        }
    }
    "Команда git завершилась с ошибкой".into()
}

fn git_error(stderr: &[u8], stdout: &[u8]) -> String {
    friendly_error(stderr, stdout)
}

/// Запуск git; `input` пишется в stdin (сообщение коммита, список путей).
fn run(mut cmd: Command, input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().map_err(spawn_err)?;
    if let Some(data) = input {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(data)
                .map_err(|_| "Не удалось передать данные в git".to_string())?;
        } // stdin закрывается при выходе из области видимости
    }
    let out = child
        .wait_with_output()
        .map_err(|_| "Не удалось дождаться завершения git".to_string())?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(git_error(&out.stderr, &out.stdout))
    }
}

/// Корень репозитория, в котором лежит рабочая область. `Ok(None)` — не репозиторий.
fn repo_top(root: &Path) -> Result<Option<PathBuf>, String> {
    let mut cmd = git(root);
    cmd.args(["rev-parse", "--show-toplevel"]);
    let out = cmd.output().map_err(spawn_err)?;
    if !out.status.success() {
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return Ok(None);
    }
    let p = PathBuf::from(&s)
        .canonicalize()
        .map_err(|_| "Не удалось определить корень репозитория".to_string())?;
    Ok(Some(crate::strip_verbatim(p)))
}

fn require_top(root: &Path) -> Result<PathBuf, String> {
    repo_top(root)?.ok_or_else(|| "Папка проекта не является git-репозиторием".to_string())
}

/// Лексическая проверка относительного пути: только обычные компоненты (без `..`,
/// корня и диска), итог внутри рабочей области. Возвращает путь с `/` для git.
fn lexical_rel(top: &Path, root: &Path, rel: &str) -> Result<String, String> {
    let bad = || "Некорректный путь".to_string();
    if rel.is_empty() || rel.len() > 4096 || rel.contains('\0') {
        return Err(bad());
    }
    let p = Path::new(rel);
    if !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(bad());
    }
    ensure_within(root, &top.join(p))?;
    Ok(rel.replace('\\', "/"))
}

/// Каноническая проверка: ближайший существующий каталог на пути, разрешённый через
/// симлинки, обязан лежать внутри канонического корня. Сам конечный элемент не
/// разыменовывается (в индекс попадает сама ссылка, а не её цель).
fn ensure_real_within(root: &Path, full: &Path) -> Result<(), String> {
    let outside = || "Путь вне рабочей области".to_string();
    let root_c = crate::strip_verbatim(root.canonicalize().map_err(|_| outside())?);
    let mut cur = if full.symlink_metadata().is_ok() {
        full.parent().ok_or_else(outside)?.to_path_buf()
    } else {
        full.to_path_buf()
    };
    while cur.symlink_metadata().is_err() {
        if !cur.pop() {
            return Err(outside());
        }
    }
    let cur_c = crate::strip_verbatim(cur.canonicalize().map_err(|_| outside())?);
    if cur_c.starts_with(&root_c) {
        Ok(())
    } else {
        Err(outside())
    }
}

/// Проверяет путь из клиента: относительный, без `..`, внутри рабочей области
/// (в том числе после разрешения симлинков). Возвращает путь с `/` для git.
pub(crate) fn safe_rel(top: &Path, root: &Path, rel: &str) -> Result<String, String> {
    let norm = lexical_rel(top, root, rel)?;
    ensure_real_within(root, &top.join(Path::new(rel)))?;
    Ok(norm)
}

/// Проверяет весь список заранее: при любой ошибке git не запускается вообще.
fn validated_paths(top: &Path, root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("Не выбраны файлы".into());
    }
    if paths.len() > MAX_PATHS {
        return Err("Слишком много файлов за один раз".into());
    }
    paths.iter().map(|p| safe_rel(top, root, p)).collect()
}

/// Делит пути на пачки, чтобы командная строка не превышала лимит ОС.
pub(crate) fn chunk_paths(paths: &[String], budget: usize) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    let mut size = 0usize;
    for p in paths {
        let cost = p.len() + 3;
        if !cur.is_empty() && size + cost > budget {
            out.push(std::mem::take(&mut cur));
            size = 0;
        }
        size += cost;
        cur.push(p.clone());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Запускает `git <base...> -- <paths...>` пачками. Пути идут только после `--`.
fn run_with_paths(top: &Path, base: &[&str], paths: &[String]) -> Result<(), String> {
    for chunk in chunk_paths(paths, ARGV_BUDGET) {
        let mut cmd = git(top);
        cmd.args(base).arg("--").args(&chunk);
        run(cmd, None)?;
    }
    Ok(())
}

/// Разбор `git status --porcelain=v1 -z --branch`: (заголовок ветки, файлы, обрезано ли).
pub(crate) fn parse_porcelain(raw: &[u8]) -> (Option<String>, Vec<GitFile>, bool) {
    let text = String::from_utf8_lossy(raw);
    let mut parts = text.split('\0');
    let mut header = None;
    let mut files = Vec::new();
    let mut truncated = false;
    while let Some(entry) = parts.next() {
        if let Some(h) = entry.strip_prefix("## ") {
            header = Some(h.to_string());
            continue;
        }
        let b = entry.as_bytes();
        if b.len() < 4 || b[2] != b' ' || !b[0].is_ascii() || !b[1].is_ascii() {
            continue;
        }
        let (x, y) = (b[0] as char, b[1] as char);
        let path = entry[3..].to_string();
        // Для переименования/копирования следующей записью идёт исходный путь.
        let orig_path = if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            parts.next().map(str::to_string)
        } else {
            None
        };
        if files.len() >= MAX_FILES {
            truncated = true;
            continue;
        }
        files.push(GitFile {
            path,
            orig_path,
            index: x.to_string(),
            worktree: y.to_string(),
        });
    }
    (header, files, truncated)
}

/// Заголовок ветки без `## `: `main...origin/main [ahead 1, behind 2]`,
/// `No commits yet on main`, `HEAD (no branch)`.
pub(crate) fn parse_branch(h: &str) -> (Option<String>, u32, u32) {
    let (head, rest) = match h.find(" [") {
        Some(i) => (&h[..i], &h[i + 2..]),
        None => (h, ""),
    };
    let name = head
        .strip_prefix("No commits yet on ")
        .or_else(|| head.strip_prefix("Initial commit on "))
        .unwrap_or_else(|| head.split("...").next().unwrap_or(head));
    let branch = if name.is_empty() || name.starts_with("HEAD (") {
        None
    } else {
        Some(name.chars().take(120).collect())
    };
    let (mut ahead, mut behind) = (0, 0);
    for part in rest.trim_end_matches(']').split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (branch, ahead, behind)
}

pub(crate) fn status_at(root: &Path) -> Result<Option<GitStatus>, String> {
    let Some(top) = repo_top(root)? else {
        return Ok(None);
    };
    let mut cmd = git(&top);
    cmd.args(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]);
    // Рабочая область может быть подпапкой репозитория: показываем только её файлы.
    if let Ok(rel) = root.strip_prefix(&top) {
        if !rel.as_os_str().is_empty() {
            cmd.arg("--").arg(rel);
        }
    }
    let raw = run(cmd, None)?;
    let (header, files, truncated) = parse_porcelain(&raw);
    let (branch, ahead, behind) = header.as_deref().map(parse_branch).unwrap_or((None, 0, 0));
    Ok(Some(GitStatus {
        top: top.to_string_lossy().to_string(),
        branch,
        ahead,
        behind,
        files,
        truncated,
    }))
}

fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_BLOB_BYTES {
        return Err("Файл слишком большой для сравнения".into());
    }
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err("Бинарный файл нельзя сравнить как текст".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Текст блоба по спецификации `HEAD:путь` / `:путь`. `Ok(None)` — такого блоба нет.
fn blob_text(top: &Path, spec: &str) -> Result<Option<String>, String> {
    let mut cmd = git(top);
    cmd.args(["cat-file", "blob"]).arg(spec);
    let out = cmd.output().map_err(spawn_err)?;
    if !out.status.success() {
        return Ok(None);
    }
    decode_text(out.stdout).map(Some)
}

/// Содержимое файла в HEAD (`rev = "head"`) или в индексе (`rev = "index"`).
/// `Ok(None)` — в этой ревизии файла нет (новый файл, нет коммитов).
pub(crate) fn show_at(root: &Path, path: &str, rev: &str) -> Result<Option<String>, String> {
    let top = require_top(root)?;
    let rel = safe_rel(&top, root, path)?;
    let spec = match rev {
        "head" => format!("HEAD:{rel}"),
        "index" => format!(":{rel}"),
        _ => return Err("Неизвестная ревизия".into()),
    };
    blob_text(&top, &spec)
}

/// Текст файла из рабочего дерева. Только обычные файлы: ссылки и каталоги не читаем.
fn worktree_text(top: &Path, rel: &str) -> Result<Option<String>, String> {
    let full = top.join(rel);
    let Ok(meta) = full.symlink_metadata() else {
        return Ok(None); // файл удалён в рабочем дереве
    };
    if !meta.is_file() {
        return Err("Это не обычный файл".into());
    }
    if meta.len() > MAX_BLOB_BYTES as u64 {
        return Err("Файл слишком большой для сравнения".into());
    }
    let bytes = std::fs::read(&full).map_err(|_| "Не удалось прочитать файл".to_string())?;
    decode_text(bytes).map(Some)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct GitDiff {
    pub path: String,
    pub original: String,
    pub modified: String,
}

/// Пара версий файла для diff: `staged` — HEAD против индекса, иначе индекс против
/// рабочего дерева. Отсутствующая сторона (новый/удалённый файл) — пустая строка.
pub(crate) fn diff_file_at(root: &Path, path: &str, staged: bool) -> Result<GitDiff, String> {
    let top = require_top(root)?;
    let rel = safe_rel(&top, root, path)?;
    let (original, modified) = if staged {
        (
            blob_text(&top, &format!("HEAD:{rel}"))?,
            blob_text(&top, &format!(":{rel}"))?,
        )
    } else {
        (blob_text(&top, &format!(":{rel}"))?, worktree_text(&top, &rel)?)
    };
    Ok(GitDiff {
        path: rel,
        original: original.unwrap_or_default(),
        modified: modified.unwrap_or_default(),
    })
}

pub(crate) fn stage_at(root: &Path, paths: &[String]) -> Result<(), String> {
    let top = require_top(root)?;
    let rels = validated_paths(&top, root, paths)?;
    run_with_paths(&top, &["add", "-A"], &rels)
}

fn has_head(top: &Path) -> Result<bool, String> {
    let mut probe = git(top);
    probe.args(["rev-parse", "--verify", "-q", "HEAD"]);
    Ok(probe.output().map_err(spawn_err)?.status.success())
}

pub(crate) fn unstage_at(root: &Path, paths: &[String]) -> Result<(), String> {
    let top = require_top(root)?;
    let rels = validated_paths(&top, root, paths)?;
    if has_head(&top)? {
        run_with_paths(&top, &["restore", "--staged"], &rels)
    } else {
        // До первого коммита HEAD нет: убираем записи из индекса, файлы на диске не трогаем.
        run_with_paths(&top, &["rm", "--cached", "-r", "-q", "-f"], &rels)
    }
}

/// Отменяет изменения отслеживаемых файлов в рабочем дереве (восстанавливает из индекса).
/// Неотслеживаемые файлы не удаляет — для них git вернёт ошибку.
pub(crate) fn discard_at(root: &Path, paths: &[String]) -> Result<(), String> {
    let top = require_top(root)?;
    let rels = validated_paths(&top, root, paths)?;
    run_with_paths(&top, &["restore", "--worktree"], &rels)
}

/// Коммит проиндексированных изменений. Возвращает короткий хеш нового коммита.
pub(crate) fn commit_at(root: &Path, message: &str) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Введите сообщение коммита".into());
    }
    if msg.chars().count() > MAX_MESSAGE_CHARS {
        return Err("Сообщение коммита слишком длинное".into());
    }
    let top = require_top(root)?;
    let mut cmd = git(&top);
    cmd.args(["commit", "-F", "-"]);
    run(cmd, Some(msg.as_bytes()))?;
    let mut head = git(&top);
    head.args(["rev-parse", "--short", "HEAD"]);
    Ok(String::from_utf8_lossy(&run(head, None)?).trim().to_string())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct GitCommitResult {
    pub hash: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitLogEntry {
    pub hash: String,
    pub author: String,
    /// ISO 8601 (`%aI`).
    pub date: String,
    pub subject: String,
}

/// Разбор вывода `git log --format=%H%x1f%an%x1f%aI%x1f%s%x1e`.
pub(crate) fn parse_log(raw: &str) -> Vec<GitLogEntry> {
    raw.split(RS)
        .filter_map(|rec| {
            let rec = rec.trim_start_matches(['\n', '\r']);
            let mut it = rec.splitn(4, FS);
            let (hash, author, date, subject) = (it.next()?, it.next()?, it.next()?, it.next()?);
            if hash.is_empty() {
                return None;
            }
            Some(GitLogEntry {
                hash: hash.to_string(),
                author: author.to_string(),
                date: date.to_string(),
                subject: subject.trim_end().to_string(),
            })
        })
        .collect()
}

/// Последние `limit` (1..=200) коммитов текущей ветки. Без коммитов — пустой список.
pub(crate) fn log_at(root: &Path, limit: i64) -> Result<Vec<GitLogEntry>, String> {
    if !(1..=i64::from(MAX_LOG_LIMIT)).contains(&limit) {
        return Err("Лимит должен быть от 1 до 200".into());
    }
    let top = require_top(root)?;
    if !has_head(&top)? {
        return Ok(Vec::new());
    }
    let count = limit.to_string();
    let mut cmd = git(&top);
    cmd.args(["log", "-n", count.as_str(), "--format=%H%x1f%an%x1f%aI%x1f%s%x1e"]);
    let raw = run(cmd, None)?;
    Ok(parse_log(&String::from_utf8_lossy(&raw)))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

/// Разбор вывода `git for-each-ref --format=%(HEAD)%1f%(refname:short)%1e refs/heads`.
pub(crate) fn parse_branches(raw: &str) -> Vec<GitBranch> {
    raw.split(RS)
        .filter_map(|rec| {
            let rec = rec.trim_start_matches(['\n', '\r']);
            let (head, name) = rec.split_once(FS)?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some(GitBranch { name: name.to_string(), current: head.trim() == "*" })
        })
        .collect()
}

pub(crate) fn branches_at(root: &Path) -> Result<Vec<GitBranch>, String> {
    let top = require_top(root)?;
    let mut cmd = git(&top);
    // for-each-ref uses `%XX` hex escapes (not `%xXX` as in `git log`).
    cmd.args(["for-each-ref", "--format=%(HEAD)%1f%(refname:short)%1e", "refs/heads"]);
    let raw = run(cmd, None)?;
    Ok(parse_branches(&String::from_utf8_lossy(&raw)))
}

/// Имя ветки: `^[A-Za-z0-9._/-]{1,200}$`, без ведущего `-` (иначе это опция git).
pub(crate) fn validate_branch(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= MAX_BRANCH_LEN
        && !name.starts_with('-')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-'));
    if ok {
        Ok(())
    } else {
        Err("Недопустимое имя ветки".into())
    }
}

/// Переключение на существующую локальную ветку. Имя проверяется до запуска git.
pub(crate) fn checkout_at(root: &Path, branch: &str) -> Result<(), String> {
    validate_branch(branch)?;
    let top = require_top(root)?;
    let mut cmd = git(&top);
    cmd.args(["switch", "--no-guess", branch]);
    run(cmd, None).map(|_| ())
}

/// Корень для команды: без `root` — рабочая область; с `root` — абсолютный путь,
/// который после канонизации обязан лежать внутри рабочей области.
pub(crate) fn resolve_root(workspace: &Path, client: Option<&str>) -> Result<PathBuf, String> {
    let Some(c) = client else {
        return Ok(workspace.to_path_buf());
    };
    let outside = || "Путь вне рабочей области".to_string();
    if c.is_empty() || c.len() > 4096 || c.contains('\0') || !Path::new(c).is_absolute() {
        return Err("Некорректный путь".into());
    }
    let real = crate::strip_verbatim(Path::new(c).canonicalize().map_err(|_| outside())?);
    let ws = crate::strip_verbatim(workspace.canonicalize().map_err(|_| outside())?);
    ensure_within(&ws, &real)?;
    Ok(real)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "Внутренняя ошибка".to_string())?
}

fn scoped_root(state: &WorkspaceRoot, root: Option<&str>) -> Result<PathBuf, String> {
    resolve_root(&workspace_root(state)?, root)
}

// `root` необязателен: прежние вызовы без него работают с рабочей областью.
#[tauri::command]
pub async fn git_status(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
) -> Result<Option<GitStatus>, String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || status_at(&root)).await
}

#[tauri::command]
pub async fn git_show(
    state: State<'_, WorkspaceRoot>,
    path: String,
    rev: String,
) -> Result<Option<String>, String> {
    let root = workspace_root(&state)?;
    blocking(move || show_at(&root, &path, &rev)).await
}

#[tauri::command]
pub async fn git_diff_file(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    path: String,
    staged: bool,
) -> Result<GitDiff, String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || diff_file_at(&root, &path, staged)).await
}

#[tauri::command]
pub async fn git_stage(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || stage_at(&root, &paths)).await
}

#[tauri::command]
pub async fn git_unstage(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || unstage_at(&root, &paths)).await
}

#[tauri::command]
pub async fn git_discard(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || discard_at(&root, &paths)).await
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    message: String,
) -> Result<GitCommitResult, String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || commit_at(&root, &message).map(|hash| GitCommitResult { hash })).await
}

#[tauri::command]
pub async fn git_log(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    limit: i64,
) -> Result<Vec<GitLogEntry>, String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || log_at(&root, limit)).await
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
) -> Result<Vec<GitBranch>, String> {
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || branches_at(&root)).await
}

#[tauri::command]
pub async fn git_checkout(
    state: State<'_, WorkspaceRoot>,
    root: Option<String>,
    branch: String,
) -> Result<(), String> {
    validate_branch(&branch)?;
    let root = scoped_root(&state, root.as_deref())?;
    blocking(move || checkout_at(&root, &branch)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn porcelain_parsing() {
        let raw = b"## main...origin/main [ahead 2, behind 1]\0 M src/a.ts\0R  new.txt\0old.txt\0?? dir/\xD0\xB0.txt\0A  b.txt\0";
        let (header, files, truncated) = parse_porcelain(raw);
        assert!(!truncated);
        assert_eq!(parse_branch(&header.unwrap()), (Some("main".into()), 2, 1));
        assert_eq!(files.len(), 4);
        assert_eq!((files[0].index.as_str(), files[0].worktree.as_str(), files[0].path.as_str()), (" ", "M", "src/a.ts"));
        assert_eq!(files[1].path, "new.txt");
        assert_eq!(files[1].orig_path.as_deref(), Some("old.txt"));
        assert_eq!(files[2].path, "dir/а.txt");
        assert_eq!(files[2].index, "?");
        assert_eq!(files[3].index, "A");
    }

    #[test]
    fn branch_header_variants() {
        assert_eq!(parse_branch("No commits yet on main"), (Some("main".into()), 0, 0));
        assert_eq!(parse_branch("HEAD (no branch)"), (None, 0, 0));
        assert_eq!(parse_branch("feature/x"), (Some("feature/x".into()), 0, 0));
        assert_eq!(parse_branch("dev...origin/dev [behind 3]"), (Some("dev".into()), 0, 3));
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aide-git-{tag}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        crate::strip_verbatim(dir.canonicalize().unwrap())
    }

    fn git_ok(dir: &Path, args: &[&str]) {
        let mut c = git(dir);
        c.args(args);
        run(c, None).unwrap();
    }

    fn find<'a>(st: &'a GitStatus, path: &str) -> Option<&'a GitFile> {
        st.files.iter().find(|f| f.path == path)
    }

    #[test]
    fn repository_flow() {
        let dir = temp_dir("flow");
        git_ok(&dir, &["init", "-q", "-b", "main"]);
        for (k, v) in [
            ("user.name", "AIDE Test"),
            ("user.email", "test@example.invalid"),
            ("core.autocrlf", "false"),
            ("commit.gpgsign", "false"),
        ] {
            git_ok(&dir, &["config", k, v]);
        }
        fs::write(dir.join("a.txt"), "one\n").unwrap();

        // До первого коммита: stage и unstage (через rm --cached).
        stage_at(&dir, &["a.txt".into()]).unwrap();
        let st = status_at(&dir).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(find(&st, "a.txt").unwrap().index, "A");
        unstage_at(&dir, &["a.txt".into()]).unwrap();
        assert_eq!(find(&status_at(&dir).unwrap().unwrap(), "a.txt").unwrap().index, "?");
        assert!(fs::read_to_string(dir.join("a.txt")).unwrap() == "one\n", "unstage keeps file");

        stage_at(&dir, &["a.txt".into()]).unwrap();
        assert!(!commit_at(&dir, "first").unwrap().is_empty());
        assert!(commit_at(&dir, "   ").is_err(), "empty message rejected");

        fs::write(dir.join("a.txt"), "two\n").unwrap();
        fs::write(dir.join("b.txt"), "new\n").unwrap();
        let st = status_at(&dir).unwrap().unwrap();
        let a = find(&st, "a.txt").unwrap();
        assert_eq!((a.index.as_str(), a.worktree.as_str()), (" ", "M"));
        assert_eq!(find(&st, "b.txt").unwrap().index, "?");

        assert_eq!(show_at(&dir, "a.txt", "head").unwrap().as_deref(), Some("one\n"));
        assert_eq!(show_at(&dir, "b.txt", "head").unwrap(), None);
        assert!(show_at(&dir, "a.txt", "HEAD~1; rm").is_err(), "unknown revision kind");

        stage_at(&dir, &["a.txt".into()]).unwrap();
        assert_eq!(show_at(&dir, "a.txt", "index").unwrap().as_deref(), Some("two\n"));
        assert_eq!(find(&status_at(&dir).unwrap().unwrap(), "a.txt").unwrap().index, "M");
        unstage_at(&dir, &["a.txt".into()]).unwrap();
        assert_eq!(find(&status_at(&dir).unwrap().unwrap(), "a.txt").unwrap().index, " ");

        discard_at(&dir, &["a.txt".into()]).unwrap();
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "one\n");
        assert!(discard_at(&dir, &["b.txt".into()]).is_err(), "untracked files are never deleted");
        assert!(dir.join("b.txt").exists());

        assert!(stage_at(&dir, &["../x".into()]).is_err());
        assert!(stage_at(&dir, &[]).is_err());

        // Рабочая область — подпапка репозитория: видны только её файлы.
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("c.txt"), "c\n").unwrap();
        let sub = crate::strip_verbatim(dir.join("sub").canonicalize().unwrap());
        let st = status_at(&sub).unwrap().unwrap();
        assert!(st.files.iter().all(|f| f.path.starts_with("sub/")), "{:?}", st.files);
        assert!(find(&st, "sub/c.txt").is_some());
        assert!(stage_at(&sub, &["b.txt".into()]).is_err(), "outside the workspace subfolder");

        fs::remove_dir_all(&dir).ok();
    }

    fn init_repo(tag: &str) -> PathBuf {
        let dir = temp_dir(tag);
        git_ok(&dir, &["init", "-q", "-b", "main"]);
        for (k, v) in [
            ("user.name", "AIDE Test"),
            ("user.email", "test@example.invalid"),
            ("core.autocrlf", "false"),
            ("commit.gpgsign", "false"),
        ] {
            git_ok(&dir, &["config", k, v]);
        }
        dir
    }

    #[test]
    fn porcelain_rename_and_space_paths() {
        let raw = b"## main\0R  new name.txt\0old name.txt\0?? my dir/with space.txt\0 M a b/c.txt\0RM x.txt\0w.txt\0";
        let (header, files, _) = parse_porcelain(raw);
        assert_eq!(parse_branch(&header.unwrap()).0.as_deref(), Some("main"));
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].path, "new name.txt");
        assert_eq!(files[0].orig_path.as_deref(), Some("old name.txt"));
        assert_eq!((files[0].index.as_str(), files[0].worktree.as_str()), ("R", " "));
        assert_eq!(files[1].path, "my dir/with space.txt");
        assert_eq!((files[1].index.as_str(), files[1].worktree.as_str()), ("?", "?"));
        assert_eq!(files[1].orig_path, None);
        assert_eq!(files[2].path, "a b/c.txt");
        assert_eq!((files[2].index.as_str(), files[2].worktree.as_str()), (" ", "M"));
        // Запись после переименования не должна съедаться как обычный файл.
        assert_eq!(files[3].path, "x.txt");
        assert_eq!(files[3].orig_path.as_deref(), Some("w.txt"));
    }

    #[test]
    fn log_and_branch_parsing() {
        let raw = "aaaa\u{1f}Ann Lee\u{1f}2026-11-05T10:00:00+03:00\u{1f}fix: a b\u{1e}\nbbbb\u{1f}Bob\u{1f}2026-11-04T09:00:00Z\u{1f}init\u{1e}\n";
        let log = parse_log(raw);
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].hash, "aaaa");
        assert_eq!(log[0].author, "Ann Lee");
        assert_eq!(log[0].date, "2026-11-05T10:00:00+03:00");
        assert_eq!(log[0].subject, "fix: a b");
        assert_eq!(log[1].subject, "init");
        assert!(parse_log("").is_empty());
        assert!(parse_log("garbage without separators").is_empty());

        let br = parse_branches("*\u{1f}main\u{1e}\n \u{1f}feature/x\u{1e}\n");
        assert_eq!(
            br,
            vec![
                GitBranch { name: "main".into(), current: true },
                GitBranch { name: "feature/x".into(), current: false },
            ]
        );
    }

    #[test]
    fn branch_names_are_validated() {
        for ok in ["main", "feature/x-1", "release_1.2", "a"] {
            assert!(validate_branch(ok).is_ok(), "{ok}");
        }
        let long = "a".repeat(201);
        for bad in ["-x", "--force", "a;rm", "a b", "a\nb", "a$(x)", "a`x`", "", "а-кириллица", long.as_str()] {
            assert!(validate_branch(bad).is_err(), "{bad:?}");
        }
        assert!(validate_branch(&"a".repeat(200)).is_ok());
    }

    #[test]
    fn bad_branch_never_reaches_git() {
        // Каталога не существует: если бы git запустился, ошибка была бы другой.
        let nowhere = Path::new("Z:/aide-no-such-dir/nowhere");
        for bad in ["-x", "a;rm"] {
            assert_eq!(checkout_at(nowhere, bad).unwrap_err(), "Недопустимое имя ветки");
        }
        assert_eq!(commit_at(nowhere, "  \n").unwrap_err(), "Введите сообщение коммита");
    }

    #[test]
    fn paths_are_chunked_under_budget() {
        let paths: Vec<String> = (0..10).map(|i| format!("dir/file-{i}.txt")).collect();
        let chunks = chunk_paths(&paths, 40);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), paths, "order and content preserved");
        assert!(chunks.iter().all(|c| !c.is_empty()));
        assert!(chunk_paths(&[], 40).is_empty());
    }

    #[test]
    fn errors_do_not_leak_stderr_or_paths() {
        let msg = friendly_error(b"fatal: pathspec 'D:/secret/dir/x.txt' did not match any files", b"");
        assert!(!msg.contains("secret") && !msg.contains("D:"), "{msg}");
        let msg = friendly_error(b"error: something odd in C:/Users/me/repo", b"");
        assert!(!msg.contains("Users"), "{msg}");
        assert!(msg.chars().count() < 100);
    }

    #[test]
    fn lexical_paths_are_validated() {
        let top = PathBuf::from("/repo");
        let root = PathBuf::from("/repo/app");
        assert_eq!(lexical_rel(&top, &root, "app/x.ts").unwrap(), "app/x.ts");
        assert_eq!(lexical_rel(&top, &root, "app/my file.ts").unwrap(), "app/my file.ts");
        assert!(lexical_rel(&top, &root, "x.ts").is_err(), "outside workspace");
        assert!(lexical_rel(&top, &root, "app/../../x").is_err(), "parent escape");
        assert!(lexical_rel(&top, &root, "../x").is_err());
        assert!(lexical_rel(&top, &root, "/etc/passwd").is_err(), "absolute");
        assert!(lexical_rel(&top, &root, "").is_err());
        assert!(lexical_rel(&top, &root, "app/a\0b").is_err());
        assert!(lexical_rel(&top, &root, "appx/y").is_err(), "sibling prefix");
        if cfg!(windows) {
            assert_eq!(lexical_rel(&top, &root, r"app\y.ts").unwrap(), "app/y.ts");
            assert!(lexical_rel(&top, &root, r"C:\Windows\x").is_err(), "drive path");
            assert!(lexical_rel(&top, &root, r"app\..\..\x").is_err());
        }
    }

    #[test]
    fn stage_rejects_paths_outside_repo() {
        let base = temp_dir("outside");
        let repo = base.join("repo");
        fs::create_dir_all(&repo).unwrap();
        git_ok(&repo, &["init", "-q", "-b", "main"]);
        fs::write(base.join("outside.txt"), "secret\n").unwrap();
        fs::write(repo.join("in.txt"), "ok\n").unwrap();

        let err = stage_at(&repo, &["../outside.txt".into()]).unwrap_err();
        assert!(!err.contains("outside.txt"), "{err}");
        // Один плохой путь в списке блокирует и остальные: git не запускается вовсе.
        assert!(stage_at(&repo, &["in.txt".into(), "../outside.txt".into()]).is_err());
        assert!(unstage_at(&repo, &["../outside.txt".into()]).is_err());
        assert!(discard_at(&repo, &["../outside.txt".into()]).is_err());
        assert!(diff_file_at(&repo, "../outside.txt", false).is_err());

        let mut ls = git(&repo);
        ls.args(["ls-files", "--cached"]);
        assert!(run(ls, None).unwrap().is_empty(), "nothing was staged");

        // Имя, похожее на опцию git, трактуется как путь (после `--`), а не как флаг.
        fs::write(repo.join("-n"), "x\n").unwrap();
        stage_at(&repo, &["-n".into()]).unwrap();
        assert_eq!(find(&status_at(&repo).unwrap().unwrap(), "-n").unwrap().index, "A");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn client_root_must_be_inside_workspace() {
        let ws = temp_dir("rootws");
        fs::create_dir_all(ws.join("sub")).unwrap();
        assert_eq!(resolve_root(&ws, None).unwrap(), ws);
        assert_eq!(
            resolve_root(&ws, Some(ws.join("sub").to_str().unwrap())).unwrap(),
            ws.join("sub")
        );
        let parent = ws.parent().unwrap().to_str().unwrap().to_string();
        assert!(resolve_root(&ws, Some(&parent)).is_err(), "parent of workspace");
        let escape = format!("{}/sub/..", ws.display());
        assert!(resolve_root(&ws, Some(&format!("{escape}/..")) ).is_err(), "dot-dot escape");
        assert!(resolve_root(&ws, Some("sub")).is_err(), "relative");
        assert!(resolve_root(&ws, Some("")).is_err());
        let err = resolve_root(&ws, Some("Z:/aide-no-such/secret")).unwrap_err();
        assert!(!err.contains("secret"), "{err}");
        fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn diff_log_branches_checkout_flow() {
        let dir = init_repo("flow2");
        assert!(log_at(&dir, 5).unwrap().is_empty(), "no commits yet");
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        stage_at(&dir, &["a.txt".into()]).unwrap();
        assert!(!commit_at(&dir, "first commit").unwrap().is_empty());

        let log = log_at(&dir, 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].subject, "first commit");
        assert_eq!(log[0].author, "AIDE Test");
        assert_eq!(log[0].hash.len(), 40);
        assert!(log[0].date.contains('T'), "ISO 8601: {}", log[0].date);
        assert!(log_at(&dir, 0).is_err());
        assert!(log_at(&dir, 201).is_err());
        assert!(log_at(&dir, -1).is_err());

        // diff: рабочее дерево против индекса, затем индекс против HEAD.
        fs::write(dir.join("a.txt"), "two\n").unwrap();
        fs::write(dir.join("b.txt"), "new\n").unwrap();
        let d = diff_file_at(&dir, "a.txt", false).unwrap();
        assert_eq!((d.path.as_str(), d.original.as_str(), d.modified.as_str()), ("a.txt", "one\n", "two\n"));
        let d = diff_file_at(&dir, "b.txt", false).unwrap();
        assert_eq!((d.original.as_str(), d.modified.as_str()), ("", "new\n"), "untracked file");
        stage_at(&dir, &["a.txt".into()]).unwrap();
        let d = diff_file_at(&dir, "a.txt", true).unwrap();
        assert_eq!((d.original.as_str(), d.modified.as_str()), ("one\n", "two\n"));

        // Ветки.
        git_ok(&dir, &["branch", "feature/x"]);
        let br = branches_at(&dir).unwrap();
        assert!(br.contains(&GitBranch { name: "main".into(), current: true }));
        assert!(br.contains(&GitBranch { name: "feature/x".into(), current: false }));
        stage_at(&dir, &["a.txt".into()]).unwrap();
        commit_at(&dir, "second").unwrap();
        checkout_at(&dir, "feature/x").unwrap();
        let st = status_at(&dir).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("feature/x"));
        assert!(branches_at(&dir).unwrap().iter().any(|b| b.name == "feature/x" && b.current));
        assert_eq!(checkout_at(&dir, "no-such-branch").unwrap_err(), "Ветка не найдена");
        assert!(checkout_at(&dir, "-x").is_err());
        assert!(checkout_at(&dir, "a;rm").is_err());
        assert_eq!(status_at(&dir).unwrap().unwrap().branch.as_deref(), Some("feature/x"));
        fs::remove_dir_all(&dir).ok();
    }
}
