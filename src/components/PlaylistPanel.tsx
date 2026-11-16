import type { PlaylistInfo } from "../api";
import { formatDuration } from "../lib/format";
import { Thumb } from "./Preview";

interface Props {
  playlist: PlaylistInfo;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
}

export function PlaylistSkeleton() {
  return (
    <div className="preview">
      <div className="thumb skeleton" />
      <div className="meta">
        <div className="skeleton-line" style={{ width: "60%" }} />
        <div className="skeleton-line" style={{ width: "35%" }} />
      </div>
    </div>
  );
}

export function PlaylistPanel({ playlist, selected, onToggle, onSelectAll }: Props) {
  const total = playlist.entries.length;
  const count = selected.size;
  const allSelected = count === total && total > 0;

  return (
    <div className="playlist">
      <div className="playlist-head">
        <div className="meta">
          <div className="title" title={playlist.title}>
            {playlist.title}
          </div>
          <div className="sub">
            {[playlist.uploader, `${total} видео`, `выбрано ${count}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button className="link-btn" onClick={() => onSelectAll(!allSelected)}>
          {allSelected ? "Снять все" : "Выбрать все"}
        </button>
      </div>

      <div className="playlist-list">
        {playlist.entries.map((e, i) => {
          const checked = selected.has(e.id);
          return (
            <label className={`playlist-item ${checked ? "" : "off"}`} key={e.id}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(e.id)} />
              <span className="idx">{i + 1}</span>
              <Thumb src={e.thumbnail} />
              <span className="meta">
                <span className="title" title={e.title}>
                  {e.title}
                </span>
                <span className="sub">{[e.uploader, formatDuration(e.duration)].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
