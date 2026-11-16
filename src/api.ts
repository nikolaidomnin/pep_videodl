import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  download_dir: string;
  use_default_dir: boolean;
  hotkey: string;
  default_format: string;
  default_quality: string;
  last_ytdlp_update_check: number;
  playlist_by_default: boolean;
  theme: string;
  animated_background: boolean;
}

export interface UserTheme {
  id: string;
  dir: string;
  manifest: Record<string, unknown> | null;
  error: string | null;
  catalog_version: number | null;
}

export interface CatalogTheme {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  version: number;
  zip: string;
}

export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  index: number;
  standalone: boolean;
  duration: number | null;
  uploader: string | null;
  thumbnail: string | null;
}

export interface PlaylistInfo {
  title: string;
  uploader: string | null;
  webpage_url: string;
  entries: PlaylistEntry[];
}

export interface HeightOpt {
  height: number;
  fps: number;
  size: number | null;
}

export interface AudioOpt {
  abr: number;
  size: number | null;
}

export interface Storyboard {
  width: number;
  height: number;
  rows: number;
  columns: number;
  tile_duration: number;
  fragments: { url: string; duration: number }[];
}

export interface VideoInfo {
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
  extractor: string;
  fps: number | null;
  storyboard: Storyboard | null;
  heights: HeightOpt[];
  audio_bitrates: AudioOpt[];
}

export interface DownloadRequest {
  url: string;
  format: string;
  quality: string;
  output_dir?: string;
  output_path?: string;
  playlist_url?: string;
  playlist_index?: number;
  trim_start?: number;
  trim_end?: number;
  trim_label?: string;
}

export type Phase =
  | "queued"
  | "starting"
  | "downloading"
  | "processing"
  | "done"
  | "error"
  | "cancelled";

export interface Progress {
  id: number;
  phase: Phase;
  percent: number;
  speed: string;
  eta: string;
  message: string;
  filepath: string | null;
}

export interface DepProgress {
  name: string;
  downloaded: number;
  total: number | null;
  phase: "downloading" | "extracting" | "done";
}

export interface DepsStatus {
  ytdlp: string;
  ffmpeg: string;
  deno: string | null;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  setPinned: (pinned: boolean) => invoke<void>("set_pinned", { pinned }),
  hideMain: () => invoke<void>("hide_main"),
  ensureDeps: () => invoke<DepsStatus>("ensure_deps"),
  fetchInfo: (url: string) => invoke<VideoInfo>("fetch_info", { url }),
  fetchPlaylist: (url: string) => invoke<PlaylistInfo>("fetch_playlist", { url }),
  grabFrame: (url: string, seconds: number, slot: string) => invoke<string>("grab_frame", { url, seconds, slot }),
  startDownload: (req: DownloadRequest) => invoke<number>("start_download", { req }),
  cancelDownload: (id: number) => invoke<void>("cancel_download", { id }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  listThemes: () => invoke<UserTheme[]>("list_themes"),
  themeCatalog: () => invoke<CatalogTheme[]>("theme_catalog"),
  installTheme: (id: string) => invoke<string>("install_theme", { id }),
  deleteTheme: (id: string) => invoke<void>("delete_theme", { id }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
};
