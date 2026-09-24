// BJT (Ebers-Moll) validation. Same standard as the diode: a DC operating
// point isn't trusted just because it "looks plausible" -- each analytic
// case here is cross-checked against a *fresh*, independently-written
// Newton-Raphson solve in Python (one with an analytic Jacobian, one with
// a numerical/finite-difference Jacobian -- deliberately two different
// methods) and against ngspice, documented in DESIGN_DECISIONS.md.
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

TEST_CASE("Bjt stamp matches the hand-derived four-term Jacobian at a given guess point", "[bjt][components]") {
    // IS=1e-16, BF=100, BR=1, guess_vbe=0.6, guess_vbc=-3.0 (typical
    // forward-active bias: base-emitter forward biased, base-collector
    // reverse biased). Reference gpi/gmr/gmf/go/iB_eq/iC_eq computed once
    // in a standalone Python script from the same formulas documented in
    // component.hpp/component.cpp and DESIGN_DECISIONS.md.
    Bjt q("Q1", /*collector=*/0, /*base=*/1, /*emitter=*/2, 1e-16, 100.0, 1.0);
    // Drive the guess to (0.6, -3.0). The per-step cap is 10*Vt =~0.2586V,
    // so this needs several update_nr_guess() calls to actually get there
    // (mirroring how the solver's iteration loop would arrive at it).
    // solution is indexed by node: [collector, base, emitter] = [0,1,2];
    // vbe = v(base)-v(emitter) = 0.6-0 = 0.6, vbc = v(base)-v(collector)
    // = 0.6-3.6 = -3.0, so the collector entry must be 3.6, not -3.0.
    for (int i = 0; i < 30; ++i) {
        double d = q.update_nr_guess(std::vector<double>{3.6, 0.6, 0.0});
        if (d < 1e-12) break;
    }
    REQUIRE_THAT(q.guess_vbe_for_test(), WithinAbs(0.6, 1e-9));
    REQUIRE_THAT(q.guess_vbc_for_test(), WithinAbs(-3.0, 1e-9));

    double gpi = 4.5899490941622635e-07;
    double gmr = 1.6394313445790129e-65;
    double gmf = 4.589949094162264e-05;
    double go = -3.2788626891580258e-65;
    double i_b_eq = -2.635250764761074e-07;
    double i_c_eq = -2.635250763741074e-05;

    Matrix<double> A(3, 3);
    std::vector<double> b(3, 0.0);
    q.stamp_time_domain(A, b, 0.0, 0.0);
    int nc = 0, nb = 1, ne = 2;

    REQUIRE_THAT(A(nb, nb), WithinRel(gpi + gmr, 1e-9));
    REQUIRE_THAT(A(nb, nc), WithinAbs(-gmr, 1e-70));  // gmr ~1e-65, effectively 0 here
    REQUIRE_THAT(A(nb, ne), WithinRel(-gpi, 1e-9));
    REQUIRE_THAT(A(nc, nb), WithinRel(gmf + go, 1e-9));
    REQUIRE_THAT(A(nc, nc), WithinAbs(-go, 1e-70));
    REQUIRE_THAT(A(nc, ne), WithinRel(-gmf, 1e-9));
    REQUIRE_THAT(A(ne, nb), WithinRel(-(gpi + gmr + gmf + go), 1e-9));
    REQUIRE_THAT(A(ne, nc), WithinAbs(gmr + go, 1e-70));
    REQUIRE_THAT(A(ne, ne), WithinRel(gpi + gmf, 1e-9));

    REQUIRE_THAT(b[static_cast<std::size_t>(nb)], WithinRel(-i_b_eq, 1e-6));
    REQUIRE_THAT(b[static_cast<std::size_t>(nc)], WithinRel(-i_c_eq, 1e-6));
    REQUIRE_THAT(b[static_cast<std::size_t>(ne)], WithinRel(i_b_eq + i_c_eq, 1e-6));
}

TEST_CASE("Bjt reset_nr_state returns both guesses to 0V", "[bjt][components]") {
    Bjt q("Q1", 0, 1, 2, 1e-16, 100.0, 1.0);
    q.update_nr_guess(std::vector<double>{-3.0, 0.6, 0.0});
    REQUIRE(q.guess_vbe_for_test() != 0.0);
    q.reset_nr_state();
    REQUIRE(q.guess_vbe_for_test() == 0.0);
    REQUIRE(q.guess_vbc_for_test() == 0.0);
}

