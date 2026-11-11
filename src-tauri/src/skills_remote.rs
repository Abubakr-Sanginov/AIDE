//! Каталог https://skills.sh/ и установка навыков (SKILL.md) из публичных GitHub-репозиториев.
//!
//! Безопасность:
//! - ходим только на skills.sh, api.github.com и raw.githubusercontent.com (https, перенаправления
//!   проверяются по тому же списку);
//! - owner/repo/пути проверяются по строгому шаблону, `..` и скрытые сегменты запрещены;
//! - лимиты на число файлов, размер каждого файла и общий объём; таймауты на каждый запрос;
//! - скачиваются только текстовые справочные файлы; скрипты (sh/ps1/bat/…) и папка scripts/
//!   пропускаются — навык никогда не исполняется, это только текст для модели;
//! - содержимое из интернета недоверенное: клиент его не присылает при установке, Rust скачивает
//!   заново и пишет только внутрь папки навыков (проверка канонических путей).

use std::{fs, path::{Path, PathBuf}, time::Duration};

use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

const ALLOWED_HOSTS: [&str; 3] = ["skills.sh", "api.github.com", "raw.githubusercontent.com"];
const MAX_SEARCH_BYTES: usize = 512 * 1024;
const MAX_TREE_BYTES: usize = 6 * 1024 * 1024;
const MAX_SKILL_MD: u64 = 64 * 1024;
const MAX_EXTRA_FILE: u64 = 128 * 1024;
const MAX_EXTRA_FILES: usize = 80;
const MAX_TOTAL: u64 = 1536 * 1024;
const MAX_REPO_SKILLS: usize = 60;
pub(crate) const META_FILE: &str = ".aide-source.json";

const TEXT_EXT: [&str; 22] = [
    "md", "mdx", "txt", "json", "yaml", "yml", "toml", "csv", "xml", "html", "css", "scss",
    "js", "jsx", "ts", "tsx", "py", "sql", "go", "rs", "java", "kt",
];

fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::custom(|attempt| {
            let ok = attempt.previous().len() < 4
                && attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h));
            if ok { attempt.follow() } else { attempt.stop() }
        }))
        .user_agent("AIDE-skills")
        .build()
        .map_err(|e| e.to_string())
}

async fn get(client: &Client, url: &str, max: usize, accept: Option<&str>) -> Result<Vec<u8>, String> {
    let parsed = Url::parse(url).map_err(|_| "Некорректный адрес".to_string())?;
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h)) {
        return Err("Адрес не разрешён".into());
    }
    let mut req = client.get(parsed);
    if let Some(a) = accept { req = req.header("Accept", a); }
    let resp = req.send().await.map_err(|e| format!("Сеть недоступна: {}", e.without_url()))?;
    let status = resp.status();
    if status.as_u16() == 403 || status.as_u16() == 429 {
        return Err("Превышен лимит запросов GitHub/skills.sh, попробуйте позже".into());
    }
    if !status.is_success() {
        return Err(format!("Сервер ответил {}", status.as_u16()));
    }
    let mut out = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.without_url().to_string())?;
        if out.len() + chunk.len() > max { return Err("Ответ слишком большой".into()); }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn seg_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && !s.starts_with('.')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `owner/repo` — только такие источники поддерживаются (GitHub).
fn split_source(source: &str) -> Result<(String, String), String> {
    let (owner, repo) = source.split_once('/').ok_or("Ожидается owner/repo")?;
    let repo = repo.trim_end_matches(".git");
    if !seg_ok(owner) || !seg_ok(repo) || repo.contains('/') {
        return Err("Поддерживаются только GitHub-репозитории вида owner/repo".into());
    }
    Ok((owner.to_string(), repo.to_string()))
}

