import { useLayoutEffect, useRef, useState } from "react";
import type { Storyboard } from "../api";
import { formatTimecode, lastFrame, parseTimecode } from "../lib/timecode";
import { FrameCard } from "./FramePreview";

type Which = "in" | "out";

interface Props {
  duration: number;
  fps: number;
  /** Начало и конец фрагмента в кадрах. */
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** Если задано, под дорожкой показываются кадры начала и конца. */
  preview?: { pageUrl: string; storyboard: Storyboard | null } | null;
}

const BUBBLE_W = 96;
const BUBBLE_GAP = 6;
/** Насколько плашка может выступать за край дорожки (равно горизонтальному отступу .trim-area). */
const EDGE = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Trimmer({ duration, fps, start, end, onChange, preview }: Props) {
  const max = lastFrame(duration, fps);
  const long = duration >= 3600;
  const tc = (f: number) => formatTimecode(f, fps, long);

  const railRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [editing, setEditing] = useState<Which | null>(null);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [top, setTop] = useState<Which>("out");
  const drag = useRef<{ which: Which; startX: number; moved: boolean; fromBubble: boolean } | null>(null);
  const thumbs = useRef<Record<Which, HTMLButtonElement | null>>({ in: null, out: null });

  // После мыши фокус переходит на ползунок, чтобы сразу докрутить стрелками по кадру.
  const focusThumb = (which: Which) => thumbs.current[which]?.focus({ preventScroll: true });

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function setFrame(which: Which, frame: number) {
    const f = Math.round(frame);
    if (which === "in") onChange(clamp(f, 0, end - 1), end);
    else onChange(start, clamp(f, start + 1, max));
  }

  function frameAt(clientX: number): number {
    const rect = railRef.current!.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(ratio * max);
  }

  // ---------- Перетаскивание ----------

  const beginDrag = (which: Which, fromBubble: boolean) => (e: React.PointerEvent) => {
    if (editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { which, startX: e.clientX, moved: false, fromBubble };
    setTop(which);
    focusThumb(which);
  };

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
    d.moved = true;
    setFrame(d.which, frameAt(e.clientX));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    // Клик по плашке без перетаскивания открывает ручной ввод.
    if (d && !d.moved && d.fromBubble) startEdit(d.which);
    else if (d) requestAnimationFrame(() => focusThumb(d.which));
  }

  function onRailDown(e: React.PointerEvent) {
    if (editing || e.button !== 0) return;
    const f = frameAt(e.clientX);
    const which: Which = f <= start ? "in" : f >= end ? "out" : f - start <= end - f ? "in" : "out";
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    drag.current = { which, startX: e.clientX, moved: true, fromBubble: false };
    setTop(which);
    setFrame(which, f);
    focusThumb(which);
  }

  // ---------- Клавиатура на ползунке ----------

  function onThumbKey(which: Which, e: React.KeyboardEvent) {
    const cur = which === "in" ? start : end;
    const sec = Math.max(1, Math.round(fps));
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = cur - (e.shiftKey ? sec : 1);
    else if (e.key === "ArrowRight") next = cur + (e.shiftKey ? sec : 1);
    else if (e.key === "PageDown") next = cur - sec * 10;
    else if (e.key === "PageUp") next = cur + sec * 10;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      startEdit(which);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setTop(which);
    setFrame(which, next);
  }

  // ---------- Ручной ввод ----------

  function startEdit(which: Which) {
    setEditing(which);
    setDraft(tc(which === "in" ? start : end));
    setInvalid(false);
    setTop(which);
  }

  function commit(keepOnError: boolean) {
    if (!editing) return;
    const f = parseTimecode(draft, fps, long);
    if (f === null || f > max) {
      if (keepOnError) {
        setInvalid(true);
        return;
      }
      setEditing(null);
      return;
    }
    setFrame(editing, f);
    setEditing(null);
  }

  function onEditKey(e: React.KeyboardEvent<HTMLInputElement>) {
    // Не даём Enter/Esc дойти до окна: там они означают «скачать» и «спрятать окно».
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(null);
    }
  }

  // ---------- Геометрия ----------

  const xIn = (start / max) * width;
  const xOut = (end / max) * width;

  // Плашки не должны налезать друг на друга и вылезать за края.
  const minC = BUBBLE_W / 2 - EDGE;
  const maxC = Math.max(minC, width - BUBBLE_W / 2 + EDGE);
  const need = BUBBLE_W + BUBBLE_GAP;
  let cIn = clamp(xIn, minC, maxC);
  let cOut = clamp(xOut, minC, maxC);
  if (cOut - cIn < need) {
    const mid = (cIn + cOut) / 2;
    cIn = mid - need / 2;
    cOut = mid + need / 2;
    if (cIn < minC) {
      cIn = minC;
      cOut = minC + need;
    }
    if (cOut > maxC) {
      cOut = maxC;
      cIn = maxC - need;
    }
  }

  const bubble = (which: Which, center: number) => {
    const frame = which === "in" ? start : end;
    const isEditing = editing === which;
    return (
      <div
        className={`trim-bubble ${isEditing ? "editing" : ""} ${isEditing && invalid ? "invalid" : ""}`}
        style={{ left: center, width: BUBBLE_W, zIndex: top === which ? 2 : 1 }}
        onPointerDown={isEditing ? undefined : beginDrag(which, true)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={isEditing ? undefined : `${which === "in" ? "Начало" : "Конец"}: клик — ввести вручную, тянуть — сдвинуть`}
      >
        {isEditing ? (
          <input
            autoFocus
            value={draft}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            onKeyDown={onEditKey}
            onBlur={() => commit(false)}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : (
          tc(frame)
        )}
      </div>
    );
  };

  const thumb = (which: Which, x: number) => (
    <button
      type="button"
      ref={(el) => {
        thumbs.current[which] = el;
      }}
      className={`trim-thumb ${which}`}
      style={{ left: x, zIndex: top === which ? 3 : 2 }}
      aria-label={which === "in" ? "Начало фрагмента" : "Конец фрагмента"}
      onPointerDown={beginDrag(which, false)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => onThumbKey(which, e)}
      onFocus={() => setTop(which)}
    />
  );

  const selected = end - start;

  return (
    <div className="trim">
      <div className="trim-area">
        <div className="trim-bubbles">
          {width > 0 && (
            <>
              {bubble("in", cIn)}
              {bubble("out", cOut)}
              <div className="trim-pointer" style={{ left: xIn }} />
              <div className="trim-pointer" style={{ left: xOut }} />
            </>
          )}
        </div>
        <div ref={railRef} className="trim-rail" onPointerDown={onRailDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <div className="trim-track" />
          <div className="trim-range" style={{ left: xIn, width: Math.max(0, xOut - xIn) }} />
          {width > 0 && (
            <>
              {thumb("in", xIn)}
              {thumb("out", xOut)}
            </>
          )}
        </div>
      </div>

      {preview && (
        <div className="frames">
          <FrameCard pageUrl={preview.pageUrl} fps={fps} frame={start} slot="in" label={`Начало · ${tc(start)}`} storyboard={preview.storyboard} />
          <FrameCard pageUrl={preview.pageUrl} fps={fps} frame={end} slot="out" label={`Конец · ${tc(end)}`} storyboard={preview.storyboard} />
        </div>
      )}

      <div className="trim-info">
        <span>
          Фрагмент <b>{tc(selected)}</b> из {tc(max)} · {Number(fps.toFixed(2))} к/с
        </span>
        {(start > 0 || end < max) && (
          <button className="link-btn" onClick={() => onChange(0, max)}>
            Сбросить
          </button>
        )}
      </div>
      <div className="trim-hint">
        Клик по времени — ввод вручную ({long ? "Ч:ММ:СС:КК" : "ММ:СС:КК"}, КК — кадр) · ← → по кадру, Shift — по секунде
      </div>
    </div>
  );
}
