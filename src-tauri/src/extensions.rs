//! Расширения из каталога Open VSX (открытый аналог магазина VS Code).
//!
//! Код расширений распаковывается, но запускается только после явного включения (ext_host.rs).
//! распаковываются только декларативные файлы (package.json, темы, сниппеты,
//! грамматики, значки), которые затем читает интерфейс.
//!
//! Безопасность: адреса фиксированы (только open-vsx.org и его хранилище, https),
//! идентификаторы проверяются по белому списку символов, размеры скачивания и
//! распаковки ограничены, пути из архива проходят проверку на выход из папки
//! (zip-slip), символические ссылки и исполняемые типы файлов не распаковываются,
//! чтение файлов расширения не выходит за его папку.

use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use url::Url;

const API: &str = "https://open-vsx.org/api";
const ALLOWED_HOSTS: [&str; 3] = ["open-vsx.org", "openvsx.eclipsecontent.org", "openvsxorg.blob.core.windows.net"];
/// Пакеты крупнее этого скачиваются только после явного согласия пользователя.
const SOFT_VSIX_BYTES: u64 = 40 * 1024 * 1024;
/// Жёсткий потолок скачивания (пакеты со встроенными бинарниками бывают сотни МБ).
const HARD_VSIX_BYTES: u64 = 1024 * 1024 * 1024;
/// Лимиты распаковки считаются по ФАКТИЧЕСКИ прочитанным данным и защищают от «бомб».
/// Код расширения распаковывается, но НЕ запускается, пока пользователь явно не включит его.
const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 50_000;
const MAX_READ_BYTES: u64 = 6 * 1024 * 1024;

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !s.starts_with('.')
}

fn ext_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось определить папку данных: {e}"))?
        .join("extensions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("AIDE-Extensions/1.0")
        .build()
        .map_err(|e| e.to_string())
}

/// Для крупных пакетов таймаут больше (общий, а не на один кусок).
fn client_long() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("AIDE-Extensions/1.0")
        .build()
        .map_err(|e| e.to_string())
}

fn allowed_url(u: &Url) -> bool {
    u.scheme() == "https" && u.host_str().map(|h| ALLOWED_HOSTS.contains(&h)).unwrap_or(false) && u.port().is_none()
}

/// GET с ручной обработкой перенаправлений: каждый адрес перепроверяется по белому списку.
async fn get(url: Url, max_bytes: usize) -> Result<Vec<u8>, String> {
    let client = client()?;
    let mut current = url;
    for _ in 0..4 {
        if !allowed_url(&current) {
            return Err("Адрес вне каталога Open VSX".into());
        }
        let mut resp = client.get(current.clone()).send().await.map_err(|_| "Каталог Open VSX не отвечает".to_string())?;
        if resp.status().is_redirection() {
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Некорректное перенаправление")?;
            current = current.join(loc).map_err(|_| "Некорректное перенаправление".to_string())?;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("Каталог ответил ошибкой {}", resp.status().as_u16()));
        }
        if resp.content_length().map(|n| n as usize > max_bytes).unwrap_or(false) {
            return Err("Файл слишком большой".into());
        }
        let mut out = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|_| "Загрузка прервана".to_string())? {
            if out.len() + chunk.len() > max_bytes {
                return Err("Файл слишком большой".into());
            }
            out.extend_from_slice(&chunk);
        }
        return Ok(out);
    }
    Err("Слишком много перенаправлений".into())
}

