import { api, type Progress } from "../api";
import { Thumb } from "./Preview";

export interface Job {
  id: number;
  title: string;
  thumbnail: string | null;
  format: string;
  progress: Progress;
}

function statusText(p: Progress): string {
  switch (p.phase) {
    case "queued":
      return "В очереди";
    case "starting":
      return "Подготовка…";
    case "downloading": {
      const parts = [`${p.percent.toFixed(1)}%`];
      if (p.speed) parts.push(p.speed);
      if (p.eta) parts.push(`осталось ${p.eta}`);
      return parts.join(" · ");
    }
    case "processing":
      return `${p.message || "Обработка"}…`;
    case "done":
      return "Готово";
    case "error":
      return p.message || "Ошибка";
    case "cancelled":
      return "Отменено";
  }
}

export function JobList({ jobs, onRemove }: { jobs: Job[]; onRemove: (id: number) => void }) {
  if (jobs.length === 0) return null;
  return (
    <div className="jobs">
      {jobs.map((job) => {
        const p = job.progress;
        const active = p.phase === "queued" || p.phase === "starting" || p.phase === "downloading" || p.phase === "processing";
        const cls = p.phase === "done" ? "ok" : p.phase === "error" ? "err" : "";
        return (
          <div className="job" key={job.id}>
            <Thumb src={job.thumbnail} />
            <div className="meta">
              <div className="title" title={job.title}>
                {job.title}
              </div>
              <div className={`status ${cls}`}>
                <span>{statusText(p)}</span>
                <span>{job.format.toUpperCase()}</span>
              </div>
              {active && p.phase !== "queued" && (
                <div className={`bar ${p.phase !== "downloading" ? "indeterminate" : ""}`}>
                  <div style={{ width: p.phase === "downloading" ? `${p.percent}%` : undefined }} />
                </div>
              )}
            </div>
            <div className="actions">
              {active && (
                <button className="btn ghost small" onClick={() => api.cancelDownload(job.id)}>
                  Отмена
                </button>
              )}
              {p.phase === "done" && p.filepath && (
                <>
                  <button className="btn ghost small" onClick={() => api.openPath(p.filepath!)}>
                    Открыть
                  </button>
                  <button className="btn ghost small" onClick={() => api.revealPath(p.filepath!)}>
                    В папке
                  </button>
                </>
              )}
              {!active && (
                <button className="btn ghost small" onClick={() => onRemove(job.id)} title="Убрать из списка">
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
