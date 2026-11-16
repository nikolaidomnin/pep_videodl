import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ThemeEntry } from "../themes";
import { stickerStyle, stickerVisible } from "./FrameDecor";
import { usePanelHeight } from "../lib/panelHeight";

function useReducedMotion() {
  const [reduce, setReduce] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Наклейки слоя back: на фоне панели, под содержимым. */
function BackStickers({ theme, width }: { theme: ThemeEntry; width: number }) {
  const height = usePanelHeight();
  const list = theme.manifest?.stickers ?? [];
  const shown = list
    .map((s, i) => ({ s, i, src: theme.assets.stickers?.[i] }))
    .filter((x) => x.src && x.s.layer === "back" && stickerVisible(x.s, height));
  if (!shown.length) return null;
  return (
    <div className="theme-stickers" aria-hidden>
      {shown.map(({ s, i, src }) => (
        <img key={`${theme.id}:${i}`} className="sticker appear" src={src} alt="" draggable={false} style={stickerStyle(s, width, height)} />
      ))}
    </div>
  );
}

/** Фон темы внутри панели: градиент + картинка или зацикленное видео, плюс наклейки. */
export function ThemeBackground(props: { theme: ThemeEntry; animated: boolean; width: number }) {
  return (
    <>
      <BackgroundLayer theme={props.theme} animated={props.animated} />
      <BackStickers theme={props.theme} width={props.width} />
    </>
  );
}

function BackgroundLayer({ theme, animated }: { theme: ThemeEntry; animated: boolean }) {
  const bg = theme.manifest?.background;
  const reduce = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = animated && !reduce ? theme.assets.video : undefined;
  const still = theme.assets.poster ?? theme.assets.image;
  const opacity = bg?.opacity ?? 1;

  // В трее видео стоит на паузе: спрятанное окно не тратит ни процессор, ни видеокарту.
  useEffect(() => {
    if (!video || !("__TAURI_INTERNALS__" in window)) return;
    const play = () => videoRef.current?.play().catch(() => {});
    const pause = () => videoRef.current?.pause();
    const un = [listen("window-shown", play), listen("window-hidden", pause)];
    const onVis = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      un.forEach((p) => p.then((f) => f()));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [video]);

  if (!bg || (!bg.gradient && !video && !still)) return null;

  return (
    <div className="theme-bg" aria-hidden>
      {bg.gradient && <div style={{ backgroundImage: bg.gradient }} />}
      {video ? (
        <video ref={videoRef} key={video} src={video} poster={still} muted loop playsInline autoPlay preload="auto" style={{ opacity }} />
      ) : still ? (
        bg.tile ? (
          <div className="layer-tile" style={{ backgroundImage: `url("${still}")`, opacity }} />
        ) : (
          <img src={still} alt="" draggable={false} style={{ opacity }} />
        )
      ) : null}
    </div>
  );
}
