// The 3D landing page: a block of aluminium is machined by the G-code in
// intro.nc, then a circuit board drops into the pocket. Each part on the
// board is a project; click one to open it. Project data lives in projects.js.

import * as THREE from "./three.module.min.js";
import { OrbitControls } from "./OrbitControls.js";
import { RoomEnvironment } from "./RoomEnvironment.js";
import { GCODE as CHECKED_GCODE, CHECK } from "./intro-gcode.js";
import { TOOLS, POCKET_DEPTH, MAIN_POCKET, EXP_BOARD, plan, layout, program } from "./fixture.js";

// canvas text (part markings, silkscreen) needs the web font loaded first
await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);

const PROJECTS = window.PROJECTS || [];
const PROFILE = window.PROFILE || {};
// the plate grows with the project list: see js/fixture.js
const PLAN = plan(PROJECTS);
const LAY = layout(PLAN.exp.length);
const GCODE = program(LAY);
const STOCK = LAY.stock;
const STOCK_ZC = -(STOCK.y[0] + STOCK.y[1]) / 2; // scene z of the plate's centre
const STOCK_D = STOCK.y[1] - STOCK.y[0];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^\s*(javascript|data|vbscript):/i.test(String(u || "")) ? "#" : String(u || "#"));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = matchMedia("(max-width: 760px)").matches;
const lite = small || matchMedia("(pointer: coarse)").matches;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeBack = (t) => { const c = 1.25; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/* ================= renderer, scene, camera ================= */

const canvas = $("#scene");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (e) {
  location.replace("work.html" + location.hash);
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lite ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

const camera = new THREE.PerspectiveCamera(30, 1, 5, 5000);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.6, zoomSpeed: 0.8,
  minDistance: 110, maxDistance: 900, minPolarAngle: 0.12, maxPolarAngle: 1.22,
});

scene.add(new THREE.HemisphereLight(0xfff3e4, 0x1b1622, 0.45));
const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
key.position.set(-150, 320, 190);
key.castShadow = true;
key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
{
  const half = Math.max(STOCK.x[1] - STOCK.x[0], STOCK_D) / 2 + 40;
  Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 50, far: 900 });
  key.position.z += STOCK_ZC;
  key.target.position.set(0, 0, STOCK_ZC);
  scene.add(key.target);
}
key.shadow.bias = -0.0008;
key.shadow.normalBias = 1.2;
scene.add(key);
const rim = new THREE.DirectionalLight(0xa58bff, 0.35);
rim.position.set(220, 140, -240);
scene.add(rim);

const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.ShadowMaterial({ opacity: 0.45 }));
catcher.rotation.x = -Math.PI / 2;
catcher.position.y = STOCK.z[0] - 0.05;
catcher.receiveShadow = true;
scene.add(catcher);

/* camera framing: the view direction stays fixed, the distance fits the width */
const OVERVIEW_DIR = new THREE.Vector3(0, 0.8, 0.6).normalize();
const INTRO_DIR = new THREE.Vector3(-0.18, 0.6, 0.78).normalize();
function fitDistance(width, height) {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return Math.max(width / 2 / Math.tan(hfov / 2), height / 2 / Math.tan(vfov / 2));
}
function overviewPose() {
  const target = new THREE.Vector3(0, -4, STOCK_ZC + (small ? 0 : 6));
  const d = fitDistance(small ? 226 : 290, STOCK_D * 1.02 + 16);
  return { pos: target.clone().addScaledVector(OVERVIEW_DIR, d), target };
}
function introPose() {
  const target = new THREE.Vector3(0, -6, STOCK_ZC);
  const d = fitDistance(small ? 250 : 320, STOCK_D * 0.95 + 20);
  return { pos: target.clone().addScaledVector(INTRO_DIR, d), target };
}

let camTween = null;
function flyTo(pose, dur = 1.2) {
  if (reduced) dur = 0.01;
  camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pose.pos, t1: pose.target, t: 0, dur };
}

/* view offset: keep the subject centred in the space the panel leaves */
let viewOffset = { x: 0, y: 0, tx: 0, ty: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  applyViewOffset();
}
function applyViewOffset() {
  const w = innerWidth, h = innerHeight;
  if (Math.abs(viewOffset.x) < 0.5 && Math.abs(viewOffset.y) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(w, h, viewOffset.x, viewOffset.y, w, h);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
{
  const p = introPose();
  camera.position.copy(p.pos);
  controls.target.copy(p.target);
}

/* ================= the stock: a height map ================= */

const RES = lite ? 1.0 : 0.5; // mm per sample
const SX = STOCK.x, SY = STOCK.y;
const NX = Math.round((SX[1] - SX[0]) / RES) + 1;
const NZ = Math.round((SY[1] - SY[0]) / RES) + 1;
const DX = (SX[1] - SX[0]) / (NX - 1), DZ = (SY[1] - SY[0]) / (NZ - 1);
const H = new Float32Array(NX * NZ);
const hmPos = new Float32Array(NX * NZ * 3);
const hmNrm = new Float32Array(NX * NZ * 3);
const hmCol = new Float32Array(NX * NZ * 3);
// scene axes: G-code X -> x, G-code Y -> -z, G-code Z -> y. Row j = 0 is the far edge (Y max).
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const k = j * NX + i;
  hmPos[k * 3] = SX[0] + i * DX;
  hmPos[k * 3 + 2] = -SY[1] + j * DZ;
}
const hmIdx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
for (let j = 0, n = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
  const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
  hmIdx[n++] = a; hmIdx[n++] = c; hmIdx[n++] = b;
  hmIdx[n++] = b; hmIdx[n++] = c; hmIdx[n++] = d;
}
const hmGeo = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(hmPos, 3).setUsage(THREE.DynamicDrawUsage);
const nrmAttr = new THREE.BufferAttribute(hmNrm, 3).setUsage(THREE.DynamicDrawUsage);
const colAttr = new THREE.BufferAttribute(hmCol, 3).setUsage(THREE.DynamicDrawUsage);
hmGeo.setAttribute("position", posAttr);
hmGeo.setAttribute("normal", nrmAttr);
hmGeo.setAttribute("color", colAttr);
hmGeo.setIndex(new THREE.BufferAttribute(hmIdx, 1));
hmGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
const aluMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.42 });
const stockTop = new THREE.Mesh(hmGeo, aluMat);
stockTop.receiveShadow = true;
scene.add(stockTop);

// the four sides follow the top surface's edge, so facing the top shows on them
const sideMat = new THREE.MeshStandardMaterial({ color: 0x5d6168, metalness: 1, roughness: 0.55, side: THREE.DoubleSide });
const strips = [];
function makeStrip(cells, normal) {
  const n = cells.length, p = new Float32Array(n * 6), nr = new Float32Array(n * 6), idx = [];
  cells.forEach((k, s) => {
    for (const [o, y] of [[0, 0], [1, STOCK.z[0]]]) {
      p[(s * 2 + o) * 3] = hmPos[k * 3];
      p[(s * 2 + o) * 3 + 1] = y;
      p[(s * 2 + o) * 3 + 2] = hmPos[k * 3 + 2];
      nr.set(normal, (s * 2 + o) * 3);
    }
    if (s < n - 1) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nr, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, sideMat);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  strips.push({ cells, attr: g.attributes.position });
}
makeStrip([...Array(NX)].map((_, i) => i), [0, 0, -1]);
makeStrip([...Array(NX)].map((_, i) => (NZ - 1) * NX + i), [0, 0, 1]);
makeStrip([...Array(NZ)].map((_, j) => j * NX), [-1, 0, 0]);
makeStrip([...Array(NZ)].map((_, j) => j * NX + NX - 1), [1, 0, 0]);
{
  // the bottom, for the shadow and for anyone who orbits low
  const b = new THREE.Mesh(new THREE.PlaneGeometry(SX[1] - SX[0], SY[1] - SY[0]), sideMat);
  b.rotation.x = Math.PI / 2;
  b.position.y = STOCK.z[0];
  b.castShadow = true;
  scene.add(b);
}

let dI0, dI1, dJ0, dJ1;
const clearDirty = () => { dI0 = dJ0 = Infinity; dI1 = dJ1 = -Infinity; };
clearDirty();

function resetStock() {
  H.fill(0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < NX * NZ; k++) {
    const s = 0.34 + rnd() * 0.03; // raw mill-finish plate: duller and darker than a cut face
    hmCol[k * 3] = s; hmCol[k * 3 + 1] = s * 1.02; hmCol[k * 3 + 2] = s * 1.05;
    hmPos[k * 3 + 1] = 0;
    hmNrm[k * 3] = 0; hmNrm[k * 3 + 1] = 1; hmNrm[k * 3 + 2] = 0;
  }
  for (const a of [posAttr, nrmAttr, colAttr]) { a.clearUpdateRanges(); a.needsUpdate = true; }
  for (const s of strips) { s.cells.forEach((k, n) => s.attr.setY(n * 2, 0)); s.attr.needsUpdate = true; }
  clearDirty();
}

const TAN30 = Math.tan(Math.PI / 6);
// Cut the volume the tool sweeps along one straight move (a capsule), so walls
// come out straight instead of scalloped by a row of discrete circles.
// `along` is how far into the move this piece starts, for the tool marks.
function stampSeg(ax, ay, az, bx, by, bz, tool, along) {
  if (az > 0 && bz > 0) return;
  const r = tool.d / 2, zmin = Math.min(az, bz);
  const reach = tool.v ? r + Math.max(0, -zmin) * TAN30 : r;
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - SX[0]) / DX)), i1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx) + reach - SX[0]) / DX));
  const j0 = Math.max(0, Math.floor((SY[1] - Math.max(ay, by) - reach) / DZ)), j1 = Math.min(NZ - 1, Math.ceil((SY[1] - Math.min(ay, by) + reach) / DZ));
  if (i0 > i1 || j0 > j1) return;
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, L = Math.sqrt(L2), r2 = reach * reach, face = tool.d >= 16;
  let touched = false;
  for (let j = j0; j <= j1; j++) {
    const Y = SY[1] - j * DZ;
    for (let i = i0; i <= i1; i++) {
      const X = SX[0] + i * DX;
      let t = L2 > 1e-9 ? ((X - ax) * vx + (Y - ay) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + vx * t - X, py = ay + vy * t - Y, d2 = px * px + py * py;
      if (d2 > r2) continue;
      const z = az + (bz - az) * t, d = Math.sqrt(d2);
      const h = tool.v ? z + Math.max(0, d - r) / TAN30 : z;
      if (h > 0) continue;
      const k = j * NX + i;
      if (h >= H[k] - 1e-4) continue;
      H[k] = h;
      // tool marks: the cutter's trailing edge leaves arcs of its own radius
      // (constant along-path position minus the half-chord); engravings are dark
      const arc = along + t * L - Math.sqrt(Math.max(0, r * r - d2));
      const s = tool.v ? 0.16 + 0.3 * Math.min(1, (h - z) / 0.45) : face ? 0.64 + 0.035 * Math.cos(arc * 1.3) : 0.55 + 0.03 * Math.cos(arc * 2.2);
      hmCol[k * 3] = s * 0.985; hmCol[k * 3 + 1] = s; hmCol[k * 3 + 2] = s * 1.02;
      touched = true;
    }
  }
  if (touched) {
    if (i0 < dI0) dI0 = i0; if (i1 > dI1) dI1 = i1;
    if (j0 < dJ0) dJ0 = j0; if (j1 > dJ1) dJ1 = j1;
  }
}

