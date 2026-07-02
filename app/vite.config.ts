import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dev-only: serve the repo-root splat viewer at /viewer.html so the Scout
// iframe is same-origin (in the built app it's reached at ../index.html).
function serveViewer(): Plugin {
  return {
    name: "serve-repo-viewer",
    configureServer(server) {
      server.middlewares.use("/viewer.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(fs.readFileSync(path.join(repoRoot, "index.html"), "utf8"));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveViewer()],
  base: "./",
  build: {
    outDir: path.join(repoRoot, "storyboard"),
    emptyOutDir: true,
  },
});