/// Folder name for an installed skill: lowercase ascii, digits, '-' / '_'.
pub(crate) fn folder_name(skill_id: &str) -> Option<String> {
    let s: String = skill_id.trim().to_ascii_lowercase().chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .take(64).collect();
    let s = s.trim_matches('-').to_string();
    (!s.is_empty()).then_some(s)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatalogHit {
    pub source: String,
    pub skill_id: String,
    pub name: String,
    pub installs: u64,
}

#[tauri::command]
pub async fn skills_search(query: String) -> Result<Vec<CatalogHit>, String> {
    let q = query.trim();
    if q.chars().count() < 2 || q.chars().count() > 64 { return Err("Запрос: от 2 до 64 символов".into()); }
    let mut url = Url::parse("https://skills.sh/api/search").unwrap();
    url.query_pairs_mut().append_pair("q", q).append_pair("limit", "30");
    let raw = get(&client()?, url.as_str(), MAX_SEARCH_BYTES, Some("application/json")).await?;
    let v: Value = serde_json::from_slice(&raw).map_err(|_| "Некорректный ответ skills.sh".to_string())?;
    let mut out = Vec::new();
    for s in v.get("skills").and_then(Value::as_array).into_iter().flatten().take(30) {
        let source = s.get("source").and_then(Value::as_str).unwrap_or_default();
        let skill_id = s.get("skillId").and_then(Value::as_str).unwrap_or_default();
        // Non-GitHub sources (custom domains) are skipped: we only download from GitHub.
        if split_source(source).is_err() || folder_name(skill_id).is_none() { continue; }
        out.push(CatalogHit {
            source: source.into(),
            skill_id: skill_id.chars().take(80).collect(),
            name: s.get("name").and_then(Value::as_str).unwrap_or(skill_id).chars().take(80).collect(),
            installs: s.get("installs").and_then(Value::as_u64).unwrap_or(0),
        });
    }
    Ok(out)
}

/// Accepts `owner/repo`, `owner/repo/skill`, `https://skills.sh/owner/repo/skill`,
/// `https://github.com/owner/repo[/tree/ref/path]` or `npx skills add owner/repo --skill x`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSource { pub source: String, pub skill_id: Option<String> }

pub(crate) fn parse_input(input: &str) -> Result<ParsedSource, String> {
    let mut text = input.trim().to_string();
    let mut skill_flag = None;
    if let Some(rest) = text.strip_prefix("npx ") {
        let parts: Vec<&str> = rest.split_whitespace().collect();
        let mut target = None;
        let mut i = 0;
        while i < parts.len() {
            match parts[i] {
                "--skill" | "-s" => { skill_flag = parts.get(i + 1).map(|s| s.to_string()); i += 1; }
                p if !p.starts_with('-') && p != "skills" && p != "add" && !p.starts_with("skills@") => target = Some(p.to_string()),
                _ => {}
            }
            i += 1;
        }
        text = target.ok_or("Не найден источник в команде")?;
    }
    let path = if let Ok(url) = Url::parse(&text) {
        let host = url.host_str().unwrap_or_default();
        if url.scheme() != "https" || !matches!(host, "skills.sh" | "github.com" | "www.github.com") {
            return Err("Поддерживаются ссылки skills.sh и github.com".into());
        }
        let parts: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
        if host == "skills.sh" {
            parts.join("/")
        } else if parts.len() >= 5 && matches!(parts[2], "tree" | "blob") {
            // github.com/o/r/tree/ref/.../folder[/SKILL.md] -> o/r/folder
            let mut tail: Vec<&str> = parts[4..].to_vec();
            if tail.last().is_some_and(|l| l.eq_ignore_ascii_case("SKILL.md")) { tail.pop(); }
            match tail.last() { Some(last) => format!("{}/{}/{}", parts[0], parts[1], last), None => format!("{}/{}", parts[0], parts[1]) }
        } else {
            parts.iter().take(2).cloned().collect::<Vec<_>>().join("/")
        }
    } else { text.clone() };
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.len() < 2 || segs.len() > 3 { return Err("Ожидается owner/repo или owner/repo/skill".into()); }
    let source = format!("{}/{}", segs[0], segs[1].trim_end_matches(".git"));
    split_source(&source)?;
    let skill_id = skill_flag.or(segs.get(2).map(|s| s.to_string()));
    if let Some(s) = &skill_id { if folder_name(s).is_none() { return Err("Некорректное имя навыка".into()); } }
    Ok(ParsedSource { source, skill_id })
}

#[tauri::command]
pub fn skills_parse_input(input: String) -> Result<ParsedSource, String> { parse_input(&input) }

struct RepoTree { sha: String, blobs: Vec<(String, u64)> }

async fn repo_tree(client: &Client, owner: &str, repo: &str) -> Result<RepoTree, String> {
    let sha_raw = get(client, &format!("https://api.github.com/repos/{owner}/{repo}/commits/HEAD"), 256, Some("application/vnd.github.sha")).await
        .map_err(|e| format!("Репозиторий {owner}/{repo} недоступен: {e}"))?;
    let sha = String::from_utf8_lossy(&sha_raw).trim().to_string();
    if sha.len() != 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) { return Err("Не удалось определить версию репозитория".into()); }
    let raw = get(client, &format!("https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"), MAX_TREE_BYTES, Some("application/vnd.github+json")).await?;
    let v: Value = serde_json::from_slice(&raw).map_err(|_| "Некорректный ответ GitHub".to_string())?;
    let blobs = v.get("tree").and_then(Value::as_array).into_iter().flatten()
        .filter(|e| e.get("type").and_then(Value::as_str) == Some("blob"))
        .filter_map(|e| Some((e.get("path")?.as_str()?.to_string(), e.get("size").and_then(Value::as_u64).unwrap_or(0))))
        .collect();
    Ok(RepoTree { sha, blobs })
}

