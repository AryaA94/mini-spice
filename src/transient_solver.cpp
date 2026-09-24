#include "minispice/transient_solver.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>

#include "minispice/matrix.hpp"
#include "minispice/mna_result.hpp"

namespace minispice {

namespace {
constexpr int kMaxNewtonIterations = 100;
constexpr double kNewtonToleranceVolts = 1e-9;

// Solves one step ending at t_target (sources are evaluated at the end of
// the step, since backward Euler is implicit). Newton guesses carry over
// from the previous step, which converges much faster than starting from 0.
std::vector<double> assemble_and_solve_step(const Circuit& circuit, double t_target, double dt) {
    std::size_t n = circuit.system_size();

    for (auto& c : circuit.components()) c->begin_timestep(dt);

    std::vector<double> solution;
    for (int iter = 0; iter < kMaxNewtonIterations; ++iter) {
        Matrix<double> A(n, n);
        std::vector<double> b(n, 0.0);
        for (auto& c : circuit.components()) c->stamp_time_domain(A, b, t_target, dt);

        try {
            solution = solve_linear_system(A, b);
        } catch (const SingularMatrixError& e) {
            std::string msg = describe_singular_row(circuit, e.row());
            if (circuit.has_nonlinear()) {
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
        if (max_delta < kNewtonToleranceVolts) break;
        if (iter == kMaxNewtonIterations - 1) {
            throw std::runtime_error(
                "transient step (t=" + std::to_string(t_target) + ", dt=" + std::to_string(dt) +
                ") did not converge after " + std::to_string(kMaxNewtonIterations) +
                " Newton-Raphson iterations (check for a nonlinear device with no current-limiting path)");
        }
    }

    for (auto& c : circuit.components()) c->commit_timestep(solution);
    return solution;
}

}  // namespace

std::vector<TransientPoint> solve_transient(const Circuit& circuit, double dt, double stop_time) {
    if (!(dt > 0.0)) throw std::invalid_argument("solve_transient: dt must be positive");
    if (!(stop_time > 0.0)) throw std::invalid_argument("solve_transient: stop_time must be positive");

    for (auto& c : circuit.components()) c->reset_nr_state();  // once per run; carries across timesteps after this

    std::vector<TransientPoint> points;
    points.reserve(static_cast<std::size_t>(stop_time / dt) + 2);

    // t = 0: do a normal step with a tiny dt. That makes caps act like
    // voltage sources at their IC and inductors like current sources,
    // without a separate stamping mode (DESIGN_DECISIONS.md #6).
    constexpr double kIcStepFraction = 1e-9;
    points.push_back({0.0, assemble_and_solve_step(circuit, 0.0, dt * kIcStepFraction)});

    double t = 0.0;
    while (t < stop_time - 1e-12) {
        double step = std::min(dt, stop_time - t);
        t += step;
        points.push_back({t, assemble_and_solve_step(circuit, t, step)});
    }
    return points;
}

}  // namespace minispice
