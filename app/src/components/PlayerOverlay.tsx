// Press play: the strip becomes the animatic. FARM footage where it exists,
// Ken Burns pencil-test elsewhere. Icons only.

import { useEffect, useMemo, useRef, useState } from "react";
import { allShots, displayFrameId, fmtRuntime, frameById, totalRuntime } from "../model/types";
import { kenBurns } from "../lib/movement";
import { useImage, useProject } from "../store/useProject";
import StrokesSvg from "./StrokesSvg";
import { IconClose, IconNext, IconPause, IconPlay, IconPrev } from "./icons";

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function mixTransform(from: string, to: string, t: number): string {
  const parse = (s: string) => ({
    scale: parseFloat(/scale\(([\d.]+)\)/.exec(s)?.[1] ?? "1"),
    tx: parseFloat(/translateX?\((-?[\d.]+)%/.exec(s)?.[1] ?? /translate\((-?[\d.]+)%/.exec(s)?.[1] ?? "0"),
    ty: parseFloat(/translateY\((-?[\d.]+)%/.exec(s)?.[1] ?? /translate\(-?[\d.]+%,\s*(-?[\d.]+)%/.exec(s)?.[1] ?? "0"),
  });
  const a = parse(from), b = parse(to);
  const l = (x: number, y: number) => x + (y - x) * t;
  return `scale(${l(a.scale, b.scale).toFixed(4)}) translate(${l(a.tx, b.tx).toFixed(2)}%, ${l(a.ty, b.ty).toFixed(2)}%)`;
}

export default function PlayerOverlay({ onClose }: { onClose: () => void }) {
  const { project } = useProject();
  const shots = useMemo(() => allShots(project).filter(({ shot }) => shot.frameId), [project]);
  const total = totalRuntime(project);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);

  const current = shots[idx];
  const frame = current ? frameById(project, displayFrameId(current.shot)) : undefined;
  const img = useImage(frame?.imageId);
  const video = current?.shot.farm?.videoUrl;

  useEffect(() => {
    if (!playing || !current) return;
    start.current = performance.now() - t * 1000;
    const step = () => {
      const el = (performance.now() - start.current) / 1000;
      setT(el);
      if (el >= current.shot.durationSec) {
        if (idx + 1 < shots.length) { setIdx(idx + 1); setT(0); }
        else { setPlaying(false); setIdx(0); setT(0); return; }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, current?.shot.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!shots.length) return null;
  const t01 = Math.min(1, t / current.shot.durationSec);
  const kb = kenBurns(current.shot.movement);
  const before = shots.slice(0, idx).reduce((s, x) => s + x.shot.durationSec, 0);

  return (
    <div className="player">
      <div className="player-screen">
        {video ? (
          <video key={video} src={video} autoPlay muted />
        ) : (
          img && <img src={img} alt="" style={{ transform: mixTransform(kb.from, kb.to, easeInOut(t01)) }} />
        )}
        {!video && current.shot.strokes.length > 0 && <StrokesSvg strokes={current.shot.strokes} />}
        {current.shot.dialogue && <div className="sub">{current.shot.dialogue}</div>}
      </div>
      <div
        className="player-bar"
        onClick={(e) => {
          const frac = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.clientWidth;
          let acc = 0;
          const target = frac * total;
          for (let i = 0; i < shots.length; i++) {
            if (acc + shots[i].shot.durationSec >= target) { setIdx(i); setT(target - acc); return; }
            acc += shots[i].shot.durationSec;
          }
        }}
      >
        <div style={{ width: `${((before + t) / total) * 100}%` }} />
      </div>
      <div className="player-ctl">
        <button className="ib" title="previous" onClick={() => { setIdx(Math.max(0, idx - 1)); setT(0); }}><IconPrev /></button>
        <button className="ib big-ib" title={playing ? "pause" : "play"} onClick={() => setPlaying(!playing)}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button className="ib" title="next" onClick={() => { setIdx(Math.min(shots.length - 1, idx + 1)); setT(0); }}><IconNext /></button>
        <span className="clock">{fmtRuntime(before + t)} / {fmtRuntime(total)}</span>
        <button className="ib" title="close" onClick={onClose}><IconClose /></button>
      </div>
    </div>
  );
}
