//! Надёжное хранилище состояния приложения.
//!
//! Настройки, чаты и дизайны живут в `localStorage` окна, а оно привязано к адресу
//! и профилю WebView и может «потеряться» (другой запуск, сброс профиля). Поэтому
//! фронтенд дублирует свои ключи `aide.*` в один JSON-файл в каталоге конфигурации
//! приложения и восстанавливает их при старте.
//!
//! Безопасность: путь к файлу фиксирован, принимаются только ключи `aide.*`
//! из ограниченного набора символов, размеры значений и файла ограничены.

use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex};

use tauri::{Manager, State};

const MAX_KEY_LEN: usize = 120;
const MAX_VALUE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;

/// Сериализует доступ к файлу: чтение-изменение-запись должны быть атомарными.
#[derive(Default)]
pub struct KvLock(pub Mutex<()>);

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Не удалось определить директорию конфигурации: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

fn valid_key(key: &str) -> bool {
    key.starts_with("aide.")
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Читает файл. Повреждённый файл не затираем: откладываем его в сторону.
fn read_all(path: &PathBuf) -> BTreeMap<String, String> {
    let Ok(text) = fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    match serde_json::from_str::<BTreeMap<String, String>>(&text) {
        Ok(map) => map,
        Err(_) => {
            let _ = fs::rename(path, path.with_extension("json.corrupt"));
            BTreeMap::new()
        }
    }
}

#[tauri::command]
pub fn kv_load(app: tauri::AppHandle, lock: State<KvLock>) -> Result<BTreeMap<String, String>, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let path = state_path(&app)?;
    Ok(read_all(&path))
}

/// `changes`: ключ → новое значение, либо `null` для удаления.
#[tauri::command]
pub fn kv_save(
    app: tauri::AppHandle,
    lock: State<KvLock>,
    changes: BTreeMap<String, Option<String>>,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let path = state_path(&app)?;
    let mut map = read_all(&path);
    for (key, value) in changes {
        if !valid_key(&key) {
            continue;
        }
        match value {
            Some(v) if v.len() <= MAX_VALUE_BYTES => {
                map.insert(key, v);
            }
            Some(_) => {}
            None => {
                map.remove(&key);
            }
        }
    }
    let total: usize = map.iter().map(|(k, v)| k.len() + v.len()).sum();
    if total > MAX_TOTAL_BYTES {
        return Err("Состояние приложения слишком велико для сохранения".into());
    }
    let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    // Запись через временный файл: обрыв посреди записи не портит сохранённое.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
