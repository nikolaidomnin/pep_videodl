//! Обёртка над yt-dlp: получение информации о видео и скачивание с прогрессом.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

use crate::deps::{self, Tools};
use crate::AppState;

const AUDIO_FORMATS: &[&str] = &["mp3", "m4a", "opus", "flac", "wav"];

#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
pub fn hide_console(_cmd: &mut Command) {}

// ---------- Информация о видео ----------

#[derive(Serialize, Clone)]
pub struct HeightOpt {
    pub height: u64,
    pub fps: u64,
    pub size: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct AudioOpt {
    pub abr: u64,
    pub size: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct VideoInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub webpage_url: String,
    pub extractor: String,
    /// Кадров в секунду (для покадровой обрезки); None, если неизвестно.
    pub fps: Option<f64>,
    /// Раскадровка для мгновенных миниатюр при перетаскивании (если есть).
    pub storyboard: Option<crate::preview::Storyboard>,
    pub heights: Vec<HeightOpt>,
    pub audio_bitrates: Vec<AudioOpt>,
}

fn base_cmd(tools: &Tools) -> Command {
    let mut cmd = Command::new(&tools.ytdlp);
    hide_console(&mut cmd);

    // Папка с инструментами идёт первой в PATH: там может лежать deno.
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("{};{}", tools.bin_dir.display(), path));

    let ffmpeg_dir = tools
        .ffmpeg
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| tools.ffmpeg.clone());
    cmd.args(["--encoding", "utf-8"])
        .arg("--ffmpeg-location")
        .arg(ffmpeg_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd
}

/// Вытащить понятное сообщение из stderr yt-dlp.
fn clean_error(stderr: &str) -> String {
    let errors: Vec<&str> = stderr
        .lines()
        .filter_map(|l| l.trim().strip_prefix("ERROR:"))
        .map(|l| l.trim())
        .collect();
    if let Some(last) = errors.last() {
        let msg = last.to_string();
        // Убираем префикс вида "[youtube] abc123: "
        if let Some(idx) = msg.find("]: ") {
            if msg.starts_with('[') {
                return msg[idx + 3..].to_string();
            }
        }
        if let Some(idx) = msg.find(": ") {
            if msg.starts_with('[') {
                return msg[idx + 2..].to_string();
            }
        }
        return msg;
    }
    stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("Неизвестная ошибка yt-dlp")
        .trim()
        .to_string()
}

pub async fn fetch_info(app: &AppHandle, url: &str) -> Result<VideoInfo, String> {
    let tools = deps::locate(app)?;
    let mut cmd = base_cmd(&tools);
    cmd.args(["--no-playlist", "-J", "--no-warnings"]).arg(url);

    let output = tokio::time::timeout(Duration::from_secs(90), cmd.output())
        .await
        .map_err(|_| "Сервис не ответил за 90 секунд".to_string())?
        .map_err(|e| format!("Не удалось запустить yt-dlp: {e}"))?;

    if !output.status.success() {
        return Err(clean_error(&String::from_utf8_lossy(&output.stderr)));
    }

    let v: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Не удалось разобрать ответ yt-dlp: {e}"))?;

    if v["_type"].as_str() == Some("playlist") {
        // Фронтенд по этому маркеру переключается в режим плейлиста.
        return Err("__PLAYLIST__".into());
    }

    let info = parse_info(&v);
    if let Some(src) = crate::preview::pick_source(&v) {
        crate::preview::remember(app, &[url, &info.webpage_url], src);
    }
    Ok(info)
}

// ---------- Плейлист ----------

#[derive(Serialize, Clone)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub url: String,
    /// Порядковый номер в плейлисте (с 1), для `--playlist-items`.
    pub index: u64,
    /// true, если у элемента есть собственная страница (YouTube и т. п.),
    /// и его можно качать по `url` напрямую. Иначе качаем по номеру в плейлисте.
    pub standalone: bool,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PlaylistInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub webpage_url: String,
    pub entries: Vec<PlaylistEntry>,
}

