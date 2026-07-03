// Triage the takes: one frame at a time. ✓ keeps it on the board, ✗ tosses.
// Keys: A/Enter accept · R/Backspace reject · Esc finish.

import { useEffect, useState } from "react";
import type { Pose } from "../model/types";
import { IconCheck, IconClose } from "./icons";

export interface Take {
  dataUrl: string;
  pose: Pose;
  fov: number;
  aspect: number;
}

interface Props {
  takes: Take[];
  onAccept: (take: Take) => void;
  onClose: () => void;
}

export default function TakeReview({ takes, onAccept, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const take = takes[idx];
  const done = idx >= takes.length;

  function accept() {
    if (done) return;
    onAccept(takes[idx]);
    setAccepted((n) => n + 1);
    setIdx(idx + 1);
  }
  function reject() {
    if (done) return;
    setIdx(idx + 1);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // preventDefault so Enter doesn't ALSO click the focused button
      if (e.key === "a" || e.key === "Enter") { e.preventDefault(); if (done) onClose(); else accept(); }
      else if (e.key === "r" || e.key === "Backspace") { e.preventDefault(); reject(); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, takes, done]);

  return (
    <div className="take-review">
      {done ? (
        <div className="take-done">
          <div className="big">{accepted ? `+${accepted} 🎬` : "—"}</div>
          <button className="ib big-ib" title="done" onClick={onClose} autoFocus><IconCheck /></button>
        </div>
      ) : (
        <>
          <div className="take-slate">{idx + 1} / {takes.length}</div>
          <div className="take-frame">
            <img src={take.dataUrl} alt="" />
          </div>
          <div className="take-actions">
            <button className="ib big-ib toss" title="toss (R)" onClick={reject}><IconClose /></button>
            <button className="ib big-ib keep" title="keep (A)" onClick={accept} autoFocus><IconCheck /></button>
          </div>
        </>
      )}
    </div>
  );
}
