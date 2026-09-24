# HANDOFF — continuing mini-spice in Claude Code

This project was built collaboratively over a long conversation in Claude's
chat interface (a sandboxed environment with per-turn tool-call limits,
which is why this handoff exists — Claude Code doesn't have that
constraint and is a much better fit for the rest of this work). This
document is written so a **fresh Claude Code session with no memory of
that conversation** can pick up exactly where it left off, holding the
same standard of rigor the whole project has been built to.

If you're an instance of Claude reading this in Claude Code: read this
whole file before touching anything, then read `docs/DESIGN_DECISIONS.md`
in full (not skimmed) — it's the single most important file in this repo
for understanding *why* things are built the way they are, and it's
written in the same voice you should keep writing in.

## What this project is

`mini-spice` is a SPICE-style circuit simulator written from scratch in
C++20 (no Eigen, no external linear algebra library — a hand-written
Gaussian elimination solver), built as a portfolio/learning project for a
first-year Electrical Engineering student (Arya) applying to co-ops. It
does DC operating point, transient (backward Euler), and AC (frequency
sweep) analysis. There's also a second deliverable: the same engine
compiled to WebAssembly and wrapped in a browser UI, so anyone can build a
circuit and see results without installing anything.

**The one non-negotiable standard for this whole project**: every piece
of physics/math added must be validated *at least two independent ways*
before it's considered done, and every non-obvious design decision gets
written up in `docs/DESIGN_DECISIONS.md` with the reasoning, not just the
conclusion. "It compiles and gives a plausible-looking number" has never
been good enough here. See the "Validation philosophy" section below for
the specific techniques already established — keep using them, don't
invent a lighter-weight approach because it's faster.

## Current status (as of this handoff)

### Fully done, tested, and working
- Core MNA engine: `Matrix<Scalar>` + Gaussian elimination w/ partial
  pivoting (real and complex, one template), DC/transient/AC solvers.
- Components: `R`, `C`, `L`, `V`, `I` (fully linear), `D` (diode,
  Newton-Raphson, Shockley equation), `Q` (BJT, NPN or PNP, Ebers-Moll,
  Newton-Raphson generalized to a 2x2 Jacobian), `E`/`G` (VCVS/VCCS,
  linear controlled sources).