function flush() {
  if (dI0 > dI1) return;
  const i0 = Math.max(0, dI0 - 1), i1 = Math.min(NX - 1, dI1 + 1), j0 = Math.max(0, dJ0 - 1), j1 = Math.min(NZ - 1, dJ1 + 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * NX + i;
    hmPos[k * 3 + 1] = H[k];
    const hl = H[i > 0 ? k - 1 : k], hr = H[i < NX - 1 ? k + 1 : k];
    const hu = H[j > 0 ? k - NX : k], hd = H[j < NZ - 1 ? k + NX : k];
    let nx = -(hr - hl) / (2 * DX), nz = -(hd - hu) / (2 * DZ);
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    hmNrm[k * 3] = nx * inv; hmNrm[k * 3 + 1] = inv; hmNrm[k * 3 + 2] = nz * inv;
  }
  const start = j0 * NX * 3, count = (j1 - j0 + 1) * NX * 3;
  for (const a of [posAttr, nrmAttr, colAttr]) { a.clearUpdateRanges(); a.addUpdateRange(start, count); a.needsUpdate = true; }
  if (i0 === 0 || j0 === 0 || i1 === NX - 1 || j1 === NZ - 1) {
    for (const s of strips) { s.cells.forEach((k, n) => s.attr.setY(n * 2, H[k])); s.attr.needsUpdate = true; }
  }
  clearDirty();
}

/* ================= the spindle and tool ================= */

function stripeTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#c3c8ce"; x.fillRect(0, 0, 64, 128);
  x.strokeStyle = "#5d6168"; x.lineWidth = 9;
  for (let y = -128; y < 256; y += 32) { x.beginPath(); x.moveTo(0, y); x.lineTo(64, y + 48); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const steel = new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.25 });
const paint = new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.4, roughness: 0.5 });
const carbide = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.3, map: stripeTexture() });
const toolRig = new THREE.Group();
const holder = new THREE.Group();
{
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 9, 40), steel); nut.position.y = 4.5;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(20, 15, 32, 40), steel); body.position.y = 25;
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 8, 48), paint); flange.position.y = 45;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 220, 48), paint); head.position.y = 159;
  for (const m of [nut, body, flange, head]) { m.castShadow = true; holder.add(m); }
}
toolRig.add(holder);
let cutter = null;
function setTool(n) {
  if (cutter) { toolRig.remove(cutter); cutter.traverse((o) => o.geometry && o.geometry.dispose()); }
  const t = TOOLS[n] || TOOLS[1];
  cutter = new THREE.Group();
  const r = t.d / 2;
  let stick;
  if (t.v) {
    const h = (3 - 0.5) / TAN30;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(3, 0.5, h, 32), carbide); cone.position.y = h / 2;
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 18, 32), steel); shank.position.y = h + 9;
    cutter.add(cone, shank); stick = h + 18;
  } else {
    const fl = 22;
    const flutes = new THREE.Mesh(new THREE.CylinderGeometry(r, r, fl, 40), carbide); flutes.position.y = fl / 2;
    carbide.map.repeat.set(Math.max(1, Math.round(r / 2)), 1);
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(r, 8), Math.min(r, 8), 14, 40), steel); shank.position.y = fl + 7;
    cutter.add(flutes, shank); stick = fl + 14;
  }
  cutter.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  holder.position.y = stick;
  toolRig.add(cutter);
}
setTool(1);
scene.add(toolRig);

/* chips flying off the cutter */
const CHIPS = lite ? 260 : 700;
const chipPos = new Float32Array(CHIPS * 3).fill(-9999);
const chipVel = new Float32Array(CHIPS * 3);
const chipLife = new Float32Array(CHIPS);
const chipGeo = new THREE.BufferGeometry();
chipGeo.setAttribute("position", new THREE.BufferAttribute(chipPos, 3));
const chips = new THREE.Points(chipGeo, new THREE.PointsMaterial({ color: 0xe3e6ea, size: lite ? 2.2 : 1.5, sizeAttenuation: true }));
chips.frustumCulled = false;
scene.add(chips);
let chipNext = 0;
function spawnChips(x, y, z, r, n) {
  for (let s = 0; s < n; s++) {
    const i = chipNext++ % CHIPS, a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
    chipPos[i * 3] = x + Math.cos(a) * r; chipPos[i * 3 + 1] = y + 0.5; chipPos[i * 3 + 2] = z + Math.sin(a) * r;
    chipVel[i * 3] = Math.cos(a) * sp; chipVel[i * 3 + 1] = 40 + Math.random() * 120; chipVel[i * 3 + 2] = Math.sin(a) * sp;
    chipLife[i] = 0.6 + Math.random() * 0.6;
  }
}
function updateChips(dt) {
  for (let i = 0; i < CHIPS; i++) {
    if (chipLife[i] <= 0) continue;
    chipLife[i] -= dt;
    chipVel[i * 3 + 1] -= 520 * dt;
    chipPos[i * 3] += chipVel[i * 3] * dt; chipPos[i * 3 + 1] += chipVel[i * 3 + 1] * dt; chipPos[i * 3 + 2] += chipVel[i * 3 + 2] * dt;
    if (chipLife[i] <= 0 || chipPos[i * 3 + 1] < STOCK.z[0]) { chipLife[i] = 0; chipPos[i * 3 + 1] = -9999; }
  }
  chipGeo.attributes.position.needsUpdate = true;
}

/* ================= the program ================= */

const prog = (() => {
  const lines = GCODE.replace(/\n$/, "").split("\n");
  const segs = [], opAt = [];
  let p = { x: 0, y: 0, z: 60 }, mode = 0, feed = 1000, tool = 1, pendingT = null, op = "SETUP";
  lines.forEach((raw, li) => {
    const m = raw.match(/^\((OP\d+ [^)]*)\)/);
    if (m) op = m[1];
    opAt[li] = op;
    const line = raw.replace(/\(.*?\)/g, "").replace(/;.*$/, "").trim().toUpperCase();
    if (!line || line === "%") return;
    let nx = p.x, ny = p.y, nz = p.z, has = false;
    for (const [, L, v] of line.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)) {
      const n = parseFloat(v);
      if (L === "G" && (n === 0 || n === 1)) mode = n;
      else if (L === "X") { nx = n; has = true; }
      else if (L === "Y") { ny = n; has = true; }
      else if (L === "Z") { nz = n; has = true; }
      else if (L === "F") feed = n;
      else if (L === "T") pendingT = n;
      else if (L === "M" && n === 6 && pendingT !== null) { tool = pendingT; segs.push({ type: "tool", tool, line: li }); }
      else if (L === "M" && n === 3) segs.push({ type: "spin", on: true, line: li });
      else if (L === "M" && (n === 5 || n === 30)) segs.push({ type: "spin", on: false, line: li });
    }
    if (has) {
      const b = { x: nx, y: ny, z: nz }, len = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
      if (len > 1e-6) segs.push({ type: "move", a: p, b, len, rapid: mode === 0, feed, tool, line: li });
      p = b;
    }
  });
  // squeeze ~13 real minutes into a few seconds, keeping the feeds' ratios
  const realCut = segs.reduce((s, g) => s + (g.type === "move" && !g.rapid ? g.len / (g.feed / 60) : 0), 0);
  const K = realCut / (lite ? 8.5 : 10.5);
  let t = 0.4;
  for (const g of segs) {
    g.t0 = t;
    if (g.type === "move") t += g.rapid ? g.len / (6000 / 60) / (K * 1.6) : g.len / (g.feed / 60) / K;
    else if (g.type === "tool") t += 0.45;
    g.t1 = t;
  }
  return { lines, segs, opAt, total: t + 0.2 };
})();

/* HUD: the G-code scrolls as it runs */
const gl = $("#gcode-lines"), opName = $("#op-name"), opTool = $("#op-tool"), progEl = $("#gcode-progress");
const WINDOW = small ? 5 : 9;
let shownLine = -1;
function showLine(li) {
  if (li === shownLine) return;
  shownLine = li;
  const from = clamp(li - Math.floor(WINDOW / 2), 0, Math.max(0, prog.lines.length - WINDOW));
  let html = "";
  for (let n = from; n < from + WINDOW && n < prog.lines.length; n++) {
    const t = prog.lines[n];
    html += `<li class="${n === li ? "on" : ""}${/^\(/.test(t) ? " c" : ""}"><b>${n + 1}</b>${esc(t)}</li>`;
  }
  gl.innerHTML = html;
  const op = prog.opAt[li] || "";
  opName.textContent = op.replace(/ - .*/, "") || "SETUP";
  const tm = op.match(/ - (.*)/);
  opTool.textContent = tm ? tm[1] : "";
}
if (CHECK && GCODE === CHECKED_GCODE) {
  const l = CHECK.lint, s = CHECK.stats.time_s.total;
  $("#check-text").textContent = `${l.errors} errors · ${l.warnings} warnings · ${Math.floor(s / 60)} min ${Math.round(s % 60)} s on a benchtop mill · ${CHECK.stats.lines} lines`;
} else {
  // projects changed since the last check: still real G-code, just not re-checked yet
  document.querySelector(".check-title").textContent = "G-code generated for this portfolio";
  $("#check-text").textContent = `${prog.lines.length} lines · ${LAY.pockets.length} pockets`;
}

/* playback */
const sim = { t: 0, i: 0, u: 0, spin: false, tool: 1, running: false, done: false };
const toolPos = new THREE.Vector3(0, 60, 0);
function placeTool(x, y, z) { toolPos.set(x, z, -y); toolRig.position.copy(toolPos); }
function cutAlong(g, u0, u1) {
  if (g.rapid) return;
  const at = (u, k) => g.a[k] + (g.b[k] - g.a[k]) * u;
  stampSeg(at(u0, "x"), at(u0, "y"), at(u0, "z"), at(u1, "x"), at(u1, "y"), at(u1, "z"), TOOLS[g.tool], u0 * g.len);
}
function applyEvent(g) {
  if (g.type === "tool") { sim.tool = g.tool; setTool(g.tool); }
  else if (g.type === "spin") sim.spin = g.on;
}
function stepSim(dt) {
  sim.t += dt;
  let cutting = false;
  while (sim.i < prog.segs.length) {
    const g = prog.segs[sim.i];
    if (g.type !== "move") {
      if (sim.u === 0) { applyEvent(g); sim.u = 1e-9; }
      if (sim.t < g.t1) break;
      sim.i++; sim.u = 0; continue;
    }
    const u = clamp((sim.t - g.t0) / (g.t1 - g.t0), 0, 1);
    if (u > sim.u) { cutAlong(g, sim.u, u); sim.u = u; }
    placeTool(g.a.x + (g.b.x - g.a.x) * u, g.a.y + (g.b.y - g.a.y) * u, g.a.z + (g.b.z - g.a.z) * u);
    showLine(g.line);
    cutting = !g.rapid && toolPos.y <= 0.01;
    if (u < 1) break;
    sim.i++; sim.u = 0;
  }
  if (cutting && sim.spin) spawnChips(toolPos.x, toolPos.y, toolPos.z, TOOLS[sim.tool].d / 2, lite ? 2 : 4);
  progEl.style.width = `${clamp(sim.t / prog.total, 0, 1) * 100}%`;
  if (sim.i >= prog.segs.length && !sim.done) { sim.done = true; finishMachining(false); }
}
function machineInstantly() {
  for (; sim.i < prog.segs.length; sim.i++) {
    const g = prog.segs[sim.i];
    if (g.type === "move") { cutAlong(g, sim.u, 1); placeTool(g.b.x, g.b.y, g.b.z); }
    else applyEvent(g);
    sim.u = 0;
  }
  flush();
  showLine(prog.lines.length - 1);
}

