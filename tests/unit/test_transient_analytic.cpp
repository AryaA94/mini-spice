// Transient runs vs. the textbook closed-form answers. Tolerances are sized
// for backward Euler's first-order error at each dt.
#include <cmath>
#include <sstream>
#include <string>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;

TEST_CASE("RC step response matches V_s*(1 - e^(-t/RC)) at several time points", "[transient][analytic][rc]") {
    const double Vs = 5.0, R = 1000.0, C = 1e-6;
    const double tau = R * C;
    auto circuit = Circuit::parse("V1 in 0 DC 5\nR1 in out 1k\nC1 out 0 1u\n");

    double dt = 1e-5, stop = 5e-3;
    auto points = solve_transient(circuit, dt, stop);

    for (auto& p : points) {
        double analytic = Vs * (1.0 - std::exp(-p.time / tau));
        double sim = node_voltage(circuit, p.solution, "out");
        // error ~ dt/tau, so dt=1e-5 with tau=1e-3 stays under 1%
        REQUIRE_THAT(sim, WithinAbs(analytic, 0.02));
    }
    // t=0 should be exactly the IC
    REQUIRE_THAT(node_voltage(circuit, points.front().solution, "out"), WithinAbs(0.0, 1e-6));
}

namespace {
struct RlcParams {
    double R, L, C, Vs;
    double alpha() const { return R / (2 * L); }
    double omega0() const { return 1.0 / std::sqrt(L * C); }
};

double analytic_underdamped(const RlcParams& p, double t) {
    double alpha = p.alpha(), omega0 = p.omega0();
    double omega_d = std::sqrt(omega0 * omega0 - alpha * alpha);
    return p.Vs * (1.0 - std::exp(-alpha * t) * (std::cos(omega_d * t) + (alpha / omega_d) * std::sin(omega_d * t)));
}

double analytic_critically_damped(const RlcParams& p, double t) {
    double alpha = p.alpha();
    return p.Vs * (1.0 - (1.0 + alpha * t) * std::exp(-alpha * t));
}

double analytic_overdamped(const RlcParams& p, double t) {
    double alpha = p.alpha(), omega0 = p.omega0();
    double disc = std::sqrt(alpha * alpha - omega0 * omega0);
    double s1 = -alpha + disc, s2 = -alpha - disc;
    return p.Vs * (1.0 + (s2 * std::exp(s1 * t) - s1 * std::exp(s2 * t)) / (s1 - s2));
}

std::string rlc_netlist(double R, double L, double C, double Vs) {
    std::ostringstream oss;
    oss << "V1 in 0 DC " << Vs << "\n"
        << "R1 in a " << R << "\n"
        << "L1 a out " << L << "\n"
        << "C1 out 0 " << C << "\n";
    return oss.str();
}
}  // namespace

TEST_CASE("Underdamped series RLC step response matches its closed-form solution", "[transient][analytic][rlc]") {
    // L=1H, C=0.25F -> omega0=2 rad/s; R=1 ohm -> alpha=0.5 < omega0 (underdamped).
    RlcParams p{1.0, 1.0, 0.25, 1.0};
    auto circuit = Circuit::parse(rlc_netlist(p.R, p.L, p.C, p.Vs));
    auto points = solve_transient(circuit, 1e-4, 6.0);
    for (auto& pt : points) {
        REQUIRE_THAT(node_voltage(circuit, pt.solution, "out"), WithinAbs(analytic_underdamped(p, pt.time), 5e-3));
    }
}

TEST_CASE("Critically damped series RLC step response matches its closed-form solution", "[transient][analytic][rlc]") {
    // L=1H, C=0.25F -> omega0=2 rad/s; R=4 ohm -> alpha=2 == omega0 exactly (critically damped).
    RlcParams p{4.0, 1.0, 0.25, 1.0};
    auto circuit = Circuit::parse(rlc_netlist(p.R, p.L, p.C, p.Vs));
    auto points = solve_transient(circuit, 1e-4, 6.0);
    for (auto& pt : points) {
        REQUIRE_THAT(node_voltage(circuit, pt.solution, "out"), WithinAbs(analytic_critically_damped(p, pt.time), 5e-3));
    }
}

TEST_CASE("Overdamped series RLC step response matches its closed-form solution", "[transient][analytic][rlc]") {
    // L=1H, C=0.25F -> omega0=2 rad/s; R=10 ohm -> alpha=5 > omega0 (overdamped).
    RlcParams p{10.0, 1.0, 0.25, 1.0};
    auto circuit = Circuit::parse(rlc_netlist(p.R, p.L, p.C, p.Vs));
    auto points = solve_transient(circuit, 1e-4, 3.0);
    for (auto& pt : points) {
        REQUIRE_THAT(node_voltage(circuit, pt.solution, "out"), WithinAbs(analytic_overdamped(p, pt.time), 5e-3));
    }
}
