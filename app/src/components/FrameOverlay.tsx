// One frame, one overlay. Draw on it, pick a move glyph, type one line,
// drop a character in, make it move. Icons + tooltips; no labels.

import { useEffect, useState } from "react";
import type { CapturedFrame, CastMember, Shot, Take } from "../model/types";
import { circledTake, frameById, MOVEMENTS, reviewTake, shotTakes, uid } from "../model/types";
import { loadFarmConfig } from "../farm/client";
import { generateShot } from "../farm/generateShot";
import { loadMarbleConfig } from "../marble/client";
import { editImage, loadEditConfig } from "../edit/imageEdit";
import { MOVEMENT_GLYPH, movementFamily } from "../lib/movement";
import { movementFromArrow } from "../lib/sketch";
import SketchCanvas from "./SketchCanvas";
import { db } from "../store/db";
import { getImageData, primeImageCache, useImage, useProject } from "../store/useProject";
import {
  IconArrow, IconBolt, IconBox, IconCheck, IconClose, IconPencil, IconPerson,
  IconPersonPlus, IconPlay, IconRevert, IconTrash, IconUndo,
} from "./icons";

// paper rules: red china marker for camera moves, graphite for everything else
const ARROW_RED = "#e5484d";
const PENCIL_GRAPHITE = "#3d3a35";

function CastChip({ member, onClick, busy }: { member: CastMember; onClick: () => void; busy: boolean }) {
  const img = useImage(member.refImageIds[0]);
  return (
    <button
      className={`chip-cast ${member.kind === "prop" ? "prop" : ""}`}
      title={`add ${member.name} to this frame`}
      onClick={onClick}
      disabled={busy}
    >
      {img ? <img src={img} alt="" /> : <span>{member.name.slice(0, 1).toUpperCase()}</span>}
    </button>
  );
}

