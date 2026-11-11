use std::io::{Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::WorkspaceRoot;

/// Интерактивные сессии терминала (настоящий PTY / ConPTY): id вкладки -> шелл.
#[derive(Default)]
pub struct Terminal(pub Mutex<std::collections::HashMap<String, TerminalSession>>);

/// Максимум одновременно открытых вкладок терминала.
const MAX_SESSIONS: usize = 100;

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Ожидающие запросы разрешений от агента: request_id -> ответ пользователя.
#[derive(Default)]
pub struct PermissionRequests(pub Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<bool>>>);

/// Ожидающие опросы агента (ask_user): request_id -> готовые ответы [{ question_id, answer }].
#[derive(Default)]
pub struct QuestionRequests(
    pub Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<Vec<crate::agent_service::QuestionAnswer>>>>,
);

#[derive(Serialize, Clone)]
pub(crate) struct TerminalOutput {
    /// Вкладка-источник; пустая строка — вывод агента (идёт в активную вкладку).
    pub(crate) id: String,
    pub(crate) data: String,
    pub(crate) is_err: bool,
}

pub(crate) fn terminal_output_payload(data: &str, is_err: bool) -> TerminalOutput {
    TerminalOutput {
        id: String::new(),
        data: data.to_string(),
        is_err,
    }
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    id: String,
}

/// Разрешённые оболочки (allowlist): имя -> (программа, аргументы). Произвольные пути с клиента не принимаются.
fn find_in_path(exe: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(exe)).find(|p| p.is_file())
}

fn system32(exe: &str) -> Option<std::path::PathBuf> {
    let root = std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir"))?;
    let p = std::path::PathBuf::from(root).join("System32").join(exe);
    p.is_file().then_some(p)
}

fn git_bash() -> Option<std::path::PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .iter()
        .filter_map(|v| std::env::var_os(v))
        .flat_map(|base| {
            let b = std::path::PathBuf::from(base);
            [b.join("Git").join("bin").join("bash.exe"), b.join("Programs").join("Git").join("bin").join("bash.exe")]
        })
        .find(|p| p.is_file())
}

fn resolve_shell(name: &str) -> Option<(std::path::PathBuf, Vec<&'static str>)> {
    match name {
        "cmd" => Some((system32("cmd.exe").unwrap_or_else(|| "cmd.exe".into()), vec![])),
        "powershell" => system32("WindowsPowerShell\\v1.0\\powershell.exe")
            .or_else(|| find_in_path("powershell.exe"))
            .map(|p| (p, vec!["-NoLogo"])),
        "pwsh" => find_in_path("pwsh.exe").map(|p| (p, vec!["-NoLogo"])),
        "bash" => git_bash().map(|p| (p, vec!["--login", "-i"])),
        "wsl" => system32("wsl.exe").map(|p| (p, vec![])),
        _ => None,
    }
}

/// Какие оболочки установлены (для меню «+»).
#[tauri::command]
pub fn terminal_shells() -> Vec<String> {
    ["cmd", "powershell", "pwsh", "bash", "wsl"]
        .into_iter()
        .filter(|n| resolve_shell(n).is_some())
        .map(String::from)
        .collect()
}

const MAX_COMMAND_OUTPUT: usize = 100_000;

/// Читает вывод PTY и отдаёт его интерфейсу сырыми байтами в виде текста UTF-8
/// (escape-последовательности разбирает xterm). Многобайтовый символ на границе чтения
/// переносится в следующий кусок, чтобы не превращаться в «�».
fn reader_loop(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    let mut buf = [0u8; 8192];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                carry.extend_from_slice(&buf[..n]);
                let valid = match std::str::from_utf8(&carry) {
                    Ok(_) => carry.len(),
                    Err(e) if e.error_len().is_none() => e.valid_up_to(), // неполный символ в конце
                    Err(_) => carry.len(),                                // мусор: lossy ниже
                };
                let data = String::from_utf8_lossy(&carry[..valid]).to_string();
                carry.drain(..valid);
                if !data.is_empty() {
                    let _ = app.emit("terminal-output", TerminalOutput { id: id.clone(), data, is_err: false });
                }
            }
        }
    }
    let _ = app.emit("terminal-exit", TerminalExit { id });
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(2, 500), cols: cols.clamp(2, 1000), pixel_width: 0, pixel_height: 0 }
}

