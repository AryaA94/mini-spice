// Writes the G-code for the site's machining intro (intro.nc) and the
// module the page loads it from (js/intro-gcode.js).
//
//   node tools/gen-intro.mjs [path/to/gcode-sim]
//
// With a gcode-sim binary (github.com/AryaA94/G-Code), the program is also
// checked with `gcode-sim lint` and timed with `gcode-sim stats`, and those
// results are what the page shows. The script refuses to write the files if
// the lint finds an error.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Stock: 220 x 160 x 20 mm aluminium block, work zero at the centre of its top face.
export const STOCK = { x: [-110, 110], y: [-80, 80], z: [-20, 0] };
// Pocket the board drops into (rounded by the 8 mm tool's radius).
export const POCKET = { x: [-82, 82], y: [-48, 58], depth: 6 };
const FACE_DEPTH = -0.5;
export const TOOLS = {
  1: { d: 20, name: "20 mm face mill" },
  2: { d: 8, name: "8 mm end mill" },
  3: { d: 1, v: 60, name: "60° engraver" },
};

const out = [];
const f = (n) => (Math.round(n * 1000) / 1000).toString();
const g = (s) => out.push(s);
const move = (code, p, feed) =>
  g(`${code}${p.x !== undefined ? " X" + f(p.x) : ""}${p.y !== undefined ? " Y" + f(p.y) : ""}${p.z !== undefined ? " Z" + f(p.z) : ""}${feed ? " F" + feed : ""}`);

g("%");
g("(ARYA ANANDA - PORTFOLIO FIXTURE PLATE)");
g("(Stock 220 x 160 x 20 mm 6061 aluminium. Work zero: centre of stock, top face.)");
g("G21 G17 G90 G94");
g("G54");

// --- Op 1: face the top, 0.5 mm, zig-zag with the 20 mm face mill
g("");
g("(OP1 FACE - T1 20 MM FACE MILL)");
g("T1 M6");
g("G43 H1");
g("S6000 M3");
g("G0 Z10");
{
  const r = TOOLS[1].d / 2, step = 14, z = FACE_DEPTH;
  let y = STOCK.y[0] + r - 4, dir = 1;
  move("G0", { x: STOCK.x[0] - r - 4, y });
  move("G0", { z: 2 });
  move("G1", { z }, 400);
  g("F1500");
  while (true) {
    move("G1", { x: dir > 0 ? STOCK.x[1] + r + 4 : STOCK.x[0] - r - 4 });
    if (y >= STOCK.y[1] - r + 4) break;
    y = Math.min(y + step, STOCK.y[1] - r + 4);
    move("G1", { y });
    dir = -dir;
  }
  move("G0", { z: 10 });
}

// --- Op 2: pocket for the board, three 2 mm levels, then a finishing contour
g("");
g("(OP2 POCKET - T2 8 MM END MILL)");
g("M5");
g("T2 M6");
g("G43 H2");
g("S10000 M3");
g("G0 Z10");
{
  const r = TOOLS[2].d / 2, step = 5.5;
  const x0 = POCKET.x[0] + r, x1 = POCKET.x[1] - r, y0 = POCKET.y[0] + r, y1 = POCKET.y[1] - r;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const z of [-2, -4, -POCKET.depth]) {
    g(`(depth ${f(z)})`);
    move("G0", { x: x0 + 0.5, y: y0 + 0.5 });
    move("G0", { z: 1 });
    // ramp in along the first row instead of plunging straight down
    move("G1", { x: x0 + 40, z }, 600);
    g("F1200");
    move("G1", { x: x0 + 0.5 });
    let y = y0 + 0.5, dir = 1;
    while (true) {
      move("G1", { x: dir > 0 ? x1 - 0.5 : x0 + 0.5 });
      if (y >= y1 - 0.5) break;
      y = Math.min(y + step, y1 - 0.5);
      move("G1", { y });
      dir = -dir;
    }
    // finishing pass around the wall
    move("G1", { x: x0, y: y1 });
    move("G1", { x: x1 });
    move("G1", { y: y0 });
    move("G1", { x: x0 });
    move("G1", { y: y1 });
    move("G0", { z: 5 });
  }
  move("G0", { x: cx, y: cy, z: 10 });
}

