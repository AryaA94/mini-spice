#pragma once
// netlist.hpp
//
// Parses a SPICE-style netlist into a Circuit (node table + components,
// with node names already turned into indices).
//
// Supported lines ('*' and '#' start comments):
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
//   Q<name> <collector> <base> <emitter> [IS=<value>] [BF=<value>] [BR=<value>] [TYPE=PNP]
//   E<name> <out+> <out-> <ctrl+> <ctrl-> <gain>
//   G<name> <out+> <out-> <ctrl+> <ctrl-> <transconductance>
//
// "0" or "gnd" is ground. Values take SPICE suffixes T G MEG K M U N P F
// (M is milli, MEG is mega) and ignore trailing letters, so "1kOhm" = 1000.

#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include "minispice/component.hpp"

namespace minispice {

// Bad netlist line. Includes the line number.
class ParseError : public std::runtime_error {
public:
    ParseError(int line_number, const std::string& message)
        : std::runtime_error("line " + std::to_string(line_number) + ": " + message), line_(line_number) {}
    int line() const noexcept { return line_; }

private:
    int line_;
};

// "4.7u" -> 4.7e-6, "2.2MEG" -> 2.2e6, etc. Public so it can be unit tested.
double parse_value(const std::string& token);

class Circuit {
public:
    static Circuit parse(const std::string& netlist_text);
    static Circuit parse_file(const std::string& path);

    std::size_t num_nodes() const { return node_names_.size(); }
    std::size_t num_extra_unknowns() const { return extra_unknowns_; }
    std::size_t system_size() const { return num_nodes() + num_extra_unknowns(); }

    // index -> node name, for error messages
    const std::vector<std::string>& node_names() const { return node_names_; }

    const std::vector<std::unique_ptr<Component>>& components() const { return components_; }
    std::vector<std::unique_ptr<Component>>& components() { return components_; }

    // True if there's a diode or BJT (AC needs a DC bias point first).
    bool has_nonlinear() const {
        for (auto& c : components_)
            if (c->is_nonlinear()) return true;
        return false;
    }

    Component* find(const std::string& name) const;

    // kGround for ground, throws std::out_of_range if the name doesn't exist
    int node_index(const std::string& name) const;

private:
    int resolve_node(const std::string& name);  // used only during parsing; creates new nodes as seen

    std::vector<std::string> node_names_;
    std::unordered_map<std::string, int> node_index_map_;
    std::vector<std::unique_ptr<Component>> components_;
    std::size_t extra_unknowns_ = 0;
};

}  // namespace minispice
