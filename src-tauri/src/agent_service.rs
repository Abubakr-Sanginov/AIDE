use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai_service::SendCancellable;
use crate::ai_service::{
    self, with_ua, AiCancels, AiDone, AiError, Attachment, ChatMessage,
};
use crate::terminal::{self, PermissionRequests};
use crate::WorkspaceRoot;

const MAX_READ_CHARS: usize = 100_000;
const MAX_RESULT_CHARS: usize = 20_000;
const MAX_TOOL_EVENT_CHARS: usize = 600;
const MAX_SEARCH_RESULTS: usize = 30;
const MAX_SCANNED_FILES: usize = 5000;
const SKIP_DIRS: [&str; 5] = ["node_modules", ".git", "target", "dist", ".venv"];

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    pub request_id: String,
    pub provider_id: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub mode: String,
    pub instruction: String,
    #[serde(default)]
    pub history: Vec<ChatMessage>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    pub context: Option<String>,
    pub system: Option<String>,
    pub auth: Option<String>,
    pub user_agent: Option<String>,
    /// Самопроверка после правок (типы, линтер, тесты). По умолчанию включена.
    #[serde(default)]
    pub auto_check: Option<bool>,
    /// Компактный режим для небольших моделей: короткая инструкция, только основные инструменты, короткие ответы
    /// инструментов. По умолчанию включён для локальных провайдеров (Ollama, LM Studio).
    #[serde(default)]
    pub compact: Option<bool>,
}

impl AgentRequest {
    fn is_compact(&self) -> bool {
        self.compact.unwrap_or_else(|| crate::local_models::is_local_provider(&self.provider_id))
    }
}

/// Инструменты, которые остаются в компактном режиме: файлы, поиск, терминал, ошибки анализатора, вопросы и навыки.
/// Браузер, управление приложением, дизайн и серверы MCP — большие описания, которые небольшой модели только мешают.
const COMPACT_TOOLS: [&str; 16] = [
    "read_file", "list_dir", "get_tree", "search_files", "search_code", "find_symbol", "project_map", "write_file",
    "create_file", "delete_file", "apply_edit", "run_terminal_command", "get_diagnostics", "ask_user", "list_skills", "read_skill",
];
/// Сколько символов результата инструмента попадает в контекст модели в компактном режиме.
const COMPACT_RESULT_CHARS: usize = 6_000;

fn agent_system_prompt_compact() -> String {
    "You are a coding agent inside the AIDE editor. Work step by step using the tools. All paths are relative to the project root.\n\
Rules:\n\
1. Read a file with read_file before changing it. Change small parts with apply_edit, whole files with write_file.\n\
2. Never invent file names. To find where something is, call search_code FIRST with words as they appear in the code (for example \"run terminal command\" or an exact name); find_symbol finds a definition by name. Then read_file. project_map is only an overview of folders: give it a path, never repeat it without one.\n\
3. After editing code, check it: call get_diagnostics for the changed file, or run the project's build/tests with run_terminal_command.\n\
4. If the task is unclear, ask with ask_user. If a skill matches the task, read it with read_skill first.\n\
5. Do not repeat a step that already worked. When the work is done, answer briefly in the user's language: what you changed. {NO_ECHO}".replace("{NO_ECHO}", NO_TOOL_ECHO_EN)
}

/// Слабые модели в конце ответа иногда «пересказывают» свои вызовы инструментов JSON-текстом. Это ничего не запускает, а мусор остаётся в истории и копируется дальше.
const NO_TOOL_ECHO_EN: &str = "Never write your tool calls as text (no JSON like [{\"tool\": ...}]); call tools only through the tool interface, and end with a short plain-language summary.";
const NO_TOOL_ECHO_RU: &str = "Никогда не записывай вызовы инструментов текстом (никакого JSON вида [{\"tool\": ...}]): вызывай инструменты только штатным способом, а в конце дай короткий итог обычными словами.";

/// Старые результаты инструментов нужны модели редко, а места в контексте занимают много: всё, кроме последних
/// `keep_recent`, сокращается до `limit` символов (с пометкой). Повторный вызов ничего не меняет.
fn shrink_old_results(turns: &mut [Turn], keep_recent: usize, limit: usize) {
    let total = turns.iter().filter(|t| matches!(t, Turn::ToolResult { .. })).count();
    let mut skip = total.saturating_sub(keep_recent);
    for t in turns.iter_mut() {
        if skip == 0 {
            break;
        }
        if let Turn::ToolResult { result, .. } = t {
            skip -= 1;
            if result.chars().count() > limit {
                let head: String = result.chars().take(limit).collect();
                *result = format!("{head}\n…[старый результат сокращён для экономии контекста; при необходимости повтори вызов]");
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QuestionOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QuestionSpec {
    pub question: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub header: String,
    #[serde(default)]
    pub options: Vec<QuestionOption>,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub allow_custom: bool,
}

#[derive(Serialize, Clone)]
struct AiQuestionEvent {
    request_id: String,
    questions: Vec<QuestionSpec>,
}

#[derive(Serialize, Clone)]
pub struct AiScreenshot {
    pub name: String,
    pub mime: String,
    pub data: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnswer {
    pub question_id: String,
    pub answer: String,
}

/// Ответ пользователя на опрос: { question_id, answer } — текст готового ответа для модели.
fn parse_question_args(args: &Value) -> Result<Vec<QuestionSpec>, String> {
    let Some(arr) = args.get("questions").and_then(Value::as_array) else {
        return Err("не хватает аргумента «questions» (массив вопросов)".into());
    };
    if arr.is_empty() || arr.len() > 4 {
        return Err("нужен от 1 до 4 вопросов".into());
    }
    let mut out = Vec::new();
    for q in arr {
        let text = q.get("question").and_then(Value::as_str).unwrap_or("").trim();
        if text.is_empty() {
            return Err("у вопроса пустой текст".into());
        }
        if text.len() > 500 {
            return Err("текст вопроса слишком длинный".into());
        }
        let header = q.get("header").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let mut options = Vec::new();
        if let Some(opts) = q.get("options").and_then(Value::as_array) {
            for o in opts {
                if let Some(label) = o.get("label").and_then(Value::as_str) {
                    let label = label.trim();
                    if label.is_empty() {
                        continue;
                    }
                    options.push(QuestionOption {
                        label: label.chars().take(120).collect(),
                        description: o
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim()
                            .chars()
                            .take(200)
                            .collect(),
                    });
                }
            }
        }
        if options.len() > 6 {
            options.truncate(6);
        }
        out.push(QuestionSpec {
            question: text.to_string(),
            header: header.chars().take(40).collect(),
            options,
            multiple: q.get("multiple").and_then(Value::as_bool).unwrap_or(false),
            allow_custom: q.get("allow_custom").and_then(Value::as_bool).unwrap_or(true),
        });
    }
    Ok(out)
}

fn format_question_answers(questions: &[QuestionSpec], answers: &[QuestionAnswer]) -> String {
    let mut lines = vec!["Ответы пользователя на уточняющие вопросы:".to_string()];
    for (i, q) in questions.iter().enumerate() {
        let id = format!("q{}", i + 1);
        let ans = answers
            .iter()
            .find(|a| a.question_id == id)
            .map(|a| a.answer.trim())
            .unwrap_or("")
            .to_string();
        lines.push(format!("{}. {}", i + 1, q.question));
        lines.push(format!("   Ответ: {}", if ans.is_empty() { "(не выбрано)".to_string() } else { ans }));
    }
    let out = lines.join("\n");
    ai_service::truncate(&out, 8000)
}

/// Ожидание ответа на опрос (без разрешения; при Стопе — отмена).
async fn request_answers(
    app: &AppHandle,
    request: &AgentRequest,
    questions: &[QuestionSpec],
    cancel: &AtomicBool,
) -> Result<String, String> {
    let (tx, mut rx) = tokio::sync::oneshot::channel::<Vec<QuestionAnswer>>();
    // Ответ читает отдельная команда respond_question: канал в таблице вопросов AIDE.
    app.state::<crate::terminal::QuestionRequests>()
        .0
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), tx);
    let _ = app.emit(
        "ai-question",
        AiQuestionEvent {
            request_id: request.request_id.clone(),
            questions: questions.to_vec(),
        },
    );
    loop {
        if cancel.load(Ordering::Relaxed) {
            app.state::<crate::terminal::QuestionRequests>()
                .0
                .lock()
                .unwrap()
                .remove(&request.request_id);
            return Err("canceled".into());
        }
        match tokio::time::timeout(Duration::from_millis(500), &mut rx).await {
            Ok(Ok(answers)) => return Ok(format_question_answers(questions, &answers)),
            Ok(Err(_)) => return Err("нет ответа на опрос".into()),
            Err(_) => continue,
        }
    }
}

#[derive(Serialize, Clone)]
struct AiToolEvent {
    request_id: String,
    tool: String,
    args: String,
    status: String,
    result: String,
    iteration: u32,
}

#[derive(Clone)]
struct ToolCall {
    id: String,
    name: String,
    arguments: Value,
    raw_part: Value,
}

#[derive(Default)]
struct ProviderResponse {
    text: String,
    reasoning: String,
    tool_calls: Vec<ToolCall>,
    usage: ai_service::Usage,
}

enum Turn {
    User {
        text: String,
        attachments: Vec<Attachment>,
    },
    Assistant {
        text: String,
        reasoning: String,
        tools: Vec<ToolCall>,
    },
    ToolResult {
        id: String,
        name: String,
        result: String,
        images: Vec<AiScreenshot>,
    },
}

#[tauri::command]
pub fn agent_chat(
    app: AppHandle,
    cancels: State<AiCancels>,
    request: AgentRequest,
) -> Result<(), String> {
    if !["plan", "agent"].contains(&request.mode.as_str()) {
        return Err("Неизвестный режим: ожидался plan или agent".into());
    }
    let key = ai_service::api_key(&request.provider_id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    cancels
        .0
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), cancel.clone());
    let cancels_map = cancels.0.clone();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_agent(&app, &key, &request, &cancel).await;
        cancels_map.lock().unwrap().remove(&request.request_id);
        match result {
            Ok((iterations, usage)) => {
                let _ = app.emit(
                    "ai-done",
                    AiDone {
                        request_id: request.request_id,
                        iterations: Some(iterations),
                        usage: if usage.is_empty() { None } else { Some(usage) },
                    },
                );
            }
            Err(message) => {
                let _ = app.emit(
                    "ai-error",
                    AiError {
                        request_id: request.request_id,
                        message,
                    },
                );
            }
        }
    });
    Ok(())
}

