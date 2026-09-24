// Runs the same RC circuit at several halved step sizes and checks the
// error at a fixed evaluation time roughly halves each time -- the
// signature of a first-order method (backward Euler). This is the test
// that would catch an integration scheme that "looks right" on a single
// plot but has the wrong convergence order.
#include <cmath>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;

TEST_CASE("Backward-Euler transient integration converges at first order", "[convergence][transient]") {
    const double Vs = 1.0, R = 1000.0, C = 1e-6;
    const double tau = R * C;
    const double eval_time = 2e-3;
    const std::string netlist_text = "V1 in 0 DC 1\nR1 in out 1k\nC1 out 0 1u\n";

    std::vector<double> dts = {4e-5, 2e-5, 1e-5, 5e-6};
    std::vector<double> errors;

    for (double dt : dts) {
        // A fresh Circuit (and therefore fresh, IC-initialized component
        // state) per run: reactive components carry mutable history that
        // solve_transient advances in place -- reusing one Circuit across
        // several solve_transient() calls continues from wherever the
        // previous run left off rather than restarting at t=0 (useful for
        // deliberately extending a simulation, see DESIGN_DECISIONS.md, but
        // wrong here where each dt needs its own independent run).
        auto circuit = Circuit::parse(netlist_text);
        auto points = solve_transient(circuit, dt, eval_time);
        double sim = node_voltage(circuit, points.back().solution, "out");
        double analytic = Vs * (1.0 - std::exp(-eval_time / tau));
        errors.push_back(std::abs(sim - analytic));
    }

    // Each halving of dt should roughly halve the error (ratio near 2.0).
    // We allow a generous band [1.5, 2.5] since this is a numerical, not
    // exact, convergence rate, and floating-point/step-count effects add
    // a little noise near machine precision at the smallest dt.
    for (std::size_t i = 1; i < errors.size(); ++i) {
        REQUIRE(errors[i - 1] > 1e-9);  // sanity: error shouldn't have vanished already
        double ratio = errors[i - 1] / errors[i];
        INFO("dt=" << dts[i - 1] << " -> " << dts[i] << "  error ratio=" << ratio);
        REQUIRE(ratio > 1.5);
        REQUIRE(ratio < 2.5);
    }
}
