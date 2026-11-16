import { convertFileSrc } from "@tauri-apps/api/core";
import type { UserTheme } from "../api";

/** Имена токенов совпадают с переменными в Figma (коллекция Tokens). */
export const TOKENS = {
  "bg/base": "--bg",
  "bg/elevated": "--bg-elev",
  "bg/input": "--bg-input",
  "bg/frame": "--bg-frame",
  "bg/ghost-hover": "--bg-ghost-hover",
  "bg/skeleton-highlight": "--skeleton-hi",
  "border/default": "--border",
  "border/hover": "--border-hover",
  "border/bubble": "--border-bubble",
  "border/bubble-hover": "--border-bubble-hover",
  "border/panel": "--border-panel",
  "text/primary": "--text",
  "text/dim": "--text-dim",
  "text/faint": "--text-faint",
  "text/placeholder": "--text-placeholder",
  "text/on-accent": "--text-on-accent",
  "accent/default": "--accent",
  "accent/hover": "--accent-hover",
  "status/danger": "--danger",
  "status/ok": "--ok",
  "track/rail": "--track",
  "track/pointer": "--track-pointer",
  "handle/default": "--handle",
  "handle/hover": "--handle-hover",
  "glow/panel": "--glow-panel",
  "glow/control": "--glow-control",
  "button/secondary": "--btn-secondary",
  "button/secondary-hover": "--btn-secondary-hover",
  "button/secondary-text": "--btn-secondary-text",
} as const;

export type Token = keyof typeof TOKENS;

export interface ThemeBackground {
  /** Статичная картинка (png / webp / jpg / svg). */
  image?: string;
  /** Короткая зацикленная анимация (webm, без звука). */
  video?: string;
  /** Первый кадр видео: показывается сразу и когда анимация выключена. */
  poster?: string;
  /** Замостить картинкой, а не растянуть на всю панель. */
  tile?: boolean;
  /** Непрозрачность картинки/видео поверх цвета bg/base (0–1). */
  opacity?: number;
  /** CSS-градиент под картинкой, например radial-gradient(...). */
  gradient?: string;
}

/** Украшения вокруг окна: картинки из набора, расставленные по периметру панели. */
export interface ThemeFrame {
  /** Набор картинок (png / webp / svg); для каждого места берётся случайная. */
  images: string[];
  /** Поле вокруг панели, в котором живут украшения, px (окно становится шире на 2×margin). */
  margin?: number;
  /** Среднее расстояние между украшениями вдоль края, px. */
  spacing?: number;
  /** Шаг сверху и снизу, px (по умолчанию как spacing). */
  edgeSpacing?: number;
  /** Размер картинки: [мин, макс], px. */
  size?: [number, number];
  /** Размер картинок по бокам (слева и справа), если должен отличаться: [мин, макс], px. */
  sideSize?: [number, number];
  /** Насколько украшение может заходить на панель, px. */
  overlap?: number;
  /** Максимальный наклон, градусы. */
  tilt?: number;
  /** Левитация: амплитуда подъёма (px) и длительность цикла (с). 0 — без анимации. */
  float?: { amplitude?: number; duration?: number };
  /** Мерцающие блёстки прямо на линии края панели. */
  sparkles?: { images: string[]; spacing?: number; size?: [number, number] };
}

export type Corner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center"
  | "left-center"
  | "right-center";

/** Картинка, приклеенная к углу панели (бант, цепочка, губы). */
export interface ThemeSticker {
  image: string;
  /** Угол или середина стороны панели, от которых считаются x и y. */
  anchor?: Corner;
  /** Центр картинки относительно угла, px: x вправо, y вниз. */
  x?: number;
  y?: number;
  /** Ширина, px; высота по пропорциям картинки. */
  width: number;
  rotate?: number;
  flip?: boolean;
  opacity?: number;
  /** back — на фоне внутри панели; under — снаружи, под панелью (панель перекрывает край); front — поверх края панели. */
  layer?: "back" | "under" | "front";
  /** Показывать, только если панель не ниже этого значения, px. */
  minHeight?: number;
  /** Показывать, только если панель не выше этого значения, px (например, только в свёрнутом окне). */
  maxHeight?: number;
  /** Мерцать (вспыхивать и гаснуть), как блёстка. */
  twinkle?: boolean;
  /** Левитировать и покачиваться, как украшения вокруг окна. */
  float?: boolean;
}

