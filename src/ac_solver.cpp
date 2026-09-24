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
        // Find the DC bias point first. This leaves each diode/BJT's guess
        // at the operating point, which stamp_ac() linearizes around.
        solve_dc(circuit);
    }

    std::vector<AcPoint> points;
    if (start_hz == stop_hz) {
        // single point, the normal path below handles it
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
