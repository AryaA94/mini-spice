#pragma once
// ac_solver.hpp
//
// AC sweep: builds a complex MNA system at each frequency and solves it.
// Only the sources' AC magnitude/phase matter here, like SPICE .AC.

#include <complex>
#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

struct AcPoint {
    double frequency_hz;
    std::vector<std::complex<double>> solution;  // [node voltages | branch currents]
};

// Log sweep from start_hz to stop_hz, points_per_decade points per decade
// (like .AC DEC). Throws std::invalid_argument on bad arguments.
std::vector<AcPoint> solve_ac_sweep(const Circuit& circuit, double start_hz, double stop_hz, int points_per_decade);

}  // namespace minispice