fn agent_system_prompt(mode: &str, context: &Option<String>) -> String {
    let mut prompt = match mode {
        "plan" => {
            "Ты — ИИ-ассистент в IDE AIDE, работаешь в режиме «План». \
Ты анализируешь проект и предлагаешь подробный план изменений. \
Тебе доступны инструменты только для чтения (read_file, list_dir, get_tree, search_files, search_code, find_symbol, project_map). \
НЕ изменяй, не создавай и не удаляй файлы. \
Отвечай на языке пользователя."
        }
        _ => {
            "Ты — ИИ-агент в IDE AIDE, работаешь в режиме «Агент». \
Ты самостоятельно выполняешь задачу: читаешь файлы проекта, вносишь правки, \
создаёшь и удаляешь файлы через доступные инструменты. \
Перед изменением файла сначала прочитай его. Не знаешь, где что лежит, — не листай папки вслепую: \
search_code ищет по смыслу имён и слов (начинай с неё), find_symbol находит определение по имени, project_map — лишь обзор папок. Работай по шагам, проверяй результат. \
Все пути — относительно корня рабочей области. \
Доводи задачу до конца за один заход, не останавливайся посреди работы и не начинай заново то, что уже сделано: \
опирайся на результаты прошлых шагов. После правок запускай проверки заново, пока они не пройдут, \
а когда всё готово — дай итоговый ответ. \
Если задача неоднозначная («я хочу сайт», «сделай приложение», «нужен бот» и т.п.), НЕ делай за пользователя и НЕ придумывай сам: сначала вызови ask_user и уточни главное (о чём это, для кого, какие страницы/функции, стиль и язык, есть ли готовые материалы), потом работай по ответам. \
Проверку страниц и интерфейса (открыть, кликнуть, заполнить поле, прочитать DOM и консоль) делай во встроенном браузере IDE: \
browser_open, browser_eval, browser_console, а как страница выглядит на самом деле — через browser_screenshot. Его видит пользователь, ему не нужны установка и отдельное окно. \
Сайт должен работать и на телефоне, и на компьютере: после правок вёрстки вызывай browser_responsive_check, а чтобы посмотреть конкретный размер — browser_viewport (mobile, tablet, desktop, fit или свои width и height). \
Браузерные инструменты серверов MCP (Playwright и подобные) бери, только если пользователь прямо просит или встроенный браузер \
не справляется; в этом случае одной фразой скажи почему. \
Для чтения чужих публичных страниц используй browse_page. \
Интерфейсом самого AIDE управляй сам, а не проси пользователя: app_state показывает, что открыто, \
app_navigate переключает режимы, панели и открывает файлы, design_control меняет раздел «Дизайн» \
(экраны, HTML, стили, текст, выделение, undo) и умеет отдать задачу встроенному ИИ-дизайнеру. \
Перед правкой дизайна вызови design_control с action=state или get_html. \
Отвечай на языке пользователя, кратко описывай выполненные действия. "
        }
    }
    .to_string()
        + NO_TOOL_ECHO_RU;
    if let Some(ctx) = context {
        if !ctx.trim().is_empty() {
            prompt.push_str("\n\nКонтекст — активный файл пользователя:\n");
            prompt.push_str(ctx);
        }
    }
    prompt
}

fn tool_parameters(
    name: &str,
    mode: &str,
) -> Option<(&'static str, &'static str, Value, Vec<&'static str>)> {
    let str_prop = |desc: &str| json!({ "type": "string", "description": desc });
    match name {
        "list_skills" => Some(("list_skills", "Список включённых навыков (встроенные, глобальные и проекта): id, имя, описание, справочные файлы.", json!({}), vec![])),
        "read_skill" => Some(("read_skill", "Прочитать полный текст навыка (SKILL.md) по id из списка навыков, либо его справочный файл (параметр file). Следуй подходящим рекомендациям в рамках задачи и разрешений.", json!({ "id": str_prop("Идентификатор навыка, например builtin:debugging"), "file": str_prop("Необязательно: относительный путь справочного файла навыка из его списка файлов") }), vec!["id"])),
        "read_file" => Some((
            "read_file".into(),
            "Прочитать содержимое файла (текст).",
            json!({ "path": str_prop("Путь к файлу относительно корня рабочей области") }),
            vec!["path"],
        )),
        "list_dir" => Some((
            "list_dir".into(),
            "Список файлов и папок в директории.",
            json!({ "path": str_prop("Путь к директории (по умолчанию корень)") }),
            vec![],
        )),
        "get_tree" => Some((
            "get_tree".into(),
            "Дерево проекта от указанной директории с ограничением глубины.",
            json!({
                "path": str_prop("Путь к директории (по умолчанию корень)"),
                "depth": json!({ "type": "integer", "description": "Максимальная глубина (по умолчанию 3)" }),
            }),
            vec![],
        )),
        "search_code" => Some((
            "search_code".into(),
            "Умный поиск по коду проекта: находит файлы и места по смыслу имён и слов. Запрос — слова на английском, как в коде \
(«user login handler», «parse config file»); учитываются camelCase и snake_case, имена функций и пути файлов. \
Результат — файл:строки, определения и фрагмент. Вызывай ПЕРВЫМ, когда не знаешь, где что лежит; для точной строки текста есть search_files.",
            json!({
                "query": str_prop("Слова из задачи или имена из кода, например: refresh token expiry"),
                "limit": json!({ "type": "integer", "description": "Сколько файлов вернуть (по умолчанию 6, не больше 15)" }),
            }),
            vec!["query"],
        )),
        "find_symbol" => Some((
            "find_symbol".into(),
            "Где определена функция, класс, тип, метод или константа. Имя целиком или часть («handleSubmit», «Provider»). \
Возвращает файл:строка, вид и сигнатуру.",
            json!({ "name": str_prop("Имя или часть имени") }),
            vec!["name"],
        )),
        "project_map" => Some((
            "project_map".into(),
            "Структура проекта: папки и файлы, а в маленьком проекте или подпапке ещё и что определено в каждом файле. \
Это ОБЗОР, а не поиск: чтобы найти, где что-то находится, вызывай search_code или find_symbol. В большом проекте вернёт список папок — \
дальше уточняй path (подпапка), не повторяй вызов без параметров.",
            json!({ "path": str_prop("Подпапка или файл (относительно корня). Необязательно") }),
            vec![],
        )),
        "get_diagnostics" => Some((
            "get_diagnostics".into(),
            "Ошибки и предупреждения компилятора/анализатора от языкового сервера (TypeScript, Rust, Python, Go, C/C++, CSS, HTML, JSON): \
файл:строка:колонка, уровень, сообщение. Вызывай после правок кода, чтобы найти ошибки типов и импорта до сдачи работы. \
Без path — всё, что серверы уже сообщили по открытым файлам.",
            json!({ "path": str_prop("Файл для проверки (относительно корня). Необязательно") }),
            vec![],
        )),
        "search_files" => Some((
            "search_files".into(),
            "Поиск текста в файлах проекта (без учёта регистра).",
            json!({
                "query": str_prop("Искомый текст"),
                "path": str_prop("Директория поиска (по умолчанию корень)"),
            }),
            vec!["query"],
        )),
        "browse_page" => Some((
            "browse_page".into(),
            "Открыть страницу (проект на localhost или любой публичный сайт) в настоящем браузере и получить то, что видит \
пользователь: текст, ссылки, кнопки, поля, ошибки консоли. Чтобы «перейти по ссылке», вызовите снова с её адресом.",
            json!({ "url": str_prop("Адрес вида http://localhost:5173/путь или https://example.com") }),
            vec!["url"],
        )),
        "browser_open" if mode == "agent" => Some((
            "browser_open".into(),
            "ПРЕДПОЧТИТЕЛЬНЫЙ способ открыть и проверить страницу или проект на localhost: встроенный браузер IDE, его видит пользователь, \
установка не нужна. Возвращает заголовок и текст страницы. Дальше работай через browser_eval и browser_console, а не через браузерные инструменты MCP. \
Открывает НОВУЮ вкладку (new_tab=true по умолчанию); все следующие browser_eval/console/screenshot работают именно на этой вкладке.",
            json!({ "url": str_prop("http://localhost:5173/путь или https://example.com") }),
            vec!["url"],
        )),
        "browser_console" if mode == "agent" => Some((
            "browser_console".into(),
            "Прочитать консоль страницы во встроенном браузере: сообщения, ошибки, непойманные исключения.",
            json!({}),
            vec![],
        )),
        "browser_eval" if mode == "agent" => Some((
            "browser_eval".into(),
            "Управление страницей во встроенном браузере (вместо Playwright): выполнить JavaScript, кликнуть кнопку, заполнить поле, \
прочитать DOM, проверить видимость и текст элементов, и вернуть результат. Пример: document.querySelector('button.save').click()",
            json!({ "code": str_prop("Выражение JavaScript") }),
            vec!["code"],
        )),
        "browser_screenshot" if mode == "agent" => Some((
            "browser_screenshot".into(),
            "Снимок экрана открытой в браузере страницы (PNG). Модель, умеющая видеть изображения, видит, как страница выглядит на самом деле; если модель изображений не умеет — возвращается текстовое описание DOM (элементы, их видимость, размеры). Снимок хранится в памяти, на диск не пишется.",
            json!({}),
            vec![],
        )),
        "browser_viewport" if mode == "agent" => Some((
            "browser_viewport".into(),
            "Изменить размер окна страницы во встроенном браузере, чтобы увидеть сайт на экране другого размера: device=mobile (390x844), tablet (820x1180), desktop (1440x900) или fit (вся панель), либо свои width и height в пикселях. Размер больше панели показывается уменьшенным, но страница считает его настоящим (media-запросы работают как на устройстве). После смены размера прочитай страницу через browser_eval или browser_screenshot.",
            json!({
                "device": str_prop("mobile | tablet | desktop | fit"),
                "width": json!({ "type": "integer", "description": "Ширина в пикселях, 200–3840 (вместе с height, без device)" }),
                "height": json!({ "type": "integer", "description": "Высота в пикселях, 200–2400" }),
            }),
            vec![],
        )),
        "browser_responsive_check" if mode == "agent" => Some((
            "browser_responsive_check".into(),
            "Проверить адаптивность открытой страницы одним вызовом: окно по очереди становится телефоном, планшетом и компьютером, в каждом ищутся горизонтальная прокрутка, элементы за краем экрана, нет ли meta viewport, слишком мелкие кнопки и текст. Возвращает отчёт по каждому размеру и возвращает окну прежний размер. Вызывай после правок вёрстки.",
            json!({}),
            vec![],
        )),
        "browser_tabs" if mode == "agent" => Some((
            "browser_tabs".into(),
            "Список вкладок встроенного браузера: [{id, title, url, active}]. Та же информация, что пользователь видит на панели вкладок.",
            json!({}),
            vec![],
        )),
        "ask_user" => Some((
            "ask_user".into(),
            "Задать пользователю уточняющие вопросы и дождаться ответов. Вызывай ПЕРЕД работой, когда задачу можно понять по-разному: «Я хочу сайт» — спроси, о чём сайт, для кого, какие страницы, стиль, язык, есть ли готовые материалы. Не делай за пользователя и не пиши наугад: сначала опрос, потом работа. От 1 до 4 вопросов; у каждого — строка questions[].question и список options[].label с кратким description (можно несколько, тогда multiple=true), allow_custom=true добавляет поле «свой ответ». Ответы вернутся как результат инструмента.",
            json!({
                "questions": json!({
                    "type": "array",
                    "items": json!({
                        "type": "object",
                        "properties": {
                            "question": json!({ "type": "string", "description": "Текст вопроса пользователю" }),
                            "header": json!({ "type": "string", "description": "Короткая подпись вопроса (до 12 символов)" }),
                            "options": json!({
                                "type": "array",
                                "items": json!({
                                    "type": "object",
                                    "properties": {
                                        "label": json!({ "type": "string" }),
                                        "description": json!({ "type": "string", "description": "Краткое пояснение варианта" }),
                                    },
                                    "required": ["label"],
                                }),
                            }),
                            "multiple": json!({ "type": "boolean", "description": "Можно выбрать несколько вариантов (по умолчанию один)" }),
                            "allow_custom": json!({ "type": "boolean", "description": "Разрешить свой ответ текстом (по умолчанию true)" }),
                        },
                        "required": ["question"],
                    }),
                    "minItems": 1,
                    "maxItems": 4,
                }),
            }),
            vec!["questions"],
        )),
        "write_file" if mode == "agent" => Some((
            "write_file".into(),
            "Записать содержимое в файл (создаёт или перезаписывает).",
            json!({
                "path": str_prop("Путь к файлу"),
                "content": str_prop("Полное новое содержимое файла"),
            }),
            vec!["path", "content"],
        )),
        "create_file" if mode == "agent" => Some((
            "create_file".into(),
            "Создать новый файл. Ошибка, если файл уже существует.",
            json!({
                "path": str_prop("Путь к новому файлу"),
                "content": str_prop("Содержимое файла"),
            }),
            vec!["path", "content"],
        )),
        "delete_file" if mode == "agent" => Some((
            "delete_file".into(),
            "Удалить файл или папку.",
            json!({ "path": str_prop("Путь к объекту") }),
            vec!["path"],
        )),
        "apply_edit" if mode == "agent" => Some((
            "apply_edit".into(),
            "Найти фрагмент old_text в файле (должен встречаться ровно один раз) и заменить его на new_text.",
            json!({
                "path": str_prop("Путь к файлу"),
                "old_text": str_prop("Точный текст, который нужно заменить"),
                "new_text": str_prop("Новый текст вместо old_text"),
            }),
            vec!["path", "old_text", "new_text"],
        )),
        "run_terminal_command" if mode == "agent" => Some((
            "run_terminal_command".into(),
            "Выполнить команду в терминале (cmd) в корне проекта и вернуть её вывод. \
Для длительных команд указывайте timeout_seconds.",
            json!({
                "command": str_prop("Команда для выполнения"),
                "timeout_seconds": json!({
                    "type": "integer",
                    "description": "Таймаут в секундах (по умолчанию 60)",
                }),
            }),
            vec!["command"],
        )),
        "app_state" if mode == "agent" => Some((
            "app_state".into(),
            "Посмотреть, что сейчас открыто в AIDE: режим (ide/design/vibe), вкладки панелей, открытые файлы, экраны и выделение в Дизайне, \
состояние команды Kins. Вызывай перед управлением интерфейсом, чтобы знать текущее состояние.",
            json!({}),
            vec![],
        )),
        "app_navigate" if mode == "agent" => Some((
            "app_navigate".into(),
            "Управлять интерфейсом AIDE: переключить режим (ide/design/vibe), открыть вкладку правой панели (chat/kins/browser), \
боковую панель, терминал, настройки, открыть файл проекта в редакторе. Все поля необязательные, можно задать несколько сразу.",
            json!({
                "mode": str_prop("ide, design или vibe"),
                "right_tab": str_prop("chat, kins или browser"),
                "panel": str_prop("explorer, search, git, snippets или settings"),
                "terminal": json!({ "type": "boolean", "description": "Показать (true) или скрыть (false) терминал" }),
                "open_file": str_prop("Путь к файлу относительно корня проекта: открыть в редакторе"),
            }),
            vec![],
        )),
        "design_control" if mode == "agent" => Some((
            "design_control".into(),
            "Управлять разделом «Дизайн» вместо пользователя. Поле action: state (экраны, выделение, режим), get_html (HTML активного экрана \
с id элементов n1, n2…), set_html (заменить HTML активного экрана; он проходит санитайзер), add_frame, activate_frame, delete_frame, \
rename_frame, set_device (desktop/tablet/mobile), select, update_styles, update_text, delete_selected, undo, redo, set_view (canvas/code), \
ask_designer (отправить задачу встроенному ИИ-дизайнеру), save_to_project (записывает файлы в папку design проекта, требует подтверждения). \
Правки макета обратимы через undo. Сначала вызови action=state или get_html.",
            json!({
                "action": str_prop("Одно из действий, перечисленных выше"),
                "frame_id": str_prop("id экрана (из state) для activate_frame, delete_frame, rename_frame, set_device"),
                "name": str_prop("Имя экрана для add_frame и rename_frame"),
                "device": str_prop("desktop, tablet или mobile"),
                "html": str_prop("HTML для set_html или add_frame (без script и обработчиков, их удалит санитайзер)"),
                "element_id": str_prop("id элемента вида n12 для select, update_styles, update_text"),
                "styles": str_prop("CSS-свойства через точку с запятой, например: color:#111;padding:16px"),
                "text": str_prop("Новый текст элемента для update_text"),
                "view": str_prop("canvas или code для set_view"),
                "instruction": str_prop("Задача для ask_designer"),
            }),
            vec!["action"],
        )),
        _ => None,
    }
}

