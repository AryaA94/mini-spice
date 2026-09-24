#pragma once
// mna_result.hpp
//
// Solutions are laid out as [node voltages][branch currents]. These helpers
// look values up by name so nothing else has to know the layout.

#include <complex>
#include <string>
#include <vector>

#include "minispice/netlist.hpp"

namespace minispice {

double node_voltage(const Circuit& circuit, const std::vector<double>& solution, const std::string& node_name);
double source_current(const Circuit& circuit, const std::vector<double>& solution, const std::string& source_name);

std::complex<double> node_voltage_ac(const Circuit& circuit, const std::vector<std::complex<double>>& solution,
                                      const std::string& node_name);
std::complex<double> source_current_ac(const Circuit& circuit, const std::vector<std::complex<double>>& solution,
                                        const std::string& source_name);

// Turns a singular row index into an error message: floating node or
// over-constrained voltage source.
std::string describe_singular_row(const Circuit& circuit, std::size_t row);

}  // namespace minispice
