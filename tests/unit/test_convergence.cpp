// Halve dt a few times and check the error halves too, i.e. backward Euler
// really is first order.
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
        // Re-parse every time: caps/inductors keep their state between runs,
        // so reusing the Circuit would continue from the last run (this bit
        // me once, see DESIGN_DECISIONS.md #8).
        auto circuit = Circuit::parse(netlist_text);
        auto points = solve_transient(circuit, dt, eval_time);
        double sim = node_voltage(circuit, points.back().solution, "out");
        double analytic = Vs * (1.0 - std::exp(-eval_time / tau));
        errors.push_back(std::abs(sim - analytic));
    }

    // ratio should be about 2; allow 1.5 to 2.5
    for (std::size_t i = 1; i < errors.size(); ++i) {
        REQUIRE(errors[i - 1] > 1e-9);  // sanity: error shouldn't have vanished already
        double ratio = errors[i - 1] / errors[i];
        INFO("dt=" << dts[i - 1] << " -> " << dts[i] << "  error ratio=" << ratio);
        REQUIRE(ratio > 1.5);
        REQUIRE(ratio < 2.5);
    }
}
