# Design decisions

This document exists so every non-obvious choice in the engine has a
written-down reason -- both for future-me and for explaining the project in
an interview. If you're reading the code and asking "why is this like
this?", the answer is probably here.

## 1. Modified Nodal Analysis (MNA), and why it's the right formulation

The engine solves circuits by building one linear system `A*x = b` per
analysis point (one for DC, one per transient timestep, one per AC
frequency) and asking each component to add its own contribution to `A`
and `b`. This is Modified Nodal Analysis: plain nodal analysis (KCL at
every non-ground node, unknowns = node voltages) can't represent an ideal
voltage source, because an ideal voltage source's *current* is not a
function of voltage -- it's whatever the rest of the circuit demands.
MNA's fix is to add one extra unknown and one extra equation per voltage
source: the unknown is the source's own branch current, and the equation
is simply "the voltage constraint" (`v_p - v_n = V`). That's why
`Circuit::system_size()` is `num_nodes() + num_voltage_sources()`, and why
`VoltageSource` is the only component that reports `extra_unknowns() == 1`.

## 2. The stamp() extensibility design, and the sign convention it all rests on

Every component implements `stamp_time_domain()` / `stamp_ac()` and adds
its own numbers into the shared matrix -- it never sees the rest of the
circuit. This is what makes the solvers device-agnostic: `dc_solver.cpp`
is 15 lines because it does nothing but loop over components and call
`solve_linear_system()`.

Everything downstream depends on one fixed sign convention, defined once in
`component.hpp`'s `stamp_conductance()` / `inject_current()` helpers:

- **KCL row convention**: row `i`'s equation is "the sum of currents
  *leaving* node `i` through every component equals the known current
  *injected into* node `i` by sources" -- i.e. `A*x = b` where `b`
  collects injected currents.
- **`inject_current(b, p, n, i)`** adds `i` to node `p` and subtracts it
  from node `n` -- i.e. `i` is defined as flowing from `n` to `p` through
  whatever device is injecting it (entering the circuit at `p`).

This single convention is why `Resistor`, `CurrentSource`, and the
capacitor/inductor companion models can all share the same two helper
functions instead of each re-deriving their own row signs. It's also
exactly SPICE's own convention, confirmed against ngspice directly: for a
5mA voltage divider, `I(V1)` comes out to `-0.005A` in both engines (a
source *delivering* current reads negative, because delivered current
flows out of the source's `+` terminal into the external circuit, i.e. the
opposite of "entering the circuit at `p`" from the source's own
perspective). See `docs/ngspice_comparison.md`.

## 3. Deriving the capacitor's backward-Euler companion model

Backward Euler approximates the derivative with the *current* step's
value: `dv/dt(t) ~= (v(t) - v(t-h)) / h` for step size `h`. For a
capacitor, `i_C(t) = C * dv/dt(t)`, so:

```
i_C(t) ~= (C/h) * v(t) - (C/h) * v_prev
        = g_eq * v(t) - g_eq * v_prev            where g_eq = C/h
```

That's a conductance `g_eq` (contributes exactly like a resistor's stamp)
plus a *constant* term `-g_eq * v_prev`, which has to move to the known
side of the equation. Following the KCL convention above -- row `p`'s
equation is `(current leaving p) = b(p)` -- the "current leaving `p`
through the capacitor" is `g_eq*(v_p - v_n) - g_eq*v_prev`. Moving the
constant term to `b`:

```
g_eq*v_p - g_eq*v_n = b(p)_other_sources + g_eq*v_prev
```

...which is exactly `inject_current(b, p, n, g_eq * v_prev)` on top of the
ordinary conductance stamp. This is checked two ways: a unit test
(`test_components.cpp`) verifies the exact matrix/RHS entries by hand for
a specific `C`, `dt`, and history value, and the RC step response test
(`test_transient_analytic.cpp`) verifies the *emergent* behavior matches
`V*(1-e^{-t/RC})`. Getting the sign wrong here doesn't crash -- it produces
a capacitor that charges the wrong direction or diverges, which is exactly
the kind of bug that "looks plausible" without a hand-checked test.

## 4. Deriving the inductor's backward-Euler companion model

By the same substitution on `v_L(t) = L * di/dt(t)`:

```
i_L(t) ~= i_prev + (h/L) * v(t) = i_prev + g_eq * v(t)      where g_eq = h/L
```