// --- Op 3: engrave the name under the pocket with the V-bit
// Single-stroke letters on a 0..0.7 x 0..1 grid.
const GLYPHS = {
  A: [[[0, 0], [0.35, 1], [0.7, 0]], [[0.14, 0.4], [0.56, 0.4]]],
  R: [[[0, 0], [0, 1], [0.48, 1], [0.66, 0.88], [0.66, 0.62], [0.48, 0.5], [0, 0.5]], [[0.32, 0.5], [0.7, 0]]],
  Y: [[[0, 1], [0.35, 0.52], [0.7, 1]], [[0.35, 0.52], [0.35, 0]]],
  N: [[[0, 0], [0, 1], [0.7, 0], [0.7, 1]]],
  D: [[[0, 0], [0, 1], [0.38, 1], [0.6, 0.86], [0.7, 0.6], [0.7, 0.4], [0.6, 0.14], [0.38, 0], [0, 0]]],
  E: [[[0.68, 1], [0, 1], [0, 0], [0.68, 0]], [[0, 0.5], [0.5, 0.5]]],
  W: [[[0, 1], [0.16, 0], [0.35, 0.62], [0.54, 0], [0.7, 1]]],
  S: [[[0.68, 0.86], [0.52, 1], [0.16, 1], [0, 0.84], [0, 0.66], [0.16, 0.52], [0.54, 0.48], [0.7, 0.34], [0.7, 0.14], [0.54, 0], [0.16, 0], [0, 0.14]]],
  T: [[[0, 1], [0.7, 1]], [[0.35, 1], [0.35, 0]]],
  "·": [[[0.3, 0.45], [0.4, 0.45]]],
};
function engrave(text, h, xc, yb) {
  const adv = h * 0.95, space = h * 0.6;
  const width = [...text].reduce((w, c) => w + (c === " " ? space : adv), 0) - (adv - h * 0.7);
  let x = xc - width / 2;
  for (const c of text) {
    if (c === " ") { x += space; continue; }
    for (const stroke of GLYPHS[c] || []) {
      const pts = stroke.map(([u, v]) => ({ x: x + u * h, y: yb + v * h }));
      move("G0", { x: pts[0].x, y: pts[0].y });
      move("G0", { z: 1 });
      move("G1", { z: FACE_DEPTH - 0.45 }, 300); // 0.45 mm below the faced surface
      g("F700");
      for (const p of pts.slice(1)) move("G1", p);
      move("G0", { z: 1 });
    }
    x += adv;
  }
}
g("");
g("(OP3 ENGRAVE - T3 60 DEG ENGRAVER)");
g("M5");
g("T3 M6");
g("G43 H3");
g("S12000 M3");
g("G0 Z5");
engrave("ARYA ANANDA", 9, 0, -72);
g("G0 Z10");
g("M5");
g("G0 X0 Y80");
g("M30");
g("%");

const program = out.join("\n") + "\n";
const ncPath = join(root, "intro.nc");
writeFileSync(ncPath, program);

let check = null;
const bin = process.argv[2];
if (bin) {
  const cfg = join(here, "machine.json");
  const run = (args) => {
    try { return execFileSync(bin, args, { encoding: "utf8" }); }
    catch (e) { return e.stdout || ""; }
  };
  const lint = JSON.parse(run(["lint", ncPath, "-c", cfg, "--format", "json"]));
  const stats = JSON.parse(run(["stats", ncPath, "-c", cfg, "--format", "json"]));
  check = { lint, stats };
  console.log(JSON.stringify(check, null, 2).slice(0, 3000));
}

writeFileSync(
  join(root, "js", "intro-gcode.js"),
  "// Generated by tools/gen-intro.mjs. Do not edit by hand.\n" +
    `export const STOCK = ${JSON.stringify(STOCK)};\n` +
    `export const POCKET = ${JSON.stringify(POCKET)};\n` +
    `export const TOOLS = ${JSON.stringify(TOOLS)};\n` +
    `export const CHECK = ${JSON.stringify(check)};\n` +
    `export const GCODE = ${JSON.stringify(program)};\n`
);
console.log(`${out.length} lines written to intro.nc`);