fn path_ok(p: &str) -> bool { p.len() <= 300 && p.split('/').all(seg_ok) }

fn skill_files(tree: &RepoTree) -> Vec<&str> {
    tree.blobs.iter().map(|(p, _)| p.as_str())
        .filter(|p| p.rsplit('/').next().is_some_and(|f| f.eq_ignore_ascii_case("SKILL.md")))
        // Hidden install copies (.claude/skills, .agents/...) are allowed as a source location.
        .filter(|p| p.split('/').all(|s| !s.is_empty() && s != ".." && s.len() <= 100))
        .collect()
}

fn parent(p: &str) -> &str { p.rsplit_once('/').map(|(d, _)| d).unwrap_or("") }
fn folder_of(p: &str) -> &str { parent(p).rsplit('/').next().unwrap_or("") }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSkill { pub skill_id: String, pub path: String }

#[tauri::command]
pub async fn skills_repo(source: String) -> Result<Vec<RepoSkill>, String> {
    let (owner, repo) = split_source(&source)?;
    let tree = repo_tree(&client()?, &owner, &repo).await?;
    let mut out: Vec<RepoSkill> = Vec::new();
    for p in skill_files(&tree) {
        let id = if parent(p).is_empty() { repo.clone() } else { folder_of(p).to_string() };
        let Some(id) = folder_name(&id) else { continue };
        if out.iter().any(|s| s.skill_id == id) { continue; }
        out.push(RepoSkill { skill_id: id, path: p.to_string() });
        if out.len() >= MAX_REPO_SKILLS { break; }
    }
    if out.is_empty() { return Err("В репозитории не найдено SKILL.md".into()); }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub source: String,
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub body: String,
    pub path: String,
    pub sha: String,
    pub files: Vec<String>,
    pub skipped: usize,
}

struct Fetched { preview: Preview, raw_skill: String, extra: Vec<(String, u64)> }

