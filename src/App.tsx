import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import { api, type DepProgress, type DownloadRequest, type PlaylistInfo, type Progress, type Settings, type VideoInfo } from "./api";
import { hasPlaylist, isAudioFormat, isBarePlaylistUrl, isUrl, sanitizeFilename } from "./lib/format";
import { CloseIcon, GearIcon, LinkIcon } from "./components/Icons";
import { Preview, PreviewSkeleton } from "./components/Preview";
import { PlaylistPanel, PlaylistSkeleton } from "./components/PlaylistPanel";
import { Options } from "./components/Options";
import { JobList, type Job } from "./components/JobList";
import { SettingsPanel } from "./components/SettingsPanel";
import { Setup } from "./components/Setup";
import { Trimmer } from "./components/Trimmer";
import { ThemeBackground } from "./components/ThemeBackground";
import { FrameDecor, type PlacedSticker } from "./components/FrameDecor";
import { BUILTIN_THEMES, DEFAULT_THEME_ID, applyTheme, preloadTheme, userThemeEntry, type ThemeEntry } from "./themes";
import { panelHeight } from "./lib/panelHeight";
import { DEFAULT_FPS, formatTimecode, frameEndSeconds, frameStartSeconds, lastFrame } from "./lib/timecode";

/** Ширина панели; окно шире на поле с обеих сторон. */
const PANEL_WIDTH = 640;
/** Максимальная высота панели. */
const MAX_HEIGHT = 812;
/** Поле вокруг панели. Одно на все встроенные темы, чтобы окно не менялось при смене темы. */
const BASE_PAD = 84;
/** Длительность плавного роста/сжатия панели, мс. */
const GROW_MS = 220;

function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type DepsState = "checking" | "ready" | "error";

