import { useEffect, useRef, useState } from "react";
import { api, type Storyboard } from "../api";
import { frameStartSeconds } from "../lib/timecode";

/** Пауза после последнего движения ползунка, прежде чем просить точный кадр. */
const DEBOUNCE_MS = 300;
const CARD_H = 120;

// Кэш точных кадров на всё время работы окна: ключ — видео + номер кадра.
const frameCache = new Map<string, string>();
const MAX_CACHE = 200;

function cacheKey(pageUrl: string, fps: number, frame: number) {
  return `${pageUrl}|${fps}|${frame}`;
}

function remember(key: string, src: string) {
  frameCache.set(key, src);
  if (frameCache.size > MAX_CACHE) {
    const first = frameCache.keys().next().value;
    if (first !== undefined) frameCache.delete(first);
  }
}

type Exact = { frame: number; src: string };

/** Точный кадр через ffmpeg с задержкой и отменой устаревших запросов. */
function useExactFrame(pageUrl: string, fps: number, frame: number, slot: string) {
  const [exact, setExact] = useState<Exact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wanted = useRef(frame);
  wanted.current = frame;

  useEffect(() => {
    setExact(null);
  }, [pageUrl]);

  useEffect(() => {
    const key = cacheKey(pageUrl, fps, frame);
    const hit = frameCache.get(key);
    if (hit) {
      setExact({ frame, src: hit });
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      api
        .grabFrame(pageUrl, frameStartSeconds(frame, fps), slot)
        .then((src) => {
          remember(key, src);
          if (wanted.current === frame) {
            setExact({ frame, src });
            setLoading(false);
          }
        })
        .catch((e) => {
          const msg = String(e);
          if (msg === "__CANCELLED__" || wanted.current !== frame) return;
          setError(msg);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pageUrl, fps, frame, slot]);

  return { exact, loading, error };
}

/** Миниатюра из раскадровки YouTube для момента t (мгновенно, но грубо). */
function StoryboardTile({ sb, seconds }: { sb: Storyboard; seconds: number }) {
  let start = 0;
  let frag = sb.fragments[sb.fragments.length - 1];
  let fragStart = sb.fragments.reduce((acc, f) => acc + f.duration, 0) - frag.duration;
  for (const f of sb.fragments) {
    if (seconds < start + f.duration) {
      frag = f;
      fragStart = start;
      break;
    }
    start += f.duration;
  }
  // В последнем спрайте ячеек может быть меньше, чем rows × columns.
  const tilesHere = Math.min(sb.rows * sb.columns, Math.max(1, Math.ceil(frag.duration / sb.tile_duration - 1e-6)));
  const idx = Math.min(tilesHere - 1, Math.max(0, Math.floor((seconds - fragStart) / sb.tile_duration)));
  const col = idx % sb.columns;
  const row = Math.floor(idx / sb.columns);

  // Масштабируем в пикселях: у последнего спрайта строк может быть меньше.
  const scale = CARD_H / sb.height;
  const w = sb.width * scale;
  return (
    <div
      className="frame-img storyboard"
      style={{
        width: w,
        height: CARD_H,
        backgroundImage: `url("${frag.url}")`,
        backgroundSize: `${sb.columns * w}px auto`,
        backgroundPosition: `${-col * w}px ${-row * CARD_H}px`,
      }}
    />
  );
}

interface CardProps {
  pageUrl: string;
  fps: number;
  frame: number;
  slot: "in" | "out";
  label: string;
  storyboard: Storyboard | null;
}

export function FrameCard({ pageUrl, fps, frame, slot, label, storyboard }: CardProps) {
  const { exact, loading, error } = useExactFrame(pageUrl, fps, frame, slot);
  const fresh = exact && exact.frame === frame;

  let body;
  if (fresh) {
    body = <img className="frame-img" src={exact.src} alt="" draggable={false} />;
  } else if (storyboard) {
    body = <StoryboardTile sb={storyboard} seconds={frame / fps} />;
  } else if (exact) {
    body = <img className="frame-img stale" src={exact.src} alt="" draggable={false} />;
  } else {
    body = null;
  }

  return (
    <div className="frame-card" title={error ?? undefined}>
      <div className="frame-box">
        {body}
        {!fresh && loading && <div className="spinner frame-spinner" />}
        {!fresh && !loading && error && <div className="frame-error">Кадр недоступен</div>}
      </div>
      <div className="frame-label">{label}</div>
    </div>
  );
}