/** Маленькие украшения внутри интерфейса. */
export interface ThemeDecor {
  /** После заголовка «Настройки». */
  title?: string;
  /** После подписей полей. */
  label?: string;
  /** В углу выбранной карточки темы. */
  activeCard?: string;
}

export interface ThemeEffects {
  /** Неоновое свечение панели и контролов, px (цвет — токены glow/*). */
  glow?: number;
  /** Глянцевый блик на кнопках и полях, 0–1. */
  gloss?: number;
  /** Рамка полей ввода с переливом: 2–5 цветов градиента. */
  fieldBorder?: string[];
}

/** Кнопка-картинка, режется на 3 части: края фиксированные, середина тянется. */
export interface ThemeButton {
  image: string;
  /** Прозрачные поля вокруг самой кнопки (свечение, блёстки), px картинки: [верх, право, низ, лево]. */
  margins: [number, number, number, number];
  /** Ширина неизменяемого края слева и справа от края картинки, px картинки. */
  slice: number;
  /** Цвет текста на кнопке. */
  text?: string;
}

/** Рамка вокруг панели, 9-slice: углы фиксированные, края повторяются. Числа — px картинки. */
export interface ThemePanelFrame {
  image: string;
  /** Где резать: [верх, право, низ, лево] от краёв картинки. */
  slice: [number, number, number, number];
  /** Сколько картинки выходит наружу за край панели. */
  outset: number;
  /** Масштаб: px картинки → px экрана (0.5 для картинки в двойном размере). */
  scale?: number;
}

export interface ThemeManifest {
  name: string;
  author?: string;
  scheme?: "dark" | "light";
  colors?: Partial<Record<Token, string>>;
  radius?: { panel?: number; control?: number; button?: number };
  background?: ThemeBackground;
  frame?: ThemeFrame;
  stickers?: ThemeSticker[];
  decor?: ThemeDecor;
  effects?: ThemeEffects;
  /** Главная кнопка («Скачать»). */
  button?: ThemeButton;
  /** Остальные кнопки. */
  buttonSecondary?: ThemeButton;
  panelFrame?: ThemePanelFrame;
}

export interface ThemeEntry {
  /** "builtin:default" или "user:<папка>". */
  id: string;
  name: string;
  builtin: boolean;
  manifest: ThemeManifest | null;
  error: string | null;
  /** Версия темы из каталога, если она скачана оттуда. */
  catalogVersion?: number | null;
  /** Готовые URL медиафайлов. stickers идут в том же порядке, что manifest.stickers. */
  assets: {
    image?: string;
    video?: string;
    poster?: string;
    frame?: string[];
    sparkles?: string[];
    stickers?: (string | undefined)[];
    decor?: ThemeDecor;
    button?: string;
    buttonSecondary?: string;
    panelFrame?: string;
  };
}

export const DEFAULT_THEME_ID = "builtin:default";

const DEFAULT_COLORS: Record<Token, string> = {
  "bg/base": "#1b1b20",
  "bg/elevated": "#24242b",
  "bg/input": "#121216",
  "bg/frame": "#0d0d10",
  "bg/ghost-hover": "#2e2e37",
  "bg/skeleton-highlight": "#2d2d36",
  "border/default": "rgba(255, 255, 255, 0.08)",
  "border/hover": "rgba(255, 255, 255, 0.18)",
  "border/bubble": "rgba(255, 255, 255, 0.1)",
  "border/bubble-hover": "rgba(255, 255, 255, 0.24)",
  "border/panel": "rgba(255, 255, 255, 0.08)",
  "text/primary": "#ececf1",
  "text/dim": "#9a9aa6",
  "text/faint": "#66666f",
  "text/placeholder": "#66666f",
  "text/on-accent": "#ffffff",
  "accent/default": "#6c8cff",
  "accent/hover": "#7f9bff",
  "status/danger": "#ff6b6b",
  "status/ok": "#5fd38d",
  "track/rail": "#3a3a44",
  "track/pointer": "#4a4a56",
  "handle/default": "#ececf1",
  "handle/hover": "#ffffff",
  "glow/panel": "transparent",
  "glow/control": "transparent",
  "button/secondary": "#24242b",
  "button/secondary-hover": "#2e2e37",
  "button/secondary-text": "#ececf1",
};