pub async fn fetch_playlist(app: &AppHandle, url: &str) -> Result<PlaylistInfo, String> {
    let tools = deps::locate(app)?;
    let mut cmd = Command::new(&tools.ytdlp);
    hide_console(&mut cmd);
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("{};{}", tools.bin_dir.display(), path));
    cmd.args([
        "--encoding",
        "utf-8",
        "--yes-playlist",
        "--flat-playlist",
        "-J",
        "--no-warnings",
    ])
    .arg(url)
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

    let output = tokio::time::timeout(Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| "Сервис не ответил за 120 секунд".to_string())?
        .map_err(|e| format!("Не удалось запустить yt-dlp: {e}"))?;

    if !output.status.success() {
        return Err(clean_error(&String::from_utf8_lossy(&output.stderr)));
    }

    let v: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Не удалось разобрать ответ yt-dlp: {e}"))?;

    if v["_type"].as_str() != Some("playlist") {
        return Err("По этой ссылке нет плейлиста".into());
    }

    let entries = v["entries"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|e| !e.is_null())
        .enumerate()
        .map(|(i, e)| {
            let thumbnail = e["thumbnails"]
                .as_array()
                .and_then(|t| t.last())
                .and_then(|t| t["url"].as_str())
                .or_else(|| e["thumbnail"].as_str())
                .map(String::from);
            // Элемент flat-плейлиста с типом "url" и своим экстрактором (YouTube,
            // Vimeo…) можно качать по ссылке. Generic-экстрактор отдаёт
            // прямые ссылки на медиа, которые без referer дают 403: такие
            // элементы качаем по номеру через ссылку на сам плейлист.
            let ie_key = e["ie_key"].as_str().unwrap_or("");
            let standalone = e["_type"].as_str() == Some("url")
                && !ie_key.is_empty()
                && !ie_key.eq_ignore_ascii_case("generic");
            PlaylistEntry {
                id: e["id"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| format!("entry-{i}")),
                title: e["title"].as_str().unwrap_or("Без названия").to_string(),
                url: if standalone {
                    e["url"].as_str().unwrap_or_default().to_string()
                } else {
                    e["webpage_url"]
                        .as_str()
                        .or_else(|| e["url"].as_str())
                        .unwrap_or_default()
                        .to_string()
                },
                index: i as u64 + 1,
                standalone,
                duration: e["duration"].as_f64(),
                uploader: e["uploader"]
                    .as_str()
                    .or_else(|| e["channel"].as_str())
                    .map(String::from),
                thumbnail,
            }
        })
        .filter(|e| !e.url.is_empty())
        .collect();

    Ok(PlaylistInfo {
        title: v["title"].as_str().unwrap_or("Плейлист").to_string(),
        uploader: v["uploader"]
            .as_str()
            .or_else(|| v["channel"].as_str())
            .map(String::from),
        webpage_url: v["webpage_url"].as_str().unwrap_or(url).to_string(),
        entries,
    })
}

