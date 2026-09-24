#pragma once
// mna_result.hpp
//
// DC, transient, and AC solves all produce the same shape of answer: a flat
// unknown vector laid out as [node voltages][voltage-source branch
// currents]. These helpers are the one place that knows that layout, so the
// three solvers -- and the CLI, and the tests -- read results by name
// ("what's V(out)?", "what's the current through V1?") instead of poking at
// raw indices.

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

// Turns a SingularMatrixError's row index into a human-readable diagnosis:
// a floating node ("row" is a node index) or an over-constrained voltage
// source ("row" is a branch-current index), per the MNA layout above.
std::string describe_singular_row(const Circuit& circuit, std::size_t row);

}  // namespace minispice
