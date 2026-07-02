import { useEffect, useState } from "react";
import type { Project } from "./model/types";
import { fmtRuntime, newProject, totalRuntime } from "./model/types";
import { exportProject, importProject } from "./lib/exportImport";
import { loadLastProject, ProjectContext, useProjectReducer } from "./store/useProject";
import AnimaticView from "./views/AnimaticView";
import BoardView from "./views/BoardView";
import ScoutView from "./views/ScoutView";
import SettingsModal from "./views/SettingsModal";
import ShotEditor from "./views/ShotEditor";
import ShotListView from "./views/ShotListView";

type View = "board" | "scout" | "list" | "animatic";

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
        Storyboarding inside Marble worlds, the Scorsese way: scout the set in
        first person, mark the shot IN and OUT, sketch the camera move in
        grease pencil, keep a rigorous shot list, cut an animatic — then hand
        the posed frames to FARM AR as spatial anchors and generate the shot.
      </div>
      <label className="field">picture title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">world .spz URL
        <input value={spz} onChange={(e) => setSpz(e.target.value)} />
      </label>
      <label className="field">world name
        <input value={worldTitle} onChange={(e) => setWorldTitle(e.target.value)} />
      </label>
      <label className="field">collider GLB URL (optional — walk-mode floors/walls)
        <input value={collider} onChange={(e) => setCollider(e.target.value)} />
      </label>
      <button onClick={() => onCreate(newProject(title, { spzUrl: spz, colliderUrl: collider || undefined, title: worldTitle }))}>
        start boarding
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
          {(["board", "scout", "list", "animatic"] as View[]).map((v) => (
            <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {v === "list" ? "shot list" : v}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="runtime">{fmtRuntime(totalRuntime(project))} · {project.world.title}</span>
        <button className="ghost" onClick={() => exportProject(project)}>export</button>
        <label className="ghost" style={{ border: "1px solid var(--ink-soft)", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          import
          <input
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
        </label>
        <button
          className="ghost"
          title="new project"
          onClick={() => {
            if (confirm("Start a new project? (Current one stays saved in this browser.)")) {
              localStorage.removeItem("shotboard.lastProjectId");
              location.reload();
            }
          }}
        >
          new
        </button>
        <button className="ghost" onClick={() => setShowSettings(true)}>⚙ farm</button>
      </div>

      <div className="main">
        {view === "board" && <BoardView onOpenShot={openShot} />}
        {view === "scout" && <ScoutView onOpenShot={openShot} />}
        {view === "list" && <ShotListView onOpenShot={openShot} />}
        {view === "animatic" && <AnimaticView />}
      </div>

      {openShotId && <ShotEditor shotId={openShotId} onClose={() => setOpenShotId(null)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </ProjectContext.Provider>
  );
}