export default function FrameOverlay({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const { project, dispatch } = useProject();
  const located = project.scenes
    .flatMap((sc) => sc.shots.map((s) => ({ scene: sc, shot: s })))
    .find((x) => x.shot.id === shotId);
  const shot = located?.shot;

  const [tool, setTool] = useState<"pencil" | "arrow">("arrow");
  const [movePop, setMovePop] = useState(false); // move-tag override popover
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showCastForm, setShowCastForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newKind, setNewKind] = useState<"character" | "prop">("character");

  const cleanFrame = shot ? frameById(project, shot.frameId) : undefined;
  const castFrame = shot ? frameById(project, shot.castFrameId) : undefined;
  const keyframe = castFrame ?? cleanFrame;
  const img = useImage(keyframe?.imageId);
  // generation polling is app-level (store/farmWatcher) — closing this
  // overlay never stops a task

  // takes: which one the stage shows. "still" = back to the drawable frame.
  const [viewTakeId, setViewTakeId] = useState<string | null>(null);
  const takes = shot ? shotTakes(shot) : [];
  const shownTake: Take | undefined =
    viewTakeId === "still"
      ? undefined
      : takes.find((t) => t.id === viewTakeId) ??
        (shot ? reviewTake(shot) ?? circledTake(shot) : undefined);
  const takeVid = useImage(shownTake?.videoId);
  const videoSrc = shownTake?.videoUrl ?? takeVid;
  // fresh footage presents itself: when a take lands, drop any pinned view
  // so the default (the take awaiting verdict) shows
  useEffect(() => { setViewTakeId(null); }, [takes.length, shotId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!shot) return null;
  const patch = (p: Partial<Shot>) => dispatch({ type: "updateShot", shotId: shot.id, patch: p });

  // drawing an arrow IS picking the move
  const onStrokes = (strokes: typeof shot.strokes) => {
    const added = strokes.length > shot.strokes.length ? strokes[strokes.length - 1] : null;
    const move = added?.tool === "arrow" ? movementFromArrow(added.points) : null;
    patch(move ? { strokes, movement: move } : { strokes });
  };

  // Circle a take (print it — the board and animatic play it); toss a take
  // (kept in history, dimmed). Only one circle per shot.
  const circle = (id: string) => {
    patch({ takes: takes.map((t) => ({ ...t, circled: t.id === id, rejected: t.id === id ? false : t.rejected })) });
    setViewTakeId(id);
  };
  const toss = (id: string) => {
    patch({ takes: takes.map((t) => (t.id === id ? { ...t, rejected: true, circled: false } : t)) });
    setViewTakeId(null);
  };

  async function compositeCast(member: CastMember) {
    if (!shot || !cleanFrame) return;
    setBusy(true);
    setNote("");
    try {
      const base = await getImageData(cleanFrame.imageId);
      if (!base) throw new Error("frame image missing");
      const refs: string[] = [];
      for (const rid of member.refImageIds) {
        const r = await getImageData(rid);
        if (r) refs.push(r);
      }
      const instruction =
        (member.kind === "prop"
          ? `Place a ${member.name} (${member.description || "see reference"}) into this room at a natural spot, `
          : `Add ${member.name} (${member.description || "see reference"}) into this room, `) +
        `matching its lighting, perspective and grain exactly. ${shot.action || ""} ` +
        (refs.length ? "Use the reference image(s) for the exact appearance. " : "") +
        "Do not change the room, framing or camera.";
      const dataUrl = await editImage(loadEditConfig(), { base, refs, instruction });
      const imageId = uid();
      primeImageCache(imageId, dataUrl);
      await db.putImage(imageId, dataUrl);
      const frame: CapturedFrame = {
        id: uid(),
        imageId,
        pose: cleanFrame.pose, // a 2D edit never moves the camera
        fov: cleanFrame.fov,
        aspect: cleanFrame.aspect,
        label: `${member.name} plate`,
        capturedAt: Date.now(),
      };
      dispatch({ type: "addFrame", frame });
      patch({ castFrameId: frame.id });
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!shot || !keyframe || !cleanFrame) return;
    if (loadFarmConfig().mode === "live" && !loadMarbleConfig().token) {
      return setNote("live mode needs a token — open settings");
    }
    try {
      setNote("");
      await generateShot(project, shot, dispatch);
    } catch (e) {
      setNote(String(e));
    }
  }

  function previewMove() {
    if (!shot) return;
    onClose();
    window.dispatchEvent(new CustomEvent("shotboard:preview-move", { detail: { shotId: shot.id } }));
  }

  const generating = shot.farm?.status === "queued" || shot.farm?.status === "running";

  return (
    <div className="frame-overlay" onClick={onClose}>
      <div className="frame-card" onClick={(e) => e.stopPropagation()}>
        <div className="frame-stage">
          {videoSrc ? (
            <>
              <video key={shownTake?.id} src={videoSrc} controls autoPlay loop muted />
              {shownTake && !shownTake.circled && (
                <div className="verdict">
                  <button className="vb good" title="circle this take — it prints" onClick={() => circle(shownTake.id)}><IconCheck /></button>
                  <button className="vb bad" title="toss this take" onClick={() => toss(shownTake.id)}><IconClose /></button>
                </div>
              )}
            </>
          ) : (
            <>
              {img && <img src={img} alt="" />}
              <SketchCanvas
                strokes={shot.strokes}
                tool={tool}
                color={tool === "arrow" ? ARROW_RED : PENCIL_GRAPHITE}
                onStrokes={onStrokes}
              />
            </>
          )}
          {generating && <div className="gen-bar"><span /><em>{shot.farm?.phase || "…"}</em></div>}
          {shot.farm?.status === "error" && <div className="gen-err" title={shot.farm.error}>!</div>}
        </div>

        {takes.length > 0 && (
          <div className="take-row">
            <button
              className={`take-chip ${!shownTake ? "on" : ""}`}
              title="the still frame — sketch on it"
              onClick={() => setViewTakeId("still")}
            >
              still
            </button>
            {takes.map((t, i) => (
              <button
                key={t.id}
                className={`take-chip ${shownTake?.id === t.id ? "on" : ""} ${t.circled ? "circled" : ""} ${t.rejected ? "tossed" : ""}`}
                title={t.circled ? `take ${i + 1} — circled` : t.rejected ? `take ${i + 1} — tossed` : `take ${i + 1} — awaiting verdict`}
                onClick={() => setViewTakeId(t.id)}
              >
                {t.circled ? "◉ " : ""}T{i + 1}
              </button>
            ))}
          </div>
        )}

        <div className="frame-tools">
          <button className={`ib ${tool === "arrow" ? "on" : ""}`} title="red arrow — draw the camera move, it sets itself" onClick={() => setTool("arrow")}><IconArrow /></button>
          <button className={`ib ${tool === "pencil" ? "on" : ""}`} title="pencil — sketch" onClick={() => setTool("pencil")}><IconPencil /></button>
          <button className="ib" title="undo stroke" disabled={!shot.strokes.length}
            onClick={() => patch({ strokes: shot.strokes.slice(0, -1) })}><IconUndo /></button>
          <button className="ib" title="preview the move in the world" disabled={!keyframe} onClick={previewMove}>
            <IconPlay />
          </button>

          <span className="sep" />

          <div className="move-wrap">
            <button
              className={`move-tag ${movementFamily(shot.movement)}`}
              title="the camera move — drawn arrows set it; click to override"
              onClick={() => setMovePop(!movePop)}
            >
              {MOVEMENT_GLYPH[shot.movement]} {shot.movement}
            </button>
            {movePop && (
              <div className="move-pop" onMouseLeave={() => setMovePop(false)}>
                {MOVEMENTS.map((m) => (
                  <button
                    key={m}
                    className={`glyph ${movementFamily(m)} ${shot.movement === m ? "on" : ""}`}
                    title={m}
                    onClick={() => { patch({ movement: m }); setMovePop(false); }}
                  >
                    {MOVEMENT_GLYPH[m]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="spacer" />

          <div className="dur" title="duration">
            <button className="ib" onClick={() => patch({ durationSec: Math.max(0.5, shot.durationSec - 0.5) })}>−</button>
            <b>{shot.durationSec}s</b>
            <button className="ib" onClick={() => patch({ durationSec: shot.durationSec + 0.5 })}>+</button>
          </div>
        </div>

        <input
          className="action-line"
          placeholder="what happens in this shot…"
          value={shot.action}
          onChange={(e) => patch({ action: e.target.value })}
        />

        <div className="frame-actions">
          <div className="cast-row">
            {project.cast.map((m) => (
              <CastChip key={m.id} member={m} busy={busy} onClick={() => compositeCast(m)} />
            ))}
            <button className="ib" title="new character" onClick={() => setShowCastForm(!showCastForm)}><IconPersonPlus /></button>
            {castFrame && (
              <button className="ib" title="back to clean plate" onClick={() => patch({ castFrameId: undefined })}><IconRevert /></button>
            )}
          </div>
          <div className="spacer" />
          <button
            className="ib big-ib bolt"
            title={
              shot.farm && shot.farm.status !== "queued" && shot.farm.status !== "running"
                ? "retake — new seed"
                : loadFarmConfig().mode === "mock" ? "make it move (mock)" : "make it move — FARM AR"
            }
            disabled={!keyframe || generating || busy}
            onClick={generate}
          >
            <IconBolt />
          </button>
          <button className="ib" title="delete shot"
            onClick={() => { if (confirm("Delete this shot?")) { onClose(); dispatch({ type: "deleteShot", shotId: shot.id }); } }}>
            <IconTrash />
          </button>
          <button className="ib" title="close" onClick={onClose}><IconClose /></button>
        </div>

        {showCastForm && (
          <div className="cast-form">
            <button className={`ib ${newKind === "character" ? "on" : ""}`} title="character" onClick={() => setNewKind("character")}><IconPerson /></button>
            <button className={`ib ${newKind === "prop" ? "on" : ""}`} title="prop / object" onClick={() => setNewKind("prop")}><IconBox /></button>
            <input placeholder={newKind === "prop" ? "prop — e.g. record player" : "name"} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder={newKind === "prop" ? "material, size, era…" : "look — wardrobe, age…"} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <button className="ib" title="add"
              onClick={() => {
                if (!newName.trim()) return;
                dispatch({ type: "addCastMember", member: { id: uid(), name: newName.trim(), description: newDesc.trim(), refImageIds: [], kind: newKind } });
                setNewName(""); setNewDesc(""); setShowCastForm(false);
              }}><IconCheck /></button>
          </div>
        )}
        {busy && <div className="gen-bar inline"><span /><em>compositing</em></div>}
        {note && <div className="frame-note">{note}</div>}
      </div>
    </div>
  );
}
