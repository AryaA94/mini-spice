#include "minispice/netlist.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <optional>
#include <sstream>

namespace minispice {

namespace {

std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

std::vector<std::string> tokenize(const std::string& line) {
    std::istringstream iss(line);
    std::vector<std::string> tokens;
    std::string tok;
    while (iss >> tok) tokens.push_back(tok);
    return tokens;
}

bool is_ground_name(const std::string& name) {
    std::string lower = to_lower(name);
    return lower == "0" || lower == "gnd";
}

// Parses a SPICE-style "KEYWORD(v1 v2 ... vn)" clause that may span
// several whitespace-separated tokens (e.g. "PULSE(0" "5" "1m" ... "4m)").
// tokens[idx] must already start with keyword_lower + "(" (checked by the
// caller before calling this). Advances idx past the token containing the
// closing ')' and returns the parsed numeric values in order. Throws
// ParseError (citing component_name) if the closing ')' is never found.
std::vector<double> parse_parenthesized_values(const std::vector<std::string>& tokens, std::size_t& idx,
                                                const std::string& keyword_lower, int line_number,
                                                const std::string& component_name) {
    std::vector<std::string> parts;
    bool closed = false;
    auto consume = [&](const std::string& s) {
        auto close_pos = s.find(')');
        if (close_pos != std::string::npos) {
            if (close_pos > 0) parts.push_back(s.substr(0, close_pos));
            closed = true;
        } else if (!s.empty()) {
            parts.push_back(s);
        }
    };
    // First token has the "keyword(" prefix to strip (length = keyword + '(').
    consume(tokens[idx].substr(keyword_lower.size() + 1));
    ++idx;
    while (!closed) {
        if (idx >= tokens.size()) {
            throw ParseError(line_number, component_name + ": unterminated " + keyword_lower + "(...) -- missing ')'");
        }
        consume(tokens[idx]);
        ++idx;
    }
    std::vector<double> values;
    values.reserve(parts.size());
    for (auto& p : parts) values.push_back(parse_value(p));
    return values;
}

}  // namespace

double parse_value(const std::string& token) {
    if (token.empty()) {
        throw std::invalid_argument("empty numeric value");
    }
    const char* start = token.c_str();
    char* end = nullptr;
    double mantissa = std::strtod(start, &end);
    if (end == start) {
        throw std::invalid_argument("not a valid number: '" + token + "'");
    }
    std::string suffix = to_lower(std::string(end));

    double multiplier = 1.0;
    if (suffix.rfind("meg", 0) == 0) {
        multiplier = 1e6;
    } else if (!suffix.empty()) {
        switch (suffix[0]) {
            case 't': multiplier = 1e12; break;
            case 'g': multiplier = 1e9; break;
            case 'k': multiplier = 1e3; break;
            case 'm': multiplier = 1e-3; break;
            case 'u': multiplier = 1e-6; break;
            case 'n': multiplier = 1e-9; break;
            case 'p': multiplier = 1e-12; break;
            case 'f': multiplier = 1e-15; break;
            default: multiplier = 1.0; break;  // trailing unit label (ohm, F, H, V, A...) -- ignored
        }
    }
    return mantissa * multiplier;
}

int Circuit::resolve_node(const std::string& name) {
    if (is_ground_name(name)) return kGround;
    auto it = node_index_map_.find(name);
    if (it != node_index_map_.end()) return it->second;
    int idx = static_cast<int>(node_names_.size());
    node_names_.push_back(name);
    node_index_map_.emplace(name, idx);
    return idx;
}

int Circuit::node_index(const std::string& name) const {
    if (is_ground_name(name)) return kGround;
    auto it = node_index_map_.find(name);
    if (it == node_index_map_.end()) {
        throw std::out_of_range("no such node: '" + name + "'");
    }
    return it->second;
}

Component* Circuit::find(const std::string& name) const {
    for (auto& c : components_) {
        if (c->name() == name) return c.get();
    }
    return nullptr;
}

namespace {
// Parses "IC=<value>" (case-insensitive on "IC"). Returns std::nullopt if
// the token isn't an IC= specifier at all (so the caller can treat it as a
// parse error for that position instead of silently swallowing garbage).
std::optional<double> try_parse_ic(const std::string& token) {
    auto eq = token.find('=');
    if (eq == std::string::npos) return std::nullopt;
    std::string key = to_lower(token.substr(0, eq));
    if (key != "ic") return std::nullopt;
    return parse_value(token.substr(eq + 1));
}
}  // namespace

Circuit Circuit::parse(const std::string& netlist_text) {
    Circuit circuit;
    std::istringstream stream(netlist_text);
    std::string raw_line;
    int line_number = 0;

    while (std::getline(stream, raw_line)) {
        ++line_number;
        // Strip inline comments starting with '*' or '#' anywhere on the line.
        std::string line = raw_line;
        auto comment_pos = line.find_first_of("*#");
        if (comment_pos != std::string::npos) line = line.substr(0, comment_pos);

        std::vector<std::string> tokens = tokenize(line);
        if (tokens.empty()) continue;

        const std::string& name = tokens[0];
        char prefix = static_cast<char>(std::toupper(static_cast<unsigned char>(name[0])));

        try {
            // Every component needs at least "name node1 node2" (3
            // fields); a diode's IS/N are optional so it can stop there.
            // A BJT needs a 4th field (its third node, the emitter) but no
            // value field; everything else needs a 4th value field.
            std::size_t min_fields = (prefix == 'D') ? 3 : (prefix == 'E' || prefix == 'G') ? 6 : 4;
            if (tokens.size() < min_fields) {
                std::string shape = (prefix == 'D')                       ? "name node1 node2"
                                     : (prefix == 'Q')                     ? "name collector base emitter"
                                     : (prefix == 'E' || prefix == 'G')    ? "name out+ out- ctrl+ ctrl- gain"
                                                                           : "name node1 node2 value";
                throw ParseError(line_number,
                                  "expected at least " + std::to_string(min_fields) + " fields (" + shape + "), got " +
                                      std::to_string(tokens.size()));
            }
            int p = circuit.resolve_node(tokens[1]);
            int n = circuit.resolve_node(tokens[2]);

            switch (prefix) {
                case 'R': {
                    double value = parse_value(tokens[3]);
                    if (!(value > 0.0)) {
                        throw ParseError(line_number, "resistor '" + name + "' must have a positive resistance, got " + tokens[3]);
                    }
                    circuit.components_.push_back(std::make_unique<Resistor>(name, p, n, value));
                    break;
                }
                case 'C':
                case 'L': {
                    double value = parse_value(tokens[3]);
                    if (!(value > 0.0)) {
                        throw ParseError(line_number, std::string(prefix == 'C' ? "capacitor '" : "inductor '") + name +
                                                           "' must have a positive value, got " + tokens[3]);
                    }
                    double ic = 0.0;
                    if (tokens.size() >= 5) {
                        auto parsed_ic = try_parse_ic(tokens[4]);
                        if (!parsed_ic) {
                            throw ParseError(line_number, "expected 'IC=<value>' as the 5th field, got '" + tokens[4] + "'");
                        }
                        ic = *parsed_ic;
                    }
                    if (prefix == 'C') {
                        circuit.components_.push_back(std::make_unique<Capacitor>(name, p, n, value, ic));
                    } else {
                        circuit.components_.push_back(std::make_unique<Inductor>(name, p, n, value, ic));
                    }
                    break;
                }
                case 'V':
                case 'I': {
                    std::size_t idx = 3;
                    double dc_value = 0.0;
                    bool dc_explicit = false;
                    if (idx < tokens.size() && to_lower(tokens[idx]) == "dc") {
                        ++idx;
                        if (idx >= tokens.size()) {
                            throw ParseError(line_number, "missing DC value for '" + name + "'");
                        }
                        dc_value = parse_value(tokens[idx]);
                        dc_explicit = true;
                        ++idx;
                    }

                    // A transient waveform (PULSE/SIN) is optional and, if
                    // present, comes right after any "DC <value>" clause.
                    // If no DC value was given, its rest_value() (PULSE's
                    // V1, SIN's VO) becomes the DC operating point value --
                    // matching standard SPICE behavior for a source with an
                    // attached waveform and no separate DC spec.
                    Waveform waveform;
                    bool has_waveform = false;
                    if (idx < tokens.size()) {
                        std::string low = to_lower(tokens[idx]);
                        if (low.rfind("pulse(", 0) == 0) {
                            auto vals = parse_parenthesized_values(tokens, idx, "pulse", line_number, name);
                            if (vals.size() != 7) {
                                throw ParseError(line_number, "PULSE(...) for '" + name +
                                                                   "' needs exactly 7 values (V1 V2 TD TR TF PW PER), got " +
                                                                   std::to_string(vals.size()));
                            }
                            waveform.kind = Waveform::Kind::Pulse;
                            waveform.v1 = vals[0];
                            waveform.v2 = vals[1];
                            waveform.td = vals[2];
                            waveform.tr = vals[3];
                            waveform.tf = vals[4];
                            waveform.pw = vals[5];
                            waveform.per = vals[6];
                            if (waveform.tr < 0.0 || waveform.tf < 0.0 || waveform.pw < 0.0 || waveform.per < 0.0) {
                                throw ParseError(line_number, "PULSE(...) for '" + name + "' has a negative TR/TF/PW/PER");
                            }
                            has_waveform = true;
                        } else if (low.rfind("sin(", 0) == 0) {
                            auto vals = parse_parenthesized_values(tokens, idx, "sin", line_number, name);
                            if (vals.size() < 3 || vals.size() > 5) {
                                throw ParseError(line_number, "SIN(...) for '" + name +
                                                                   "' needs 3 to 5 values (VO VA FREQ [TD [THETA]]), got " +
                                                                   std::to_string(vals.size()));
                            }
                            waveform.kind = Waveform::Kind::Sine;
                            waveform.vo = vals[0];
                            waveform.va = vals[1];
                            waveform.freq = vals[2];
                            waveform.sin_td = vals.size() > 3 ? vals[3] : 0.0;
                            waveform.theta = vals.size() > 4 ? vals[4] : 0.0;
                            if (!(waveform.freq > 0.0)) {
                                throw ParseError(line_number, "SIN(...) for '" + name + "' needs a positive FREQ");
                            }
                            has_waveform = true;
                        } else if (!dc_explicit) {
                            // Shorthand: a bare number where DC would go,
                            // with no "DC" keyword (e.g. "V1 in 0 5").
                            dc_value = parse_value(tokens[idx]);
                            dc_explicit = true;
                            ++idx;
                        }
                    }
                    if (has_waveform && !dc_explicit) dc_value = waveform.rest_value();
                    if (!dc_explicit && !has_waveform) {
                        throw ParseError(line_number, "missing DC value for '" + name + "'");
                    }

                    double ac_mag = 0.0, ac_phase = 0.0;
                    if (idx < tokens.size() && to_lower(tokens[idx]) == "ac") {
                        ++idx;
                        if (idx >= tokens.size()) {
                            throw ParseError(line_number, "'AC' given with no magnitude for '" + name + "'");
                        }
                        ac_mag = parse_value(tokens[idx]);
                        ++idx;
                        if (idx < tokens.size()) {
                            ac_phase = parse_value(tokens[idx]);
                            ++idx;
                        }
                    }
                    if (prefix == 'V') {
                        auto src = std::make_unique<VoltageSource>(name, p, n, dc_value, ac_mag, ac_phase);
                        if (has_waveform) {
                            src->has_waveform = true;
                            src->waveform = waveform;
                        }
                        // Node discovery isn't finished until the whole file
                        // is parsed, so we can't know the final node count
                        // yet. Stash the *relative* ordinal among voltage
                        // sources here and fix it up to an absolute system
                        // index in a second pass below, once num_nodes() is
                        // final.
                        src->set_branch_index(static_cast<int>(circuit.extra_unknowns_));
                        circuit.extra_unknowns_ += 1;
                        circuit.components_.push_back(std::move(src));
                    } else {
                        auto src = std::make_unique<CurrentSource>(name, p, n, dc_value, ac_mag, ac_phase);
                        if (has_waveform) {
                            src->has_waveform = true;
                            src->waveform = waveform;
                        }
                        circuit.components_.push_back(std::move(src));
                    }
                    break;
                }
                case 'D': {
                    // D<name> <anode> <cathode> [IS=<val>] [N=<val>]
                    double is_sat = 1e-14;  // typical small-signal silicon diode saturation current
                    double ideality = 1.0;
                    for (std::size_t idx = 3; idx < tokens.size(); ++idx) {
                        auto eq = tokens[idx].find('=');
                        if (eq == std::string::npos) {
                            throw ParseError(line_number, "expected 'IS=<value>' or 'N=<value>' as field " + std::to_string(idx + 1) +
                                                               ", got '" + tokens[idx] + "'");
                        }
                        std::string key = to_lower(tokens[idx].substr(0, eq));
                        double value = parse_value(tokens[idx].substr(eq + 1));
                        if (key == "is") {
                            if (!(value > 0.0)) throw ParseError(line_number, "diode '" + name + "' IS must be positive");
                            is_sat = value;
                        } else if (key == "n") {
                            if (!(value > 0.0)) throw ParseError(line_number, "diode '" + name + "' N must be positive");
                            ideality = value;
                        } else {
                            throw ParseError(line_number, "unrecognized diode parameter '" + key + "' (expected IS or N)");
                        }
                    }
                    circuit.components_.push_back(std::make_unique<Diode>(name, p, n, is_sat, ideality));
                    break;
                }
                case 'Q': {
                    // Q<name> <collector> <base> <emitter> [IS=<val>] [BF=<val>] [BR=<val>] [TYPE=NPN|PNP]
                    // p/n from the generic pre-switch resolution are
                    // collector/base respectively; the emitter is this
                    // type's own third node.
                    if (tokens.size() < 4) {
                        throw ParseError(line_number, "BJT '" + name + "' needs a third node (the emitter)");
                    }
                    int emitter = circuit.resolve_node(tokens[3]);
                    double is_sat = 1e-16;  // SPICE's standard default BJT saturation current
                    double beta_f = 100.0;  // standard default forward gain
                    double beta_r = 1.0;    // standard default reverse gain
                    bool is_pnp = false;    // default NPN
                    for (std::size_t idx = 4; idx < tokens.size(); ++idx) {
                        auto eq = tokens[idx].find('=');
                        if (eq == std::string::npos) {
                            throw ParseError(line_number, "expected 'IS=', 'BF=', 'BR=', or 'TYPE=' as field " +
                                                               std::to_string(idx + 1) + ", got '" + tokens[idx] + "'");
                        }
                        std::string key = to_lower(tokens[idx].substr(0, eq));
                        std::string raw_value = tokens[idx].substr(eq + 1);
                        if (key == "type") {
                            std::string type_val = to_lower(raw_value);
                            if (type_val == "pnp") {
                                is_pnp = true;
                            } else if (type_val == "npn") {
                                is_pnp = false;
                            } else {
                                throw ParseError(line_number, "BJT '" + name + "' TYPE must be NPN or PNP, got '" + raw_value + "'");
                            }
                            continue;
                        }
                        double value = parse_value(raw_value);
                        if (key == "is") {
                            if (!(value > 0.0)) throw ParseError(line_number, "BJT '" + name + "' IS must be positive");
                            is_sat = value;
                        } else if (key == "bf") {
                            if (!(value > 0.0)) throw ParseError(line_number, "BJT '" + name + "' BF must be positive");
                            beta_f = value;
                        } else if (key == "br") {
                            if (!(value > 0.0)) throw ParseError(line_number, "BJT '" + name + "' BR must be positive");
                            beta_r = value;
                        } else {
                            throw ParseError(line_number,
                                              "unrecognized BJT parameter '" + key + "' (expected IS, BF, BR, or TYPE)");
                        }
                    }
                    circuit.components_.push_back(std::make_unique<Bjt>(name, p, n, emitter, is_sat, beta_f, beta_r, is_pnp));
                    break;
                }
                case 'E': {
                    // E<name> <out+> <out-> <ctrl+> <ctrl-> <gain>
                    int ctrl_p = circuit.resolve_node(tokens[3]);
                    int ctrl_n = circuit.resolve_node(tokens[4]);
                    double gain = parse_value(tokens[5]);
                    auto src = std::make_unique<Vcvs>(name, p, n, ctrl_p, ctrl_n, gain);
                    // Same relative-ordinal-now / fixed-up-later scheme as
                    // VoltageSource (see the second pass below) -- Vcvs
                    // also needs one extra unknown, and shares the same
                    // running counter so the two types' branch indices
                    // never collide.
                    src->set_branch_index(static_cast<int>(circuit.extra_unknowns_));
                    circuit.extra_unknowns_ += 1;
                    circuit.components_.push_back(std::move(src));
                    break;
                }
                case 'G': {
                    // G<name> <out+> <out-> <ctrl+> <ctrl-> <transconductance>
                    int ctrl_p = circuit.resolve_node(tokens[3]);
                    int ctrl_n = circuit.resolve_node(tokens[4]);
                    double gm = parse_value(tokens[5]);
                    circuit.components_.push_back(std::make_unique<Vccs>(name, p, n, ctrl_p, ctrl_n, gm));
                    break;
                }
                default:
                    throw ParseError(line_number, "unrecognized component prefix '" + std::string(1, prefix) + "' in '" + name + "'");
            }
        } catch (const ParseError&) {
            throw;
        } catch (const std::exception& e) {
            throw ParseError(line_number, e.what());
        }
    }

    // Second pass: node discovery is now complete (num_nodes() is final),
    // so convert every extra-unknown component's relative ordinal into its
    // true, absolute row/column index in the [node voltages | branch
    // currents] unknown vector. Generic across every component reporting
    // extra_unknowns() > 0 (currently VoltageSource and Vcvs), not
    // hardcoded to voltage sources specifically.
    const int base = static_cast<int>(circuit.num_nodes());
    for (auto& c : circuit.components_) {
        if (c->extra_unknowns() > 0) {
            c->set_branch_index(base + c->get_branch_index());
        }
    }

    return circuit;
}

Circuit Circuit::parse_file(const std::string& path) {
    std::ifstream file(path);
    if (!file) {
        throw std::runtime_error("could not open netlist file: " + path);
    }
    std::ostringstream contents;
    contents << file.rdbuf();
    return parse(contents.str());
}

}  // namespace minispice
