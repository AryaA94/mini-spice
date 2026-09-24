#pragma once
// netlist.hpp
//
// Parses a small SPICE-style netlist dialect into a Circuit: a node-name
// table plus a list of Component objects, with every component's node
// references already resolved to integer indices (ground == kGround).
//
// Supported lines (one component per line; '*' and '#' start comments;
// blank lines ignored; tokens are whitespace-separated):
//
//   R<name> <n1> <n2> <value>
//   C<name> <n1> <n2> <value> [IC=<value>]
//   L<name> <n1> <n2> <value> [IC=<value>]
//   V<name> <n1> <n2> [DC] <value> [AC <mag> [<phase_deg>]]
//   V<name> <n1> <n2> [DC <value>] PULSE(V1 V2 TD TR TF PW PER) [AC <mag> [<phase_deg>]]
//   V<name> <n1> <n2> [DC <value>] SIN(VO VA FREQ [TD [THETA]]) [AC <mag> [<phase_deg>]]
//   I<name> <n1> <n2> [DC] <value> [AC <mag> [<phase_deg>]]
//   (I<name> accepts the same PULSE(...)/SIN(...) forms as V<name>)
//   D<name> <anode> <cathode> [IS=<value>] [N=<value>]
//   Q<name> <collector> <base> <emitter> [IS=<value>] [BF=<value>] [BR=<value>]
//   E<name> <out+> <out-> <ctrl+> <ctrl-> <gain>
//   G<name> <out+> <out-> <ctrl+> <ctrl-> <transconductance>
//
// Node "0" (also "gnd"/"GND") is ground. Values accept SPICE-style unit
// suffixes: T G MEG K M U N P F (case-insensitive; MEG must be spelled out
// to distinguish mega from milli), plus plain scientific notation, and
// ignore any further trailing unit letters (so "1kOhm" and "1k" both parse
// as 1000).

#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include "minispice/component.hpp"

namespace minispice {

// Thrown for any malformed netlist line. Carries the 1-based line number so
// the CLI/tests can report "line N: <reason>" instead of a crash.
class ParseError : public std::runtime_error {
public:
    ParseError(int line_number, const std::string& message)
        : std::runtime_error("line " + std::to_string(line_number) + ": " + message), line_(line_number) {}
    int line() const noexcept { return line_; }

private:
    int line_;
};

// Parses a single value token (e.g. "4.7u", "1k", "2.2MEG", "1e-6") into
// its numeric value. Exposed standalone so unit tests can pin down the
// suffix table directly, without going through a whole netlist.
double parse_value(const std::string& token);

class Circuit {
public:
    static Circuit parse(const std::string& netlist_text);
    static Circuit parse_file(const std::string& path);

    std::size_t num_nodes() const { return node_names_.size(); }
    std::size_t num_extra_unknowns() const { return extra_unknowns_; }
    std::size_t system_size() const { return num_nodes() + num_extra_unknowns(); }

    // index -> node name, for reporting (e.g. "node 3 (n_out) is floating").
    const std::vector<std::string>& node_names() const { return node_names_; }

    const std::vector<std::unique_ptr<Component>>& components() const { return components_; }
    std::vector<std::unique_ptr<Component>>& components() { return components_; }

    // True if any component (currently: Diode) needs Newton-Raphson
    // iteration rather than a single linear solve. Solvers use this to
    // keep the original single-solve fast path for purely linear circuits.
    bool has_nonlinear() const {
        for (auto& c : components_)
            if (c->is_nonlinear()) return true;
        return false;
    }

    Component* find(const std::string& name) const;

    // node index (>=0) for "the voltage at node X" -- returns kGround (-1)
    // for the ground node, throws std::out_of_range for an unknown name.
    int node_index(const std::string& name) const;

private:
    int resolve_node(const std::string& name);  // used only during parsing; creates new nodes as seen

    std::vector<std::string> node_names_;
    std::unordered_map<std::string, int> node_index_map_;
    std::vector<std::unique_ptr<Component>> components_;
    std::size_t extra_unknowns_ = 0;
};

}  // namespace minispice
