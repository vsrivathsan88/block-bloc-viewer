import { useEffect, useRef, useState } from "react";
import type { Project } from "./model/types";
import { fmtRuntime, newProject, totalRuntime } from "./model/types";
import { exportProject, importProject } from "./lib/exportImport";
import { loadLastProject, ProjectContext, useProjectReducer } from "./store/useProject";
import AnimaticView from "./views/AnimaticView";
import BoardView from "./views/BoardView";
import CastView from "./views/CastView";
import ScoutView from "./views/ScoutView";
import SettingsModal from "./views/SettingsModal";
import ShotEditor from "./views/ShotEditor";
import ShotListView from "./views/ShotListView";

type View = "board" | "scout" | "cast" | "list" | "animatic";

const TABS: { id: View; label: string; accent: string }[] = [
  { id: "board", label: "board", accent: "var(--red)" },
  { id: "scout", label: "scout", accent: "var(--teal)" },
  { id: "cast", label: "cast", accent: "var(--ochre)" },
  { id: "list", label: "shot list", accent: "var(--plum)" },
  { id: "animatic", label: "animatic", accent: "var(--blue)" },
];

// The living-room demo world the viewer defaults to.
const DEMO_SPZ = "https://cdn.marble.worldlabs.ai/bd1c3e7a-e412-4950-bb82-045f95f047a5/0dea05c6-6b15-4d51-bc0d-5f46b5e3df5a_ceramic_500k.spz";

function NewProjectCard({ onCreate }: { onCreate: (p: Project) => void }) {
  const [title, setTitle] = useState("Untitled Picture");
  const [spz, setSpz] = useState(DEMO_SPZ);
  const [collider, setCollider] = useState("");
  const [worldTitle, setWorldTitle] = useState("living-room");
  return (
    <div className="center-card">
      <h1>Shotboard</h1>
      <div className="sub">
        Storyboard inside a Marble world: walk the set, frame each shot, sketch
        the camera move, cut an animatic — then let FARM AR generate the
        footage.
      </div>
      <label className="field">picture title
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <details>
        <summary>world — using the living-room demo, change here</summary>
        <div>
          <label className="field">world .spz URL
            <input value={spz} onChange={(e) => setSpz(e.target.value)} />
          </label>
          <label className="field">world name
            <input value={worldTitle} onChange={(e) => setWorldTitle(e.target.value)} />
          </label>
          <label className="field">collider GLB URL (optional — floors/walls in walk mode)
            <input value={collider} onChange={(e) => setCollider(e.target.value)} />
          </label>
        </div>
      </details>
      <button className="red big" onClick={() => onCreate(newProject(title, { spzUrl: spz, colliderUrl: collider || undefined, title: worldTitle }))}>
        🎬 start boarding
      </button>
    </div>
  );
}

export default function App() {
  const { project, dispatch } = useProjectReducer();
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>("board");
  const [openShotId, setOpenShotId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadLastProject().then((p) => {
      if (p) dispatch({ type: "load", project: p });
      setBooted(true);
    });
  }, [dispatch]);

  if (!booted) return null;
  if (!project) {
    return <NewProjectCard onCreate={(p) => dispatch({ type: "load", project: p })} />;
  }

  const openShot = (shotId: string) => setOpenShotId(shotId);

  return (
    <ProjectContext.Provider value={{ project, dispatch }}>
      <div className="topbar">
        <div className="brand">Shotboard<small>block-bloc × FARM AR</small></div>
        <input
          className="title"
          value={project.title}
          onChange={(e) => dispatch({ type: "rename", title: e.target.value })}
        />
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? "on" : ""}
              style={{ ["--tab-accent" as string]: t.accent }}
              onClick={() => setView(t.id)}
            >
              <span className="dot" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="runtime-chip">⏱ {fmtRuntime(totalRuntime(project))} · {project.world.title}</span>
        <button className="ghost" title="FARM + cast pass settings" onClick={() => setShowSettings(true)}>⚙</button>
        <div className="menu-wrap">
          <button className="ghost" title="project menu" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={() => { setMenuOpen(false); exportProject(project); }}>⇩ export project</button>
              <button onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}>⇧ import project</button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (confirm("Start a new project? (Current one stays saved in this browser.)")) {
                    localStorage.removeItem("shotboard.lastProjectId");
                    location.reload();
                  }
                }}
              >
                ✚ new project
              </button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const p = await importProject(await file.text());
                dispatch({ type: "load", project: p });
              } catch (err) {
                alert(`import failed: ${err}`);
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="main">
        {view === "board" && <BoardView onOpenShot={openShot} onGoScout={() => setView("scout")} />}
        {view === "scout" && <ScoutView onOpenShot={openShot} />}
        {view === "cast" && <CastView />}
        {view === "list" && <ShotListView onOpenShot={openShot} />}
        {view === "animatic" && <AnimaticView />}
      </div>

      {openShotId && <ShotEditor shotId={openShotId} onClose={() => setOpenShotId(null)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </ProjectContext.Provider>
  );
}
