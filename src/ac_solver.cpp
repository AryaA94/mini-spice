#include "minispice/ac_solver.hpp"

#include <cmath>
#include <stdexcept>

#include "minispice/dc_solver.hpp"
#include "minispice/matrix.hpp"
#include "minispice/mna_result.hpp"

namespace minispice {

namespace {
constexpr double kTwoPi = 6.28318530717958647692;
}

std::vector<AcPoint> solve_ac_sweep(const Circuit& circuit, double start_hz, double stop_hz, int points_per_decade) {
    if (!(start_hz > 0.0)) throw std::invalid_argument("solve_ac_sweep: start_hz must be positive");
    if (stop_hz < start_hz) throw std::invalid_argument("solve_ac_sweep: stop_hz must be >= start_hz");
    if (points_per_decade <= 0) throw std::invalid_argument("solve_ac_sweep: points_per_decade must be positive");
    if (circuit.has_nonlinear()) {
        // Standard SPICE .AC behavior for a circuit with a nonlinear
        // device: compute a DC operating point first, then linearize each
        // nonlinear component around that bias point for the whole sweep.
        // solve_dc() already leaves every nonlinear component's guess
        // state (Diode::guess_voltage, Bjt::guess_vbe/guess_vbc) converged
        // when it returns normally -- stamp_ac() was written from the
        // start to read that same state (see component.cpp), so the only
        // piece that was ever missing was this call. If the circuit has no
        // sensible DC operating point (a diode with no current-limiting
        // path, say), solve_dc() throws its own clear error here, which is
        // the right outcome: there's no bias point to linearize around
        // either. See DESIGN_DECISIONS.md #16.
        solve_dc(circuit);
    }

    std::vector<AcPoint> points;
    if (start_hz == stop_hz) {
        // Degenerate single-point "sweep"; still go through the normal path
        // below by giving it one decade's worth of denominator so the loop
        // below emits exactly one point.
    }

    double decades = std::log10(stop_hz / start_hz);
    long total_points = static_cast<long>(std::llround(decades * points_per_decade)) + 1;
    if (total_points < 1) total_points = 1;

    std::size_t n = circuit.system_size();

    for (long i = 0; i < total_points; ++i) {
        double freq = start_hz * std::pow(10.0, static_cast<double>(i) / points_per_decade);
        if (freq > stop_hz) freq = stop_hz;
        double omega = kTwoPi * freq;

        Matrix<std::complex<double>> A(n, n);
        std::vector<std::complex<double>> b(n, std::complex<double>(0.0, 0.0));
        for (auto& c : circuit.components()) {
            c->stamp_ac(A, b, omega);
        }

        std::vector<std::complex<double>> solution;
        try {
            solution = solve_linear_system(A, b);
        } catch (const SingularMatrixError& e) {
            throw SingularMatrixError(e.row(), describe_singular_row(circuit, e.row()));
        }

        points.push_back({freq, std::move(solution)});
        if (freq >= stop_hz) break;
    }

    return points;
}

}  // namespace minispice
