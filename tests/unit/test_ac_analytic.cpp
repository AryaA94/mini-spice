#include <cmath>
#include <complex>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/ac_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;

namespace {
// H(jw) = 1 / (1 + j*w*R*C) for a series-R, shunt-C low-pass with output
// taken across the capacitor.
std::complex<double> analytic_h(double R, double C, double omega) {
    return 1.0 / std::complex<double>(1.0, omega * R * C);
}
}  // namespace

TEST_CASE("RC low-pass AC magnitude and phase match the known transfer function", "[ac][analytic][rc-lpf]") {
    const double R = 1000.0, C = 100e-9;
    auto circuit = Circuit::parse("V1 in 0 DC 0 AC 1 0\nR1 in out 1k\nC1 out 0 100n\n");

    auto points = solve_ac_sweep(circuit, /*start_hz=*/10, /*stop_hz=*/1e6, /*points_per_decade=*/20);
    REQUIRE(points.size() > 50);

    for (auto& p : points) {
        double omega = 2.0 * M_PI * p.frequency_hz;
        std::complex<double> expected = analytic_h(R, C, omega);
        std::complex<double> actual = node_voltage_ac(circuit, p.solution, "out");

        REQUIRE_THAT(actual.real(), WithinAbs(expected.real(), 1e-6));
        REQUIRE_THAT(actual.imag(), WithinAbs(expected.imag(), 1e-6));
    }
}

TEST_CASE("RC low-pass magnitude is within 0.1dB of -3dB at the corner frequency f_c = 1/(2*pi*R*C)", "[ac][analytic][rc-lpf]") {
    const double R = 1000.0, C = 100e-9;
    const double fc = 1.0 / (2.0 * M_PI * R * C);
    auto circuit = Circuit::parse("V1 in 0 DC 0 AC 1 0\nR1 in out 1k\nC1 out 0 100n\n");

    // A tight two-point sweep centered exactly on f_c.
    auto points = solve_ac_sweep(circuit, fc, fc, 1);
    REQUIRE(points.size() == 1);

    std::complex<double> v = node_voltage_ac(circuit, points[0].solution, "out");
    double mag_db = 20.0 * std::log10(std::abs(v));
    REQUIRE_THAT(mag_db, WithinAbs(-3.0103, 0.01));  // 20*log10(1/sqrt(2))
}

TEST_CASE("RC low-pass phase approaches 0 degrees at low frequency and -90 degrees at high frequency", "[ac][analytic][rc-lpf]") {
    auto circuit = Circuit::parse("V1 in 0 DC 0 AC 1 0\nR1 in out 1k\nC1 out 0 100n\n");
    auto low = solve_ac_sweep(circuit, 1.0, 1.0, 1);
    auto high = solve_ac_sweep(circuit, 1e9, 1e9, 1);

    double phase_low = std::arg(node_voltage_ac(circuit, low[0].solution, "out")) * 180.0 / M_PI;
    double phase_high = std::arg(node_voltage_ac(circuit, high[0].solution, "out")) * 180.0 / M_PI;

    REQUIRE_THAT(phase_low, WithinAbs(0.0, 0.1));
    REQUIRE_THAT(phase_high, WithinAbs(-90.0, 0.1));
}

TEST_CASE("source_current_ac reports the AC branch current through a voltage source", "[ac][mna_result]") {
    // V1 drives R1 (1k) directly to ground with 1V AC excitation: the
    // current through V1 should be exactly 1mA at 0 degrees, at any
    // frequency (a pure resistor has no frequency dependence).
    auto circuit = Circuit::parse("V1 in 0 DC 0 AC 1 0\nR1 in 0 1k\n");
    auto points = solve_ac_sweep(circuit, 1000.0, 1000.0, 1);
    auto i = source_current_ac(circuit, points[0].solution, "V1");
    // Same sign convention as the DC/transient case: current is negative
    // when the source is delivering power to the external circuit.
    REQUIRE_THAT(i.real(), WithinAbs(-0.001, 1e-9));
    REQUIRE_THAT(i.imag(), WithinAbs(0.0, 1e-9));
}

TEST_CASE("source_current_ac rejects a name that isn't a voltage source", "[ac][mna_result]") {
    auto circuit = Circuit::parse("V1 in 0 DC 0 AC 1 0\nR1 in 0 1k\n");
    auto points = solve_ac_sweep(circuit, 1000.0, 1000.0, 1);
    REQUIRE_THROWS_AS(source_current_ac(circuit, points[0].solution, "R1"), std::invalid_argument);
}
