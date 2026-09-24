#include "minispice/mna_result.hpp"

#include <stdexcept>

namespace minispice {

double node_voltage(const Circuit& circuit, const std::vector<double>& solution, const std::string& node_name) {
    int idx = circuit.node_index(node_name);
    if (idx == kGround) return 0.0;
    return solution[static_cast<std::size_t>(idx)];
}

double source_current(const Circuit& circuit, const std::vector<double>& solution, const std::string& source_name) {
    auto* comp = circuit.find(source_name);
    if (!comp) throw std::invalid_argument("no such component: '" + source_name + "'");
    auto* vs = dynamic_cast<VoltageSource*>(comp);
    if (!vs) throw std::invalid_argument("'" + source_name + "' is not a voltage source; only voltage sources have a directly-solved branch current");
    return solution[static_cast<std::size_t>(vs->branch_index)];
}

std::complex<double> node_voltage_ac(const Circuit& circuit, const std::vector<std::complex<double>>& solution,
                                      const std::string& node_name) {
    int idx = circuit.node_index(node_name);
    if (idx == kGround) return {0.0, 0.0};
    return solution[static_cast<std::size_t>(idx)];
}

std::complex<double> source_current_ac(const Circuit& circuit, const std::vector<std::complex<double>>& solution,
                                        const std::string& source_name) {
    auto* comp = circuit.find(source_name);
    if (!comp) throw std::invalid_argument("no such component: '" + source_name + "'");
    auto* vs = dynamic_cast<VoltageSource*>(comp);
    if (!vs) throw std::invalid_argument("'" + source_name + "' is not a voltage source");
    return solution[static_cast<std::size_t>(vs->branch_index)];
}

std::string describe_singular_row(const Circuit& circuit, std::size_t row) {
    if (row < circuit.num_nodes()) {
        return "floating node '" + circuit.node_names()[row] +
               "': it has no DC-connected path to ground (check for a missing return path, e.g. a resistor to node 0)";
    }
    for (auto& c : circuit.components()) {
        if (auto* vs = dynamic_cast<VoltageSource*>(c.get())) {
            if (static_cast<std::size_t>(vs->branch_index) == row) {
                return "voltage source '" + vs->name() +
                       "' is over-constrained: it is likely shorted to, or conflicts with, another voltage source on the same node(s)";
            }
        }
    }
    return "singular system at row " + std::to_string(row) + " (unrecognized cause)";
}

}  // namespace minispice