/* ================= the board ================= */

const BW = 160, BH = 102, BT = 1.6; // board size, mm
const boardRoot = new THREE.Group(); // board origin: centre of its bottom face
const BOARD_Y = -POCKET_DEPTH;
const BOARD_Z = -(MAIN_POCKET.y[0] + MAIN_POCKET.y[1]) / 2;
boardRoot.position.set(0, 140, BOARD_Z);
boardRoot.visible = false;
scene.add(boardRoot);
const P = (bx, by, y = BT) => new THREE.Vector3(bx, y, -by);

// materials shared by the parts (X-ray fades them all)
const M = {
  plastic: new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.55, metalness: 0 }),
  tin: new THREE.MeshStandardMaterial({ color: 0xd2d4d8, roughness: 0.3, metalness: 1 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xe0b45c, roughness: 0.3, metalness: 1 }),
  can: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.22, metalness: 1 }),
  substrate: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.6 }),
  bga: new THREE.MeshStandardMaterial({ color: 0x2e3b2f, roughness: 0.6 }),
  anod: new THREE.MeshStandardMaterial({ color: 0x5e2f9c, roughness: 0.35, metalness: 0.65 }),
  green: new THREE.MeshStandardMaterial({ color: 0x2f8a4a, roughness: 0.6 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xc7a46e, roughness: 0.6 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x1c1a24, roughness: 0.45, metalness: 0.2 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
  oledPcb: new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.1, metalness: 0.2 }),
};
const xrayMats = Object.values(M);

function textTexture(lines, w, h, { color = "#9d9aa4", px = 26, bold = false, align = "center", bg = null } = {}) {
  const S = 512 / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.max(8, Math.round(w * S)); c.height = Math.max(8, Math.round(h * S));
  const x = c.getContext("2d");
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  x.fillStyle = color; x.textAlign = align; x.textBaseline = "middle";
  const lh = px * 1.35, top = c.height / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    const size = i === 0 ? px : px * 0.72;
    x.font = `${bold && i === 0 ? 700 : 500} ${size}px "JetBrains Mono", monospace`;
    x.fillText(l, align === "center" ? c.width / 2 : 14, top + i * lh);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function decal(tex, w, h, y) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  xrayMats.push(m.material);
  return m;
}
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
};
const cyl = (r, h, mat, x = 0, y = 0, z = 0, seg = 28) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
};
function led(color, x, z) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0, roughness: 0.3 });
  const m = box(1.6, 0.7, 0.9, mat, x, 0, z);
  return { mesh: m, mat };
}
// pins along the edges of a square package, as one instanced mesh
function gullPins(w, pitch = 0.65) {
  const n = Math.floor((w - 3) / pitch), span = (n - 1) * pitch;
  const geo = new THREE.BoxGeometry(0.3, 0.22, 1.5);
  const inst = new THREE.InstancedMesh(geo, M.tin, n * 4);
  const o = new THREE.Object3D();
  let c = 0;
  for (let side = 0; side < 4; side++) for (let k = 0; k < n; k++) {
    const t = -span / 2 + k * pitch, e = w / 2 + 0.6;
    const [x, z] = [[t, e], [e, -t], [-t, -e], [-e, t]][side];
    o.position.set(x, 0.2, z);
    o.rotation.set(0, side % 2 ? Math.PI / 2 : 0, 0);
    o.updateMatrix();
    inst.setMatrixAt(c++, o.matrix);
  }
  inst.castShadow = true;
  return inst;
}