TEST_CASE("Bjt update_nr_guess clamps large steps in Vbe and Vbc independently", "[bjt][components]") {
    Bjt q("Q1", 0, 1, 2, 1e-16, 100.0, 1.0);
    double vt = Diode::thermal_voltage();  // same constant, shared convention
    // solution = [collector, base, emitter] = [-10.0, 5.0, 0.0] -> target
    // vbe = 5.0-0.0 = 5.0V, target vbc = 5.0-(-10.0) = 15.0V: both far
    // outside the per-step cap starting from the initial guess (0, 0).
    double delta = q.update_nr_guess(std::vector<double>{-10.0, 5.0, 0.0});
    REQUIRE(q.guess_vbe_for_test() < 5.0);   // did not jump all the way to the 5.0V target
    REQUIRE(q.guess_vbc_for_test() < 15.0);  // did not jump all the way to the 15.0V target
    REQUIRE(std::abs(q.guess_vbe_for_test()) <= 10.0 * vt + 1e-12);
    REQUIRE(std::abs(q.guess_vbc_for_test()) <= 10.0 * vt + 1e-12);
    REQUIRE(delta > 0.0);
}

TEST_CASE("Netlist parses a BJT line with default and explicit IS/BF/BR", "[bjt][netlist]") {
    auto circuit = Circuit::parse("Q1 col base emit\nQ2 c2 b2 e2 IS=5e-15 BF=150 BR=2\n");
    auto* q1 = dynamic_cast<Bjt*>(circuit.find("Q1"));
    auto* q2 = dynamic_cast<Bjt*>(circuit.find("Q2"));
    REQUIRE(q1 != nullptr);
    REQUIRE(q2 != nullptr);
    REQUIRE(q1->is_sat == 1e-16);
    REQUIRE(q1->beta_f == 100.0);
    REQUIRE(q1->beta_r == 1.0);
    REQUIRE(q2->is_sat == 5e-15);
    REQUIRE(q2->beta_f == 150.0);
    REQUIRE(q2->beta_r == 2.0);
}

TEST_CASE("Netlist rejects a BJT line missing its third node (the emitter)", "[bjt][netlist]") {
    REQUIRE_THROWS_AS(Circuit::parse("Q1 col base\n"), ParseError);
}

