(() => {
  "use strict";

  const PROJECTS = window.PROJECTS || [];
  const PROFILE = window.PROFILE || {};
  // only allow http(s), mailto and relative links from the data file
  const safeUrl = (u) => (/^(https?:|mailto:|#|\.?\/|[\w-]+\.\w+)/i.test(String(u || "").trim()) && !/^\s*(javascript|data|vbscript):/i.test(u) ? u : "#");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const storedTheme = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  root.dataset.theme = storedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  $("#theme-btn").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
    window.dispatchEvent(new Event("themechange"));
  });

  /* ---------- seeded random (stable covers per project) ---------- */
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ---------- generated covers ---------- */
  // Covers keep their 4:3 drawing whole ("meet") and let the background
  // pattern run past the viewBox, so any card shape shows the full drawing.
  let uid = 0;
  const BG = (id) => `<rect x="-2000" y="-2000" width="4800" height="4600" class="cv-bg"/><rect x="-2000" y="-2000" width="4800" height="4600" fill="url(#${id}p)"/>`;
  function hardwareCover(p) {
    const r = rng(p.slug), W = 800, H = 600, a = p.accent || "#e8894a";
    const id = "cv" + uid++;
    let s = "";
    s += `<rect x="70" y="60" width="660" height="480" rx="22" class="cv-board"/>`;
    s += `<rect x="70" y="60" width="660" height="480" rx="22" fill="none" style="stroke:${a}" stroke-opacity=".55" stroke-width="2"/>`;
    // mounting holes
    for (const [x, y] of [[100, 90], [700, 90], [100, 510], [700, 510]]) s += `<circle cx="${x}" cy="${y}" r="10" class="cv-hole"/><circle cx="${x}" cy="${y}" r="15" fill="none" style="stroke:${a}" stroke-opacity=".5"/>`;
    // chips
    const chips = [];
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const w = 80 + Math.floor(r() * 4) * 20, h = 60 + Math.floor(r() * 4) * 20;
      const x = 140 + Math.floor(r() * ((560 - w) / 20)) * 20, y = 120 + Math.floor(r() * ((360 - h) / 20)) * 20;
      if (chips.some((c) => x < c.x + c.w + 40 && x + w + 40 > c.x && y < c.y + c.h + 40 && y + h + 40 > c.y)) continue;
      chips.push({ x, y, w, h });
    }
    if (!chips.length) chips.push({ x: 320, y: 240, w: 160, h: 120 });
    // traces from chip pins
    let traces = "";
    chips.forEach((c, ci) => {
      const pins = [];
      for (let px = c.x + 10; px < c.x + c.w; px += 20) { pins.push([px, c.y - 8, 0, -1]); pins.push([px, c.y + c.h + 8, 0, 1]); }
      for (let py = c.y + 10; py < c.y + c.h; py += 20) { pins.push([c.x - 8, py, -1, 0]); pins.push([c.x + c.w + 8, py, 1, 0]); }
      pins.forEach(([x, y, dx, dy]) => {
        s += `<rect x="${x - (dx ? 7 : 4)}" y="${y - (dy ? 7 : 4)}" width="${dx ? 14 : 8}" height="${dy ? 14 : 8}" rx="1.5" style="fill:${a}" fill-opacity=".9"/>`;
        if (r() < 0.45) {
          let cx = x, cy = y, d = "M" + cx + " " + cy;
          const l1 = 20 + Math.floor(r() * 4) * 20; cx += dx * l1; cy += dy * l1; d += ` L${cx} ${cy}`;
          const turn = r() < 0.5 ? 1 : -1, l2 = 20 + Math.floor(r() * 3) * 20;
          cx += (dx ? dx : turn) * l2; cy += (dy ? dy : turn) * l2; d += ` L${cx} ${cy}`;
          const l3 = 20 + Math.floor(r() * 5) * 20; cx += (dx ? dx : 0) * l3 + (dy ? 0 : 0); cy += (dy ? dy : 0) * l3; d += ` L${cx} ${cy}`;
          cx = Math.max(90, Math.min(710, cx)); cy = Math.max(80, Math.min(520, cy));
          traces += `<path d="${d} L${cx} ${cy}" fill="none" style="stroke:${a}" stroke-opacity=".7" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
          traces += `<circle cx="${cx}" cy="${cy}" r="7" class="cv-via" style="stroke:${a}" stroke-width="3"/>`;
        }
      });
      s += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="4" class="cv-chip"/>`;
      s += `<circle cx="${c.x + 12}" cy="${c.y + 12}" r="4" class="cv-mark"/>`;
      s += `<text x="${c.x + c.w / 2}" y="${c.y + c.h / 2 + 5}" text-anchor="middle" class="cv-silk">U${ci + 1}</text>`;
    });
    // passives
    for (let i = 0; i < 6; i++) {
      const x = 120 + Math.floor(r() * 28) * 20, y = 110 + Math.floor(r() * 20) * 20;
      if (chips.some((c) => x > c.x - 50 && x < c.x + c.w + 50 && y > c.y - 50 && y < c.y + c.h + 50)) continue;
      const v = r() < 0.5;
      s += `<g transform="translate(${x} ${y}) rotate(${v ? 90 : 0})"><rect x="-16" y="-7" width="10" height="14" rx="1.5" style="fill:${a}"/><rect x="6" y="-7" width="10" height="14" rx="1.5" style="fill:${a}"/><rect x="-7" y="-6" width="14" height="12" class="cv-chip"/></g>`;
      s += `<text x="${x}" y="${y + 26}" text-anchor="middle" class="cv-silk cv-silk-sm">${r() < 0.5 ? "R" : "C"}${i + 1}</text>`;
    }
    s += `<text x="100" y="525" class="cv-silk cv-silk-sm">${esc(p.title.toUpperCase())} · REV ${String.fromCharCode(65 + Math.floor(r() * 3))}</text>`;
    const defs = `<defs><pattern id="${id}p" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r=".9" class="cv-dot"/></pattern><clipPath id="${id}c"><rect x="70" y="60" width="660" height="480" rx="22"/></clipPath></defs>`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="cover" role="img" aria-label="${esc(p.title)}">${defs}${BG(id)}${s.replace(/^(<rect[^>]*\/><rect[^>]*\/>)/, `$1<g clip-path="url(#${id}c)">${traces}</g>`)}</svg>`;
  }

  function softwareCover(p) {
    const r = rng(p.slug), W = 800, H = 600, a = p.accent || "#e8894a";
    const id = "cv" + uid++;
    let s = `<defs><pattern id="${id}p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" class="cv-grid"/></pattern></defs>${BG(id)}`;
    // window
    s += `<g transform="translate(90 80)"><rect width="460" height="400" rx="14" class="cv-board"/><rect width="460" height="400" rx="14" fill="none" class="cv-edge"/>`;
    s += `<line x1="0" y1="40" x2="460" y2="40" class="cv-edge"/>`;
    [0, 1, 2].forEach((i) => (s += `<circle cx="${22 + i * 18}" cy="20" r="5" class="cv-mark"/>`));
    s += `<rect x="190" y="12" width="${80 + r() * 60}" height="16" rx="8" class="cv-chip"/>`;
    let y = 72, indent = 0;
    for (let i = 0; i < 13; i++) {
      s += `<text x="20" y="${y + 5}" class="cv-silk cv-silk-sm" text-anchor="start">${String(i + 1).padStart(2, "0")}</text>`;
      let x = 58 + indent * 22;
      const parts = 1 + Math.floor(r() * 3);
      for (let k = 0; k < parts; k++) {
        const w = 24 + r() * 90;
        if (x + w > 440) break;
        const accent = r() < 0.32;
        s += `<rect x="${x}" y="${y - 5}" width="${w}" height="10" rx="5" ${accent ? `style="fill:${a}"` : 'class="cv-code"'}/>`;
        x += w + 10;
      }
      y += 24;
      const t = r();
      if (t < 0.25 && indent < 3) indent++; else if (t > 0.7 && indent > 0) indent--;
    }
    s += `<rect x="58" y="${y - 6}" width="3" height="14" style="fill:${a}"><animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite"/></rect></g>`;
    // node graph
    const nodes = [[620, 140], [700, 250], [600, 330], [690, 430], [600, 500]].map(([x, y]) => [x + (r() - .5) * 30, y + (r() - .5) * 20]);
    nodes.forEach(([x, y], i) => { if (i) { const [px, py] = nodes[i - 1]; s += `<path d="M${px} ${py} C ${px} ${(py + y) / 2}, ${x} ${(py + y) / 2}, ${x} ${y}" fill="none" style="stroke:${a}" stroke-opacity=".6" stroke-width="2"/>`; } });
    nodes.forEach(([x, y], i) => (s += `<rect x="${x - 44}" y="${y - 18}" width="88" height="36" rx="8" class="cv-chip"/><circle cx="${x - 28}" cy="${y}" r="5" style="fill:${a}"/><rect x="${x - 16}" y="${y - 4}" width="${30 + (i % 3) * 8}" height="8" rx="4" class="cv-code"/>`));
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="cover" role="img" aria-label="${esc(p.title)}">${s}</svg>`;
  }

  const coverHTML = (p) => (p.cover ? `<img src="${esc(safeUrl(p.cover))}" alt="${esc(p.title)}" loading="lazy">` : p.type === "hardware" ? hardwareCover(p) : softwareCover(p));

  /* ---------- profile ---------- */
  const name = PROFILE.name || "Your Name";
  document.title = `${name} — Projects`;
  $("#nav-name").textContent = name;
  $("#hero-role").textContent = PROFILE.role || "";
  $("#hero-intro").textContent = PROFILE.intro || "";
  const ht = $("#hero-title");
  ht.setAttribute("aria-label", name);
  let ci = 0;
  ht.innerHTML = name.split(/\s+/).map((w) => `<span class="word" aria-hidden="true">${[...w].map((c) => `<span class="ch" style="--i:${ci++}">${esc(c)}</span>`).join("")}</span>`).join("");

  const count = (t) => PROJECTS.filter((p) => t === "all" || p.type === t).length;
  const years = PROJECTS.map((p) => p.year).filter(Boolean);
  $("#hero-stats").innerHTML = [["Hardware", count("hardware")], ["Software", count("software")], ["Since", years.length ? Math.min(...years) : "—"]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd data-count-to="${typeof v === "number" ? v : ""}">${v}</dd></div>`).join("");
  $$("[data-count]").forEach((el) => (el.textContent = count(el.dataset.count)));

  $("#about-lead").innerHTML = esc(PROFILE.intro || "").replace(/(circuit boards|firmware|software tools)/g, "<em>$1</em>");
  const topTags = (type) => {
    const m = new Map();
    PROJECTS.filter((p) => p.type === type).forEach((p) => (p.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t]) => `<li>${esc(t)}</li>`).join("");
  };
  $("#skills-hw").innerHTML = topTags("hardware");
  $("#skills-sw").innerHTML = topTags("software");

  const email = PROFILE.email || "";
  const ce = $("#contact-email");
  ce.textContent = email || "Say hello";
  ce.href = email ? `mailto:${email}` : (PROFILE.links || [])[0]?.href || "#";
  $("#contact-links").innerHTML = (PROFILE.links || []).map((l) => `<li><a href="${esc(safeUrl(l.href))}" target="_blank" rel="noopener noreferrer" data-magnetic>${esc(l.label)} ↗</a></li>`).join("");
  $("#contact-loc").textContent = PROFILE.location ? `Based in ${PROFILE.location}` : "";

  /* ---------- project cards ---------- */
  const grid = $("#projects");
  grid.innerHTML = PROJECTS.map((p, i) => `
    <a class="card" href="#/p/${esc(p.slug)}" data-slug="${esc(p.slug)}" data-type="${esc(p.type)}">
      <div class="card-frame">
        <div class="card-cover">${coverHTML(p)}</div>
        <div class="card-glare"></div>
        <div class="card-chip">
          <span class="chip" style="--c:${esc(p.accent || "")}"><i></i>${esc(p.type)}</span>
          ${p.placeholder ? '<span class="chip sample">Coming soon</span>' : ""}
        </div>
        <span class="card-open" aria-hidden="true">→</span>
      </div>
      <span class="card-num mono">${String(i + 1).padStart(2, "0")}</span>
      <div class="card-meta">
        <h3 class="card-title"><span>${esc(p.title)}</span></h3>
        <span class="card-year mono">${esc(p.year)}</span>
      </div>
      <p class="card-tag">${esc(p.tagline)}</p>
      <span class="card-tags mono">${esc((p.tags || []).slice(0, 3).join(" · "))}</span>
    </a>`).join("");
  const cards = $$(".card", grid);

  // Grid rows: two-card rows alternate big/small, three-card rows are even.
  // Remainders are chosen so no row is left with a lone card unless there is only one.
  function applyLayout() {
    const vis = cards.filter((c) => !c.classList.contains("out"));
    const pairs = [[8, 4], [4, 8], [6, 6]];
    const spans = [];
    let left = vis.length, k = 0, trio = false;
    while (left > 0) {
      let row;
      if (left === 1) row = [12];
      else if (left === 3) row = [4, 4, 4];
      else if (left === 2 || left === 4 || !trio) row = pairs[k++ % pairs.length];
      else row = [4, 4, 4];
      trio = !trio;
      spans.push(...row); left -= row.length;
    }
    vis.forEach((c, i) => c.style.setProperty("--span", spans[i]));
  }

  let filter = "all";
  function setFilter(f, animate = true) {
    filter = f;
    const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
    const wasOut = new Map(cards.map((c) => [c, c.classList.contains("out")]));
    cards.forEach((c) => c.classList.toggle("out", f !== "all" && c.dataset.type !== f));
    applyLayout();
    $$(".switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.filter === f)));
    moveThumb();
    if (!animate || reduced) return;
    cards.forEach((c) => {
      if (c.classList.contains("out")) return;
      const a = before.get(c), b = c.getBoundingClientRect();
      if (wasOut.get(c)) {
        c.animate([{ opacity: 0, transform: "translateY(30px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 700, easing: "cubic-bezier(.22,.9,.25,1)", delay: 120 });
      } else {
        const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width || 1;
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(1 - sx) < 0.5) return;
        c.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], { duration: 750, easing: "cubic-bezier(.22,.9,.25,1)" });
      }
    });
  }
  const thumb = $(".switch-thumb");
  function moveThumb() {
    const b = $(`.switch button[data-filter="${filter}"]`);
    thumb.style.width = b.offsetWidth + "px";
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  }
  $$(".switch button").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.filter)));
  $(".switch").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const bs = $$(".switch button"), i = bs.findIndex((b) => b.dataset.filter === filter);
    const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
    n.focus(); setFilter(n.dataset.filter);
  });
  window.addEventListener("resize", moveThumb);
  document.fonts?.ready.then(moveThumb);
  const startFilter = new URLSearchParams(location.search).get("type");
  setFilter(["hardware", "software"].includes(startFilter) ? startFilter : "all", false);

  // grid / index view
  $$(".view-toggle button").forEach((b) => b.addEventListener("click", () => {
    if (grid.dataset.view === b.dataset.view) return;
    const swap = () => {
      grid.dataset.view = b.dataset.view;
      $$(".view-toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    };
    if (document.startViewTransition && !reduced) document.startViewTransition(swap); else swap();
  }));

  // tilt + glare
  if (finePointer && !reduced) {
    cards.forEach((c) => {
      const f = $(".card-frame", c);
      c.addEventListener("pointermove", (e) => {
        if (grid.dataset.view !== "grid") return;
        const r = f.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        f.style.transform = `rotateX(${(0.5 - y) * 6}deg) rotateY(${(x - 0.5) * 8}deg)`;
        f.style.setProperty("--gx", x * 100 + "%"); f.style.setProperty("--gy", y * 100 + "%");
      });
      c.addEventListener("pointerleave", () => (f.style.transform = ""));
    });
  }

  // floating preview in index view
  const preview = $(".hover-preview"), previewInner = $(".hover-preview-inner");
  let pv = { x: 0, y: 0, tx: 0, ty: 0, slug: null };
  if (finePointer) {
    cards.forEach((c) => {
      c.addEventListener("pointerenter", () => {
        if (grid.dataset.view !== "index") return;
        if (pv.slug !== c.dataset.slug) { previewInner.innerHTML = $(".card-cover", c).innerHTML; pv.slug = c.dataset.slug; }
        preview.classList.add("on");
      });
      c.addEventListener("pointerleave", () => preview.classList.remove("on"));
    });
  }

  /* ---------- pointer: probe cursor, magnetic, scope ---------- */
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, active: false };
  const probe = $(".probe"), probeReadout = $(".probe-readout");
  const pr = { x: mouse.x, y: mouse.y };
  window.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
    pv.tx = e.clientX + 30; pv.ty = e.clientY - 120;
    if (finePointer) probe.classList.add("on");
  }, { passive: true });
  document.addEventListener("pointerleave", () => probe.classList.remove("on"));
  document.addEventListener("pointerover", (e) => probe.classList.toggle("hover", !!e.target.closest("a, button, .card")));

  $$("[data-magnetic]").forEach((el) => {
    if (!finePointer || reduced) return;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    el.addEventListener("pointerleave", () => (el.style.transform = ""));
  });

  const scopePath = $("#scope-path"), scopeV = $("#scope-v"), scopeF = $("#scope-freq");
  let phase = 0;
  function drawScope() {
    const fx = mouse.x / innerWidth, fy = mouse.y / innerHeight;
    const cycles = 1 + fx * 5, amp = 8 + (1 - fy) * 20;
    let d = "";
    for (let i = 0; i <= 100; i++) {
      const x = i * 2, t = (i / 100) * cycles * Math.PI * 2 + phase;
      const y = 30 - amp * (Math.sin(t) * 0.85 + Math.sin(t * 3) * 0.12);
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    scopePath.setAttribute("d", d);
    scopeV.textContent = ((1 - fy) * 5).toFixed(2) + " V";
    scopeF.textContent = Math.round(cycles * 200) + " Hz";
  }

  /* ---------- hero trace field ---------- */
  const canvas = $("#traces"), ctx = canvas.getContext("2d");
  const base = document.createElement("canvas"), lit = document.createElement("canvas"), mask = document.createElement("canvas"), tmp = document.createElement("canvas");
  let W = 0, H = 0, DPR = 1, traces = [], ripples = [], heroVisible = true;
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();

  function buildTraces() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    [canvas, base, lit, mask, tmp].forEach((c) => { c.width = W * DPR; c.height = H * DPR; });
    const r = rng("traces" + Math.round(W / 100));
    const g = 24, cols = Math.ceil(W / g), rows = Math.ceil(H / g);
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const used = new Set();
    traces = [];
    const N = Math.round((W * H) / 9000);
    for (let n = 0; n < N; n++) {
      let cx = Math.floor(r() * cols), cy = Math.floor(r() * rows);
      if (used.has(cx + "," + cy)) continue;
      let dir = Math.floor(r() * 4) * 2;
      const pts = [[cx * g, cy * g]];
      const segs = 2 + Math.floor(r() * 5);
      for (let s = 0; s < segs; s++) {
        const len = 1 + Math.floor(r() * 6);
        let ok = true;
        for (let k = 0; k < len; k++) {
          const nx = cx + dirs[dir][0], ny = cy + dirs[dir][1];
          if (nx < 0 || ny < 0 || nx > cols || ny > rows || used.has(nx + "," + ny)) { ok = false; break; }
          cx = nx; cy = ny; used.add(cx + "," + cy);
        }
        pts.push([cx * g, cy * g]);
        if (!ok) break;
        dir = (dir + (r() < 0.5 ? 1 : 7)) % 8; // 45° bends, like a routed board
      }
      if (pts.length < 2) continue;
      let L = 0; const cum = [0];
      for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(L); }
      if (L < g * 3) continue;
      traces.push({ pts, cum, L, speed: 40 + r() * 90, off: r() * 2000, w: r() < 0.15 ? 2.4 : 1.2 });
    }
    paintStatic();
  }

  function strokeTraces(c, color, alpha) {
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    c.globalAlpha = alpha; c.strokeStyle = color; c.fillStyle = color; c.lineJoin = "round"; c.lineCap = "round";
    traces.forEach((t) => {
      c.lineWidth = t.w; c.beginPath();
      t.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
      const [ex, ey] = t.pts[t.pts.length - 1], [sx, sy] = t.pts[0];
      c.beginPath(); c.arc(sx, sy, 3, 0, 7); c.stroke();
      c.beginPath(); c.arc(ex, ey, 2.4, 0, 7); c.fill();
    });
    c.globalAlpha = 1;
  }
  function paintStatic() {
    const light = root.dataset.theme === "light";
    strokeTraces(base.getContext("2d"), css("--ink"), light ? 0.13 : 0.11);
    strokeTraces(lit.getContext("2d"), css("--copper"), 0.95);
  }

  function pointAt(t, d) {
    const { pts, cum } = t;
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const s = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [lerp(pts[i - 1][0], pts[i][0], s), lerp(pts[i - 1][1], pts[i][1], s)];
  }

  let last = performance.now();
  const heroRect = () => canvas.getBoundingClientRect();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // probe + preview follow
    pr.x = lerp(pr.x, mouse.x, 0.25); pr.y = lerp(pr.y, mouse.y, 0.25);
    probe.style.transform = `translate(${pr.x}px, ${pr.y}px)`;
    probeReadout.textContent = `X ${(mouse.x * 0.2646).toFixed(1)}  Y ${(mouse.y * 0.2646).toFixed(1)} mm`;
    pv.x = lerp(pv.x, pv.tx, 0.14); pv.y = lerp(pv.y, pv.ty, 0.14);
    preview.style.transform = `translate(${pv.x}px, ${pv.y}px) rotate(${Math.max(-6, Math.min(6, (pv.tx - pv.x) * 0.04))}deg)`;

    if (heroVisible) {
      phase += dt * 4;
      drawScope();
      const hr = heroRect(), mx = mouse.x - hr.left, my = mouse.y - hr.top;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);

      // spotlight + ripples reveal the copper layer
      const tc = tmp.getContext("2d");
      tc.setTransform(DPR, 0, 0, DPR, 0, 0); tc.clearRect(0, 0, W, H);
      if (mouse.active) {
        const grd = tc.createRadialGradient(mx, my, 0, mx, my, 220);
        grd.addColorStop(0, "rgba(0,0,0,1)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        tc.fillStyle = grd; tc.fillRect(0, 0, W, H);
      }
      ripples = ripples.filter((rp) => (rp.r += dt * 900) < Math.hypot(W, H));
      ripples.forEach((rp) => {
        tc.strokeStyle = `rgba(0,0,0,${Math.max(0, 1 - rp.r / 900)})`;
        tc.lineWidth = 60; tc.beginPath(); tc.arc(rp.x, rp.y, rp.r, 0, 7); tc.stroke();
      });
      const mc = mask.getContext("2d");
      mc.setTransform(1, 0, 0, 1, 0, 0); mc.globalCompositeOperation = "source-over";
      mc.clearRect(0, 0, mask.width, mask.height);
      mc.drawImage(lit, 0, 0);
      mc.globalCompositeOperation = "destination-in";
      mc.drawImage(tmp, 0, 0);
      ctx.drawImage(mask, 0, 0);

      // current pulses
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = root.dataset.theme === "light" ? "source-over" : "lighter";
      const copper = css("--copper");
      ctx.strokeStyle = copper; ctx.lineCap = "round";
      const time = now / 1000;
      traces.forEach((t) => {
        const tail = 46, cycle = t.L + tail + 300;
        const head = ((time * t.speed + t.off) % cycle);
        if (head > t.L + tail) return;
        const [hx, hy] = pointAt(t, Math.min(head, t.L));
        const d = mouse.active ? Math.hypot(hx - mx, hy - my) : 1e4;
        const a = 0.12 + 0.88 * Math.exp(-(d * d) / (2 * 200 * 200));
        ctx.globalAlpha = a; ctx.lineWidth = t.w + 0.8;
        ctx.beginPath();
        const steps = 6;
        for (let k = 0; k <= steps; k++) {
          const dd = Math.max(0, Math.min(t.L, head - (tail * k) / steps));
          const [x, y] = pointAt(t, dd);
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        if (head <= t.L) { ctx.beginPath(); ctx.arc(hx, hy, 1.8 + a, 0, 7); ctx.fillStyle = copper; ctx.fill(); }
      });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
    requestAnimationFrame(frame);
  }

  canvas.parentElement.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button")) return;
    const hr = heroRect();
    ripples.push({ x: e.clientX - hr.left, y: e.clientY - hr.top, r: 0 });
  });
  new IntersectionObserver(([e]) => (heroVisible = e.isIntersecting)).observe(canvas);
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(buildTraces, 150); });
  window.addEventListener("themechange", paintStatic);
  buildTraces();
  if (reduced) { heroVisible = false; ctx.drawImage(base, 0, 0); drawScope(); }
  requestAnimationFrame(frame);

  /* ---------- reveal on scroll ---------- */
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    io.unobserve(e.target);
  }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  $$(".reveal").forEach((el, i) => { if (el.closest(".hero")) el.style.setProperty("--d", 0.5 + (i % 5) * 0.12 + "s"); io.observe(el); });
  requestAnimationFrame(() => ht.classList.add("in"));

  /* ---------- nav + clock ---------- */
  const nav = $(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 30);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  const clock = $("#clock");
  const tick = () => (clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  tick(); setInterval(tick, 15000);

  /* ---------- project detail ---------- */
  const detail = $("#detail"), panel = $(".detail-panel"), body = $("#detail-body");
  let current = null, openedInPage = false, lastFocus = null;
  const visibleList = () => PROJECTS.filter((p) => filter === "all" || p.type === filter);

  function render(p) {
    const list = visibleList().some((x) => x.slug === p.slug) ? visibleList() : PROJECTS;
    const i = list.findIndex((x) => x.slug === p.slug), next = list[(i + 1) % list.length];
    $("#detail-crumb").textContent = `${p.type} / ${String(PROJECTS.indexOf(p) + 1).padStart(2, "0")} — ${p.title}`;
    const items = [
      `<div class="d-chips"><span class="chip" style="--c:${esc(p.accent || "")}"><i></i>${esc(p.type)}</span><span class="chip">${esc(p.year)}</span>${p.status ? `<span class="chip">${esc(p.status)}</span>` : ""}${p.role ? `<span class="chip">${esc(p.role)}</span>` : ""}${p.placeholder ? '<span class="chip sample">Coming soon</span>' : ""}</div>`,
      `<h2 class="d-title" id="detail-title">${esc(p.title)}</h2>`,
      `<p class="d-tagline">${esc(p.tagline)}</p>`,
      `<div class="d-cover">${coverHTML(p)}</div>`,
      `<div class="d-grid">
        <div>
          <p class="d-summary">${esc(p.summary)}</p>
          ${(p.sections || []).map((s) => `<div class="d-section"><h3>${esc(s.heading)}</h3><p>${s.body}</p></div>`).join("")}
          ${(p.links || []).length ? `<div class="d-links">${p.links.map((l, k) => `<a class="btn ${k ? "btn-ghost" : "btn-solid"}" href="${esc(safeUrl(l.href))}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join("")}</div>` : ""}
        </div>
        <aside class="datasheet">
          <div class="datasheet-head mono"><span>Datasheet</span><span>${esc(p.slug)}</span></div>
          <table>${(p.specs || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
          ${(p.tags || []).length ? `<div class="d-tags">${p.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
        </aside>
      </div>`,
      (p.gallery || []).length ? `<div class="d-gallery">${p.gallery.map((g) => `<figure><img src="${esc(safeUrl(g.src))}" alt="${esc(g.caption || p.title)}" loading="lazy">${g.caption ? `<figcaption class="mono">${esc(g.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : "",
      list.length > 1 ? `<a class="d-next" href="#/p/${esc(next.slug)}" data-swap><span class="mono muted">Next project →</span><span>${esc(next.title)}</span></a>` : "",
    ].filter(Boolean);
    body.classList.remove("show");
    body.innerHTML = items.map((h, k) => h.replace(/^(\s*<\w+)/, `$1 style="--i:${k}"`)).join("");
    panel.scrollTop = 0;
    void body.offsetWidth;
    requestAnimationFrame(() => body.classList.add("show"));
  }

  function show(slug) {
    const p = PROJECTS.find((x) => x.slug === slug);
    if (!p) return hide();
    const wasOpen = current !== null;
    current = p;
    render(p);
    if (wasOpen) return;
    lastFocus = document.activeElement;
    detail.hidden = false;
    document.body.classList.add("locked");
    requestAnimationFrame(() => requestAnimationFrame(() => detail.classList.add("open")));
    panel.focus({ preventScroll: true });
  }
  function hide() {
    if (current === null) return;
    current = null;
    detail.classList.remove("open");
    document.body.classList.remove("locked");
    setTimeout(() => { if (current === null) { detail.hidden = true; body.classList.remove("show"); } }, reduced ? 0 : 800);
    lastFocus?.focus?.({ preventScroll: true });
  }
  function close() {
    if (openedInPage) { openedInPage = false; history.back(); }
    else { history.replaceState(null, "", location.pathname + location.search + "#work"); hide(); }
  }
  function step(dir) {
    if (!current) return;
    const list = visibleList().some((x) => x.slug === current.slug) ? visibleList() : PROJECTS;
    const i = list.findIndex((x) => x.slug === current.slug);
    const n = list[(i + dir + list.length) % list.length];
    history.replaceState(null, "", "#/p/" + n.slug);
    show(n.slug);
  }
  const route = () => {
    const m = location.hash.match(/^#\/p\/(.+)$/);
    if (m) show(decodeURIComponent(m[1])); else hide();
  };
  window.addEventListener("hashchange", route);
  grid.addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (!c || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    preview.classList.remove("on");
    openedInPage = true;
    location.hash = "/p/" + c.dataset.slug;
  });
  detail.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { e.preventDefault(); close(); }
    const sw = e.target.closest("[data-swap]");
    if (sw) { e.preventDefault(); step(1); }
  });
  $("#detail-prev").addEventListener("click", () => step(-1));
  $("#detail-next").addEventListener("click", () => step(1));
  document.addEventListener("keydown", (e) => {
    if (!current) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" || (e.key === "ArrowDown" && e.altKey)) step(1);
    else if (e.key === "ArrowLeft" || (e.key === "ArrowUp" && e.altKey)) step(-1);
    else if (e.key === "Tab") {
      const f = $$("a[href], button", panel).filter((x) => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  route();
})();
