// mini-spice CLI
//
// Usage:
//   minispice dc <netlist>
//   minispice tran <netlist> --dt <seconds> --stop <seconds> [--csv <path>]
//   minispice ac <netlist> --start <hz> --stop <hz> --ppd <points_per_decade> [--csv <path>]
//
// `dc` prints a table to stdout. `tran` and `ac` print a summary and, with
// --csv, write every node voltage (and voltage-source current, for tran) to
// a CSV file that tools/plot_results.py turns into the plots in examples/.

#include <algorithm>
#include <cmath>
#include <complex>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "minispice/ac_solver.hpp"
#include "minispice/dc_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;

namespace {

void print_usage() {
    std::cerr << "usage:\n"
              << "  minispice dc <netlist>\n"
              << "  minispice tran <netlist> --dt <seconds> --stop <seconds> [--csv <path>]\n"
              << "  minispice ac <netlist> --start <hz> --stop <hz> --ppd <points_per_decade> [--csv <path>]\n";
}

// Extremely small flag parser: looks for "--name value" pairs in argv.
// Good enough for a CLI with five total flags across two subcommands.
std::string get_flag(const std::vector<std::string>& args, const std::string& flag, const std::string& fallback = "") {
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == flag) return args[i + 1];
    }
    return fallback;
}
int run_dc(const Circuit& circuit) {
    std::vector<double> solution;
    try {
        solution = solve_dc(circuit);
    } catch (const std::exception& e) {
        std::cerr << "DC solve failed: " << e.what() << "\n";
        return 1;
    }

    std::cout << std::fixed << std::setprecision(6);
    std::cout << "Node voltages:\n";
    for (auto& name : circuit.node_names()) {
        std::cout << "  V(" << name << ") = " << node_voltage(circuit, solution, name) << " V\n";
    }
    std::cout << "Voltage source currents:\n";
    for (auto& c : circuit.components()) {
        if (dynamic_cast<VoltageSource*>(c.get())) {
            std::cout << "  I(" << c->name() << ") = " << source_current(circuit, solution, c->name()) << " A\n";
        }
    }
    return 0;
}

int run_tran(const Circuit& circuit, const std::vector<std::string>& args) {
    double dt = std::stod(get_flag(args, "--dt", "0"));
    double stop = std::stod(get_flag(args, "--stop", "0"));
    std::string csv_path = get_flag(args, "--csv");

    std::vector<TransientPoint> points;
    try {
        points = solve_transient(circuit, dt, stop);
    } catch (const std::exception& e) {
        std::cerr << "Transient solve failed: " << e.what() << "\n";
        return 1;
    }

    std::cout << points.size() << " timesteps from t=0 to t=" << stop << "s (dt=" << dt << "s)\n";

    if (!csv_path.empty()) {
        std::ofstream out(csv_path);
        out << "time";
        for (auto& name : circuit.node_names()) out << ",V(" << name << ")";
        for (auto& c : circuit.components())
            if (dynamic_cast<VoltageSource*>(c.get())) out << ",I(" << c->name() << ")";
        out << "\n";

        out << std::setprecision(10);
        for (auto& p : points) {
            out << p.time;
            for (auto& name : circuit.node_names()) out << "," << node_voltage(circuit, p.solution, name);
            for (auto& c : circuit.components())
                if (dynamic_cast<VoltageSource*>(c.get())) out << "," << source_current(circuit, p.solution, c->name());
            out << "\n";
        }
        std::cout << "wrote " << csv_path << "\n";
    }
    return 0;
}

int run_ac(const Circuit& circuit, const std::vector<std::string>& args) {
    double start = std::stod(get_flag(args, "--start", "0"));
    double stop = std::stod(get_flag(args, "--stop", "0"));
    int ppd = std::stoi(get_flag(args, "--ppd", "0"));
    std::string csv_path = get_flag(args, "--csv");

    std::vector<AcPoint> points;
    try {
        points = solve_ac_sweep(circuit, start, stop, ppd);
    } catch (const std::exception& e) {
        std::cerr << "AC solve failed: " << e.what() << "\n";
        return 1;
    }

    std::cout << points.size() << " frequency points from " << start << " Hz to " << stop << " Hz\n";

    if (!csv_path.empty()) {
        std::ofstream out(csv_path);
        out << "freq_hz";
        for (auto& name : circuit.node_names()) out << ",V(" << name << ")_mag_db,V(" << name << ")_phase_deg";
        out << "\n";

        out << std::setprecision(10);
        for (auto& p : points) {
            out << p.frequency_hz;
            for (auto& name : circuit.node_names()) {
                std::complex<double> v = node_voltage_ac(circuit, p.solution, name);
                double mag_db = 20.0 * std::log10(std::max(std::abs(v), 1e-300));
                double phase_deg = std::arg(v) * 180.0 / M_PI;
                out << "," << mag_db << "," << phase_deg;
            }
            out << "\n";
        }
        std::cout << "wrote " << csv_path << "\n";
    }
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        print_usage();
        return 1;
    }
    std::string command = argv[1];
    std::string netlist_path = argv[2];
    std::vector<std::string> rest(argv + 3, argv + argc);

    Circuit circuit;
    try {
        circuit = Circuit::parse_file(netlist_path);
    } catch (const std::exception& e) {
        std::cerr << "Failed to parse '" << netlist_path << "': " << e.what() << "\n";
        return 1;
    }

    if (command == "dc") return run_dc(circuit);
    if (command == "tran") return run_tran(circuit, rest);
    if (command == "ac") return run_ac(circuit, rest);

    print_usage();
    return 1;
}
