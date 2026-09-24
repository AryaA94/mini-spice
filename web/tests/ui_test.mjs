// web/tests/ui_test.mjs -- end-to-end test of the built web tool.
//
// Loads web/dist/mini-spice-web.html (the real compiled WASM engine plus
// the UI) in jsdom, clicks through presets and the add-component form the
// way a person would, and checks the results three independent ways:
//
//   1. The netlist text the UI generates, asserted literally against the
//      hand-written examples/*.cir it's meant to reproduce (those netlists
//      are themselves validated against ngspice and pinned by golden tests).
//   2. The WASM engine's output vs. the native CLI (a different compiler,
//      fed a hand-written netlist rather than the UI's generated one).
//   3. For waveform sources on purely resistive circuits (no integration
//      error to hide behind), the output vs. the SPICE PULSE/SIN
//      definitions evaluated here in the test, from the definitions in
//      docs/SUPPORTED_COMPONENTS.md -- a test oracle, not a port of the
//      engine: nothing here is shipped or used by the page.
//
// Usage (from the repo root, after building the CLI and web/build_web.sh):
//   cd web/tests && npm install && node ui_test.mjs
// Exits nonzero on any failure.
import { JSDOM } from "jsdom";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const PAGE = process.env.MINISPICE_WEB_HTML || path.join(REPO, "web/dist/mini-spice-web.html");
const CLI = process.env.MINISPICE_CLI || path.join(REPO, "build/default/minispice");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ms_ui_test_"));

let failures = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log("  ok   " + msg); }
  else { failures++; console.log("  FAIL " + msg); }
}
// Runs one group of checks; an exception inside counts as a failure and
// the remaining sections still run.
async function section(name, body) {
  console.log("\n" + name);
  try { await body(); } catch (e) { failures++; console.log("  FAIL threw: " + e.message); }
}

/* ---------------- page driving ---------------- */
async function loadPage({ storage } = {}) {
  const errors = [];
  const dom = new JSDOM(fs.readFileSync(PAGE, "utf8"), {
    runScripts: "dangerously",
    url: "https://example.test/",
    beforeParse(win) {
      win.console.error = (...a) => errors.push(a.join(" "));
      if (storage) for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
    },
  });
  const d = dom.window.document;
  const btn = d.getElementById("runBtn");
  for (let i = 0; i < 400 && btn.disabled; i++) await new Promise(r => setTimeout(r, 25));
  if (btn.disabled) throw new Error("engine never loaded: " + btn.textContent + " " + errors.join("|"));
  return { w: dom.window, d, errors };
}
const visible = (d, id) => d.getElementById(id).style.display !== "none";
const rowsOf = w => w.eval("JSON.parse(JSON.stringify(rows))");
const netlistOf = w => w.eval("rowsToNetlist(rows)");
function clickPreset(d, name) {
  const chip = [...d.querySelectorAll("#presets .chip")].find(b => b.textContent === name);
  if (!chip) throw new Error("no preset named " + name);
  chip.click();
}
function set(d, id, value) {
  const el = d.getElementById(id);
  if (el.type === "checkbox") el.checked = value; else el.value = value;
  el.dispatchEvent(new d.defaultView.Event("change"));
}
// Fills and submits the add form. `wf` is the list of raw strings typed
// into the waveform slots, in order. Returns the add-error text ("" = ok).
function addViaForm(d, { type, name, nodeA, nodeB, value = "", extra1 = "", extra2 = "", waveform = "", wf = [] }) {
  set(d, "f-type", type);
  set(d, "f-wf", waveform);
  set(d, "f-name", name); set(d, "f-nodeA", nodeA); set(d, "f-nodeB", nodeB);
  set(d, "f-value", value); set(d, "f-extra1", extra1); set(d, "f-extra2", extra2);
  for (let i = 1; i <= 7; i++) d.getElementById("f-wf" + i).value = wf[i - 1] ?? "";
  d.getElementById("addBtn").click();
  const err = d.getElementById("addError");
  return err.classList.contains("show") ? err.textContent : "";
}
function run(d, mode, params = {}) {
  d.querySelector(`.tab[data-mode="${mode}"]`).click();
  for (const [id, v] of Object.entries(params)) d.getElementById(id).value = v;
  d.getElementById("runBtn").click();
  const err = d.getElementById("runError");
  if (err.classList.contains("show")) throw new Error("run error: " + err.textContent);
  return d.getElementById("rawData").value;
}

