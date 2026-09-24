#include "minispice/dc_solver.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>

#include "minispice/matrix.hpp"
#include "minispice/mna_result.hpp"

namespace minispice {

namespace {
// Newton-Raphson bounds for circuits containing nonlinear devices
// (currently: diodes). A purely linear circuit -- every circuit this
// project validates outside of the diode-specific tests -- has no
// component reporting is_nonlinear(), so the loop below stamps, solves
// once, finds max_delta == 0.0 (no nonlinear component contributed to it),
// and returns immediately: numerically and structurally identical to a
// single plain solve, just sharing one code path with the nonlinear case
// instead of maintaining two. See DESIGN_DECISIONS.md, "Newton-Raphson for
// nonlinear devices".
constexpr int kMaxNewtonIterations = 100;
constexpr double kNewtonToleranceVolts = 1e-9;
}  // namespace

std::vector<double> solve_dc(const Circuit& circuit) {
    std::size_t n = circuit.system_size();

    for (auto& c : circuit.components()) c->reset_nr_state();  // no-op for every component except Diode

    std::vector<double> solution;
    for (int iter = 0; iter < kMaxNewtonIterations; ++iter) {
        Matrix<double> A(n, n);
        std::vector<double> b(n, 0.0);
        for (auto& c : circuit.components()) {
            c->stamp_time_domain(A, b, 0.0, 0.0);  // t is irrelevant at DC (no transient waveform is evaluated); dt == 0.0 selects the DC-operating-point stamp
        }

        try {
            solution = solve_linear_system(A, b);
        } catch (const SingularMatrixError& e) {
            std::string msg = describe_singular_row(circuit, e.row());
            if (circuit.has_nonlinear()) {
                // A nonlinear device driven toward an extreme operating
                // point (e.g. a diode with no current-limiting path) can
                // make a companion-model conductance astronomically large
                // partway through iteration, which manifests here as
                // numerical singularity even though the circuit's raw
                // topology is fine -- worth surfacing since
                // describe_singular_row()'s diagnosis (a floating node or a
                // shorted source) would otherwise be actively misleading
                // for this cause.
                msg +=
                    " (this can also happen mid-iteration for a nonlinear device driven to an extreme operating "
                    "point by a lack of current limiting, e.g. a diode wired directly across an ideal source)";
            }
            throw SingularMatrixError(e.row(), msg);
        }

        double max_delta = 0.0;
        for (auto& c : circuit.components()) {
            if (c->is_nonlinear()) max_delta = std::max(max_delta, c->update_nr_guess(solution));
        }
        if (max_delta < kNewtonToleranceVolts) return solution;
    }
    throw std::runtime_error(
        "DC operating point did not converge after " + std::to_string(kMaxNewtonIterations) +
        " Newton-Raphson iterations (check for a nonlinear device with no current-limiting path to the rest of "
        "the circuit, e.g. a diode wired directly across an ideal voltage source)");
}

}  // namespace minispice
