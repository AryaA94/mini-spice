#pragma once
// dc_solver.hpp
//
// Single-solve DC operating point: capacitors are open circuits, inductors
// are approximated as a small resistance (see component.cpp / component's
// DC-op stamp, and DESIGN_DECISIONS.md).

#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

// Returns the full unknown vector [node voltages | branch currents]. Read
// specific values out of it with node_voltage()/source_current() from
// mna_result.hpp. Throws SingularMatrixError (with a human message; see
// describe_singular_row()) for a floating node or an over-constrained
// voltage source.
std::vector<double> solve_dc(const Circuit& circuit);

}  // namespace minispice
