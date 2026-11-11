//! Инструмент `browse_page` для ИИ-агента: открывает страницу (свой проект или публичный сайт) в настоящем
//! браузере (Edge/Chrome без окна), ждёт выполнения скриптов и возвращает то, что увидел
//! бы пользователь: заголовок, текст, ссылки, кнопки, поля и ошибки консоли.
//!
//! Безопасность: только http(s); localhost или публичные адреса (внутренняя сеть закрыта), браузер запускается без оболочки (аргументы массивом), с одноразовым
//! профилем и жёстким таймаутом; вывод ограничен по размеру.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use url::Url;

const TIMEOUT: Duration = Duration::from_secs(40);
const MAX_DOM_BYTES: u64 = 4_000_000;
const MAX_TEXT_CHARS: usize = 4000;
const MAX_LINKS: usize = 40;
const MAX_CONTROLS: usize = 30;

/// Пускает localhost (проект пользователя) и публичные сайты. Внутренняя сеть, адреса
/// облачных метаданных и т. п. закрыты (те же правила, что у «Сайт как пример»).
pub fn validate_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim())
        .map_err(|_| "Некорректный адрес. Пример: https://example.com или http://localhost:5173/".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Разрешены только http и https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Адрес с логином и паролем не поддерживается".into());
    }
    let host = url.host_str().unwrap_or("").trim_matches(|c| c == '[' || c == ']').to_lowercase();
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return Ok(url); // собственный проект пользователя, любой порт
    }
    let port = url.port_or_known_default().ok_or("Не удалось определить порт")?;
    if ![80u16, 443, 8080, 8443].contains(&port) {
        return Err("Для внешних сайтов доступны порты 80, 443, 8080, 8443".into());
    }
    if host.is_empty() || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") {
        return Err("Локальные и внутренние адреса недоступны".into());
    }
    let addrs: Vec<std::net::SocketAddr> = match url.host() {
        Some(url::Host::Ipv4(ip)) => vec![std::net::SocketAddr::new(ip.into(), port)],
        Some(url::Host::Ipv6(ip)) => vec![std::net::SocketAddr::new(ip.into(), port)],
        _ => std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port))
            .map_err(|_| "Не удалось найти такой сайт".to_string())?
            .collect(),
    };
    if addrs.is_empty() {
        return Err("Не удалось найти такой сайт".into());
    }
    if addrs.iter().any(|a| crate::web_fetch::blocked_ip(a.ip())) {
        return Err("Адрес ведёт во внутреннюю сеть, такие ссылки недоступны".into());
    }
    Ok(url)
}

fn find_browser() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            let base = PathBuf::from(base);
            candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
            candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

pub fn browse(raw_url: &str) -> Result<String, String> {
    let url = validate_url(raw_url)?;
    let browser = find_browser().ok_or("Не найден Edge или Chrome для проверки страницы")?;

    let profile = std::env::temp_dir().join(format!("aide-browse-{}", uuid_like()));
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;

    let result = run_browser(&browser, &profile, url.as_str());
    let _ = std::fs::remove_dir_all(&profile);
    let (dom, log) = result?;

    Ok(summarize(&url, &dom, &log))
}

fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{}", std::process::id())
}

fn run_browser(browser: &PathBuf, profile: &PathBuf, url: &str) -> Result<(String, String), String> {
    let mut child = Command::new(browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-sync",
            "--disable-background-networking",
            "--virtual-time-budget=6000",
            "--enable-logging=stderr",
            "--v=0",
            "--dump-dom",
        ])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить браузер: {e}"))?;

    let mut out = child.stdout.take().ok_or("Нет вывода браузера")?;
    let mut err = child.stderr.take().ok_or("Нет вывода браузера")?;
    let t_out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut out).take(MAX_DOM_BYTES).read_to_end(&mut buf);
        buf
    });
    let t_err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut err).take(1_000_000).read_to_end(&mut buf);
        buf
    });

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() > TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Страница не загрузилась за 40 секунд (сервер запущен?)".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    let dom = String::from_utf8_lossy(&t_out.join().unwrap_or_default()).into_owned();
    let log = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).into_owned();
    Ok((dom, log))
}

/* ── разбор DOM ─────────────────────────────────────────── */

fn strip_blocks(html: &str, tags: &[&str]) -> String {
    let mut s = html.to_string();
    for tag in tags {
        loop {
            let lower = s.to_ascii_lowercase();
            let Some(start) = lower.find(&format!("<{tag}")) else { break };
            let close = format!("</{tag}>");
            let end = lower[start..].find(&close).map(|p| start + p + close.len()).unwrap_or(s.len());
            s.replace_range(start..end, " ");
        }
    }
    s
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{name}=");
    let mut from = 0;
    while let Some(pos) = lower[from..].find(&needle) {
        let at = from + pos;
        let before_ok = at == 0 || lower.as_bytes()[at - 1].is_ascii_whitespace();
        if before_ok {
            let rest = &tag[at + needle.len()..];
            let mut chars = rest.chars();
            return match chars.next() {
                Some(q) if q == '"' || q == '\'' => Some(rest[1..].split(q).next().unwrap_or("").to_string()),
                Some(_) => Some(rest.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string()),
                None => None,
            };
        }
        from = at + needle.len();
    }
    None
}