fn tool_defs(mode: &str) -> Vec<Value> {
    let names = if mode == "agent" {
        vec![
            "read_file", "list_dir", "get_tree", "search_files", "browse_page", "write_file",
            "create_file", "delete_file", "apply_edit", "run_terminal_command",
            "browser_open", "browser_console", "browser_eval", "browser_screenshot", "browser_tabs", "browser_viewport",
            "browser_responsive_check", "ask_user", "app_state", "app_navigate", "design_control", "list_skills", "read_skill", "get_diagnostics",
            "search_code", "find_symbol", "project_map",
        ]
    } else {
        vec![
            "read_file", "list_dir", "get_tree", "search_files", "browse_page", "ask_user", "list_skills", "read_skill",
            "get_diagnostics", "search_code", "find_symbol", "project_map",
        ]
    };
    names
        .iter()
        .filter_map(|n| {
            tool_parameters(n, mode).map(|(_, desc, parameters, required)| {
                json!({
                    "name": n,
                    "description": desc,
                    "parameters": parameters,
                    "required": required,
                })
            })
        })
        .collect()
}

fn to_openai_tools(tools: &[Value]) -> Value {
    json!(tools.iter().map(|t| {
        let required = t["required"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
            .unwrap_or_default();
        json!({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": {
                    "type": "object",
                    "properties": t["parameters"],
                    "required": required,
                },
            },
        })
    }).collect::<Vec<_>>())
}

fn to_anthropic_tools(tools: &[Value]) -> Value {
    json!(tools.iter().map(|t| {
        json!({
            "name": t["name"],
            "description": t["description"],
            "input_schema": {
                "type": "object",
                "properties": t["parameters"],
                "required": t["required"],
            },
        })
    }).collect::<Vec<_>>())
}

fn to_google_tools(tools: &[Value]) -> Value {
    json!(tools.iter().map(|t| {
        let required = t["required"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
            .unwrap_or_default();
        json!({
            "name": t["name"],
            "description": t["description"],
            "parameters": {
                "type": "object",
                "properties": t["parameters"],
                "required": required,
            },
        })
    }).collect::<Vec<_>>())
}

fn user_content_blocks(text: &str, attachments: &[Attachment]) -> Value {
    if attachments.is_empty() {
        serde_json::json!(text)
    } else {
        let mut blocks = Vec::new();
        if !text.trim().is_empty() {
            blocks.push(json!({ "type": "text", "text": text }));
        }
        for att in attachments {
            blocks.push(ai_service::attachment_openai_block(att));
        }
        serde_json::json!(blocks)
    }
}

fn openai_messages(system: &str, turns: &[Turn]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": system })];
    for t in turns {
        match t {
            Turn::User { text, attachments } => {
                out.push(json!({ "role": "user", "content": user_content_blocks(text, attachments) }))
            }
            Turn::Assistant {
                text,
                reasoning,
                tools,
            } => {
                let mut msg = json!({ "role": "assistant" });
                msg["content"] = if text.is_empty() {
                    Value::Null
                } else {
                    json!(text)
                };
                if !reasoning.is_empty() {
                    msg["reasoning_content"] = json!(reasoning);
                } else {
                    msg["reasoning_content"] = json!("");
                }
                if !tools.is_empty() {
                    msg["tool_calls"] = json!(tools.iter().map(|tc| {
                        json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments.to_string(),
                            },
                        })
                    }).collect::<Vec<_>>());
                }
                out.push(msg);
            }
            Turn::ToolResult { id, result, images, .. } => {
                if images.is_empty() {
                    out.push(json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": result,
                    }));
                } else {
                    let mut parts = vec![json!({ "type": "text", "text": result })];
                    for img in images {
                        parts.push(ai_service::attachment_openai_block(&Attachment {
                            name: img.name.clone(),
                            mime: img.mime.clone(),
                            data: img.data.clone(),
                            size: None,
                        }));
                    }
                    out.push(json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": parts,
                    }));
                }
            }
        }
    }
    out
}

fn anthropic_user_blocks(text: &str, attachments: &[Attachment]) -> Vec<Value> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for att in attachments {
        blocks.push(ai_service::attachment_anthropic_block(att));
    }
    blocks
}

