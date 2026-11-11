use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::WorkspaceRoot;

#[derive(Serialize, Clone)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

pub(crate) fn workspace_root(state: &WorkspaceRoot) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Сначала откройте папку проекта".to_string())
}

pub(crate) fn ensure_within(root: &Path, p: &Path) -> Result<(), String> {
    if p.starts_with(root) {
        Ok(())
    } else {
        Err("Путь вне рабочей области".into())
    }
}

/// Путь к существующему объекту: канонизируем и проверяем границы рабочей области.
/// Относительные пути (их передают ИИ-инструменты) резолвим от корня рабочей
/// области, а не от CWD процесса (он не совпадает с проектом).
pub(crate) fn resolve_existing(root: &Path, path: &str) -> Result<PathBuf, String> {
    let raw = Path::new(path);
    let full = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let p = full
        .canonicalize()
        .map_err(|e| format!("путь недоступен: {e}"))?;
    let p = crate::strip_verbatim(p);
    ensure_within(root, &p)?;
    Ok(p)
}

/// Путь к ещё не существующему объекту (создание/переименование):
/// канонизируем родителя и присоединяем имя.
pub(crate) fn resolve_new(root: &Path, path: &str) -> Result<PathBuf, String> {
    let raw = Path::new(path);
    let full = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let name = full.file_name().ok_or("Некорректное имя")?;
    let parent = full.parent().ok_or("Нет родительской папки")?;
    let parent = crate::strip_verbatim(parent.canonicalize().map_err(|e| e.to_string())?);
    ensure_within(root, &parent)?;
    Ok(parent.join(name))
}

