// The workbench around the fixture plate: the vise that holds it, the PCB
// magazine and parts feeder the pick-and-place works from, and my gear. Three
// things on the bench open projects: the scope (mini-spice), the e-paper
// display and the LED cube.
//
// Units are mm, like the rest of the scene. Nothing here knows about the
// page; board.js passes in what it needs and calls update() every frame.

import * as THREE from "./three.module.min.js";
import { RoundedBoxGeometry } from "./RoundedBoxGeometry.js";

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
// a box with softened edges: looks manufactured instead of blocky, for almost no cost
let RSEG = 3;
const rbox = (w, h, d, r, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, RSEG, Math.min(r, w / 2, h / 2, d / 2)), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const cyl = (r, h, mat, x = 0, y = 0, z = 0, seg = 32) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

function woodTexture(big) {
  const r = rng(5), W = big ? 2048 : 1024, H = W / 2;
  const t = canvasTex(W, H, (x) => {
    x.fillStyle = "#5a3b24"; x.fillRect(0, 0, W, H);
    const planks = 5;
    for (let p = 0; p < planks; p++) {
      const y0 = (p * H) / planks, ph = H / planks, tone = 0.82 + r() * 0.32;
      const g = x.createLinearGradient(0, y0, 0, y0 + ph);
      g.addColorStop(0, `rgb(${Math.round(128 * tone)},${Math.round(86 * tone)},${Math.round(54 * tone)})`);
      g.addColorStop(1, `rgb(${Math.round(110 * tone)},${Math.round(72 * tone)},${Math.round(44 * tone)})`);
      x.fillStyle = g; x.fillRect(0, y0, W, ph);
      // long grain lines with a slow wobble
      for (let k = 0; k < 70; k++) {
        const y = y0 + r() * ph, a = 0.03 + r() * 0.09, amp = 1 + r() * 5, f = 0.002 + r() * 0.006, phs = r() * 9;
        x.strokeStyle = `rgba(${r() < 0.55 ? "40,22,10" : "175,128,84"},${a})`;
        x.lineWidth = 0.5 + r() * 2.2;
        x.beginPath();
        for (let X = 0; X <= W; X += 12) { const Y = y + Math.sin(X * f + phs) * amp + Math.sin(X * f * 3.1) * amp * 0.3; X ? x.lineTo(X, Y) : x.moveTo(X, Y); }
        x.stroke();
      }
      // a knot or two, with grain bending round it
      for (let k = 0; k < 1 + Math.floor(r() * 2); k++) {
        const cx = r() * W, cy = y0 + ph * (0.3 + r() * 0.4), rx = 10 + r() * 16;
        for (let ring = 6; ring > 0; ring--) {
          x.strokeStyle = `rgba(45,24,10,${0.1 + ring * 0.03})`; x.lineWidth = 1.5;
          x.beginPath(); x.ellipse(cx, cy, rx * ring * 0.5, rx * ring * 0.18, 0, 0, 7); x.stroke();
        }
        x.fillStyle = "rgba(38,20,8,.6)"; x.beginPath(); x.ellipse(cx, cy, rx * 0.45, rx * 0.2, 0, 0, 7); x.fill();
      }
      x.fillStyle = "rgba(18,9,3,.6)"; x.fillRect(0, y0, W, 3);
      x.fillStyle = "rgba(255,220,180,.06)"; x.fillRect(0, y0 + 3, W, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.6, 1.6);
  return t;
}

// pegboard on the wall behind the bench, with tools hanging on it
function pegboardTexture(big) {
  const W = big ? 2048 : 1024, H = Math.round(W * 0.42), s = W / 2048;
  return canvasTex(W, H, (x) => {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3b3027"); g.addColorStop(1, "#594634");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let Y = 18 * s; Y < H; Y += 36 * s) for (let X = 18 * s; X < W; X += 36 * s) {
      x.fillStyle = "rgba(10,6,3,.75)"; x.beginPath(); x.arc(X, Y, 4.5 * s, 0, 7); x.fill();
    }
    // tool silhouettes, with a soft drop shadow so they sit off the board
    const tool = (fn) => {
      x.save(); x.shadowColor = "rgba(0,0,0,.55)"; x.shadowBlur = 18 * s; x.shadowOffsetX = 6 * s; x.shadowOffsetY = 10 * s;
      fn(); x.restore();
    };
    const pliers = (X, Y, col) => tool(() => {
      x.fillStyle = col;
      x.save(); x.translate(X, Y); x.rotate(-0.12);
      x.fillRect(-14 * s, 0, 12 * s, 200 * s); x.fillRect(4 * s, 0, 12 * s, 200 * s);
      x.fillStyle = "#8e9399"; x.fillRect(-10 * s, -70 * s, 22 * s, 75 * s);
      x.restore();
    });
    const screwdriver = (X, Y, col, len) => tool(() => {
      x.fillStyle = "#a9adb3"; x.fillRect(X - 4 * s, Y + 95 * s, 8 * s, len * s);
      x.fillStyle = col; x.beginPath(); x.roundRect(X - 15 * s, Y, 30 * s, 100 * s, 12 * s); x.fill();
    });
    const spool = (X, Y, col) => tool(() => {
      x.fillStyle = "#22252a"; x.beginPath(); x.arc(X, Y, 58 * s, 0, 7); x.fill();
      x.fillStyle = col; x.beginPath(); x.arc(X, Y, 46 * s, 0, 7); x.fill();
      x.fillStyle = "#22252a"; x.beginPath(); x.arc(X, Y, 14 * s, 0, 7); x.fill();
    });
    const ruler = (X, Y) => tool(() => {
      x.fillStyle = "#c9ccd1"; x.fillRect(X, Y, 46 * s, 520 * s);
      x.fillStyle = "#3a3d42";
      for (let k = 0; k < 52; k++) x.fillRect(X, Y + k * 10 * s, (k % 5 ? 10 : 20) * s, 2 * s);
    });
    const cutters = (X, Y) => tool(() => {
      x.fillStyle = "#c23b32"; x.fillRect(X - 13 * s, Y, 10 * s, 150 * s); x.fillRect(X + 3 * s, Y, 10 * s, 150 * s);
      x.fillStyle = "#8e9399"; x.beginPath(); x.moveTo(X - 12 * s, Y); x.lineTo(X, Y - 46 * s); x.lineTo(X + 12 * s, Y); x.fill();
    });
    ruler(160 * s, 90 * s);
    for (const [k, c] of [[0, "#2f5fa8"], [1, "#c23b32"], [2, "#e0ad1c"], [3, "#2f8a4a"]]) screwdriver((300 + k * 60) * s, 110 * s, c, 120 + k * 20);
    pliers(620 * s, 160 * s, "#c23b32");
    cutters(740 * s, 170 * s);
    pliers(860 * s, 150 * s, "#2f5fa8");
    spool(1300 * s, 200 * s, "#c23b32"); spool(1440 * s, 200 * s, "#1b1b1d"); spool(1580 * s, 200 * s, "#e0ad1c");
    spool(1370 * s, 360 * s, "#2f8a4a"); spool(1510 * s, 360 * s, "#3d6fd8");
    // a small shelf of parts bins
    tool(() => { for (let k = 0; k < 5; k++) { x.fillStyle = ["#d63a3a", "#3d6fd8", "#e0ad1c", "#2f8a4a", "#4f2683"][k]; x.fillRect((1700 + k * 62) * s, 520 * s, 54 * s, 70 * s); } });
  });
}

function blobTexture() {
  return canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }, false);
}
function matTexture() {
  return canvasTex(512, 512, (x, W, H) => {
    x.fillStyle = "#2c5f52"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(220,240,230,.25)"; x.lineWidth = 1;
    for (let k = 0; k <= W; k += 16) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, H); x.stroke(); x.beginPath(); x.moveTo(0, k); x.lineTo(W, k); x.stroke(); }
    x.strokeStyle = "rgba(240,250,245,.45)"; x.lineWidth = 2;
    for (let k = 0; k <= W; k += 80) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, H); x.stroke(); x.beginPath(); x.moveTo(0, k); x.lineTo(W, k); x.stroke(); }
  });
}

