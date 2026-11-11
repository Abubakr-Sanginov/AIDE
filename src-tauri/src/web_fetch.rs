//! Загрузка одной публичной веб-страницы как образца дизайна («Сайт как пример»).
//!
//! Это единственное место, где приложение ходит на произвольный адрес по просьбе
//! пользователя, поэтому здесь защита от SSRF и ограничения:
//! - только http/https, порты 80/443/8080/8443, без логина в адресе;
//! - адрес хоста резолвится заранее, и подключение «прибивается» к проверенным IP
//!   (защита от DNS-rebinding); локальные, приватные, link-local (в т.ч. 169.254.169.254),
//!   CGNAT, multicast и зарезервированные диапазоны запрещены;
//! - перенаправления не следуем автоматически: каждый шаг проверяется заново;
//! - лимиты на размер (HTML 2 МБ, CSS 400 КБ), число стилей (8) и время (20 с на запрос).

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Url};
use serde::Serialize;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_CSS_BYTES: usize = 400 * 1024;
const MAX_STYLESHEETS: usize = 8;
const MAX_REDIRECTS: usize = 5;
const ALLOWED_PORTS: [u16; 4] = [80, 443, 8080, 8443];
// Многие сайты отклоняют запросы без привычных браузерных заголовков (ответ 403).
// Мы представляемся обычным браузером, но не пытаемся обходить защиту от ботов.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE: &str = "en-US,en;q=0.9,ru;q=0.8";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stylesheet {
    pub url: String,
    pub css: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSnapshot {
    pub final_url: String,
    pub html: String,
    pub stylesheets: Vec<Stylesheet>,
}

/// true — адрес нельзя использовать для исходящего запроса.
pub(crate) fn blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xC0) == 64) // 100.64.0.0/10 (CGNAT)
                || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // 198.18.0.0/15
                || o[0] >= 240 // зарезервировано
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return blocked_ip(IpAddr::V4(v4));
            }
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10
        }
    }
}

/// Проверяет адрес и возвращает проверенные IP для подключения.
async fn validate_target(url: &Url) -> Result<Vec<SocketAddr>, String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Поддерживаются только ссылки http и https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Адрес не должен содержать логин или пароль".into());
    }
    let host = url.host_str().ok_or("В ссылке нет адреса сайта")?.to_lowercase();
    let port = url.port_or_known_default().ok_or("Не удалось определить порт")?;
    if !ALLOWED_PORTS.contains(&port) {
        return Err("Этот порт не поддерживается (доступны 80, 443, 8080, 8443)".into());
    }
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") {
        return Err("Локальные адреса недоступны".into());
    }
    let addrs: Vec<SocketAddr> = match url.host() {
        Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        _ => tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| "Не удалось найти такой сайт".to_string())?
            .collect(),
    };
    if addrs.is_empty() {
        return Err("Не удалось найти такой сайт".into());
    }
    // Если хотя бы один адрес внутренний, отказываем целиком.
    if addrs.iter().any(|a| blocked_ip(a.ip())) {
        return Err("Адрес ведёт во внутреннюю сеть, такие ссылки недоступны".into());
    }
    Ok(addrs)
}