/* ---------------- reference data ---------------- */
function cli(args) {
  const out = path.join(TMP, "cli.csv");
  execFileSync(CLI, [...args, "--csv", out]);
  return fs.readFileSync(out, "utf8");
}
function cliNetlist(text, args) {
  const f = path.join(TMP, "ref.cir");
  fs.writeFileSync(f, text);
  return cli([args[0], f, ...args.slice(1)]);
}
function parseCsv(text) {
  const lines = text.trim().split("\n");
  return { header: lines[0].split(","), rows: lines.slice(1).map(l => l.split(",").map(Number)) };
}
// The WASM boundary prints with default ostream precision (6 significant
// digits), the CLI's --csv with more, so identical solves agree to ~5e-6
// relative. Returns the worst |x-y| / (rel*|y| + abs); <= 1 is a match.
function csvScore(a, b, rel = 1e-5, abs = 1e-12) {
  const A = parseCsv(a), B = parseCsv(b);
  if (A.header.join() !== B.header.join()) return Infinity;
  if (A.rows.length !== B.rows.length) return Infinity;
  let worst = 0;
  A.rows.forEach((r, i) => r.forEach((x, j) => {
    const e = Math.abs(x - B.rows[i][j]) / (rel * Math.abs(B.rows[i][j]) + abs);
    if (!(e <= worst)) worst = e; // NaN wins
  }));
  return worst;
}
// DC: the web's raw output is "node,voltage_V\n<name>,<v>...\nI(V1),<i>",
// the CLI's --csv is a different shape, so compare the numbers by name.
function dcWeb(raw) {
  const m = {};
  raw.trim().split("\n").slice(1).forEach(l => { const [k, v] = l.split(","); m[k] = Number(v); });
  return m;
}
// The CLI's dc command prints "  V(name) = <value> V" lines (6 decimals).
function dcCli(circuitPath) {
  const m = {};
  for (const l of execFileSync(CLI, ["dc", circuitPath], { encoding: "utf8" }).split("\n")) {
    const mm = l.match(/^\s*V\((.+)\) = (\S+) V$/);
    if (mm) m[mm[1]] = Number(mm[2]);
  }
  return m;
}

// Test oracles: the SPICE definitions, straight from
// docs/SUPPORTED_COMPONENTS.md / DESIGN_DECISIONS.md #17.
function pulseAt(t, [v1, v2, td, tr, tf, pw, per]) {
  if (t < td) return v1;
  const period = per > 0 ? per : tr + pw + tf;
  let x = (t - td) % period;
  if (x < tr) return v1 + (v2 - v1) * x / tr;
  x -= tr; if (x < pw) return v2;
  x -= pw; if (x < tf) return v2 + (v1 - v2) * x / tf;
  return v1;
}
function sinAt(t, [vo, va, freq, td, theta]) {
  if (t < td) return vo;
  return vo + va * Math.exp(-(t - td) * theta) * Math.sin(2 * Math.PI * freq * (t - td));
}

/* ======================= tests ======================= */
const EX12 = fs.readFileSync(path.join(REPO, "examples/12_pulse_rc_filter/circuit.cir"), "utf8");
const EX13 = fs.readFileSync(path.join(REPO, "examples/13_sine_source/circuit.cir"), "utf8");
const componentLines = t => t.split("\n").filter(l => l.trim() && !l.startsWith("*"));

