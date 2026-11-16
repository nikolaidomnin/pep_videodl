import { useEffect, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { api, type CatalogTheme, type Settings } from "../api";
import { AUDIO_FORMATS, VIDEO_FORMATS, VIDEO_QUALITY_PRESETS } from "../lib/format";
import type { ThemeEntry } from "../themes";
import { BackIcon } from "./Icons";
import { ThemePicker } from "./ThemePicker";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => Promise<void>;
  onClose: () => void;
  themes: ThemeEntry[];
  onThemesChanged: () => Promise<void>;
}

export function SettingsPanel({ settings, onChange, onClose, themes, onThemesChanged }: Props) {
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogTheme[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  // null — ещё не узнали у системы.
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  useEffect(() => {
    api.getAutostart().then(setAutostart, (e) => setAutostartError(String(e)));
  }, []);

  async function toggleAutostart(enabled: boolean) {
    setAutostartError(null);
    try {
      await api.setAutostart(enabled);
      setAutostart(enabled);
    } catch (e) {
      setAutostartError(String(e));
    }
  }

  const activeThemeId = settings.theme;

  async function deleteTheme(t: ThemeEntry) {
    setThemeError(null);
    await api.setPinned(true);
    try {
      const yes = await ask(`Удалить тему «${t.name}»? Её можно будет скачать из каталога снова.`, {
        title: "Удаление темы",
        kind: "warning",
        okLabel: "Удалить",
        cancelLabel: "Отмена",
      });
      if (!yes) return;
      if (t.id === activeThemeId) await onChange({ ...settings, theme: "builtin:default" });
      await api.deleteTheme(t.id.replace(/^user:/, ""));
      await onThemesChanged();
    } catch (e) {
      setThemeError(String(e));
    } finally {
      await api.setPinned(false);
    }
  }

  async function toggleCatalog() {
    setThemeError(null);
    if (catalog) {
      setCatalog(null);
      return;
    }
    setLoadingCatalog(true);
    try {
      setCatalog(await api.themeCatalog());
    } catch (e) {
      setThemeError(String(e));
    } finally {
      setLoadingCatalog(false);
    }
  }

  async function install(t: CatalogTheme) {
    setThemeError(null);
    setInstalling(t.id);
    try {
      const id = await api.installTheme(t.id);
      await onThemesChanged();
      await onChange({ ...settings, theme: `user:${id}` });
    } catch (e) {
      setThemeError(String(e));
    } finally {
      setInstalling(null);
    }
  }

  async function pickFolder() {
    await api.setPinned(true);
    try {
      const dir = await open({ directory: true, defaultPath: settings.download_dir, title: "Папка для загрузок" });
      if (typeof dir === "string") await onChange({ ...settings, download_dir: dir });
    } finally {
      await api.setPinned(false);
    }
  }

  async function applyHotkey() {
    const value = hotkey.trim();
    if (!value || value === settings.hotkey) return;
    try {
      await onChange({ ...settings, hotkey: value });
      setHotkeyError(null);
    } catch (e) {
      setHotkeyError(String(e));
    }
  }

  return (
    <>
      <div className="settings-header">
        <div className="row">
          <button className="icon-btn" onClick={onClose} title="Назад (Esc)">
            <BackIcon />
          </button>
          <h2>Настройки</h2>
        </div>
      </div>
      <div className="divider" />
      <div className="settings-body" style={{ paddingTop: 14 }}>
        <div className="field">
          <label>Тема оформления</label>
          <ThemePicker
            themes={themes}
            active={activeThemeId}
            onSelect={(id) => onChange({ ...settings, theme: id })}
            onDelete={deleteTheme}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn ghost small" onClick={toggleCatalog} disabled={loadingCatalog}>
              {loadingCatalog ? "Загружаю…" : catalog ? "Скрыть каталог" : "Скачать темы…"}
            </button>
            <label className="checkbox" style={{ marginLeft: 6 }}>
              <input
                type="checkbox"
                checked={settings.animated_background}
                onChange={(e) => onChange({ ...settings, animated_background: e.target.checked })}
              />
              <span>Анимированный фон</span>
            </label>
          </div>
          {themeError ? (
            <div className="error" style={{ marginTop: 4 }}>
              {themeError}
            </div>
          ) : null}
          {catalog && (
            <div className="theme-catalog">
              {catalog.length === 0 && <div className="hint">В каталоге пока нет тем.</div>}
              {catalog.map((t) => {
                const local = themes.find((x) => x.id === `user:${t.id}`);
                const installed = local?.catalogVersion != null;
                const outdated = installed && (local?.catalogVersion ?? 0) < t.version;
                const busy = installing === t.id;
                return (
                  <div key={t.id} className="catalog-row">
                    <div className="catalog-info">
                      <span className="catalog-name">{t.name}</span>
                      {(t.author || t.description) && (
                        <span className="catalog-meta">
                          {[t.author && `Автор: ${t.author}`, t.description].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn ghost small"
                      disabled={busy || installing !== null || (installed && !outdated)}
                      onClick={() => install(t)}
                    >
                      {busy ? "Скачиваю…" : outdated ? "Обновить" : installed ? "Установлена" : "Скачать"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="field">
          <label>Папка по умолчанию</label>
          <div className="row">
            <input className="text-input" value={settings.download_dir} readOnly />
            <button className="btn ghost" onClick={pickFolder}>
              Изменить
            </button>
          </div>
        </div>

        <div className="field">
          <label>Запуск</label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autostart ?? false}
              disabled={autostart === null}
              onChange={(e) => toggleAutostart(e.target.checked)}
            />
            <span>Запускать вместе с Windows (в трее, без окна)</span>
          </label>
          {autostartError && (
            <div className="error" style={{ marginTop: 4 }}>
              {autostartError}
            </div>
          )}
        </div>

        <div className="field">
          <label>Горячая клавиша</label>
          <div className="row">
            <input
              className="text-input"
              value={hotkey}
              onChange={(e) => setHotkey(e.target.value)}
              onBlur={applyHotkey}
              onKeyDown={(e) => e.key === "Enter" && applyHotkey()}
              placeholder="Ctrl+Alt+D"
            />
          </div>
          {hotkeyError ? (
            <div className="error" style={{ marginTop: 4 }}>
              {hotkeyError}
            </div>
          ) : (
            <div className="hint" style={{ marginTop: 4, fontSize: 12 }}>
              Например <span className="kbd">Ctrl+Alt+D</span>, <span className="kbd">Alt+Space</span>,{" "}
              <span className="kbd">Ctrl+Shift+Y</span>
            </div>
          )}
        </div>

        <div className="field">
          <label>Формат по умолчанию</label>
          <select value={settings.default_format} onChange={(e) => onChange({ ...settings, default_format: e.target.value })}>
            <optgroup label="Видео">
              {VIDEO_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </optgroup>
            <optgroup label="Только аудио">
              {AUDIO_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div className="field">
          <label>Разрешение по умолчанию</label>
          <select value={settings.default_quality} onChange={(e) => onChange({ ...settings, default_quality: e.target.value })}>
            {VIDEO_QUALITY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Плейлисты</label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.playlist_by_default}
              onChange={(e) => onChange({ ...settings, playlist_by_default: e.target.checked })}
            />
            <span>Если ссылка ведёт на плейлист, сразу предлагать скачать весь плейлист</span>
          </label>
          <div className="hint" style={{ marginTop: 4, fontSize: 12 }}>
            Без галки по ссылке на видео из плейлиста качается только это видео, а плейлист включается вручную.
          </div>
        </div>
      </div>
    </>
  );
}