async fn fetch_skill(client: &Client, source: &str, skill_id: &str) -> Result<Fetched, String> {
    let (owner, repo) = split_source(source)?;
    let want = folder_name(skill_id).ok_or("Некорректное имя навыка")?;
    let tree = repo_tree(client, &owner, &repo).await?;
    let candidates = skill_files(&tree);
    // Prefer a folder named like the skill; prefer shorter (canonical) paths over install copies.
    let mut matches: Vec<&str> = candidates.iter().cloned()
        .filter(|p| folder_name(if parent(p).is_empty() { &repo } else { folder_of(p) }).as_deref() == Some(want.as_str()))
        .collect();
    matches.sort_by_key(|p| (p.starts_with('.'), p.len()));
    let mut chosen = matches.first().map(|s| s.to_string());
    let raw_url = |p: &str| format!("https://raw.githubusercontent.com/{owner}/{repo}/{}/{}", tree.sha, p);
    let mut raw_skill = None;
    if chosen.is_none() {
        // Folder differs from the frontmatter name: check a few SKILL.md files by name.
        for p in candidates.iter().take(12) {
            let Ok(bytes) = get(client, &raw_url(p), MAX_SKILL_MD as usize, None).await else { continue };
            let text = String::from_utf8_lossy(&bytes).to_string();
            if crate::skills::frontmatter_name(&text).and_then(|n| folder_name(&n)).as_deref() == Some(want.as_str()) {
                chosen = Some(p.to_string());
                raw_skill = Some(text);
                break;
            }
        }
    }
    let path = chosen.ok_or_else(|| format!("Навык «{skill_id}» не найден в {source}"))?;
    let size = tree.blobs.iter().find(|(p, _)| *p == path).map(|(_, s)| *s).unwrap_or(0);
    if size > MAX_SKILL_MD { return Err("SKILL.md слишком большой (больше 64 КБ)".into()); }
    let raw_skill = match raw_skill {
        Some(t) => t,
        None => String::from_utf8(get(client, &raw_url(&path), MAX_SKILL_MD as usize, None).await?)
            .map_err(|_| "SKILL.md не в UTF-8".to_string())?,
    };
    let parsed = crate::skills::parse_meta(&raw_skill).ok_or("SKILL.md без name в заголовке (frontmatter)")?;
    let dir = parent(&path);
    let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
    let mut extra = Vec::new();
    let mut skipped = 0;
    let nested: Vec<String> = candidates.iter().filter(|c| **c != path && c.starts_with(&prefix))
        .map(|c| parent(&c[prefix.len()..])).filter(|d| !d.is_empty()).map(|d| format!("{d}/")).collect();
    let mut total = raw_skill.len() as u64;
    // Skills in the repository root: only take files next to SKILL.md, not the whole repository.
    for (p, s) in &tree.blobs {
        let Some(rel) = p.strip_prefix(&prefix) else { continue };
        if rel.eq_ignore_ascii_case("SKILL.md") || (dir.is_empty() && rel.contains('/')) { continue; }
        // Nested skills (another SKILL.md deeper in this folder) belong to themselves.
        if nested.iter().any(|n| rel.starts_with(n.as_str())) { skipped += 1; continue; }
        let ext = rel.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        let ok = path_ok(rel) && !rel.split('/').any(|s| s.eq_ignore_ascii_case("scripts"))
            && TEXT_EXT.contains(&ext.as_str()) && *s <= MAX_EXTRA_FILE
            && extra.len() < MAX_EXTRA_FILES && total + s <= MAX_TOTAL;
        if ok { total += s; extra.push((rel.to_string(), *s)); } else { skipped += 1; }
    }
    extra.sort();
    let preview = Preview {
        source: source.to_string(),
        skill_id: want,
        name: parsed.0,
        description: parsed.1,
        body: crate::skills::body_of(&raw_skill).chars().take(20_000).collect(),
        path,
        sha: tree.sha.clone(),
        files: extra.iter().map(|(p, _)| p.clone()).collect(),
        skipped,
    };
    Ok(Fetched { preview, raw_skill, extra })
}

#[tauri::command]
pub async fn skills_preview(source: String, skill_id: String) -> Result<Preview, String> {
    Ok(fetch_skill(&client()?, &source, &skill_id).await?.preview)
}