fn parse_info(v: &Value) -> VideoInfo {
    let formats = v["formats"].as_array().cloned().unwrap_or_default();

    // height -> (max fps, max size)
    let mut by_height: BTreeMap<u64, (u64, Option<u64>)> = BTreeMap::new();
    // abr -> size
    let mut audio: BTreeMap<u64, Option<u64>> = BTreeMap::new();
    let mut best_audio: (f64, Option<u64>) = (0.0, None);
    let mut max_fps: f64 = 0.0;

    for f in &formats {
        if let Some(fps) = f["fps"].as_f64() {
            max_fps = max_fps.max(fps);
        }
        let vcodec = f["vcodec"].as_str().unwrap_or("none");
        let acodec = f["acodec"].as_str().unwrap_or("none");
        let size = f["filesize"]
            .as_u64()
            .or_else(|| f["filesize_approx"].as_u64());
        let has_video = vcodec != "none";
        let has_audio = acodec != "none";

        if has_video {
            if let Some(h) = f["height"].as_u64() {
                let fps = f["fps"].as_f64().unwrap_or(0.0).round() as u64;
                let entry = by_height.entry(h).or_insert((0, None));
                entry.0 = entry.0.max(fps);
                entry.1 = match (entry.1, size) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (a, b) => a.or(b),
                };
            }
        } else if has_audio {
            let abr = f["abr"].as_f64().unwrap_or(0.0);
            if abr > 0.0 {
                audio.entry(abr.round() as u64).or_insert(size);
                if abr > best_audio.0 {
                    best_audio = (abr, size);
                }
            }
        }
    }

    let heights = by_height
        .into_iter()
        .rev()
        .map(|(height, (fps, size))| HeightOpt {
            height,
            fps,
            size: match (size, best_audio.1) {
                (Some(v), Some(a)) => Some(v + a),
                (v, _) => v,
            },
        })
        .collect();

    let audio_bitrates = audio
        .into_iter()
        .rev()
        .map(|(abr, size)| AudioOpt { abr, size })
        .collect();

    VideoInfo {
        title: v["title"].as_str().unwrap_or("Без названия").to_string(),
        uploader: v["uploader"]
            .as_str()
            .or_else(|| v["channel"].as_str())
            .map(String::from),
        duration: v["duration"].as_f64(),
        thumbnail: v["thumbnail"].as_str().map(String::from),
        webpage_url: v["webpage_url"]
            .as_str()
            .or_else(|| v["original_url"].as_str())
            .unwrap_or_default()
            .to_string(),
        extractor: v["extractor_key"]
            .as_str()
            .or_else(|| v["extractor"].as_str())
            .unwrap_or_default()
            .to_string(),
        fps: v["fps"]
            .as_f64()
            .filter(|f| *f > 0.0)
            .or((max_fps > 0.0).then_some(max_fps)),
        storyboard: crate::preview::pick_storyboard(v),
        heights,
        audio_bitrates,
    }
}

// ---------- Скачивание ----------

#[derive(Deserialize, Clone, Debug)]
pub struct DownloadRequest {
    pub url: String,
    /// mp4 | mkv | webm | mp3 | m4a | opus | flac | wav
    pub format: String,
    /// "best", высота ("1080") для видео или битрейт ("192") для аудио
    pub quality: String,
    /// Папка, если качаем «в папку по умолчанию»
    pub output_dir: Option<String>,
    /// Полный путь из диалога «Сохранить как»
    pub output_path: Option<String>,
    /// Если задано, качаем элемент №playlist_index из плейлиста playlist_url,
    /// а не по `url` напрямую (нужно для сайтов, где у элементов нет своей страницы).
    pub playlist_url: Option<String>,
    pub playlist_index: Option<u64>,
    /// Обрезка: начало и конец фрагмента в секундах.
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    /// Подпись фрагмента для имени файла (таймкоды из интерфейса).
    pub trim_label: Option<String>,
}

impl DownloadRequest {
    fn trim(&self) -> Option<(f64, f64)> {
        match (self.trim_start, self.trim_end) {
            (Some(s), Some(e)) if s >= 0.0 && e > s => Some((s, e)),
            _ => None,
        }
    }
}

