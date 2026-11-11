//! Распознавание речи через Whisper на Groq (созвон Экипажа).
//!
//! Ключ хранится в защищённом хранилище Windows (keyring) и никогда не возвращается в интерфейс:
//! наружу отдаётся только «ключ есть / нет». Запросы идут на один фиксированный адрес Groq,
//! произвольные URL не принимаются; размер записи, тип звука и язык проверяются, ответ — это
//! данные (обрезается и показывается как обычный текст). Текст ошибок не содержит ключа.

use std::time::Duration;

use base64::Engine;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;

const SERVICE: &str = "aide";
const ACCOUNT: &str = "groq-whisper";
const ENDPOINT: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL: &str = "whisper-large-v3-turbo";
const MAX_AUDIO_BYTES: usize = 12 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 2000;

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

fn read_key() -> Option<String> {
    match entry().ok()?.get_password() {
        Ok(k) if !k.trim().is_empty() => Some(k),
        _ => None,
    }
}

#[tauri::command]
pub fn stt_has_key() -> bool {
    read_key().is_some()
}

#[tauri::command]
pub fn stt_save_key(key: String) -> Result<(), String> {
    let key = key.trim();
    // Ключи Groq выглядят как gsk_…; жёстко отсекаем явный мусор и пробелы внутри.
    if key.len() < 20 || key.len() > 200 || !key.starts_with("gsk_") || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Это не похоже на ключ Groq (он начинается с gsk_)".into());
    }
    entry()?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stt_clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Deserialize)]
struct Transcription {
    text: Option<String>,
}

/// `audio_b64` — запись из микрофона (webm/ogg/mp4/wav), `lang` — "ru" или "en".
#[tauri::command]
pub async fn stt_transcribe(audio_b64: String, mime: String, lang: String) -> Result<String, String> {
    let key = read_key().ok_or("Ключ Groq не задан: Настройки → Голос")?;
    let language = match lang.as_str() {
        "ru" | "en" | "de" | "fr" | "es" | "pt" | "it" | "ja" | "ko" | "zh" => lang,
        _ => return Err("Неподдерживаемый язык".into()),
    };
    let (ext, content_type) = match mime.split(';').next().unwrap_or("").trim() {
        "audio/webm" => ("webm", "audio/webm"),
        "audio/ogg" => ("ogg", "audio/ogg"),
        "audio/mp4" => ("mp4", "audio/mp4"),
        "audio/wav" | "audio/x-wav" => ("wav", "audio/wav"),
        _ => return Err("Неподдерживаемый формат записи".into()),
    };
    if audio_b64.len() > MAX_AUDIO_BYTES * 4 / 3 + 8 {
        return Err("Запись слишком длинная".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_b64.as_bytes())
        .map_err(|_| "Повреждённая запись".to_string())?;
    if bytes.len() < 500 {
        return Ok(String::new()); // тишина или слишком короткая запись
    }
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err("Запись слишком длинная".into());
    }

    let part = Part::bytes(bytes)
        .file_name(format!("speech.{ext}"))
        .mime_str(content_type)
        .map_err(|e| e.to_string())?;
    let form = Form::new()
        .part("file", part)
        .text("model", MODEL)
        .text("language", language)
        .text("response_format", "json")
        .text("temperature", "0");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(ENDPOINT)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|_| "Не удалось связаться с Groq".to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "Groq отклонил ключ: проверьте его в Настройках".to_string(),
            429 => "Лимит Groq исчерпан, попробуйте позже".to_string(),
            code => format!("Groq вернул ошибку {code}"),
        });
    }
    let data: Transcription = resp.json().await.map_err(|_| "Неожиданный ответ Groq".to_string())?;
    Ok(data.text.unwrap_or_default().trim().chars().take(MAX_TEXT_CHARS).collect())
}
