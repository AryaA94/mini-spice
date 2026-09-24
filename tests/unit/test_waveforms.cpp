// PULSE/SIN waveform validation. Waveform::value_at() is checked directly
// against hand-computed points first (the shape itself), then a full
// transient run is cross-checked against ngspice (with UIC on both sides
// -- see DESIGN_DECISIONS.md #17 for why that flag matters here, the same
// lesson learned earlier for the plain RC/RLC transient comparisons).
#include <cmath>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/component.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::WithinRel;

TEST_CASE("Waveform PULSE shape matches the hand-derived piecewise-linear definition", "[waveform][pulse]") {
    Waveform w;
    w.kind = Waveform::Kind::Pulse;
    w.v1 = 0.0;
    w.v2 = 5.0;
    w.td = 1.0;
    w.tr = 0.1;
    w.tf = 0.1;
    w.pw = 2.0;
    w.per = 4.0;

    REQUIRE_THAT(w.value_at(0.0), WithinAbs(0.0, 1e-12));    // before TD: V1
    REQUIRE_THAT(w.value_at(0.9), WithinAbs(0.0, 1e-12));    // still before TD
    REQUIRE_THAT(w.value_at(1.0), WithinAbs(0.0, 1e-12));    // exactly at TD: rise hasn't started
    REQUIRE_THAT(w.value_at(1.05), WithinAbs(2.5, 1e-9));    // halfway up the rise (TR=0.1, so at TD+0.05)
    REQUIRE_THAT(w.value_at(1.1), WithinAbs(5.0, 1e-9));     // rise complete: V2
    REQUIRE_THAT(w.value_at(2.0), WithinAbs(5.0, 1e-9));     // mid-plateau (PW=2, so plateau runs 1.1 to 3.1)
    REQUIRE_THAT(w.value_at(3.1), WithinAbs(5.0, 1e-9));     // plateau end / fall start
    REQUIRE_THAT(w.value_at(3.15), WithinAbs(2.5, 1e-9));    // halfway down the fall
    REQUIRE_THAT(w.value_at(3.2), WithinAbs(0.0, 1e-9));     // fall complete: V1
    REQUIRE_THAT(w.value_at(3.9), WithinAbs(0.0, 1e-12));    // resting at V1 until the period repeats
    REQUIRE_THAT(w.value_at(5.05), WithinAbs(2.5, 1e-9));    // second period: TD+PER=5.0, same shape repeats
}

TEST_CASE("Waveform PULSE with zero rise/fall time is an instantaneous step", "[waveform][pulse]") {
    Waveform w;
    w.kind = Waveform::Kind::Pulse;
    w.v1 = 0.0;
    w.v2 = 5.0;
    w.td = 1.0;
    w.tr = 0.0;
    w.tf = 0.0;
    w.pw = 2.0;
    w.per = 4.0;
    REQUIRE_THAT(w.value_at(0.999), WithinAbs(0.0, 1e-12));
    REQUIRE_THAT(w.value_at(1.0), WithinAbs(5.0, 1e-9));  // TR=0 -> already at V2 the instant TD passes
    REQUIRE_THAT(w.value_at(3.0), WithinAbs(0.0, 1e-9));  // TF=0 -> already back at V1 at PW's end
}

TEST_CASE("Waveform SIN shape matches VO + VA*sin(2*pi*FREQ*t) with no damping", "[waveform][sine]") {
    Waveform w;
    w.kind = Waveform::Kind::Sine;
    w.vo = 1.0;
    w.va = 2.0;
    w.freq = 500.0;
    w.sin_td = 0.0;
    w.theta = 0.0;

    for (double t : {0.0, 0.0003, 0.0006, 0.0012, 0.002}) {
        double expected = 1.0 + 2.0 * std::sin(2.0 * M_PI * 500.0 * t);
        REQUIRE_THAT(w.value_at(t), WithinAbs(expected, 1e-9));
    }
}

TEST_CASE("Waveform SIN holds at VO before its own TD, then starts oscillating", "[waveform][sine]") {
    Waveform w;
    w.kind = Waveform::Kind::Sine;
    w.vo = 1.0;
    w.va = 2.0;
    w.freq = 500.0;
    w.sin_td = 0.001;
    w.theta = 0.0;
    REQUIRE_THAT(w.value_at(0.0), WithinAbs(1.0, 1e-12));
    REQUIRE_THAT(w.value_at(0.0005), WithinAbs(1.0, 1e-12));
    double expected_after = 1.0 + 2.0 * std::sin(2.0 * M_PI * 500.0 * 0.0002);
    REQUIRE_THAT(w.value_at(0.0012), WithinAbs(expected_after, 1e-9));
}

TEST_CASE("Waveform SIN with nonzero THETA decays exponentially", "[waveform][sine]") {
    Waveform w;
    w.kind = Waveform::Kind::Sine;
    w.vo = 0.0;
    w.va = 1.0;
    w.freq = 100.0;
    w.sin_td = 0.0;
    w.theta = 50.0;
    double t = 0.01;
    double expected = std::exp(-t * 50.0) * std::sin(2.0 * M_PI * 100.0 * t);
    REQUIRE_THAT(w.value_at(t), WithinAbs(expected, 1e-9));
}