fn anthropic_messages(turns: &[Turn]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for t in turns {
        match t {
            Turn::User { text, attachments } => {
                let blocks = anthropic_user_blocks(text, attachments);
                if let Some(last) = out.last_mut() {
                    if last["role"] == "user" {
                        if last["content"].is_string() {
                            let mut arr = vec![json!({
                                "type": "text",
                                "text": last["content"].as_str().unwrap_or(""),
                            })];
                            arr.extend(blocks);
                            last["content"] = json!(arr);
                        } else {
                            last["content"].as_array_mut().unwrap().extend(blocks);
                        }
                        continue;
                    }
                }
                if blocks.len() == 1 && attachments.is_empty() {
                    out.push(json!({ "role": "user", "content": text }));
                } else {
                    out.push(json!({ "role": "user", "content": blocks }));
                }
            }
            Turn::Assistant { text, tools, .. } => {
                let mut blocks = Vec::new();
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                for tc in tools {
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    }));
                }
                out.push(json!({ "role": "assistant", "content": blocks }));
            }
            Turn::ToolResult { id, result, images, .. } => {
                let mut content_parts = vec![json!({ "type": "text", "text": result })];
                for img in images {
                    content_parts.push(ai_service::attachment_anthropic_block(&Attachment {
                        name: img.name.clone(),
                        mime: img.mime.clone(),
                        data: img.data.clone(),
                        size: None,
                    }));
                }
                let block = json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "content": content_parts,
                });
                if let Some(last) = out.last_mut() {
                    if last["role"] == "user" && last["content"].is_array() {
                        last["content"].as_array_mut().unwrap().push(block);
                        continue;
                    }
                }
                out.push(json!({ "role": "user", "content": [block] }));
            }
        }
    }
    out
}

fn google_contents(turns: &[Turn]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for t in turns {
        let (role, parts): (&str, Vec<Value>) = match t {
            Turn::User { text, attachments } => {
                let mut parts = vec![json!({ "text": text })];
                for att in attachments {
                    parts.push(ai_service::attachment_google_part(att));
                }
                ("user", parts)
            }
            Turn::Assistant { text, tools, .. } => {
                let mut parts: Vec<Value> = Vec::new();
                if !text.is_empty() {
                    parts.push(json!({ "text": text }));
                }
                for tc in tools {
                    parts.push(tc.raw_part.clone());
                }
                ("model", parts)
            }
            Turn::ToolResult { name, result, images, .. } => {
                let mut parts = vec![json!({
                    "functionResponse": { "name": name, "response": { "result": result } },
                })];
                for img in images {
                    parts.push(ai_service::attachment_google_part(&Attachment {
                        name: img.name.clone(),
                        mime: img.mime.clone(),
                        data: img.data.clone(),
                        size: None,
                    }));
                }
                ("user", parts)
            }
        };
        if let Some(last) = out.last_mut() {
            if last["role"] == role {
                last["parts"].as_array_mut().unwrap().extend(parts);
                continue;
            }
        }
        out.push(json!({ "role": role, "parts": parts }));
    }
    out
}

async fn call_provider(
    app: &AppHandle,
    key: &str,
    request: &AgentRequest,
    system: &str,
    turns: &[Turn],
    cancel: &AtomicBool,
) -> Result<ProviderResponse, String> {
    let mut tools = tool_defs(&request.mode);
    if request.is_compact() {
        tools.retain(|t| t["name"].as_str().is_some_and(|n| COMPACT_TOOLS.contains(&n)));
    } else if request.mode == "agent" {
        tools.extend(crate::mcp::tool_defs(app));
        tools.extend(crate::mcp::manage_tool_defs());
    }
    match request.kind.as_str() {
        "anthropic" => call_anthropic(app, key, request, system, turns, &tools, cancel).await,
        "google" => call_google(app, key, request, system, turns, &tools, cancel).await,
        _ => call_openai(app, key, request, system, turns, &tools, cancel).await,
    }
}

async fn call_openai(
    app: &AppHandle,
    key: &str,
    request: &AgentRequest,
    system: &str,
    turns: &[Turn],
    tools: &[Value],
    cancel: &AtomicBool,
) -> Result<ProviderResponse, String> {
    let client = ai_service::new_client()?;
    let body = json!({
        "model": request.model,
        "messages": openai_messages(system, turns),
        "stream": true,
        "tools": to_openai_tools(tools),
    });
    let mut body = body;
    if ai_service::supports_stream_usage_for(&request.provider_id, &request.base_url) {
        body["stream_options"] = json!({ "include_usage": true });
    }
    let mut usage = ai_service::Usage::default();
    let resp = with_ua(
        crate::local_models::bearer(client.post(format!("{}/chat/completions", request.base_url)), key),
        request.user_agent.as_deref(),
    )
    .json(&body)
    .send_c(cancel)
        .await
        .map_err(|e| crate::local_models::explain(&request.provider_id, &request.base_url, e))?;
    let resp = ai_service::ensure_ok(resp, "Провайдер").await?;

    let mut text = String::new();
    let mut reasoning = String::new();
    let mut tool_calls: HashMap<usize, (String, String, String)> = HashMap::new();
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    // Ответ завершён по сигналу [DONE], а не по закрытию соединения: прокси и часть провайдеров держат
    // соединение открытым, и без выхода из внешнего цикла агент ждал до таймаута молчания.
    let mut finished = false;
    while !finished {
        let chunk = match crate::ai_service::next_or_cancel(&mut stream, cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => return Err("incomplete provider stream".into()),
            Err(e) => return Err(e),
        };
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        buf.extend_from_slice(&chunk);
        for line in ai_service::split_sse_lines(&mut buf) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                finished = true;
                break;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(message) = value["error"]["message"].as_str() {
                return Err(message.to_string());
            }
            if let Some(u) = ai_service::usage_openai(&value) {
                usage = u;
            }
            if let Some(delta) = value["choices"][0]["delta"].as_object() {
                if let Some(t) = delta.get("content").and_then(Value::as_str) {
                    text.push_str(t);
                    ai_service::emit_chunk(app, &request.request_id, t);
                }
                // «reasoning_content» у большинства серверов и LM Studio, «reasoning» у Ollama.
                if let Some(t) = delta.get("reasoning_content").or_else(|| delta.get("reasoning")).and_then(Value::as_str) {
                    reasoning.push_str(t);
                    ai_service::emit_thinking(app, &request.request_id, t);
                }
                if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
                    for call in calls {
                        let idx = tool_call_slot(&tool_calls, call);
                        let entry = tool_calls.entry(idx).or_insert_with(|| {
                            (String::new(), String::new(), String::new())
                        });
                        if let Some(id) = call["id"].as_str() {
                            entry.0 = id.to_string();
                        }
                        if let Some(name) = call["function"]["name"].as_str() {
                            entry.1 = name.to_string();
                        }
                        if let Some(args) = call["function"]["arguments"].as_str() {
                            entry.2.push_str(args);
                        }
                    }
                }
            }
        }
    }
    for (_, _, args) in tool_calls.values() { validate_tool_input(args)?; }
    let mut calls: Vec<(usize, ToolCall)> = tool_calls
        .into_iter()
        .map(|(idx, (id, name, args))| {
            let arguments = serde_json::from_str(&args).unwrap_or(json!({}));
            (
                idx,
                ToolCall {
                    id,
                    name: name.clone(),
                    arguments: arguments.clone(),
                    raw_part: json!({ "functionCall": { "name": &name, "args": &arguments } }),
                },
            )
        })
        .collect();
    calls.sort_by_key(|(idx, _)| *idx);
    if calls.iter().any(|(_, c)| c.id.is_empty() || c.name.is_empty()) {
        return Err("incomplete tool call".into());
    }
    Ok(ProviderResponse {
        text,
        reasoning,
        tool_calls: calls.into_iter().map(|(_, c)| c).collect(),
        usage,
    })
}

#[cfg(test)]
mod retry_input_tests {
    #[test]
    fn incomplete_tool_arguments_never_become_empty_object() {
        assert!(super::validate_tool_input("{\"path\":").is_err());
        assert!(super::validate_tool_input("[]").is_err());
        assert!(super::validate_tool_input("{}").is_ok());
        assert!(super::validate_tool_input("").is_ok());
    }
}

/// В какую ячейку класть кусок вызова инструмента из потока. Обычно это поле `index`, но часть локальных
/// серверов его не присылает: тогда новый `id` начинает новый вызов, а кусок без `id` продолжает последний.
/// Без этого два вызова подряд склеивались бы в один с испорченными аргументами.
fn tool_call_slot(existing: &HashMap<usize, (String, String, String)>, call: &Value) -> usize {
    if let Some(i) = call["index"].as_u64() {
        return i as usize;
    }
    let id = call["id"].as_str().unwrap_or("");
    match existing.keys().copied().max() {
        None => 0,
        Some(last) if id.is_empty() || existing[&last].0 == id => last,
        Some(last) => last + 1,
    }
}

fn validate_tool_input(raw: &str) -> Result<(), String> {
    if raw.is_empty() { return Ok(()); } // legitimate no-argument tool
    match serde_json::from_str::<Value>(raw) {
        Ok(v) if v.is_object() => Ok(()),
        _ => Err("incomplete or invalid tool input".into()),
    }
}

