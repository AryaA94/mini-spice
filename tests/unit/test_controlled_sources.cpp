// VCVS / VCCS tests (DC and AC).
#include <cmath>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/ac_solver.hpp"
#include "minispice/component.hpp"
#include "minispice/dc_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::WithinRel;

TEST_CASE("Vcvs stamps the branch-row constraint including the controlling-node coefficients", "[vcvs][components]") {
    // out_p=0, out_n=1, ctrl_p=2, ctrl_n=3, branch=4, gain=3.
    Vcvs e("E1", 0, 1, 2, 3, 3.0);
    e.set_branch_index(4);
    Matrix<double> A(5, 5);
    std::vector<double> b(5, 0.0);
    e.stamp_time_domain(A, b, 0.0, 0.0);

    REQUIRE_THAT(A(4, 0), WithinAbs(1.0, 1e-12));   // branch row: +v(out_p)
    REQUIRE_THAT(A(4, 1), WithinAbs(-1.0, 1e-12));  // branch row: -v(out_n)
    REQUIRE_THAT(A(4, 2), WithinAbs(-3.0, 1e-12));  // branch row: -gain*v(ctrl_p)
    REQUIRE_THAT(A(4, 3), WithinAbs(3.0, 1e-12));   // branch row: +gain*v(ctrl_n)
    REQUIRE_THAT(A(0, 4), WithinAbs(1.0, 1e-12));   // KCL at out_p
    REQUIRE_THAT(A(1, 4), WithinAbs(-1.0, 1e-12));  // KCL at out_n
    REQUIRE_THAT(b[4], WithinAbs(0.0, 1e-12));      // no constant term
}

TEST_CASE("Vccs stamps the four-terminal transconductance pattern", "[vccs][components]") {
    // out_p=0, out_n=1, ctrl_p=2, ctrl_n=3, gm=0.005.
    Vccs g("G1", 0, 1, 2, 3, 0.005);
    Matrix<double> A(4, 4);
    std::vector<double> b(4, 0.0);
    g.stamp_time_domain(A, b, 0.0, 0.0);

    REQUIRE_THAT(A(0, 2), WithinAbs(0.005, 1e-12));
    REQUIRE_THAT(A(0, 3), WithinAbs(-0.005, 1e-12));
    REQUIRE_THAT(A(1, 2), WithinAbs(-0.005, 1e-12));
    REQUIRE_THAT(A(1, 3), WithinAbs(0.005, 1e-12));
    REQUIRE_THAT(A(0, 0), WithinAbs(0.0, 1e-12));  // no self-terms -- current depends only on the *control* pair
    REQUIRE_THAT(A(1, 1), WithinAbs(0.0, 1e-12));
}

TEST_CASE("VCVS DC operating point matches gain*V(ctrl) exactly, confirmed against ngspice", "[vcvs][analytic]") {
    // V(out) = 3 * 2V = 6V regardless of Rload (matches ngspice)
    auto circuit = Circuit::parse("V1 in 0 DC 2\nE1 out 0 in 0 3\nRload out 0 1k\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "out"), WithinRel(6.0, 1e-12));
}

TEST_CASE("VCCS DC operating point matches -gm*Rload*V(ctrl), confirmed against ngspice", "[vccs][analytic]") {
    // KCL at out: V(out)/Rload + gm*V(in) = 0
    // -> V(out) = -0.005 * 2000 * 2 = -20V (matches ngspice)
    auto circuit = Circuit::parse("V1 in 0 DC 2\nG1 out 0 in 0 0.005\nRload out 0 2k\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "out"), WithinRel(-20.0, 1e-9));
}

TEST_CASE("VCVS works correctly in AC analysis (it's linear, unlike the diode/BJT)", "[vcvs][ac]") {
    auto circuit = Circuit::parse("V1 in 0 DC 0 AC 2 0\nE1 out 0 in 0 3\nRload out 0 1k\n");
    auto points = solve_ac_sweep(circuit, 1000, 1000, 1);
    auto v = node_voltage_ac(circuit, points[0].solution, "out");
    double mag_db = 20.0 * std::log10(std::abs(v));
    REQUIRE_THAT(mag_db, WithinAbs(20.0 * std::log10(6.0), 1e-6));  // 2V in * gain 3 = 6V out
}

TEST_CASE("A voltage source and a Vcvs in the same circuit get distinct, non-colliding branch indices", "[vcvs][netlist]") {
    // V and E both need branch currents, make sure they get different indices
    auto circuit = Circuit::parse("V1 in 0 DC 5\nE1 out 0 in 0 2\nR1 out 0 1k\n");
    auto* v1 = dynamic_cast<VoltageSource*>(circuit.find("V1"));
    auto* e1 = dynamic_cast<Vcvs*>(circuit.find("E1"));
    REQUIRE(v1->branch_index != e1->branch_index);
    REQUIRE(circuit.num_extra_unknowns() == 2);
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "out"), WithinRel(10.0, 1e-12));  // 5V * gain 2
}