await section("PULSE preset reproduces examples/12_pulse_rc_filter", async () => {
  const { w, d, errors } = await loadPage();
  clickPreset(d, "PULSE into RC filter");
  check(d.querySelector(".tab.active").dataset.mode === "tran", "preset switches to the Transient tab");
  check(d.getElementById("tran-dt").value === "2e-5" && d.getElementById("tran-stop").value === "10e-3", "preset sets dt=2e-5, stop=10e-3");
  const net = netlistOf(w);
  check(net === "V1 in 0 PULSE(0 5 0.001 0.0001 0.0001 0.002 0.004)\nR1 in out 1000\nC1 out 0 0.000001\n",
        "generated netlist is exactly the expected text: " + JSON.stringify(net));
  // Same circuit as the example, parameter for parameter (the example
  // writes 1m/0.1m/1k/1u where the UI writes plain decimals).
  const exLines = componentLines(EX12);
  check(exLines[0] === "V1 in 0 PULSE(0 5 1m 0.1m 0.1m 2m 4m)" && exLines[1] === "R1 in out 1k" && exLines[2] === "C1 out 0 1u",
        "examples/12 netlist is the one the expected text above transcribes");
  const web = run(d, "tran");
  const ref = cli(["tran", path.join(REPO, "examples/12_pulse_rc_filter/circuit.cir"), "--dt", "2e-5", "--stop", "10e-3"]);
  const score = csvScore(web, ref);
  check(score <= 1, `transient matches native CLI on examples/12 (score ${score.toFixed(3)})`);
  // Negative control: the comparison must be able to fail. Same circuit
  // with TD nudged from 1m to 1.02m (one timestep) must NOT match.
  const nudged = cliNetlist(EX12.replace("PULSE(0 5 1m", "PULSE(0 5 1.02m"), ["tran", "--dt", "2e-5", "--stop", "10e-3"]);
  check(csvScore(web, nudged) > 1, "negative control: a one-step TD shift is detected as a mismatch");
  const dc = dcWeb(run(d, "dc")), dcRef = dcCli(path.join(REPO, "examples/12_pulse_rc_filter/circuit.cir"));
  check(dc.in === 0 && dc.out === 0 && dcRef.in === 0 && dcRef.out === 0, "DC operating point uses V1 (=0), same as the CLI");
  const tr = d.querySelector("#componentBody tr");
  check(tr.children[3].textContent === "0V", "table Value column shows the DC value actually used (V1=0V)");
  check(tr.children[4].textContent === "PULSE(0 5 0.001 0.0001 0.0001 0.002 0.004)", "table Extra column shows the waveform: " + tr.children[4].textContent);
  check(errors.length === 0, "no console errors");
});

await section("SIN preset reproduces examples/13_sine_source", async () => {
  const { w, d, errors } = await loadPage();
  clickPreset(d, "SIN into RC filter");
  const net = netlistOf(w);
  check(net === "V1 in 0 SIN(1 2 500 0 0)\nR1 in out 1000\nC1 out 0 1e-7\n", "generated netlist is exactly the expected text: " + JSON.stringify(net));
  const exLines = componentLines(EX13);
  check(exLines[0] === "V1 in 0 SIN(1 2 500 0 0)" && exLines[1] === "R1 in out 1k" && exLines[2] === "C1 out 0 100n",
        "examples/13 netlist is the one the expected text above transcribes");
  const web = run(d, "tran");
  const ref = cli(["tran", path.join(REPO, "examples/13_sine_source/circuit.cir"), "--dt", "2e-5", "--stop", "6e-3"]);
  const score = csvScore(web, ref);
  check(score <= 1, `transient matches native CLI on examples/13 (score ${score.toFixed(3)})`);
  const dc = dcWeb(run(d, "dc"));
  check(dc.in === 1, "DC operating point uses VO (=1V)");
  check(errors.length === 0, "no console errors");
});

