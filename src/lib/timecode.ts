// Время хранится в кадрах (целые числа), чтобы не было накопления ошибок float.
// Таймкод: ММ:СС:КК, а для видео длиннее часа Ч:ММ:СС:КК (КК — номер кадра в секунде).

export const DEFAULT_FPS = 30;

export function lastFrame(duration: number, fps: number): number {
  return Math.max(1, Math.floor(duration * fps));
}

// Кадр N занимает интервал [N/fps, (N+1)/fps). ffmpeg при -ss берёт первый кадр,
// чей момент >= заданного, поэтому сдвигаемся на четверть кадра назад, чтобы
// погрешность округления не перескочила на следующий кадр.

/** Момент, с которого начинается кадр (для -ss и для начала обрезки). */
export function frameStartSeconds(frame: number, fps: number): number {
  return Math.max(0, (frame - 0.25) / fps);
}

/** Момент сразу после кадра: при обрезке кадр конца включается в фрагмент. */
export function frameEndSeconds(frame: number, fps: number): number {
  return (frame + 0.75) / fps;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatTimecode(frame: number, fps: number, long: boolean): string {
  const nominal = Math.max(1, Math.round(fps));
  const t = frame / fps;
  let whole = Math.floor(t + 1e-9);
  let ff = Math.round((t - whole) * fps);
  if (ff >= nominal) {
    ff = 0;
    whole += 1;
  }
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return long ? `${h}:${pad(m)}:${pad(s)}:${pad(ff)}` : `${pad(m)}:${pad(s)}:${pad(ff)}`;
}

/**
 * Разбор введённого таймкода. Принимает «ММ:СС:КК» (или «Ч:ММ:СС:КК» для длинных видео),
 * а также укороченные формы: «ММ:СС» и просто секунды. Возвращает номер кадра или null.
 */
export function parseTimecode(text: string, fps: number, long: boolean): number | null {
  const parts = text.trim().split(/[:.,;\s]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 4 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  let h = 0,
    m = 0,
    s = 0,
    f = 0;
  if (n.length === 4) [h, m, s, f] = n;
  else if (n.length === 3) {
    if (long) [h, m, s] = n;
    else [m, s, f] = n;
  } else if (n.length === 2) [m, s] = n;
  else [s] = n;
  if (m >= 60 && (h > 0 || n.length === 4)) return null;
  if (s >= 60 && n.length > 1) return null;
  if (f >= Math.max(1, Math.round(fps))) return null;
  return Math.round((h * 3600 + m * 60 + s) * fps) + f;
}