This time the *constant* is added, not subtracted, so following the same
derivation the RHS term comes out as `inject_current(b, p, n, -i_prev)` --
the opposite sign from the capacitor's, which is easy to get backwards if
you don't rederive it (see `Inductor::stamp_time_domain` for exactly this
comment). After solving, `commit_timestep()` advances the state with
`i_new = i_prev + g_eq * v_solved`, using the *same* `g_eq` the stamp used
(`last_dt_` is cached for this reason, since a component doesn't otherwise
know what `dt` was used for the step it's being asked to commit).

## 5. Why the DC operating point treats an inductor as a small resistor instead of an ideal short

A true DC operating point should force an inductor to exactly 0V (an ideal
short), which textbook MNA does by giving it its own zero-valued
voltage-source-style unknown, just like `VoltageSource`. That would mean
`extra_unknowns()` (and therefore the system size) depends on *which
analysis* is being run, not just the netlist -- every solver would need to
build a different-sized system for DC-op vs. transient vs. AC.

Instead, an inductor's DC-op stamp is a large conductance
(`1/1e-6 ohm = 1e6 S`), i.e. "assume it's not quite an ideal short but is
close enough." The tradeoff: a genuine, provable near-zero error (bounded
by the ratio of this resistance to the rest of the circuit's impedances,
here `1e-6 ohm` against typical `k-ohm` circuits, i.e. error on the order
of `1e-9` relatively) in exchange for a uniform system size across every
analysis mode. `test_dc.cpp`'s inductor-DC-op test checks this directly
(the shorted node comes out within `1e-6 V` of exactly 0).

## 6. Computing the t=0 transient sample without a second stamping mode

The textbook-correct way to report the very first transient sample (`t=0`)
is to force every reactive element to its literal initial condition --
treating a capacitor as an ideal voltage source at its IC, and an inductor
as an ideal current source at its IC -- and solve that. Implemented
literally, that's a *third* stamping mode (distinct from both "DC
operating point" and "ordinary transient step"), and capacitors would
suddenly need their own extra unknown just for this one sample.

Instead, `solve_transient()` reuses the *ordinary* backward-Euler companion
stamp for the `t=0` sample, but with a step size `dt * 1e-9` -- nine orders
of magnitude smaller than the real requested step. In that limit:

- A capacitor's `g_eq = C/h` grows huge, and Gaussian elimination pivots on
  it; the *only* way the rest of the (finite) system can balance is if
  `v(t) ~= v_prev` to within about `1e-9` relative error. That's an ideal
  voltage source, for free.
- An inductor's `g_eq = h/L` shrinks to nearly zero, so its stamp
  degenerates to (almost) pure current injection of its history value --
  an ideal current source, for free.

Both are the textbook-correct t=0 behavior, to within a relative error far
smaller than backward Euler's own O(dt) truncation error at the requested
step size -- so it costs nothing in accuracy and nothing in code
complexity. The tradeoff is that this is a numerical trick rather than an
exact algebraic constraint, which is worth knowing if you ever see a
warning about ill-conditioning on a truly pathological circuit (extremely
large or small C/L values might need the `1e-9` fraction tuned).

## 7. Scope (at the time): no time-varying sources (PULSE/SIN/PWL)