TEST_CASE("Fixed-bias BJT circuit matches an independent analytic-Jacobian Newton-Raphson solve", "[bjt][analytic]") {
    // VBB=5V->RB=100k->base; VCC=10V->RC=1k->collector; emitter grounded.
    // Reference computed by a from-scratch 2D Newton-Raphson written in
    // Python (analytic Jacobian, not this solver's code), converging to
    // KCL residuals ~1e-18 -- and cross-checked against ngspice
    // separately (see docs/ngspice_comparison.md).
    auto circuit = Circuit::parse(
        "VBB base 0 DC 5\n"
        "RB base b1 100k\n"
        "VCC vcc 0 DC 10\n"
        "RC vcc col 1k\n"
        "Q1 col b1 0 IS=1e-16 BF=100 BR=1\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "b1"), WithinAbs(0.8112793033, 1e-6));
    REQUIRE_THAT(node_voltage(circuit, sol, "col"), WithinAbs(5.8112793033, 1e-6));
}

TEST_CASE("BJT with emitter degeneration matches an independent numerical-Jacobian Newton-Raphson solve", "[bjt][analytic]") {
    // VBB=5V->RB=220k->base; VCC=12V->RC=2.2k->collector; emitter->RE=1k->ground.
    // Reference computed by a *different* from-scratch Python solve than
    // the case above -- this one uses a numerical (finite-difference)
    // Jacobian instead of the analytic formulas, a deliberately
    // independent method, also converging to KCL residuals ~1e-18.
    auto circuit = Circuit::parse(
        "VBB base 0 DC 5\n"
        "RB base b1 220k\n"
        "VCC vcc 0 DC 12\n"
        "RC vcc col 2.2k\n"
        "RE emit 0 1k\n"
        "Q1 col b1 emit IS=5e-15 BF=150 BR=2\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "b1"), WithinAbs(2.4426787232, 1e-6));
    REQUIRE_THAT(node_voltage(circuit, sol, "col"), WithinAbs(8.1640180840, 1e-6));
    REQUIRE_THAT(node_voltage(circuit, sol, "emit"), WithinAbs(1.7552523313, 1e-6));
}

TEST_CASE("Fixed-bias BJT collector current is approximately BF times the base current", "[bjt][analytic]") {
    // A physical sanity check independent of the exact operating point:
    // in forward-active operation (which this bias point is), IC/IB
    // should land close to BF -- not a tight check (BR/leakage terms make
    // it not *exactly* BF), but a real transistor-behavior smoke test
    // that a broken sign somewhere would very likely fail.
    auto circuit = Circuit::parse(
        "VBB base 0 DC 5\n"
        "RB base b1 100k\n"
        "VCC vcc 0 DC 10\n"
        "RC vcc col 1k\n"
        "Q1 col b1 0 IS=1e-16 BF=100 BR=1\n");
    auto sol = solve_dc(circuit);
    double vcc_current = -source_current(circuit, sol, "VCC");  // = IC, since VCC solely feeds RC->collector
    double vbb_current = -source_current(circuit, sol, "VBB");  // = IB
    REQUIRE_THAT(vcc_current / vbb_current, WithinRel(100.0, 0.02));  // within 2% of BF=100
}

TEST_CASE("solve_ac_sweep computes a correct small-signal response for a circuit containing a BJT", "[bjt][ac]") {
    // Same independent finite-difference cross-check as the diode's AC
    // test: perturb the DC base-bias source by +-eps, compare the slope
    // against the AC solver's small-signal gain at the collector.
    auto make_circuit = [](double vbb) {
        return Circuit::parse("VBB base 0 DC " + std::to_string(vbb) +
                               "\nRB base b1 100k\nVCC vcc 0 DC 10\nRC vcc col 1k\nQ1 col b1 0 IS=1e-16 BF=100 BR=1\n");
    };
    double eps = 1e-3;
    auto c_plus = make_circuit(5.0 + eps);
    auto c_minus = make_circuit(5.0 - eps);
    double fd_gain =
        (node_voltage(c_plus, solve_dc(c_plus), "col") - node_voltage(c_minus, solve_dc(c_minus), "col")) / (2 * eps);

    auto ac_circuit = Circuit::parse(
        "VBB base 0 DC 5 AC 1 0\nRB base b1 100k\nVCC vcc 0 DC 10\nRC vcc col 1k\nQ1 col b1 0 IS=1e-16 BF=100 BR=1\n");
    auto points = solve_ac_sweep(ac_circuit, 1000, 1000, 1);
    auto v = node_voltage_ac(ac_circuit, points[0].solution, "col");

    REQUIRE_THAT(std::abs(v), WithinRel(std::abs(fd_gain), 1e-6));
}

TEST_CASE("BJT transient settles to the same operating point as the DC solve", "[bjt][transient]") {
    std::string netlist =
        "VBB base 0 DC 5\n"
        "RB base b1 100k\n"
        "VCC vcc 0 DC 10\n"
        "RC vcc col 1k\n"
        "Q1 col b1 0 IS=1e-16 BF=100 BR=1\n";
    auto dc_circuit = Circuit::parse(netlist);
    auto dc_sol = solve_dc(dc_circuit);
    double dc_vcol = node_voltage(dc_circuit, dc_sol, "col");

    auto tran_circuit = Circuit::parse(netlist);
    auto points = solve_transient(tran_circuit, 1e-6, 2e-3);
    double tran_vcol_final = node_voltage(tran_circuit, points.back().solution, "col");

    REQUIRE_THAT(tran_vcol_final, WithinAbs(dc_vcol, 1e-3));
}

TEST_CASE("PNP fixed-bias circuit is the exact mirror of the NPN fixed-bias circuit", "[bjt][pnp][analytic]") {
    // Same topology as the NPN fixed-bias test above, with every supply
    // negated and TYPE=PNP: the PNP model is defined as an NPN mirror (see
    // DESIGN_DECISIONS.md #14), so the operating point should be the exact
    // negation of the NPN case's already-validated 0.8112793033 / 5.8112793033.
    auto circuit = Circuit::parse(
        "VBB base 0 DC -5\n"
        "RB base b1 100k\n"
        "VCC vcc 0 DC -10\n"
        "RC vcc col 1k\n"
        "Q1 col b1 0 IS=1e-16 BF=100 BR=1 TYPE=PNP\n");
    auto sol = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, sol, "b1"), WithinAbs(-0.8112793033, 1e-6));
    REQUIRE_THAT(node_voltage(circuit, sol, "col"), WithinAbs(-5.8112793033, 1e-6));
}

TEST_CASE("Netlist parses TYPE=NPN and TYPE=PNP, defaulting to NPN", "[bjt][pnp][netlist]") {
    auto circuit = Circuit::parse("Q1 c1 b1 e1\nQ2 c2 b2 e2 TYPE=PNP\nQ3 c3 b3 e3 TYPE=NPN\n");
    auto* q1 = dynamic_cast<Bjt*>(circuit.find("Q1"));
    auto* q2 = dynamic_cast<Bjt*>(circuit.find("Q2"));
    auto* q3 = dynamic_cast<Bjt*>(circuit.find("Q3"));
    REQUIRE(q1->is_pnp == false);
    REQUIRE(q2->is_pnp == true);
    REQUIRE(q3->is_pnp == false);
}

TEST_CASE("Netlist rejects an unrecognized BJT TYPE value", "[bjt][pnp][netlist]") {
    REQUIRE_THROWS_AS(Circuit::parse("Q1 c b e TYPE=FET\n"), ParseError);
}
