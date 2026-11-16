import { useEffect, useMemo, useRef, useState } from "react";
import { usePanelHeight } from "../lib/panelHeight";
import { listen } from "@tauri-apps/api/event";
import type { ThemeFrame, ThemePanelFrame, ThemeSticker } from "../themes";

/** Детерминированный генератор: у каждого места свои размер, картинка и наклон, которые не меняются при пересчёте. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Item {
  key: string;
  x: number;
  y: number;
  size: number;
  src: string;
  rot: number;
  flip: boolean;
  amp: number;
  sway: number;
  dur: number;
  delay: number;
  twinkle?: boolean;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedSticker {
  key: string;
  src: string;
  sticker: ThemeSticker;
}

interface Props {
  frame?: ThemeFrame;
  images: string[];
  sparkles: string[];
  /** Наклейки слоёв front и under (вокруг панели). */
  stickers: PlacedSticker[];
  /** Рамка вокруг панели (9-slice) и её картинка. */
  panelFrame?: ThemePanelFrame;
  panelFrameSrc?: string;
  /** Поле вокруг панели (отступ панели от края окна). */
  pad: number;
  width: number;
  /** Смена темы: украшения появляются заново, волной сверху вниз. */
  themeKey: string;
  animated: boolean;
}

interface LayoutProps extends Props {
  height: number;
}

const SIDE_SEED = { top: 1, bottom: 2, left: 3, right: 4 } as const;
type Side = keyof typeof SIDE_SEED;

/** Центр наклейки в координатах панели. */
function stickerCenter(s: ThemeSticker, W: number, H: number) {
  const a = s.anchor ?? "top-left";
  const cx = a === "top-center" || a === "bottom-center" ? W / 2 : a.startsWith("right") || a.endsWith("right") ? W : 0;
  const cy = a === "left-center" || a === "right-center" ? H / 2 : a.startsWith("bottom") ? H : 0;
  return { x: cx + (s.x ?? 0), y: cy + (s.y ?? 0) };
}

export function stickerVisible(s: ThemeSticker, H: number) {
  return H >= (s.minHeight ?? 0) && H <= (s.maxHeight ?? Infinity);
}

/** Стиль наклейки, общий для слоёв back и front. */
export function stickerStyle(s: ThemeSticker, W: number, H: number): React.CSSProperties {
  const c = stickerCenter(s, W, H);
  return {
    left: c.x,
    top: c.y,
    width: s.width,
    opacity: s.opacity ?? 1,
    transform: `translate(-50%, -50%) rotate(${s.rotate ?? 0}deg) scaleX(${s.flip ? -1 : 1})`,
  };
}