/// GET с ручной обработкой перенаправлений и ограничением размера.
async fn get_limited(
    start: Url,
    max_bytes: usize,
    accept: &str,
    referer: Option<&str>,
) -> Result<(Url, Vec<u8>), String> {
    let mut url = start;
    for _ in 0..=MAX_REDIRECTS {
        let addrs = validate_target(&url).await?;
        let host = url.host_str().unwrap_or_default().to_string();
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .user_agent(USER_AGENT)
            // Подключаемся именно к проверенным адресам.
            .resolve_to_addrs(&host, &addrs)
            .build()
            .map_err(|e| e.to_string())?;
        let mut request = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT, accept)
            .header(reqwest::header::ACCEPT_LANGUAGE, ACCEPT_LANGUAGE);
        if let Some(r) = referer {
            request = request.header(reqwest::header::REFERER, r);
        } else {
            request = request.header("Upgrade-Insecure-Requests", "1");
        }
        let resp = request.send().await.map_err(|_| "Сайт не ответил".to_string())?;

        if resp.status().is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Сайт вернул некорректное перенаправление")?;
            url = url.join(location).map_err(|_| "Некорректное перенаправление".to_string())?;
            continue;
        }
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            return Err(match code {
                401 | 403 | 429 | 503 => format!(
                    "Сайт не разрешил автоматическую загрузку (ошибка {code}). Откройте страницу в браузере, нажмите Ctrl+U, скопируйте исходный код и вставьте его ниже."
                ),
                _ => format!("Сайт ответил ошибкой {code}"),
            });
        }
        let mut body: Vec<u8> = Vec::new();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Ошибка при загрузке страницы".to_string())?;
            let room = max_bytes.saturating_sub(body.len());
            if chunk.len() >= room {
                body.extend_from_slice(&chunk[..room]);
                break;
            }
            body.extend_from_slice(&chunk);
        }
        return Ok((url, body));
    }
    Err("Слишком много перенаправлений".into())
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let needle = format!("{name}=");
    let mut from = 0;
    while let Some(pos) = lower[from..].find(&needle) {
        let start = from + pos;
        let boundary = start == 0 || !lower.as_bytes()[start - 1].is_ascii_alphanumeric();
        if boundary {
            let rest = &tag[start + needle.len()..];
            let mut chars = rest.chars();
            return match chars.next()? {
                q @ ('"' | '\'') => {
                    let inner: String = rest[1..].chars().take_while(|c| *c != q).collect();
                    Some(inner)
                }
                _ => Some(rest.chars().take_while(|c| !c.is_whitespace() && *c != '>').collect()),
            };
        }
        from = start + needle.len();
    }
    None
}

/// Адреса таблиц стилей из `<link rel="stylesheet" href=...>`.
fn stylesheet_links(html: &str, base: &Url) -> Vec<Url> {
    let lower = html.to_lowercase();
    let mut out: Vec<Url> = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find("<link") {
        let start = from + pos;
        let Some(end_rel) = lower[start..].find('>') else { break };
        let tag = &html[start..start + end_rel];
        from = start + end_rel;
        let rel = attr(tag, "rel").unwrap_or_default().to_lowercase();
        if !rel.split_whitespace().any(|r| r == "stylesheet") {
            continue;
        }
        if let Some(href) = attr(tag, "href") {
            if let Ok(u) = base.join(href.trim()) {
                if !out.contains(&u) {
                    out.push(u);
                }
            }
        }
        if out.len() >= MAX_STYLESHEETS {
            break;
        }
    }
    out
}

