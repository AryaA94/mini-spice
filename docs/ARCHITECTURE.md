# Architecture

## Layout

```
include/minispice/   Public headers -- the library's interface
src/                  Implementation of everything under include/
cli/main.cpp          Thin CLI wrapper: parse args, call the library, print/write results
tests/unit/           Component, matrix, netlist, and analytic-validation tests
tests/regression/     Golden-file tests (pinned reference output)
tests/golden/         The golden fixtures (netlist + committed expected output) those tests read
examples/             Showcase netlists + generated plots for the README
tools/                Python: plotting, convergence data, ngspice cross-validation
```

## Data flow, DC solve (the simplest case)

```
Circuit::parse_file(path)          netlist text -> Circuit (nodes + components)
        |
        v
solve_dc(circuit)                  for each component: component->stamp_time_domain(A, b, dt=0)
        |                          then: solve_linear_system(A, b)
        v
std::vector<double> solution       [node voltages | branch currents], flat
        |
        v
node_voltage(circuit, solution, "out")     named lookup, from mna_result.hpp
```

Transient and AC follow the identical shape -- parse once, then repeatedly
stamp-and-solve (once per timestep, or once per frequency point) -- which is
exactly why `dc_solver.cpp`, `transient_solver.cpp`, and `ac_solver.cpp` are
each under 60 lines: the actual physics lives entirely in each
`Component::stamp_*()` implementation, not in the solvers.

## Module responsibilities

- **`matrix.hpp`** -- dense matrix storage and Gaussian elimination with
  partial pivoting, templated over `double` / `std::complex<double>`. Has no
  idea it's being used for circuits; it's a general small-dense-linear-
  system solver.
- **`component.hpp` / `component.cpp`** -- one class per device type (`R`,
  `C`, `L`, `V`, `I`), each knowing how to add itself to a system matrix.
  This is the extensibility seam: a new device type is a new class here,
  full stop -- see Design Decision 2 in `DESIGN_DECISIONS.md`.
- **`netlist.hpp` / `netlist.cpp`** -- text netlist -> `Circuit` (a node
  table plus a list of resolved `Component`s). Owns the SPICE-dialect
  parsing (unit suffixes, `IC=`, `AC`/`DC` keywords) and the node-name-to-
  index bookkeeping, including the two-pass voltage-source branch-index
  fixup described in `netlist.cpp`'s comments.
- **`mna_result.hpp` / `mna_result.cpp`** -- the one place that knows the
  `[node voltages | branch currents]` unknown-vector layout every solver
  produces. Used by the CLI, the tests, and nothing else needs to know that
  layout exists.
- **`dc_solver.hpp/.cpp`, `transient_solver.hpp/.cpp`, `ac_solver.hpp/.cpp`**
  -- the three analyses. Each is "loop over components, stamp, solve" plus
  the bookkeeping specific to that analysis (transient's per-step history
  advance; AC's frequency sweep).
- **`cli/main.cpp`** -- argument parsing and CSV/stdout formatting only; no
  circuit logic lives here.

## Why solvers don't know about component *types*

`Circuit::components()` is `std::vector<std::unique_ptr<Component>>` --
every solver iterates it and calls only the four virtual methods on
`Component` (`stamp_time_domain`, `stamp_ac`, `begin_timestep`,
`commit_timestep`). None of the three solver files, and none of
`dc_solver.cpp`/`transient_solver.cpp`/`ac_solver.cpp`, contain a
`dynamic_cast` or a switch on component type. The only places that *do*
look at concrete types are call sites that need a type-specific quantity by
name -- `mna_result.cpp`'s `source_current()` needs to know it's looking at
a `VoltageSource` to read its `branch_index`, and the CLI needs the same
thing to print `I(V1)` -- both narrowly scoped, not solver logic.
