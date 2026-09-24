// Checks the exact matrix/RHS entries each component stamps, worked out by
// hand. A sign error in a companion model shows up here first.
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/component.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;

TEST_CASE("Resistor stamps the standard four-entry conductance pattern", "[components][resistor]") {
    Resistor r("R1", 0, 1, 2.0);  // 2 ohm -> g = 0.5 S
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    r.stamp_time_domain(A, b, 0.0, 0.0);

    REQUIRE_THAT(A(0, 0), WithinAbs(0.5, 1e-12));
    REQUIRE_THAT(A(1, 1), WithinAbs(0.5, 1e-12));
    REQUIRE_THAT(A(0, 1), WithinAbs(-0.5, 1e-12));
    REQUIRE_THAT(A(1, 0), WithinAbs(-0.5, 1e-12));
    REQUIRE_THAT(b[0], WithinAbs(0.0, 1e-12));
    REQUIRE_THAT(b[1], WithinAbs(0.0, 1e-12));
}

TEST_CASE("Resistor to ground only stamps the diagonal entry of its non-ground node", "[components][resistor]") {
    Resistor r("R1", 0, kGround, 4.0);  // 4 ohm -> g = 0.25 S
    Matrix<double> A(1, 1);
    std::vector<double> b(1, 0.0);
    r.stamp_time_domain(A, b, 0.0, 0.0);
    REQUIRE_THAT(A(0, 0), WithinAbs(0.25, 1e-12));
}

TEST_CASE("Resistor AC stamp is a purely real admittance regardless of frequency", "[components][resistor][ac]") {
    Resistor r("R1", 0, 1, 10.0);  // g = 0.1 S
    Matrix<std::complex<double>> A(2, 2);
    std::vector<std::complex<double>> b(2, {0, 0});
    r.stamp_ac(A, b, /*omega=*/1e6);
    REQUIRE_THAT(A(0, 0).real(), WithinAbs(0.1, 1e-12));
    REQUIRE_THAT(A(0, 0).imag(), WithinAbs(0.0, 1e-12));
}

TEST_CASE("Capacitor DC-operating-point stamp is an open circuit (no contribution)", "[components][capacitor]") {
    Capacitor c("C1", 0, 1, 1e-6);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    c.stamp_time_domain(A, b, 0.0, 0.0);  // dt == 0 -> DC op
    REQUIRE_THAT(A(0, 0), WithinAbs(0.0, 1e-15));
    REQUIRE_THAT(A(1, 1), WithinAbs(0.0, 1e-15));
    REQUIRE_THAT(b[0], WithinAbs(0.0, 1e-15));
}

TEST_CASE("Capacitor backward-Euler companion stamp matches the hand-derived Norton model", "[components][capacitor]") {
    // C = 1uF, dt = 1ms -> g_eq = C/dt = 1e-3 S. History (prev_voltage) = 2V.
    Capacitor c("C1", 0, 1, 1e-6, /*ic=*/2.0);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    c.stamp_time_domain(A, b, 0.0, 1e-3);

    double g_eq = 1e-3;
    REQUIRE_THAT(A(0, 0), WithinAbs(g_eq, 1e-12));
    REQUIRE_THAT(A(1, 1), WithinAbs(g_eq, 1e-12));
    REQUIRE_THAT(A(0, 1), WithinAbs(-g_eq, 1e-12));
    REQUIRE_THAT(A(1, 0), WithinAbs(-g_eq, 1e-12));
    // Norton current source = g_eq * v_prev, injected into node p (0) and out of node n (1).
    REQUIRE_THAT(b[0], WithinAbs(g_eq * 2.0, 1e-12));
    REQUIRE_THAT(b[1], WithinAbs(-g_eq * 2.0, 1e-12));
}

TEST_CASE("Capacitor commit_timestep updates history from the solved node voltages", "[components][capacitor]") {
    Capacitor c("C1", 0, 1, 1e-6);
    std::vector<double> solution = {3.0, 1.0};  // v(0)-v(1) = 2.0
    c.commit_timestep(solution);
    REQUIRE_THAT(c.history_voltage(), WithinAbs(2.0, 1e-12));
}

TEST_CASE("Capacitor AC admittance is j*omega*C", "[components][capacitor][ac]") {
    Capacitor c("C1", 0, 1, 1e-6);
    Matrix<std::complex<double>> A(2, 2);
    std::vector<std::complex<double>> b(2, {0, 0});
    double omega = 1000.0;
    c.stamp_ac(A, b, omega);
    REQUIRE_THAT(A(0, 0).real(), WithinAbs(0.0, 1e-15));
    REQUIRE_THAT(A(0, 0).imag(), WithinAbs(omega * 1e-6, 1e-12));
}

TEST_CASE("Inductor DC-operating-point stamp is a small-resistance short approximation", "[components][inductor]") {
    Inductor l("L1", 0, 1, 1e-3);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    l.stamp_time_domain(A, b, 0.0, 0.0);
    // Should be a large conductance (>= 1e5 S), i.e. a near-zero resistance.
    REQUIRE(A(0, 0) > 1e5);
    REQUIRE_THAT(A(0, 1), WithinAbs(-A(0, 0), 1e-6));
}