function resolveAssets(m: ThemeManifest, url: (file?: string, video?: boolean) => string | undefined): ThemeEntry["assets"] {
  const bg = m.background;
  const list = (xs?: string[]) => xs?.map((x) => url(x)).filter((u): u is string => !!u);
  return {
    image: url(bg?.image),
    video: url(bg?.video, true),
    poster: url(bg?.poster),
    frame: list(m.frame?.images),
    sparkles: list(m.frame?.sparkles?.images),
    stickers: m.stickers?.map((s) => url(s.image)),
    decor: m.decor && { title: url(m.decor.title), label: url(m.decor.label), activeCard: url(m.decor.activeCard) },
    button: url(m.button?.image),
    buttonSecondary: url(m.buttonSecondary?.image),
    panelFrame: url(m.panelFrame?.image),
  };
}

export const BUILTIN_THEMES: ThemeEntry[] = [
  {
    id: DEFAULT_THEME_ID,
    name: "Стандартная",
    builtin: true,
    manifest: { name: "Стандартная", scheme: "dark", colors: DEFAULT_COLORS },
    error: null,
    assets: {},
  },
];

// ---------- Пользовательские темы ----------

const MEDIA_EXT = /\.(png|webp|jpe?g|svg|gif|webm)$/i;

/** Файл темы → URL. Только файлы внутри папки темы, без «..» и абсолютных путей. */
function assetUrl(dir: string, file: unknown, video = false): string | undefined {
  if (typeof file !== "string" || !file) return undefined;
  if (/(^[\\/])|(:)|(\.\.)/.test(file) || !MEDIA_EXT.test(file)) return undefined;
  if (video !== /\.webm$/i.test(file)) return undefined;
  return convertFileSrc(`${dir}\\${file.replace(/\//g, "\\")}`);
}

const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right", "top-center", "bottom-center", "left-center", "right-center"];

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const strList = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function range(v: unknown, lo: number, hi: number): [number, number] | undefined {
  return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? [num(v[0], lo, hi)!, num(v[1], lo, hi)!] : undefined;
}

function sanitizeManifest(raw: Record<string, unknown>, fallbackName: string): ThemeManifest {
  const m: ThemeManifest = { name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : fallbackName };
  if (typeof raw.author === "string") m.author = raw.author.slice(0, 60);
  if (raw.scheme === "light" || raw.scheme === "dark") m.scheme = raw.scheme;
  const colors = obj(raw.colors);
  if (colors) {
    m.colors = {};
    for (const [k, v] of Object.entries(colors)) {
      if (k in TOKENS && typeof v === "string" && isColor(v)) m.colors[k as Token] = v;
    }
  }
  const r = obj(raw.radius);
  if (r) m.radius = { panel: num(r.panel, 0, 32), control: num(r.control, 0, 20), button: num(r.button, 0, 999) };
  const e = obj(raw.effects);
  if (e) {
    const fb = strList(e.fieldBorder, 5).filter(isColor);
    m.effects = { glow: num(e.glow, 0, 40), gloss: num(e.gloss, 0, 1), fieldBorder: fb.length >= 2 ? fb : undefined };
  }
  const b = obj(raw.background);
  if (b) {
    m.background = {
      image: str(b.image),
      video: str(b.video),
      poster: str(b.poster),
      tile: b.tile === true,
      opacity: num(b.opacity, 0, 1),
      gradient: typeof b.gradient === "string" && isGradient(b.gradient) ? b.gradient : undefined,
    };
  }
  const f = obj(raw.frame);
  if (f) {
    const images = strList(f.images, 20);
    const fl = obj(f.float) ?? {};
    const sp = obj(f.sparkles);
    const sparkles = sp ? strList(sp.images, 10) : [];
    if (images.length || sparkles.length) {
      m.frame = {
        images,
        margin: num(f.margin, 24, 140),
        spacing: num(f.spacing, 30, 400),
        edgeSpacing: num(f.edgeSpacing, 30, 400),
        size: range(f.size, 8, 160),
        sideSize: range(f.sideSize, 8, 160),
        overlap: num(f.overlap, 0, 40),
        tilt: num(f.tilt, 0, 180),
        float: { amplitude: num(fl.amplitude, 0, 30), duration: num(fl.duration, 0.5, 30) },
        sparkles: sparkles.length && sp ? { images: sparkles, spacing: num(sp.spacing, 20, 400), size: range(sp.size, 4, 80) } : undefined,
      };
    }
  }
  if (Array.isArray(raw.stickers)) {
    m.stickers = raw.stickers
      .map(obj)
      .filter((s): s is Record<string, unknown> => !!s && !!str(s.image) && typeof s.width === "number")
      .slice(0, 32)
      .map((s) => ({
        image: s.image as string,
        anchor: CORNERS.includes(s.anchor as Corner) ? (s.anchor as Corner) : "top-left",
        x: num(s.x, -400, 400) ?? 0,
        y: num(s.y, -400, 1200) ?? 0,
        width: num(s.width, 4, 640)!,
        rotate: num(s.rotate, -360, 360),
        flip: s.flip === true,
        opacity: num(s.opacity, 0, 1),
        layer: s.layer === "back" || s.layer === "under" ? s.layer : "front",
        minHeight: num(s.minHeight, 0, 2000),
        twinkle: s.twinkle === true,
        float: s.float === true,
        maxHeight: num(s.maxHeight, 0, 4000),
      }));
  }
  m.button = parseButton(raw.button);
  m.buttonSecondary = parseButton(raw.buttonSecondary);
  const pf = obj(raw.panelFrame);
  if (pf && str(pf.image) && Array.isArray(pf.slice) && pf.slice.length === 4) {
    m.panelFrame = {
      image: pf.image as string,
      slice: pf.slice.map((v) => num(v, 0, 4000) ?? 0) as [number, number, number, number],
      outset: num(pf.outset, 0, 4000) ?? 0,
      scale: num(pf.scale, 0.05, 4),
    };
  }
  const d = obj(raw.decor);
  if (d) m.decor = { title: str(d.title), label: str(d.label), activeCard: str(d.activeCard) };
  return m;
}

