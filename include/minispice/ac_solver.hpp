#pragma once
// ac_solver.hpp
//
// Small-signal AC sweep: rebuilds a complex-valued MNA system at each
// frequency (R -> 1/R, C -> j*omega*C, L -> 1/(j*omega*L)) and solves it.
// Sources contribute only their AC magnitude/phase (their DC value is
// irrelevant here, matching standard SPICE .AC behavior).

#include <complex>
#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

struct AcPoint {
    double frequency_hz;
    std::vector<std::complex<double>> solution;  // [node voltages | branch currents]
};

// Logarithmically-spaced sweep from start_hz to stop_hz (inclusive) with
// `points_per_decade` points per decade -- the standard SPICE .AC DEC form.
// Throws std::invalid_argument if start_hz <= 0, stop_hz < start_hz, or
// points_per_decade <= 0.
std::vector<AcPoint> solve_ac_sweep(const Circuit& circuit, double start_hz, double stop_hz, int points_per_decade);

}  // namespace minispice
