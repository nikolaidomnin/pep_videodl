use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// Папка по умолчанию для загрузок.
    pub download_dir: String,
    /// Галка «Скачивать в папку по умолчанию».
    pub use_default_dir: bool,
    /// Глобальная горячая клавиша, например "Ctrl+Alt+D".
    pub hotkey: String,
    /// Формат, выбранный сразу после вставки ссылки.
    pub default_format: String,
    /// "best" или высота в пикселях ("1080").
    pub default_quality: String,
    /// Unix-время последней проверки обновления yt-dlp.
    pub last_ytdlp_update_check: u64,
    /// Если ссылка ведёт на плейлист, сразу включать режим плейлиста.
    pub playlist_by_default: bool,
    /// Тема оформления: "builtin:default" или "user:<папка>".
    pub theme: String,
    /// Проигрывать видеофон темы (если выключено — только статичная картинка).
    pub animated_background: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let download_dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            download_dir: download_dir.to_string_lossy().into_owned(),
            use_default_dir: true,
            hotkey: "Ctrl+Alt+D".into(),
            default_format: "mp4".into(),
            default_quality: "best".into(),
            last_ytdlp_update_check: 0,
            playlist_by_default: false,
            theme: "builtin:default".into(),
            animated_background: true,
        }
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("Не удалось определить папку настроек")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