export default function App() {
  const [depsState, setDepsState] = useState<DepsState>("checking");
  const [depsProgress, setDepsProgress] = useState<Record<string, DepProgress>>({});
  const [depsError, setDepsError] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<"main" | "settings">("main");
  const [themes, setThemes] = useState<ThemeEntry[]>(BUILTIN_THEMES);

  const refreshThemes = useCallback(async () => {
    try {
      const user = await api.listThemes();
      setThemes([...BUILTIN_THEMES, ...user.map(userThemeEntry)]);
    } catch {
      setThemes(BUILTIN_THEMES);
    }
  }, []);

  useEffect(() => {
    refreshThemes();
  }, [refreshThemes]);

  // Папку тем могли поправить вручную: перечитываем список при входе в настройки.
  useEffect(() => {
    if (view === "settings") refreshThemes();
  }, [view, refreshThemes]);

  const wantedTheme = settings?.theme;
  const desiredTheme =
    themes.find((t) => t.id === wantedTheme && t.manifest) ?? themes.find((t) => t.id === DEFAULT_THEME_ID)!;
  /** Применённая тема: меняется, только когда все её картинки уже загружены. */
  const [activeTheme, setActiveTheme] = useState<ThemeEntry>(desiredTheme);
  const animatedRef = useRef(true);
  animatedRef.current = settings?.animated_background ?? true;
  const firstTheme = useRef(true);

  useEffect(() => {
    let cancelled = false;
    preloadTheme(desiredTheme).then(() => {
      if (cancelled) return;
      const swap = () => flushSync(() => setActiveTheme(desiredTheme));
      const smooth =
        !firstTheme.current && desiredTheme.id !== activeTheme.id && animatedRef.current && !prefersReducedMotion();
      firstTheme.current = false;
      // Плавная смена: старый вид перетекает в новый, украшения новой темы проявляются волной.
      if (smooth && "startViewTransition" in document) document.startViewTransition(swap);
      else swap();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredTheme]);

  useLayoutEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Пользователь хочет качать плейлист целиком (чекбокс). */
  const [wantPlaylist, setWantPlaylist] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("best");

  // Обрезка (в кадрах)
  const [trimOn, setTrimOn] = useState(false);
  const [trim, setTrim] = useState({ start: 0, end: 1 });
  const fps = info?.fps && info.fps > 0 ? info.fps : DEFAULT_FPS;
  const maxFrame = info?.duration ? lastFrame(info.duration, fps) : 1;

  // Новое видео: обрезка выключена, интервал на всю длину.
  useEffect(() => {
    setTrimOn(false);
    setTrim({ start: 0, end: maxFrame });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const [jobs, setJobs] = useState<Job[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const analyzeSeq = useRef(0);
  const lastClipboard = useRef<string>("");
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  const urlHasPlaylist = hasPlaylist(url);
  const playlistMode = urlHasPlaylist && (wantPlaylist || isBarePlaylistUrl(url));

  // ---------- Украшения вокруг окна ----------
  const frame = activeTheme.manifest?.frame;
  const frameImages = activeTheme.assets.frame ?? [];
  const sparkleImages = activeTheme.assets.sparkles ?? [];
  const frontStickers = useMemo<PlacedSticker[]>(
    () =>
      (activeTheme.manifest?.stickers ?? []).flatMap((s, i) => {
        const src = activeTheme.assets.stickers?.[i];
        return src && s.layer !== "back" ? [{ key: `st-${i}`, src, sticker: s }] : [];
      }),
    [activeTheme],
  );
  const panelFrame = activeTheme.manifest?.panelFrame;
  const panelFrameSrc = activeTheme.assets.panelFrame;
  const hasFrame = !!frame && (frameImages.length > 0 || sparkleImages.length > 0 || frontStickers.length > 0 || !!panelFrameSrc);
  /** Поле вокруг панели: тень и украшения темы (своей теме можно сделать шире). */
  const pad = hasFrame ? Math.max(BASE_PAD, frame.margin ?? BASE_PAD) : BASE_PAD;
  /** Поле, под которое сейчас подогнано окно (null — окно ещё не подгоняли). */
  const lastPad = useRef<number | null>(null);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--frame-pad", `${pad}px`);
  }, [pad]);

  // Клик в прозрачное поле вокруг панели — как клик мимо окна: прячем.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root || !("__TAURI_INTERNALS__" in window)) return;
    const onDown = (e: MouseEvent) => {
      if (e.target === root) api.hideMain();
    };
    root.addEventListener("mousedown", onDown);
    return () => root.removeEventListener("mousedown", onDown);
  }, []);

  // ---------- Размер окна под содержимое ----------
  // Окно меняет размер сразу (оно прозрачное, это не видно), а панель внутри плавно растёт и сжимается:
  // при росте окно сначала становится высоким, при сжатии уменьшается после анимации.
  useLayoutEffect(() => {
    const panel = rootRef.current;
    const inner = innerRef.current;
    if (!panel || !inner) return;
    const tauri = "__TAURI_INTERNALS__" in window;
    const win = tauri ? getCurrentWindow() : null;
    const width = PANEL_WIDTH + pad * 2;
    let last = 0;
    let target = 0;
    let raf = 0;
    const show = (h: number) => {
      panel.style.height = `${h}px`;
      panelHeight.set(h);
    };
    const fitWindow = (ph: number) => {
      if (!win) return;
      // + поле сверху и снизу: в нём тень и украшения темы
      const maxH = Math.min(MAX_HEIGHT + pad * 2, window.screen.availHeight - 16);
      const h = Math.min(maxH, ph + pad * 2);
      const prevPad = lastPad.current;
      if (h === last && prevPad === pad) return;
      last = h;
      lastPad.current = pad;
      if (prevPad !== null && prevPad !== pad) {
        // Поле вокруг панели поменялось (другая тема): сдвигаем окно на разницу,
        // чтобы панель осталась на месте, а не прыгала.
        const d = pad - prevPad;
        Promise.all([win.outerPosition(), win.scaleFactor()])
          .then(([pos, scale]) => {
            const shift = Math.round(d * scale);
            return win.setPosition(new PhysicalPosition(pos.x - shift, pos.y - shift));
          })
          .then(() => win.setSize(new LogicalSize(width, h)))
          .catch(() => {});
      } else {
        win.setSize(new LogicalSize(width, h)).catch(() => {});
      }
    };
    const measure = () => {
      // + рамка панели (1px сверху и снизу)
      const next = Math.ceil(inner.getBoundingClientRect().height) + 2;
      if (next === target) return;
      target = next;
      const cur = panelHeight.get();
      cancelAnimationFrame(raf);
      const animate = cur > 0 && cur !== next && animatedRef.current && !prefersReducedMotion() && !document.hidden;
      if (!animate) {
        show(next);
        fitWindow(next);
        return;
      }
      if (next > cur) fitWindow(next);
      const from = cur;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / GROW_MS);
        const e = 1 - Math.pow(1 - p, 3);
        show(Math.round(from + (next - from) * e));
        if (p < 1) raf = requestAnimationFrame(step);
        else fitWindow(next);
      };
      raf = requestAnimationFrame(step);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [pad]);

  // ---------- Зависимости и настройки ----------
  const runEnsureDeps = useCallback(async () => {
    setDepsState("checking");
    setDepsError(null);
    try {
      await api.ensureDeps();
      setDepsState("ready");
    } catch (e) {
      setDepsError(String(e));
      setDepsState("error");
    }
  }, []);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setFormat(s.default_format);
      setWantPlaylist(s.playlist_by_default);
    });
    runEnsureDeps();
    const un = listen<DepProgress>("deps-progress", (e) => {
      setDepsProgress((prev) => ({ ...prev, [e.payload.name]: e.payload }));
    });
    return () => {
      un.then((f) => f());
    };
  }, [runEnsureDeps]);

  const updateSettings = useCallback(async (s: Settings) => {
    await api.saveSettings(s);
    setSettings(s);
  }, []);

  // ---------- Анализ ссылки ----------
  const pickDefaultQuality = useCallback(
    (res: VideoInfo | null) => {
      const wanted = settings?.default_quality ?? "best";
      if (isAudioFormat(format)) return "best";
      if (!res) return wanted;
      const heights = res.heights.map((h) => h.height);
      const target = wanted === "best" ? heights[0] : (heights.find((h) => h <= Number(wanted)) ?? heights[0]);
      return target ? String(target) : "best";
    },
    [format, settings],
  );

  const analyze = useCallback(
    async (raw: string, asPlaylist: boolean) => {
      const u = raw.trim();
      const seq = ++analyzeSeq.current;
      setInfo(null);
      setPlaylist(null);
      setError(null);
      if (!isUrl(u)) {
        setAnalyzing(false);
        return;
      }
      setAnalyzing(true);
      try {
        if (asPlaylist) {
          const res = await api.fetchPlaylist(u);
          if (seq !== analyzeSeq.current) return;
          setPlaylist(res);
          setSelected(new Set(res.entries.map((e) => e.id)));
          setQuality(pickDefaultQuality(null));
        } else {
          try {
            const res = await api.fetchInfo(u);
            if (seq !== analyzeSeq.current) return;
            setInfo(res);
            setQuality(pickDefaultQuality(res));
          } catch (e) {
            if (String(e) === "__PLAYLIST__") {
              // Ссылка оказалась плейлистом: переключаемся.
              if (seq !== analyzeSeq.current) return;
              setWantPlaylist(true);
              const res = await api.fetchPlaylist(u);
              if (seq !== analyzeSeq.current) return;
              setPlaylist(res);
              setSelected(new Set(res.entries.map((e) => e.id)));
              setQuality(pickDefaultQuality(null));
            } else {
              throw e;
            }
          }
        }
      } catch (e) {
        if (seq !== analyzeSeq.current) return;
        setError(String(e));
      } finally {
        if (seq === analyzeSeq.current) setAnalyzing(false);
      }
    },
    [pickDefaultQuality],
  );

  // Дебаунс ввода; повторный анализ при переключении «весь плейлист»
  useEffect(() => {
    if (!url.trim()) {
      analyzeSeq.current++;
      setInfo(null);
      setPlaylist(null);
      setError(null);
      setAnalyzing(false);
      return;
    }
    const t = setTimeout(() => analyze(url, playlistMode), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, playlistMode]);

  // При смене формата видео↔аудио сбрасываем качество
  function changeFormat(f: string) {
    const wasAudio = isAudioFormat(format);
    const nowAudio = isAudioFormat(f);
    setFormat(f);
    if (wasAudio !== nowAudio) {
      if (nowAudio) setQuality("best");
      else setQuality(info?.heights[0] ? String(info.heights[0].height) : (settings?.default_quality ?? "best"));
    }
  }

  // ---------- Буфер обмена при показе окна ----------
  const checkClipboard = useCallback(async () => {
    try {
      const text = (await readText())?.trim() ?? "";
      if (isUrl(text) && text !== lastClipboard.current && text !== url.trim()) {
        lastClipboard.current = text;
        setUrl(text);
      }
    } catch {
      /* в буфере не текст */
    }
  }, [url]);

  useEffect(() => {
    const unShown = listen("window-shown", () => {
      setTimeout(() => inputRef.current?.focus(), 30);
      if (depsState === "ready") checkClipboard();
    });
    const unSettings = listen("open-settings", () => setView("settings"));
    return () => {
      unShown.then((f) => f());
      unSettings.then((f) => f());
    };
  }, [checkClipboard, depsState]);

  useEffect(() => {
    if (depsState === "ready") {
      inputRef.current?.focus();
      checkClipboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsState]);

  // ---------- Прогресс загрузок ----------
  useEffect(() => {
    const un = listen<Progress>("download-progress", async (e) => {
      const p = e.payload;
      setJobs((prev) => prev.map((j) => (j.id === p.id ? { ...j, progress: p } : j)));
      const job = jobsRef.current.find((j) => j.id === p.id);
      if (p.phase === "done") notify("Загрузка завершена", job?.title ?? "");
      else if (p.phase === "error") notify("Ошибка загрузки", job?.title ?? p.message);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function notify(title: string, body: string) {
    try {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
    } catch {
      /* уведомления недоступны */
    }
  }

  // ---------- Скачивание ----------
  async function withDialog<T>(fn: () => Promise<T>): Promise<T> {
    await api.setPinned(true);
    try {
      return await fn();
    } finally {
      await api.setPinned(false);
      inputRef.current?.focus();
    }
  }

  async function enqueue(req: DownloadRequest, title: string, thumbnail: string | null) {
    const id = await api.startDownload(req);
    const job: Job = {
      id,
      title,
      thumbnail,
      format,
      progress: { id, phase: "queued", percent: 0, speed: "", eta: "", message: "", filepath: null },
    };
    setJobs((prev) => [job, ...prev]);
  }

  async function downloadSingle() {
    if (!info || !settings) return;
    const req: DownloadRequest = { url: info.webpage_url || url.trim(), format, quality };

    const trimmed = trimOn && !!info.duration && (trim.start > 0 || trim.end < maxFrame);
    let title = info.title;
    if (trimmed) {
      // Кадр конца входит во фрагмент — так же, как его показывает превью.
      req.trim_start = Number(frameStartSeconds(trim.start, fps).toFixed(3));
      req.trim_end = Number(Math.min(info.duration ?? Infinity, frameEndSeconds(trim.end, fps)).toFixed(3));
      const long = (info.duration ?? 0) >= 3600;
      const label = `${formatTimecode(trim.start, fps, long)}–${formatTimecode(trim.end, fps, long)}`;
      req.trim_label = label;
      title = `${info.title} · ${label}`;
    }

    if (settings.use_default_dir) {
      req.output_dir = settings.download_dir;
    } else {
      const baseName = sanitizeFilename(info.title) + (trimmed ? " (фрагмент)" : "");
      const path = await withDialog(() =>
        save({
          title: "Сохранить как",
          defaultPath: `${settings.download_dir}\\${baseName}.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        }),
      );
      if (!path) return;
      req.output_path = path;
    }

    try {
      await enqueue(req, title, info.thumbnail);
      setUrl("");
      setInfo(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function downloadPlaylist() {
    if (!playlist || !settings) return;
    const entries = playlist.entries.filter((e) => selected.has(e.id));
    if (entries.length === 0) return;

    let dir = settings.download_dir;
    if (!settings.use_default_dir) {
      const picked = await withDialog(() =>
        open({ directory: true, defaultPath: settings.download_dir, title: `Папка для «${playlist.title}»` }),
      );
      if (typeof picked !== "string") return;
      dir = picked;
    }

    try {
      for (const e of entries) {
        const req: DownloadRequest = { url: e.url, format, quality, output_dir: dir };
        if (!e.standalone) {
          req.playlist_url = playlist.webpage_url || url.trim();
          req.playlist_index = e.index;
        }
        await enqueue(req, e.title, e.thumbnail);
      }
      setUrl("");
      setPlaylist(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function download() {
    // Ориентируемся на то, что реально загружено: сайт может оказаться
    // плейлистом, даже если по ссылке этого не видно (автопереключение).
    if (playlist) downloadPlaylist();
    else downloadSingle();
  }

  // ---------- Клавиатура ----------
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (view === "settings") setView("main");
      else api.hideMain();
    } else if (e.key === "Enter" && view === "main" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "checkbox") {
      if ((info || playlist) && !analyzing) download();
      else if (isUrl(url) && !analyzing) analyze(url, playlistMode);
    }
  }

  // ---------- Рендер ----------
  const ready = depsState === "ready" && settings;
  const hasContent = !!info || !!playlist;
  const selectedCount = playlist ? selected.size : 0;

  return (
    <>
    {hasFrame && (
      <FrameDecor
        frame={frame}
        images={frameImages}
        sparkles={sparkleImages}
        stickers={frontStickers}
        panelFrame={panelFrame}
        panelFrameSrc={panelFrameSrc}
        pad={pad}
        width={PANEL_WIDTH}
        themeKey={activeTheme.id}
        animated={settings?.animated_background ?? true}
      />
    )}
    <div ref={rootRef} className="panel" onKeyDown={onKeyDown} tabIndex={-1}>
      <ThemeBackground
        theme={activeTheme}
        animated={settings?.animated_background ?? true}
        width={PANEL_WIDTH}
      />
      <div ref={innerRef} className="panel-inner">
      {!ready ? (
        <Setup deps={depsProgress} error={depsError} onRetry={runEnsureDeps} />
      ) : view === "settings" ? (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setView("main")}
          themes={themes}
          onThemesChanged={refreshThemes}
        />
      ) : (
        <>
          <div className="url-row">
            <LinkIcon />
            <input
              ref={inputRef}
              className="url-input"
              placeholder="Вставьте ссылку на видео или плейлист…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            {analyzing && <div className="spinner" />}
            {url && !analyzing && (
              <button className="icon-btn" title="Очистить" onClick={() => setUrl("")}>
                <CloseIcon />
              </button>
            )}
            <button className="icon-btn" title="Настройки" onClick={() => setView("settings")}>
              <GearIcon />
            </button>
          </div>

          {urlHasPlaylist && !isBarePlaylistUrl(url) && (
            <div className="section playlist-toggle">
              <label className="checkbox">
                <input type="checkbox" checked={wantPlaylist} onChange={(e) => setWantPlaylist(e.target.checked)} />
                <span>Скачать весь плейлист, а не только это видео</span>
              </label>
            </div>
          )}

          {(analyzing || hasContent || error) && <div className="divider" />}

          {analyzing && !hasContent && <div className="section">{playlistMode ? <PlaylistSkeleton /> : <PreviewSkeleton />}</div>}

          {error && (
            <div className="section">
              <div className="error">{error}</div>
            </div>
          )}

          {info && (
            <div className="section">
              <Preview info={info} />
            </div>
          )}

          {playlist && (
            <div className="section">
              <PlaylistPanel
                playlist={playlist}
                selected={selected}
                onToggle={(id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onSelectAll={(all) => setSelected(all ? new Set(playlist.entries.map((e) => e.id)) : new Set())}
              />
            </div>
          )}

          {hasContent && (
            <>
              <div className="section" style={{ paddingTop: 0 }}>
                <Options info={playlist ? null : info} format={format} quality={quality} onFormat={changeFormat} onQuality={setQuality} />
              </div>
              {info && !playlist && (
                <div className="section" style={{ paddingTop: 0 }}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={trimOn}
                      disabled={!info.duration}
                      onChange={(e) => setTrimOn(e.target.checked)}
                    />
                    <span>Обрезать фрагмент</span>
                    {!info.duration && <span className="path">длительность видео неизвестна</span>}
                  </label>
                  {trimOn && !!info.duration && (
                    <Trimmer
                      duration={info.duration}
                      fps={fps}
                      start={trim.start}
                      end={trim.end}
                      onChange={(start, end) => setTrim({ start, end })}
                      preview={
                        isAudioFormat(format) ? null : { pageUrl: info.webpage_url || url.trim(), storyboard: info.storyboard }
                      }
                    />
                  )}
                </div>
              )}
              <div className="section footer" style={{ paddingTop: 2 }}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.use_default_dir}
                    onChange={(e) => updateSettings({ ...settings, use_default_dir: e.target.checked })}
                  />
                  <span>В папку по умолчанию</span>
                  <span className="path" title={settings.download_dir}>
                    {settings.download_dir}
                  </span>
                </label>
                <button className="btn" onClick={download} disabled={!!playlist && selectedCount === 0}>
                  {playlist ? `Скачать ${selectedCount} из ${playlist.entries.length}` : "Скачать"}
                </button>
              </div>
            </>
          )}

          {jobs.length > 0 && (
            <>
              <div className="divider" />
              <div className="section">
                <JobList jobs={jobs} onRemove={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))} />
              </div>
            </>
          )}
        </>
      )}
      </div>
    </div>
    </>
  );
}
