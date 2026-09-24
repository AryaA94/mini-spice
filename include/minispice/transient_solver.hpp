#pragma once
// transient_solver.hpp
//
// Fixed-step backward-Euler transient simulation. Sources can be constant
// or carry a PULSE/SIN waveform (see component.hpp's Waveform and
// DESIGN_DECISIONS.md #17); every step is evaluated at its own absolute
// time, not just advanced by dt. Plain constant sources reproduce the
// classic step-response experiments (RC charging, RLC ringing) without
// needing a waveform at all: the "step" comes from the reactive elements
// starting away from their driven steady state.

#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

struct TransientPoint {
    double time;
    std::vector<double> solution;  // [node voltages | branch currents], same layout as solve_dc()
};

// Simulates from t=0 to t=stop_time (inclusive) in steps of `dt` (the last
// step is shortened if stop_time isn't an exact multiple of dt). Every
// reactive component starts from its netlist-declared IC (0 if unspecified).
// Throws std::invalid_argument if dt or stop_time isn't positive, and
// SingularMatrixError (see describe_singular_row()) if a step's system is
// singular.
std::vector<TransientPoint> solve_transient(const Circuit& circuit, double dt, double stop_time);

}  // namespace minispice
