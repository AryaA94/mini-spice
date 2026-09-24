// A floating node or a shorted/conflicting voltage source must produce a
// clear, catchable error -- never a silent wrong answer and never a crash.
#include <string>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "minispice/dc_solver.hpp"
#include "minispice/matrix.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;
using Catch::Matchers::ContainsSubstring;

TEST_CASE("A node with no DC path to ground is reported as a clear floating-node error", "[edge-cases][floating-node]") {
    // "extra_a"/"extra_b" form an island with a resistor between them but no
    // connection anywhere else in the circuit -- genuinely floating.
    auto circuit = Circuit::parse(
        "V1 in 0 DC 5\n"
        "R1 in out 1k\n"
        "R2 out 0 1k\n"
        "R3 extra_a extra_b 1k\n");

    try {
        solve_dc(circuit);
        FAIL("expected SingularMatrixError for the floating island");
    } catch (const SingularMatrixError& e) {
        CAPTURE(std::string(e.what()));
        REQUIRE_THAT(std::string(e.what()), ContainsSubstring("floating node"));
    }
}

TEST_CASE("Two independent voltage sources forcing the same node to different voltages is reported clearly",
          "[edge-cases][shorted-source]") {
    auto circuit = Circuit::parse(
        "V1 a 0 DC 5\n"
        "V2 a 0 DC 3\n");  // conflicting constraints on the same node

    try {
        solve_dc(circuit);
        FAIL("expected SingularMatrixError for the conflicting voltage sources");
    } catch (const SingularMatrixError& e) {
        CAPTURE(std::string(e.what()));
        REQUIRE_THAT(std::string(e.what()), ContainsSubstring("over-constrained"));
    }
}

TEST_CASE("A floating node is also reported (not silently accepted) during a transient run", "[edge-cases][floating-node][transient]") {
    auto circuit = Circuit::parse(
        "V1 in 0 DC 5\n"
        "R1 in out 1k\n"
        "C1 out 0 1u\n"
        "R2 extra_a extra_b 1k\n");
    REQUIRE_THROWS_AS(solve_transient(circuit, 1e-5, 1e-3), SingularMatrixError);
}

TEST_CASE("solve_linear_system never returns a result for a singular system -- it always throws", "[edge-cases][matrix]") {
    Matrix<double> A(3, 3);  // all-zero matrix: every column is singular
    std::vector<double> b(3, 1.0);
    REQUIRE_THROWS_AS(solve_linear_system(A, b), SingularMatrixError);
}

TEST_CASE("Malformed netlist lines are rejected with the specific offending line number, not a crash", "[edge-cases][netlist]") {
    // Line 3 is missing its value field entirely.
    std::string bad =
        "V1 in 0 DC 5\n"
        "R1 in out 1k\n"
        "R2 out 0\n";
    try {
        Circuit::parse(bad);
        FAIL("expected ParseError");
    } catch (const ParseError& e) {
        REQUIRE(e.line() == 3);
    }
}

TEST_CASE("A netlist that parses cleanly but references a missing node in a lookup throws instead of crashing",
          "[edge-cases][netlist]") {
    auto circuit = Circuit::parse("R1 a 0 1k\n");
    REQUIRE_THROWS_AS(circuit.node_index("no_such_node"), std::out_of_range);
}
