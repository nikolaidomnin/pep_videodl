export const VIDEO_FORMATS = ["mp4", "mkv", "webm"] as const;
export const AUDIO_FORMATS = ["mp3", "m4a", "opus", "flac", "wav"] as const;

export function isAudioFormat(fmt: string): boolean {
  return (AUDIO_FORMATS as readonly string[]).includes(fmt);
}

export function isUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Ссылка содержит плейлист (youtube ...?list=..., /playlist, /sets/, /playlists/). */
export function hasPlaylist(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return (
      u.searchParams.has("list") ||
      u.pathname.includes("/playlist") ||
      u.pathname.includes("/sets/") ||
      u.pathname.includes("/playlists/")
    );
  } catch {
    return false;
  }
}

/** Ссылка только на плейлист, без конкретного видео (youtube.com/playlist?list=...). */
export function isBarePlaylistUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    if (u.searchParams.has("list") && !u.searchParams.has("v")) return true;
    return u.pathname.includes("/playlist") || u.pathname.includes("/sets/") || u.pathname.includes("/playlists/");
  } catch {
    return false;
  }
}

export const VIDEO_QUALITY_PRESETS = [
  { value: "best", label: "Лучшее доступное" },
  { value: "2160", label: "до 2160p (4K)" },
  { value: "1440", label: "до 1440p" },
  { value: "1080", label: "до 1080p" },
  { value: "720", label: "до 720p" },
  { value: "480", label: "до 480p" },
  { value: "360", label: "до 360p" },
];

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Убрать символы, запрещённые в именах файлов Windows. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "video";
}
