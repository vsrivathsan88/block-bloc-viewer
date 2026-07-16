import { useEffect, useRef, useState } from "react";
import { newProject } from "./model/types";
import { exportProject, importProject } from "./lib/exportImport";
import { generateAll } from "./farm/generateShot";
import { useFarmWatcher } from "./store/farmWatcher";
import { loadLastProject, ProjectContext, useProjectReducer } from "./store/useProject";
import Stage from "./views/Stage";
import BoardSheet from "./components/BoardSheet";
import FrameOverlay from "./components/FrameOverlay";
import PlayerOverlay from "./components/PlayerOverlay";
import SettingsModal from "./views/SettingsModal";
import ShotListView from "./views/ShotListView";
import { IconBoard, IconClose, IconDots, IconGear, IconStage } from "./components/icons";

// The living-room demo world the viewer defaults to.
const DEMO_SPZ = "https://cdn.marble.worldlabs.ai/bd1c3e7a-e412-4950-bb82-045f95f047a5/0dea05c6-6b15-4d51-bc0d-5f46b5e3df5a_ceramic_500k.spz";

export default function App() {
  const { project, dispatch } = useProjectReducer();
  const [openShotId, setOpenShotId] = useState<string | null>(null);
  const [view, setView] = useState<"stage" | "board">("stage");
  const [playing, setPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlan, setShowPlan] = useState(false); // printable shooting plan
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useFarmWatcher(project, dispatch);

  // No onboarding card: wake up in the world.
  useEffect(() => {
    loadLastProject().then((p) => {
      dispatch({
        type: "load",
        project: p ?? newProject("Untitled Picture", { spzUrl: DEMO_SPZ, title: "living-room" }),
      });
    });
  }, [dispatch]);

  if (!project) return null;

  return (
    <ProjectContext.Provider value={{ project, dispatch }}>
      <div className={`topbar-min ${view === "board" ? "light" : ""}`}>
        <input
          className="title"
          value={project.title}
          onChange={(e) => dispatch({ type: "rename", title: e.target.value })}
        />
        <div className="spacer" />
        <button className="ib" title="settings — world, FARM, cast pass" onClick={() => setShowSettings(true)}><IconGear /></button>
        <div className="menu-wrap">
          <button className="ib" title="more" onClick={() => setMenuOpen(!menuOpen)}><IconDots /></button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  const [ok, failed] = await generateAll(project, dispatch);
                  if (failed) alert(`${ok} submitted, ${failed} failed`);
                }}
              >
                ⚡ generate all
              </button>
              <button onClick={() => { setMenuOpen(false); setShowPlan(true); }}>shooting plan</button>
              <button onClick={() => { setMenuOpen(false); exportProject(project); }}>export</button>
              <button onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}>import</button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (confirm("New picture? (This one stays saved in the browser.)")) {
                    localStorage.removeItem("shotboard.lastProjectId");
                    location.reload();
                  }
                }}
              >
                new picture
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
                dispatch({ type: "load", project: await importProject(await file.text()) });
              } catch (err) {
                alert(`import failed: ${err}`);
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* view switcher — Figma-style, top center */}
      <div className={`view-switch ${view === "board" ? "light" : ""}`}>
        <button className={view === "stage" ? "on" : ""} title="stage — the world" onClick={() => setView("stage")}><IconStage /></button>
        <button className={view === "board" ? "on" : ""} title="storyboard — frames with captions" onClick={() => setView("board")}><IconBoard /></button>
      </div>

      <Stage onOpenShot={setOpenShotId} onPlay={() => setPlaying(true)} />
      {view === "board" && <BoardSheet onOpenShot={setOpenShotId} />}

      {openShotId && <FrameOverlay shotId={openShotId} onClose={() => setOpenShotId(null)} />}
      {playing && <PlayerOverlay onClose={() => setPlaying(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showPlan && (
        <div className="plansheet">
          <button className="ib plansheet-close" title="close" onClick={() => setShowPlan(false)}><IconClose /></button>
          <ShotListView onOpenShot={(id) => { setShowPlan(false); setOpenShotId(id); }} />
        </div>
      )}
    </ProjectContext.Provider>
  );
}
