import { tokenColor, type ThemeEntry } from "../themes";

interface Props {
  themes: ThemeEntry[];
  active: string;
  onSelect: (id: string) => void;
  onDelete: (theme: ThemeEntry) => void;
}

function Swatch({ theme }: { theme: ThemeEntry }) {
  const m = theme.manifest;
  const bg = m?.background;
  const img = theme.assets.poster ?? theme.assets.image;
  const layer = { position: "absolute", inset: 0 } as const;
  return (
    <div className="theme-swatch" style={{ background: tokenColor(m, "bg/base") }}>
      {bg?.gradient && <div style={{ ...layer, backgroundImage: bg.gradient }} />}
      {img && (
        <div
          style={{
            ...layer,
            backgroundImage: `url("${img}")`,
            backgroundSize: bg?.tile ? "90px" : "cover",
            backgroundRepeat: bg?.tile ? "repeat" : "no-repeat",
            backgroundPosition: "top center",
            opacity: bg?.opacity ?? 1,
          }}
        />
      )}
      <div
        className="sw-bar"
        style={{ top: 10, height: 12, background: tokenColor(m, "bg/input"), border: `1px solid ${tokenColor(m, "border/default")}` }}
      />
      <div className="sw-bar" style={{ top: 30, right: "45%", background: tokenColor(m, "text/primary"), opacity: 0.85 }} />
      <div className="sw-bar" style={{ top: 42, right: "62%", background: tokenColor(m, "text/dim") }} />
      <div className="sw-btn" style={{ background: tokenColor(m, "accent/default") }} />
    </div>
  );
}

export function ThemePicker({ themes, active, onSelect, onDelete }: Props) {
  return (
    <div className="themes">
      {themes.map((t) => {
        const broken = !t.manifest;
        const tag = broken ? "ошибка" : t.assets.video ? "видео" : "";
        return (
          <button
            key={t.id}
            type="button"
            className={`theme-card ${t.id === active ? "active" : ""} ${broken ? "broken" : ""}`}
            title={t.error ?? (t.manifest?.author ? `Автор: ${t.manifest.author}` : t.name)}
            onClick={() => !broken && onSelect(t.id)}
          >
            <Swatch theme={t} />
            <span className="theme-name">
              <span>{t.name}</span>
              {tag && <span className="tag">{tag}</span>}
            </span>
            {!t.builtin && (
              <span
                role="button"
                tabIndex={0}
                className="theme-delete"
                title="Удалить тему"
                aria-label={`Удалить тему ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(t);
                  }
                }}
              >
                ×
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