/// Убивает шелл вместе с дочерними процессами (иначе `npm run dev` переживёт вкладку).
fn kill_session(mut s: TerminalSession) {
    if let Some(pid) = s.child.process_id() {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = s.child.kill();
}

/// Запускает интерактивный шелл во вкладке `id`. Если вкладка уже есть — no-op.
#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    root: State<WorkspaceRoot>,
    term: State<Terminal>,
    id: String,
    shell: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Некорректный id терминала".into());
    }
    let (program, args) = resolve_shell(&shell).ok_or_else(|| format!("Оболочка недоступна: {shell}"))?;
    let mut guard = term.0.lock().unwrap();
    if guard.contains_key(&id) {
        return Ok(());
    }
    if guard.len() >= MAX_SESSIONS {
        return Err(format!("Достигнут предел: {MAX_SESSIONS} вкладок терминала"));
    }
    let cwd = crate::fs_commands::workspace_root(&root)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));

    let pair = native_pty_system().openpty(pty_size(cols, rows)).map_err(|e| format!("Не удалось создать терминал: {e}"))?;
    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("Не удалось запустить терминал: {e}"))?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    {
        let (app, id) = (app.clone(), id.clone());
        std::thread::spawn(move || reader_loop(app, id, reader));
    }
    guard.insert(id, TerminalSession { master: pair.master, writer, child });
    Ok(())
}

/// Ввод с клавиатуры как есть (xterm сам формирует последовательности клавиш).
#[tauri::command]
pub fn terminal_write(term: State<Terminal>, id: String, data: String) -> Result<(), String> {
    if data.len() > 1_000_000 {
        return Err("Слишком большой ввод".into());
    }
    let mut guard = term.0.lock().unwrap();
    let session = guard.get_mut(&id).ok_or("Терминал не запущен")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(term: State<Terminal>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let guard = term.0.lock().unwrap();
    let session = guard.get(&id).ok_or("Терминал не запущен")?;
    session.master.resize(pty_size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_kill(term: State<Terminal>, id: String) -> Result<(), String> {
    let session = term.0.lock().unwrap().remove(&id);
    if let Some(s) = session {
        kill_session(s);
    }
    Ok(())
}

/// Ответ пользователя на запрос разрешения агента (модалка в чате).
#[tauri::command]
pub fn respond_permission(
    requests: State<PermissionRequests>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    let mut map = requests.0.lock().unwrap();
    if let Some(tx) = map.remove(&request_id) {
        let _ = tx.send(allow);
    }
    Ok(())
}

/// Ответы пользователя на уточняющие вопросы агента (ask_user).
/// Ограничения: не более 4 вопросов, каждый ответ — не длиннее 1000 символов.
#[tauri::command]
pub fn respond_question(
    requests: State<QuestionRequests>,
    request_id: String,
    answers: Vec<crate::agent_service::QuestionAnswer>,
) -> Result<(), String> {
    if answers.len() > 4 {
        return Err("слишком много ответов".into());
    }
    for a in &answers {
        if a.answer.chars().count() > 1000 {
            return Err("ответ слишком длинный".into());
        }
        if a.question_id.len() > 32 || !a.question_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err("некорректный идентификатор вопроса".into());
        }
    }
    let mut map = requests.0.lock().unwrap();
    if let Some(tx) = map.remove(&request_id) {
        let _ = tx.send(answers);
    }
    Ok(())
}

pub(crate) fn kill_on_exit(app: &AppHandle) {
    let sessions: Vec<TerminalSession> = app.state::<Terminal>().0.lock().unwrap().drain().map(|(_, s)| s).collect();
    for s in sessions {
        kill_session(s);
    }
}

/// Предел накопленного вывода одного канала: дальше читаем, но не копим (память не растёт от шумной команды).
const MAX_PIPE_BYTES: usize = 4 * 1024 * 1024;

/// Читает канал в буфер по мере поступления данных и завершается на конце потока.
fn pump_pipe<R: Read + Send + 'static>(
    mut reader: R,
    buf: std::sync::Arc<Mutex<Vec<u8>>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Ok(mut g) = buf.lock() {
                        if g.len() < MAX_PIPE_BYTES {
                            g.extend_from_slice(&chunk[..n]);
                        }
                    }
                }
            }
        }
    })
}