await section("Form: dynamic fields", async () => {
  const { d } = await loadPage();
  set(d, "f-type", "R");
  check(!visible(d, "f-wf-wrap") && !visible(d, "f-wf-params"), "R: no waveform selector or params");
  set(d, "f-type", "V");
  check(visible(d, "f-wf-wrap") && !visible(d, "f-wf-params"), "V: selector shown, params hidden while None");
  check(d.getElementById("f-value-label").textContent === "DC value", "V without waveform: DC value is required (label)");
  set(d, "f-wf", "PULSE");
  const shown = [1, 2, 3, 4, 5, 6, 7].filter(i => visible(d, "f-wf" + i + "-wrap"));
  check(shown.length === 7, "PULSE shows 7 parameter slots");
  check(d.getElementById("f-wf1-label").textContent === "V1 initial (V)" && d.getElementById("f-wf7-label").textContent === "PER period (s)",
        "PULSE slots labeled in netlist order, V1 first and PER last");
  check(d.getElementById("f-value-label").textContent === "DC value (optional)", "with a waveform, DC value becomes optional");
  set(d, "f-wf", "SIN");
  const shownSin = [1, 2, 3, 4, 5, 6, 7].filter(i => visible(d, "f-wf" + i + "-wrap"));
  check(shownSin.join() === "1,2,3,4,5", "SIN shows exactly slots 1-5");
  check(d.getElementById("f-wf3-label").textContent === "FREQ (Hz)" && d.getElementById("f-wf5-label").textContent === "THETA damping (1/s)", "SIN slot labels");
  set(d, "f-type", "I");
  check(d.getElementById("f-wf1-label").textContent === "VO offset (A)", "on an I source, levels are labeled in amps");
  set(d, "f-type", "C");
  check(d.getElementById("f-wf").value === "" && !visible(d, "f-wf-wrap") && !visible(d, "f-wf-params"), "switching to a non-source type clears and hides the waveform");
  set(d, "f-type", "V");
  check(d.getElementById("f-wf").value === "" && !visible(d, "f-wf-params"), "...and switching back starts at None");
});

await section("Form: validation rejects bad waveforms without adding a row", async () => {
  const { w, d } = await loadPage();
  const base = { type: "V", name: "V1", nodeA: "in", nodeB: "0" };
  const cases = [
    [{ waveform: "PULSE", wf: ["0", "", "", "", "", "1m", ""] }, "PULSE needs V2."],
    [{ waveform: "PULSE", wf: ["0", "5", "", "-1u", "", "1m", ""] }, "PULSE TR can't be negative."],
    [{ waveform: "PULSE", wf: ["0", "5", "", "", "", "1m", "-2m"] }, "PULSE PER can't be negative."],
    [{ waveform: "PULSE", wf: ["0", "5", "1m", "", "", "", ""] }, "PULSE has zero width: set PW (and/or TR/TF)."],
    [{ waveform: "SIN", wf: ["0", "1"] }, "SIN needs FREQ."],
    [{ waveform: "SIN", wf: ["0", "1", "0"] }, "SIN FREQ must be positive."],
    [{ waveform: "SIN", wf: ["0", "1", "-5"] }, "SIN FREQ must be positive."],
    [{ waveform: "SIN", wf: ["0", "abc", "1k"] }, "not a valid number: 'abc'"],
    [{ waveform: "" }, "Value is required."],
  ];
  for (const [c, expected] of cases) {
    const err = addViaForm(d, { ...base, ...c });
    check(err === expected, `${c.waveform || "no waveform"} [${(c.wf || []).join(",")}] -> "${err}"`);
  }
  check(rowsOf(w).length === 0, "no rows were added by any rejected submission");
});