async fn call_anthropic(
    app: &AppHandle,
    key: &str,
    request: &AgentRequest,
    system: &str,
    turns: &[Turn],
    tools: &[Value],
    cancel: &AtomicBool,
) -> Result<ProviderResponse, String> {
    let client = ai_service::new_client()?;
    let mut usage = ai_service::Usage::default();
    // Prompt caching: system, tool definitions and the conversation so far are the same on every step
    // of the agent loop, so marking their ends makes repeated steps cost a fraction of the input price.
    let cache = json!({ "type": "ephemeral" });
    let mut tools_json = to_anthropic_tools(tools);
    if let Some(last) = tools_json.as_array_mut().and_then(|a| a.last_mut()).and_then(Value::as_object_mut) {
        last.insert("cache_control".into(), cache.clone());
    }
    let mut messages = anthropic_messages(turns);
    if let Some(block) = messages
        .last_mut()
        .and_then(|m| m.get_mut("content"))
        .and_then(Value::as_array_mut)
        .and_then(|c| c.last_mut())
        .and_then(Value::as_object_mut)
    {
        block.insert("cache_control".into(), cache.clone());
    }
    let body = json!({
        "model": request.model,
        "system": [{ "type": "text", "text": system, "cache_control": cache }],
        "max_tokens": 8192,
        "stream": true,
        "messages": messages,
        "tools": tools_json,
    });
    let resp = with_ua(
        crate::ai_service::anthropic_auth(
            client
                .post(format!("{}/v1/messages", request.base_url))
                .header("anthropic-version", crate::ai_service::ANTHROPIC_VERSION),
            key,
            request.auth.as_deref(),
        ),
        request.user_agent.as_deref(),
    )
    .json(&body)
    .send_c(cancel)
        .await?;
    let resp = ai_service::ensure_ok(resp, "Anthropic").await?;

    let mut text = String::new();
    let mut tool_blocks: HashMap<usize, (String, String, String)> = HashMap::new();
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    let mut finished = false;
    while !finished {
        let chunk = match crate::ai_service::next_or_cancel(&mut stream, cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => return Err("incomplete provider stream".into()),
            Err(e) => return Err(e),
        };
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        buf.extend_from_slice(&chunk);
        for line in ai_service::split_sse_lines(&mut buf) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
                continue;
            };
            let event_type = value["type"].as_str().unwrap_or("");
            ai_service::usage_anthropic(&value, &mut usage);
            match event_type {
                "error" => {
                    let message = value["error"]["message"]
                        .as_str()
                        .unwrap_or("неизвестная ошибка Anthropic");
                    return Err(message.to_string());
                }
                "content_block_start" => {
                    let idx = value["index"].as_u64().unwrap_or(0) as usize;
                    if value["content_block"]["type"] == "tool_use" {
                        let id = value["content_block"]["id"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string();
                        let name = value["content_block"]["name"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string();
                        tool_blocks.insert(idx, (id, name, String::new()));
                    }
                }
                "content_block_delta" => {
                    let idx = value["index"].as_u64().unwrap_or(0) as usize;
                    let delta_type = value["delta"]["type"].as_str().unwrap_or("");
                    if delta_type == "text_delta" {
                        if let Some(t) = value["delta"]["text"].as_str() {
                            text.push_str(t);
                            ai_service::emit_chunk(app, &request.request_id, t);
                        }
                    } else if delta_type == "thinking_delta" {
                        if let Some(t) = value["delta"]["thinking"].as_str() {
                            ai_service::emit_thinking(app, &request.request_id, t);
                        }
                    } else if delta_type == "input_json_delta" {
                        if let Some(entry) = tool_blocks.get_mut(&idx) {
                            if let Some(piece) = value["delta"]["partial_json"].as_str() {
                                entry.2.push_str(piece);
                            }
                        }
                    }
                }
                "message_stop" => {
                    finished = true;
                    break;
                }
                _ => {}
            }
        }
    }
    for (id, name, args) in tool_blocks.values() {
        if id.is_empty() || name.is_empty() { return Err("incomplete tool call".into()); }
        validate_tool_input(args)?;
    }
    let mut calls: Vec<(usize, ToolCall)> = tool_blocks
        .into_iter()
        .map(|(idx, (id, name, args))| {
            let arguments = serde_json::from_str(&args).unwrap_or(json!({}));
            (idx, ToolCall { id, name: name.clone(), arguments: arguments.clone(), raw_part: json!({ "functionCall": { "name": &name, "args": &arguments } }) })
        })
        .collect();
    calls.sort_by_key(|(idx, _)| *idx);
    Ok(ProviderResponse {
        text,
        reasoning: String::new(),
        tool_calls: calls.into_iter().map(|(_, c)| c).collect(),
        usage,
    })
}

async fn call_google(
    app: &AppHandle,
    key: &str,
    request: &AgentRequest,
    system: &str,
    turns: &[Turn],
    tools: &[Value],
    cancel: &AtomicBool,
) -> Result<ProviderResponse, String> {
    let client = ai_service::new_client()?;
    let mut usage = ai_service::Usage::default();
    let body = json!({
        "contents": google_contents(turns),
        "tools": [{ "functionDeclarations": to_google_tools(tools) }],
        "system_instruction": { "parts": [{ "text": system }] },
    });
    let url = format!(
        "{}/v1beta/models/{}:streamGenerateContent",
        request.base_url, request.model
    );
    let resp = client
        .post(url)
        .query(&[("alt", "sse"), ("key", key)])
        .json(&body)
        .send_c(cancel)
        .await?;
    let resp = ai_service::ensure_ok(resp, "Google").await?;

    let mut text = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    let mut call_idx = 0usize;
    let mut finished = false;
    while !finished {
        let chunk = match crate::ai_service::next_or_cancel(&mut stream, cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        buf.extend_from_slice(&chunk);
        for line in ai_service::split_sse_lines(&mut buf) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
                continue;
            };
            if let Some(message) = value["error"]["message"].as_str() {
                return Err(message.to_string());
            }
            if let Some(u) = ai_service::usage_google(&value) {
                usage = u;
            }
            finished |= value["candidates"][0]["finishReason"].as_str().is_some();
            let Some(parts) = value["candidates"][0]["content"]["parts"].as_array() else {
                continue;
            };
            for part in parts {
                if part["thought"].as_bool() == Some(true) {
                    if let Some(t) = part["text"].as_str() {
                        ai_service::emit_thinking(app, &request.request_id, t);
                    }
                } else if let Some(t) = part["text"].as_str() {
                    text.push_str(t);
                    ai_service::emit_chunk(app, &request.request_id, t);
                } else if let Some(fc) = part["functionCall"].as_object() {
                    let name = fc.get("name").and_then(Value::as_str).unwrap_or("");
                    if !name.is_empty() {
                        tool_calls.push(ToolCall {
                            id: format!("{name}_{call_idx}"),
                            name: name.to_string(),
                            arguments: fc.get("args").cloned().unwrap_or(json!({})),
                            raw_part: part.clone(),
                        });
                        call_idx += 1;
                    }
                }
            }
        }
    }
    if !finished { return Err("incomplete provider stream".into()); }
    Ok(ProviderResponse { text, reasoning: String::new(), tool_calls, usage })
}