- All three analyses work for all components, **including AC analysis of
  circuits containing a diode or BJT** (computes a DC bias point first,
  then linearizes -- this used to refuse; it's fixed now).
- **Time-varying sources**: `PULSE(...)` and `SIN(...)` waveforms on `V`/`I`
  sources, standard SPICE syntax. This required changing
  `Component::stamp_time_domain()`'s signature to take an absolute time
  `t`, not just a step size `dt` -- see Decision 17 in
  `docs/DESIGN_DECISIONS.md` for why, and read it before touching that
  interface again.
- 112 test cases, ~156,000 assertions, all passing. Clean under
  AddressSanitizer + UndefinedBehaviorSanitizer. ~92% line coverage
  (`gcov`/`gcovr`).
- Full docs: `README.md`, `docs/ARCHITECTURE.md`,
  `docs/DESIGN_DECISIONS.md` (19 numbered decisions, read this one in
  full), `docs/SUPPORTED_COMPONENTS.md`, `docs/ngspice_comparison.md`.
- `tools/compare_to_spice.py` -- cross-validates against a real installed
  `ngspice` on essentially every feature. Extend this file, don't write a
  parallel one, when adding new cross-validation cases.
- The web tool (`web/dist/mini-spice-web.html`) -- R/C/L/V/I/D/Q(NPN+PNP)/
  E/G, plus PULSE/SIN waveforms on V/I (Decision 18). Tested end to end by
  `web/tests/ui_test.mjs` (jsdom, real WASM; see `web/README.md`).

### Explicitly not done (named honestly in the README, not hidden)
- **PWL** (piecewise-linear) source waveform -- `Waveform::value_at(t)`
  already has the right shape to add this as a third `Kind` (table
  lookup instead of a closed form); not started.
- **MOSFET** -- different physics from the BJT (square-law, not
  Ebers-Moll), not a mirror or generalization of anything here. Would
  need its own from-scratch validation pass, same standard as the BJT.
- **Schematic rendering** -- a different discipline (layout/graphics), not
  started, not blocking anything else.
- **No LU-factorization reuse** -- every timestep/frequency point rebuilds
  and re-solves the whole matrix from scratch. Fine at this scale; would
  matter for much larger circuits. Not started.

## Validation philosophy -- keep using these techniques

This is the part most worth internalizing before writing any new physics.
Techniques already established in this repo, roughly in order of how
often they're used:

1. **Hand-derive the matrix/RHS stamp, test the exact numbers.** Every
   component has a unit test that stamps into a small `Matrix`/`vector`
   by hand and checks the exact entries against a formula worked out on
   paper (see any `TEST_CASE` with "hand-derived" in its name across
   `tests/unit/`). Not "does the circuit solve to a plausible answer" --
   the literal matrix entries.
2. **Cross-validate against ngspice.** `ngspice` is installed and
   available. `tools/compare_to_spice.py` runs the *same* netlist through
   both engines and reports percent error. **Two gotchas that have each
   caused a real, found-and-fixed bug -- don't relearn these the hard
   way:**
   - **`UIC` flag.** ngspice's default transient behavior computes a real
     DC operating point first and uses *that* as the initial condition,
     unless you pass `UIC` on the `.tran` card (and give every reactive
     element/PULSE-or-SIN source an explicit initial/DC value to match).
     This project's convention is IC=0 by default, always, regardless of
     any DC operating point. Forgetting `UIC` on the ngspice side produces
     a *systematic offset* (often exactly the size of some DC value) that
     looks like a bug in this solver but isn't -- see Decisions 11 and 17
     for two separate times this exact thing happened and how it was
     diagnosed (the tell: the discrepancy is suspiciously close to a round
     number, and only appears on the *first* comparison of a new feature).
   - **Thermal voltage / physical constants.** SPICE's default `TNOM` is
     27C = 300.15K, not a flat 300K. Getting this wrong produces a small
     but real discrepancy (~0.35mV on a diode junction) -- see Decision 12.
     If you add anything else temperature-dependent, use `k*300.15/q`,
     not a rounded constant.
3. **A second, genuinely independent numerical method -- not just
   "run it again."** For the diode: an independent Lambert-W closed form.
   For the BJT: two *different* from-scratch Newton-Raphson solves written
   fresh in Python, one with an analytic Jacobian, one with a numerical
   (finite-difference) Jacobian -- deliberately different methods so a
   shared transcription bug can't hide in both. For AC-with-nonlinear-
   devices: finite-difference perturbation of the DC solve, which doesn't
   touch the AC solver's code at all. When you validate something new,
   ask "what's a method that couldn't share a bug with my implementation?"
   and use that, not a second call into the same code path.
4. **Mirror/symmetry checks where the physics gives you one for free.**
   PNP was validated by checking it's the *exact* negation of the
   already-proven NPN case -- cheap, rigorous, and it directly tests the
   sign-flip logic that's the whole risk in that kind of change.
5. **Golden-file regression tests** (`tests/golden/`, `tests/regression/
   test_golden.cpp`) pin known-good output so future changes can't
   silently break something that used to work. Add one for every new
   example circuit.
6. **Sign conventions get written down, not just gotten right by luck.**
   `component.cpp`'s big comment blocks derive the KCL row sign for every
   companion model from the same base convention (`stamp_conductance()`/
   `inject_current()`'s docstring in `component.hpp`). If you add a new
   device, work through the row derivation the same explicit way rather
   than pattern-matching an existing stamp -- a backwards sign is exactly
   the kind of bug that "looks plausible" without this.

A concrete example of the standard, if useful: the VCCS's doc comment
originally described its current as "injected into out_p" -- the *code*
was correct (matched ngspice exactly), but the *English explaining the
code* was backwards. That got caught and fixed, not shrugged off, because
"the numbers matched, ship it" isn't the bar here -- the reasoning has to
be right too, since a future reader (a person, or another Claude) trusts
the comment as much as the code.

## What NOT to do

- Don't add a feature without a validation plan for it *before* writing
  the implementation. Decide the two-or-more independent checks first.
- Don't loosen or remove the AC-refuses-for-unvalidated-nonlinear-devices
  pattern anywhere new. If you add MOSFET, for instance, and AC support
  isn't validated yet, make `solve_ac_sweep()` refuse clearly for it too
  (the `has_nonlinear()` mechanism already generalizes to any new
  component that returns `true` from `is_nonlinear()`) rather than
  silently producing an unvalidated number.
- Don't treat a component as validated on a hand-derived stamp test
  alone, however simple it is. The independent current source had only
  that, and ran backwards for the project's whole history until a
  whole-circuit check compared it with ngspice (Decision 19). Every
  component needs at least one whole circuit checked against an outside
  reference (ngspice, a closed form).
- Don't claim something works in the README/`SUPPORTED_COMPONENTS.md`
  before it's actually tested. This repo's credibility rests entirely on
  every checkmark being true.
- Don't build a second parallel JS reimplementation of the engine for the
  web tool. The whole point of the current architecture is that the
  browser runs the *actual compiled C++*, not a hand-translated copy --
  see `web/README.md`. An earlier version of the web tool *was* a
  hand-ported JS reimplementation, and it was explicitly replaced with
  real WASM specifically because a port can drift from the source of
  truth. Keep it that way.

## Immediate next steps, in priority order

1. **PWL waveform** (piecewise-linear breakpoint table) as a natural
   follow-up to PULSE/SIN, same validation standard.
2. **MOSFET**, if there's appetite for it -- treat this as its own
   from-scratch validation project at the same rigor as the BJT, not a
   quick add. Read Decision 13 first as the template for how to structure
   that work (derive the model, get the Jacobian right, validate with 2+
   independent methods, cross-check ngspice).
3. Anything else in the README's "Limitations and roadmap" section, which
   is kept current and is the authoritative list -- check there for
   what's still open rather than trusting this document's snapshot if
   time has passed.

## Building and testing

```sh
cmake --preset default
cmake --build build/default
ctest --test-dir build/default --output-on-failure
```

Sanitizer build: `cmake --preset sanitize && cmake --build build/sanitize`
then run `build/sanitize/minispice_tests` directly (ASan/UBSan output goes
to stderr on failure).

Coverage: see the `coverage` job in `.github/workflows/ci.yml` for the
exact `gcovr` invocation, or just replicate the pattern -- configure a
`--coverage`-flagged build, run the tests, run `gcovr`.

ngspice cross-validation: `python3 tools/compare_to_spice.py` (needs
`ngspice` installed -- `apt install ngspice` on Debian/Ubuntu).

Web tool: `cd web && ./build_web.sh` (needs `em++` -- see that script's
header comment), then `cd web/tests && npm install && node ui_test.mjs`
to test the result end to end. **On a normal cloud dev environment with full internet
access, the standard `emsdk install latest && emsdk activate latest` flow
should just work** -- the sandbox this was originally built in had network
access restricted to a short allowlist of domains that broke emsdk's own
downloader (it fetches prebuilt toolchains from
`storage.googleapis.com`, which wasn't reachable), forcing a workaround of
downloading Ubuntu's `emscripten` apt package directly and separately
fixing a dependency issue (`node-acorn` needed `npm install -g acorn` and
`NODE_PATH` set, because Ubuntu's `emscripten` package expects Debian's
own older `nodejs`, not the newer NodeSource one that happened to be
installed). If `emsdk`'s normal flow works for you, ignore all of that --
it almost certainly will, since it was strictly a sandbox-specific network
restriction, not a real compatibility problem.

## File layout

```
include/minispice/, src/     the actual engine (this is the source of truth)
cli/main.cpp                  CLI: minispice dc|tran|ac <netlist> [flags]
tests/unit/                   one file per component/concern, hand-derived checks
tests/regression/, tests/golden/   pinned known-good output per example circuit
examples/                     showcase netlists + generated plots for the README
tools/                        plot_results.py, compare_to_spice.py, convergence_data.py
docs/                         ARCHITECTURE.md, DESIGN_DECISIONS.md (read this),
                               SUPPORTED_COMPONENTS.md, ngspice_comparison.md
web/                           the browser tool's source + build script (see web/README.md)
```

## One more thing

The person you're helping is a first-year EE student building this for
her resume/portfolio and to genuinely learn the material -- she can
already explain everything that's been built so far because every
decision was written down as it was made, not after the fact. Keep that
up: when you build something, the comment/doc explaining *why* is not
optional polish, it's the actual deliverable alongside the code.