/// Скачивает файл на диск потоком (без загрузки целиком в память). Если пакет больше
/// мягкого порога и согласия нет, возвращает ошибку `LARGE:<байт>`, чтобы интерфейс спросил.
async fn download_to_file(url: Url, dest: &Path, confirmed: bool) -> Result<(), String> {
    use std::io::Write;
    let client = client_long()?;
    let mut current = url;
    for _ in 0..4 {
        if !allowed_url(&current) {
            return Err("Адрес вне каталога Open VSX".into());
        }
        let mut resp = client.get(current.clone()).send().await.map_err(|_| "Каталог Open VSX не отвечает".to_string())?;
        if resp.status().is_redirection() {
            let loc = resp.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("Некорректное перенаправление")?;
            current = current.join(loc).map_err(|_| "Некорректное перенаправление".to_string())?;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("Каталог ответил ошибкой {}", resp.status().as_u16()));
        }
        if let Some(n) = resp.content_length() {
            if n > HARD_VSIX_BYTES {
                return Err("Расширение слишком большое (больше 1 ГБ)".into());
            }
            if n > SOFT_VSIX_BYTES && !confirmed {
                return Err(format!("LARGE:{n}"));
            }
        }
        let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
        let mut written: u64 = 0;
        let outcome: Result<(), String> = async {
            while let Some(chunk) = resp.chunk().await.map_err(|_| "Загрузка прервана".to_string())? {
                written += chunk.len() as u64;
                if written > HARD_VSIX_BYTES {
                    return Err("Расширение слишком большое (больше 1 ГБ)".to_string());
                }
                if written > SOFT_VSIX_BYTES && !confirmed {
                    return Err(format!("LARGE:{written}"));
                }
                file.write_all(&chunk).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        .await;
        if outcome.is_err() {
            drop(file);
            let _ = fs::remove_file(dest);
        }
        return outcome;
    }
    Err("Слишком много перенаправлений".into())
}

#[tauri::command]
pub async fn ext_search(query: String, offset: u32, category: Option<String>) -> Result<Value, String> {
    let q = query.trim();
    if q.len() > 100 {
        return Err("Слишком длинный запрос".into());
    }
    let mut url = Url::parse(&format!("{API}/-/search")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("query", q);
        pairs.append_pair("size", "20");
        pairs.append_pair("offset", &offset.min(10_000).to_string());
        pairs.append_pair("sortBy", "downloadCount");
        pairs.append_pair("sortOrder", "desc");
        if let Some(c) = category.filter(|c| ["Themes", "Snippets", "Programming Languages", "Other"].contains(&c.as_str())) {
            pairs.append_pair("category", &c);
        }
    }
    let body = get(url, 2 * 1024 * 1024).await?;
    let v: Value = serde_json::from_slice(&body).map_err(|_| "Некорректный ответ каталога".to_string())?;
    let items: Vec<Value> = v["extensions"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|e| {
                    json!({
                        "namespace": e["namespace"],
                        "name": e["name"],
                        "displayName": e["displayName"],
                        "description": e["description"],
                        "version": e["version"],
                        "iconUrl": e["files"]["icon"],
                        "downloadCount": e["downloadCount"],
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({ "total": v["totalSize"], "items": items }))
}

/// Платформа этого компьютера в терминах VS Code (`win32-x64`, `darwin-arm64`…).
fn target_platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "win32-x64",
        ("windows", "aarch64") => "win32-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("macos", "aarch64") => "darwin-arm64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        _ => "universal",
    }
}

/// Ссылка на сборку под нашу платформу. Ответ каталога по умолчанию описывает ПРОИЗВОЛЬНУЮ
/// платформу (например, alpine-arm64), поэтому берём её из `downloads`, иначе расширения с
/// нативными программами (как Claude Code) приходят без нужного бинарника.
fn pick_download(meta: &Value) -> Option<String> {
    if let Some(map) = meta["downloads"].as_object() {
        for key in [target_platform(), "universal"] {
            if let Some(u) = map.get(key).and_then(Value::as_str) {
                return Some(u.to_string());
            }
        }
        // У расширения есть только сборки под другие платформы: молча подсовывать чужую нельзя.
        if !map.is_empty() {
            return None;
        }
    }
    meta["files"]["download"].as_str().map(String::from)
}

fn extract<R: Read + std::io::Seek>(reader: R, target: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| "Файл расширения повреждён".to_string())?;
    if archive.len() > MAX_ENTRIES {
        return Err("В расширении слишком много файлов".into());
    }
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|_| "Файл расширения повреждён".to_string())?;
        if file.is_dir() {
            continue;
        }
        // Символические ссылки и всё необычное пропускаем.
        if let Some(mode) = file.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                continue;
            }
        }
        let Some(rel) = file.enclosed_name() else { continue };
        let Ok(inner) = rel.strip_prefix("extension") else { continue };
        if inner.as_os_str().is_empty() || inner.components().any(|c| !matches!(c, Component::Normal(_))) {
            continue;
        }
        if file.size() > MAX_ENTRY_BYTES {
            continue;
        }
        let dest = target.join(inner);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Потоковое копирование с жёстким пределом по фактическим байтам (размер в заголовке архива может лгать).
        let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
        let copied = std::io::copy(&mut (&mut file).take(MAX_ENTRY_BYTES + 1), &mut out).map_err(|_| "Файл расширения повреждён".to_string())?;
        drop(out);
        if copied > MAX_ENTRY_BYTES {
            let _ = fs::remove_file(&dest);
            continue;
        }
        total += copied;
        if total > MAX_TOTAL_BYTES {
            return Err("Данные расширения слишком велики".into());
        }
    }
    if !target.join("package.json").is_file() {
        return Err("В расширении нет package.json".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn ext_install(app: AppHandle, namespace: String, name: String, confirm_large: Option<bool>) -> Result<String, String> {
    if !valid_id(&namespace) || !valid_id(&name) {
        return Err("Некорректное имя расширения".into());
    }
    let meta_url = Url::parse(&format!("{API}/{namespace}/{name}")).map_err(|e| e.to_string())?;
    let meta: Value = serde_json::from_slice(&get(meta_url, 2 * 1024 * 1024).await?).map_err(|_| "Некорректный ответ каталога".to_string())?;
    let download = pick_download(&meta).ok_or("У расширения нет файла для скачивания")?;
    let download = Url::parse(&download).map_err(|_| "Некорректный адрес файла".to_string())?;
    let id = format!("{namespace}.{name}");
    let root = ext_root(&app)?;
    let tmp = root.join(format!(".tmp-{id}"));
    let dest = root.join(&id);
    let vsix_path = root.join(format!(".dl-{id}.vsix"));
    download_to_file(download, &vsix_path, confirm_large.unwrap_or(false)).await?;
    let vsix_for_cleanup = vsix_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        let opened = fs::File::open(&vsix_path).map_err(|e| e.to_string());
        let outcome = opened.and_then(|f| extract(std::io::BufReader::new(f), &tmp));
        let _ = fs::remove_file(&vsix_path);
        if let Err(e) = outcome {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
        let _ = fs::remove_dir_all(&dest);
        fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&vsix_for_cleanup);
    result?;
    Ok(id)
}

#[tauri::command]
pub fn ext_list(app: AppHandle) -> Result<Vec<String>, String> {
    let root = ext_root(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() && !name.starts_with('.') && valid_id(&name) && entry.path().join("package.json").is_file() {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn ext_remove(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Некорректное имя расширения".into());
    }
    let dir = ext_root(&app)?.join(&id);
    if dir.is_dir() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Читает файл внутри папки расширения (путь относительный, без выхода наружу).
#[tauri::command]
pub fn ext_read(app: AppHandle, id: String, path: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("Некорректное имя расширения".into());
    }
    let rel = Path::new(&path);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err("Недопустимый путь".into());
    }
    let base = ext_root(&app)?.join(&id).canonicalize().map_err(|_| "Расширение не найдено".to_string())?;
    let full = base.join(rel).canonicalize().map_err(|_| "Файл не найден".to_string())?;
    if !full.starts_with(&base) || !full.is_file() {
        return Err("Недопустимый путь".into());
    }
    if full.metadata().map(|m| m.len()).unwrap_or(0) > MAX_READ_BYTES {
        return Err("Файл слишком большой".into());
    }
    let bytes = fs::read(full).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in files {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn download_matches_the_platform() {
        let me = target_platform();
        let meta = serde_json::json!({
            "files": { "download": "https://open-vsx.org/alpine.vsix" },
            "downloads": { "alpine-arm64": "https://open-vsx.org/alpine.vsix", me: "https://open-vsx.org/mine.vsix" }
        });
        assert_eq!(pick_download(&meta).as_deref(), Some("https://open-vsx.org/mine.vsix"));
        let universal = serde_json::json!({ "files": { "download": "x" }, "downloads": { "universal": "https://open-vsx.org/u.vsix" } });
        assert_eq!(pick_download(&universal).as_deref(), Some("https://open-vsx.org/u.vsix"));
        let foreign = serde_json::json!({ "files": { "download": "https://open-vsx.org/a.vsix" }, "downloads": { "alpine-arm64": "https://open-vsx.org/a.vsix" } });
        assert!(pick_download(&foreign).is_none(), "never install another platform's build");
        let old = serde_json::json!({ "files": { "download": "https://open-vsx.org/old.vsix" } });
        assert_eq!(pick_download(&old).as_deref(), Some("https://open-vsx.org/old.vsix"));
    }

    #[test]
    fn ids_are_validated() {
        assert!(valid_id("dracula-theme"));
        assert!(valid_id("a.b_c-1"));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(".hidden"));
        assert!(!valid_id(""));
    }

    #[test]
    fn only_allowlisted_https_hosts() {
        assert!(allowed_url(&Url::parse("https://open-vsx.org/api/a/b").unwrap()));
        assert!(!allowed_url(&Url::parse("http://open-vsx.org/x").unwrap()));
        assert!(!allowed_url(&Url::parse("https://open-vsx.org.evil.com/x").unwrap()));
        assert!(!allowed_url(&Url::parse("https://127.0.0.1/x").unwrap()));
    }

    #[test]
    fn extracts_extension_files_safely() {
        let zipped = make_zip(&[
            ("extension/package.json", b"{}"),
            ("extension/themes/a.json", b"{}"),
            ("extension/out/extension.js", b"evil()"),
            ("extension/bin/run.exe", b"MZ"),
            ("../escape.json", b"{}"),
            ("extension/../../escape2.json", b"{}"),
        ]);
        let dir = std::env::temp_dir().join(format!("aide-ext-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        extract(Cursor::new(zipped.clone()), &dir).unwrap();
        assert!(dir.join("package.json").is_file());
        assert!(dir.join("themes/a.json").is_file());
        assert!(dir.join("out/extension.js").is_file(), "code is now extracted (but only run after consent)");
        assert!(!dir.parent().unwrap().join("escape.json").exists());
        assert!(!dir.parent().unwrap().join("escape2.json").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_archive_without_manifest() {
        let zipped = make_zip(&[("extension/themes/a.json", b"{}")]);
        let dir = std::env::temp_dir().join(format!("aide-ext-test2-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(extract(Cursor::new(zipped.clone()), &dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    /// Real network: search Open VSX, download a theme and a language extension, extract them.
    #[tokio::test]
    #[ignore]
    async fn open_vsx_roundtrip() {
        let mut url = Url::parse(&format!("{API}/-/search")).unwrap();
        url.query_pairs_mut().append_pair("query", "dracula").append_pair("size", "3").append_pair("category", "Themes");
        let v: Value = serde_json::from_slice(&get(url, 2_000_000).await.unwrap()).unwrap();
        let first = &v["extensions"][0];
        println!("search: total={} first={}.{}", v["totalSize"], first["namespace"], first["name"]);
        for (ns, name) in [("dracula-theme", "theme-dracula"), ("redhat", "vscode-yaml")] {
            let meta: Value = serde_json::from_slice(&get(Url::parse(&format!("{API}/{ns}/{name}")).unwrap(), 2_000_000).await.unwrap()).unwrap();
            let dl = Url::parse(meta["files"]["download"].as_str().unwrap()).unwrap();
            println!("download host: {:?}", dl.host_str());
            let vsix = std::env::temp_dir().join(format!("aide-net-{name}.vsix"));
            download_to_file(dl, &vsix, false).await.unwrap();
            let dir = std::env::temp_dir().join(format!("aide-net-{name}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            extract(std::io::BufReader::new(fs::File::open(&vsix).unwrap()), &dir).unwrap();
            let mut files: Vec<String> = Vec::new();
            fn walk(d: &Path, base: &Path, out: &mut Vec<String>) {
                for e in fs::read_dir(d).unwrap().flatten() {
                    if e.path().is_dir() { walk(&e.path(), base, out) } else { out.push(e.path().strip_prefix(base).unwrap().to_string_lossy().to_string()) }
                }
            }
            walk(&dir, &dir, &mut files);
            println!("{name}: {} files, e.g. {:?}", files.len(), files.iter().take(6).collect::<Vec<_>>());
        }
    }
}

#[cfg(test)]
mod large_tests {
    use super::*;

    /// Real network: a 150+ MB extension must ask for confirmation, then install after consent.
    #[tokio::test]
    #[ignore]
    async fn large_extension_needs_consent() {
        let meta: Value = serde_json::from_slice(&get(Url::parse(&format!("{API}/anthropic/claude-code")).unwrap(), 2_000_000).await.unwrap()).unwrap();
        let dl = Url::parse(meta["files"]["download"].as_str().unwrap()).unwrap();
        let vsix = std::env::temp_dir().join("aide-large.vsix");
        let _ = fs::remove_file(&vsix);
        let err = download_to_file(dl.clone(), &vsix, false).await.unwrap_err();
        println!("without consent: {err}; file left: {}", vsix.exists());
        assert!(err.starts_with("LARGE:") && !vsix.exists());
        let t = std::time::Instant::now();
        download_to_file(dl, &vsix, true).await.unwrap();
        println!("downloaded {} MB in {:?}", fs::metadata(&vsix).unwrap().len() / 1_048_576, t.elapsed());
        let dir = std::env::temp_dir().join("aide-large-ext");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        extract(std::io::BufReader::new(fs::File::open(&vsix).unwrap()), &dir).unwrap();
        let size: u64 = fs::read_dir(&dir).unwrap().flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum();
        println!("extracted top-level bytes: {size}; package.json: {}", dir.join("package.json").is_file());
        let _ = fs::remove_file(&vsix);
        let _ = fs::remove_dir_all(&dir);
    }
}
