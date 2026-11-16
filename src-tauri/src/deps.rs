//! Поиск и загрузка внешних инструментов: yt-dlp, ffmpeg, deno.
//! Инструменты лежат в `%APPDATA%\<app>\bin`; если их нет там и нет в PATH,
//! они скачиваются при первом запуске с прогрессом (событие `deps-progress`).

use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::settings;

const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const DENO_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
const FFMPEG_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

const UPDATE_INTERVAL_SECS: u64 = 24 * 60 * 60;

#[derive(Clone, Serialize)]
pub struct DepProgress {
    pub name: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    /// "downloading" | "extracting" | "done"
    pub phase: String,
}

#[derive(Clone, Serialize)]
pub struct DepsStatus {
    pub ytdlp: String,
    pub ffmpeg: String,
    pub deno: Option<String>,
}

/// Найденные пути к инструментам.
pub struct Tools {
    pub ytdlp: PathBuf,
    pub ffmpeg: PathBuf,
    pub bin_dir: PathBuf,
}

pub fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("bin"))
        .map_err(|e| e.to_string())
}

fn find_tool(bin: &Path, name: &str) -> Option<PathBuf> {
    let local = bin.join(format!("{name}.exe"));
    if local.exists() {
        return Some(local);
    }
    which::which(name).ok()
}

/// Найти инструменты без скачивания. Ошибка, если чего-то нет.
pub fn locate(app: &AppHandle) -> Result<Tools, String> {
    let bin = bin_dir(app)?;
    let ytdlp = find_tool(&bin, "yt-dlp").ok_or("yt-dlp не найден. Перезапустите приложение.")?;
    let ffmpeg = find_tool(&bin, "ffmpeg").ok_or("ffmpeg не найден. Перезапустите приложение.")?;
    Ok(Tools {
        ytdlp,
        ffmpeg,
        bin_dir: bin,
    })
}

/// Убедиться, что все инструменты на месте, при необходимости скачать.
pub async fn ensure(app: &AppHandle) -> Result<DepsStatus, String> {
    let bin = bin_dir(app)?;
    tokio::fs::create_dir_all(&bin)
        .await
        .map_err(|e| format!("Не удалось создать {}: {e}", bin.display()))?;

    if find_tool(&bin, "yt-dlp").is_none() {
        download(app, "yt-dlp", YTDLP_URL, &bin.join("yt-dlp.exe")).await?;
    }

    if find_tool(&bin, "deno").is_none() {
        let zip = bin.join("deno.zip");
        download(app, "deno", DENO_URL, &zip).await?;
        extract(app, "deno", &zip, &bin, &["deno.exe"]).await?;
        let _ = tokio::fs::remove_file(&zip).await;
    }

    if find_tool(&bin, "ffmpeg").is_none() {
        let zip = bin.join("ffmpeg.zip");
        download(app, "ffmpeg", FFMPEG_URL, &zip).await?;
        extract(app, "ffmpeg", &zip, &bin, &["ffmpeg.exe", "ffprobe.exe"]).await?;
        let _ = tokio::fs::remove_file(&zip).await;
    }

    let tools = locate(app)?;
    maybe_update_ytdlp(app, &tools);

    Ok(DepsStatus {
        ytdlp: tools.ytdlp.to_string_lossy().into_owned(),
        ffmpeg: tools.ffmpeg.to_string_lossy().into_owned(),
        deno: find_tool(&bin, "deno").map(|p| p.to_string_lossy().into_owned()),
    })
}

fn emit(app: &AppHandle, name: &str, downloaded: u64, total: Option<u64>, phase: &str) {
    let _ = app.emit(
        "deps-progress",
        DepProgress {
            name: name.into(),
            downloaded,
            total,
            phase: phase.into(),
        },
    );
}

async fn download(app: &AppHandle, name: &str, url: &str, dest: &Path) -> Result<(), String> {
    emit(app, name, 0, None, "downloading");

    let client = reqwest::Client::builder()
        .user_agent("videodl")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Не удалось скачать {name}: {e}"))?;

    let total = resp.content_length();
    let tmp = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Обрыв загрузки {name}: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(100) {
            emit(app, name, downloaded, total, "downloading");
            last = Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    tokio::fs::rename(&tmp, dest)
        .await
        .map_err(|e| e.to_string())?;
    emit(app, name, downloaded, total, "done");
    Ok(())
}

/// Достать из архива файлы с указанными именами (без учёта вложенных папок).
async fn extract(
    app: &AppHandle,
    name: &str,
    zip_path: &Path,
    dest_dir: &Path,
    wanted: &[&str],
) -> Result<(), String> {
    emit(app, name, 0, None, "extracting");
    let zip_path = zip_path.to_path_buf();
    let dest_dir = dest_dir.to_path_buf();
    let wanted: Vec<String> = wanted.iter().map(|s| s.to_string()).collect();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let mut found = 0;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            if entry.is_dir() {
                continue;
            }
            let file_name = Path::new(entry.name())
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if wanted.iter().any(|w| w.eq_ignore_ascii_case(&file_name)) {
                let out_path = dest_dir.join(&file_name);
                let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                found += 1;
            }
        }
        if found == 0 {
            return Err(format!("В архиве {} не нашлось нужных файлов", zip_path.display()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    emit(app, name, 0, None, "done");
    Ok(())
}

/// Раз в сутки запускать `yt-dlp -U` в фоне (только для нашей копии в bin).
fn maybe_update_ytdlp(app: &AppHandle, tools: &Tools) {
    if !tools.ytdlp.starts_with(&tools.bin_dir) {
        return;
    }
    let mut s = settings::load(app);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if now.saturating_sub(s.last_ytdlp_update_check) < UPDATE_INTERVAL_SECS {
        return;
    }
    s.last_ytdlp_update_check = now;
    let _ = settings::save(app, &s);

    let ytdlp = tools.ytdlp.clone();
    tauri::async_runtime::spawn(async move {
        let mut cmd = tokio::process::Command::new(&ytdlp);
        cmd.arg("-U");
        crate::ytdlp::hide_console(&mut cmd);
        let _ = cmd.output().await;
    });
}