/// Разовый запуск команды в shell (инструмент агента run_terminal_command).
/// Выполняется в рабочей области. Вывод обрезается до MAX_COMMAND_OUTPUT.
pub(crate) fn run_shell_command(cwd: &Path, command: &str, timeout_secs: u64) -> Result<String, String> {
    run_shell_status(cwd, command, timeout_secs, &[]).map(|(_, out)| out)
}

/// Как run_shell_command, но ещё сообщает, успешно ли завершилась команда:
/// Some(true/false) по коду выхода, None — если её прервал таймаут. `env` — дополнительные переменные окружения.
pub(crate) fn run_shell_status(
    cwd: &Path,
    command: &str,
    timeout_secs: u64,
    env: &[(&str, &str)],
) -> Result<(Option<bool>, String), String> {
    // Команда передаётся cmd.exe КАК ЕСТЬ (raw_arg): обычный .arg() экранирует кавычки обратным слэшем (\"), а cmd этого
    // не понимает. Из-за этого `start /B "" npm run dev` превращалось в запуск программы «\», и Windows показывала
    // окно «Windows не удаётся найти "\\"». /S /C с внешними кавычками — штатный способ передать строку без правок.
    // CREATE_NO_WINDOW: ни мигающих консольных окон, ни окон от самой команды.
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd.exe");
        c.raw_arg("/D /S /C").raw_arg(format!("\"{command}\""));
        c.creation_flags(0x0800_0000);
        c
    };
    // macOS и Linux: обычный POSIX shell.
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    // Без цветов: вывод читает модель и чат, а не терминал.
    cmd.env("NO_COLOR", "1").env("FORCE_COLOR", "0");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить команду: {e}"))?;
    let pid = child.id();
    let stdout = child.stdout.take().ok_or("stdout недоступен")?;
    let stderr = child.stderr.take().ok_or("stderr недоступен")?;
    // Вывод копится в общих буферах, а не возвращается из потока по его завершении: фоновый процесс,
    // запущенный командой (`start /B npm run dev`), держит каналы открытыми, и чтение до конца потока
    // не заканчивалось бы никогда — агент «застревал» на этом вызове до нажатия «Стоп».
    let out_buf = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
    let err_buf = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
    let readers = [
        pump_pipe(stdout, out_buf.clone()),
        pump_pipe(stderr, err_buf.clone()),
    ];

    let deadline = Duration::from_secs(timeout_secs.max(1));
    let start = std::time::Instant::now();
    let mut timed_out = false;
    let mut success: Option<bool> = None;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                success = Some(status.success());
                break;
            }
            Ok(None) => {
                if start.elapsed() >= deadline {
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
    if timed_out {
        #[cfg(windows)]
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .spawn();
        #[cfg(not(windows))]
        let _ = (pid, child.kill());
    }
    // После выхода команды даём читателям недолго дочитать остаток, но не ждём закрытия каналов.
    let grace = std::time::Instant::now();
    while !readers.iter().all(|h| h.is_finished()) && grace.elapsed() < Duration::from_millis(1500) {
        std::thread::sleep(Duration::from_millis(20));
    }
    let take = |b: &std::sync::Arc<Mutex<Vec<u8>>>| {
        let bytes = b.lock().map(|g| g.clone()).unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    };
    let (mut out, err) = (take(&out_buf), take(&err_buf));
    if timed_out {
        out.push_str("\n[команда прервана по таймауту]\n");
    }
    let mut result = out;
    if !err.trim().is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&err);
    }
    let mut result = strip_ansi(&result);
    if result.len() > MAX_COMMAND_OUTPUT {
        let mut cut = MAX_COMMAND_OUTPUT;
        while !result.is_char_boundary(cut) {
            cut -= 1;
        }
        result.truncate(cut);
        result.push_str("\n[вывод обрезан]");
    }
    Ok((if timed_out { None } else { success }, result))
}