/// Время для имени файла, без двоеточий: 75.5 -> "1-15.500", 3725 -> "1-02-05".
fn filename_time(secs: f64) -> String {
    let total_ms = (secs * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let s = total_ms / 1000;
    let (h, m, s) = (s / 3600, (s % 3600) / 60, s % 60);
    let base = if h > 0 {
        format!("{h}-{m:02}-{s:02}")
    } else {
        format!("{m}-{s:02}")
    };
    if ms > 0 { format!("{base}.{ms:03}") } else { base }
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub id: u64,
    /// queued | starting | downloading | processing | done | error | cancelled
    pub phase: String,
    pub percent: f64,
    pub speed: String,
    pub eta: String,
    pub message: String,
    pub filepath: Option<String>,
}

enum DlError {
    Cancelled,
    Failed(String),
}

fn emit_progress(app: &AppHandle, p: Progress) {
    let _ = app.emit("download-progress", p);
}

fn progress(id: u64, phase: &str) -> Progress {
    Progress {
        id,
        phase: phase.into(),
        percent: 0.0,
        speed: String::new(),
        eta: String::new(),
        message: String::new(),
        filepath: None,
    }
}

fn build_args(req: &DownloadRequest, cmd: &mut Command) -> Result<(), String> {
    let fmt = req.format.to_lowercase();
    let is_audio = AUDIO_FORMATS.contains(&fmt.as_str());

    cmd.args([
        "--newline",
        "--no-quiet",
        "--progress",
        "--no-warnings",
        "--progress-template",
        "download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        "--print",
        "after_move:FINALPATH|%(filepath)s",
    ]);

    if is_audio {
        let quality = if req.quality == "best" {
            "0".to_string()
        } else {
            format!("{}K", req.quality)
        };
        cmd.args(["-f", "ba/b", "-x", "--audio-format", &fmt, "--audio-quality", &quality]);
        if fmt != "wav" {
            cmd.args(["--embed-metadata", "--embed-thumbnail"]);
        }
    } else {
        let res = if req.quality == "best" {
            "res".to_string()
        } else {
            format!("res:{}", req.quality)
        };
        let sort = match fmt.as_str() {
            "mp4" => format!("{res},vcodec:h264,acodec:aac,ext:mp4:m4a"),
            "webm" => format!("{res},vcodec:vp9,acodec:opus,ext:webm:webm"),
            _ => format!("{res},ext"),
        };
        cmd.args(["-f", "bv*+ba/b", "-S", &sort, "--merge-output-format", &fmt]);
    }

    let trim = req.trim();
    if let Some((s, e)) = trim {
        // Скачиваем только фрагмент; ключевые кадры на границах дают
        // покадрово точный рез (фрагмент при этом перекодируется).
        cmd.args([
            "--download-sections",
            &format!("*{s:.3}-{e:.3}"),
            "--force-keyframes-at-cuts",
        ]);
    }

    let template = if let Some(path) = &req.output_path {
        let stem = Path::new(path).with_extension("");
        cmd.arg("--force-overwrites");
        format!("{}.%(ext)s", stem.display())
    } else {
        let dir = req
            .output_dir
            .as_deref()
            .ok_or("Не указана папка для сохранения")?;
        let suffix = trim
            .map(|(s, e)| {
                let label = req
                    .trim_label
                    .as_deref()
                    .map(|l| l.replace([':', '/', '\\', '*', '?', '"', '<', '>', '|'], "-"))
                    .filter(|l| !l.trim().is_empty())
                    .unwrap_or_else(|| format!("{}–{}", filename_time(s), filename_time(e)));
                format!(" (фрагмент {label})")
            })
            .unwrap_or_default();
        format!(
            "{}",
            Path::new(dir)
                .join(format!("%(title)s{suffix}.%(ext)s"))
                .display()
        )
    };
    cmd.arg("-o").arg(template);

    match (&req.playlist_url, req.playlist_index) {
        (Some(playlist_url), Some(index)) => {
            cmd.args(["--yes-playlist", "--playlist-items", &index.to_string()]);
            cmd.arg(playlist_url);
        }
        _ => {
            cmd.arg("--no-playlist");
            cmd.arg(&req.url);
        }
    }
    Ok(())
}

const PROCESSING_TAGS: &[&str] = &[
    "[Merger]",
    "[ExtractAudio]",
    "[VideoConvertor]",
    "[VideoRemuxer]",
    "[Metadata]",
    "[EmbedThumbnail]",
    "[ThumbnailsConvertor]",
    "[FixupM3u8]",
    "[FixupM4a]",
    "[Fixup",
];

fn processing_message(tag_line: &str) -> &'static str {
    if tag_line.starts_with("[Merger]") || tag_line.starts_with("[VideoRemuxer]") {
        "Склейка видео и аудио"
    } else if tag_line.starts_with("[ExtractAudio]") {
        "Извлечение аудио"
    } else if tag_line.starts_with("[VideoConvertor]") {
        "Конвертация"
    } else if tag_line.starts_with("[EmbedThumbnail]") || tag_line.starts_with("[ThumbnailsConvertor]") {
        "Добавление обложки"
    } else if tag_line.starts_with("[Metadata]") {
        "Запись метаданных"
    } else {
        "Обработка"
    }
}

#[cfg(windows)]
async fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
    hide_console(&mut cmd);
    let _ = cmd.output().await;
}