pub(crate) fn read_dir_entries(root: &Path, path: &str) -> Result<Vec<FsEntry>, String> {
    let dir = resolve_existing(root, path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        entries.push(FsEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn list_dir(state: State<WorkspaceRoot>, path: String) -> Result<Vec<FsEntry>, String> {
    let root = workspace_root(&state)?;
    read_dir_entries(&root, &path)
}

#[tauri::command]
pub fn read_file(state: State<WorkspaceRoot>, path: String) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let p = resolve_existing(&root, &path)?;
    fs::read_to_string(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(
    state: State<WorkspaceRoot>,
    path: String,
    content: String,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let p = resolve_existing(&root, &path)?;
    fs::write(p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_entry(state: State<WorkspaceRoot>, path: String, is_dir: bool) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let p = resolve_new(&root, &path)?;
    if p.exists() {
        return Err("Объект с таким именем уже существует".into());
    }
    if is_dir {
        fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::File::create(&p).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_entry(state: State<WorkspaceRoot>, path: String) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let p = resolve_existing(&root, &path)?;
    if p == root {
        return Err("Нельзя удалить корень рабочей области".into());
    }
    let meta = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    let result = if meta.is_dir() {
        fs::remove_dir_all(&p)
    } else {
        fs::remove_file(&p)
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_entry(
    state: State<WorkspaceRoot>,
    path: String,
    new_name: String,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let old = resolve_existing(&root, &path)?;
    if new_name.trim().is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err("Имя не может быть пустым или содержать разделители пути".into());
    }
    let parent = old.parent().ok_or("Нет родительской папки")?.to_path_buf();
    let new = parent.join(&new_name);
    ensure_within(&root, &new)?;
    if new.exists() {
        return Err("Объект с таким именем уже существует".into());
    }
    fs::rename(&old, &new).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ProjectMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub text: String,
}

/// Директории, которые не стоит обходить при глобальном поиске:
/// их тысячи файлов, а результат почти никогда не нужен пользователю.
const SEARCH_IGNORE_DIRS: [&str; 6] = [
    "node_modules",
    ".git",
    "dist",
    "target",
    ".next",
    ".cargo",
];

/// Глобальный поиск по содержимому файлов открытого проекта.
/// Возвращает первые `max_results` совпадений в порядке обхода дерева.
#[tauri::command]
pub fn search_project(
    state: State<WorkspaceRoot>,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
) -> Result<Vec<ProjectMatch>, String> {
    let root = workspace_root(&state)?;
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    const MAX_RESULTS: usize = 500;
    const MAX_FILE_BYTES: u64 = 512 * 1024;

    let needle = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };
    let mut results = Vec::new();

    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if SEARCH_IGNORE_DIRS.contains(&name) {
                continue;
            }
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                let meta = match fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                // Огромные файлы (бандлы, карты, дампы) не читаем.
                if meta.len() > MAX_FILE_BYTES {
                    continue;
                }
                let Ok(content) = fs::read_to_string(&path) else {
                    continue; // не текстовый файл или бинарник
                };
                let rel = path
                    .strip_prefix(&root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                for (i, raw) in content.lines().enumerate() {
                    let hay = if case_sensitive {
                        raw.to_string()
                    } else {
                        raw.to_lowercase()
                    };
                    let mut from = 0;
                    while let Some(pos) = hay[from..].find(&needle) {
                        let start = from + pos;
                        if !whole_word || is_whole_word(&hay, start, needle.len()) {
                            results.push(ProjectMatch {
                                path: rel.clone(),
                                line: i + 1,
                                column: start + 1,
                                text: raw.to_string(),
                            });
                            if results.len() >= MAX_RESULTS {
                                return Ok(results);
                            }
                        }
                        from += pos + needle.len();
                    }
                }
            }
        }
    }
    Ok(results)
}

/// Проверка границ слова для режима «целое слово».
/// Word-символом считаем букву/цифру или подчёркивание.
fn is_whole_word(hay: &str, start: usize, len: usize) -> bool {
    let is_word_char = |c: char| c.is_alphanumeric() || c == '_';
    let before_ok = start == 0
        || !hay[..start]
            .chars()
            .next_back()
            .map(is_word_char)
            .unwrap_or(false);
    let end = start.saturating_add(len);
    let after_ok = end >= hay.len()
        || !hay[end..]
            .chars()
            .next()
            .map(is_word_char)
            .unwrap_or(false);
    before_ok && after_ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::Watcher;

    #[test]
    fn resolve_existing_roundtrip() {
        let root = PathBuf::from(r"D:\Projects\AIDE");
        let canonical_root = crate::strip_verbatim(root.canonicalize().unwrap());
        let p = resolve_existing(&canonical_root, r"D:\Projects\AIDE").unwrap();
        assert_eq!(p, canonical_root, "root itself resolves");
        let src = resolve_existing(&canonical_root, r"D:\Projects\AIDE\src").unwrap();
        assert!(src.starts_with(&canonical_root), "child within root");
        assert!(resolve_existing(&canonical_root, r"C:\Windows").is_err(), "outside rejected");
    }

    #[test]
    fn relative_paths_resolve_from_root() {
        let root = crate::strip_verbatim(PathBuf::from(r"D:\Projects\AIDE").canonicalize().unwrap());
        let src = resolve_existing(&root, "src").unwrap();
        assert!(src.starts_with(&root) && src.ends_with("src"), "relative dir");
        let app = resolve_existing(&root, "src/app/App.tsx").unwrap();
        assert!(app.ends_with("App.tsx"), "relative nested file");
        assert!(resolve_existing(&root, r"..\..\Windows").is_err(), "relative escape");
        let f = resolve_new(&root, "dist/probe_new_file.txt").unwrap();
        assert!(f.starts_with(&root) && f.ends_with("probe_new_file.txt"), "resolve_new relative");
    }

    #[test]
    fn watcher_can_watch_project() {
        let mut watcher = notify::recommended_watcher(|_| {}).unwrap();
        watcher
            .watch(Path::new(r"D:\Projects\AIDE"), notify::RecursiveMode::Recursive)
            .unwrap();
    }
}

/// Текущая ветка git открытого проекта (читаем `.git/HEAD`, процессы не запускаем).
#[tauri::command]
pub fn git_branch(state: State<WorkspaceRoot>) -> Option<String> {
    let root = workspace_root(&state).ok()?;
    let mut git = root.join(".git");
    if git.is_file() {
        // рабочее дерево (worktree): файл `.git` содержит `gitdir: <путь>`
        let text = fs::read_to_string(&git).ok()?;
        let p = text.trim().strip_prefix("gitdir:")?.trim().to_string();
        git = if std::path::Path::new(&p).is_absolute() { PathBuf::from(p) } else { root.join(p) };
    }
    let head = fs::read_to_string(git.join("HEAD")).ok()?;
    let head = head.trim();
    Some(match head.strip_prefix("ref: refs/heads/") {
        Some(branch) => branch.chars().take(60).collect(),
        None => head.chars().take(8).collect(),
    })
}
