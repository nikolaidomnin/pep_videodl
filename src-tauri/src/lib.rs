mod deps;
mod preview;
mod settings;
mod themes;
mod ytdlp;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::oneshot;

pub struct AppState {
    /// Пока true, окно не прячется при потере фокуса (открыт системный диалог).
    pub pinned: AtomicBool,
    pub jobs: Mutex<HashMap<u64, oneshot::Sender<()>>>,
    pub next_id: AtomicU64,
    /// Ограничивает число одновременных загрузок.
    pub semaphore: Arc<Semaphore>,
    /// Ссылка на видео -> поток, из которого берём кадры для предпросмотра.
    pub previews: Mutex<HashMap<String, preview::PreviewSource>>,
    /// Текущий запрос кадра в каждом слоте ("in"/"out"), чтобы прерывать устаревшие.
    pub frame_jobs: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

const MAX_PARALLEL_DOWNLOADS: usize = 2;

// ---------- Окно ----------

/// На сколько окно поднято над центром экрана (доля высоты монитора).
const WINDOW_LIFT: f64 = 0.06;

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.center();
        // Чуть выше центра экрана: свёрнутая строка смотрится лучше, а окну есть куда расти вниз.
        if let (Ok(pos), Ok(Some(m))) = (w.outer_position(), w.current_monitor()) {
            let lift = (m.size().height as f64 * WINDOW_LIFT) as i32;
            let top = m.position().y;
            let _ = w.set_position(tauri::PhysicalPosition::new(pos.x, (pos.y - lift).max(top)));
        }
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("window-shown", ());
    }
}

fn hide_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        // Фронтенд ставит анимированный фон темы на паузу, пока окно спрятано.
        let _ = app.emit("window-hidden", ());
    }
}

fn toggle_window(app: &AppHandle) {
    let visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide_window(app);
    } else {
        show_window(app);
    }
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("Неверное сочетание клавиш: {e}"))?;
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            toggle_window(app);
        }
    })
    .map_err(|e| format!("Не удалось зарегистрировать «{hotkey}»: {e}"))
}

/// Остановить все активные загрузки (перед выходом), чтобы не оставлять
/// осиротевшие процессы yt-dlp/ffmpeg.
fn cancel_all_jobs(app: &AppHandle) {
    let state = app.state::<AppState>();
    let senders: Vec<_> = match state.jobs.lock() {
        Ok(mut jobs) => jobs.drain().map(|(_, tx)| tx).collect(),
        Err(_) => return,
    };
    let had_jobs = !senders.is_empty();
    for tx in senders {
        let _ = tx.send(());
    }
    if had_jobs {
        // Даём задачам время убить дочерние процессы.
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Video Downloader")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "settings" => {
                show_window(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => {
                cancel_all_jobs(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ---------- Команды ----------

#[tauri::command]
fn get_settings(app: AppHandle) -> settings::Settings {
    settings::load(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: settings::Settings) -> Result<(), String> {
    let old = settings::load(&app);
    if old.hotkey != settings.hotkey {
        register_hotkey(&app, &settings.hotkey)?;
    }
    settings::save(&app, &settings)
}

#[tauri::command]
fn set_pinned(state: State<AppState>, pinned: bool) {
    state.pinned.store(pinned, Ordering::SeqCst);
}

#[tauri::command]
fn hide_main(app: AppHandle) {
    hide_window(&app);
}

#[tauri::command]
async fn ensure_deps(app: AppHandle) -> Result<deps::DepsStatus, String> {
    deps::ensure(&app).await
}

#[tauri::command]
async fn fetch_info(app: AppHandle, url: String) -> Result<ytdlp::VideoInfo, String> {
    ytdlp::fetch_info(&app, &url).await
}

#[tauri::command]
async fn grab_frame(app: AppHandle, url: String, seconds: f64, slot: String) -> Result<String, String> {
    preview::grab_frame(&app, &url, seconds, &slot).await
}

#[tauri::command]
async fn fetch_playlist(app: AppHandle, url: String) -> Result<ytdlp::PlaylistInfo, String> {
    ytdlp::fetch_playlist(&app, &url).await
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ytdlp::DownloadRequest,
) -> Result<u64, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = oneshot::channel();
    state
        .jobs
        .lock()
        .map_err(|_| "Внутренняя ошибка состояния")?
        .insert(id, tx);
    tauri::async_runtime::spawn(ytdlp::run_download(app, id, req, rx));
    Ok(id)
}

#[tauri::command]
fn cancel_download(state: State<AppState>, id: u64) {
    if let Ok(mut jobs) = state.jobs.lock() {
        if let Some(tx) = jobs.remove(&id) {
            let _ = tx.send(());
        }
    }
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_themes(app: AppHandle) -> Result<Vec<themes::UserTheme>, String> {
    themes::list(&app)
}

#[tauri::command]
async fn theme_catalog() -> Result<Vec<themes::CatalogTheme>, String> {
    themes::catalog().await
}

#[tauri::command]
async fn install_theme(app: AppHandle, id: String) -> Result<String, String> {
    themes::install(&app, &id).await
}

#[tauri::command]
fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    themes::delete(&app, &id)
}

/// Аргумент, с которым Windows запускает приложение при входе в систему.
const AUTOSTART_ARG: &str = "--autostart";

/// Запуск вместе с Windows (запись в HKCU\...\Run): состояние берём у системы, а не из настроек.
#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| format!("Не удалось изменить автозапуск: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .manage(AppState {
            pinned: AtomicBool::new(false),
            jobs: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            semaphore: Arc::new(Semaphore::new(MAX_PARALLEL_DOWNLOADS)),
            previews: Mutex::new(HashMap::new()),
            frame_jobs: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            setup_tray(&handle)?;

            let s = settings::load(&handle);
            if let Err(e) = register_hotkey(&handle, &s.hotkey) {
                eprintln!("{e}");
                let _ = register_hotkey(&handle, "Ctrl+Alt+D");
            }

            // При автозапуске с Windows сидим в трее, окно не показываем.
            if !std::env::args().any(|a| a == AUTOSTART_ARG) {
                show_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) => {
                let pinned = window.state::<AppState>().pinned.load(Ordering::SeqCst);
                if !pinned {
                    let _ = window.hide();
                    let _ = window.app_handle().emit("window-hidden", ());
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.app_handle().emit("window-hidden", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            set_pinned,
            hide_main,
            ensure_deps,
            fetch_info,
            fetch_playlist,
            grab_frame,
            start_download,
            cancel_download,
            open_path,
            reveal_path,
            list_themes,
            theme_catalog,
            install_theme,
            delete_theme,
            get_autostart,
            set_autostart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
