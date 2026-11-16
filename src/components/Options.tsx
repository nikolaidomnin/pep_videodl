import type { VideoInfo } from "../api";
import { AUDIO_FORMATS, VIDEO_FORMATS, VIDEO_QUALITY_PRESETS, formatBytes, isAudioFormat } from "../lib/format";

const AUDIO_BITRATES = [320, 256, 192, 128];

interface Props {
  /** Для одиночного видео: реальные разрешения. Для плейлиста null: общие пресеты. */
  info: VideoInfo | null;
  format: string;
  quality: string;
  onFormat: (f: string) => void;
  onQuality: (q: string) => void;
}

export function Options({ info, format, quality, onFormat, onQuality }: Props) {
  const audio = isAudioFormat(format);
  const bestAbr = info?.audio_bitrates[0]?.abr;

  return (
    <div className="options">
      <div className="field">
        <label>Формат</label>
        <select value={format} onChange={(e) => onFormat(e.target.value)}>
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
        <label>{audio ? "Битрейт" : "Разрешение"}</label>
        {audio ? (
          <select value={quality} onChange={(e) => onQuality(e.target.value)}>
            <option value="best">Лучшее{bestAbr ? ` (~${bestAbr} kbps)` : ""}</option>
            {AUDIO_BITRATES.map((b) => (
              <option key={b} value={String(b)}>
                {b} kbps
              </option>
            ))}
          </select>
        ) : !info ? (
          <select value={quality} onChange={(e) => onQuality(e.target.value)}>
            {VIDEO_QUALITY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <select value={quality} onChange={(e) => onQuality(e.target.value)}>
            {info.heights.length === 0 && <option value="best">Лучшее доступное</option>}
            {info.heights.map((h) => {
              const size = formatBytes(h.size);
              return (
                <option key={h.height} value={String(h.height)}>
                  {h.height}p{h.fps > 30 ? h.fps : ""}
                  {size ? ` · ~${size}` : ""}
                </option>
              );
            })}
          </select>
        )}
      </div>
    </div>
  );
}