async fn run_agent(
    app: &AppHandle,
    key: &str,
    request: &AgentRequest,
    cancel: &AtomicBool,
) -> Result<(u32, ai_service::Usage), String> {
    let mut total = ai_service::Usage::default();
    let compact = request.is_compact();
    let default_prompt = || {
        if compact && request.mode == "agent" {
            let mut p = agent_system_prompt_compact();
            if let Some(ctx) = request.context.as_ref().filter(|c| !c.trim().is_empty()) {
                // Маленькой модели хватает начала файла: весь контекст съел бы её окно.
                p.push_str("\n\nThe user's active file:\n");
                p.push_str(&ctx.chars().take(4_000).collect::<String>());
            }
            p
        } else {
            agent_system_prompt(&request.mode, &request.context)
        }
    };
    let mut system = match &request.system {
        Some(custom) if !custom.trim().is_empty() => custom.clone(),
        _ => default_prompt(),
    };
    // Небольшим моделям с маленьким контекстом правила проекта и память даём короче.
    system.push_str(&if compact { crate::project_context::extra_prompt_compact(app) } else { crate::project_context::extra_prompt(app) });
    system.push_str(&crate::skills::prompt(app, &request.instruction, true));
    if !compact {
        system.push_str(&crate::mcp::prompt_summary(app, request.mode == "agent"));
    }
    let result_limit = if compact { COMPACT_RESULT_CHARS } else { MAX_RESULT_CHARS };
    let mut turns: Vec<Turn> = Vec::new();
    for h in &request.history {
        if h.role == "user" {
            turns.push(Turn::User {
                text: h.content.clone(),
                attachments: h.attachments.clone(),
            });
        } else if !h.content.trim().is_empty() || h.reasoning_content.as_ref().is_some_and(|r| !r.is_empty()) {
            turns.push(Turn::Assistant {
                text: if request.kind == "openai" { h.content.clone() } else { ai_service::partial_content(&h.content, h.reasoning_content.as_deref().unwrap_or_default()) },
                reasoning: h.reasoning_content.clone().unwrap_or_default(),
                tools: Vec::new(),
            });
        }
    }
    turns.push(Turn::User {
        text: request.instruction.clone(),
        attachments: request.attachments.clone(),
    });

    // Повторы считаются только пока результат одинаковый: (последний результат, сколько раз подряд он повторился).
    // Любое изменяющее действие сбрасывает счётчики: после правок тот же вызов даёт новый результат.
    let mut seen_calls: std::collections::HashMap<String, (String, u32)> = std::collections::HashMap::new();
    // Самопроверка: какие файлы агент поменял с прошлой проверки и сколько проверок уже было.
    let checks_on = request.mode == "agent" && request.auto_check.unwrap_or(true);
    let mut changed: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut check_rounds: u32 = 0;
    if checks_on {
        system.push_str(
            "\n\nПосле твоего итогового ответа AIDE сам запустит проверки проекта (типы, линтер, тесты). \
Если они не пройдут, ты получишь вывод ошибок — исправь их по существу, не отключая проверки.",
        );
    }
    // Лимита шагов нет: агент работает, пока не закончит задачу или пользователь не нажмёт «Стоп».
    for iteration in 0..usize::MAX {
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        shrink_old_results(&mut turns, 6, if compact { 1_200 } else { 3_000 });
        let mut retries = 0;
        let response = loop {
            // Retry only generation. Completed tool results stay in `turns`; tools are
            // executed below, never inside this loop. Incomplete tool fragments are discarded.
            let (result, draft) = ai_service::capture_draft(
                call_provider(app, key, request, &system, &turns, cancel)
            ).await;
            match result {
                Ok(response) => break response,
                Err(error) => {
                    retries += 1;
                    ai_service::retry_wait(app, &request.request_id, retries, &error, cancel).await?;
                    if !draft.is_empty() {
                        turns.push(Turn::Assistant {
                            text: if request.kind == "openai" { draft.text.clone() } else { ai_service::partial_content(&draft.text, &draft.reasoning) },
                            reasoning: draft.reasoning, tools: Vec::new(),
                        });
                        turns.push(Turn::User {
                            text: "Соединение прервалось. Продолжи после незавершённого текста, не повторяя его. Результаты уже выполненных инструментов выше остаются действительными; не выполняй эти действия заново.".into(),
                            attachments: Vec::new(),
                        });
                        ai_service::emit_chunk(app, &request.request_id, "\n\n");
                    }
                }
            }
        };
        total.add(response.usage);
        if response.tool_calls.is_empty() {
            // Итоговый ответ. Если были правки — сначала проверяем проект; ошибки возвращаем модели.
            if checks_on && !changed.is_empty() && check_rounds < crate::verify::MAX_ROUNDS {
                let snapshot = std::mem::take(&mut changed);
                match self_check(app, request, &snapshot, iteration as u32, cancel).await? {
                    // Отказ или нечего проверять: ответ модели остаётся итоговым.
                    SelfCheck::Declined | SelfCheck::Skipped => {}
                    SelfCheck::Done(results) => {
                        check_rounds += 1;
                        if !crate::verify::all_passed(&results) && check_rounds < crate::verify::MAX_ROUNDS {
                            turns.push(Turn::Assistant {
                                text: if response.text.trim().is_empty() { "Готово.".into() } else { response.text },
                                reasoning: response.reasoning,
                                tools: Vec::new(),
                            });
                            turns.push(Turn::User {
                                text: crate::verify::failure_prompt(&results, check_rounds),
                                attachments: Vec::new(),
                            });
                            ai_service::emit_chunk(app, &request.request_id, "\n\n");
                            continue;
                        }
                    }
                }
            }
            return Ok((iteration as u32, total));
        }
        let mut tool_results: Vec<Turn> = Vec::new();
        for call in &response.tool_calls {
            if cancel.load(Ordering::Relaxed) {
                return Err("canceled".into());
            }
            // Опрос пользователя: не инструмент правок, показывается как карточка вопросов,
            // ответ возвращается текстом готовых ответов.
            if call.name == "ask_user" {
                let questions = match parse_question_args(&call.arguments) {
                    Ok(q) => q,
                    Err(e) => {
                        tool_results.push(Turn::ToolResult {
                            id: call.id.clone(),
                            name: call.name.clone(),
                            result: format!("ОШИБКА: {e}"),
                            images: Vec::new(),
                        });
                        continue;
                    }
                };
                let args_pretty = ai_service::truncate(
                    &questions
                        .iter()
                        .map(|q| q.question.as_str())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    400,
                );
                let result = request_answers(app, request, &questions, cancel).await;
                match result {
                    Ok(text) => {
                        let _ = app.emit(
                            "ai-tool",
                            AiToolEvent {
                                request_id: request.request_id.clone(),
                                tool: call.name.clone(),
                                args: args_pretty,
                                status: "ok".into(),
                                result: ai_service::truncate(&text, MAX_TOOL_EVENT_CHARS),
                                iteration: iteration as u32,
                            },
                        );
                        tool_results.push(Turn::ToolResult {
                            id: call.id.clone(),
                            name: call.name.clone(),
                            result: text,
                            images: Vec::new(),
                        });
                    }
                    Err(message) => {
                        if message == "canceled" {
                            return Err(message);
                        }
                        let _ = app.emit(
                            "ai-tool",
                            AiToolEvent {
                                request_id: request.request_id.clone(),
                                tool: call.name.clone(),
                                args: args_pretty,
                                status: "error".into(),
                                result: ai_service::truncate(&message, MAX_TOOL_EVENT_CHARS),
                                iteration: iteration as u32,
                            },
                        );
                        tool_results.push(Turn::ToolResult {
                            id: call.id.clone(),
                            name: call.name.clone(),
                            result: format!("ОШИБКА: {message}"),
                            images: Vec::new(),
                        });
                    }
                }
                continue;
            }
            let args_pretty = if crate::mcp::is_manage_tool(&call.name) {
                // Пользователь должен видеть точную команду целиком.
                ai_service::truncate(&crate::mcp::describe_add(&call.arguments), 1500)
            } else {
                ai_service::truncate(&serde_json::to_string_pretty(&call.arguments).unwrap_or_default(), 400)
            };
            let allowed =
                request_permission(app, request, &call.name, &call.arguments, &args_pretty, cancel).await?;
            if !allowed {
                let _ = app.emit(
                    "ai-tool",
                    AiToolEvent {
                        request_id: request.request_id.clone(),
                        tool: call.name.clone(),
                        args: args_pretty,
                        status: "denied".into(),
                        result: "Действие отклонено пользователем".into(),
                        iteration: iteration as u32,
                    },
                );
                tool_results.push(Turn::ToolResult {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    result: "Действие отклонено пользователем".into(),
                    images: Vec::new(),
                });
                continue;
            }
            // Защита от зацикливания: тот же вызов 4 раза подряд дал тот же результат, и между ними ничего не менялось.
            let sig = format!("{}\u{0}{}", call.name, call.arguments);
            let is_mutation = matches!(
                call.name.as_str(),
                "write_file" | "create_file" | "delete_file" | "apply_edit" | "run_terminal_command"
            ) || crate::mcp::is_mcp_tool(&call.name)
                || crate::browser_view::is_browser_tool(&call.name)
                || crate::app_bridge::is_bridge_tool(&call.name);
            if is_mutation {
                seen_calls.clear();
            }
            let repeats = seen_calls.get(&sig).map(|(_, n)| *n).unwrap_or(0);
            if repeats >= 4 {
                let note = "Этот вызов с теми же аргументами уже 4 раза дал тот же результат. Измени подход или аргументы.";
                let _ = app.emit(
                    "ai-tool",
                    AiToolEvent {
                        request_id: request.request_id.clone(),
                        tool: call.name.clone(),
                        args: args_pretty,
                        status: "error".into(),
                        result: note.into(),
                        iteration: iteration as u32,
                    },
                );
                tool_results.push(Turn::ToolResult {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    result: format!("ОШИБКА: {note}"),
                    images: Vec::new(),
                });
                continue;
            }
            crate::checkpoints::record(app, &request.request_id, &call.name, &call.arguments);
            // Stop also interrupts the slow awaited tools (MCP servers, the browser, adding a server).
            let raw: Result<(String, Vec<AiScreenshot>), String> = tokio::select! {
                r = async {
                    if crate::mcp::is_manage_tool(&call.name) {
                        crate::mcp::add_from_agent(app, &call.arguments).await.map(|t| (t, Vec::new()))
                    } else if crate::browser_view::is_browser_tool(&call.name) {
                        crate::browser_view::agent_tool(app, &call.name, &call.arguments).await
                    } else if crate::app_bridge::is_bridge_tool(&call.name) {
                        crate::app_bridge::call(app, &call.name, &call.arguments).await.map(|t| (t, Vec::new()))
                    } else if crate::mcp::is_mcp_tool(&call.name) {
                        crate::mcp::call_tool(app, &call.name, &call.arguments).await.map(|t| (t, Vec::new()))
                    } else {
                        // Файлы, поиск и особенно терминал блокируют поток: в async-рантайме это занимало бы рабочие потоки,
                        // и при нескольких задачах сразу всё приложение переставало отвечать.
                        let (app2, name, args) = (app.clone(), call.name.clone(), call.arguments.clone());
                        match tauri::async_runtime::spawn_blocking(move || execute_tool(&app2, &name, &args)).await {
                            Ok(r) => r.map(|t| (t, Vec::new())),
                            Err(e) => Err(format!("инструмент завершился аварийно: {e}")),
                        }
                    }
                } => r,
                _ = ai_service::wait_cancel(cancel) => return Err("canceled".into()),
            };
            let result: Result<(String, Vec<AiScreenshot>), String> = raw;
            match result {
                Ok((result, images)) => {
                    crate::verify::track(&mut changed, &call.name, &call.arguments);
                    let entry = seen_calls.entry(sig).or_insert((String::new(), 0));
                    if entry.0 == result {
                        entry.1 += 1;
                    } else {
                        *entry = (result.clone(), 1);
                    }
                    let _ = app.emit(
                        "ai-tool",
                        AiToolEvent {
                            request_id: request.request_id.clone(),
                            tool: call.name.clone(),
                            args: args_pretty,
                            status: "ok".into(),
                            result: ai_service::truncate(&result, MAX_TOOL_EVENT_CHARS),
                            iteration: iteration as u32,
                        },
                    );
                    tool_results.push(Turn::ToolResult {
                        id: call.id.clone(),
                        name: call.name.clone(),
                        result: ai_service::truncate(&result, result_limit),
                        images,
                    });
                }
                Err(message) => {
                    let _ = app.emit(
                        "ai-tool",
                        AiToolEvent {
                            request_id: request.request_id.clone(),
                            tool: call.name.clone(),
                            args: args_pretty,
                            status: "error".into(),
                            result: ai_service::truncate(&message, MAX_TOOL_EVENT_CHARS),
                            iteration: iteration as u32,
                        },
                    );
                    tool_results.push(Turn::ToolResult {
                        id: call.id.clone(),
                        name: call.name.clone(),
                        result: format!("ОШИБКА: {message}"),
                        images: Vec::new(),
                    });
                }
            }
        }
        turns.push(Turn::Assistant {
            text: response.text,
            reasoning: response.reasoning,
            tools: response.tool_calls,
        });
        turns.extend(tool_results);
    }
    Err("Достигнут предел шагов агента".into())
}

enum SelfCheck {
    /// Проверять нечего (например, поменялась только документация) или нет открытого проекта.
    Skipped,
    /// Пользователь не разрешил запуск.
    Declined,
    Done(Vec<crate::verify::CheckResult>),
}

/// Самопроверка после правок агента: те же разрешения, что у команды терминала, вывод — в панель терминала,
/// итог — строкой действия «auto_check» в чате.
async fn self_check(
    app: &AppHandle,
    request: &AgentRequest,
    changed: &std::collections::BTreeSet<String>,
    iteration: u32,
    cancel: &AtomicBool,
) -> Result<SelfCheck, String> {
    let root = {
        let state = app.state::<WorkspaceRoot>();
        match crate::fs_commands::workspace_root(&state) {
            Ok(r) => r,
            Err(_) => return Ok(SelfCheck::Skipped),
        }
    };
    let emit = |args: &str, status: &str, result: &str| {
        let _ = app.emit(
            "ai-tool",
            AiToolEvent {
                request_id: request.request_id.clone(),
                tool: "auto_check".into(),
                args: args.to_string(),
                status: status.into(),
                result: ai_service::truncate(result, MAX_TOOL_EVENT_CHARS),
                iteration,
            },
        );
    };
    let checks = match crate::verify::plan(&root, changed) {
        Ok(c) if c.is_empty() => return Ok(SelfCheck::Skipped),
        Ok(c) => c,
        Err(e) => {
            emit(&json!({ "command": crate::verify::CONFIG_PATH }).to_string(), "error", &e);
            return Ok(SelfCheck::Skipped);
        }
    };
    let commands = checks.iter().map(|c| c.command.as_str()).collect::<Vec<_>>().join(" && ");
    let args_value = json!({ "command": commands });
    let args = serde_json::to_string_pretty(&args_value).unwrap_or_default();
    // Команды могут прийти из файла проекта — запускаем их только с разрешения, как любую команду терминала.
    if !request_permission(app, request, "run_terminal_command", &args_value, &ai_service::truncate(&args, 1500), cancel).await? {
        emit(&args, "denied", "Действие отклонено пользователем");
        return Ok(SelfCheck::Declined);
    }
    emit(&args, "running", "");
    let (app2, root2) = (app.clone(), root.clone());
    let results = tokio::select! {
        r = tauri::async_runtime::spawn_blocking(move || {
            crate::verify::run(&root2, &checks, |cmd, out| {
                let text = if out.is_empty() { format!("> {cmd}\n") } else { format!("{out}\n") };
                let _ = app2.emit("terminal-output", terminal::terminal_output_payload(&text, false));
            })
        }) => r.map_err(|e| format!("самопроверка завершилась аварийно: {e}"))?,
        _ = ai_service::wait_cancel(cancel) => return Err("canceled".into()),
    };
    let passed = crate::verify::all_passed(&results);
    emit(&args, if passed { "ok" } else { "error" }, &crate::verify::summary(&results));
    Ok(SelfCheck::Done(results))
}

