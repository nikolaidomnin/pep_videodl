import { useEffect, useState } from "react";
import type { VideoInfo } from "../api";
import { formatDuration } from "../lib/format";

/** Миниатюра с запасным вариантом, если картинка не загрузилась. */
export function Thumb({ src, className = "thumb" }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <div className={className} />;
  return <img className={className} src={src} alt="" draggable={false} loading="lazy" onError={() => setBroken(true)} />;
}

export function PreviewSkeleton() {
  return (
    <div className="preview">
      <div className="thumb skeleton" />
      <div className="meta">
        <div className="skeleton-line" style={{ width: "80%" }} />
        <div className="skeleton-line" style={{ width: "50%" }} />
      </div>
    </div>
  );
}

export function Preview({ info }: { info: VideoInfo }) {
  const parts = [info.uploader, formatDuration(info.duration), info.extractor].filter(Boolean);
  return (
    <div className="preview">
      <Thumb src={info.thumbnail} />
      <div className="meta">
        <div className="title" title={info.title}>
          {info.title}
        </div>
        <div className="sub">{parts.join(" · ")}</div>
      </div>
    </div>
  );
}