function parseButton(v: unknown): ThemeButton | undefined {
  const bt = obj(v);
  if (!bt || !str(bt.image) || !Array.isArray(bt.margins) || bt.margins.length !== 4 || typeof bt.slice !== "number") return undefined;
  return {
    image: bt.image as string,
    margins: bt.margins.map((x) => num(x, 0, 2000) ?? 0) as [number, number, number, number],
    slice: num(bt.slice, 1, 2000)!,
    text: typeof bt.text === "string" && isColor(bt.text) ? bt.text : undefined,
  };
}

export function userThemeEntry(t: UserTheme): ThemeEntry {
  const id = `user:${t.id}`;
  if (!t.manifest || t.error) {
    return {
      id,
      name: t.id,
      builtin: false,
      manifest: null,
      error: t.error ?? "Тема не прочитана",
      catalogVersion: t.catalog_version,
      assets: {},
    };
  }
  const manifest = sanitizeManifest(t.manifest, t.id);
  return {
    id,
    name: manifest.name,
    builtin: false,
    manifest,
    error: null,
    catalogVersion: t.catalog_version,
    assets: resolveAssets(manifest, (file, video) => assetUrl(t.dir, file, video)),
  };
}

// ---------- Применение ----------

function isColor(v: string) {
  return typeof CSS !== "undefined" && CSS.supports("color", v);
}

