// Triage the takes: one big frame at a time — accept it onto the board or
// toss it. Keyboard: A / Enter = accept, R / Backspace = reject, Esc = done.

import { useEffect, useState } from "react";
import type { Pose } from "../model/types";

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
  }, [idx, takes]);

  return (
    <div className="take-review">
      {done ? (
        <div className="take-done">
          <div className="big">{accepted ? `${accepted} shot${accepted === 1 ? "" : "s"} on the board 🎬` : "no takes kept"}</div>
          <button className="red big" style={{ maxWidth: 240 }} onClick={onClose} autoFocus>done</button>
        </div>
      ) : (
        <>
          <div className="take-slate">
            take {idx + 1} / {takes.length}
            <span className="pose">
              [{take.pose.position.map((n) => n.toFixed(1)).join(", ")}]
            </span>
          </div>
          <div className="take-frame">
            <img src={take.dataUrl} alt={`take ${idx + 1}`} />
          </div>
          <div className="take-actions">
            <button className="ghost" onClick={reject} title="R / Backspace">✗ toss</button>
            <button className="teal big" style={{ maxWidth: 280 }} onClick={accept} title="A / Enter" autoFocus>
              ✓ add to board
            </button>
            <button className="ghost" onClick={() => { for (let i = idx; i < takes.length; i++) onAccept(takes[i]); setAccepted(accepted + takes.length - idx); setIdx(takes.length); }}>
              accept all
            </button>
          </div>
          <div className="hint" style={{ color: "var(--muted)" }}>A accept · R reject · Esc finish</div>
        </>
      )}
    </div>
  );
}