/**
 * Build the bench. `o` gives:
 *   stock      the plate's extents (scene: x = X, z = -Y)
 *   benchY     height of the bench top
 *   epaperTex  the e-paper "now playing" texture
 *   lite       true on phones: fewer details
 * Returns { group, magazine, feeder, clickables, update(now, powered) }.
 */
export function buildBench(o) {
  const g = new THREE.Group();
  const S = o.stock, Y = o.benchY;
  const backZ = -S.y[1], frontZ = -S.y[0], zc = (backZ + frontZ) / 2;
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.5, roughness: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 }),
    vise: new THREE.MeshStandardMaterial({ color: 0x3a4a5c, metalness: 0.35, roughness: 0.5 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb9bdc3, metalness: 1, roughness: 0.4 }),
    tray: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.8 }),
  };
  const blob = blobTexture();
  const shadow = (x, z, w, d, op = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: op }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, Y + 0.3, z);
    g.add(m);
  };

  // --- bench top
  RSEG = o.lite ? 2 : 3;
  const woodMap = woodTexture(!o.lite);
  woodMap.anisotropy = o.lite ? 4 : 8;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1600, 40, 1000), new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.72 }));
  top.position.set(0, Y - 20, zc);
  top.receiveShadow = true;
  g.add(top);

  // --- the wall behind the bench: pegboard and tools
  {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1700, 714), new THREE.MeshStandardMaterial({ map: pegboardTexture(!o.lite), roughness: 0.9 }));
    wall.position.set(0, Y + 357, backZ - 330);
    wall.receiveShadow = true;
    g.add(wall);
  }

  // --- a desk lamp: a warm pool of light on the plate
  let lamp = null;
  {
    const lm = new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.6, roughness: 0.35 });
    const L = new THREE.Group();
    L.add(cyl(40, 10, lm));
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 260, 12), lm);
    arm1.position.set(0, 135, 0); arm1.rotation.z = -0.35;
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 220, 12), lm);
    arm2.position.set(-95, 290, 0); arm2.rotation.z = 1.15;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(42, 70, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(-185, 300, 0); shade.rotation.z = 0.55;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false }));
    bulb.position.set(-178, 288, 0);
    for (const m of [arm1, arm2, shade]) { m.castShadow = true; L.add(m); }
    L.add(bulb);
    L.position.set(470, Y, backZ - 40);
    L.rotation.y = -0.7;
    g.add(L);
    shadow(470, backZ - 40, 140, 140);
    // no shadow from this light: the key light already casts them, and it keeps it cheap
    lamp = new THREE.SpotLight(0xffc98a, o.lite ? 1.0 : 1.2, 0, 0.7, 0.95, 0);
    L.updateMatrixWorld(true);
    bulb.getWorldPosition(lamp.position);
    lamp.target.position.set(-40, S.z[1], zc - 40);
    g.add(lamp, lamp.target);
  }

  // --- cutting mat on the right
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(330, 300), new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.9 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(305, Y + 0.2, zc + 70);
  mat.receiveShadow = true;
  g.add(mat);

  // --- the vise holding the plate
  {
    const len = frontZ - backZ;
    g.add(rbox(150, S.z[0] - Y, len, 4, M.vise, 0, Y, zc));
    g.add(rbox(170, 12, 24, 2.5, M.vise, 0, S.z[0], backZ - 12)); // fixed jaw
    g.add(rbox(170, 12, 24, 2.5, M.vise, 0, S.z[0], frontZ + 12)); // moving jaw
    g.add(box(160, 10, 3, M.steel, 0, S.z[0] + 2, backZ - 1.5));
    g.add(box(160, 10, 3, M.steel, 0, S.z[0] + 2, frontZ + 1.5));
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 70, 24), M.steel);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, (Y + S.z[0]) / 2 - 8, frontZ + 34);
    g.add(screw);
    const crank = box(80, 6, 6, M.steel, 0, (Y + S.z[0]) / 2 - 11, frontZ + 66);
    g.add(crank);
    shadow(0, zc, 240, len + 80, 0.9);
  }

  // --- PCB magazine (boards) and parts feeder, behind the plate
  const magazine = new THREE.Vector3(-82, Y, backZ - 100);
  const feeder = new THREE.Vector3(96, Y, backZ - 100);
  {
    const m = new THREE.Group();
    m.add(box(176, 6, 116, M.alu));
    for (const sx of [-1, 1]) {
      m.add(box(6, 46, 116, M.alu, sx * 85, 6, 0));
      for (let k = 0; k < 4; k++) m.add(box(4, 1.5, 112, M.steel, sx * 80.5, 10 + k * 11, 0));
    }
    m.position.copy(magazine);
    g.add(m);
    shadow(magazine.x, magazine.z, 230, 170, 0.8);
    const f = new THREE.Group();
    f.add(rbox(124, 10, 124, 4, M.tray));
    for (let k = 1; k < 3; k++) { f.add(box(1.5, 4, 116, M.dark, -60 + k * 40, 10, 0)); f.add(box(116, 4, 1.5, M.dark, 0, 10, -60 + k * 40)); }
    const label = new THREE.Mesh(new THREE.PlaneGeometry(60, 9), new THREE.MeshBasicMaterial({ map: canvasTex(256, 40, (x) => { x.fillStyle = "#e3b25a"; x.font = '700 26px "JetBrains Mono", monospace'; x.fillText("FEEDER", 70, 29); }), transparent: true }));
    label.position.set(0, 7, 60.2);
    f.add(label);
    f.position.copy(feeder);
    g.add(f);
    shadow(feeder.x, feeder.z, 170, 170, 0.8);
  }
  // pick points in the feeder's 3x3 compartments
  const feederSlots = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) feederSlots.push(new THREE.Vector3(feeder.x - 40 + c * 40, Y + 10, feeder.z - 40 + r * 40));

  const clickables = [];
  const clickable = (group, key, w, h, d) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    hit.position.y = h / 2;
    group.add(hit);
    clickables.push({ key, hit, group });
  };

  // --- oscilloscope (opens mini-spice: it plots the same kind of waveforms)
  const scope = (() => {
    const grp = new THREE.Group();
    grp.add(rbox(300, 150, 130, 10, M.dark));
    grp.add(rbox(306, 14, 136, 6, M.black, 0, -2, 0));
    grp.add(rbox(172, 112, 6, 4, M.black, -55, 24, 64)); // screen bezel
    const screenTex = canvasTex(512, 320, () => {});
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(160, 100), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
    screen.position.set(-55, 80, 65.3);
    grp.add(screen);
    for (let k = 0; k < 3; k++) for (let r = 0; r < 2; r++) {
      const kn = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 8, 20), M.black);
      kn.rotation.x = Math.PI / 2;
      kn.position.set(70 + k * 28, 105 - r * 40, 68);
      grp.add(kn);
    }
    for (let k = 0; k < 4; k++) grp.add(box(14, 7, 4, M.alu, 70 + k * 20, 28, 66));
    grp.position.set(-305, Y, zc - 70);
    grp.rotation.y = 0.5;
    g.add(grp);
    shadow(-305, zc - 70, 380, 260);
    clickable(grp, "mini-spice", 300, 150, 130);
    let last = -1;
    return {
      draw(now, on) {
        if (now - last < 66) return;
        last = now;
        const c = screenTex.image, x = c.getContext("2d"), W = c.width, H = c.height;
        x.fillStyle = "#06120f"; x.fillRect(0, 0, W, H);
        x.strokeStyle = "rgba(120,200,180,.18)"; x.lineWidth = 1;
        for (let k = 0; k <= 10; k++) { x.beginPath(); x.moveTo((k * W) / 10, 0); x.lineTo((k * W) / 10, H); x.stroke(); }
        for (let k = 0; k <= 8; k++) { x.beginPath(); x.moveTo(0, (k * H) / 8); x.lineTo(W, (k * H) / 8); x.stroke(); }
        x.font = '600 18px "JetBrains Mono", monospace'; x.fillStyle = "#e3b25a";
        x.fillText("mini-spice · RLC step", 14, 26);
        if (on) {
          // an underdamped step response, sweeping across like a live capture
          const t = (now / 1000) % 4, sweep = Math.min(1, t / 2.2);
          x.strokeStyle = "#ffd65a"; x.lineWidth = 3; x.shadowColor = "#ffd65a"; x.shadowBlur = 8;
          x.beginPath();
          for (let X = 0; X <= W * sweep; X += 3) {
            const u = X / W * 10;
            const v = u < 1 ? 0 : 1 - Math.exp(-(u - 1) * 0.55) * Math.cos((u - 1) * 3.4);
            const Yp = H * 0.78 - v * H * 0.42;
            X ? x.lineTo(X, Yp) : x.moveTo(X, Yp);
          }
          x.stroke();
          x.shadowBlur = 0;
        }
        screenTex.needsUpdate = true;
      },
    };
  })();

  // --- soldering station and iron
  {
    const st = new THREE.Group();
    st.add(rbox(110, 90, 140, 10, M.dark));
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(56, 26), new THREE.MeshBasicMaterial({ map: canvasTex(224, 104, (x) => { x.fillStyle = "#1b0d06"; x.fillRect(0, 0, 224, 104); x.fillStyle = "#ff7a2f"; x.font = '700 44px "JetBrains Mono", monospace'; x.fillText("IRON", 50, 68); }), toneMapped: false }));
    disp.position.set(0, 60, 70.2);
    st.add(disp);
    const kn = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 10, 24), M.black);
    kn.rotation.x = Math.PI / 2; kn.position.set(0, 25, 72);
    st.add(kn);
    st.position.set(300, Y, backZ - 60);
    st.rotation.y = -0.45;
    g.add(st);
    shadow(300, backZ - 60, 200, 200);
    // iron in its coil holder
    const holder = new THREE.Group();
    holder.add(cyl(32, 10, M.black));
    const helix = new THREE.Curve();
    helix.getPoint = (t) => new THREE.Vector3(Math.cos(t * Math.PI * 12) * 13, 14 + t * 80 * Math.sin(0.9), Math.sin(t * Math.PI * 12) * 13 + t * 80 * Math.cos(0.9));
    const coil = new THREE.Mesh(new THREE.TubeGeometry(helix, 220, 1.4, 6, false), M.steel);
    coil.castShadow = true;
    holder.add(coil);
    const iron = new THREE.Group();
    iron.add(cyl(9, 70, new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.5 }), 0, 0, 0));
    iron.add(cyl(3, 50, M.steel, 0, 70, 0, 16));
    const tipc = new THREE.Mesh(new THREE.ConeGeometry(3, 14, 16), M.dark);
    tipc.position.y = 127; iron.add(tipc);
    iron.rotation.x = Math.PI / 2 - 0.9;
    iron.position.set(0, 18, -12);
    holder.add(iron);
    holder.add(cyl(14, 12, new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.8, roughness: 0.6 }), 26, 0, 22));
    holder.position.set(415, Y, backZ + 30);
    holder.rotation.y = Math.PI + 0.5;
    g.add(holder);
    shadow(415, backZ + 30, 120, 120);
  }

  // --- the e-paper desk display on its 15° dock (opens that project)
  {
    const dev = new THREE.Group();
    const caseMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.65 });
    const body = new THREE.Group();
    body.add(rbox(135, 84, 31, 6, caseMat, 0, 0, 0));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(92, 69), new THREE.MeshStandardMaterial({ map: o.epaperTex, roughness: 0.9 }));
    scr.position.set(-8, 42, 15.7);
    body.add(scr);
    for (const yy of [10, 74]) body.add(box(118, 0.6, 0.8, new THREE.MeshStandardMaterial({ color: 0xb9b5ad }), -8, yy, 15.6));
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 4, 24), M.dark);
    collar.rotation.z = Math.PI / 2; collar.position.set(69.5, 42, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), M.black);
    knob.position.set(74, 42, 0);
    body.add(collar, knob);
    body.rotation.x = -0.26; // 15° back
    body.position.set(0, 10, 0);
    dev.add(body);
    dev.add(rbox(120, 10, 46, 4, caseMat, 0, 0, -8)); // dock
    dev.position.set(262, Y, zc + 40);
    dev.rotation.y = -0.4;
    g.add(dev);
    shadow(262, zc + 40, 200, 140);
    clickable(dev, "epaper-display", 150, 100, 60);
  }

  // --- the real LED cube (opens that project)
  const cubeLeds = [];
  {
    const cube = new THREE.Group();
    cube.add(box(64, 3, 64, new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.7 })));
    const lm = (i) => new THREE.MeshStandardMaterial({ color: 0xb8d3ff, emissive: 0x3d7bff, emissiveIntensity: 0, roughness: 0.15, transparent: true, opacity: 0.85 });
    for (let l = 0; l < 3; l++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const mat = lm();
      const m = new THREE.Mesh(new THREE.SphereGeometry(3, 14, 10), mat);
      m.position.set((c - 1) * 18, 14 + l * 16, (r - 1) * 18);
      cube.add(m);
      if (o.glow) o.glow(m, mat, 22);
      cubeLeds.push({ mat, l, r, c });
    }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cube.add(cyl(0.5, 46, M.steel, (c - 1) * 18, 3, (r - 1) * 18, 6));
    cube.position.set(-250, Y, frontZ - 30);
    cube.rotation.y = 0.3;
    g.add(cube);
    shadow(-250, frontZ - 30, 110, 110);
    clickable(cube, "led-matrix", 70, 60, 70);
  }

  // --- multimeter with its leads
  {
    const mm = new THREE.Group();
    mm.add(rbox(88, 34, 170, 12, new THREE.MeshStandardMaterial({ color: 0xe0ad1c, roughness: 0.55 })));
    mm.add(rbox(74, 6, 150, 6, M.black, 0, 30, 0));
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(58, 28), new THREE.MeshBasicMaterial({ map: canvasTex(232, 112, (x) => { x.fillStyle = "#9fae94"; x.fillRect(0, 0, 232, 112); x.fillStyle = "#1d241a"; x.font = '700 64px "JetBrains Mono", monospace'; x.fillText("3.30", 40, 82); x.font = '600 22px "JetBrains Mono", monospace'; x.fillText("V", 196, 82); }) }));
    lcd.rotation.x = -Math.PI / 2; lcd.position.set(0, 38.2, -45);
    mm.add(lcd);
    const dial = cyl(22, 5, M.dark, 0, 38, 20);
    mm.add(dial);
    mm.position.set(-385, Y, frontZ - 10);
    mm.rotation.y = 0.35;
    g.add(mm);
    shadow(-385, frontZ - 10, 150, 230);
    for (const [col, dx] of [[0xc23b32, -14], [0x1b1b1d, 14]]) {
      const pts = [new THREE.Vector3(dx, 38, 70), new THREE.Vector3(dx * 2, 30, 120), new THREE.Vector3(dx * 4 + 40, 4, 160), new THREE.Vector3(dx * 3 + 120, 4, 120)];
      const lead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 2.2, 8, false), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
      lead.castShadow = true;
      mm.add(lead);
    }
  }

  // --- solder spool and a (Western purple) mug
  if (!o.lite) {
    const sp = new THREE.Group();
    sp.add(cyl(30, 4, M.dark), cyl(30, 4, M.dark, 0, 26), cyl(22, 22, M.alu, 0, 4));
    sp.position.set(180, Y, frontZ + 50);
    g.add(sp);
    shadow(180, frontZ + 50, 90, 90);
    const mug = new THREE.Group();
    const mugMat = new THREE.MeshStandardMaterial({ color: 0x4f2683, roughness: 0.35 });
    mug.add(cyl(40, 95, mugMat));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(24, 6, 12, 24, Math.PI), mugMat);
    handle.rotation.z = -Math.PI / 2; handle.position.set(40, 48, 0);
    mug.add(handle);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(36, 32), new THREE.MeshStandardMaterial({ color: 0x2a160b, roughness: 0.2 }));
    coffee.rotation.x = -Math.PI / 2; coffee.position.y = 86;
    mug.add(coffee);
    mug.position.set(420, Y, frontZ + 30);
    g.add(mug);
    shadow(420, frontZ + 30, 120, 120);
  }

  return {
    group: g,
    magazine,
    feederSlots,
    clickables,
    update(now, powered) {
      scope.draw(now, powered);
      const t = now / 1000, mode = Math.floor(t / 4) % 3;
      for (const L of cubeLeds) {
        let lit;
        if (mode === 0) lit = L.l === Math.floor(t * 3) % 3;
        else if (mode === 1) lit = (L.c + L.r + L.l) % 3 === Math.floor(t * 4) % 3;
        else lit = L.l * 9 + L.r * 3 + L.c === Math.floor(t * 9) % 27;
        L.mat.emissiveIntensity = powered && lit ? 3 : 0;
      }
    },
  };
}
