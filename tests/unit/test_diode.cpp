// Diode tests. The DC operating points are checked against the exact
// Lambert W solution (derivation below), not just "looks reasonable".
#include <cmath>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "minispice/ac_solver.hpp"
#include "minispice/component.hpp"
#include "minispice/dc_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::WithinRel;
using Catch::Matchers::ContainsSubstring;

TEST_CASE("Diode stamp matches the hand-derived tangent-line companion model at a given guess", "[diode][components]") {
    // Is=1e-14, N=1, guess=0.5V. a = N*Vt = 0.0258649258.
    Diode d("D1", 0, 1, 1e-14, 1.0);
    // set the guess to 0.5V
    d.update_nr_guess(std::vector<double>{0.5, 0.0});  // first step is clamped (see below), so read it back
    double guess = d.guess_voltage_for_test();

    double a = 1.0 * Diode::thermal_voltage();
    double expected_g = (1e-14 / a) * std::exp(guess / a);
    double expected_i0 = 1e-14 * (std::exp(guess / a) - 1.0);
    double expected_i_eq = expected_i0 - expected_g * guess;

    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    d.stamp_time_domain(A, b, 0.0, 0.0);

    REQUIRE_THAT(A(0, 0), WithinRel(expected_g, 1e-12));
    REQUIRE_THAT(A(1, 1), WithinRel(expected_g, 1e-12));
    REQUIRE_THAT(A(0, 1), WithinRel(-expected_g, 1e-12));
    REQUIRE_THAT(b[0], WithinRel(-expected_i_eq, 1e-9));
    REQUIRE_THAT(b[1], WithinRel(expected_i_eq, 1e-9));
}

TEST_CASE("Diode reset_nr_state returns the guess to 0V", "[diode][components]") {
    Diode d("D1", 0, 1, 1e-14, 1.0);
    d.update_nr_guess(std::vector<double>{0.7, 0.0});
    REQUIRE(d.guess_voltage_for_test() != 0.0);
    d.reset_nr_state();
    REQUIRE(d.guess_voltage_for_test() == 0.0);
}

TEST_CASE("Diode update_nr_guess clamps a large step to a bounded number of thermal voltages", "[diode][components]") {
    Diode d("D1", 0, 1, 1e-14, 1.0);  // starts at guess=0
    double a = Diode::thermal_voltage();
    // try to jump straight to 5V, should get clamped
    double delta = d.update_nr_guess(std::vector<double>{5.0, 0.0});
    REQUIRE(d.guess_voltage_for_test() < 5.0);   // did not jump all the way
    REQUIRE(d.guess_voltage_for_test() > 0.0);   // but did move forward
    REQUIRE_THAT(delta, WithinAbs(d.guess_voltage_for_test(), 1e-12));  // delta == actual movement from 0
    REQUIRE(d.guess_voltage_for_test() <= 10.0 * a + 1e-12);  // within the documented 10*Vt*N cap
}

namespace {
// Exact answer for a diode + resistor: Vs = R*Is*(exp(V_D/a)-1) + V_D.
// With x = V_D/a, k = R*Is/a, C = (Vs+R*Is)/a this becomes k*e^x + x = C,
// so x = C - W(k*e^C). Values below computed with scipy.special.lambertw.
constexpr double kVt = 0.0258649258;
}  // namespace

