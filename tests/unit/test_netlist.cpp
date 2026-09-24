#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/netlist.hpp"

using namespace minispice;
using Catch::Matchers::WithinRel;

TEST_CASE("parse_value handles unit suffixes", "[netlist][parse_value]") {
    REQUIRE_THAT(parse_value("1k"), WithinRel(1000.0, 1e-12));
    REQUIRE_THAT(parse_value("4.7u"), WithinRel(4.7e-6, 1e-12));
    REQUIRE_THAT(parse_value("100n"), WithinRel(100e-9, 1e-12));
    REQUIRE_THAT(parse_value("2.2MEG"), WithinRel(2.2e6, 1e-12));
    REQUIRE_THAT(parse_value("2.2meg"), WithinRel(2.2e6, 1e-12));
    REQUIRE_THAT(parse_value("1m"), WithinRel(1e-3, 1e-12));   // milli, not mega
    REQUIRE_THAT(parse_value("1p"), WithinRel(1e-12, 1e-9));
    REQUIRE_THAT(parse_value("1e-6"), WithinRel(1e-6, 1e-12)); // bare scientific notation
    REQUIRE_THAT(parse_value("1.5e3"), WithinRel(1500.0, 1e-12));
    REQUIRE_THAT(parse_value("10"), WithinRel(10.0, 1e-12));
}

TEST_CASE("parse_value ignores a trailing unit label after a recognized suffix", "[netlist][parse_value]") {
    REQUIRE_THAT(parse_value("1kOhm"), WithinRel(1000.0, 1e-12));
    REQUIRE_THAT(parse_value("100uF"), WithinRel(100e-6, 1e-12));
}

TEST_CASE("parse_value rejects garbage", "[netlist][parse_value]") {
    REQUIRE_THROWS_AS(parse_value("abc"), std::invalid_argument);
    REQUIRE_THROWS_AS(parse_value(""), std::invalid_argument);
}

TEST_CASE("Circuit::parse builds the expected node table for a voltage divider", "[netlist]") {
    auto circuit = Circuit::parse(
        "V1 in 0 DC 10\n"
        "R1 in out 1k\n"
        "R2 out 0 1k\n");

    REQUIRE(circuit.num_nodes() == 2);  // "in" and "out"; node 0 is ground, not counted
    REQUIRE(circuit.num_extra_unknowns() == 1);  // one voltage source branch current
    REQUIRE(circuit.components().size() == 3);
    REQUIRE(circuit.node_index("in") != circuit.node_index("out"));
    REQUIRE(circuit.node_index("0") == kGround);
}

TEST_CASE("Circuit::parse resolves 'gnd' as an alias for ground", "[netlist]") {
    auto circuit = Circuit::parse("R1 a gnd 1k\n");
    REQUIRE(circuit.node_index("gnd") == kGround);
}

TEST_CASE("Circuit::parse skips comment and blank lines", "[netlist]") {
    auto circuit = Circuit::parse(
        "* this is a comment\n"
        "\n"
        "R1 a 0 1k   # inline comment too\n");
    REQUIRE(circuit.components().size() == 1);
}

TEST_CASE("Circuit::parse assigns correct branch indices even when a voltage source is the first line to mention a node",
          "[netlist]") {
    // V1 introduces node "out" before any other component does, then R1
    // introduces node "mid". The voltage-source branch index must still end
    // up placed *after* every node, regardless of discovery order.
    auto circuit = Circuit::parse(
        "V1 out 0 DC 5\n"
        "R1 out mid 1k\n"
        "R2 mid 0 1k\n");
    REQUIRE(circuit.system_size() == circuit.num_nodes() + 1);
    auto* v1 = dynamic_cast<VoltageSource*>(circuit.find("V1"));
    REQUIRE(v1 != nullptr);
    REQUIRE(static_cast<std::size_t>(v1->branch_index) == circuit.num_nodes());
}

TEST_CASE("Circuit::parse reads capacitor and inductor initial conditions", "[netlist]") {
    auto circuit = Circuit::parse(
        "C1 a 0 1u IC=2.5\n"
        "L1 a 0 1m IC=0.1\n");
    auto* c = dynamic_cast<Capacitor*>(circuit.find("C1"));
    auto* l = dynamic_cast<Inductor*>(circuit.find("L1"));
    REQUIRE(c != nullptr);
    REQUIRE(l != nullptr);
    REQUIRE(c->history_voltage() == 2.5);
    REQUIRE(l->history_current() == 0.1);
}

TEST_CASE("Circuit::parse reads AC magnitude and phase on sources", "[netlist]") {
    auto circuit = Circuit::parse("V1 a 0 DC 0 AC 2 45\n");
    auto* v = dynamic_cast<VoltageSource*>(circuit.find("V1"));
    REQUIRE(v != nullptr);
    REQUIRE(v->ac_magnitude == 2.0);
    REQUIRE(v->ac_phase_deg == 45.0);
}

TEST_CASE("Circuit::parse supports the DC-keyword-optional shorthand for sources", "[netlist]") {
    auto circuit = Circuit::parse("V1 a 0 5\n");  // no "DC" keyword
    auto* v = dynamic_cast<VoltageSource*>(circuit.find("V1"));
    REQUIRE(v != nullptr);
    REQUIRE(v->dc_value == 5.0);
}

TEST_CASE("Circuit::parse rejects too few fields with a ParseError naming the line number", "[netlist]") {
    try {
        Circuit::parse("R1 a\n");
        FAIL("expected ParseError");
    } catch (const ParseError& e) {
        REQUIRE(e.line() == 1);
    }
}

TEST_CASE("Circuit::parse rejects an unrecognized component prefix", "[netlist]") {
    // Z isn't a component type (this used Q until I added the BJT)
    REQUIRE_THROWS_AS(Circuit::parse("Z1 a 0 1k\n"), ParseError);
}

TEST_CASE("Circuit::parse rejects zero or negative component values", "[netlist]") {
    REQUIRE_THROWS_AS(Circuit::parse("R1 a 0 0\n"), ParseError);
    REQUIRE_THROWS_AS(Circuit::parse("R1 a 0 -5\n"), ParseError);
    REQUIRE_THROWS_AS(Circuit::parse("C1 a 0 -1u\n"), ParseError);
}

TEST_CASE("Circuit::parse rejects a malformed numeric field with the offending line number", "[netlist]") {
    try {
        Circuit::parse(
            "R1 a b 1k\n"
            "R2 b 0 not_a_number\n");
        FAIL("expected ParseError");
    } catch (const ParseError& e) {
        REQUIRE(e.line() == 2);
    }
}
