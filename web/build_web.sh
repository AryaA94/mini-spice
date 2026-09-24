#!/usr/bin/env bash
# web/build_web.sh
#
# Compiles the C++ engine to WASM and glues it together with the UI
# (head_and_ui_start.html + ui_logic.js) into dist/mini-spice-web.html.
#
# Needs Emscripten:
#   git clone https://github.com/emscripten-core/emsdk.git
#   cd emsdk && ./emsdk install latest && ./emsdk activate latest
#   source ./emsdk_env.sh
#
# Use em++, not emcc: newer versions of emcc don't link the C++ standard
# library and fail with "undefined C++ symbols".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/web"
BUILD="$WEB/_wasm_build"
DIST="$WEB/dist"

if ! command -v em++ &> /dev/null; then
    echo "error: em++ not found on PATH. See the comment at the top of this script." >&2
    exit 1
fi

mkdir -p "$BUILD" "$DIST"
rm -rf "$BUILD"/*
cp -r "$ROOT/include" "$BUILD/"
cp -r "$ROOT/src" "$BUILD/"

cat > "$BUILD/wasm_bindings.cpp" << 'CPPEOF'
// JS-callable wrappers. Each takes netlist text and returns
// "OK\n<csv>" or "ERROR: <message>".
#include <algorithm>
#include <cmath>
#include <complex>
#include <sstream>
#include <string>

#include <emscripten/emscripten.h>

#include "minispice/ac_solver.hpp"
#include "minispice/dc_solver.hpp"
#include "minispice/mna_result.hpp"
#include "minispice/netlist.hpp"
#include "minispice/transient_solver.hpp"

using namespace minispice;

namespace {
std::string g_buffer;  // JS copies the string out right away, so reusing this is fine
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
const char* ms_run_dc(const char* netlist) {
    try {
        Circuit circuit = Circuit::parse(netlist);
        auto solution = solve_dc(circuit);
        std::ostringstream out;
        out << "OK\n";
        for (auto& name : circuit.node_names()) {
            out << "V," << name << "," << node_voltage(circuit, solution, name) << "\n";
        }
        for (auto& c : circuit.components()) {
            if (dynamic_cast<VoltageSource*>(c.get())) {
                out << "I," << c->name() << "," << source_current(circuit, solution, c->name()) << "\n";
            }
        }
        g_buffer = out.str();
    } catch (const std::exception& e) {
        g_buffer = std::string("ERROR: ") + e.what();
    }
    return g_buffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* ms_run_transient(const char* netlist, double dt, double stop) {
    try {
        Circuit circuit = Circuit::parse(netlist);
        auto points = solve_transient(circuit, dt, stop);
        std::ostringstream out;
        out << "OK\ntime";
        for (auto& name : circuit.node_names()) out << ",V(" << name << ")";
        for (auto& c : circuit.components())
            if (dynamic_cast<VoltageSource*>(c.get())) out << ",I(" << c->name() << ")";
        out << "\n";
        for (auto& p : points) {
            out << p.time;
            for (auto& name : circuit.node_names()) out << "," << node_voltage(circuit, p.solution, name);
            for (auto& c : circuit.components())
                if (dynamic_cast<VoltageSource*>(c.get())) out << "," << source_current(circuit, p.solution, c->name());
            out << "\n";
        }
        g_buffer = out.str();
    } catch (const std::exception& e) {
        g_buffer = std::string("ERROR: ") + e.what();
    }
    return g_buffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* ms_run_ac(const char* netlist, double start, double stop, int ppd) {
    try {
        Circuit circuit = Circuit::parse(netlist);
        auto points = solve_ac_sweep(circuit, start, stop, ppd);
        std::ostringstream out;
        out << "OK\nfreq_hz";
        for (auto& name : circuit.node_names()) out << ",V(" << name << ")_mag_db,V(" << name << ")_phase_deg";
        out << "\n";
        for (auto& p : points) {
            out << p.frequency_hz;
            for (auto& name : circuit.node_names()) {
                auto v = node_voltage_ac(circuit, p.solution, name);
                double mag_db = 20.0 * std::log10(std::max(std::abs(v), 1e-300));
                double phase_deg = std::arg(v) * 180.0 / M_PI;
                out << "," << mag_db << "," << phase_deg;
            }
            out << "\n";
        }
        g_buffer = out.str();
    } catch (const std::exception& e) {
        g_buffer = std::string("ERROR: ") + e.what();
    }
    return g_buffer.c_str();
}

}  // extern "C"
CPPEOF

# SINGLE_FILE_BINARY_ENCODE=0 embeds the wasm as base64. The newer default
# puts raw bytes (including NULs) in the <script>, and browsers can mangle those.
echo "== Compiling to WASM =="
cd "$BUILD"
em++ -std=c++20 -O2 -fexceptions \
  -I include \
  src/component.cpp src/netlist.cpp src/mna_result.cpp src/dc_solver.cpp src/transient_solver.cpp src/ac_solver.cpp wasm_bindings.cpp \
  -o minispice_wasm.js \
  -s MODULARIZE=1 -s EXPORT_NAME=MiniSpiceModule \
  -s EXPORTED_FUNCTIONS="['_ms_run_dc','_ms_run_transient','_ms_run_ac']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s SINGLE_FILE=1 \
  -s SINGLE_FILE_BINARY_ENCODE=0 \
  -s ENVIRONMENT=web \
  -s DISABLE_EXCEPTION_CATCHING=0 \
  --no-entry

echo "== Assembling final HTML =="
cat "$WEB/head_and_ui_start.html" "$BUILD/minispice_wasm.js" "$WEB/ui_logic.js" > "$DIST/mini-spice-web.html"
echo "</script></body></html>" >> "$DIST/mini-spice-web.html"

echo "done: $DIST/mini-spice-web.html ($(wc -c < "$DIST/mini-spice-web.html") bytes)"