// --- part models. Each returns { group, w, h, top } with w x h the footprint in mm.
const MODELS = {
  qfp(p, ref) {
    const s = 22, g = new THREE.Group();
    g.add(box(s, 1.5, s, M.plastic, 0, 0.15), gullPins(s));
    const dot = cyl(0.7, 0.05, M.tin, -s / 2 + 2, 1.65, s / 2 - 2); g.add(dot);
    g.add(decal(textTexture([p.title.toUpperCase(), (p.tags || [])[0] || "", ref], s * 0.86, s * 0.6, { px: 40, bold: true }), s * 0.86, s * 0.6, 1.67));
    return { group: g, w: s + 3.4, h: s + 3.4, top: 1.7 };
  },
  bga(p, ref) {
    const s = 19, g = new THREE.Group();
    g.add(box(s + 2, 0.55, s + 2, M.bga));
    g.add(box(s * 0.74, 0.7, s * 0.74, M.can, 0, 0.55));
    g.add(decal(textTexture([p.title.toUpperCase(), (p.tags || [])[1] || "", ref], s * 0.7, s * 0.5, { px: 40, bold: true, color: "#3c3f46" }), s * 0.7, s * 0.5, 1.27));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr = s / 2 + 2.6;
      const c = box(1, 0.5, 0.5, M.ceramic, Math.cos(a) * rr, 0, Math.sin(a) * rr);
      c.rotation.y = -a;
      g.add(c);
    }
    return { group: g, w: s + 6, h: s + 6, top: 1.3 };
  },
  esp32(p, ref) {
    const g = new THREE.Group();
    // ESP32 module, antenna end away from the viewer
    const sub = box(18, 0.8, 25.5, M.substrate); g.add(sub);
    g.add(box(16, 2.4, 17.5, M.can, 0, 0.8, 3.4));
    g.add(decal(textTexture(["ESP32-WROOM-32", "Wi-Fi + BT"], 14, 7, { px: 34, bold: true, color: "#5a5e66" }), 14, 7, 3.22));
    g.children[2].position.z = 3.4;
    const ant = decal(antennaTexture(), 17, 6.5, 0.82); ant.position.z = -9.2; g.add(ant);
    // the accelerometer and the two status LEDs from the real build
    const ax = box(3, 1, 5, M.plastic, -17, 0, -6); g.add(ax);
    const axl = decal(textTexture(["ADXL", "345"], 3, 5, { px: 64, bold: true }), 2.6, 4.4, 1.02); axl.position.set(-17, 1.02, -6); g.add(axl);
    const ok = led(0x39ff6a, -17, 4), bad = led(0xff3b3b, -17, 7.5);
    g.add(ok.mesh, bad.mesh);
    return { group: g, w: 40, h: 28, top: 3.2, cx: -8, extra: { ok, bad } };
  },
  driver(p, ref) {
    const g = new THREE.Group();
    // purple anodised heatsink over two MOSFETs, and the motor terminal block
    g.add(box(26, 2, 14, M.anod, -4, 0, -2));
    for (let k = 0; k < 9; k++) g.add(box(1.1, 11, 14, M.anod, -16 + k * 3, 2, -2));
    for (const x of [-10, 2]) {
      g.add(box(10, 4.4, 4, M.plastic, x, 0, 7));
      for (const d of [-2.54, 0, 2.54]) g.add(box(0.8, 0.5, 4, M.tin, x + d, 0.6, 10.5));
    }
    g.add(box(10, 8, 8, M.green, 16, 0, 0));
    for (const z of [-2, 2]) g.add(cyl(1.4, 0.6, M.tin, 16, 8, z));
    return { group: g, w: 38, h: 22, top: 13, cx: 1 };
  },
  ledcube() {
    // 3x3x3 cube on a little perfboard, with the DIP switch that picks the pattern
    const g = new THREE.Group(), leds = [];
    g.add(box(17, 0.8, 17, M.substrate, -3, 0, 0));
    for (let l = 0; l < 3; l++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x9fc2ff, emissive: 0x3d7bff, emissiveIntensity: 0, roughness: 0.15, transparent: true, opacity: 0.9 });
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10), mat);
      m.position.set(-3 + (c - 1) * 5, 3.2 + l * 4.5, (r - 1) * 5);
      m.castShadow = true;
      g.add(m);
      leds.push({ mat, l, r, c });
    }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.add(cyl(0.18, 12.5, M.tin, -3 + (c - 1) * 5, 0.8, (r - 1) * 5, 6));
    for (let l = 0; l < 3; l++) for (let r = 0; r < 3; r++) { const w = box(10.5, 0.3, 0.3, M.tin, -3, 2.1 + l * 4.5, (r - 1) * 5); g.add(w); }
    const dip = box(4, 1.8, 11, new THREE.MeshStandardMaterial({ color: 0xd63a3a, roughness: 0.5 }), 9.5, 0, 0);
    g.add(dip);
    for (let k = 0; k < 8; k++) g.add(box(1.4, 0.5, 0.8, M.white, 9.5, 1.8, -4.4 + k * 1.26));
    return { group: g, w: 26, h: 18, top: 14, cx: 0, extra: { leds } };
  },
  epaper() {
    // WeAct 4.2" e-paper module with the joystick beside it. E-paper keeps its
    // picture without power, so the screen shows whether the board is on or not.
    const g = new THREE.Group();
    g.add(box(24, 1, 19, M.substrate, -3, 0, 0));
    g.add(box(21, 0.6, 15.5, M.glass, -3, 1, -0.6));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 14.2), new THREE.MeshStandardMaterial({ map: epaperTexture(), roughness: 0.9 }));
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(-3, 1.62, -0.6);
    g.add(screen);
    // KY-023 joystick: base, gimbal and knurled cap
    g.add(box(6, 1.6, 6, M.plastic, 12, 0, 0));
    g.add(cyl(1, 4, M.tin, 12, 1.6, 0, 12));
    g.add(cyl(2.6, 2.2, new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.7 }), 12, 5.2, 0, 18));
    return { group: g, w: 30, h: 20, top: 7.4, cx: 1.5 };
  },
  oled(p) {
    const g = new THREE.Group();
    g.add(box(27, 1.2, 27, M.oledPcb));
    g.add(box(25.5, 1, 14.5, M.glass, 0, 1.2, 1.5));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: oled.tex, toneMapped: false }));
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(0, 2.25, 1.5);
    g.add(screen);
    for (let k = 0; k < 4; k++) g.add(cyl(0.5, 2.5, M.gold, -3.8 + k * 2.54, 1.2, -11.5, 10));
    return { group: g, w: 28, h: 28, top: 2.3 };
  },
  usbc() {
    const g = new THREE.Group();
    g.add(box(9, 3.2, 7.4, M.can));
    g.add(box(7, 1.6, 0.4, M.plastic, 0, 0.8, 3.6));
    return { group: g, w: 10, h: 9, top: 3.2 };
  },
  soic(p, ref) {
    const g = new THREE.Group();
    g.add(box(8, 1.5, 10, M.plastic, 0, 0.1));
    for (let k = 0; k < 4; k++) for (const s of [-1, 1]) g.add(box(1.6, 0.25, 0.45, M.tin, s * 4.8, 0.2, -3.8 + k * 2.54));
    g.add(decal(textTexture([p.title.slice(0, 10).toUpperCase(), ref], 7, 9, { px: 44, bold: true }), 7, 9, 1.62));
    return { group: g, w: 12, h: 11, top: 1.6 };
  },
  module(p, ref) {
    const g = new THREE.Group();
    g.add(box(15, 0.8, 15, M.substrate));
    g.add(box(13, 2.2, 13, M.can, 0, 0.8));
    g.add(decal(textTexture([p.title.slice(0, 12).toUpperCase(), ref], 12, 10, { px: 40, bold: true, color: "#555960" }), 12, 10, 3.02));
    return { group: g, w: 16, h: 16, top: 3 };
  },
};
// a 1-bit "now playing" screen with dithered art, like the real one renders
function epaperTexture() {
  const W = 400, H = 300;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = "#e4e1d8"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#16161a";
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  for (let j = 0; j < 150; j += 2) for (let i = 0; i < 150; i += 2) {
    const v = (Math.sin(i * 0.05) + Math.cos(j * 0.04) + (i + j) / 150) / 4 + 0.35;
    if (v * 16 > bayer[(j / 2) % 4][(i / 2) % 4]) x.fillRect(20 + i, 24 + j, 2, 2);
  }
  x.strokeStyle = "#16161a"; x.lineWidth = 3; x.strokeRect(20, 24, 150, 150);
  x.font = '700 22px "JetBrains Mono", monospace'; x.textBaseline = "top";
  x.fillText("NOW PLAYING", 190, 30);
  for (const [y, w] of [[70, 170], [100, 130], [130, 150]]) x.fillRect(190, y, w, 10);
  x.fillRect(190, 160, 180, 4);
  x.fillRect(190, 158, 70, 8);
  x.fillRect(0, 200, W, 3);
  x.font = '700 20px "JetBrains Mono", monospace';
  x.fillText("POMODORO", 20, 222);
  x.fillText("WEATHER", 160, 222);
  x.fillText("CALENDAR", 280, 222);
  for (const X of [20, 160, 280]) { x.fillRect(X, 254, 90, 8); x.fillRect(X, 270, 60, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function antennaTexture() {
  const c = document.createElement("canvas");
  c.width = 340; c.height = 130;
  const x = c.getContext("2d");
  x.strokeStyle = "#c79a4a"; x.lineWidth = 9; x.beginPath();
  x.moveTo(20, 120);
  for (let k = 0; k < 7; k++) { const X = 30 + k * 42; x.lineTo(X, 20); x.lineTo(X + 21, 20); x.lineTo(X + 21, 100); x.lineTo(X + 42, 100); }
  x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* the little OLED: it says hi once the board has power */
const oled = (() => {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const x = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  let on = false, t0 = 0, last = -1;
  const lines = ["HI, I'M ARYA", "EE @ WESTERN", "CLICK A PART ->"];
  function draw(now) {
    x.fillStyle = "#030406"; x.fillRect(0, 0, 256, 128);
    if (on) {
      const t = (now - t0) / 1000;
      x.fillStyle = "#cdeeff"; x.font = '700 22px "JetBrains Mono", monospace'; x.textBaseline = "top";
      let chars = Math.floor(t * 18);
      lines.forEach((l, i) => { const s = l.slice(0, Math.max(0, chars)); chars -= l.length; x.fillText(s, 10, 8 + i * 28); });
      if (Math.floor(t * 2) % 2 === 0) x.fillRect(10 + (lines[2].length) * 13.3, 64, 10, 20);
      x.strokeStyle = "#7fc9ff"; x.lineWidth = 2; x.beginPath();
      for (let X = 0; X <= 256; X += 4) { const Y = 108 + Math.sin(X * 0.08 + t * 5) * 9 * Math.min(1, t); X ? x.lineTo(X, Y) : x.moveTo(X, Y); }
      x.stroke();
    }
    tex.needsUpdate = true;
  }
  draw(0);
  return {
    tex,
    set(v, now) { on = v; t0 = now; draw(now); },
    tick(now) { if (on && now - last > 80) { last = now; draw(now); } },
  };
})();

// ---- layout (js/fixture.js): featured projects on the main board, the rest
// on expansion boards that hang off it by ribbon cable
const parts = [];
const hits = [];
function addPart(spec, parent = boardRoot) {
  const built = MODELS[spec.kind](spec.project || {}, spec.ref);
  const { group } = built;
  const [bx, by] = spec.at;
  group.position.copy(P(bx, by));
  parent.add(group);
  const cx = built.cx || 0;
  const hit = new THREE.Mesh(new THREE.BoxGeometry(built.w + 2, built.top + 4, built.h + 2), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.set(cx, (built.top + 4) / 2, 0);
  group.add(hit);
  const part = { ...spec, ...built, cx, parent, base: group.position.clone(), lift: 0, liftT: 0, tilt: 0, tiltT: 0, energized: false };
  hit.userData.part = part;
  hits.push(hit);
  parts.push(part);
  return part;
}
const refOf = (p) => "U" + (PROJECTS.indexOf(p) + 1);
const typeOf = (p) => (p.type === "hardware" ? "hardware" : "software");
const projectParts = [];
for (const m of PLAN.main) projectParts.push(addPart({ key: m.project.slug, ref: refOf(m.project), kind: m.kind, at: m.at, project: m.project, label: m.project.title, type: typeOf(m.project) }));
const mainParts = [...projectParts];
const aboutPart = addPart({ key: "about", ref: "DS1", kind: "oled", at: [-40, -29], label: "About me", type: "about" });
const contactPart = addPart({ key: "contact", ref: "J1", kind: "usbc", at: [-71, -45], label: "Contact", type: "contact" });

// power switch, power LED and some bulk capacitors (not projects)
const sw = (() => {
  const g = new THREE.Group();
  g.add(box(9, 3.6, 4.2, M.plastic));
  const lever = box(1.8, 2.4, 1.8, M.white, -2.2, 3.6, 0);
  g.add(lever);
  g.position.copy(P(-71, -31));
  boardRoot.add(g);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 10), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.y = 4;
  g.add(hit);
  const part = { key: "power", ref: "SW1", label: "Power switch", type: "power", group: g, parent: boardRoot, w: 10, h: 6, top: 6, cx: 0, base: g.position.clone(), lift: 0, liftT: 0, tilt: 0, tiltT: 0, at: [-71, -31] };
  hit.userData.part = part;
  hits.push(hit);
  return { g, lever, part };
})();
const pwrLed = led(0x39ff6a, 0, 0);
pwrLed.mesh.position.copy(P(-63, -38));
boardRoot.add(pwrLed.mesh);
for (const [x, y, r, h] of [[-62, -19, 3.2, 8], [-62, -11, 2.5, 6.5]]) {
  const g = new THREE.Group();
  g.add(cyl(r, h, M.sleeve), cyl(r * 0.92, 0.3, M.can, 0, h));
  g.position.copy(P(x, y));
  boardRoot.add(g);
}
for (let k = 0; k < 6; k++) { const c = box(1.6, 0.6, 0.8, M.ceramic); c.position.copy(P(-54 + k * 3, 6 - 3.2)); boardRoot.add(c); }

// 2x5 ribbon headers: J2 on the main board, IN/OUT on each expansion board
function header(parent, bx, by, vertical = false) {
  const g = new THREE.Group();
  g.add(box(13, 4.2, 6, M.plastic));
  g.add(box(10.5, 0.4, 3.2, new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }), 0, 4.2, 0));
  if (vertical) g.rotation.y = Math.PI / 2;
  g.position.copy(P(bx, by));
  parent.add(g);
  return g;
}
const J2_AT = [0, -46];
const j2 = header(boardRoot, ...J2_AT);

/* nets: USB-C -> switch -> a bus across the board -> a branch to every part */
const BUS_Y = 6.5;
const mainNets = [];
function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
// a branch from a horizontal bus at busY to the near edge of a part
function branch(part, busY, atBus) {
  const [bx, by] = part.at, ax = bx + part.cx;
  const above = by > busY, s = above ? 1 : -1;
  const edge = above ? by - part.h / 2 - 0.5 : by + part.h / 2 + 0.5;
  const x0 = ax - 4;
  const pts = (edge - (busY + s * 4)) * s > 0 ? [[x0, busY], [ax, busY + s * 4], [ax, edge]] : [[x0, busY], [ax, edge]];
  part.netEnd = atBus(x0) + pathLen(pts);
  return { pts, d0: atBus(x0) };
}
let j2D;
{
  const feed = [[-71, -41], [-71, -33.5]];
  mainNets.push({ pts: feed, d0: 0 });
  const busStart = [[-71, -28.5], [-71, BUS_Y - 4], [-67, BUS_Y]];
  const d1 = pathLen(feed) + 5;
  mainNets.push({ pts: busStart, d0: d1 });
  const busX0 = -67, busD0 = d1 + pathLen(busStart);
  mainNets.push({ pts: [[busX0, BUS_Y], [72, BUS_Y]], d0: busD0 });
  const atBus = (x) => busD0 + (x - busX0);
  for (const part of [...mainParts, aboutPart]) mainNets.push(branch(part, BUS_Y, atBus));
  const toJ2 = [[10, BUS_Y], [10, -39], [6, -43]];
  mainNets.push({ pts: toJ2, d0: atBus(10) });
  j2D = atBus(10) + pathLen(toJ2);
}

/* expansion boards */
const EXP_SLOTS = [[-24, 13], [24, 13], [-24, -15], [24, -15]];
const EXP_IN = [0, 27], EXP_OUT = [43, 14];
const expBoards = LAY.exps.map((e, k) => {
  const group = new THREE.Group();
  group.position.set(e.cx, 140, -e.cy);
  group.visible = false;
  scene.add(group);
  const eb = { k, group, cx: e.cx, cy: e.cy, projects: PLAN.exp[k] || [], parts: [], nets: [] };
  eb.parts = eb.projects.map((p, i) => {
    const part = addPart({ key: p.slug, ref: refOf(p), kind: typeOf(p) === "hardware" ? "module" : "soic", at: EXP_SLOTS[i], project: p, label: p.title, type: typeOf(p) }, group);
    projectParts.push(part);
    return part;
  });
  eb.inHdr = header(group, ...EXP_IN);
  eb.outHdr = k < LAY.exps.length - 1 ? header(group, ...EXP_OUT, true) : null;
  return eb;
});
// world position of a header's top, for the ribbon cables
const hdrTop = (hdr) => { const v = new THREE.Vector3(); hdr.getWorldPosition(v); v.y += 4.4; return v; };

const traceUniforms = { uFront: { value: 0 }, uTime: { value: 0 }, uGain: { value: 1 }, uColor: { value: new THREE.Color(0xffd47a) } };
function traceMaterial(gain) {
  return new THREE.ShaderMaterial({
    uniforms: { ...traceUniforms, uGain: { value: gain } },
    vertexShader: "attribute float aD; varying float vD; void main(){ vD = aD; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uFront; uniform float uTime; uniform float uGain; uniform vec3 uColor; varying float vD;
      void main(){
        float on = step(vD, uFront);
        float edge = smoothstep(uFront - 45.0, uFront, vD) * on;
        float pulse = pow(fract((vD - uTime * 70.0) / 55.0), 12.0);
        float a = on * (0.22 + 0.95 * pulse) + edge * 0.9;
        gl_FragColor = vec4(uColor * uGain, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
function ribbon(nets, width, y) {
  const pos = [], ds = [], idx = [];
  for (const net of nets) {
    let d = net.d0;
    for (let i = 1; i < net.pts.length; i++) {
      const [x0, y0] = net.pts[i - 1], [x1, y1] = net.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const nx = (-(y1 - y0) / len) * width / 2, ny = ((x1 - x0) / len) * width / 2;
      // extend each segment by half a width so the 45° joints don't leave gaps
      const ex = ((x1 - x0) / len) * width / 2, ey = ((y1 - y0) / len) * width / 2;
      const b = pos.length / 3;
      for (const [x, yy, dd] of [[x0 - ex + nx, y0 - ey + ny, d], [x0 - ex - nx, y0 - ey - ny, d], [x1 + ex + nx, y1 + ey + ny, d + len], [x1 + ex - nx, y1 + ey - ny, d + len]]) {
        pos.push(x, y, -yy); ds.push(dd);
      }
      idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      d += len;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aD", new THREE.Float32BufferAttribute(ds, 1));
  g.setIndex(idx);
  return g;
}
function addTraces(parent, nets) {
  const core = new THREE.Mesh(ribbon(nets, 0.9, BT + 0.04), traceMaterial(1.25));
  const glow = new THREE.Mesh(ribbon(nets, 3.4, BT + 0.03), traceMaterial(0.32));
  core.renderOrder = glow.renderOrder = 2;
  parent.add(glow, core);
}
addTraces(boardRoot, mainNets);

/* ribbon cables: J2 -> EXP1 IN, EXP1 OUT -> EXP2 IN, ... Positions use where the
   boards end up, so they're built once and shown when the boards have landed. */
const cables = [];
function cableTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 8;
  const x = c.getContext("2d");
  for (let k = 0; k < 10; k++) { x.fillStyle = k === 0 ? "#b8302e" : k % 2 ? "#9a9da3" : "#878a90"; x.fillRect(k * 6.4, 0, 6.4, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
const cableMat = new THREE.MeshStandardMaterial({ map: cableTexture(), roughness: 0.6, side: THREE.DoubleSide });
function cableGeometry(a, b) {
  const up = new THREE.Vector3(0, 1, 0);
  const flat = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  const side = new THREE.Vector3().crossVectors(flat.lengthSq() > 1e-6 ? flat.normalize() : new THREE.Vector3(0, 0, 1), up).normalize();
  const top = Math.max(a.y, b.y) + 16;
  const curve = new THREE.CatmullRomCurve3([
    a.clone(), a.clone().add(new THREE.Vector3(0, 7, 0)),
    new THREE.Vector3((a.x + b.x) / 2, top, (a.z + b.z) / 2),
    b.clone().add(new THREE.Vector3(0, 7, 0)), b.clone(),
  ]);
  const N = 48, w = 7.6, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = curve.getPoint(i / N);
    for (const s of [-1, 1]) { pos.push(p.x + side.x * s * w / 2, p.y, p.z + side.z * s * w / 2); uv.push(s < 0 ? 0 : 1, i / 4); }
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, length: curve.getLength() };
}
{
  // place everything where it lands, measure, then put it back up for the drop
  boardRoot.position.y = BOARD_Y;
  for (const eb of expBoards) eb.group.position.y = BOARD_Y;
  scene.updateMatrixWorld(true);
  let from = j2, d = j2D;
  for (const eb of expBoards) {
    const { geo, length } = cableGeometry(hdrTop(from), hdrTop(eb.inHdr));
    const m = new THREE.Mesh(geo, cableMat);
    m.castShadow = true;
    m.visible = false;
    scene.add(m);
    cables.push(m);
    d += length;
    // on the expansion board: IN header -> a bus across the middle -> the parts, and on to OUT
    const busD0 = d + 24;
    eb.nets.push({ pts: [[0, 24], [0, 0]], d0: d });
    eb.nets.push({ pts: [[0, 0], [-40, 0]], d0: busD0 }, { pts: [[0, 0], [40, 0]], d0: busD0 });
    const atBus = (x) => busD0 + Math.abs(x);
    for (const part of eb.parts) eb.nets.push(branch(part, 0, atBus));
    if (eb.outHdr) {
      const toOut = [[40, 0], [43, 3], [43, 7.5]];
      eb.nets.push({ pts: toOut, d0: atBus(40) });
      d = atBus(40) + pathLen(toOut);
      from = eb.outHdr;
    }
    addTraces(eb.group, eb.nets);
  }
  boardRoot.position.y = 140;
  for (const eb of expBoards) eb.group.position.y = 140;
}
const maxNetD = Math.max(...parts.filter((p) => p.netEnd).map((p) => p.netEnd)) + 20;

// one status LED per project, lit when the power reaches it
for (const part of projectParts) {
  const [bx, by] = part.at;
  const l = led(0x9b7bff, 0, 0);
  l.mesh.position.copy(P(bx + part.cx + part.w / 2 - 1, by + part.h / 2 + 2.2));
  part.parent.add(l.mesh);
  part.led = l;
}

/* the board itself, with its artwork painted on a canvas */
let innerLayer;
const boardMats = [];
const boardEdgeMat = new THREE.MeshStandardMaterial({ color: 0xb7a77a, roughness: 0.8, transparent: true });
function boardMesh(tex, w, h) {
  const shape = new THREE.Shape();
  const r = 3, hw = w / 2, hh = h / 2;
  shape.moveTo(-hw + r, -hh); shape.lineTo(hw - r, -hh); shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r); shape.quadraticCurveTo(hw, hh, hw - r, hh); shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r); shape.lineTo(-hw, -hh + r); shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: BT, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.25, transparent: true });
  boardMats.push(mat);
  const m = new THREE.Mesh(geo, [mat, boardEdgeMat]);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// expansion boards: same purple, smaller, with a little humour for the empty spots
function buildExpBoard(eb) {
  const W = EXP_BOARD.w, H = EXP_BOARD.h, PX = lite ? 8 : 12;
  const c = document.createElement("canvas");
  c.width = W * PX; c.height = H * PX;
  const x = c.getContext("2d");
  const toC = (bx, by) => [(bx + W / 2) * PX, (H / 2 - by) * PX];
  let seed = 31 + eb.k * 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.fillStyle = "#3a1d63"; x.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.025})`; x.fillRect(rnd() * c.width, rnd() * c.height, 2, 2); }
  const ink = "rgba(244,238,250,.92)", dim = "rgba(244,238,250,.6)";
  const line = (pts, w, col) => { x.strokeStyle = col; x.lineWidth = w * PX; x.lineCap = x.lineJoin = "round"; x.beginPath(); pts.forEach((p, i) => { const [X, Y] = toC(...p); i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke(); };
  const text = (s, bx, by, mm, { weight = 500, align = "left", color = ink } = {}) => {
    const [X, Y] = toC(bx, by);
    x.fillStyle = color; x.textAlign = align; x.textBaseline = "middle";
    x.font = `${weight} ${mm * PX}px "JetBrains Mono", monospace`;
    x.fillText(s, X, Y);
  };
  const rect = (cx, cy, w, h, dash) => {
    const [X, Y] = toC(cx - w / 2, cy + h / 2);
    x.setLineDash(dash ? [0.9 * PX, 0.7 * PX] : []);
    x.strokeStyle = dash ? dim : ink; x.lineWidth = 0.18 * PX;
    x.strokeRect(X, Y, w * PX, h * PX);
    x.setLineDash([]);
  };
  for (const n of eb.nets) line(n.pts, 0.9, "#6b3fa8");
  EXP_SLOTS.forEach(([sx, sy], i) => {
    const part = eb.parts[i];
    if (part) {
      rect(sx + part.cx, sy, part.w + 2, part.h + 2);
      const ly = sy > 0 ? sy + part.h / 2 + 3 : sy - part.h / 2 - 3;
      text(part.ref, sx - part.w / 2 - 1, ly, 2.2, { weight: 700 });
      text(part.label.toUpperCase().slice(0, 22), sx - part.w / 2 + part.ref.length * 1.5 + 0.5, ly, 1.6);
    } else {
      // an unpopulated footprint, the way it'd be marked on a real board
      rect(sx, sy, 18, 18, true);
      text("DNP", sx, sy + 2.5, 4.2, { weight: 700, align: "center", color: dim });
      text("RESERVED FOR", sx, sy - 2.6, 1.45, { align: "center", color: dim });
      text("WHATEVER I BUILD NEXT", sx, sy - 4.8, 1.45, { align: "center", color: dim });
    }
  });
  text(`EXP${eb.k + 1}`, -44, 28.5, 2.6, { weight: 700 });
  text("EXPANSION BOARD", -35.5, 28.5, 1.6, { color: dim });
  text("IN", 8, 27, 1.8, { weight: 700 });
  if (eb.outHdr) text("OUT", 46.5, 4.5, 1.6, { weight: 700, align: "right" });
  text(`REV ${new Date().getFullYear()}`, 44, 28.5, 1.5, { align: "right", color: dim });
  for (const [mx, my] of [[-45, -29], [45, 29]]) {
    const [X, Y] = toC(mx, my);
    x.fillStyle = "#dcb060"; x.beginPath(); x.arc(X, Y, 1.9 * PX, 0, 7); x.fill();
    x.fillStyle = "#0d0d10"; x.beginPath(); x.arc(X, Y, 1.05 * PX, 0, 7); x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.repeat.set(1 / W, 1 / H);
  tex.offset.set(0.5, 0.5);
  eb.group.add(boardMesh(tex, W, H));
}

function buildBoard() {
  for (const eb of expBoards) buildExpBoard(eb);
  const PX = lite ? 8 : 12;
  const c = document.createElement("canvas");
  c.width = BW * PX; c.height = BH * PX;
  const x = c.getContext("2d");
  const toC = (bx, by) => [(bx + BW / 2) * PX, (BH / 2 - by) * PX];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // purple solder mask, like the boards OSH Park makes
  x.fillStyle = "#3a1d63"; x.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 2500; k++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.025})`; x.fillRect(rnd() * c.width, rnd() * c.height, 2, 2); }

  // copper under the mask: decorative fan-out traces and the real nets
  const line = (pts, w, col) => { x.strokeStyle = col; x.lineWidth = w * PX; x.lineCap = x.lineJoin = "round"; x.beginPath(); pts.forEach((p, i) => { const [X, Y] = toC(...p); i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke(); };
  const via = (bx, by) => { const [X, Y] = toC(bx, by); x.fillStyle = "#d9ae5b"; x.beginPath(); x.arc(X, Y, 0.55 * PX, 0, 7); x.fill(); x.fillStyle = "#1a0f2a"; x.beginPath(); x.arc(X, Y, 0.25 * PX, 0, 7); x.fill(); };
  const fan = [];
  for (const part of [...mainParts, aboutPart]) {
    const [bx, by] = part.at, cx = bx + part.cx, hw = part.w / 2, hh = part.h / 2;
    for (let k = 0; k < 7; k++) {
      const side = Math.floor(rnd() * 4);
      let p0, dir;
      if (side === 0) { p0 = [cx - hw + rnd() * part.w, by + hh]; dir = [0, 1]; }
      else if (side === 1) { p0 = [cx + hw, by - hh + rnd() * part.h]; dir = [1, 0]; }
      else if (side === 2) { p0 = [cx - hw + rnd() * part.w, by - hh]; dir = [0, -1]; }
      else { p0 = [cx - hw, by - hh + rnd() * part.h]; dir = [-1, 0]; }
      const l1 = 2 + rnd() * 4, l2 = 3 + rnd() * 7, turn = rnd() < 0.5 ? 1 : -1;
      const p1 = [p0[0] + dir[0] * l1, p0[1] + dir[1] * l1];
      const d2 = dir[0] ? [dir[0], turn] : [turn, dir[1]];
      const p2 = [p1[0] + d2[0] * l2 * 0.7, p1[1] + d2[1] * l2 * 0.7];
      const p3 = [p2[0] + dir[0] * l2, p2[1] + dir[1] * l2];
      if (Math.abs(p3[0]) > BW / 2 - 4 || Math.abs(p3[1]) > BH / 2 - 4) continue;
      fan.push([p0, p1, p2, p3]);
    }
  }
  for (const f of fan) line(f, 0.32, "#56308c");
  for (const n of mainNets) line(n.pts, 0.9, "#6b3fa8");
  for (const f of fan) via(...f[3]);
  for (let bxv = -60; bxv < 70; bxv += 17) via(bxv, BUS_Y + 2.2);

  // gold (ENIG) pads under the parts
  x.fillStyle = "#dcb060";
  for (const part of [...mainParts, aboutPart, contactPart]) {
    const [bx, by] = part.at, cx = bx + part.cx;
    if (part.kind === "qfp" || part.kind === "bga" || part.kind === "soic") {
      const [X, Y] = toC(cx - part.w / 2 + 0.6, by + part.h / 2 - 0.6);
      x.globalAlpha = 0.9; x.fillRect(X, Y, (part.w - 1.2) * PX, (part.h - 1.2) * PX); x.globalAlpha = 1;
      x.fillStyle = "#3a1d63"; const [X2, Y2] = toC(cx - part.w / 2 + 2, by + part.h / 2 - 2); x.fillRect(X2, Y2, (part.w - 4) * PX, (part.h - 4) * PX); x.fillStyle = "#dcb060";
    }
  }
  // silkscreen
  const ink = "rgba(244,238,250,.92)";
  const text = (s, bx, by, mm, { weight = 500, align = "left", color = ink } = {}) => {
    const [X, Y] = toC(bx, by);
    x.fillStyle = color; x.textAlign = align; x.textBaseline = "middle";
    x.font = `${weight} ${mm * PX}px "JetBrains Mono", monospace`;
    x.fillText(s, X, Y);
  };
  const outline = (part) => {
    const [bx, by] = part.at, cx = bx + part.cx;
    const [X, Y] = toC(cx - part.w / 2 - 1, by + part.h / 2 + 1);
    x.strokeStyle = ink; x.lineWidth = 0.18 * PX; x.setLineDash([]);
    x.strokeRect(X, Y, (part.w + 2) * PX, (part.h + 2) * PX);
    x.beginPath(); x.arc(X - 0.9 * PX, Y - 0.9 * PX, 0.45 * PX, 0, 7); x.fillStyle = ink; x.fill();
  };
  for (const part of [...mainParts, aboutPart, contactPart]) {
    outline(part);
    const [bx, by] = part.at, cx = bx + part.cx;
    const above = part.at[1] > BUS_Y;
    let lx = cx - part.w / 2 - 1, ly = above ? by + part.h / 2 + 3 : by - part.h / 2 - 3;
    if (part.key === "contact") { lx = cx + part.w / 2 + 2; ly = by - 2; }
    text(part.ref, lx, ly, 2.2, { weight: 700 });
    text(part.label.toUpperCase(), lx + part.ref.length * 1.5 + 1.5, ly, 1.7);
  }
  text("SW1 PWR", -76, -24, 1.9, { weight: 700 });
  text("C1", -58, -21, 1.5); text("C2", -58, -12, 1.5); text("D1", -61, -38, 1.5);
  text("J2", -8, -44, 2.2, { weight: 700, align: "right" });
  text("TO EXPANSION ↓", -8, -47.5, 1.5, { align: "right", color: "rgba(244,238,250,.65)" });
  // zones
  x.setLineDash([1.2 * PX, 1 * PX]); x.strokeStyle = "rgba(244,238,250,.45)"; x.lineWidth = 0.18 * PX;
  { const [X0, Y0] = toC(8, 48), [X1, Y1] = toC(8, -36); x.beginPath(); x.moveTo(X0, Y0); x.lineTo(X1, Y1); x.stroke(); }
  x.setLineDash([]);
  text("SOFTWARE", -70, 47.5, 2.6, { weight: 700 });
  text("HARDWARE", 12, 47.5, 2.6, { weight: 700 });
  text("→ code that runs on things", -70 + 15, 47.5, 1.6, { color: "rgba(244,238,250,.6)" });
  text("→ things I wired up", 12 + 15, 47.5, 1.6, { color: "rgba(244,238,250,.6)" });
  // title block
  { const [X, Y] = toC(14, -36); x.strokeStyle = ink; x.lineWidth = 0.18 * PX; x.strokeRect(X, Y, 62 * PX, 13 * PX); }
  text(String(PROFILE.name || "ARYA ANANDA").toUpperCase(), 16, -39.5, 3.4, { weight: 700 });
  text("ELECTRICAL ENGINEERING · WESTERN", 16, -44, 1.7);
  text(`REV ${new Date().getFullYear()} · ${String(PROFILE.location || "LONDON, ON").toUpperCase()}`, 16, -47, 1.5, { color: "rgba(244,238,250,.65)" });
  // mounting holes
  for (const [mx, my] of [[-75, 46], [75, 46], [-75, -46], [75, -46]]) {
    const [X, Y] = toC(mx, my);
    x.fillStyle = "#dcb060"; x.beginPath(); x.arc(X, Y, 2.8 * PX, 0, 7); x.fill();
    x.fillStyle = "#0d0d10"; x.beginPath(); x.arc(X, Y, 1.6 * PX, 0, 7); x.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.repeat.set(1 / BW, 1 / BH);
  tex.offset.set(0.5, 0.5);

  boardRoot.add(boardMesh(tex, BW, BH));

  // inner ground plane, only shown in X-ray
  const ic = document.createElement("canvas");
  ic.width = 1024; ic.height = 652;
  const ix = ic.getContext("2d");
  ix.fillStyle = "#b8743c"; ix.fillRect(0, 0, 1024, 652);
  ix.strokeStyle = "rgba(60,25,8,.35)"; ix.lineWidth = 2;
  for (let k = -700; k < 1100; k += 18) { ix.beginPath(); ix.moveTo(k, 0); ix.lineTo(k + 652, 652); ix.stroke(); }
  ix.fillStyle = "#1c0c05";
  for (let k = 0; k < 160; k++) { ix.beginPath(); ix.arc(rnd() * 1024, rnd() * 652, 3 + rnd() * 3, 0, 7); ix.fill(); }
  ix.font = '700 34px "JetBrains Mono", monospace'; ix.fillStyle = "rgba(40,15,4,.7)"; ix.fillText("L2 · GND", 30, 620);
  const itex = new THREE.CanvasTexture(ic);
  itex.colorSpace = THREE.SRGBColorSpace;
  innerLayer = new THREE.Mesh(new THREE.PlaneGeometry(BW - 4, BH - 4), new THREE.MeshStandardMaterial({ map: itex, metalness: 0.8, roughness: 0.35, transparent: true, opacity: 0 }));
  innerLayer.rotation.x = -Math.PI / 2;
  innerLayer.position.y = BT / 2;
  innerLayer.visible = false;
  boardRoot.add(innerLayer);
}

/* hover outline */
const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffd47a, transparent: true, opacity: 0, toneMapped: false });
const outline = new THREE.Group();
const bars = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), outlineMat); outline.add(m); return m; });
function sizeOutline(w, h) {
  const t = 0.7;
  bars[0].scale.set(w + t, 1, t); bars[0].position.set(0, 0, -h / 2);
  bars[1].scale.set(w + t, 1, t); bars[1].position.set(0, 0, h / 2);
  bars[2].scale.set(t, 1, h + t); bars[2].position.set(-w / 2, 0, 0);
  bars[3].scale.set(t, 1, h + t); bars[3].position.set(w / 2, 0, 0);
}
outline.position.y = BT + 0.08;
boardRoot.add(outline);

/* ================= state, power, interaction ================= */

const state = { phase: "intro", powered: false, front: 0, view: "board", selected: null, hovered: null, autoPower: null, boardReady: false };
const body = document.body;

function setPhase(p) {
  state.phase = p;
  body.classList.toggle("phase-intro", p === "intro");
  body.classList.toggle("phase-board", p !== "intro");
}

let boardDrop = null;
const allBoards = [boardRoot, ...expBoards.map((e) => e.group)];
function finishMachining(fast) {
  store.set("aa-machined", "1");
  sim.spin = false;
  const from = toolRig.position.clone();
  anims.push({ dur: fast ? 0.01 : 0.9, f: (t) => { toolRig.position.set(from.x * (1 - t), from.y + (260 - from.y) * easeInOut(t), from.z + (-60 - from.z) * t); }, done: () => { toolRig.visible = false; } });
  const go = () => {
    for (const g of allBoards) g.visible = true;
    boardDrop = { t: fast ? 99 : 0, delay: fast ? 0 : 0.45, dur: 1.15, stagger: 0.18 };
    setPhase("board");
    flyTo(overviewPose(), fast ? 0.9 : 1.6);
    const wait = fast || reduced ? 300 : 2200;
    state.autoPower = setTimeout(() => { if (!state.powered) powerOn(); }, fast || reduced ? 600 : 7000);
    setTimeout(() => { if (!state.powered) $("#power-hint").classList.add("on"); }, wait);
    if (pendingRoute) { const r = pendingRoute; pendingRoute = null; setTimeout(() => { powerOn(); route(r); }, 500); }
  };
  boardBuilt.then(go);
}

function powerOn() {
  if (state.powered) return;
  state.powered = true;
  clearTimeout(state.autoPower);
  $("#power-hint").classList.remove("on");
  anims.push({ dur: 0.18, f: (t) => { sw.lever.position.x = -2.2 + 4.4 * t; } });
  pwrLed.mat.emissiveIntensity = 3;
  oled.set(true, performance.now());
}
function powerOff() {
  state.powered = false;
  anims.push({ dur: 0.18, f: (t) => { sw.lever.position.x = 2.2 - 4.4 * t; } });
  pwrLed.mat.emissiveIntensity = 0;
  oled.set(false, performance.now());
}

/* raycasting */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointerIn = false, downAt = null;
const tip = $("#tooltip");
canvas.addEventListener("pointermove", (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerIn = true;
  tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`;
});
canvas.addEventListener("pointerleave", () => { pointerIn = false; setHover(null); });
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const part = pick();
  if (part) activate(part);
  else if (state.selected) closePanel();
});
function pick() {
  if (state.phase !== "board" || !boardRoot.visible || state.view === "schematic") return null;
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(hits, false)[0];
  return h ? h.object.userData.part : null;
}
function describe(part) {
  if (part.type === "power") return `<em>SW1</em> · Power switch<small>${state.powered ? "click to switch the board off" : "click to power the board"}</small>`;
  if (part.type === "about") return `<em>DS1</em> · About me<small>Electrical Engineering at Western</small>`;
  if (part.type === "contact") return `<em>J1</em> · Contact<small>email, GitHub and more</small>`;
  const p = part.project;
  return `<em>${part.ref}</em> · ${esc(p.title)}<small>${esc(p.type)} · ${esc(p.year)} · click to open</small>`;
}
function setHover(part, fromLegend = false) {
  if (state.hovered === part) return;
  if (state.hovered) state.hovered.liftT = state.hovered === state.selected ? state.hovered.liftT : 0;
  state.hovered = part;
  canvas.classList.toggle("hovering", !!part);
  document.querySelectorAll(".legend button").forEach((b) => b.classList.toggle("hot", !!part && b.dataset.key === part.key));
  if (part) {
    if (part !== state.selected) part.liftT = 1.5;
    tip.innerHTML = describe(part);
    tip.classList.toggle("on", !fromLegend);
    const [bx, by] = part.at;
    if (outline.parent !== part.parent) part.parent.add(outline);
    outline.position.x = bx + part.cx; outline.position.z = -by;
    sizeOutline(part.w + 3, part.h + 3);
    outlineMat.opacity = 1;
  } else {
    tip.classList.remove("on");
    outlineMat.opacity = 0;
  }
}
function activate(part) {
  if (part.type === "power") { state.powered ? powerOff() : powerOn(); setHover(null); return; }
  if (!state.powered) powerOn();
  location.hash = "/" + (part.project ? "p/" + part.key : part.key);
}

/* ================= panel ================= */

const panel = $("#panel"), panelBody = $("#panel-body");
const order = [...projectParts.map((p) => p.key), "about", "contact"];
const keyToPart = (k) => parts.find((p) => p.key === k);

function linksHTML(links, solidFirst = true) {
  return `<div class="p-links">${links.map((l, k) => `<a class="btn ${k === 0 && solidFirst ? "solid" : ""}" href="${esc(safeUrl(l.href))}" ${/^mailto:/.test(l.href) ? "" : 'target="_blank" rel="noopener noreferrer"'}>${esc(l.label)} ↗</a>`).join("")}</div>`;
}
function topTags(type) {
  const m = new Map();
  PROJECTS.filter((p) => p.type === type).forEach((p) => (p.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => `<li>${esc(t)}</li>`).join("");
}
function panelHTML(key) {
  if (key === "about") {
    const a = PROFILE.about || {};
    return [
      `<p class="p-ref mono">DS1 · ABOUT</p>`,
      `<p class="p-lead">${a.lead || esc(PROFILE.intro || "")}</p>`,
      `<div class="p-body">${(a.paragraphs || []).map((t) => `<p>${esc(t)}</p>`).join("")}</div>`,
      (a.now || []).length ? `<div class="p-sec"><h3>Right now</h3></div><ul class="p-list">${a.now.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "",
      `<div class="p-skills"><div><h4>Hardware</h4><ul>${topTags("hardware")}</ul></div><div><h4>Software</h4><ul>${topTags("software")}</ul></div></div>`,
    ];
  }
  if (key === "contact") {
    const links = (PROFILE.links || []).filter((l) => !/^mailto:/.test(l.href));
    return [
      `<p class="p-ref mono">J1 · CONTACT</p>`,
      `<h2 class="p-title" id="panel-title">Say hello</h2>`,
      `<p class="p-tag">I'm open to co-op and internship roles, and always happy to talk about a project.</p>`,
      PROFILE.email ? `<p class="p-email">${esc(PROFILE.email)}</p>` : "",
      PROFILE.email ? `<div class="p-links"><button class="btn solid" data-copy="${esc(PROFILE.email)}">Copy email</button><a class="btn" href="https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(PROFILE.email)}" target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a><a class="btn" href="mailto:${esc(PROFILE.email)}">Mail app ↗</a></div>` : "",
      `<div style="margin-top:10px">${linksHTML(links, false)}</div>`,
      PROFILE.location ? `<p class="p-tag mono" style="margin-top:22px">Based in ${esc(PROFILE.location)}</p>` : "",
    ];
  }
  const p = PROJECTS.find((x) => x.slug === key);
  const part = keyToPart(key);
  return [
    `<p class="p-ref mono">${part ? part.ref + " · " : ""}${esc(p.type).toUpperCase()}</p>`,
    `<h2 class="p-title" id="panel-title">${esc(p.title)}</h2>`,
    `<p class="p-tag">${esc(p.tagline)}</p>`,
    p.cover ? `<figure class="p-photo"><img src="${esc(safeUrl(p.cover))}" alt="${esc(p.title)}" loading="lazy"></figure>` : "",
    `<div class="chips"><span class="chip ${p.type === "hardware" ? "hw" : "sw"}">${esc(p.type)}</span><span class="chip">${esc(p.dates || p.year)}</span>${p.status ? `<span class="chip">${esc(p.status)}</span>` : ""}${p.role ? `<span class="chip">${esc(p.role)}</span>` : ""}</div>`,
    `<p class="p-summary">${esc(p.summary)}</p>`,
    ...(p.sections || []).map((s) => `<div class="p-sec"><h3>${esc(s.heading)}</h3><p>${s.body}</p></div>`),
    (p.specs || []).length ? `<div class="sheet"><div class="sheet-head mono"><span>Datasheet</span><span>${part ? part.ref : ""}</span></div><table>${p.specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>` : "",
    (p.gallery || []).length ? `<div class="p-gallery">${p.gallery.map((g) => (g.src ? `<figure><img src="${esc(safeUrl(g.src))}" alt="${esc(g.caption || p.title)}" loading="lazy">${g.caption ? `<figcaption class="mono">${esc(g.caption)}</figcaption>` : ""}</figure>` : `<figure class="ph mono">${esc(g.placeholder || "[Photo]")}</figure>`)).join("")}</div>` : "",
    (p.links || []).length ? linksHTML(p.links) : "",
    (p.todo || []).length ? `<div class="p-todo mono"><h3>To add</h3><ul>${p.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : "",
  ];
}
function openPanel(key) {
  const html = panelHTML(key).filter(Boolean).map((h, i) => h.replace(/^<(\w+)/, `<$1 style="--i:${i}"`)).join("");
  panelBody.innerHTML = html;
  panel.scrollTop = 0;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));
  const part = keyToPart(key);
  if (state.selected && state.selected !== part) { state.selected.liftT = 0; state.selected.tiltT = 0; }
  state.selected = part || null;
  if (part && state.view !== "schematic") {
    part.liftT = part.type === "contact" ? 8 : 16;
    part.tiltT = 0.45;
    const wp = new THREE.Vector3();
    part.group.getWorldPosition(wp);
    wp.x += part.cx;
    const d = small ? fitDistance(120, 110) : 175;
    flyTo({ pos: wp.clone().addScaledVector(OVERVIEW_DIR, d), target: wp }, 1.1);
  }
  viewOffset.tx = small ? 0 : panel.offsetWidth / 2;
  viewOffset.ty = small ? Math.min(innerHeight * 0.72, 640) / 2 : 0;
  setHover(null);
}
function closePanel(fromRoute) {
  panel.classList.remove("open");
  setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 600);
  if (state.selected) { state.selected.liftT = 0; state.selected.tiltT = 0; }
  state.selected = null;
  viewOffset.tx = viewOffset.ty = 0;
  if (state.phase === "board" && state.view !== "schematic") flyTo(overviewPose(), 1.1);
  if (!fromRoute && location.hash) history.replaceState(null, "", location.pathname + location.search);
}
function step(dir) {
  const cur = state.selected ? state.selected.key : (location.hash.match(/^#\/(?:p\/)?(.+)$/) || [])[1];
  const i = order.indexOf(cur);
  const n = order[(i + dir + order.length) % order.length];
  location.hash = "/" + (n === "about" || n === "contact" ? n : "p/" + n);
}
$("#panel-close").addEventListener("click", () => closePanel());
// "Copy email": works even when no mail app is set up
panelBody.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied ✓"; }
  catch { b.textContent = b.dataset.copy; }
  setTimeout(() => { b.textContent = "Copy email"; }, 2000);
});
$("#panel-prev").addEventListener("click", () => step(-1));
$("#panel-next").addEventListener("click", () => step(1));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden) closePanel();
  if (!panel.hidden && (e.key === "ArrowDown" || e.key === "ArrowRight") && !e.target.closest("input")) step(1);
  if (!panel.hidden && (e.key === "ArrowUp" || e.key === "ArrowLeft") && !e.target.closest("input")) step(-1);
});

let pendingRoute = null;
function route(h = location.hash) {
  const m = h.match(/^#\/(?:p\/)?([\w-]+)$/);
  if (!m) { if (!panel.hidden) closePanel(true); return; }
  const key = m[1];
  if (key !== "about" && key !== "contact" && !PROJECTS.some((p) => p.slug === key)) return;
  if (state.phase === "intro") { pendingRoute = h; skip(); return; }
  openPanel(key);
}
addEventListener("hashchange", () => route());

/* ================= legend, links, views ================= */

{
  const tag = PROFILE.intro || "";
  $("#tagline").textContent = tag;
  const links = (PROFILE.links || []).map((l) => `<a href="${esc(safeUrl(l.href))}" ${/^mailto:/.test(l.href) ? "" : 'target="_blank" rel="noopener noreferrer"'}>${esc(l.label)}</a>`);
  if (PROFILE.email) links.unshift(`<a href="#/contact">Email</a>`);
  links.push(`<a class="primary" href="work.html">List view</a>`);
  $("#links").innerHTML = links.join("");
  $("#name").textContent = PROFILE.name || "Arya Ananda";

  const btn = (part) => `<button data-key="${esc(part.key)}"><span>${esc(part.ref)}</span>${esc(part.label)}</button>`;
  const sw = projectParts.filter((p) => p.type === "software"), hw = projectParts.filter((p) => p.type === "hardware");
  $("#legend").innerHTML =
    (sw.length ? `<span class="grp">Software</span>${sw.map(btn).join("")}` : "") +
    (hw.length ? `<span class="grp">Hardware</span>${hw.map(btn).join("")}` : "") +
    `<span class="grp">Me</span>${btn(aboutPart)}${btn(contactPart)}`;
  $("#legend").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) activate(keyToPart(b.dataset.key)); });
  $("#legend").addEventListener("mouseover", (e) => { const b = e.target.closest("button"); if (b && state.view !== "schematic") setHover(keyToPart(b.dataset.key), true); });
  $("#legend").addEventListener("mouseout", () => setHover(null));
}

function setView(v) {
  state.view = v;
  document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  const xray = v === "xray";
  for (const m of xrayMats) { m.transparent = true; m.opacity = xray ? 0.22 : 1; m.depthWrite = !xray; m.needsUpdate = true; }
  if (innerLayer) {
    for (const m of boardMats) { m.opacity = xray ? 0.28 : 1; m.depthWrite = !xray; }
    boardEdgeMat.opacity = xray ? 0.3 : 1;
    innerLayer.visible = xray;
    innerLayer.material.opacity = xray ? 0.7 : 0;
  }
  const sch = $("#schematic");
  if (v === "schematic") {
    buildSchematic();
    sch.hidden = false;
    requestAnimationFrame(() => sch.classList.add("on"));
    setHover(null);
  } else {
    sch.classList.remove("on");
    setTimeout(() => { if (state.view !== "schematic") sch.hidden = true; }, 400);
  }
}
document.querySelectorAll(".views button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

/* the schematic: the same board, drawn the way I'd draw it in KiCad */
let schematicBuilt = false;
function buildSchematic() {
  if (schematicBuilt) return;
  schematicBuilt = true;
  const W = 1100, items = [...projectParts, aboutPart];
  const cols = Math.min(items.length, 5), rows = Math.ceil(items.length / cols);
  const H = 250 + rows * 220;
  const ink = "#aaa596", gold = "#e3b25a", txt = "#ece6d6", dim = "#6f6b62";
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic of the portfolio board">`;
  s += `<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(236,230,214,.05)"/></pattern></defs>`;
  s += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="url(#g)" stroke="${ink}" stroke-width="1.5"/>`;
  for (let k = 1; k < 8; k++) s += `<text x="${(k - 0.5) * (W / 7)}" y="14" fill="${dim}" font-size="10" text-anchor="middle">${k}</text>`;
  // J1 + SW1 + rail
  const jy = 120;
  s += `<g class="sym" tabindex="0" role="button" data-key="contact" aria-label="J1 Contact"><rect class="body" x="40" y="${jy - 40}" width="90" height="110" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
  ["VBUS", "D-", "D+", "GND"].forEach((n, i) => (s += `<text x="122" y="${jy - 18 + i * 24}" fill="${dim}" font-size="11" text-anchor="end">${n}</text><line x1="130" y1="${jy - 22 + i * 24}" x2="150" y2="${jy - 22 + i * 24}" stroke="${ink}"/>`));
  s += `<text x="40" y="${jy - 50}" fill="${gold}" font-size="13" font-weight="700">J1</text><text x="62" y="${jy - 50}" fill="${txt}" font-size="12">USB-C · CONTACT</text></g>`;
  s += `<line x1="150" y1="${jy - 22}" x2="200" y2="${jy - 22}" stroke="${gold}" stroke-width="1.5"/>`;
  s += `<circle cx="204" cy="${jy - 22}" r="4" fill="none" stroke="${gold}"/><line x1="208" y1="${jy - 22}" x2="236" y2="${jy - 36}" stroke="${gold}" stroke-width="1.5"/><circle cx="240" cy="${jy - 22}" r="4" fill="none" stroke="${gold}"/>`;
  s += `<text x="204" y="${jy - 46}" fill="${gold}" font-size="13" font-weight="700">SW1</text>`;
  s += `<line x1="244" y1="${jy - 22}" x2="${W - 60}" y2="${jy - 22}" stroke="${gold}" stroke-width="2"/>`;
  s += `<text x="${W - 60}" y="${jy - 30}" fill="${gold}" font-size="12" text-anchor="end">+3V3 RAIL</text>`;
  s += `<line x1="130" y1="${jy + 50}" x2="150" y2="${jy + 50}" stroke="${ink}"/><line x1="150" y1="${jy + 50}" x2="150" y2="${jy + 62}" stroke="${ink}"/>${gnd(150, jy + 62)}`;
  // parts
  const cw = (W - 120) / cols;
  items.forEach((part, n) => {
    const c = n % cols, r = Math.floor(n / cols);
    const x = 70 + c * cw + (cw - 160) / 2, y = 210 + r * 220;
    const p = part.project;
    const pins = p ? (p.tags || []).slice(0, 4) : ["SDA", "SCL", "VCC", "GND"];
    const h = 58 + pins.length * 22;
    s += `<line x1="${x + 80}" y1="${jy - 22}" x2="${x + 80}" y2="${y}" stroke="${r === 0 ? gold : "transparent"}" stroke-width="1.5"/><circle cx="${x + 80}" cy="${jy - 22}" r="3.5" fill="${gold}"/>`;
    if (r > 0) s += `<line x1="${x + 80}" y1="${y - 22}" x2="${x + 80}" y2="${y}" stroke="${gold}" stroke-width="1.5"/><path d="M${x + 66} ${y - 22}h28l-14 -12z" fill="none" stroke="${gold}"/><text x="${x + 100}" y="${y - 24}" fill="${gold}" font-size="10">+3V3</text>`;
    s += `<g class="sym" tabindex="0" role="button" data-key="${esc(part.key)}" aria-label="${esc(part.ref)} ${esc(part.label)}">`;
    s += `<rect class="body" x="${x}" y="${y}" width="160" height="${h}" fill="rgba(236,230,214,.02)" stroke="${ink}" stroke-width="1.5"/>`;
    s += `<text x="${x}" y="${y - 8}" fill="${gold}" font-size="13" font-weight="700">${esc(part.ref)}</text>`;
    s += `<text x="${x + 80}" y="${y + 22}" fill="${txt}" font-size="12" text-anchor="middle" font-weight="700">${esc(part.label.length > 20 ? part.label.slice(0, 19) + "…" : part.label)}</text>`;
    pins.forEach((pn, i) => {
      const py = y + 60 + i * 22;
      s += `<line x1="${x - 20}" y1="${py}" x2="${x}" y2="${py}" stroke="${ink}"/><text x="${x + 6}" y="${py + 4}" fill="${dim}" font-size="10">${esc(String(pn).slice(0, 18))}</text>`;
    });
    s += `<text x="${x + 80}" y="${y + 38}" fill="${dim}" font-size="9" text-anchor="middle">${p ? esc(p.type).toUpperCase() + " · " + esc(p.year) : "SSD1306 OLED"}</text>`;
    s += `</g><line x1="${x + 80}" y1="${y + h}" x2="${x + 80}" y2="${y + h + 14}" stroke="${ink}"/>${gnd(x + 80, y + h + 14)}`;
  });
  // title block
  const tx = W - 330, ty = H - 86;
  s += `<rect x="${tx}" y="${ty}" width="320" height="76" fill="none" stroke="${ink}" stroke-width="1.5"/><line x1="${tx}" y1="${ty + 28}" x2="${tx + 320}" y2="${ty + 28}" stroke="${ink}"/><line x1="${tx + 190}" y1="${ty + 28}" x2="${tx + 190}" y2="${ty + 76}" stroke="${ink}"/>`;
  s += `<text x="${tx + 10}" y="${ty + 19}" fill="${txt}" font-size="13" font-weight="700">${esc(String(PROFILE.name || "").toUpperCase())} — PORTFOLIO</text>`;
  s += `<text x="${tx + 10}" y="${ty + 48}" fill="${dim}" font-size="10">DRAWN: A. ANANDA</text><text x="${tx + 10}" y="${ty + 66}" fill="${dim}" font-size="10">WESTERN ENGINEERING</text>`;
  s += `<text x="${tx + 200}" y="${ty + 48}" fill="${dim}" font-size="10">REV ${new Date().getFullYear()}</text><text x="${tx + 200}" y="${ty + 66}" fill="${dim}" font-size="10">SHEET 1 OF 1</text>`;
  s += `</svg>`;
  function gnd(x, y) { return `<path d="M${x - 10} ${y}h20M${x - 6} ${y + 4}h12M${x - 2} ${y + 8}h4" stroke="${ink}"/>`; }
  const holder = $("#schematic-svg");
  holder.innerHTML = s;
  const open = (el) => { const part = keyToPart(el.dataset.key); if (part) activate(part); };
  holder.addEventListener("click", (e) => { const g = e.target.closest(".sym"); if (g) open(g); });
  holder.addEventListener("keydown", (e) => { const g = e.target.closest(".sym"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(g); } });
}

/* ================= intro controls ================= */

function skip() {
  if (state.phase !== "intro" || sim.done) return;
  sim.done = true;
  machineInstantly();
  finishMachining(true);
}
$("#skip").addEventListener("click", skip);
$("#replay").addEventListener("click", () => {
  if (!panel.hidden) closePanel();
  setView("board");
  powerOff();
  state.powered = false;
  pwrLed.mat.emissiveIntensity = 0;
  sw.lever.position.x = -2.2;
  clearTimeout(state.autoPower);
  $("#power-hint").classList.remove("on");
  for (const g of allBoards) { g.visible = false; g.position.y = 140; }
  for (const c of cables) c.visible = false;
  boardDrop = null;
  resetStock();
  Object.assign(sim, { t: 0, i: 0, u: 0, spin: false, tool: 1, done: false });
  setTool(1);
  toolRig.visible = true;
  placeTool(0, 0, 60);
  setPhase("intro");
  flyTo(introPose(), 1.2);
});

/* ================= main loop ================= */

const anims = [];
let last = performance.now();
const tmp = new THREE.Vector3();
function tick(now) {
  const rdt = Math.min(0.25, (now - last) / 1000); // UI tweens: real time, so they finish on slow devices
  const dt = Math.min(0.05, rdt); // the machining: never jumps more than a frame's worth
  last = now;

  if (state.phase === "intro" && !sim.done) stepSim(dt);
  flush();
  if (sim.spin && cutter) cutter.rotation.y += dt * 40;
  updateChips(dt);

  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t = (a.t || 0) + rdt;
    const u = clamp(a.t / a.dur, 0, 1);
    a.f(easeOut(u));
    if (u >= 1) { anims.splice(i, 1); a.done && a.done(); }
  }

  if (boardDrop) {
    boardDrop.t += rdt;
    let landed = true;
    allBoards.forEach((g, i) => {
      const u = clamp((boardDrop.t - boardDrop.delay - i * boardDrop.stagger) / boardDrop.dur, 0, 1);
      g.position.y = 140 + (BOARD_Y - 140) * easeBack(u);
      if (u < 1) landed = false;
    });
    if (landed) { boardDrop = null; for (const c of cables) c.visible = true; }
  }

  if (camTween) {
    camTween.t += rdt;
    const u = easeInOut(clamp(camTween.t / camTween.dur, 0, 1));
    camera.position.lerpVectors(camTween.p0, camTween.p1, u);
    controls.target.lerpVectors(camTween.t0, camTween.t1, u);
    if (u >= 1) camTween = null;
  }
  controls.enabled = !camTween;
  controls.update();

  viewOffset.x += (viewOffset.tx - viewOffset.x) * Math.min(1, dt * 6);
  viewOffset.y += (viewOffset.ty - viewOffset.y) * Math.min(1, dt * 6);
  applyViewOffset();

  // power flowing through the nets
  traceUniforms.uTime.value = now / 1000;
  if (state.powered) state.front = Math.min(maxNetD, state.front + dt * (reduced ? 4000 : 260));
  else state.front += (0 - state.front) * Math.min(1, dt * 6);
  traceUniforms.uFront.value = state.front;
  for (const part of projectParts) {
    const on = state.powered && state.front >= part.netEnd;
    if (on !== part.energized) { part.energized = on; part.led.mat.emissiveIntensity = on ? 3 : 0; }
    if (part.extra && part.extra.ok) {
      part.extra.ok.mat.emissiveIntensity = on ? 3 : 0;
      part.extra.bad.mat.emissiveIntensity = on && Math.sin(now / 260) > 0.92 ? 3 : 0;
    }
    if (part.extra && part.extra.leds) {
      // cycle through a few patterns, like the DIP switch would
      const t = now / 1000, mode = Math.floor(t / 4) % 3;
      for (const L of part.extra.leds) {
        let lit;
        if (mode === 0) lit = L.l === Math.floor(t * 3) % 3;
        else if (mode === 1) lit = (L.c + L.r + L.l) % 3 === Math.floor(t * 4) % 3;
        else lit = L.l * 9 + L.r * 3 + L.c === Math.floor(t * 9) % 27;
        L.mat.emissiveIntensity = on && lit ? 3.2 : 0;
      }
    }
  }
  oled.tick(now);

  // hover / lift
  if (state.phase === "board" && pointerIn && !camTween) setHover(pick());
  for (const part of [...parts, sw.part]) {
    part.lift += (part.liftT - part.lift) * Math.min(1, dt * 9);
    part.tilt += (part.tiltT - part.tilt) * Math.min(1, dt * 7);
    part.group.position.y = part.base.y + part.lift;
    part.group.rotation.x = part.tilt;
  }

  // the power hint follows SW1 on screen
  const hint = $("#power-hint");
  if (hint.classList.contains("on")) {
    sw.g.getWorldPosition(tmp);
    tmp.y += 6;
    tmp.project(camera);
    hint.style.left = `${(tmp.x * 0.5 + 0.5) * innerWidth}px`;
    hint.style.top = `${(-tmp.y * 0.5 + 0.5) * innerHeight}px`;
  }

  renderer.render(scene, camera);
}

/* ================= start ================= */

resetStock();
placeTool(0, 0, 60);
showLine(0);
buildBoard();
state.boardReady = true;
const boardBuilt = Promise.resolve();
renderer.setAnimationLoop(tick);

const startHash = location.hash;
if (/^#\/(?:p\/)?[\w-]+$/.test(startHash)) route(startHash);
else if (reduced || store.get("aa-machined")) setTimeout(skip, 50);
