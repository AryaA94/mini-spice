#pragma once
// dc_solver.hpp
//
// DC operating point. Caps are open, inductors are a tiny resistance.
// Diodes/BJTs are solved with Newton-Raphson.

#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

// Returns [node voltages | branch currents]; use node_voltage() /
// source_current() to read it. Throws SingularMatrixError for a floating
// node or conflicting voltage sources.
std::vector<double> solve_dc(const Circuit& circuit);

}  // namespace minispice
