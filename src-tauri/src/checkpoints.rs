//! Откат правок агента: перед каждым изменяющим вызовом (запись, создание, удаление, замена) в
//! памяти сохраняется исходное содержимое файла, и всё, что агент сделал за один ответ, можно
//! отменить одной кнопкой. Пути проходят ту же проверку границ рабочей области, что и сами инструменты.
//! Ограничения: файлы больше 5 МБ и папки глубже/больше лимитов не сохраняются (откат для них
//! недоступен, интерфейсу об этом сообщается), хранится не больше 20 последних ответов.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_FILES_PER_DIR: usize = 300;
const MAX_REQUESTS: usize = 20;

struct Snap {
    path: PathBuf,
    /// `None` — файла не было (при откате его удаляют).
    original: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct Checkpoints(Mutex<Vec<(String, Vec<Snap>)>>);

#[derive(Serialize, Clone)]
struct CheckpointEvent {
    request_id: String,
    path: String,
    restorable: bool,
}

fn snapshot_file(path: &Path) -> Option<Snap> {
    match fs::metadata(path) {
        Ok(m) if m.is_file() => {
            if m.len() > MAX_FILE_BYTES {
                return None;
            }
            Some(Snap { path: path.to_path_buf(), original: Some(fs::read(path).ok()?) })
        }
        Err(_) => Some(Snap { path: path.to_path_buf(), original: None }),
        _ => None,
    }
}

fn collect_dir(dir: &Path, out: &mut Vec<Snap>, budget: &mut usize) -> bool {
    let Ok(rd) = fs::read_dir(dir) else { return true };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if !collect_dir(&p, out, budget) {
                return false;
            }
        } else if ft.is_file() {
            if *budget == 0 {
                return false;
            }
            *budget -= 1;
            match snapshot_file(&p) {
                Some(s) => out.push(s),
                None => return false,
            }
        }
    }
    true
}

/// Вызывается перед выполнением изменяющего инструмента.
pub fn record(app: &AppHandle, request_id: &str, tool: &str, args: &Value) {
    if !matches!(tool, "write_file" | "create_file" | "delete_file" | "apply_edit") {
        return;
    }
    let Some(path) = args.get("path").and_then(Value::as_str) else { return };
    let Ok(root) = crate::fs_commands::workspace_root(&app.state::<crate::WorkspaceRoot>()) else { return };
    let target = crate::fs_commands::resolve_existing(&root, path).or_else(|_| crate::fs_commands::resolve_new(&root, path));
    let Ok(target) = target else { return };

    let mut snaps: Vec<Snap> = Vec::new();
    let mut restorable = true;
    if target.is_dir() {
        let mut budget = MAX_FILES_PER_DIR;
        restorable = collect_dir(&target, &mut snaps, &mut budget);
    } else {
        match snapshot_file(&target) {
            Some(s) => snaps.push(s),
            None => restorable = false,
        }
    }

    let st: State<Checkpoints> = app.state();
    let mut all = st.0.lock().unwrap();
    let idx = match all.iter().position(|(id, _)| id == request_id) {
        Some(i) => i,
        None => {
            all.push((request_id.to_string(), Vec::new()));
            if all.len() > MAX_REQUESTS {
                all.remove(0);
            }
            all.len() - 1
        }
    };
    let list = &mut all[idx].1;
    for s in snaps {
        // Первый снимок файла за ответ и есть его исходное состояние.
        if !list.iter().any(|x| x.path == s.path) {
            list.push(s);
        }
    }
    let rel = target.strip_prefix(&root).unwrap_or(&target).to_string_lossy().replace('\\', "/");
    let _ = app.emit("ai-checkpoint", CheckpointEvent { request_id: request_id.to_string(), path: rel, restorable });
}

/// Отменяет все правки агента за один ответ. Возвращает список восстановленных путей.
#[tauri::command]
pub fn agent_undo(app: AppHandle, request_id: String) -> Result<Vec<String>, String> {
    let snaps = {
        let st: State<Checkpoints> = app.state();
        let mut all = st.0.lock().unwrap();
        let i = all.iter().position(|(id, _)| *id == request_id).ok_or("Для этого ответа нечего отменять")?;
        all.remove(i).1
    };
    let root = crate::fs_commands::workspace_root(&app.state::<crate::WorkspaceRoot>())?;
    let mut restored = Vec::new();
    for s in snaps.into_iter().rev() {
        // Откат работает только внутри рабочей области, даже если путь попал в список другим путём.
        if crate::fs_commands::ensure_within(&root, &s.path).is_err() && s.path.parent().map(|p| crate::fs_commands::ensure_within(&root, p).is_err()).unwrap_or(true) {
            continue;
        }
        let ok = match &s.original {
            Some(bytes) => {
                if let Some(parent) = s.path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::write(&s.path, bytes).is_ok()
            }
            None => !s.path.exists() || fs::remove_file(&s.path).is_ok(),
        };
        if ok {
            restored.push(s.path.to_string_lossy().to_string());
        }
    }
    if !restored.is_empty() {
        let _ = app.emit("fs-change", restored.clone());
    }
    Ok(restored.iter().map(|p| Path::new(p).strip_prefix(&root).unwrap_or(Path::new(p)).to_string_lossy().replace('\\', "/")).collect())
}
