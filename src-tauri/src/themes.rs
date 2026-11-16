//! Пользовательские темы: папки в %APPDATA%\com.nikol.videodl\themes\<id>\
//! с файлом theme.json и медиа (png / webp / svg / webm) рядом.
//! Тема — это только данные: JSON и картинки/видео, никакого кода.
//! Новые темы скачиваются из каталога в репозитории (index.json + архивы).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MANIFEST: &str = "theme.json";
/// Защита от случайно выбранного огромного архива или папки.
const MAX_THEME_BYTES: u64 = 100 * 1024 * 1024;
const ALLOWED_EXT: &[&str] = &["json", "png", "webp", "jpg", "jpeg", "svg", "webm", "gif", "txt", "md"];

#[derive(Serialize)]
pub struct UserTheme {
    /// Имя папки, оно же идентификатор (в настройках: "user:<id>").
    pub id: String,
    /// Абсолютный путь к папке темы.
    pub dir: String,
    /// Содержимое theme.json; проверяет его фронтенд.
    pub manifest: Option<serde_json::Value>,
    /// Почему тему не удалось прочитать.
    pub error: Option<String>,
    /// Версия из каталога, если тема скачана оттуда.
    pub catalog_version: Option<u64>,
}

pub fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("themes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn list(app: &AppHandle) -> Result<Vec<UserTheme>, String> {
    let dir = themes_dir(app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') {
            continue;
        }
        let catalog_version = fs::read(path.join(SOURCE_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v.get("version").and_then(|n| n.as_u64()));
        let (manifest, error) = match fs::read(path.join(MANIFEST)) {
            Err(_) => (None, Some(format!("Нет файла {MANIFEST}"))),
            Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(v) if v.is_object() => (Some(v), None),
                Ok(_) => (None, Some(format!("{MANIFEST}: ожидался объект"))),
                Err(e) => (None, Some(format!("{MANIFEST}: {e}"))),
            },
        };
        out.push(UserTheme {
            id,
            dir: path.to_string_lossy().into_owned(),
            manifest,
            error,
            catalog_version,
        });
    }
    out.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    Ok(out)
}

/// Откуда берётся каталог тем: index.json и архивы тем лежат в репозитории.
/// Для проверки можно подменить через переменную окружения VIDEODL_THEMES_URL.
const CATALOG_BASE: &str = "https://raw.githubusercontent.com/nikolaidomnin/videodl-themes/main/";
/// Файл в папке темы с версией из каталога (чтобы показывать «Обновить»).
const SOURCE_FILE: &str = ".catalog.json";

fn catalog_base() -> String {
    let base = std::env::var("VIDEODL_THEMES_URL").unwrap_or_else(|_| CATALOG_BASE.to_string());
    if base.ends_with('/') { base } else { format!("{base}/") }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CatalogTheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "one")]
    pub version: u64,
    /// Путь к архиву относительно корня каталога.
    pub zip: String,
}

fn one() -> u64 {
    1
}

#[derive(Deserialize)]
struct CatalogIndex {
    themes: Vec<CatalogTheme>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("videodl")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub async fn catalog() -> Result<Vec<CatalogTheme>, String> {
    let url = format!("{}index.json", catalog_base());
    let resp = client()?
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Не удалось загрузить каталог тем: {e}"))?;
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Не удалось загрузить каталог тем: {e}"))?;
    let index: CatalogIndex =
        serde_json::from_slice(&body).map_err(|e| format!("Каталог тем повреждён: {e}"))?;
    Ok(index
        .themes
        .into_iter()
        .filter(|t| valid_id(&t.id) && !t.zip.contains("..") && !t.zip.starts_with('/'))
        .collect())
}

/// Скачивает тему из каталога в папку тем (заменяя старую версию). Возвращает id.
pub async fn install(app: &AppHandle, id: &str) -> Result<String, String> {
    let entry = catalog()
        .await?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or("Такой темы нет в каталоге")?;
    let root = themes_dir(app)?;
    let url = format!("{}{}", catalog_base(), entry.zip);
    let mut resp = client()?
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Не удалось скачать тему: {e}"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Обрыв загрузки темы: {e}"))? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > MAX_THEME_BYTES {
            return Err("Тема больше 100 МБ".into());
        }
    }

    let tmp = root.join(format!(".download-{id}"));
    let _ = fs::remove_dir_all(&tmp);
    let res = extract_zip(std::io::Cursor::new(bytes), &tmp).and_then(|_| {
        let source = serde_json::json!({ "id": entry.id, "version": entry.version });
        fs::write(tmp.join(SOURCE_FILE), source.to_string()).map_err(|e| e.to_string())?;
        let target = root.join(id);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|e| format!("Не удалось заменить старую версию темы: {e}"))?;
        }
        fs::rename(&tmp, &target).map_err(|e| e.to_string())
    });
    if let Err(e) = res {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    Ok(id.to_string())
}

/// Удаляет папку темы. id — имя папки внутри папки тем.
pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    if id.is_empty() || id.starts_with('.') || id.contains(['/', '\\', ':']) || id.contains("..") {
        return Err("Неверное имя темы".into());
    }
    let root = themes_dir(app)?;
    let dir = root.join(id);
    if !dir.is_dir() || dir.parent() != Some(root.as_path()) {
        return Err("Такой темы нет".into());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить тему: {e}"))
}

/// Распаковывает архив темы в `target`. theme.json может лежать в корне архива
/// или в единственной вложенной папке.
fn extract_zip<R: Read + std::io::Seek>(reader: R, target: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("Не удалось открыть архив темы: {e}"))?;

    let mut prefix: Option<PathBuf> = None;
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        if let Some(p) = f.enclosed_name() {
            if p.file_name().map(|n| n == MANIFEST).unwrap_or(false) && p.components().count() <= 2 {
                let parent = p.parent().map(Path::to_path_buf).unwrap_or_default();
                if prefix.as_ref().map(|q| parent.components().count() < q.components().count()).unwrap_or(true) {
                    prefix = Some(parent);
                }
            }
        }
    }
    let prefix = prefix.ok_or(format!("В архиве нет файла {MANIFEST}"))?;

    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(p) = f.enclosed_name() else { continue };
        let Ok(rel) = p.strip_prefix(&prefix) else { continue };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let out = target.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if !allowed(rel) {
            continue;
        }
        total += f.size();
        if total > MAX_THEME_BYTES {
            return Err("Тема больше 100 МБ".into());
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&out, buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXT.iter().any(|a| e.eq_ignore_ascii_case(a)))
        .unwrap_or(false)
}