#[tauri::command]
pub async fn fetch_site(url: String, html: Option<String>) -> Result<SiteSnapshot, String> {
    let url = url.trim().to_string();
    if url.len() > 2000 {
        return Err("Слишком длинная ссылка".into());
    }
    let pasted = html.filter(|h| !h.trim().is_empty());

    // Страница: либо скачиваем, либо берём вставленный пользователем исходный код.
    let (final_url, page, can_fetch_css) = match pasted {
        Some(text) => {
            let page: String = text.chars().take(MAX_HTML_BYTES).collect();
            if url.is_empty() {
                (Url::parse("https://pasted.invalid/").map_err(|e| e.to_string())?, page, false)
            } else {
                let parsed = Url::parse(&url).map_err(|_| "Некорректная ссылка. Пример: https://example.com".to_string())?;
                if parsed.scheme() != "http" && parsed.scheme() != "https" {
                    return Err("Поддерживаются только ссылки http и https".into());
                }
                (parsed, page, true)
            }
        }
        None => {
            let parsed = Url::parse(&url).map_err(|_| "Некорректная ссылка. Пример: https://example.com".to_string())?;
            let (fu, bytes) = get_limited(
                parsed,
                MAX_HTML_BYTES,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                None,
            )
            .await?;
            (fu, String::from_utf8_lossy(&bytes).into_owned(), true)
        }
    };
    let lower = page.to_lowercase();
    if !lower.contains("<html") && !lower.contains("<body") && !lower.contains("<div") {
        return Err("Это не похоже на HTML веб-страницы".into());
    }

    let mut stylesheets = Vec::new();
    if can_fetch_css {
        let referer = final_url.to_string();
        for link in stylesheet_links(&page, &final_url) {
            // Недоступные или внутренние стили просто пропускаем (каждый адрес проверяется как страница).
            if let Ok((u, css_bytes)) =
                get_limited(link, MAX_CSS_BYTES, "text/css,*/*;q=0.1", Some(referer.as_str())).await
            {
                stylesheets.push(Stylesheet {
                    url: u.to_string(),
                    css: String::from_utf8_lossy(&css_bytes).into_owned(),
                });
            }
        }
    }
    Ok(SiteSnapshot {
        final_url: if url.is_empty() { String::new() } else { final_url.to_string() },
        html: page,
        stylesheets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn blocks_internal_addresses() {
        for a in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
            "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1", "198.18.0.1",
            "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
        ] {
            assert!(blocked_ip(ip(a)), "{a} must be blocked");
        }
    }

    #[test]
    fn allows_public_addresses() {
        for a in ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1", "192.169.0.1"] {
            assert!(!blocked_ip(ip(a)), "{a} must be allowed");
        }
    }

    #[tokio::test]
    async fn rejects_bad_targets() {
        for u in [
            "ftp://example.com/",
            "file:///etc/passwd",
            "http://localhost/",
            "http://foo.localhost/",
            "http://127.0.0.1/",
            "http://[::1]/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/",
            "http://user:pass@example.com/",
            "http://example.com:22/",
            "http://printer.local/",
        ] {
            let url = Url::parse(u).unwrap();
            assert!(validate_target(&url).await.is_err(), "{u} must be rejected");
        }
    }

    #[test]
    fn finds_stylesheets() {
        let base = Url::parse("https://example.com/a/b").unwrap();
        let html = r#"<head><LINK rel="stylesheet" href="/s.css"><link rel='preload' href='x.woff2'>
            <link href=rel.css rel="stylesheet preload"><link rel="icon" href="/f.ico"></head>"#;
        let links: Vec<String> = stylesheet_links(html, &base).iter().map(|u| u.to_string()).collect();
        assert_eq!(links, vec!["https://example.com/s.css", "https://example.com/a/rel.css"]);
    }

    #[tokio::test]
    async fn uses_pasted_html_without_network() {
        let snap = fetch_site(String::new(), Some("<html><body><h1>Hi</h1></body></html>".into()))
            .await
            .unwrap();
        assert!(snap.html.contains("<h1>Hi</h1>"));
        assert!(snap.stylesheets.is_empty());
        assert!(snap.final_url.is_empty());
        // Не HTML — отказ.
        assert!(fetch_site(String::new(), Some("just some words".into())).await.is_err());
        // Вставленный код с адресом во внутренней сети: стили оттуда не загружаются.
        let snap = fetch_site(
            "https://example.com/".into(),
            Some(r#"<html><head><link rel="stylesheet" href="http://169.254.169.254/x.css"></head></html>"#.into()),
        )
        .await
        .unwrap();
        assert!(snap.stylesheets.is_empty());
    }

    #[tokio::test]
    #[ignore] // нужен интернет: cargo test fetch_example -- --ignored
    async fn fetch_example() {
        let snap = fetch_site("https://example.com".into(), None).await.unwrap();
        assert!(snap.html.to_lowercase().contains("example domain"));
    }
}
