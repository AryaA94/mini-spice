// The fixture plate and the G-code that machines it, worked out from the
// project list. Shared by the page (js/board.js) and by tools/gen-intro.mjs,
// which writes the same program to intro.nc and checks it with gcode-sim.
//
// The main board holds the featured projects. Everything else goes on
// expansion boards (4 projects each) in their own pockets below it, so the
// plate, and the machining, grow with the portfolio.

export const TOOLS = {
  1: { d: 20, name: "20 mm face mill" },
  2: { d: 8, name: "8 mm end mill" },
  3: { d: 1, v: 60, name: "60° engraver" },
};
export const FACE_DEPTH = -0.5;
export const POCKET_DEPTH = 6;
export const MAIN_POCKET = { x: [-82, 82], y: [-48, 58] };
export const EXP_BOARD = { w: 96, h: 64 }; // pocket is 2 mm bigger all round
export const PER_EXP = 4;

// Hand-placed parts on the main board (board mm, origin at its centre).
export const SPECIAL = {
  "mini-spice": { kind: "qfp", at: [-50, 24] },
  "gcode-sim": { kind: "bga", at: [-16, 24] },
  "purple-plow": { kind: "driver", at: [-12, -27] },
  "cnc-tool-wear": { kind: "esp32", at: [52, 25] },
  "led-matrix": { kind: "ledcube", at: [32, -19] },
  "epaper-display": { kind: "epaper", at: [62, -14] },
};
// Free spots left on the main board for anything else, before it spills over.
export const MAIN_SLOTS = { software: [[-36, -4]], hardware: [] };

/** Where every project goes: { main: [{project, kind, at}], exp: [[project, ...], ...] }. */
export function plan(projects) {
  const main = [], rest = [];
  const free = { software: [...MAIN_SLOTS.software], hardware: [...MAIN_SLOTS.hardware] };
  for (const p of projects) {
    const type = p.type === "hardware" ? "hardware" : "software";
    const sp = SPECIAL[p.slug];
    if (sp) main.push({ project: p, kind: sp.kind, at: sp.at });
    else if (free[type].length) main.push({ project: p, kind: type === "hardware" ? "module" : "soic", at: free[type].shift() });
    else rest.push(p);
  }
  // always at least one row of two expansion boards: room for what's next
  const n = Math.max(2, Math.ceil(rest.length / PER_EXP));
  const exp = [...Array(n)].map((_, k) => rest.slice(k * PER_EXP, (k + 1) * PER_EXP));
  return { main, exp };
}

/** Stock and pockets for n expansion boards (two per row). */
export function layout(nExp) {
  const rows = Math.ceil(nExp / 2);
  const pockets = [{ x: [...MAIN_POCKET.x], y: [...MAIN_POCKET.y], kind: "main" }];
  const exps = [];
  for (let k = 0; k < nExp; k++) {
    const row = Math.floor(k / 2), cx = k % 2 ? 53 : -53;
    const top = -60 - row * 76, cy = top - 34;
    exps.push({ cx, cy });
    pockets.push({ x: [cx - 50, cx + 50], y: [cy - 34, cy + 34], kind: "exp" });
  }
  const lowest = rows ? -60 - (rows - 1) * 76 - 68 : MAIN_POCKET.y[0];
  return {
    stock: { x: [-110, 110], y: [lowest - 26, 80], z: [-20, 0] },
    pockets, exps,
    engraveY: lowest - 19,
  };
}

// Single-stroke letters on a 0..0.7 x 0..1 grid.
const GLYPHS = {
  A: [[[0, 0], [0.35, 1], [0.7, 0]], [[0.14, 0.4], [0.56, 0.4]]],
  R: [[[0, 0], [0, 1], [0.48, 1], [0.66, 0.88], [0.66, 0.62], [0.48, 0.5], [0, 0.5]], [[0.32, 0.5], [0.7, 0]]],
  Y: [[[0, 1], [0.35, 0.52], [0.7, 1]], [[0.35, 0.52], [0.35, 0]]],
  N: [[[0, 0], [0, 1], [0.7, 0], [0.7, 1]]],
  D: [[[0, 0], [0, 1], [0.38, 1], [0.6, 0.86], [0.7, 0.6], [0.7, 0.4], [0.6, 0.14], [0.38, 0], [0, 0]]],
};