await section("Form: PULSE built by hand == the PULSE preset", async () => {
  const { w, d } = await loadPage();
  const e1 = addViaForm(d, { type: "V", name: "V1", nodeA: "in", nodeB: "0", waveform: "PULSE", wf: ["0", "5", "1m", "0.1m", "0.1m", "2m", "4m"] });
  // Checked right away: the next addViaForm() call sets every field itself.
  check(d.getElementById("f-type").value === "V" && d.getElementById("f-wf").value === "" && !visible(d, "f-wf-params") &&
        [1, 2, 3, 4, 5, 6, 7].every(i => d.getElementById("f-wf" + i).value === ""),
        "form resets waveform selector and slots after a successful add");
  const e2 = addViaForm(d, { type: "R", name: "R1", nodeA: "in", nodeB: "out", value: "1k" });
  const e3 = addViaForm(d, { type: "C", name: "C1", nodeA: "out", nodeB: "0", value: "1u" });
  check(!e1 && !e2 && !e3, "all three rows accepted (" + [e1, e2, e3].join("|") + ")");
  check(netlistOf(w) === "V1 in 0 PULSE(0 5 0.001 0.0001 0.0001 0.002 0.004)\nR1 in out 1000\nC1 out 0 0.000001\n",
        "netlist identical to the preset's (SI suffixes parsed, no DC clause)");
});

await section("Form: PULSE with explicit DC and AC on a resistive divider (closed-form oracle)", async () => {
  const { w, d, errors } = await loadPage();
  const P = [1, 3, 0.5e-3, 0.2e-3, 0.3e-3, 1e-3, 3e-3];
  addViaForm(d, { type: "V", name: "V1", nodeA: "in", nodeB: "0", value: "2", extra1: "1", extra2: "0", waveform: "PULSE", wf: ["1", "3", "0.5m", "0.2m", "0.3m", "1m", "3m"] });
  addViaForm(d, { type: "R", name: "R1", nodeA: "in", nodeB: "out", value: "1k" });
  addViaForm(d, { type: "R", name: "R2", nodeA: "out", nodeB: "0", value: "1k" });
  const net = netlistOf(w);
  check(net.split("\n")[0] === "V1 in 0 DC 2 PULSE(1 3 0.0005 0.0002 0.0003 0.001 0.003) AC 1 0", "DC, waveform, AC clauses in parser order: " + net.split("\n")[0]);
  const tbl = parseCsv(run(d, "tran", { "tran-dt": "1e-5", "tran-stop": "7e-3" }));
  const iT = 0, iIn = tbl.header.indexOf("V(in)"), iOut = tbl.header.indexOf("V(out)");
  let worstIn = 0, worstOut = 0;
  for (const r of tbl.rows) {
    worstIn = Math.max(worstIn, Math.abs(r[iIn] - pulseAt(r[iT], P)));
    worstOut = Math.max(worstOut, Math.abs(r[iOut] - pulseAt(r[iT], P) / 2));
  }
  // 6 significant digits on values up to 3V -> print error <= ~5e-6.
  check(tbl.rows.length === 701 && worstIn < 1e-5 && worstOut < 1e-5,
        `V(in) tracks PULSE definition, V(out) = half of it, all ${tbl.rows.length} steps (worst ${worstIn.toExponential(2)} / ${worstOut.toExponential(2)} V)`);
  const ref = cliNetlist("V1 in 0 DC 2 PULSE(1 3 0.5m 0.2m 0.3m 1m 3m) AC 1 0\nR1 in out 1k\nR2 out 0 1k\n", ["tran", "--dt", "1e-5", "--stop", "7e-3"]);
  check(csvScore(run(d, "tran"), ref) <= 1, "transient matches native CLI on the hand-written netlist");
  const dc = dcWeb(run(d, "dc"));
  check(dc.in === 2 && dc.out === 1, "DC operating point honors explicit DC 2 (not V1=1)");
  const ac = parseCsv(run(d, "ac"));
  const iMag = ac.header.indexOf("V(out)_mag_db");
  check(ac.rows.every(r => Math.abs(r[iMag] - 20 * Math.log10(0.5)) < 1e-4), "AC clause still works alongside a waveform: flat -6.02 dB");
  check(errors.length === 0, "no console errors");
});

