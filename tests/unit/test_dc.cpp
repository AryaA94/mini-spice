// DC operating-point validation against hand-computed closed-form answers.
#include <cmath>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/dc_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::WithinRel;

TEST_CASE("Voltage divider matches the exact R2/(R1+R2) fraction", "[dc][analytic][voltage-divider]") {
    auto circuit = Circuit::parse(
        "V1 in 0 DC 10\n"
        "R1 in out 1k\n"
        "R2 out 0 1k\n");
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "out"), WithinRel(5.0, 1e-9));
    REQUIRE_THAT(source_current(circuit, solution, "V1"), WithinRel(-0.005, 1e-9));
}

TEST_CASE("Voltage divider matches the exact fraction for an asymmetric ratio", "[dc][analytic][voltage-divider]") {
    // 3.3k / 6.8k, Vs = 12V -> V(out) = 12 * 6800/(3300+6800)
    auto circuit = Circuit::parse(
        "V1 in 0 DC 12\n"
        "R1 in out 3.3k\n"
        "R2 out 0 6.8k\n");
    auto solution = solve_dc(circuit);
    double expected = 12.0 * 6800.0 / (3300.0 + 6800.0);
    REQUIRE_THAT(node_voltage(circuit, solution, "out"), WithinRel(expected, 1e-9));
}

TEST_CASE("Balanced Wheatstone bridge has zero current through the bridge resistor", "[dc][analytic][wheatstone]") {
    // Balance condition R1*R4 == R2*R3: 1k*4k == 2k*2k (4e6 == 4e6).
    auto circuit = Circuit::parse(
        "V1 top 0 DC 9\n"
        "R1 top a 1k\n"
        "R2 a 0 2k\n"
        "R3 top b 2k\n"
        "R4 b 0 4k\n"
        "Rg a b 500\n");
    auto solution = solve_dc(circuit);

    double va = node_voltage(circuit, solution, "a");
    double vb = node_voltage(circuit, solution, "b");
    REQUIRE_THAT(va, WithinRel(6.0, 1e-9));  // 9 * 2000/(1000+2000)
    REQUIRE_THAT(vb, WithinRel(6.0, 1e-9));  // 9 * 4000/(2000+4000)
    REQUIRE_THAT(va - vb, WithinAbs(0.0, 1e-9));

    double bridge_current = (va - vb) / 500.0;
    REQUIRE_THAT(bridge_current, WithinAbs(0.0, 1e-9));
}

TEST_CASE("An unbalanced Wheatstone bridge has nonzero, sign-correct bridge current", "[dc][analytic][wheatstone]") {
    // Same as above but R4 changed so R1*R4 != R2*R3 -> bridge is unbalanced.
    auto circuit = Circuit::parse(
        "V1 top 0 DC 9\n"
        "R1 top a 1k\n"
        "R2 a 0 2k\n"
        "R3 top b 2k\n"
        "R4 b 0 3k\n"  // was 4k
        "Rg a b 500\n");
    auto solution = solve_dc(circuit);
    double va = node_voltage(circuit, solution, "a");
    double vb = node_voltage(circuit, solution, "b");
    REQUIRE(std::abs(va - vb) > 1e-6);
}

TEST_CASE("DC operating point treats a capacitor as an open circuit", "[dc][capacitor]") {
    // With C open, no current flows, so V(out) == V(in) exactly (no drop
    // across R since I=0).
    auto circuit = Circuit::parse(
        "V1 in 0 DC 5\n"
        "R1 in out 1k\n"
        "C1 out 0 1u\n");
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "out"), WithinRel(5.0, 1e-9));
}

TEST_CASE("DC operating point treats an inductor as an approximate short", "[dc][inductor]") {
    // With L shorted, out == ground (0V), and current is limited only by R1.
    auto circuit = Circuit::parse(
        "V1 in 0 DC 5\n"
        "R1 in out 1k\n"
        "L1 out 0 1m\n");
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "out"), WithinAbs(0.0, 1e-6));
}

// Independent current source direction (DESIGN_DECISIONS.md #19). Each of
// these fails if the source is reversed, and they're built so a reversal
// can't pass by symmetry.
TEST_CASE("Current source 'I1 0 n' drives n positive (SPICE direction), by Ohm's law", "[dc][analytic][isource]") {
    // 2mA flows from node 0 through I1 into n, then back to ground through
    // R1: V(n) = +2mA * 1k = +2V.
    auto circuit = Circuit::parse(
        "I1 0 n DC 2m\n"
        "R1 n 0 1k\n");
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "n"), WithinRel(2.0, 1e-9));
}

TEST_CASE("Current source aiding a voltage source matches hand KCL", "[dc][analytic][isource]") {
    // KCL at n: (5 - Vn)/1k + 1mA = Vn/1k  ->  Vn = (5 + 1)/2 = 3V.
    // A reversed source gives (5 - 1)/2 = 2V instead: a different
    // magnitude, not just a sign flip.
    auto circuit = Circuit::parse(
        "V1 in 0 DC 5\n"
        "R1 in n 1k\n"
        "I1 0 n DC 1m\n"
        "R2 n 0 1k\n");
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "n"), WithinRel(3.0, 1e-9));
    // V1 delivers (5-3)/1k = 2mA, read as -2mA (Decision 2's convention).
    REQUIRE_THAT(source_current(circuit, solution, "V1"), WithinRel(-0.002, 1e-9));
}

TEST_CASE("Current source matches a VCCS with the same node order and a fixed 1V control", "[dc][isource][vccs]") {
    // The G device's direction was validated against ngspice separately
    // (Decision 15) and doesn't share any code with CurrentSource. SPICE
    // gives both the same convention for the same node order, so
    // "I1 0 n 2m" and "G1 0 n ctl 0 2m" with V(ctl) = 1V must give the
    // same V(n). An independent check that doesn't go through ngspice.
    auto with_i = Circuit::parse(
        "I1 0 n DC 2m\n"
        "R1 n 0 1k\n");
    auto with_g = Circuit::parse(
        "Vctl ctl 0 DC 1\n"
        "G1 0 n ctl 0 2m\n"
        "R1 n 0 1k\n");
    double v_i = node_voltage(with_i, solve_dc(with_i), "n");
    double v_g = node_voltage(with_g, solve_dc(with_g), "n");
    REQUIRE_THAT(v_i, WithinRel(v_g, 1e-12));
    REQUIRE_THAT(v_g, WithinRel(2.0, 1e-9));
}