function layout(p: LayoutProps, aspects: Record<string, number>): Item[] {
  const { frame, images, sparkles, pad, width: W, height: H } = p;
  const items: Item[] = [];
  if (!frame) return items;

  // Где лежат наклейки: украшения туда не ставим, чтобы не было каши из картинок.
  const rectOf = (s: PlacedSticker): Rect => {
      const c = stickerCenter(s.sticker, W, H);
      // Повёрнутая на ~90° наклейка занимает место «боком».
      const side = Math.abs(Math.round((s.sticker.rotate ?? 0) / 90)) % 2 === 1;
      const w0 = s.sticker.width;
      const h0 = w0 * (aspects[s.src] ?? 1);
      const [w, h] = side ? [h0, w0] : [w0, h0];
      return { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
  };
  const solid = p.stickers.filter((s) => !s.sticker.twinkle);
  const blocked = solid.filter((s) => stickerVisible(s.sticker, H)).map(rectOf);
  // Наклейки без условий по высоте видны всегда: занятые ими места не участвуют в раздаче картинок.
  const blockedAlways = solid.filter((s) => s.sticker.minHeight == null && s.sticker.maxHeight == null).map(rectOf);
  const hits = (list: Rect[], x: number, y: number, r: number) =>
    list.some((b) => x + r > b.x0 && x - r < b.x1 && y + r > b.y0 && y - r < b.y1);
  const free = (x: number, y: number, r: number) => !hits(blocked, x, y, r);
  const slots: { item: Item; placed: boolean; counted: boolean }[] = [];

  const spacing = frame.spacing ?? 90;
  const edgeSpacing = frame.edgeSpacing ?? spacing;
  const [smin, smax] = frame.size ?? [32, 56];
  const overlap = frame.overlap ?? 12;
  const tilt = frame.tilt ?? 20;
  const ampMax = frame.float?.amplitude ?? 6;
  const dur = frame.float?.duration ?? 4.5;

  const make = (side: Side, k: number, along: number) => {
    const r = rng(SIDE_SEED[side] * 10007 + k * 7919);
    const [lo, hi] = side === "left" || side === "right" ? (frame.sideSize ?? [smin, smax]) : [smin, smax];
    const size = lo + (hi - lo) * r();
    // Отступ центра от края панели наружу: можно чуть заходить на панель, но не вылезать за окно.
    const minOut = size / 2 - overlap;
    const maxOut = Math.max(minOut, pad - size / 2 - ampMax);
    const out = minOut + (maxOut - minOut) * r();
    const jitter = (r() - 0.5) * (side === "top" || side === "bottom" ? edgeSpacing : spacing) * 0.35;
    let x = 0;
    let y = 0;
    if (side === "top" || side === "bottom") {
      x = along + jitter;
      y = side === "top" ? -out : H + out;
    } else {
      y = along + jitter;
      x = side === "left" ? -out : W + out;
    }
    const d = dur * (0.8 + 0.4 * r());
    const item: Item = {
      key: `${side}-${k}`,
      x,
      y,
      size,
      src: (r(), ""),
      rot: (r() * 2 - 1) * tilt,
      flip: r() < 0.5,
      amp: ampMax * (0.6 + 0.6 * r()),
      sway: 2 + 4 * r(),
      dur: d,
      delay: -r() * d,
    };
    const counted = !hits(blockedAlways, x, y, size * 0.4);
    slots.push({ item, counted, placed: counted && !hits(blocked, x, y, size * 0.4) });
  };

  if (images.length) {
    // Верх и низ: от угла до угла, количество зависит только от ширины.
    const span = W + pad;
    const nH = Math.max(2, Math.round(span / edgeSpacing));
    for (let k = 0; k <= nH; k++) {
      const along = -pad / 2 + (span * k) / nH;
      make("top", k, along);
      make("bottom", k, along);
    }
    // Бока: идём сверху вниз, новые появляются внизу, когда окно растёт.
    for (let k = 0; ; k++) {
      const along = spacing * (0.75 + k);
      if (along > H - spacing * 0.6) break;
      make("left", k, along);
      make("right", k, along);
    }
  }

  // Картинки раздаются поровну: каждому месту по порядку (верх и низ, потом бока сверху вниз)
  // достаётся самая редкая пока картинка; среди равных — случайная, но не как у соседа.
  // Раздача зависит только от номера места, а не от высоты окна: при росте и сжатии окна
  // картинки не меняются, новые места просто добавляются в конец.
  if (images.length) {
    const used = new Map<string, number>(images.map((s) => [s, 0]));
    let prev = "";
    for (const { item: it, counted, placed } of slots) {
      if (!counted) continue;
      if (placed) items.push(it);
      const r = rng([...it.key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7));
      const min = Math.min(...used.values());
      let pool = images.filter((s) => used.get(s) === min && s !== prev);
      if (!pool.length) pool = images.filter((s) => used.get(s) === min);
      it.src = pool[Math.floor(r() * pool.length) % pool.length];
      used.set(it.src, (used.get(it.src) ?? 0) + 1);
      prev = it.src;
    }
  }

  // Блёстки: прямо на линии края, вспыхивают и гаснут.
  const sp = frame.sparkles;
  if (sp && sparkles.length) {
    const step = sp.spacing ?? 64;
    const [qmin, qmax] = sp.size ?? [12, 24];
    const sides: [Side, number][] = [
      ["top", W],
      ["bottom", W],
      ["left", H],
      ["right", H],
    ];
    for (const [side, len] of sides) {
      for (let k = 0; step * (k + 0.5) < len - 10; k++) {
        const r = rng(SIDE_SEED[side] * 31337 + k * 104729 + 17);
        const along = step * (k + 0.5) + (r() - 0.5) * step * 0.5;
        const off = (r() - 0.5) * 8;
        const size = qmin + (qmax - qmin) * r();
        const x = side === "top" || side === "bottom" ? along : side === "left" ? off : W + off;
        const y = side === "left" || side === "right" ? along : side === "top" ? off : H + off;
        const d = 1.8 + 1.8 * r();
        const item: Item = {
          key: `s-${side}-${k}`,
          x,
          y,
          size,
          src: sparkles[Math.floor(r() * sparkles.length) % sparkles.length],
          rot: r() * 40 - 20,
          flip: false,
          amp: 0,
          sway: 0,
          dur: d,
          delay: -r() * d,
          twinkle: true,
        };
        if (free(x, y, size * 0.3)) items.push(item);
      }
    }
  }
  return items;
}

/** Картинки вокруг окна: левитируют, мерцают и покачиваются, клики проходят сквозь них. */
export function FrameDecor(base: Props) {
  const H = usePanelHeight();
  const props: LayoutProps = { ...base, height: H };
  const { pad, animated, width: W, themeKey } = props;
  // Задержка появления для каждого элемента считается один раз: при смене темы — волна сверху вниз,
  // для элементов, появившихся позже (окно выросло), — без задержки.
  const delays = useRef<{ theme: string; at: number; map: Map<string, number> }>({ theme: "", at: 0, map: new Map() });
  if (delays.current.theme !== themeKey) delays.current = { theme: themeKey, at: performance.now(), map: new Map() };
  const delayOf = (key: string, y: number) => {
    const d = delays.current;
    let v = d.map.get(key);
    if (v === undefined) {
      const inWave = performance.now() - d.at < 400;
      v = inWave ? Math.round(20 + (Math.max(0, y + pad) / Math.max(1, H + 2 * pad)) * 220) : 0;
      d.map.set(key, v);
    }
    return v;
  };
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const items = useMemo(
    () => layout(props, aspects),
    [props.frame, props.images, props.sparkles, props.stickers, props.pad, props.width, H, aspects], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pf = props.panelFrame;
  const frameStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!pf || !props.panelFrameSrc) return undefined;
    const k = pf.scale ?? 1;
    const [t, r, b, l] = pf.slice;
    return {
      width: W,
      height: H,
      borderImageSource: `url("${props.panelFrameSrc}")`,
      borderImageSlice: `${t} ${r} ${b} ${l}`,
      borderImageWidth: `${t * k}px ${r * k}px ${b * k}px ${l * k}px`,
      borderImageOutset: `${pf.outset * k}px`,
    };
  }, [pf, props.panelFrameSrc, W, H]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const un = [listen("window-hidden", () => setHidden(true)), listen("window-shown", () => setHidden(false))];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);

  if (H <= 0) return null;

  const visible = props.stickers.filter((s) => stickerVisible(s.sticker, H));
  const renderSticker = (s: PlacedSticker) => {
    const st = stickerStyle(s.sticker, W, H);
    if (s.sticker.float) {
      const r = rng(Math.round((s.sticker.x ?? 0) * 17 + (s.sticker.y ?? 0) * 29) + 5);
      const d = 4.5 * (0.8 + 0.4 * r());
      return (
        <div
          key={`${themeKey}:${s.key}`}
          className="sticker appear"
          style={{ ...st, height: s.sticker.width, animationDelay: `${delayOf(s.key, Number(st.top))}ms`, transform: "translate(-50%, -50%)" }}
        >
          <img
            className="deco-img"
            src={s.src}
            alt=""
            draggable={false}
            style={
              {
                "--r": `${s.sticker.rotate ?? 0}deg`,
                "--sx": s.sticker.flip ? -1 : 1,
                "--amp": `${-6 * (0.6 + 0.6 * r())}px`,
                "--sway": `${2 + 4 * r()}deg`,
                animationDuration: `${d}s`,
                animationDelay: `${-r() * d}s`,
              } as React.CSSProperties
            }
          />
        </div>
      );
    }
    if (s.sticker.twinkle) {
      // Мерцающая наклейка: внешний блок ставит на место, внутренняя картинка анимируется.
      const r = rng(s.key.length * 131 + Math.round((s.sticker.x ?? 0) * 7 + (s.sticker.y ?? 0) * 13));
      const d = 2.2 + 1.8 * r();
      return (
        <div
          key={`${themeKey}:${s.key}`}
          className="sticker appear"
          style={{ ...st, height: s.sticker.width, animationDelay: `${delayOf(s.key, Number(st.top))}ms` }}
        >
          <img
            className="deco-img twinkle"
            src={s.src}
            alt=""
            draggable={false}
            style={{ "--r": `${r() * 30 - 15}deg`, "--sx": 1, animationDuration: `${d}s`, animationDelay: `${-r() * d}s` } as React.CSSProperties}
          />
        </div>
      );
    }
    return (
          <img
            key={`${themeKey}:${s.key}`}
            className="sticker appear"
            src={s.src}
            alt=""
            draggable={false}
            style={{ ...st, animationDelay: `${delayOf(s.key, Number(st.top))}ms` }}
            onLoad={(e) => {
              const img = e.currentTarget;
              const a = img.naturalHeight / img.naturalWidth;
              if (a && aspects[s.src] !== a) setAspects((prev) => ({ ...prev, [s.src]: a }));
            }}
          />
    );
  };

  return (
    <>
    {visible.some((s) => s.sticker.layer === "under") && (
      <div className="frame-deco under" style={{ left: pad, top: pad }} aria-hidden>
        {visible.filter((s) => s.sticker.layer === "under").map(renderSticker)}
      </div>
    )}
    <div className={`frame-deco ${animated ? "" : "still"} ${hidden ? "paused" : ""}`} style={{ left: pad, top: pad }} aria-hidden>
      {frameStyle && <div key={`${themeKey}:frame`} className="panel-frame appear" style={frameStyle} />}
      {visible.filter((s) => s.sticker.layer !== "under").map(renderSticker)}
      {items.map((it) => (
        <div
          key={`${themeKey}:${it.key}`}
          className="deco"
          data-slot={it.key}
          style={{ left: it.x, top: it.y, width: it.size, height: it.size, animationDelay: `${delayOf(it.key, it.y)}ms` }}
        >
          <img
            className={`deco-img ${it.twinkle ? "twinkle" : ""}`}
            src={it.src}
            alt=""
            draggable={false}
            style={
              {
                "--r": `${it.rot}deg`,
                "--sx": it.flip ? -1 : 1,
                "--amp": `${-it.amp}px`,
                "--sway": `${it.sway}deg`,
                animationDuration: `${it.dur}s`,
                animationDelay: `${it.delay}s`,
              } as React.CSSProperties
            }
          />
        </div>
      ))}
    </div>
    </>
  );
}