fn decode(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn text_of(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    decode(&out).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

/// (открывающий тег, внутренний html) для каждого `<tag ...>...</tag>`.
fn elements<'a>(html: &'a str, tag: &str) -> Vec<(&'a str, &'a str)> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut res = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find(&open) {
        let start = from + pos;
        let after = lower.as_bytes().get(start + open.len()).copied().unwrap_or(b'>');
        if !(after == b'>' || after == b' ' || after == b'\n' || after == b'\t' || after == b'/') {
            from = start + open.len();
            continue;
        }
        let Some(gt) = lower[start..].find('>') else { break };
        let head_end = start + gt + 1;
        let Some(end_rel) = lower[head_end..].find(&close) else { break };
        res.push((&html[start..head_end], &html[head_end..head_end + end_rel]));
        from = head_end + end_rel + close.len();
    }
    res
}

fn summarize(base: &Url, dom: &str, log: &str) -> String {
    let title = elements(dom, "title").first().map(|(_, t)| text_of(t)).unwrap_or_default();
    let body_start = dom.to_ascii_lowercase().find("<body").unwrap_or(0);
    let body = strip_blocks(&dom[body_start..], &["script", "style", "svg", "noscript", "template"]);

    let mut report = format!("URL: {base}\nЗаголовок: {}\n", if title.is_empty() { "(нет)" } else { &title });

    // Ссылки
    let mut links: Vec<String> = Vec::new();
    for (open, inner) in elements(&body, "a") {
        let Some(href) = attr(open, "href") else { continue };
        let href = decode(href.trim());
        if href.is_empty() || href.starts_with("javascript:") {
            continue;
        }
        let Ok(abs) = base.join(&href) else { continue };
        let label = clip(&text_of(inner), 60);
        let label = if label.is_empty() { attr(open, "aria-label").unwrap_or_else(|| "(без текста)".into()) } else { label };
        let line = format!("- «{label}» → {abs}");
        if !links.contains(&line) {
            links.push(line);
        }
        if links.len() >= MAX_LINKS {
            break;
        }
    }

    // Кнопки и поля
    let mut controls: Vec<String> = Vec::new();
    for (open, inner) in elements(&body, "button") {
        let label = clip(&text_of(inner), 50);
        let label = if label.is_empty() { attr(open, "aria-label").unwrap_or_else(|| "(без текста)".into()) } else { label };
        let disabled = open.to_ascii_lowercase().contains("disabled");
        controls.push(format!("- кнопка «{label}»{}", if disabled { " (отключена)" } else { "" }));
    }
    let lower = body.to_ascii_lowercase();
    let mut from = 0;
    while let Some(pos) = lower[from..].find("<input") {
        let start = from + pos;
        let Some(gt) = lower[start..].find('>') else { break };
        let tag = &body[start..start + gt + 1];
        from = start + gt + 1;
        let ty = attr(tag, "type").unwrap_or_else(|| "text".into());
        if ty == "hidden" {
            continue;
        }
        let hint = attr(tag, "placeholder").or_else(|| attr(tag, "aria-label")).or_else(|| attr(tag, "name")).unwrap_or_default();
        controls.push(format!("- поле [{ty}] {}", clip(&hint, 50)));
    }
    controls.truncate(MAX_CONTROLS);

    let images = lower.matches("<img").count();
    let forms = lower.matches("<form").count();
    let text = clip(&text_of(&body), MAX_TEXT_CHARS);

    report.push_str(&format!("Элементов: ссылок {}, кнопок/полей {}, форм {forms}, картинок {images}\n", links.len(), controls.len()));
    report.push_str(&format!("\nВидимый текст:\n{}\n", if text.is_empty() { "(страница пустая — возможно, приложение упало при запуске)" } else { &text }));
    if !links.is_empty() {
        report.push_str(&format!("\nСсылки (откройте нужную снова через browse_page):\n{}\n", links.join("\n")));
    }
    if !controls.is_empty() {
        report.push_str(&format!("\nКнопки и поля:\n{}\n", controls.join("\n")));
    }

    let mut console: Vec<String> = Vec::new();
    for line in log.lines() {
        if line.contains("CONSOLE") {
            console.push(clip(line.trim(), 240));
            if console.len() >= 15 {
                break;
            }
        }
    }
    if console.is_empty() {
        report.push_str("\nКонсоль браузера: сообщений нет\n");
    } else {
        report.push_str(&format!("\nКонсоль браузера:\n{}\n", console.join("\n")));
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_and_public_only() {
        assert!(validate_url("http://localhost:5173/").is_ok());
        assert!(validate_url("http://127.0.0.1:3000/a").is_ok());
        assert!(validate_url("http://[::1]:3000/").is_ok());
        assert!(validate_url("https://93.184.216.34/").is_ok());
        assert!(validate_url("http://192.168.0.1/").is_err());
        assert!(validate_url("http://10.0.0.5:8080/").is_err());
        assert!(validate_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_url("https://93.184.216.34:22/").is_err());
        assert!(validate_url("http://printer.local/").is_err());
        assert!(validate_url("file:///C:/x").is_err());
        assert!(validate_url("http://user:pw@localhost/").is_err());
    }

    #[test]
    fn summarizes_page() {
        let dom = "<html><head><title>Hi</title></head><body><script>x()</script><h1>Привет</h1><a href=\"/about\">О нас</a><button>Войти</button><input type=\"email\" placeholder=\"Почта\"></body></html>";
        let base = Url::parse("http://localhost:5173/").unwrap();
        let r = summarize(&base, dom, "");
        assert!(r.contains("Привет"));
        assert!(r.contains("http://localhost:5173/about"));
        assert!(r.contains("кнопка «Войти»"));
        assert!(r.contains("[email] Почта"));
        assert!(!r.contains("x()"));
    }
}