/// Слабые модели придумывают имена инструментов (search_file вместо search_files). Подсказываем похожие настоящие.
fn unknown_tool_message(name: &str) -> String {
    let words = |n: &str| -> Vec<String> {
        n.split('_').filter(|w| w.len() > 2).map(|w| w.trim_end_matches('s').to_string()).collect()
    };
    let wanted = words(name);
    // Совпавший глагол (первое слово: search_*, read_*) важнее общего существительного (*_file).
    let score = |real: &str| -> u32 {
        let rw = words(real);
        wanted.iter().enumerate().filter(|(_, w)| rw.contains(w)).map(|(i, w)| if i == 0 && rw.first() == Some(w) { 3 } else { 1 }).sum()
    };
    let mut scored: Vec<(u32, String)> = tool_defs("agent")
        .iter()
        .filter_map(|t| t["name"].as_str().map(String::from))
        .map(|n| (score(&n), n))
        .filter(|(s, _)| *s > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0)); // стабильно: при равенстве — порядок объявления
    let similar: Vec<String> = scored.into_iter().take(4).map(|(_, n)| n).collect();
    if similar.is_empty() {
        format!("Неизвестный инструмент: {name}. Используй только инструменты из списка.")
    } else {
        format!("Неизвестный инструмент: {name}. Похожие настоящие: {}.", similar.join(", "))
    }
}

fn str_arg(args: &Value, name: &str) -> Result<String, String> {
    args.get(name)
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| format!("инструмент: не хватает аргумента «{name}»"))
}

/// Гейт разрешений: режим "full" пропускает всё, "ask" спрашивает на каждое
/// действие, "auto" — только на опасные (запись/удаление/терминал).
async fn request_permission(
    app: &AppHandle,
    request: &AgentRequest,
    tool: &str,
    args: &Value,
    args_pretty: &str,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    let mode = request.permission_mode.as_deref().unwrap_or("auto");
    let sensitive = match mode {
        // Запуск новой программы на компьютере подтверждается всегда, даже в режиме «Свобода»:
        // иначе текст из документации или страницы мог бы подсунуть агенту свой сервер.
        "full" if !crate::mcp::is_manage_tool(tool) => return Ok(true),
        "full" => true,
        "ask" => true,
        // Инструменты MCP-серверов могут делать что угодно, поэтому в режиме «Авто» они тоже спрашивают.
        _ => crate::mcp::is_mcp_tool(tool)
            || crate::app_bridge::needs_confirmation(tool, args)
            || matches!(
                tool,
                "browser_eval" | "write_file" | "create_file" | "delete_file" | "apply_edit" | "run_terminal_command"
            ),
    };
    if !sensitive {
        return Ok(true);
    }
    let (tx, mut rx) = tokio::sync::oneshot::channel::<bool>();
    app.state::<PermissionRequests>()
        .0
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), tx);
    let _ = app.emit(
        "ai-permission",
        json!({
            "request_id": request.request_id,
            "tool": tool,
            "args": args_pretty,
        }),
    );
    loop {
        if cancel.load(Ordering::Relaxed) {
            app.state::<PermissionRequests>()
                .0
                .lock()
                .unwrap()
                .remove(&request.request_id);
            return Err("canceled".into());
        }
        match tokio::time::timeout(Duration::from_millis(500), &mut rx).await {
            Ok(Ok(allow)) => return Ok(allow),
            Ok(Err(_)) => return Err("нет ответа на запрос разрешения".into()),
            Err(_) => continue,
        }
    }
}

fn walk_tree(dir: &Path, depth: usize, max_lines: usize, lines: &mut Vec<String>) {
    if lines.len() >= max_lines {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut list: Vec<_> = entries
        .filter_map(|e| e.ok())
        .map(|e| (e.file_name().to_string_lossy().to_string(), e.file_type().ok()))
        .collect();
    list.sort_by(|a, b| {
        let a_dir = a.1.as_ref().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.1.as_ref().map(|t| t.is_dir()).unwrap_or(false);
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase()))
    });
    for (name, ftype) in list {
        if lines.len() >= max_lines {
            return;
        }
        let is_dir = ftype.map(|t| t.is_dir()).unwrap_or(false);
        let indent = "  ".repeat(depth);
        if is_dir {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            lines.push(format!("{indent}{name}/"));
            if depth < 4 {
                walk_tree(&dir.join(&name), depth + 1, max_lines, lines);
            }
        } else {
            lines.push(format!("{indent}{name}"));
        }
    }
}