async fn run_inner(
    app: &AppHandle,
    id: u64,
    req: &DownloadRequest,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<String, DlError> {
    let tools = deps::locate(app).map_err(DlError::Failed)?;
    let mut cmd = base_cmd(&tools);
    build_args(req, &mut cmd).map_err(DlError::Failed)?;

    let mut child = cmd
        .spawn()
        .map_err(|e| DlError::Failed(format!("Не удалось запустить yt-dlp: {e}")))?;
    let pid = child.id();

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // stderr читаем отдельно, чтобы собрать текст ошибки.
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    });

    if req.trim().is_some() {
        // При обрезке качает ffmpeg, и процентов прогресса может не быть.
        let mut p = progress(id, "processing");
        p.message = "Скачиваю фрагмент".into();
        emit_progress(app, p);
    }

    let mut lines = BufReader::new(stdout).lines();
    let mut filepath: Option<String> = None;
    let mut last_emit = Instant::now();
    let mut last_percent = 0.0;

    loop {
        tokio::select! {
            _ = &mut *cancel => {
                #[cfg(windows)]
                if let Some(pid) = pid { kill_tree(pid).await; }
                let _ = child.kill().await;
                return Err(DlError::Cancelled);
            }
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                let line = line.trim();

                if let Some(rest) = line.strip_prefix("PROG|") {
                    let mut parts = rest.split('|');
                    let percent = parts
                        .next()
                        .and_then(|p| p.trim().trim_end_matches('%').parse::<f64>().ok())
                        .unwrap_or(last_percent);
                    let speed = parts.next().unwrap_or("").trim();
                    let eta = parts.next().unwrap_or("").trim();
                    last_percent = percent;
                    if last_emit.elapsed() > Duration::from_millis(150) || percent >= 100.0 {
                        let mut p = progress(id, "downloading");
                        p.percent = percent;
                        p.speed = if speed.eq_ignore_ascii_case("unknown") { String::new() } else { speed.into() };
                        p.eta = if eta.eq_ignore_ascii_case("unknown") { String::new() } else { eta.into() };
                        emit_progress(app, p);
                        last_emit = Instant::now();
                    }
                } else if let Some(path) = line.strip_prefix("FINALPATH|") {
                    filepath = Some(path.trim().to_string());
                } else if PROCESSING_TAGS.iter().any(|t| line.starts_with(t)) {
                    let mut p = progress(id, "processing");
                    p.percent = 100.0;
                    p.message = processing_message(line).into();
                    emit_progress(app, p);
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| DlError::Failed(e.to_string()))?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(DlError::Failed(clean_error(&stderr_text)));
    }
    filepath.ok_or_else(|| {
        DlError::Failed("yt-dlp завершился, но не сообщил путь к файлу".to_string())
    })
}

pub async fn run_download(
    app: AppHandle,
    id: u64,
    req: DownloadRequest,
    mut cancel: oneshot::Receiver<()>,
) {
    emit_progress(&app, progress(id, "queued"));

    // Ждём свободный слот, но отмену из очереди обрабатываем сразу.
    let semaphore = app.state::<AppState>().semaphore.clone();
    let permit = tokio::select! {
        p = semaphore.acquire_owned() => p,
        _ = &mut cancel => {
            emit_progress(&app, progress(id, "cancelled"));
            if let Ok(mut jobs) = app.state::<AppState>().jobs.lock() {
                jobs.remove(&id);
            }
            return;
        }
    };
    let Ok(_permit) = permit else { return };

    emit_progress(&app, progress(id, "starting"));

    match run_inner(&app, id, &req, &mut cancel).await {
        Ok(path) => {
            let mut p = progress(id, "done");
            p.percent = 100.0;
            p.filepath = Some(path);
            emit_progress(&app, p);
        }
        Err(DlError::Cancelled) => emit_progress(&app, progress(id, "cancelled")),
        Err(DlError::Failed(msg)) => {
            let mut p = progress(id, "error");
            p.message = msg;
            emit_progress(&app, p);
        }
    }

    let state = app.state::<AppState>();
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(&id);
    }
}
