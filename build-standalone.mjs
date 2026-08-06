/**
 * Bundle roomplanner.html into a single self-contained page.
 *
 * The hosted page imports three from esm.sh, which is fine on GitHub Pages but
 * impossible anywhere a strict CSP blocks third-party hosts (Claude Artifacts,
 * an offline copy, an email attachment). This inlines three + OrbitControls +
 * the schema so the result has zero network dependencies.
 *
 *   node build-standalone.mjs [outfile]
 *
 * Requires three and esbuild resolvable from cwd:
 *   npm i three@0.180.0 esbuild
 *
 * Emits body-level markup only — no <!doctype>, <html>, <head> or <body> — so
 * the output drops straight into a host that supplies its own skeleton. Browsers
 * parse it fine standalone too.
 */
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const SRC = "roomplanner.html";
const SCHEMA = "schemas/great-room.json";
const OUT = process.argv[2] || "roomplanner.standalone.html";

const html = await fs.readFile(SRC, "utf8");
const schema = JSON.parse(await fs.readFile(SCHEMA, "utf8"));

/* ── pull the three pieces out of the source page ─────────────────────────── */
const grab = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${what} in ${SRC}`);
  return m[1];
};
const css = grab(/<style>([\s\S]*?)<\/style>/, "<style> block");
const appJs = grab(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/, "app module");

// Everything between </style>'s section and the importmap is the UI markup.
const body = grab(/<\/head>\s*<body>([\s\S]*?)\s*<script type="importmap">/, "body markup");

/* ── bundle three + addons + app into one ES module ───────────────────────── */
const entry = path.join(process.cwd(), ".standalone-entry.mjs");
await fs.writeFile(entry, appJs, "utf8");

let bundled;
try {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    legalComments: "none",
    write: false,
    // The page's import map names; resolve them to the installed package.
    alias: { three: "three" },
    logLevel: "warning",
  });
  bundled = res.outputFiles[0].text;
} finally {
  await fs.rm(entry, { force: true });
}

/* ── assemble ─────────────────────────────────────────────────────────────── */
// </script> inside a JSON string would close the tag early.
const schemaLiteral = JSON.stringify(schema).replace(/</g, "\\u003c");

const out = `<title>Great room — 3D reconstruction &amp; layout planner</title>
<style>
${css.trim()}
</style>
${body.trim()}
<script type="module">
window.__GREAT_ROOM_SCHEMA__ = ${schemaLiteral};
window.__NO_REFERENCE__ = true;   // nothing to probe in a single-file build

${bundled}
</script>
`;

await fs.writeFile(OUT, out, "utf8");
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + " KB";
console.log(`${OUT}  ${kb(out)}  (bundle ${kb(bundled)}, schema ${kb(schemaLiteral)})`);
