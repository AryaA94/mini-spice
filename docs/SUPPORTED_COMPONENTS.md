# Supported components

| Component | Symbol | DC | Transient | AC | Notes |
|---|---|---|---|---|---|
| Resistor | `R` | ✅ | ✅ | ✅ | |
| Independent voltage source | `V` | ✅ | ✅ (constant or PULSE/SIN) | ✅ | See DESIGN_DECISIONS.md #17 for PULSE/SIN; AC uses the separate `AC` clause regardless |
| Independent current source | `I` | ✅ | ✅ (constant or PULSE/SIN) | ✅ | Same PULSE/SIN support as `V` |
| Capacitor | `C` | ✅ (open circuit) | ✅ (backward-Euler companion) | ✅ | `IC=` sets the t=0 initial voltage |
| Inductor | `L` | ✅ (small-resistance approx.) | ✅ (backward-Euler companion) | ✅ | `IC=` sets the t=0 initial current |
| Diode | `D` | ✅ (Newton-Raphson) | ✅ (Newton-Raphson per step) | ✅ (bias point + linearize) | See DESIGN_DECISIONS.md #12, #16 |
| BJT (NPN or PNP, Ebers-Moll) | `Q` | ✅ (Newton-Raphson) | ✅ (Newton-Raphson per step) | ✅ (bias point + linearize) | See DESIGN_DECISIONS.md #13, #14, #16; `TYPE=PNP` selects PNP |
| VCVS (linear) | `E` | ✅ | ✅ | ✅ | No Newton-Raphson needed -- see DESIGN_DECISIONS.md #15 |
| VCCS (linear) | `G` | ✅ | ✅ | ✅ | No Newton-Raphson needed -- see DESIGN_DECISIONS.md #15 |

## Netlist syntax

One component per line. `*` or `#` (anywhere on the line) starts a comment;
blank lines are ignored. Node `0` (or `gnd`, case-insensitive) is ground.

```
R<name> <node1> <node2> <resistance>
C<name> <node1> <node2> <capacitance> [IC=<initial_volts>]
L<name> <node1> <node2> <inductance>  [IC=<initial_amps>]
V<name> <node1> <node2> [DC] <dc_value> [AC <magnitude> [<phase_deg>]]
I<name> <node1> <node2> [DC] <dc_value> [AC <magnitude> [<phase_deg>]]
V<name> <node1> <node2> [DC <dc_value>] PULSE(V1 V2 TD TR TF PW PER) [AC <magnitude> [<phase_deg>]]
V<name> <node1> <node2> [DC <dc_value>] SIN(VO VA FREQ [TD [THETA]]) [AC <magnitude> [<phase_deg>]]
D<name> <anode> <cathode> [IS=<saturation_current>] [N=<ideality_factor>]
Q<name> <collector> <base> <emitter> [IS=<saturation_current>] [BF=<forward_gain>] [BR=<reverse_gain>] [TYPE=NPN|PNP]
E<name> <out+> <out-> <ctrl+> <ctrl-> <gain>
G<name> <out+> <out-> <ctrl+> <ctrl-> <transconductance>
```

- `D` defaults to `IS=1e-14` (typical small-signal silicon), `N=1`
  (ideal). Both are optional -- `D1 a 0` alone is a valid line.
- `Q` defaults to `IS=1e-16`, `BF=100`, `BR=1`, `TYPE=NPN` -- SPICE's
  standard Level-1 defaults. All four are optional -- `Q1 col base emit`
  alone is a valid NPN line. Node order matters and follows SPICE
  convention: collector, then base, then emitter. `TYPE=PNP` selects a
  PNP transistor (same equations, mirrored -- see DESIGN_DECISIONS.md #14).
- `E` (VCVS) and `G` (VCCS) are linear -- no default parameters to omit,
  `<gain>`/`<transconductance>` is required. Unlike every other
  component here, they take four nodes: an output pair and a separate
  controlling pair. `E` needs one extra MNA unknown (its own branch
  current, like any ideal voltage source); `G` needs none.
- `PULSE`/`SIN` (`V` or `I`) are only evaluated during transient analysis;
  DC operating point always uses `<dc_value>` (defaulting to the
  waveform's own rest value -- `PULSE`'s `V1`, `SIN`'s `VO` -- if no
  explicit `DC` was given), and AC sweeps use the separate `AC` clause,
  not the waveform. `PULSE`'s `PER` defaults to `TR+PW+TF` if omitted or
  0 (repeat immediately). `SIN`'s `TD` and `THETA` are optional, both
  defaulting to 0. See DESIGN_DECISIONS.md #17.

- `<node1>`/`<node2>` are arbitrary names; nodes are created the first time
  they're mentioned.
- `[DC]` is optional -- `V1 in 0 5` and `V1 in 0 DC 5` are equivalent.
- `AC <magnitude> [<phase_deg>]` sets the small-signal excitation used only
  by AC sweeps; phase defaults to 0 degrees. A source with no `AC` clause
  contributes nothing to an AC sweep (matches standard SPICE `.AC`
  behavior: only sources with an explicit AC magnitude excite the circuit).
- Values accept SPICE-style unit suffixes, case-insensitive:
  `T`(1e12) `G`(1e9) `MEG`(1e6) `K`(1e3) `M`(1e-3) `U`(1e-6) `N`(1e-9)
  `P`(1e-12) `F`(1e-15), or plain scientific notation (`1e-6`). Trailing
  unit letters after a recognized suffix are ignored, so `1kOhm` and `1k`
  both parse as 1000. **`M` is milli and `MEG` is mega** -- this is SPICE's
  own convention, not a mini-spice invention; see DESIGN_DECISIONS.md #10.

## Example

```
* RC step response
V1 in 0 DC 5
R1 in out 1k
C1 out 0 1u IC=0
```

```
* Repeated pulse through the same RC filter
V1 in 0 PULSE(0 5 1m 0.1m 0.1m 2m 4m)
R1 in out 1k
C1 out 0 1u
```

See `examples/` for more, and `docs/DESIGN_DECISIONS.md` for why
step-response experiments like the first one don't need a switching
source, while the second genuinely does.
