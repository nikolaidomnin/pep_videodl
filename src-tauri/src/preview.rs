//! Предпросмотр кадров для обрезки: ffmpeg достаёт один кадр прямо из потока
//! в интернете (без скачивания видео) и отдаёт его как data-URL JPEG.

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::sync::oneshot;

use crate::AppState;
use crate::deps;
use crate::ytdlp::{self, hide_console};

/// Откуда брать кадры для конкретного видео.
#[derive(Clone)]
pub struct PreviewSource {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Serialize, Clone)]
pub struct StoryboardFragment {
    pub url: String,
    pub duration: f64,
}

/// Раскадровка YouTube: спрайты из rows×columns миниатюр, каждая на tile_duration секунд.
#[derive(Serialize, Clone)]
pub struct Storyboard {
    pub width: u64,
    pub height: u64,
    pub rows: u64,
    pub columns: u64,
    pub tile_duration: f64,
    pub fragments: Vec<StoryboardFragment>,
}

fn headers_of(v: &Value) -> Vec<(String, String)> {
    v["http_headers"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// Выбрать поток, из которого быстрее всего достать кадр: прямой https,
/// H.264 (быстро декодируется), высота поближе к 360p.
pub fn pick_source(v: &Value) -> Option<PreviewSource> {
    let formats = v["formats"].as_array().cloned().unwrap_or_default();
    let best = formats
        .iter()
        .filter(|f| {
            f["vcodec"].as_str().unwrap_or("none") != "none"
                && f["url"].as_str().is_some()
                && f["protocol"].as_str() != Some("mhtml")
                && f["format_note"].as_str() != Some("storyboard")
        })
        .min_by_key(|f| {
            let proto = f["protocol"].as_str().unwrap_or("");
            let proto_rank = if proto == "https" || proto == "http" { 0 } else { 1 };
            let vcodec = f["vcodec"].as_str().unwrap_or("");
            let codec_rank = if vcodec.starts_with("avc1") || vcodec.starts_with("h264") { 0 } else { 1 };
            let dist = f["height"]
                .as_i64()
                .map(|h| (h - 360).unsigned_abs())
                .unwrap_or(1000);
            (proto_rank, codec_rank, dist)
        });

    if let Some(f) = best {
        let mut headers = headers_of(f);
        if headers.is_empty() {
            headers = headers_of(v);
        }
        return Some(PreviewSource {
            url: f["url"].as_str()?.to_string(),
            headers,
        });
    }

    // Страница с единственным файлом без списка форматов.
    let url = v["url"].as_str()?;
    if v["vcodec"].as_str() == Some("none") {
        return None;
    }
    Some(PreviewSource {
        url: url.to_string(),
        headers: headers_of(v),
    })
}

/// Самая подробная раскадровка, если сайт её даёт (YouTube).
pub fn pick_storyboard(v: &Value) -> Option<Storyboard> {
    let formats = v["formats"].as_array()?;
    formats
        .iter()
        .filter(|f| f["format_note"].as_str() == Some("storyboard") || f["protocol"].as_str() == Some("mhtml"))
        .filter_map(|f| {
            let fps = f["fps"].as_f64().filter(|x| *x > 0.0)?;
            let fragments: Vec<StoryboardFragment> = f["fragments"]
                .as_array()?
                .iter()
                .filter_map(|fr| {
                    Some(StoryboardFragment {
                        url: fr["url"].as_str()?.to_string(),
                        duration: fr["duration"].as_f64().unwrap_or(0.0),
                    })
                })
                .collect();
            if fragments.is_empty() {
                return None;
            }
            Some(Storyboard {
                width: f["width"].as_u64()?,
                height: f["height"].as_u64()?,
                rows: f["rows"].as_u64().unwrap_or(1).max(1),
                columns: f["columns"].as_u64().unwrap_or(1).max(1),
                tile_duration: 1.0 / fps,
                fragments,
            })
        })
        .max_by_key(|s| s.width)
}

pub fn remember(app: &AppHandle, keys: &[&str], src: PreviewSource) {
    let state = app.state::<AppState>();
    if let Ok(mut map) = state.previews.lock() {
        for k in keys {
            if !k.is_empty() {
                map.insert(k.to_string(), src.clone());
            }
        }
    }
}

fn cached(app: &AppHandle, url: &str) -> Option<PreviewSource> {
    app.state::<AppState>()
        .previews
        .lock()
        .ok()
        .and_then(|m| m.get(url).cloned())
}

/// Где искать кадр.
#[derive(Clone, Copy)]
enum Seek {
    /// Точный кадр на этом моменте.
    At(f64),
    /// Последний кадр видео (когда запрошенный момент оказался за концом потока).
    Last,
}

/// Ok(пусто) — ffmpeg отработал, но кадра нет: момент за концом потока.
async fn run_ffmpeg(
    app: &AppHandle,
    src: &PreviewSource,
    seek: Seek,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<Vec<u8>, String> {
    let tools = deps::locate(app)?;
    let mut cmd = Command::new(&tools.ffmpeg);
    hide_console(&mut cmd);
    cmd.kill_on_drop(true);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    let vf = match seek {
        // -ss до -i: быстрый переход к ближайшему ключевому кадру, затем
        // ffmpeg декодирует до нужного момента, так что кадр точный.
        Seek::At(t) => {
            cmd.arg("-ss").arg(format!("{:.4}", t.max(0.0)));
            "scale=-2:240"
        }
        // Декодируем последние полторы секунды и разворачиваем: первым
        // выходит последний кадр.
        Seek::Last => {
            cmd.args(["-sseof", "-1.5"]);
            "reverse,scale=-2:240"
        }
    };
    if !src.headers.is_empty() {
        let joined: String = src
            .headers
            .iter()
            .map(|(k, v)| format!("{k}: {v}\r\n"))
            .collect();
        cmd.arg("-headers").arg(joined);
    }
    cmd.arg("-i").arg(&src.url);
    cmd.args([
        "-frames:v",
        "1",
        "-an",
        "-vf",
        vf,
        "-q:v",
        "4",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());

    let output = tokio::select! {
        out = tokio::time::timeout(Duration::from_secs(25), cmd.output()) => out
            .map_err(|_| "Сайт слишком долго отдаёт кадр".to_string())?
            .map_err(|e| format!("Не удалось запустить ffmpeg: {e}"))?,
        _ = &mut *cancel => return Err(CANCELLED.into()),
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let line = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("нет данных");
        return Err(format!("ffmpeg: {}", line.trim()));
    }
    Ok(output.stdout)
}

/// Кадр на моменте, а если момент за концом потока — последний кадр.
async fn frame_or_last(
    app: &AppHandle,
    src: &PreviewSource,
    seconds: f64,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<Vec<u8>, String> {
    let bytes = run_ffmpeg(app, src, Seek::At(seconds), cancel).await?;
    if !bytes.is_empty() {
        return Ok(bytes);
    }
    let last = run_ffmpeg(app, src, Seek::Last, cancel).await?;
    if last.is_empty() {
        return Err("ffmpeg не вернул кадр".into());
    }
    Ok(last)
}

pub const CANCELLED: &str = "__CANCELLED__";

/// Достать кадр на моменте `seconds`. `slot` ("in"/"out") — новый запрос в том же
/// слоте прерывает предыдущий, чтобы при быстром перемещении не копились процессы.
pub async fn grab_frame(app: &AppHandle, url: &str, seconds: f64, slot: &str) -> Result<String, String> {
    let (tx, mut rx) = oneshot::channel();
    {
        let state = app.state::<AppState>();
        let mut jobs = state.frame_jobs.lock().map_err(|_| "Внутренняя ошибка")?;
        if let Some(prev) = jobs.insert(slot.to_string(), tx) {
            let _ = prev.send(());
        }
    }

    let mut src = match cached(app, url) {
        Some(s) => s,
        None => {
            ytdlp::fetch_info(app, url).await?;
            cached(app, url).ok_or("У этого видео нет потока для предпросмотра")?
        }
    };

    let bytes = match frame_or_last(app, &src, seconds, &mut rx).await {
        Ok(b) => b,
        Err(e) if e == CANCELLED => return Err(e),
        Err(_) => {
            // Ссылки на потоки со временем протухают: получаем свежие и пробуем ещё раз.
            ytdlp::fetch_info(app, url).await?;
            src = cached(app, url).ok_or("У этого видео нет потока для предпросмотра")?;
            frame_or_last(app, &src, seconds, &mut rx).await?
        }
    };

    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