TEST_CASE("Inductor backward-Euler companion stamp matches the hand-derived Norton model", "[components][inductor]") {
    // L = 1mH, dt = 1us -> g_eq = dt/L = 1e-3 S. History (prev_current) = 0.5A.
    Inductor l("L1", 0, 1, 1e-3, /*ic=*/0.5);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    l.stamp_time_domain(A, b, 0.0, 1e-6);

    double g_eq = 1e-3;
    REQUIRE_THAT(A(0, 0), WithinAbs(g_eq, 1e-12));
    REQUIRE_THAT(A(1, 1), WithinAbs(g_eq, 1e-12));
    // -i_prev into p, +i_prev into n (opposite of the capacitor)
    REQUIRE_THAT(b[0], WithinAbs(-0.5, 1e-12));
    REQUIRE_THAT(b[1], WithinAbs(0.5, 1e-12));
}

TEST_CASE("Inductor commit_timestep advances current history using the same g_eq as its stamp", "[components][inductor]") {
    Inductor l("L1", 0, 1, 1e-3, /*ic=*/0.0);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    l.stamp_time_domain(A, b, 0.0, 1e-6);  // g_eq = 1e-3, last_dt_ recorded internally

    std::vector<double> solution = {1.0, 0.0};  // v = 1V across the inductor
    l.commit_timestep(solution);
    // i_new = i_prev(0) + g_eq*v = 0 + 1e-3*1.0 = 1e-3
    REQUIRE_THAT(l.history_current(), WithinAbs(1e-3, 1e-12));
}

TEST_CASE("Inductor AC admittance is 1/(j*omega*L)", "[components][inductor][ac]") {
    Inductor l("L1", 0, 1, 1e-3);
    Matrix<std::complex<double>> A(2, 2);
    std::vector<std::complex<double>> b(2, {0, 0});
    double omega = 1000.0;
    l.stamp_ac(A, b, omega);
    double expected_imag = -1.0 / (omega * 1e-3);
    REQUIRE_THAT(A(0, 0).real(), WithinAbs(0.0, 1e-15));
    REQUIRE_THAT(A(0, 0).imag(), WithinAbs(expected_imag, 1e-9));
}

TEST_CASE("VoltageSource stamps the branch-current constraint row and column", "[components][vsource]") {
    VoltageSource v("V1", 0, 1, 5.0);
    v.set_branch_index(2);
    Matrix<double> A(3, 3);
    std::vector<double> b(3, 0.0);
    v.stamp_time_domain(A, b, 0.0, 0.0);

    REQUIRE_THAT(A(2, 0), WithinAbs(1.0, 1e-12));
    REQUIRE_THAT(A(2, 1), WithinAbs(-1.0, 1e-12));
    REQUIRE_THAT(A(0, 2), WithinAbs(1.0, 1e-12));
    REQUIRE_THAT(A(1, 2), WithinAbs(-1.0, 1e-12));
    REQUIRE_THAT(b[2], WithinAbs(5.0, 1e-12));
}

TEST_CASE("VoltageSource to ground only touches its one live node", "[components][vsource]") {
    VoltageSource v("V1", 0, kGround, 12.0);
    v.set_branch_index(1);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    v.stamp_time_domain(A, b, 0.0, 0.0);
    REQUIRE_THAT(A(1, 0), WithinAbs(1.0, 1e-12));
    REQUIRE_THAT(A(0, 1), WithinAbs(1.0, 1e-12));
    REQUIRE_THAT(b[1], WithinAbs(12.0, 1e-12));
}

TEST_CASE("CurrentSource injects its value directly into the RHS with no matrix contribution", "[components][isource]") {
    // "I1 0 1 3mA": 3mA leaves node 0 and enters node 1, so b[0] = -3mA and
    // b[1] = +3mA. (This test used to expect the opposite, see #19.)
    CurrentSource i("I1", 0, 1, 0.003);
    Matrix<double> A(2, 2);
    std::vector<double> b(2, 0.0);
    i.stamp_time_domain(A, b, 0.0, 0.0);
    REQUIRE_THAT(A(0, 0), WithinAbs(0.0, 1e-15));  // no matrix contribution at all
    REQUIRE_THAT(b[0], WithinAbs(-0.003, 1e-12));
    REQUIRE_THAT(b[1], WithinAbs(0.003, 1e-12));
}

TEST_CASE("CurrentSource AC stamp uses the same direction as its DC stamp", "[components][isource][ac]") {
    CurrentSource i("I1", 0, 1, 0.0, 0.002, 0.0);
    Matrix<std::complex<double>> A(2, 2);
    std::vector<std::complex<double>> b(2, {0.0, 0.0});
    i.stamp_ac(A, b, 1000.0);
    REQUIRE_THAT(b[0].real(), WithinAbs(-0.002, 1e-12));
    REQUIRE_THAT(b[1].real(), WithinAbs(0.002, 1e-12));
    REQUIRE_THAT(b[0].imag(), WithinAbs(0.0, 1e-15));
}