await section("Form: SIN on a current source, with delay and damping (closed-form oracle)", async () => {
  const { w, d, errors } = await loadPage();
  const S = [0, 1e-3, 1e3, 0.2e-3, 500];
  const err = addViaForm(d, { type: "I", name: "I1", nodeA: "0", nodeB: "n", value: "2m", waveform: "SIN", wf: ["0", "1m", "1k", "0.2m", "500"] });
  addViaForm(d, { type: "R", name: "R1", nodeA: "n", nodeB: "0", value: "1k" });
  check(!err, "I source with SIN accepted");
  check(netlistOf(w).split("\n")[0] === "I1 0 n DC 0.002 SIN(0 0.001 1000 0.0002 500)", "netlist: " + netlistOf(w).split("\n")[0]);
  const dc = dcWeb(run(d, "dc"));
  // "I1 0 n": SPICE's convention delivers the current into n, so V(n) is
  // +R*i (DESIGN_DECISIONS.md #19). k = V(n) per amp of source current.
  const k = dc.n / 2e-3;
  check(Math.abs(k - 1000) < 1e-6, `DC point: V(n) = +1k * 2mA (SPICE current direction; k = ${k})`);
  const tbl = parseCsv(run(d, "tran", { "tran-dt": "1e-5", "tran-stop": "5e-3" }));
  const iN = tbl.header.indexOf("V(n)");
  let worst = 0;
  for (const r of tbl.rows) worst = Math.max(worst, Math.abs(r[iN] - k * sinAt(r[0], S)));
  check(worst < 1e-5, `V(n) = R * SIN definition (with TD and THETA) at all ${tbl.rows.length} steps (worst ${worst.toExponential(2)} V)`);
  const ref = cliNetlist("I1 0 n DC 2m SIN(0 1m 1k 0.2m 500)\nR1 n 0 1k\n", ["tran", "--dt", "1e-5", "--stop", "5e-3"]);
  check(csvScore(run(d, "tran"), ref) <= 1, "transient matches native CLI on the hand-written netlist");
  check(errors.length === 0, "no console errors");
});

await section("Persistence: a saved waveform circuit survives a reload", async () => {
  const first = await loadPage();
  clickPreset(first.d, "SIN into RC filter");
  const firstRun = run(first.d, "tran");
  const saved = first.w.localStorage.getItem("minispice_web_state_v1");
  const second = await loadPage({ storage: { minispice_web_state_v1: saved } });
  check(JSON.stringify(rowsOf(second.w)) === JSON.stringify(rowsOf(first.w)), "rows (including waveform) restored from localStorage");
  check(second.d.querySelector(".tab.active").dataset.mode === "tran", "mode restored");
  check(second.d.getElementById("rawData").value === firstRun, "auto-run on load reproduces the same transient output");
});

await section("No regression: every pre-existing preset generates the same netlist as the original build", async () => {
  const ORIGINAL = process.env.MINISPICE_WEB_HTML_BASELINE;
  if (!ORIGINAL) {
    console.log("  skip (set MINISPICE_WEB_HTML_BASELINE to an older build to run this)");
  } else {
    const now = await loadPage();
    const oldPage = new JSDOM(fs.readFileSync(ORIGINAL, "utf8"), { runScripts: "dangerously", url: "https://example.test/" });
    const oldPresets = Object.keys(oldPage.window.eval("PRESETS"));
    for (const name of oldPresets) {
      clickPreset(now.d, name);
      const a = netlistOf(now.w);
      const b = oldPage.window.eval(`rowsToNetlist(PRESETS[${JSON.stringify(name)}])`);
      check(a === b, `"${name}" netlist unchanged`);
    }
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
