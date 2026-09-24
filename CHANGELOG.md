# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased] - Web tool polish and input safety

### Fixed (web tool)
- **A node name containing a space silently built the wrong circuit**
  (`in put` became two separate netlist fields). Names and nodes are now
  limited to letters, digits and `_`. That also stops `*`/`#` (comment
  characters to the parser) from truncating a line.
- User-typed names were inserted into the page as raw HTML; all user text
  is now escaped.
- A tiny dt with a long stop time could exhaust memory (`std::bad_alloc`)
  or hang the tab: transient runs are capped at 200,000 steps and AC sweeps
  at 20,000 points, with an error saying how to adjust.
- An AC sweep with no AC source plotted a flat -6000 dB line; it now
  explains that a source needs an AC magnitude. A fractional
  points/decade was silently truncated; it's now rejected.
- Duplicate component names are caught case-insensitively (SPICE's
  convention). A new node that differs from an existing one only in
  capitalization is flagged, since node names are case-sensitive in this
  engine and "Out" vs "out" would be two unconnected nodes.

### Changed (web tool)
- Charts: round-number ticks with one SI prefix per axis ("time (ms)"),
  decade labels (10 ... 1M) with minor gridlines on AC plots, and a
  hover/touch readout of exact values at any point. Charts are drawn at
  the on-screen width, so text stays readable on phones.
- Values shown in engineering notation ("100 kΩ", "-41.887 µA"), and
  waveforms in SPICE suffix form (`PULSE(0 5 1m 100u 100u 2m 4m)`).
- Every preset switches to its analysis (with matching settings) and runs
  immediately. The RLC preset now uses the example's dt=2e-6, fine enough
  to resolve the ringing.
- Components can be edited in place (pencil button). Enter adds or saves,
  Escape cancels an edit, and Enter in an analysis field runs it.
- Results dim with a note when the circuit changes after a run. There's a
  "download CSV" button, per-type example values in the form, and a link
  to the source repo.

## [0.6.0] - PULSE/SIN in the web tool; current source direction fix

### Changed (breaking)
- **Independent current sources (`I`) now follow SPICE's direction**:
  `I1 p n <value>` flows from `p` through the source to `n`, so
  `I1 0 out 2m` into 1k gives `V(out) = +2V`. It was previously reversed
  (`-2V`), in DC, AC and transient alike. Existing netlists that relied on
  the old direction need their two `I`-source nodes swapped. No examples,
  golden files or web presets were affected. See
  `docs/DESIGN_DECISIONS.md` #19, including why this went uncaught.

### Added
- Five ngspice cross-checks for current sources in
  `tools/compare_to_spice.py` (DC alone, DC aiding a voltage source, AC
  phase, PULSE transient), each confirmed to fail on the old engine
  before the fix. Also four new unit tests (circuit-level V=IR, hand KCL,
  consistency with the ngspice-validated `G` device, and the AC stamp),
  likewise confirmed to fail first.
- Web tool: `V`/`I` sources get a Waveform selector (None / PULSE / SIN)
  that reveals the waveform's parameter fields (7 for PULSE, 5 for SIN) in
  netlist order. The DC value becomes optional when a waveform is
  attached, falling back to the waveform's rest value exactly as a
  hand-written netlist does. Two new presets, "PULSE into RC filter" and
  "SIN into RC filter", reproduce `examples/12_pulse_rc_filter` and
  `examples/13_sine_source` and switch straight to the Transient tab with
  matching dt/stop. See `docs/DESIGN_DECISIONS.md` #18.
- `web/tests/ui_test.mjs`: an end-to-end test of the built page in jsdom
  (64 checks). It checks the generated netlist text literally, the WASM
  results against the native CLI, and waveform-source outputs against the
  PULSE/SIN definitions evaluated in the test. Every one of 8 deliberate
  UI breakages ("mutations") was confirmed to fail it.
- `tools/compare_to_spice.py` now cross-checks the PULSE and SIN examples
  against ngspice. Decision 17 described that comparison, but the script
  had no cases for it, so it wasn't reproducible. Results and a
  convergence check (10x smaller dt gives exactly 10x smaller error) are
  in `docs/ngspice_comparison.md`.

### Fixed
- `web/build_web.sh` failed to link on current Emscripten releases
  ("undefined C++ symbols"): it compiled C++ with `emcc`, which only
  happened to link libc++ on the old Ubuntu 3.1.x package. Now uses
  `em++`.

