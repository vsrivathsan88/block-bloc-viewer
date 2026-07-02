// The animatic: cut through the board in order, each shot held for its
// duration. FARM-generated video plays when a shot has one; otherwise the
// keyframe gets a Ken Burns pencil-test derived from the movement spec.
// This is the Schoonmaker pass — it's about the CUTS.

import { useEffect, useMemo, useRef, useState } from "react";
import { allShots, displayFrameId, fmtRuntime, frameById, totalRuntime } from "../model/types";
import { kenBurns } from "../lib/movement";
import { useImage, useProject } from "../store/useProject";
import StrokesSvg from "../components/StrokesSvg";

export default function AnimaticView() {
  const { project } = useProject();
  const shots = useMemo(() => allShots(project).filter(({ shot }) => shot.frameId), [project]);
  const total = totalRuntime(project);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSketch, setShowSketch] = useState(true);
  const [elapsedInShot, setElapsedInShot] = useState(0);
  const raf = useRef(0);
  const shotStart = useRef(0);

  const current = shots[idx];
  const frame = current ? frameById(project, displayFrameId(current.shot)) : undefined;
  const img = useImage(frame?.imageId);
  const video = current?.shot.farm?.videoUrl;

  useEffect(() => {
    if (!playing || !current) return;
    shotStart.current = performance.now() - elapsedInShot * 1000;
    const step = () => {
      const t = (performance.now() - shotStart.current) / 1000;
      setElapsedInShot(t);
      if (t >= current.shot.durationSec) {
        if (idx + 1 < shots.length) {
          setIdx(idx + 1);
          setElapsedInShot(0);
        } else {
          setPlaying(false);
          setElapsedInShot(0);
          setIdx(0);
          return;
        }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, current?.shot.id]);

  if (!shots.length) {
    return (
      <div className="animatic">
        <div className="slate-line">no framed shots yet — scout some coverage first</div>
      </div>
    );
  }

  const t01 = current ? Math.min(1, elapsedInShot / current.shot.durationSec) : 0;
  const kb = current ? kenBurns(current.shot.movement) : { from: "", to: "" };
  const elapsedBefore = shots.slice(0, idx).reduce((s, x) => s + x.shot.durationSec, 0);

  return (
    <div className="animatic">
      <div className="slate-line">
        {project.title} — SC {current.scene.number} · SH {current.shot.number} · {current.shot.movement} · {current.shot.lensMm}mm
      </div>
      <div className="screen">
        {video ? (
          <video key={video} src={video} autoPlay={playing} muted loop={!playing} />
        ) : (
          img && (
            <img
              className="frame-img"
              src={img}
              alt=""
              style={{
                transform: mixTransform(kb.from, kb.to, easeInOut(t01)),
                filter: "grayscale(0.8) contrast(1.1) sepia(0.12)",
              }}
            />
          )
        )}
        {!video && <span className="simulated-tag">pencil test</span>}
        {showSketch && !video && current.shot.strokes.length > 0 && <StrokesSvg strokes={current.shot.strokes} />}
        {current.shot.dialogue && <div className="dialogue">{current.shot.dialogue}</div>}
      </div>
      <div
        className="progress"
        onClick={(e) => {
          const frac = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.clientWidth;
          const target = frac * total;
          let acc = 0;
          for (let i = 0; i < shots.length; i++) {
            if (acc + shots[i].shot.durationSec >= target) {
              setIdx(i);
              setElapsedInShot(target - acc);
              return;
            }
            acc += shots[i].shot.durationSec;
          }
        }}
      >
        <div style={{ width: `${((elapsedBefore + elapsedInShot) / total) * 100}%` }} />
      </div>
      <div className="controls">
        <button onClick={() => { setIdx(Math.max(0, idx - 1)); setElapsedInShot(0); }}>⏮</button>
        <button onClick={() => setPlaying(!playing)}>{playing ? "⏸ pause" : "▶ play"}</button>
        <button onClick={() => { setIdx(Math.min(shots.length - 1, idx + 1)); setElapsedInShot(0); }}>⏭</button>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={showSketch} onChange={(e) => setShowSketch(e.target.checked)} /> sketch overlay
        </label>
        <span className="slate-line">
          {fmtRuntime(elapsedBefore + elapsedInShot)} / {fmtRuntime(total)} · cut {idx + 1}/{shots.length}
        </span>
      </div>
    </div>
  );
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Interpolate between two "scale(a) translate(b%, c%)" transform strings. */
function mixTransform(from: string, to: string, t: number): string {
  const parse = (s: string) => {
    const scale = /scale\(([\d.]+)\)/.exec(s)?.[1] ?? "1";
    const tx = /translateX?\((-?[\d.]+)%/.exec(s)?.[1] ?? /translate\((-?[\d.]+)%/.exec(s)?.[1] ?? "0";
    const ty = /translateY\((-?[\d.]+)%/.exec(s)?.[1] ?? /translate\(-?[\d.]+%,\s*(-?[\d.]+)%/.exec(s)?.[1] ?? "0";
    return { scale: parseFloat(scale), tx: parseFloat(tx), ty: parseFloat(ty) };
  };
  const a = parse(from);
  const b = parse(to);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return `scale(${lerp(a.scale, b.scale).toFixed(4)}) translate(${lerp(a.tx, b.tx).toFixed(2)}%, ${lerp(a.ty, b.ty).toFixed(2)}%)`;
}
