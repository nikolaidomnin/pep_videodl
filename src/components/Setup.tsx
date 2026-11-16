import type { DepProgress } from "../api";
import { formatBytes } from "../lib/format";

const LABELS: Record<string, string> = {
  "yt-dlp": "yt-dlp (движок скачивания)",
  deno: "Deno (нужен для YouTube)",
  ffmpeg: "ffmpeg (склейка и конвертация)",
};

export function Setup({ deps, error, onRetry }: { deps: Record<string, DepProgress>; error: string | null; onRetry: () => void }) {
  const entries = Object.values(deps);
  return (
    <div className="setup">
      <h2>{error ? "Не удалось подготовить приложение" : "Подготовка…"}</h2>
      <div className="hint">
        {error ? error : "Скачиваю недостающие компоненты. Это нужно только один раз."}
      </div>
      {entries.map((d) => {
        const pct = d.total ? Math.min(100, (d.downloaded / d.total) * 100) : 0;
        const text =
          d.phase === "done"
            ? "готово"
            : d.phase === "extracting"
              ? "распаковка…"
              : d.total
                ? `${formatBytes(d.downloaded)} / ${formatBytes(d.total)}`
                : formatBytes(d.downloaded) || "…";
        return (
          <div className="dep" key={d.name}>
            <div className="row">
              <span>{LABELS[d.name] ?? d.name}</span>
              <span className="hint">{text}</span>
            </div>
            <div className={`bar ${d.phase !== "downloading" || !d.total ? (d.phase === "done" ? "" : "indeterminate") : ""}`}>
              <div style={{ width: d.phase === "done" ? "100%" : d.total ? `${pct}%` : undefined }} />
            </div>
          </div>
        );
      })}
      {error && (
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}
    </div>
  );
}
