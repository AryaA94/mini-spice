// Golden-file regression tests. Each tests/golden/<name>/ has a circuit and
// saved output from a known-good build. The correctness checks are in the
// unit tests; these just catch anything that changes the results later.
#include <cmath>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/ac_solver.hpp"
#include "minispice/dc_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;

namespace {

std::vector<std::vector<std::string>> read_csv(const std::string& path) {
    std::ifstream in(path);
    REQUIRE(in.good());
    std::vector<std::vector<std::string>> rows;
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        std::vector<std::string> cols;
        std::stringstream ss(line);
        std::string cell;
        while (std::getline(ss, cell, ',')) cols.push_back(cell);
        rows.push_back(cols);
    }
    return rows;
}

// Look columns up by name since the column order depends on node order.
std::size_t column_index(const std::vector<std::string>& header, const std::string& name) {
    for (std::size_t i = 0; i < header.size(); ++i) {
        if (header[i] == name) return i;
    }
    FAIL("golden CSV has no '" + name + "' column");
    return 0;
}

std::string golden(const std::string& relative) { return std::string(MINISPICE_GOLDEN_DIR) + "/" + relative; }

}  // namespace

TEST_CASE("Golden: RC step transient matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("rc_step/circuit.cir"));
    auto points = solve_transient(circuit, 1e-5, 5e-3);
    auto rows = read_csv(golden("rc_step/expected_transient.csv"));
    std::size_t out_col = column_index(rows[0], "V(out)");

    REQUIRE(points.size() == rows.size() - 1);  // rows[0] is the header
    for (std::size_t i = 0; i < points.size(); ++i) {
        REQUIRE_THAT(points[i].time, WithinAbs(std::stod(rows[i + 1][0]), 1e-12));
        REQUIRE_THAT(node_voltage(circuit, points[i].solution, "out"), WithinAbs(std::stod(rows[i + 1][out_col]), 1e-9));
    }
}

TEST_CASE("Golden: underdamped RLC transient matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("rlc_underdamped/circuit.cir"));
    auto points = solve_transient(circuit, 5e-3, 6.0);
    auto rows = read_csv(golden("rlc_underdamped/expected_transient.csv"));
    std::size_t out_col = column_index(rows[0], "V(out)");

    REQUIRE(points.size() == rows.size() - 1);
    for (std::size_t i = 0; i < points.size(); ++i) {
        REQUIRE_THAT(points[i].time, WithinAbs(std::stod(rows[i + 1][0]), 1e-9));
        REQUIRE_THAT(node_voltage(circuit, points[i].solution, "out"), WithinAbs(std::stod(rows[i + 1][out_col]), 1e-9));
    }
}

TEST_CASE("Golden: voltage divider DC operating point matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("divider_dc/circuit.cir"));
    auto solution = solve_dc(circuit);
    // expected_dc.txt is CLI output; just check the values we know are in it
    REQUIRE_THAT(node_voltage(circuit, solution, "in"), WithinAbs(10.0, 1e-9));
    REQUIRE_THAT(node_voltage(circuit, solution, "out"), WithinAbs(5.0, 1e-9));
    REQUIRE_THAT(source_current(circuit, solution, "V1"), WithinAbs(-0.005, 1e-9));
}

TEST_CASE("Golden: Wheatstone bridge DC operating point matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("wheatstone_dc/circuit.cir"));
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "a"), WithinAbs(6.0, 1e-9));
    REQUIRE_THAT(node_voltage(circuit, solution, "b"), WithinAbs(6.0, 1e-9));
}

TEST_CASE("Golden: diode+resistor DC operating point matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("diode_dc/circuit.cir"));
    auto solution = solve_dc(circuit);
    // (also checked against Lambert W and ngspice, see test_diode.cpp)
    REQUIRE_THAT(node_voltage(circuit, solution, "a"), WithinAbs(0.6928878327462407, 1e-6));
}

TEST_CASE("Golden: BJT fixed-bias DC operating point matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("bjt_dc/circuit.cir"));
    auto solution = solve_dc(circuit);
    // (also checked in test_bjt.cpp)
    REQUIRE_THAT(node_voltage(circuit, solution, "b1"), WithinAbs(0.8112793033, 1e-6));
    REQUIRE_THAT(node_voltage(circuit, solution, "col"), WithinAbs(5.8112793033, 1e-6));
}

TEST_CASE("Golden: PNP fixed-bias DC operating point matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("pnp_dc/circuit.cir"));
    auto solution = solve_dc(circuit);
    // mirror of the NPN case
    REQUIRE_THAT(node_voltage(circuit, solution, "b1"), WithinAbs(-0.8112793033, 1e-6));
    REQUIRE_THAT(node_voltage(circuit, solution, "col"), WithinAbs(-5.8112793033, 1e-6));
}

TEST_CASE("Golden: VCVS amplifier DC operating point matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("vcvs_dc/circuit.cir"));
    auto solution = solve_dc(circuit);
    REQUIRE_THAT(node_voltage(circuit, solution, "out"), WithinAbs(6.0, 1e-12));
}

TEST_CASE("Golden: repeated-PULSE transient matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("pulse_transient/circuit.cir"));
    auto points = solve_transient(circuit, 2e-5, 0.01);
    auto rows = read_csv(golden("pulse_transient/expected_transient.csv"));
    std::size_t out_col = column_index(rows[0], "V(out)");

    REQUIRE(points.size() == rows.size() - 1);
    for (std::size_t i = 0; i < points.size(); ++i) {
        REQUIRE_THAT(points[i].time, WithinAbs(std::stod(rows[i + 1][0]), 1e-12));
        REQUIRE_THAT(node_voltage(circuit, points[i].solution, "out"), WithinAbs(std::stod(rows[i + 1][out_col]), 1e-9));
    }
}

TEST_CASE("Golden: RC low-pass AC sweep matches its committed reference", "[golden]") {
    auto circuit = Circuit::parse_file(golden("rc_lpf_ac/circuit.cir"));
    auto points = solve_ac_sweep(circuit, 10, 1e6, 20);
    auto rows = read_csv(golden("rc_lpf_ac/expected_ac.csv"));
    std::size_t mag_col = column_index(rows[0], "V(out)_mag_db");
    std::size_t phase_col = column_index(rows[0], "V(out)_phase_deg");

    REQUIRE(points.size() == rows.size() - 1);
    for (std::size_t i = 0; i < points.size(); ++i) {
        // relative tolerance since the CSV only stores 10 digits
        REQUIRE_THAT(points[i].frequency_hz, Catch::Matchers::WithinRel(std::stod(rows[i + 1][0]), 1e-8));
        auto v = node_voltage_ac(circuit, points[i].solution, "out");
        double mag_db = 20.0 * std::log10(std::abs(v));
        double phase_deg = std::arg(v) * 180.0 / M_PI;
        REQUIRE_THAT(mag_db, WithinAbs(std::stod(rows[i + 1][mag_col]), 1e-6));
        REQUIRE_THAT(phase_deg, WithinAbs(std::stod(rows[i + 1][phase_col]), 1e-6));
    }
}