function isGradient(v: string) {
  return /^\s*((repeating-)?(linear|radial|conic)-gradient\()/.test(v) && !/url\s*\(/i.test(v) && CSS.supports("background-image", v);
}

function num(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
}

/** Цвет токена с подстановкой значений стандартной темы. */
export function tokenColor(m: ThemeManifest | null, token: Token): string {
  return m?.colors?.[token] ?? DEFAULT_COLORS[token];
}

let btnToken = 0;

/** Высоты уже загруженных картинок кнопок: тогда тему можно применить сразу, без мигания. */
const imageHeights = new Map<string, number>();

/** Все картинки темы (без видео). */
function themeImages(t: ThemeEntry): string[] {
  const a = t.assets;
  const list = [a.image, a.poster, a.button, a.buttonSecondary, a.panelFrame, a.decor?.title, a.decor?.label, a.decor?.activeCard]
    .concat(a.frame ?? [], a.sparkles ?? [], a.stickers ?? []);
  return [...new Set(list.filter((u): u is string => !!u))];
}

/** Загружает и декодирует картинки темы заранее, чтобы при переключении всё появилось разом. */
export async function preloadTheme(t: ThemeEntry): Promise<void> {
  await Promise.all(
    themeImages(t).map(async (src) => {
      if (imageHeights.has(src)) return;
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
        imageHeights.set(src, img.naturalHeight);
      } catch {
        /* битая картинка темы не должна мешать переключению */
      }
    }),
  );
}

const BTN_KEYS = ["img", "t", "r", "b", "l", "slice", "body", "text"];

/** Выставляет CSS-переменные кнопки-картинки (prefix: bp — главная, bs — остальные). */
function applyButton(root: HTMLElement, prefix: string, attr: string, btn: ThemeButton | undefined, src: string | undefined, token: number) {
  const clear = () => {
    BTN_KEYS.forEach((k) => root.style.removeProperty(`--${prefix}-${k}`));
    delete root.dataset[attr];
  };
  if (!btn || !src) return clear();
  // Высота самой кнопки в картинке нужна для масштаба: берём её у загруженной картинки.
  const apply = (naturalHeight: number) => {
    if (token !== btnToken) return;
    const [t, r, b, l] = btn.margins;
    const set = (k: string, v: string) => root.style.setProperty(`--${prefix}-${k}`, v);
    set("img", `url("${src}")`);
    set("t", String(t));
    set("r", String(r));
    set("b", String(b));
    set("l", String(l));
    set("slice", String(btn.slice));
    set("body", String(Math.max(1, naturalHeight - t - b)));
    set("text", btn.text ?? "#ffffff");
    root.dataset[attr] = "";
  };
  const known = imageHeights.get(src);
  if (known) return apply(known);
  const img = new Image();
  img.onload = () => {
    imageHeights.set(src, img.naturalHeight);
    apply(img.naturalHeight);
  };
  img.src = src;
}

const DECOR_VARS: Record<keyof ThemeDecor, string> = { title: "decoTitle", label: "decoLabel", activeCard: "decoCard" };

export function applyTheme(theme: ThemeEntry) {
  const m = theme.manifest;
  const root = document.documentElement;
  for (const token of Object.keys(TOKENS) as Token[]) {
    root.style.setProperty(TOKENS[token], tokenColor(m, token));
  }
  const control = m?.radius?.control ?? 8;
  root.style.setProperty("--radius", `${m?.radius?.panel ?? 14}px`);
  root.style.setProperty("--radius-control", `${control}px`);
  root.style.setProperty("--radius-button", `${m?.radius?.button ?? control}px`);
  root.style.setProperty("--glow-size", `${m?.effects?.glow ?? 0}px`);
  root.style.setProperty("--gloss", String(m?.effects?.gloss ?? 0));
  root.style.colorScheme = m?.scheme ?? "dark";
  const fb = m?.effects?.fieldBorder;
  if (fb && fb.length >= 2) {
    root.style.setProperty("--field-border", `linear-gradient(115deg, ${fb.join(", ")})`);
    root.dataset.fieldGradient = "";
  } else {
    root.style.removeProperty("--field-border");
    delete root.dataset.fieldGradient;
  }
  // Стрелка селекта — SVG в data-URI, переменные туда не попадают: подставляем цвет.
  const arrow = encodeURIComponent(tokenColor(m, "text/dim"));
  root.style.setProperty(
    "--select-arrow",
    `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${arrow}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")`,
  );
  // Кнопки-картинки: размеры в px картинки, CSS переводит их в px экрана по высоте кнопки.
  const token = ++btnToken;
  applyButton(root, "bp", "btnPrimary", m?.button, theme.assets.button, token);
  applyButton(root, "bs", "btnSecondary", m?.buttonSecondary, theme.assets.buttonSecondary, token);
  // Маленькие украшения: CSS показывает их, только когда стоит data-атрибут.
  for (const [key, attr] of Object.entries(DECOR_VARS) as [keyof ThemeDecor, string][]) {
    const src = theme.assets.decor?.[key];
    const cssVar = `--${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (src) {
      root.style.setProperty(cssVar, `url("${src}")`);
      root.dataset[attr] = "";
    } else {
      root.style.removeProperty(cssVar);
      delete root.dataset[attr];
    }
  }
}