/// Убирает управляющие последовательности ANSI (цвета, курсор): в чате и для модели они — мусор вида «␛[32m».
pub(crate) fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match it.peek() {
            Some('[') => {
                it.next();
                // CSI: параметры, затем завершающий байт 0x40..0x7E
                for n in it.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&n) {
                        break;
                    }
                }
            }
            Some(']') => {
                it.next();
                // OSC: до BEL или ESC \
                while let Some(n) = it.next() {
                    if n == '\u{7}' {
                        break;
                    }
                    if n == '\u{1b}' {
                        it.next();
                        break;
                    }
                }
            }
            Some(_) => {
                it.next();
            }
            None => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_sequences() {
        assert_eq!(strip_ansi("\u{1b}[36mvite\u{1b}[39m built \u{1b}[32m✓\u{1b}[0m"), "vite built ✓");
        assert_eq!(strip_ansi("a\u{1b}]0;title\u{7}b"), "ab");
    }

    /// Кавычки доходят до cmd без искажений (раньше они превращались в \" и ломали команды вроде start /B "" ...).
    #[cfg(windows)]
    #[test]
    fn shell_command_keeps_quotes_intact() {
        let out = run_shell_command(Path::new("."), r#"echo "a  b" & echo done"#, 20).unwrap();
        assert!(out.contains("\"a  b\""), "вывод: {out}");
        assert!(out.contains("done"));
        // start с пустым заголовком в кавычках не должен порождать окно ошибки и возвращается сразу
        let started = run_shell_command(Path::new("."), r#"start /B "" cmd /c exit 0"#, 20).unwrap();
        assert!(!started.contains("не удаётся найти"), "вывод: {started}");
    }

    /// Фоновый процесс держит каналы вывода открытыми, но команда не должна ждать его конца
    /// (раньше run_terminal_command висел, пока жив такой процесс, и агент «застревал»).
    #[cfg(windows)]
    #[test]
    fn background_process_holding_pipes_does_not_block_command() {
        let started = std::time::Instant::now();
        let out = run_shell_command(
            Path::new("."),
            r#"echo before & start /B "" ping -n 9 127.0.0.1 & echo after"#,
            30,
        )
        .unwrap();
        assert!(out.contains("before") && out.contains("after"), "вывод: {out}");
        assert!(started.elapsed() < Duration::from_secs(6), "команда ждала фоновый процесс: {:?}", started.elapsed());
    }

    /// ConPTY действительно запускает шелл и отдаёт его вывод (нужна Windows с ConPTY).
    #[test]
    #[ignore]
    fn pty_runs_cmd_and_returns_output() {
        let pair = native_pty_system().openpty(pty_size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/c", "echo aide-pty-ok"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() { break; }
            }
        });
        let mut out = Vec::new();
        let mut answered = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(500)) { out.extend(chunk); }
            // ConPTY спрашивает позицию курсора (ESC[6n) и ждёт ответа терминала; в приложении отвечает xterm.js.
            if String::from_utf8_lossy(&out).contains("[6n") && !answered { let _ = writer.write_all(b"[1;1R"); let _ = writer.flush(); answered = true; }
            if String::from_utf8_lossy(&out).contains("aide-pty-ok") { break; }
        }
        let _ = child.kill();
        let out = String::from_utf8_lossy(&out).to_string();
        assert!(out.contains("aide-pty-ok"), "вывод: {out:?}");
    }
}