TEST_CASE("Diode+resistor DC operating point matches the closed-form Lambert-W solution", "[diode][analytic]") {
    // V1=5V, R1=1k, Is=1e-14, N=1 -> V_D = 0.6928878327462407
    // (also matches brentq and ngspice)
    auto circuit = Circuit::parse("V1 in 0 DC 5\nR1 in a 1k\nD1 a 0\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "a"), WithinAbs(0.6928878327462407, 1e-6));
}

TEST_CASE("Diode+resistor DC operating point matches Lambert-W for a non-default ideality factor", "[diode][analytic]") {
    // V1=3V, R1=470, Is=1e-12, N=1.8 -> V_D = 1.0314936107084782 (Lambert W).
    auto circuit = Circuit::parse("V1 in 0 DC 3\nR1 in a 470\nD1 a 0 IS=1e-12 N=1.8\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "a"), WithinAbs(1.0314936107084782, 1e-6));
}

TEST_CASE("Diode+resistor DC operating point matches Lambert-W at a small forward bias", "[diode][analytic]") {
    // V1=1V, R1=100, Is=1e-14, N=1 -> V_D = 0.6848111034787303 (Lambert W).
    auto circuit = Circuit::parse("V1 in 0 DC 1\nR1 in a 100\nD1 a 0\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "a"), WithinAbs(0.6848111034787303, 1e-6));
}

TEST_CASE("A diode wired directly across an ideal source with no current limiting fails clearly, not silently", "[diode][edge-cases]") {
    auto circuit = Circuit::parse("V1 a 0 DC 5\nD1 a 0\n");
    REQUIRE_THROWS_AS(solve_dc(circuit), SingularMatrixError);
}

TEST_CASE("The same pathological circuit fails clearly through solve_ac_sweep too, not just solve_dc", "[diode][edge-cases][ac]") {
    // AC runs a DC solve first, so a circuit with no valid bias point should
    // still fail with the DC error.
    auto circuit = Circuit::parse("V1 a 0 DC 5 AC 1 0\nD1 a 0\n");
    REQUIRE_THROWS_AS(solve_ac_sweep(circuit, 100, 1000, 10), SingularMatrixError);
}

TEST_CASE("solve_ac_sweep computes a correct small-signal response for a circuit containing a diode", "[diode][ac]") {
    // Check the AC gain against a finite difference of two DC solves
    // (V1 +- eps). No caps or inductors, so the gain is the same at any
    // frequency. See DESIGN_DECISIONS.md #16.
    auto make_circuit = [](double v) {
        return Circuit::parse("V1 in 0 DC " + std::to_string(v) + "\nR1 in a 1k\nD1 a 0\n");
    };
    double eps = 1e-3;
    auto c_plus = make_circuit(5.0 + eps);
    auto c_minus = make_circuit(5.0 - eps);
    double fd_gain = (node_voltage(c_plus, solve_dc(c_plus), "a") - node_voltage(c_minus, solve_dc(c_minus), "a")) / (2 * eps);

    auto ac_circuit = Circuit::parse("V1 in 0 DC 5 AC 1 0\nR1 in a 1k\nD1 a 0\n");
    auto points = solve_ac_sweep(ac_circuit, 1000, 1000, 1);
    auto v = node_voltage_ac(ac_circuit, points[0].solution, "a");

    REQUIRE_THAT(std::abs(v), WithinRel(std::abs(fd_gain), 1e-6));
}

TEST_CASE("Diode transient settles to the same operating point as the DC solve", "[diode][transient]") {
    auto dc_circuit = Circuit::parse("V1 in 0 DC 5\nR1 in a 1k\nD1 a 0\n");
    auto dc_sol = solve_dc(dc_circuit);
    double dc_va = node_voltage(dc_circuit, dc_sol, "a");

    auto tran_circuit = Circuit::parse("V1 in 0 DC 5\nR1 in a 1k\nD1 a 0\n");
    auto points = solve_transient(tran_circuit, 1e-6, 2e-3);
    double tran_va_final = node_voltage(tran_circuit, points.back().solution, "a");

    REQUIRE_THAT(tran_va_final, WithinAbs(dc_va, 1e-4));
}

TEST_CASE("A linear-only circuit's DC result is unaffected by the Newton-Raphson wrapper", "[diode][regression]") {
    // make sure the Newton loop didn't change anything for linear circuits
    auto circuit = Circuit::parse("V1 in 0 DC 10\nR1 in out 1k\nR2 out 0 1k\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "out"), WithinRel(5.0, 1e-12));
}
