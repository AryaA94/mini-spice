// The workbench around the fixture plate: the vise that holds it, the PCB
// magazine and parts feeder the pick-and-place works from, and my gear. Three
// things on the bench open projects: the scope (mini-spice), the e-paper
// display and the LED cube.
//
// Units are mm, like the rest of the scene. Nothing here knows about the
// page; board.js passes in what it needs and calls update() every frame.

import * as THREE from "./three.module.min.js";

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
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

function woodTexture() {
  const r = rng(5);
  const t = canvasTex(1024, 512, (x, W, H) => {
    x.fillStyle = "#5e3f27"; x.fillRect(0, 0, W, H);
    // planks
    for (let p = 0; p < 4; p++) {
      const y0 = (p * H) / 4, tone = 0.85 + r() * 0.3;
      x.fillStyle = `rgba(${Math.round(120 * tone)},${Math.round(82 * tone)},${Math.round(52 * tone)},.55)`;
      x.fillRect(0, y0, W, H / 4);
      for (let k = 0; k < 46; k++) {
        const y = y0 + r() * (H / 4), a = 0.04 + r() * 0.1, amp = 1 + r() * 4, f = 0.004 + r() * 0.01, ph = r() * 9;
        x.strokeStyle = `rgba(${r() < 0.5 ? "35,20,10" : "160,115,75"},${a})`;
        x.lineWidth = 0.6 + r() * 1.8;
        x.beginPath();
        for (let X = 0; X <= W; X += 16) { const Y = y + Math.sin(X * f + ph) * amp; X ? x.lineTo(X, Y) : x.moveTo(X, Y); }
        x.stroke();
      }
      x.fillStyle = "rgba(20,10,4,.55)"; x.fillRect(0, y0, W, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
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
  const top = new THREE.Mesh(new THREE.BoxGeometry(1600, 40, 1000), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.78 }));
  top.position.set(0, Y - 20, zc);
  top.receiveShadow = true;
  g.add(top);

  // --- cutting mat on the right
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(330, 300), new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.9 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(305, Y + 0.2, zc + 70);
  mat.receiveShadow = true;
  g.add(mat);

  // --- the vise holding the plate
  {
    const len = frontZ - backZ;
    g.add(box(150, S.z[0] - Y, len, M.vise, 0, Y, zc));
    g.add(box(170, 12, 24, M.vise, 0, S.z[0], backZ - 12)); // fixed jaw
    g.add(box(170, 12, 24, M.vise, 0, S.z[0], frontZ + 12)); // moving jaw
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
    f.add(box(120, 10, 120, M.tray));
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
    grp.add(box(300, 150, 130, M.dark));
    grp.add(box(300, 12, 130, M.black, 0, 0, 0));
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
    st.add(box(110, 90, 140, M.dark));
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
    body.add(box(135, 84, 31, caseMat, 0, 0, 0));
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
    dev.add(box(120, 10, 46, caseMat, 0, 0, -8)); // dock
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
    mm.add(box(88, 34, 170, new THREE.MeshStandardMaterial({ color: 0xe0ad1c, roughness: 0.6 })));
    mm.add(box(74, 4, 150, M.black, 0, 34, 0));
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