## [0.5.0] - Time-varying sources (PULSE, SIN)

### Added
- `Waveform` (PULSE and SIN, standard SPICE forms) attachable to `V`/`I`
  sources; DC operating point defaults to the waveform's rest value
  (`PULSE`'s V1, `SIN`'s VO) when no explicit `DC` value is given.
- `Component::stamp_time_domain()` now takes an absolute time `t` in
  addition to the step size `dt` -- a signature change touching every
  component (most ignore it; only `VoltageSource`/`CurrentSource` use it,
  and only during a transient step with a waveform attached).
  `transient_solver.cpp` threads its already-tracked running time through
  to each step instead of discarding it.
- Waveforms are evaluated at each step's *end* time (backward Euler's
  implicit convention), not its start -- consistent with how the
  capacitor/inductor companion models already treat time.
- Validation: hand-computed `Waveform::value_at()` checks for both shapes
  (including zero rise/fall time, SIN's TD delay, THETA damping); a
  pure-resistive circuit test confirming the *solver* (not just the
  waveform function) evaluates the right absolute time each step;
  transient runs of both PULSE and SIN cross-checked against ngspice.
- `docs/DESIGN_DECISIONS.md` #17: the full interface-change rationale and
  a real ngspice-comparison bug this caught (a UIC-flag mismatch giving a
  suspicious exact 1.0V constant offset, same class of issue as Decision
  11's discovery).

### Fixed
- Existing unit tests calling `stamp_time_domain()` directly (bypassing
  the solvers) needed updating for the new signature -- a mechanical fix
  across `test_components.cpp`, `test_diode.cpp`, `test_bjt.cpp`, and
  `test_controlled_sources.cpp`.
- Decision 7 (the original "no time-varying sources" scope cut) and a
  stale comment in `transient_solver.hpp` both still claimed PULSE/SIN
  wasn't supported after this release added it -- updated to point to
  Decision 17 instead of contradicting it.

## [0.4.0] - PNP, controlled sources, and AC for nonlinear devices

### Added
- PNP transistor support (`Bjt`'s `is_pnp` flag, `TYPE=PNP` on a `Q`
  line): implemented as an NPN mirror (every voltage/current sign
  flipped), reusing the same Newton-Raphson machinery. Validated as the
  exact negation of the already-validated NPN case, and separately
  against ngspice's own PNP model.
- `Vcvs` (`E<name> out+ out- ctrl+ ctrl- gain`) and `Vccs` (`G<name> out+
  out- ctrl+ ctrl- transconductance`): linear controlled sources needing
  no Newton-Raphson, so (unlike the diode/BJT) they work correctly in AC
  analysis immediately. Validated against ngspice's native `E`/`G`
  syntax.
- Generalized the netlist parser's branch-index bookkeeping
  (`Component::get_branch_index()`) from being hardcoded to
  `VoltageSource` to working for any component reporting
  `extra_unknowns() > 0`, so `Vcvs` could reuse it without duplicating
  the two-pass fixup logic.
- `solve_ac_sweep()` now computes a DC operating point first (reusing
  `solve_dc()`) whenever a circuit contains a diode or BJT, then
  linearizes around it for the sweep -- removing the "AC refuses" limit
  from the previous release. Validated independently of both ngspice and
  this solver's own AC code: a finite-difference perturbation of the DC
  solve matches the AC solver's small-signal gain to 9+ significant
  figures for both the diode and BJT cases.
- `docs/DESIGN_DECISIONS.md` #14-16 covering all three additions.

### Fixed
- `Vccs`'s doc comment described its current direction backwards
  ("injected into out_p") -- the actual (correct, ngspice-matching) stamp
  follows the same current-flows-from-p-to-n convention as a resistor.
  The code was always right; only the prose was corrected.
- A stale "AC refuses" comment on `Bjt` claiming Decision 12 doesn't
  apply here was left contradicting the new Decision 16 section
  immediately following it -- caught and rewritten.

## [0.3.0] - BJT (NPN, Ebers-Moll) support

### Added
- `Bjt` component (`Q<name> collector base emitter [IS=] [BF=] [BR=]`),
  NPN only, using the injection form of the Ebers-Moll equations --
  structurally two coupled diode junctions plus BF/BR current-gain terms,
  reusing the diode's Newton-Raphson machinery generalized to a 2x2
  Jacobian (two controlling voltages, Vbe and Vbc, instead of the diode's
  one). No changes needed to `dc_solver.cpp`/`transient_solver.cpp` --
  `Circuit::has_nonlinear()`'s generic convergence loop already covered a
  component with two internal NR state variables.
- BJT validation: hand-derived nine-entry stamp unit tests, two DC
  operating points each checked against a from-scratch Newton-Raphson
  solve written independently in Python -- one using the same analytic
  Jacobian formulas, the other (a circuit with emitter degeneration) using
  a numerical/finite-difference Jacobian instead, a deliberately different
  method -- plus new ngspice cross-validation rows (see
  `docs/ngspice_comparison.md`).
- `docs/DESIGN_DECISIONS.md` #13: the full Ebers-Moll / 2x2-Jacobian
  derivation and the KCL row-by-row sign derivation for a three-terminal
  device.
- `solve_ac_sweep()` refuses a circuit containing a BJT with the same
  "no DC bias point established" error the diode gets (covered for free
  by the existing `has_nonlinear()` check).

### Fixed
- `tests/unit/test_netlist.cpp`'s "rejects an unrecognized component
  prefix" test used `Q` as its example -- which stopped being unrecognized
  the moment this release added it. Switched to `Z`.

## [0.2.0] - Diode / Newton-Raphson support

### Added
- `Diode` component (`D<name> anode cathode [IS=] [N=]`) using the
  Shockley equation, solved via Newton-Raphson iteration wrapped around
  the existing linear MNA solve -- `dc_solver.cpp` and
  `transient_solver.cpp` now iterate to convergence when a nonlinear
  device is present, and degenerate to exactly the original single solve
  for every linear-only circuit (verified by regression test).
- Voltage-step limiting (a simplified relative of SPICE's "pnjlim") so
  Newton-Raphson converges reliably instead of overflowing on early
  iterations.
- `Circuit::has_nonlinear()`; `solve_ac_sweep()` now refuses clearly on a
  circuit containing a diode rather than silently using an unconverged
  linearization (AC-with-diode needs a DC-bias-point step that isn't
  wired up yet -- see the roadmap).
- Diode validation: hand-derived stamp unit tests, three DC operating
  points checked against an independently-derived closed-form solution
  via the Lambert W function, a pathological-circuit test (diode with no
  current-limiting path) confirming it fails clearly rather than hanging
  or returning garbage, and a new ngspice cross-validation row (see
  `docs/ngspice_comparison.md`).
- `docs/DESIGN_DECISIONS.md` #12: the full Newton-Raphson derivation,
  including a real bug the ngspice cross-check caught and fixed (a
  thermal-voltage constant using a flat 300K instead of SPICE's standard
  300.15K/27C convention).

### Fixed
- Netlist parser's minimum-field-count check no longer requires a value
  field for `D` lines (IS/N are optional).

## [0.1.0] - Initial release

### Added
- Modified Nodal Analysis (MNA) engine with a hand-written, templated
  (`double` / `std::complex<double>`) Gaussian elimination solver with
  partial pivoting.
- Extensible `Component` stamping interface; `R`, `C`, `L`, `V`, `I`
  implemented.
- SPICE-dialect netlist parser (unit suffixes, `IC=`, `DC`/`AC` source
  syntax).
- Three analyses: DC operating point, backward-Euler transient, and AC
  frequency sweep.
- CLI (`minispice dc|tran|ac`) with CSV output for plotting.
- Python plotting (`tools/plot_results.py`): transient-with-analytic-
  overlay, Bode, and convergence plots.
- ngspice cross-validation tooling (`tools/compare_to_spice.py`) --
  see `docs/ngspice_comparison.md`.
- Catch2 test suite: unit tests (matrix, netlist, per-component stamp
  verification), analytic validation tests (voltage divider, Wheatstone
  bridge, RC/RLC all three damping regimes, AC low-pass), a first-order
  convergence test, edge-case/failure tests, and golden-file regression
  tests.
- CI (GitHub Actions): build+test matrix across Linux/Windows/macOS, an
  ASan+UBSan job, and a coverage job uploading to Codecov.
- Documentation: `README.md`, `docs/ARCHITECTURE.md`,
  `docs/DESIGN_DECISIONS.md`, `docs/SUPPORTED_COMPONENTS.md`.

### Known limitations (see README roadmap)
- No PWL (piecewise-linear) source waveform -- PULSE and SIN are supported.
- No MOSFET.
- No schematic rendering.