/** The whole program as text. */
export function program(lay) {
  const out = [];
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  const g = (s) => out.push(s);
  const move = (code, p, feed) =>
    g(`${code}${p.x !== undefined ? " X" + f(p.x) : ""}${p.y !== undefined ? " Y" + f(p.y) : ""}${p.z !== undefined ? " Z" + f(p.z) : ""}${feed ? " F" + feed : ""}`);
  const S = lay.stock;
  const W = S.x[1] - S.x[0], D = S.y[1] - S.y[0];

  g("%");
  g("(ARYA ANANDA - PORTFOLIO FIXTURE PLATE)");
  g(`(Stock ${W} x ${D} x 20 mm 6061 aluminium. Work zero: X centre, Y 80 mm from the back edge, top face.)`);
  g(`(${lay.pockets.length} pockets: the main board and ${lay.exps.length} expansion boards.)`);
  g("G21 G17 G90 G94");
  g("G54");

  // --- Op 1: face the top, zig-zag with the face mill
  g("");
  g("(OP1 FACE - T1 20 MM FACE MILL)");
  g("T1 M6");
  g("G43 H1");
  g("S6000 M3");
  g("G0 Z10");
  {
    const r = TOOLS[1].d / 2, step = 14;
    let y = S.y[0] + r - 4, dir = 1;
    move("G0", { x: S.x[0] - r - 4, y });
    move("G0", { z: 2 });
    move("G1", { z: FACE_DEPTH }, 400);
    g("F1500");
    while (true) {
      move("G1", { x: dir > 0 ? S.x[1] + r + 4 : S.x[0] - r - 4 });
      if (y >= S.y[1] - r + 4) break;
      y = Math.min(y + step, S.y[1] - r + 4);
      move("G1", { y });
      dir = -dir;
    }
    move("G0", { z: 10 });
  }

  // --- Op 2: the pockets, three 2 mm levels each, then a finishing contour
  g("");
  g("(OP2 POCKETS - T2 8 MM END MILL)");
  g("M5");
  g("T2 M6");
  g("G43 H2");
  g("S10000 M3");
  g("G0 Z10");
  lay.pockets.forEach((pk, n) => {
    const r = TOOLS[2].d / 2, step = 5.5;
    const x0 = pk.x[0] + r, x1 = pk.x[1] - r, y0 = pk.y[0] + r, y1 = pk.y[1] - r;
    g(`(pocket ${n + 1}: ${pk.kind === "main" ? "main board" : "expansion board " + n})`);
    for (const z of [-2, -4, -POCKET_DEPTH]) {
      move("G0", { x: x0 + 0.5, y: y0 + 0.5 });
      move("G0", { z: 1 });
      // ramp in along the first row instead of plunging straight down
      move("G1", { x: x0 + Math.min(40, (x1 - x0) * 0.6), z }, 600);
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
  });
  move("G0", { z: 10 });

  // --- Op 3: engrave the name along the front edge with the V-bit
  g("");
  g("(OP3 ENGRAVE - T3 60 DEG ENGRAVER)");
  g("M5");
  g("T3 M6");
  g("G43 H3");
  g("S12000 M3");
  g("G0 Z5");
  {
    const text = "ARYA ANANDA", h = 9, adv = h * 0.95, space = h * 0.6;
    const width = [...text].reduce((w, c) => w + (c === " " ? space : adv), 0) - (adv - h * 0.7);
    let x = -width / 2;
    for (const c of text) {
      if (c === " ") { x += space; continue; }
      for (const stroke of GLYPHS[c] || []) {
        const pts = stroke.map(([u, v]) => ({ x: x + u * h, y: lay.engraveY + v * h }));
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
  g("G0 Z10");
  g("M5");
  g("G0 X0 Y80");
  g("M30");
  g("%");
  return out.join("\n") + "\n";
}
