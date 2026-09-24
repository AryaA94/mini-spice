#pragma once
// transient_solver.hpp
//
// Fixed-step backward Euler transient. Sources can be constant or
// PULSE/SIN.

#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

struct TransientPoint {
    double time;
    std::vector<double> solution;  // [node voltages | branch currents], same layout as solve_dc()
};

// Runs from t=0 to stop_time in steps of dt (last step shortened if
// needed). Caps and inductors start at their IC (default 0).
std::vector<TransientPoint> solve_transient(const Circuit& circuit, double dt, double stop_time);

}  // namespace minispice