*(Superseded by Decision 17 -- PULSE and SIN were added later. This
section is kept for the reasoning behind the original cut, which is still
accurate: the validation circuits below genuinely didn't need it yet.)*

Every independent source was constant for all `t` at this point in the
project -- no SPICE-style `PULSE(...)`/`SIN(...)`/`PWL(...)` waveform
syntax. This was a deliberate scope cut, not an oversight: every
validation circuit in this repo up to here (RC charging, RLC ringing) is a
*step response*, and a step response doesn't need a switching source -- it
comes from the reactive element starting away from its driven steady state
(i.e. from the initial condition, not from the source changing). A DC
source plus a nonzero-IC-vs-steady-state mismatch *is* a step input.
Adding waveform support meant giving `VoltageSource`/`CurrentSource` a
`value_at(t)` instead of a fixed `dc_value` -- which Decision 17 describes
in full, including why it ended up touching every component's interface,
not just these two classes.

## 8. Component state is mutable, and solving is not automatically idempotent

`Capacitor`/`Inductor` carry their own history (`prev_voltage_` /
`prev_current_`) as ordinary mutable member state, advanced by
`commit_timestep()` after every transient step. This means calling
`solve_transient()` twice on the *same* `Circuit` object doesn't restart
from `t=0` -- it continues from wherever the first call left off. That's
useful (extending a simulation: `solve_transient(circuit, dt, 1.0)` then
later `solve_transient(circuit, dt, 2.0)` to keep going), but it's a real
footgun if you expect every call to be an independent, from-scratch run.

This bit a test during development directly:
`tests/unit/test_convergence.cpp` originally reused one `Circuit` across
four different step sizes to check first-order convergence, and got
nonsense (one ratio came out near 0 instead of near 2) because the second
run started from the first run's *ending* voltage instead of the netlist's
IC. The fix was to call `Circuit::parse()` fresh inside the loop -- which
is also what the CLI does implicitly (one process, one parse, one run), so
production usage was never affected, but it's exactly the kind of bug a
convergence test is supposed to catch, just aimed at the test harness
instead of the solver this time. `solve_dc()` and `solve_ac_sweep()` don't
have this issue: neither calls `commit_timestep()`, so they never mutate
component history.

## 9. Gaussian elimination with partial pivoting, hand-written, templated over `double`/`complex<double>`

`matrix.hpp` is header-only and templated on `Scalar` so the exact same
elimination code serves DC/transient (`double`) and AC (`std::complex<double>`)
-- the only Scalar-specific operation is `magnitude()` (used only for
choosing a pivot), specialized via `if constexpr`. Partial pivoting (always
pivot on the largest-magnitude candidate in the current column) matters in
practice here, not just in theory: circuit matrices routinely mix
`1e-12`-scale entries (picofarad-derived admittances) with `1e0`-to-`1e3`
entries (typical conductances) in the same system, and naive elimination
without pivoting can lose most of its precision -- or divide by an
accidental zero -- on exactly that kind of matrix.

A singular pivot column throws `SingularMatrixError` carrying the row
index, which every solver translates into a human message via
`describe_singular_row()` (a floating node's name, or which voltage source
is over-constrained) rather than letting a NaN or a crash propagate
silently. See `tests/unit/test_edge_cases.cpp`.

## 10. The netlist's unit-suffix table, and why "M" is milli but "MEG" is mega

`parse_value()` checks for the three-letter `meg` prefix *before* falling
back to a single-character switch on `t/g/k/m/u/n/p/f`. This ordering is
required, not stylistic: `"m"` and the first letter of `"meg"` are the same
character, and SPICE's own convention (which this project matches) is that
a bare `m` means milli (1e-3) while the full `meg` spells out mega (1e6).
Checking the longer prefix first is what makes `"1m"` and `"1meg"` parse to
different values three orders of magnitude apart instead of colliding.

## 11. Cross-validating against ngspice: two adjustments needed for an apples-to-apples comparison

Getting `tools/compare_to_spice.py` to agree with mini-spice needed two
fixes to how the ngspice deck is built, both worth knowing if you ever redo
this comparison:

- **`UIC` on every `.tran` card.** Without it, ngspice's default behavior
  is to compute a real DC operating point first and use *that* as the
  transient's initial condition (capacitors open, inductors shorted) --
  not "0 unless `IC=` is given". The very first ngspice run during
  development came back with `V(out) = 5V` at `t=0` for an RC circuit that
  should start at 0V, which is what surfaced this difference. `UIC` tells
  ngspice to use the netlist's literal `IC=` values instead, matching this
  project's default (see Design Decision 6).
- **Interpolating onto matching timepoints.** ngspice's transient solver
  uses adaptive step control by default, so its output timepoints don't
  land on mini-spice's fixed grid at all -- comparing "row 47 to row 47"
  would be comparing two different simulated times. The comparison script
  linearly interpolates ngspice's (adaptive-step) trace onto the specific
  checkpoint times being compared, rather than assuming aligned rows.

See `docs/ngspice_comparison.md` for the resulting numbers and why the
nonzero transient error is expected, not a bug.

## 12. Newton-Raphson for nonlinear devices (the diode)

Every device through Decision 11 is linear: its stamp is a fixed
conductance and/or a fixed injected current, independent of the very
voltages being solved for. A diode breaks that -- its current is
`I(V) = Is*(exp(V/a) - 1)` (`a = N*Vt`, the ideality factor times the
thermal voltage), a function of its own terminal voltage. You can't stamp
"the actual exponential" into a *linear* system; MNA only knows how to
solve `A*x = b`.

The standard fix (this is what every SPICE does) is Newton-Raphson: guess
a voltage, replace the diode with the straight *tangent line* to its I-V
curve at that guess (a plain conductance + current source -- something
MNA already knows how to stamp), solve the now-linear system, read the
diode's new voltage off the solution, and repeat with that as the next
guess. Differentiating the diode equation gives the tangent line directly:

```
G_eq = dI/dV |_guess = (Is/a) * exp(guess/a)
I_eq = I(guess) - G_eq*guess
```

...which stamps with the *same* `stamp_conductance()`/`inject_current()`
helpers every other component uses (`inject_current(b, p, n, -I_eq)`; the
sign falls out of the identical row-equation derivation as the capacitor's
companion model in Decision 3 -- work through it the same way and the
minus sign is required, not a typo). `Diode::update_nr_guess()` computes
the new guess from the just-solved node voltages and reports how far it
moved; `dc_solver.cpp`/`transient_solver.cpp` loop -- stamp, solve, update
every nonlinear component's guess, check the largest movement against a
1e-9 V tolerance -- until convergence or 100 iterations, at which point a
clear "did not converge" error beats returning garbage.

**Why linear circuits are untouched.** The loop above runs even for a
circuit with no diode in it: `max_delta` starts at 0 (no nonlinear
component contributes to it), so the loop's convergence check passes after
the *first* iteration and returns -- one stamp, one solve, structurally
identical to a plain single solve. `Circuit::has_nonlinear()` exists only
so `solve_ac_sweep()` can refuse up front (see below); the DC and transient
loops don't need it as a branch, which is what
`test_diode.cpp`'s "linear-only circuit is unaffected" regression test
checks directly.

**Voltage-step limiting.** A raw Newton step can overshoot wildly on early
iterations (a small guess implies a nearly-zero `G_eq`, so the linear solve
can put the diode's node at a voltage far from where it'll actually
settle), and the *next* iteration's `exp(guess/a)` can overflow if that
overshoot is large enough. `update_nr_guess()` caps each step to 10
thermal voltages (`10*a`) -- a simplified relative of SPICE's "pnjlim"
algorithm, not the full thing, but sufficient to converge reliably for
every circuit this project validates. It does **not** rescue a genuinely
pathological circuit (a diode wired directly across an ideal voltage
source with no series resistance to limit current) -- that circuit has no
physically sensible operating point in the first place, and this solver's
honest response is a clear error (`solve_dc()` throws, citing the likely
cause) rather than a plausible-looking wrong number. This was found, not
assumed: the first version of this test threw a *misleading*
"voltage source over-constrained" error for that circuit (a real but
incomplete diagnosis -- see `dc_solver.cpp`'s catch block for why an
astronomically large companion conductance mid-iteration can trip the same
singular-pivot check a genuinely shorted source would), which is why that
catch block now appends a note about nonlinear devices whenever
`circuit.has_nonlinear()` is true.

**Why AC analysis refuses a circuit with a diode.** Real SPICE handles
this by computing a DC operating point first, then linearizing every
nonlinear device around that bias point for the AC sweep (exactly the
`G_eq` above, evaluated at the converged DC guess, used as a fixed
small-signal admittance -- `Diode::stamp_ac()` already does exactly this
arithmetic). What's missing is the wiring: nothing currently calls
`solve_dc()` on the same `Circuit` before an AC sweep to establish that
bias, so `solve_ac_sweep()` would use whatever `guess_voltage` happens to
be sitting on the component (0V, straight after construction) rather than
a real operating point. `solve_ac_sweep()` checks `circuit.has_nonlinear()`
and throws immediately rather than silently returning a number that looks
like an AC response but isn't the one at any bias point anyone asked for.

**Validating the answer independently.** A diode+resistor DC point has a
genuine closed form via the Lambert W function: substituting `x = V_D/a`
into `Vs = R*Is*(exp(V_D/a)-1) + V_D` reduces it to `k*e^x + x = C` (`k =
R*Is/a`, `C = (Vs+R*Is)/a`), whose solution is `x = C - W(k*e^C)` by the
defining property of `W`. `test_diode.cpp` hardcodes this closed-form
answer (computed once with `scipy.special.lambertw`, independent of this
solver's own Newton-Raphson code) for three different parameter sets and
checks the solver against it to 1e-6 V. The default thermal-voltage
constant is `k*T/q` at `T=300.15K` (27C) -- SPICE's universal default
`TNOM`, not a rounded 300K -- specifically because using the rounded value
first produced a ~0.35mV mismatch against ngspice on the same circuit; the
Lambert-W check confirmed the *solver* was already correct at either
temperature convention (matching each to machine precision once fed the
same `Vt`), which is what pinned the discrepancy down to a physical-
constant choice rather than a bug. See `docs/ngspice_comparison.md` for the
resulting agreement (both solver-vs-Lambert-W and solver-vs-ngspice, at
this corrected `Vt`).

**Deliberately not done here: transistors.** A BJT is -- structurally --
two coupled diode junctions (Ebers-Moll) plus current-gain terms between
them; the Newton-Raphson machinery above is the actual prerequisite for
building one, not a detour from it. It was scoped out of this pass
specifically so the diode could be validated properly (three independent
cross-checks, not one) rather than splitting that effort across two
nonlinear devices at once and under-validating both.

## 13. The BJT (Ebers-Moll): the same Newton-Raphson machinery, generalized to two controlling voltages

The diode's Newton-Raphson loop (Decision 12) turned out to be exactly the
right foundation: a BJT is modeled here with the *injection form* of the
Ebers-Moll equations -- the DC/resistive-only model every SPICE reduces to
once you strip out the Early effect, terminal ohmic resistances, and
junction capacitance:

```
I_C = Is*(exp(Vbe/Vt) - exp(Vbc/Vt)) - (Is/BR)*(exp(Vbc/Vt) - 1)
I_B = (Is/BF)*(exp(Vbe/Vt) - 1)      + (Is/BR)*(exp(Vbc/Vt) - 1)
I_E = I_B + I_C
```

Structurally this is two diode junctions (base-emitter, base-collector)
sharing the same `Is`, coupled by the `BF`/`BR` gain terms -- which is why
`Bjt` reuses the exact same `is_nonlinear()` / `reset_nr_state()` /
`update_nr_guess()` machinery the `Diode` already required, no changes to
`dc_solver.cpp` or `transient_solver.cpp` needed at all.

**The real difference from the diode: two controlling voltages, not one.**
A diode's current is a function of its own single terminal voltage, so
linearizing it needs one derivative (`dI/dV`) and produces a plain
conductance. A BJT's `I_C` and `I_B` are each functions of *two* voltages
(`Vbe` **and** `Vbc`), so linearizing needs the full 2x2 Jacobian -- four
partial derivatives, not one:

```
gpi = dI_B/dVbe = (Is/BF)/Vt * exp(Vbe/Vt)
gmr = dI_B/dVbc = (Is/BR)/Vt * exp(Vbc/Vt)
gmf = dI_C/dVbe = Is/Vt      * exp(Vbe/Vt)
go  = dI_C/dVbc = -(Is*(1+1/BR))/Vt * exp(Vbc/Vt)
```

Substituting `Vbe = v_B - v_E` and `Vbc = v_B - v_C` into the linearized
`I_B`/`I_C` and collecting terms by node turns those four numbers into
nine matrix entries (three terminals, so a 3x3 block) rather than the
diode's four. Working through KCL row by row, exactly the way Decision 3
did for the capacitor:

- **Row B** ("current leaving base through the device" = `I_B`, before
  linearization): `(gpi+gmr)*v_B - gmr*v_C - gpi*v_E = b(B) - I_B_eq`
- **Row C** (same logic, `I_C`): `(gmf+go)*v_B - go*v_C - gmf*v_E = b(C) - I_C_eq`
- **Row E** (current leaving the *emitter* through the device is the
  negative of what entered at B and C combined, since KCL for the whole
  device must balance): `-(gpi+gmr+gmf+go)*v_B + (gmr+go)*v_C + (gpi+gmf)*v_E = b(E) + (I_B_eq+I_C_eq)`

where `I_B_eq = I_B(guess) - gpi*Vbe_guess - gmr*Vbc_guess` and
`I_C_eq = I_C(guess) - gmf*Vbe_guess - go*Vbc_guess` (the same
tangent-plane-intercept construction as the diode's `I_eq`, just in two
variables). `Bjt::update_nr_guess()` tracks `guess_vbe` and `guess_vbc`
as two independent state variables, applies the same 10-thermal-voltage
step cap to each independently, and reports whichever moved further as
the convergence metric -- which is all `dc_solver.cpp`'s generic
`max(every nonlinear component's movement)` loop needs to keep working
unmodified for a component with two internal unknowns instead of one.

**Validating a genuinely 3-terminal, 2-controlling-voltage device.** The
diode's Lambert-W closed form doesn't generalize to two coupled
transcendental equations, so the BJT gets a different, arguably stronger
kind of independent check: two *separate* from-scratch Newton-Raphson
solves written fresh in Python (not calling into this solver's code), one
per test circuit, using two different methods on purpose:

1. A fixed-bias circuit (`VBB`->`RB`->base, `VCC`->`RC`->collector,
   emitter grounded), checked against a Python NR solve using the *same*
   analytic Jacobian formulas above, transcribed independently.
2. A circuit with emitter degeneration (an `RE` resistor from emitter to
   ground, standard practice for bias stability -- also a good test that
   the model still converges correctly under negative feedback), checked
   against a Python NR solve using a **numerical** (finite-difference)
   Jacobian instead -- a genuinely black-box method that never touches the
   analytic derivative formulas, so an error in transcribing them (in
   either the C++ or the first Python check) has nowhere to hide.

Both Python solves converge to KCL residuals of `1e-18`-`1e-20`
(effectively machine-exact) and agree with this solver to the full 10
significant figures reported -- tighter agreement than either gets with
ngspice (~5 significant figures, the same normal cross-implementation
tolerance already seen on the diode row), which is expected: the Python
checks and this solver are converging the *identical* equations, while
ngspice's BJT implementation is an independent piece of software solving
them its own way. See `docs/ngspice_comparison.md` for the full numbers.

**Also refuses AC, for the same reason the diode does.** `Bjt::is_nonlinear()`
returns `true`, so `Circuit::has_nonlinear()` already covers it -- no new
code was needed in `ac_solver.cpp` for `solve_ac_sweep()` to refuse a
circuit containing a BJT with the same "no DC bias point established
yet" message the diode gets. (Decision 16 below removes this refusal for
both devices.)

**What this Level-1 model still doesn't cover.** This was NPN-only until
Decision 14 added PNP as a mirror. Still not modeled, for either polarity:
the Early effect (finite output resistance in forward-active),
base/collector/emitter ohmic resistances, and junction capacitances (so,
as with the diode, no frequency-dependent behavior beyond the fixed
small-signal `go` this DC model already produces) -- all standard SPICE
Level-1 omissions, not oversights specific to this implementation.

## 14. PNP: an NPN mirror, not new physics

A PNP transistor's Ebers-Moll equations are the NPN equations with every
voltage and current negated -- physically, current flows the opposite way
(into the emitter, out of base and collector) and the device forward-
conducts when the emitter is *above* the base instead of below it, but the
underlying exponential relationship is identical. `Bjt` implements this as
a single `is_pnp` flag and a sign `s` (`+1` for NPN, `-1` for PNP) applied
to the exponent arguments: `f1 = exp(s*Vbe/Vt)`, `f2 = exp(s*Vbc/Vt)`, and
the resulting `i_c0`/`i_b0` currents get an extra factor of `s`.

The Jacobian terms (`gpi`, `gmr`, `gmf`, `go`) do **not** need that extra
`s` -- this is worth writing out because it's easy to get wrong by
symmetry-pattern-matching instead of actually differentiating. By the
chain rule, `d(i_c0_actual)/d(Vbe) = s * d(i_c0_npn_formula)/d(eff_Vbe) *
d(eff_Vbe)/d(Vbe) = s * gmf_formula * s = gmf_formula` (since `s*s = 1`
whether `s` is `+1` or `-1`). Two sign flips -- one from differentiating
the mirrored current, one from the chain rule on the mirrored voltage --
cancel exactly. Only the current terms (`i_c0`, `i_b0`, and consequently
`i_c_eq`/`i_b_eq`) carry the extra `s`; the matrix stamp structure and the
conductance values themselves are unchanged from Decision 13.

**Validation.** Rather than deriving a second independent closed form,
this was checked against the already-validated NPN case directly: take
the exact NPN fixed-bias circuit, negate every supply voltage, add
`TYPE=PNP`, and confirm the result is the *exact* negation of the NPN
answer (`-0.8112793033V` / `-5.8112793033V` against the NPN's
`0.8112793033V` / `5.8112793033V`) -- which it is, to the full precision
reported. Cross-checked separately against ngspice's own PNP model
(`.model ... PNP(...)`) for a second, genuinely independent confirmation.

## 15. VCVS and VCCS: linear controlled sources, no Newton-Raphson

Unlike every nonlinear device above, a voltage-controlled voltage source
(`E`, SPICE's naming) and voltage-controlled current source (`G`) are
**linear** in the circuit's unknowns -- the controlling voltage is just
another node voltage the MNA system already solves for, not something
requiring iteration. That makes them structurally closer to the very
first components in this codebase than to the diode/BJT:

- **Vcvs** (`v(out+) - v(out-) = gain*(v(ctrl+) - v(ctrl-))`) reuses
  `VoltageSource`'s exact branch-row pattern (Decision 2), with the
  constant RHS (`dc_value`) replaced by two more matrix entries on the
  controlling nodes instead -- since those are unknowns, not knowns, they
  belong in `A`, not `b`. It needs one extra unknown (its own branch
  current), exactly like an independent voltage source.
- **Vccs** (`gm*(v(ctrl+)-v(ctrl-))` flows from `out+` to `out-` through
  the device) needs no extra unknown at all: the current is already
  linear in existing node voltages, so it stamps as a "cross-coupled
  resistor" -- four matrix entries between two *different* terminal
  pairs, the output pair and the control pair, rather than a resistor's
  usual four entries on one shared pair.

**A real mistake caught during development, worth recording.** The first
version of `Vccs`'s doc comment described the current as "injected into
out_p" -- but the actual stamp (validated correct against ngspice) follows
the *same* row-sign convention as a resistor: current is defined flowing
*from* `out_p` *to* `out_n` through the device, not injected into it. The
code was right the whole time; the English description of what the code
does was backwards. This is exactly the kind of error the "matches
ngspice" check catches even when it doesn't catch a wrong formula: the
numbers agreed, which is what prompted a closer look at whether the
prose describing them was actually accurate.

**Because they're linear, they need no scope carve-out for AC.** Both
work correctly in `solve_ac_sweep()` with no special handling at all --
confirmed directly (`test_controlled_sources.cpp`'s AC test), unlike the
diode/BJT which needed Decision 16 below before AC worked for them.

**Generalizing the branch-index bookkeeping.** Before `Vcvs`, only
`VoltageSource` ever needed the "extra unknown" mechanism, so the
netlist parser's second pass (converting each such component's relative
ordinal into an absolute row/column index once the final node count is
known -- see Decision on node-discovery ordering, further up) was
hardcoded to `dynamic_cast<VoltageSource*>`. Adding `Vcvs` meant either
duplicating that whole pass for a second type or generalizing it; the
`Component` base class already exposed `extra_unknowns()` for exactly
this purpose, so a `get_branch_index()` virtual (paired with the existing
`set_branch_index()`) let the pass become generic over *any* component
reporting `extra_unknowns() > 0`, with a single shared counter so a
voltage source and a VCVS in the same circuit never collide. Verified
directly: `test_controlled_sources.cpp` checks a `V` and an `E` in one
circuit get distinct branch indices and the circuit solves correctly.

## 16. Finishing AC analysis for nonlinear devices

Decisions 12 and 13 built `Diode::stamp_ac()` and `Bjt::stamp_ac()` to
read each component's already-converged `guess_voltage` /
`guess_vbe`/`guess_vbc` and produce a small-signal admittance from it --
but `solve_ac_sweep()` never actually called `solve_dc()` first to make
that guess state *be* a real converged bias point, so it refused outright
rather than risk using whatever was left over from construction (0V).
That's now wired up: `solve_ac_sweep()` calls `solve_dc(circuit)` before
the frequency loop whenever `circuit.has_nonlinear()` is true, exactly
matching how every SPICE computes `.AC` for a circuit containing
nonlinear devices (bias point first, linearize, then sweep). If there's
no sensible DC operating point, `solve_dc()` throws its own clear error
right there -- which is correct, since there's no bias point to linearize
around either.

**Validation, deliberately independent of the AC solver itself.** Rather
than re-checking the AC math against itself, both the diode and BJT AC
tests use a completely different technique: perturb the DC source
voltage by a tiny `+-eps`, solve twice, and take the finite-difference
slope -- an independent measure of small-signal gain that never touches
`stamp_ac()` or `solve_ac_sweep()` at all. Both circuits have no reactive
elements, so the true response is frequency-independent, and the
finite-difference slope should equal the AC solver's magnitude at any
frequency. It does, to 9+ significant figures for both the diode and BJT
cases -- tighter agreement than a numerical method has any right to need
to prove correctness, which is exactly the point: two very different ways
of asking "what's the small-signal gain here" landing on the same answer
is strong evidence neither one is wrong.

## 17. Time-varying sources (PULSE/SIN): why this needed an interface change

Every component's `stamp_time_domain()` originally took only a step size
`dt`, never an absolute simulation time -- fine for every component built
so far, because none of them needed to know *when* it was, only *how much
time just passed* (a capacitor's companion model, a diode's Newton-Raphson
guess, an inductor's history). A time-varying source breaks that
assumption by definition: `PULSE(...)`/`SIN(...)` need to evaluate "what's
this source's value right now", which requires the actual point in time,
not just the size of the most recent step.

The fix touches every component, mechanically: `stamp_time_domain()`
gained a `double t` parameter (absolute time) ahead of the existing `dt`.
Every non-source component (`Resistor`, `Capacitor`, `Inductor`, `Diode`,
`Bjt`, `Vcvs`, `Vccs`) simply ignores it (`double /*t*/`) -- their behavior
never depended on absolute time and still doesn't. Only `VoltageSource`
and `CurrentSource` use it, and only when a `Waveform` is attached and
`dt > 0` (a transient step, not the DC operating point, which always uses
`dc_value` regardless of any waveform -- matching standard SPICE `.op`
behavior for a source with a `PULSE`/`SIN` clause). `transient_solver.cpp`
already tracked the running absolute time `t` in its stepping loop (needed
for the returned `TransientPoint::time`); the only change there was
passing that same value into `assemble_and_solve_step()` instead of
computing it and throwing it away.

**Which time gets used matters, and it's not arbitrary.** Backward Euler
is an *implicit* method -- each step solves for the state at the step's
*end*, using values evaluated at that same end time, not the start. So a
step landing at absolute time `t` evaluates the waveform at `t` (the new
time), not `t - dt` (the old one). This is the same implicit-evaluation
convention the capacitor and inductor companion models already use
(Decisions 3 and elsewhere); a time-varying source just makes it visible,
since a source's stamp before this had nothing to evaluate at any
particular time.

**PULSE and SIN, and why V1/VO become the default DC value.** Both
waveforms follow the standard SPICE forms: `PULSE(V1 V2 TD TR TF PW PER)`
is piecewise-linear (rest at `V1`, ramp to `V2` over `TR`, hold `PW`, ramp
back over `TF`, repeat every `PER`, defaulting `PER` to `TR+PW+TF` if
omitted or zero -- "repeat immediately" is SPICE's own default); `SIN(VO
VA FREQ TD THETA)` is `VO + VA*exp(-(t-TD)*THETA)*sin(2*pi*FREQ*(t-TD))`
for `t >= TD` and flat at `VO` before it, with `THETA=0` giving an
undamped sine. If a netlist gives a waveform but no explicit `DC` value,
the DC operating point uses the waveform's `rest_value()` -- `PULSE`'s
`V1`, `SIN`'s `VO` -- since that's the source's value "before anything
happens," matching what real SPICE does for the same case.

**Validation.** `Waveform::value_at()` is checked directly against
hand-computed points on both waveform shapes (including edge cases: zero
rise/fall time collapsing `PULSE` to an instantaneous step, `SIN`'s `TD`
delay, nonzero `THETA` damping). Beyond the shape itself, two things
needed checking that a unit test on `Waveform` alone can't: that the
*solver* evaluates the waveform at the right absolute time each step (a
pure-resistive circuit with a `SIN` source and no reactive elements makes
`V(node)` track the source exactly, with no filtering to obscure a timing
bug -- checked to `1e-9` across the whole run), and that the whole thing
still matches an independent implementation. Both `PULSE` and `SIN`
transient runs were cross-checked against ngspice (with `UIC` on both
sides -- the same lesson from Decision 11 about ngspice's default
operating-point-first behavior, re-learned here: the first `SIN` check
came back with a suspicious, exactly-1.0V-constant discrepancy, which
traced to ngspice computing its own real DC bias point as the transient's
starting condition while this solver used its usual IC=0 default; adding
`UIC` to the ngspice deck made both start from the same place, after
which the discrepancy dropped to the same ~1% adaptive-vs-fixed-step
tolerance already documented for every other transient comparison in
`docs/ngspice_comparison.md`).


## 18. PULSE/SIN in the web tool: the form writes explicit netlist text, never its own defaults

The web tool's job is to turn form fields into the same `.cir` text the
CLI reads (`rowsToNetlist()` in `web/ui_logic.js`) and hand that to the
real compiled engine. So adding PULSE/SIN to the browser was purely a
question of *what text the form writes*. The only way to get it wrong is
for the form to mean something different from what the engine does with
that text. Every choice below comes from that.

**Blank timing fields are written as explicit `0`s, not left out.** Real
SPICE lets you leave off PULSE's trailing values and fills them in from
the `.tran` card: TR/TF default to the time step, PW/PER to the stop
time. This engine's parser deliberately requires all 7 PULSE values, so a
source never means something that depends on the analysis settings. The
form keeps that property: V1/V2 (PULSE) and VO/VA/FREQ (SIN) must be
typed in, and anything else left blank goes into the netlist as a
literal `0`, which the engine defines exactly. A 0 TR/TF is an instant
edge (tested in `test_waveforms.cpp`), `PER 0` means "repeat right after
the fall" (`TR+PW+TF`), and SIN's `TD 0`/`THETA 0` mean no delay and no
damping. The form's hint text spells this out, because someone who knows
real SPICE could otherwise expect the `.tran`-based defaults.

**The DC value becomes optional, and when it's blank the `DC` clause is
left out rather than filled in.** Leaving it out lets the engine apply
its own `rest_value()` rule (PULSE's V1, SIN's VO; Decision 17). The form
doesn't copy V1 into a `DC` clause itself, because that would be a second
implementation of the same rule, and the two could drift apart. The
component table shows the value the DC operating point will actually
use: the explicit DC value if there is one, otherwise the rest value.

**One check the engine doesn't make: a zero-width PULSE.** `TR = PW = TF
= 0` is legal to the parser (`Waveform::value_at()` returns V1 forever),
but from the form it almost always means PW was forgotten. The source
would silently do nothing, which is exactly the kind of plausible-looking
wrong result this project refuses elsewhere. So the form rejects it with
a message saying what to set. Every other check (negative TR/TF/PW/PER,
non-positive FREQ) mirrors a rejection the parser already makes. It's
done at add time so the error sits next to the field, not after Run.

**Validation.** The same three-way standard as the engine, via
`web/tests/ui_test.mjs` running the built page (real WASM) in jsdom:

1. The netlist each new preset generates is asserted *literally* against
   `examples/12_pulse_rc_filter`/`13_sine_source`'s circuits, and so is a
   PULSE source built field by field through the form. Those example
   netlists are the ones cross-checked against ngspice and pinned by
   golden tests, so matching them text-for-text inherits that validation.
2. The WASM output is compared against the native CLI run on a
   *hand-written* netlist: a different compiler, and a netlist that
   didn't come from the UI.
3. For a PULSE source (with explicit DC and AC clauses too) and a SIN
   current source (with TD and THETA) on purely resistive circuits, every
   transient step is compared against the PULSE/SIN definitions evaluated
   in the test itself. Resistive-only means there's no integration error
   in the way, so a swapped parameter can't hide in the tolerance. That
   test-side evaluation is a test oracle, not a JS port of the engine:
   nothing on the page uses it.

To check that the test can actually fail, 8 deliberate breakages of the
UI were each run against it: reversed parameter order, TR/TF swapped, SIN
TD/THETA swapped, AC clause written before the waveform, the old
always-`DC` line, the zero-width check removed, the preset's analysis
settings ignored, and the form not resetting. Every one was caught. The
first version of the test actually *missed* the form-reset one: it checked
the reset after two more form submissions, and those set every field
themselves, so it was observing its own harness. That check now runs
immediately after the waveform row is added.