fn execute_tool(app: &AppHandle, name: &str, args: &Value) -> Result<String, String> {
    // Built-ins are available even when no project is open. IDs are resolved afresh.
    if name == "list_skills" {
        let skills: Vec<_> = crate::skills::list(app).into_iter().filter(|s| s.enabled)
            .map(|s| json!({ "id": s.id, "name": s.name, "description": s.description, "files": s.files })).collect();
        return serde_json::to_string(&skills).map_err(|e| e.to_string());
    }
    if name == "read_skill" {
        return crate::skills::read(app, &str_arg(args, "id")?, args.get("file").and_then(Value::as_str));
    }
    if name == "get_diagnostics" {
        return crate::lsp::agent_diagnostics(app, args.get("path").and_then(Value::as_str));
    }
    if crate::code_index::is_index_tool(name) {
        return crate::code_index::agent_tool(app, name, args);
    }
    let root = {
        let state = app.state::<WorkspaceRoot>();
        crate::fs_commands::workspace_root(&state)?
    };
    let notify = |path: &str| {
        let _ = app.emit("fs-change", vec![path.to_string()]);
    };
    match name {
        "read_file" => {
            let path = str_arg(args, "path")?;
            let p = crate::fs_commands::resolve_existing(&root, &path)?;
            if !p.is_file() {
                return Err("Это не файл".into());
            }
            let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
            Ok(ai_service::truncate(&content, MAX_READ_CHARS))
        }
        "list_dir" => {
            let path = str_arg(args, "path").unwrap_or_else(|_| root.to_string_lossy().to_string());
            let entries = crate::fs_commands::read_dir_entries(&root, &path)?;
            let mut out = Vec::new();
            for e in entries {
                out.push(format!(
                    "{}\t{}",
                    if e.is_dir { "[dir] " } else { "[file]" },
                    e.name
                ));
            }
            Ok(out.join("\n"))
        }
        "get_tree" => {
            let path = str_arg(args, "path").unwrap_or_else(|_| root.to_string_lossy().to_string());
            let p = crate::fs_commands::resolve_existing(&root, &path)?;
            let mut lines = Vec::new();
            walk_tree(&p, 0, 3000, &mut lines);
            Ok(lines.join("\n"))
        }
        "search_files" => {
            let query = str_arg(args, "query")?;
            let path = str_arg(args, "path").unwrap_or_else(|_| root.to_string_lossy().to_string());
            let dir = crate::fs_commands::resolve_existing(&root, &path)?;
            if !dir.is_dir() {
                return Err("Директория не найдена".into());
            }
            let q = query.to_lowercase();
            let mut results = Vec::new();
            let mut scanned = 0usize;
            let mut stack = vec![dir];
            while let Some(d) = stack.pop() {
                if scanned >= MAX_SCANNED_FILES {
                    break;
                }
                let Ok(entries) = fs::read_dir(&d) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let ftype = entry.file_type().map_err(|e| e.to_string())?;
                    if ftype.is_dir() {
                        if !SKIP_DIRS.contains(&name.as_str()) {
                            stack.push(entry.path());
                        }
                    } else if ftype.is_file() {
                        scanned += 1;
                        if results.len() >= MAX_SEARCH_RESULTS {
                            break;
                        }
                        if let Ok(content) = fs::read_to_string(&entry.path()) {
                            if content.len() > 2_000_000 {
                                continue;
                            }
                            for (idx, line) in content.lines().enumerate() {
                                if line.to_lowercase().contains(&q) {
                                    let full = entry.path();
                                    let rel = full
                                        .strip_prefix(&root)
                                        .unwrap_or(&full);
                                    results.push(format!(
                                        "{}:{}: {}",
                                        rel.to_string_lossy(),
                                        idx + 1,
                                        ai_service::truncate(line, 200)
                                    ));
                                    if results.len() >= MAX_SEARCH_RESULTS {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(results.join("\n"))
        }
        "browse_page" => {
            let url = str_arg(args, "url")?;
            crate::browse::browse(&url)
        }
        "write_file" => {
            let path = str_arg(args, "path")?;
            let content = str_arg(args, "content")?;
            let p = crate::fs_commands::resolve_new(&root, &path)?;
            if content.len() > 2_000_000 {
                return Err("Файл слишком большой".into());
            }
            fs::write(&p, content).map_err(|e| e.to_string())?;
            notify(&p.to_string_lossy());
            Ok(format!("Файл записан: {}", p.to_string_lossy()))
        }
        "create_file" => {
            let path = str_arg(args, "path")?;
            let content = str_arg(args, "content")?;
            let p = crate::fs_commands::resolve_new(&root, &path)?;
            if p.exists() {
                return Err("Файл уже существует".into());
            }
            fs::write(&p, content).map_err(|e| e.to_string())?;
            notify(&p.to_string_lossy());
            Ok(format!("Файл создан: {}", p.to_string_lossy()))
        }
        "delete_file" => {
            let path = str_arg(args, "path")?;
            let p = crate::fs_commands::resolve_existing(&root, &path)?;
            if p == root {
                return Err("Нельзя удалить корень рабочей области".into());
            }
            let meta = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
            if meta.is_dir() {
                fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&p).map_err(|e| e.to_string())?;
            }
            notify(&p.to_string_lossy());
            Ok(format!("Удалено: {}", p.to_string_lossy()))
        }
        "apply_edit" => {
            let path = str_arg(args, "path")?;
            let old_text = str_arg(args, "old_text")?;
            let new_text = str_arg(args, "new_text")?;
            let p = crate::fs_commands::resolve_existing(&root, &path)?;
            let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
            let count = content.matches(&old_text).count();
            if count == 0 {
                return Err("old_text не найден в файле".into());
            }
            if count > 1 {
                return Err(format!("old_text встречается {count} раз — уточните фрагмент"));
            }
            let updated = content.replace(&old_text, &new_text);
            fs::write(&p, updated).map_err(|e| e.to_string())?;
            notify(&p.to_string_lossy());
            Ok(format!("Файл обновлён: {}", p.to_string_lossy()))
        }
        "run_terminal_command" => {
            let command = str_arg(args, "command")?;
            if command.trim().is_empty() {
                return Err("Пустая команда".into());
            }
            let timeout = args
                .get("timeout_seconds")
                .and_then(Value::as_u64)
                .unwrap_or(60);
            // Команда и вывод дублируются в панель терминала — агент прозрачен.
            let _ = app.emit(
                "terminal-output",
                terminal::terminal_output_payload(&format!("> {command}\n"), false),
            );
            let result = terminal::run_shell_command(&root, &command, timeout)?;
            let _ = app.emit(
                "terminal-output",
                terminal::terminal_output_payload(&result, false),
            );
            Ok(result)
        }
        _ => Err(unknown_tool_message(name)),
    }
}

#[cfg(test)]
mod browser_preference_tests {
    use super::*;

    #[test]
    fn agent_prompt_prefers_builtin_browser_over_mcp() {
        let p = agent_system_prompt("agent", &None);
        for tool in ["browser_open", "browser_eval", "browser_console"] {
            assert!(p.contains(tool), "в промпте агента нет {tool}");
        }
        assert!(p.contains("Playwright"), "промпт должен объяснять, когда брать Playwright");
    }

    #[test]
    fn builtin_browser_tools_are_offered_to_agent_only() {
        let names = |mode: &str| -> Vec<String> {
            tool_defs(mode)
                .iter()
                .filter_map(|t| t["name"].as_str().map(String::from))
                .collect()
        };
        let agent = names("agent");
        for tool in ["browser_open", "browser_eval", "browser_console"] {
            assert!(agent.iter().any(|n| n == tool));
        }
        assert!(!names("plan").iter().any(|n| n.starts_with("browser_")));
    }

    #[test]
    fn browser_tool_descriptions_point_to_builtin_browser() {
        let defs = tool_defs("agent");
        let desc = |name: &str| {
            defs.iter()
                .find(|t| t["name"] == name)
                .and_then(|t| t["description"].as_str())
                .unwrap_or("")
                .to_string()
        };
        assert!(desc("browser_open").contains("ПРЕДПОЧТИТЕЛЬНЫЙ"));
        assert!(desc("browser_eval").contains("вместо Playwright"));
    }
}

#[cfg(test)]
mod app_control_tests {
    use super::*;

    fn names(mode: &str) -> Vec<String> {
        tool_defs(mode)
            .iter()
            .filter_map(|t| t["name"].as_str().map(String::from))
            .collect()
    }

    #[test]
    fn app_control_tools_are_offered_to_agent_only() {
        let agent = names("agent");
        for tool in ["app_state", "app_navigate", "design_control"] {
            assert!(agent.iter().any(|n| n == tool), "в режиме агента нет {tool}");
        }
        let plan = names("plan");
        assert!(!plan.iter().any(|n| crate::app_bridge::is_bridge_tool(n)));
    }

    #[test]
    fn design_control_requires_an_action() {
        let defs = tool_defs("agent");
        let d = defs.iter().find(|t| t["name"] == "design_control").expect("design_control");
        assert_eq!(d["required"], json!(["action"]));
        assert!(d["parameters"]["action"].is_object());
    }

    #[test]
    fn agent_prompt_mentions_interface_control() {
        let p = agent_system_prompt("agent", &None);
        for tool in ["app_state", "app_navigate", "design_control"] {
            assert!(p.contains(tool), "в промпте агента нет {tool}");
        }
    }
}
#[cfg(test)]
mod local_model_tests {
    use super::*;

    fn req(provider: &str, compact: Option<bool>) -> AgentRequest {
        serde_json::from_value(json!({
            "requestId": "r", "providerId": provider, "kind": "openai", "baseUrl": "http://127.0.0.1:11434/v1",
            "model": "m", "mode": "agent", "instruction": "x", "context": null, "system": null, "auth": null, "userAgent": null,
            "compact": compact,
        }))
        .unwrap()
    }

    #[test]
    fn compact_mode_is_on_for_local_providers_and_overridable() {
        assert!(req("ollama", None).is_compact());
        assert!(req("lmstudio", None).is_compact());
        assert!(req("local-llama-cpp", None).is_compact());
        assert!(!req("openai", None).is_compact());
        assert!(!req("ollama", Some(false)).is_compact());
        assert!(req("openai", Some(true)).is_compact());
    }

    #[test]
    fn compact_tool_set_keeps_core_tools_and_drops_heavy_ones() {
        let all: Vec<String> = tool_defs("agent").iter().filter_map(|t| t["name"].as_str().map(String::from)).collect();
        let kept: Vec<&String> = all.iter().filter(|n| COMPACT_TOOLS.contains(&n.as_str())).collect();
        // Все инструменты из списка действительно существуют (опечатка тихо убрала бы инструмент у агента).
        for tool in COMPACT_TOOLS {
            assert!(all.iter().any(|n| n == tool), "в списке компактных инструментов нет {tool}");
        }
        assert_eq!(kept.len(), COMPACT_TOOLS.len());
        for heavy in ["design_control", "app_state", "app_navigate", "browser_open", "browse_page"] {
            assert!(!COMPACT_TOOLS.contains(&heavy));
        }
        // Урезанный набор заметно меньше полного.
        let size = |names: &[&str]| tool_defs("agent").iter().filter(|t| names.contains(&t["name"].as_str().unwrap_or(""))).map(|t| t.to_string().len()).sum::<usize>();
        let full: usize = tool_defs("agent").iter().map(|t| t.to_string().len()).sum();
        // Сейчас ~6,6 КБ против ~13 КБ: порог с запасом, чтобы тест ловил случайное раздувание набора.
        assert!(size(&COMPACT_TOOLS) * 10 < full * 6, "компактный набор должен быть заметно короче полного");
        assert!(agent_system_prompt_compact().len() * 3 < agent_system_prompt("agent", &None).len());
    }

    #[test]
    fn tool_call_chunks_without_index_are_split_by_id() {
        let mut calls: HashMap<usize, (String, String, String)> = HashMap::new();
        // Первый вызов: id + имя, потом куски аргументов без id и без index.
        let c1 = json!({ "id": "call_a", "function": { "name": "read_file", "arguments": "" } });
        let s = tool_call_slot(&calls, &c1);
        calls.entry(s).or_insert((String::new(), String::new(), String::new())).0 = "call_a".into();
        assert_eq!(s, 0);
        assert_eq!(tool_call_slot(&calls, &json!({ "function": { "arguments": "{\"path\":" } })), 0);
        // Новый id — новый вызов.
        let c2 = json!({ "id": "call_b", "function": { "name": "list_dir", "arguments": "{}" } });
        let s2 = tool_call_slot(&calls, &c2);
        assert_eq!(s2, 1);
        calls.entry(s2).or_insert((String::new(), String::new(), String::new())).0 = "call_b".into();
        // Повтор того же id дописывает в тот же вызов, а явный index всегда главнее.
        assert_eq!(tool_call_slot(&calls, &json!({ "id": "call_b" })), 1);
        assert_eq!(tool_call_slot(&calls, &json!({ "index": 0, "function": { "arguments": "x" } })), 0);
    }
}

#[cfg(test)]
mod unknown_tool_tests {
    use super::*;

    fn result(text: &str) -> Turn {
        Turn::ToolResult { id: "i".into(), name: "read_file".into(), result: text.into(), images: Vec::new() }
    }

    fn texts(turns: &[Turn]) -> Vec<String> {
        turns.iter().filter_map(|t| if let Turn::ToolResult { result, .. } = t { Some(result.clone()) } else { None }).collect()
    }

    #[test]
    fn only_old_tool_results_are_shortened() {
        let big = "я".repeat(5_000);
        let mut turns: Vec<Turn> = (0..10).map(|_| result(&big)).collect();
        turns.insert(3, Turn::User { text: big.clone(), attachments: Vec::new() });
        shrink_old_results(&mut turns, 6, 1_000);
        let r = texts(&turns);
        assert_eq!(r.len(), 10);
        for old in &r[..4] {
            assert!(old.starts_with(&"я".repeat(1_000)) && old.contains("сокращён") && old.chars().count() < 1_200);
        }
        for recent in &r[4..] {
            assert_eq!(recent.chars().count(), 5_000);
        }
        // пользовательский текст не трогаем, повторный вызов ничего не меняет
        assert!(matches!(&turns[3], Turn::User { text, .. } if text.chars().count() == 5_000));
        let before = texts(&turns);
        shrink_old_results(&mut turns, 6, 1_000);
        assert_eq!(texts(&turns), before);
        // мало результатов — ничего не происходит
        let mut few = vec![result(&big), result(&big)];
        shrink_old_results(&mut few, 6, 1_000);
        assert!(texts(&few).iter().all(|t| t.chars().count() == 5_000));
    }

    #[test]
    fn prompts_forbid_writing_tool_calls_as_text() {
        assert!(agent_system_prompt_compact().contains("Never write your tool calls as text"));
        assert!(agent_system_prompt("agent", &None).contains("Никогда не записывай вызовы инструментов текстом"));
        assert!(agent_system_prompt("plan", &None).contains("Никогда не записывай вызовы инструментов текстом"));
    }

    #[test]
    fn invented_tool_names_get_real_suggestions() {
        let m = unknown_tool_message("search_file");
        assert!(m.starts_with("Неизвестный инструмент: search_file"), "{m}");
        assert!(m.contains("search_files") && m.contains("search_code"), "{m}");
        let w = unknown_tool_message("zzzzzz");
        assert!(w.contains("только инструменты из списка"), "{w}");
    }

    #[test]
    fn search_code_comes_first_in_the_guidance() {
        let defs = tool_defs("agent");
        let desc = |n: &str| defs.iter().find(|t| t["name"] == n).and_then(|t| t["description"].as_str()).unwrap_or_default().to_string();
        assert!(desc("search_code").contains("ПЕРВЫМ"));
        let map = desc("project_map");
        assert!(map.contains("ОБЗОР") && map.contains("search_code"), "{map}");
        assert!(!map.contains("Начни с неё"), "карта не должна звать себя первой");
        assert!(agent_system_prompt_compact().contains("search_code FIRST"));
    }
}