TEST_CASE("Netlist parses PULSE(...) on a voltage source, defaulting DC to V1", "[waveform][netlist]") {
    auto circuit = Circuit::parse("V1 in 0 PULSE(0 5 1m 0.1m 0.1m 2m 4m)\nR1 in 0 1k\n");
    auto* v = dynamic_cast<VoltageSource*>(circuit.find("V1"));
    REQUIRE(v != nullptr);
    REQUIRE(v->has_waveform);
    REQUIRE(v->waveform.kind == Waveform::Kind::Pulse);
    REQUIRE_THAT(v->waveform.v1, WithinAbs(0.0, 1e-12));
    REQUIRE_THAT(v->waveform.v2, WithinAbs(5.0, 1e-12));
    REQUIRE_THAT(v->waveform.td, WithinAbs(1e-3, 1e-15));
    REQUIRE_THAT(v->waveform.per, WithinAbs(4e-3, 1e-15));
    REQUIRE_THAT(v->dc_value, WithinAbs(0.0, 1e-12));  // defaulted to V1, since no explicit DC was given
}

TEST_CASE("Netlist parses SIN(...) on a current source, defaulting DC to VO", "[waveform][netlist]") {
    auto circuit = Circuit::parse("I1 a 0 SIN(1 2 500)\nR1 a 0 1k\n");
    auto* i = dynamic_cast<CurrentSource*>(circuit.find("I1"));
    REQUIRE(i != nullptr);
    REQUIRE(i->has_waveform);
    REQUIRE(i->waveform.kind == Waveform::Kind::Sine);
    REQUIRE_THAT(i->waveform.vo, WithinAbs(1.0, 1e-12));
    REQUIRE_THAT(i->waveform.va, WithinAbs(2.0, 1e-12));
    REQUIRE_THAT(i->waveform.freq, WithinAbs(500.0, 1e-9));
    REQUIRE_THAT(i->waveform.theta, WithinAbs(0.0, 1e-12));  // optional, defaults to 0
    REQUIRE_THAT(i->dc_value, WithinAbs(1.0, 1e-12));        // defaulted to VO
}

TEST_CASE("Netlist honors an explicit DC value alongside a PULSE waveform", "[waveform][netlist]") {
    auto circuit = Circuit::parse("V1 in 0 DC 2.5 PULSE(0 5 1m 0.1m 0.1m 2m 4m)\n");
    auto* v = dynamic_cast<VoltageSource*>(circuit.find("V1"));
    REQUIRE_THAT(v->dc_value, WithinAbs(2.5, 1e-12));  // explicit DC wins over the waveform's rest_value()
}

TEST_CASE("Netlist rejects PULSE(...) with the wrong number of values", "[waveform][netlist][edge-cases]") {
    REQUIRE_THROWS_AS(Circuit::parse("V1 in 0 PULSE(0 5 1m)\n"), ParseError);
}

TEST_CASE("Netlist rejects SIN(...) with a non-positive FREQ", "[waveform][netlist][edge-cases]") {
    REQUIRE_THROWS_AS(Circuit::parse("V1 in 0 SIN(1 2 0)\n"), ParseError);
}

TEST_CASE("Netlist rejects an unterminated PULSE(...) clause", "[waveform][netlist][edge-cases]") {
    REQUIRE_THROWS_AS(Circuit::parse("V1 in 0 PULSE(0 5 1m 0.1m\n"), ParseError);
}

TEST_CASE("Repeated PULSE through an RC filter matches the expected charge/discharge pattern", "[waveform][transient]") {
    // Same circuit and parameters validated against ngspice separately
    // (docs/ngspice_comparison.md): within the plateau (1.1ms-3.1ms,
    // V(in) held at 5V with the reactive element already well into that
    // phase), V(out) should be approaching the plain RC charging curve
    // measured from when the plateau began.
    auto circuit = Circuit::parse("V1 in 0 PULSE(0 5 0.001 0.0001 0.0001 0.002 0.004)\nR1 in out 1k\nC1 out 0 1u\n");
    auto points = solve_transient(circuit, 2e-5, 0.01);

    // Before TD, V(out) should stay at 0 (capacitor starts at IC=0, input is 0).
    for (auto& p : points) {
        if (p.time < 0.0009) {
            REQUIRE_THAT(node_voltage(circuit, p.solution, "out"), WithinAbs(0.0, 1e-6));
        }
    }
    // Deep into the first plateau (V(in)=5V held since t=1.1ms), V(out)
    // should be climbing monotonically toward 5V, consistent with normal
    // RC charging (tau = 1k*1uF = 1ms, so by t=3.0ms -- about 1.9ms into
    // the plateau -- it should be well past halfway to 5V).
    for (auto& p : points) {
        if (p.time > 0.0029 && p.time < 0.0031) {
            REQUIRE(node_voltage(circuit, p.solution, "out") > 3.5);
            REQUIRE(node_voltage(circuit, p.solution, "out") < 5.0);
        }
    }
}

TEST_CASE("SIN source transient output tracks the expected input waveform exactly (no reactive elements)", "[waveform][transient]") {
    // A pure resistive load means V(node) == the source waveform itself,
    // exactly (no filtering) -- the most direct possible check that the
    // *transient solver*, not just Waveform::value_at() in isolation,
    // evaluates the source at the right absolute time each step.
    auto circuit = Circuit::parse("V1 in 0 SIN(1 2 500 0 0)\nR1 in 0 1k\n");
    auto points = solve_transient(circuit, 2e-5, 0.004);
    for (auto& p : points) {
        double expected = 1.0 + 2.0 * std::sin(2.0 * M_PI * 500.0 * p.time);
        REQUIRE_THAT(node_voltage(circuit, p.solution, "in"), WithinAbs(expected, 1e-9));
    }
}