/// Installs into the global folder (app data) or the open project (`.aide/skills`).
#[tauri::command]
pub async fn skills_install(app: AppHandle, source: String, skill_id: String, scope: String) -> Result<String, String> {
    let base = match scope.as_str() {
        "global" => crate::skills::global_dir(&app)?,
        "project" => crate::skills::project_dir(&app, true)?,
        _ => return Err("Неизвестная область установки".into()),
    };
    let client = client()?;
    let f = fetch_skill(&client, &source, &skill_id).await?;
    let (owner, repo) = split_source(&source)?;
    let dir_path = parent(&f.preview.path).to_string();
    let mut files: Vec<(String, Vec<u8>)> = vec![("SKILL.md".into(), f.raw_skill.clone().into_bytes())];
    for (rel, _) in &f.extra {
        let full = if dir_path.is_empty() { rel.clone() } else { format!("{dir_path}/{rel}") };
        let url = format!("https://raw.githubusercontent.com/{owner}/{repo}/{}/{full}", f.preview.sha);
        match get(&client, &url, MAX_EXTRA_FILE as usize, None).await {
            // Text only: binary or non-UTF-8 files are dropped.
            Ok(bytes) if std::str::from_utf8(&bytes).is_ok() => files.push((rel.clone(), bytes)),
            _ => {}
        }
    }
    let meta = serde_json::json!({
        "source": source, "skillId": f.preview.skill_id, "path": f.preview.path, "sha": f.preview.sha,
        "installedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    });
    files.push((META_FILE.into(), serde_json::to_vec_pretty(&meta).unwrap()));
    write_skill(&base, &f.preview.skill_id, &files)?;
    let prefix = if scope == "global" { "global" } else { "project" };
    Ok(format!("{prefix}:{}", f.preview.skill_id))
}

/// Writes into `<base>/.tmp-<name>` then swaps it in, so a failed download never leaves half a skill.
pub(crate) fn write_skill(base: &Path, name: &str, files: &[(String, Vec<u8>)]) -> Result<PathBuf, String> {
    let name = folder_name(name).ok_or("Некорректное имя навыка")?;
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let base = crate::strip_verbatim(base.canonicalize().map_err(|e| e.to_string())?);
    let tmp = base.join(format!(".tmp-{name}"));
    let _ = fs::remove_dir_all(&tmp);
    for (rel, bytes) in files {
        if rel != META_FILE && !path_ok(rel) { continue; }
        let target = tmp.join(rel);
        if !target.starts_with(&tmp) { return Err("Недопустимый путь в навыке".into()); }
        if let Some(p) = target.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    let dest = base.join(&name);
    if dest.exists() {
        let canon = crate::strip_verbatim(dest.canonicalize().map_err(|e| e.to_string())?);
        if !canon.starts_with(&base) || canon == base { return Err("Путь вне папки навыков".into()); }
        fs::remove_dir_all(&canon).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_inputs() {
        let p = parse_input("vercel-labs/agent-skills").unwrap();
        assert_eq!(p.source, "vercel-labs/agent-skills");
        assert!(p.skill_id.is_none());
        let p = parse_input("https://skills.sh/anthropics/skills/frontend-design").unwrap();
        assert_eq!((p.source.as_str(), p.skill_id.as_deref()), ("anthropics/skills", Some("frontend-design")));
        let p = parse_input("npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices").unwrap();
        assert_eq!((p.source.as_str(), p.skill_id.as_deref()), ("vercel-labs/agent-skills", Some("vercel-react-best-practices")));
        let p = parse_input("https://github.com/anthropics/skills/tree/main/skills/webapp-testing").unwrap();
        assert_eq!(p.skill_id.as_deref(), Some("webapp-testing"));
        assert!(parse_input("http://github.com/a/b").is_err());
        assert!(parse_input("https://evil.com/a/b").is_err());
        assert!(parse_input("../x/y").is_err());
        assert!(parse_input("a/b/c/d").is_err());
    }
    #[test]
    fn write_is_contained() {
        let base = std::env::temp_dir().join(format!("aide-skill-write-{}", std::process::id()));
        let files = vec![("SKILL.md".to_string(), b"---\nname: x\n---\nhi".to_vec()), ("../evil.md".to_string(), b"x".to_vec())];
        let dest = write_skill(&base, "My Skill", &files).unwrap();
        assert!(dest.ends_with("my-skill"));
        assert!(dest.join("SKILL.md").exists());
        assert!(!base.join("evil.md").exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    #[ignore = "network"]
    fn live_search_and_preview() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let hits = skills_search("react best practices".into()).await.unwrap();
            assert!(!hits.is_empty());
            let c = client().unwrap();
            for (src, id) in [("vercel-labs/agent-skills", "vercel-react-best-practices"), ("anthropics/skills", "frontend-design")] {
                let f = fetch_skill(&c, src, id).await.unwrap();
                println!("{src}/{id}: {} files={:?} skipped={} body={}", f.preview.path, f.preview.files.len(), f.preview.skipped, f.preview.body.len());
                assert!(!f.preview.description.is_empty());
            }
        });
    }
}
