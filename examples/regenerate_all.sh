#!/usr/bin/env bash
# Regenerates every CSV and PNG in examples/ from its circuit.cir, using the
# built `minispice` CLI and tools/plot_results.py. Run this after building
# (see the top-level README's three-command quickstart) to reproduce every
# plot in this directory from scratch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/build/default/minispice"
PLOT="$ROOT/tools/plot_results.py"

if [ ! -x "$BIN" ]; then
    echo "error: $BIN not found -- build first (cmake --preset default && cmake --build build/default)" >&2
    exit 1
fi

cd "$ROOT/examples"

echo "== 01_voltage_divider (DC, no plot -- see README table) =="
"$BIN" dc 01_voltage_divider/circuit.cir

echo "== 02_wheatstone_bridge (DC, no plot -- see README table) =="
"$BIN" dc 02_wheatstone_bridge/circuit.cir

echo "== 03_rc_step =="
"$BIN" tran 03_rc_step/circuit.cir --dt 1e-5 --stop 5e-3 --csv 03_rc_step/transient.csv
python3 "$PLOT" transient 03_rc_step/transient.csv --node out \
    --title "RC step response (tau = 1ms)" \
    --analytic rc --R 1000 --C 1e-6 --Vs 5 \
    --out 03_rc_step/plot.png

echo "== 04_rlc_underdamped =="
"$BIN" tran 04_rlc_underdamped/circuit.cir --dt 2e-6 --stop 3e-3 --csv 04_rlc_underdamped/transient.csv
python3 "$PLOT" transient 04_rlc_underdamped/transient.csv --node out \
    --title "Underdamped series RLC step response" \
    --analytic rlc --R 50 --L 10e-3 --C 1e-6 --Vs 5 \
    --out 04_rlc_underdamped/plot.png

echo "== 05_rlc_overdamped =="
"$BIN" tran 05_rlc_overdamped/circuit.cir --dt 2e-6 --stop 3e-3 --csv 05_rlc_overdamped/transient.csv
python3 "$PLOT" transient 05_rlc_overdamped/transient.csv --node out \
    --title "Overdamped series RLC step response" \
    --analytic rlc --R 2000 --L 10e-3 --C 1e-6 --Vs 5 \
    --out 05_rlc_overdamped/plot.png

echo "== 06_rc_lowpass_bode =="
"$BIN" ac 06_rc_lowpass_bode/circuit.cir --start 10 --stop 1e6 --ppd 20 --csv 06_rc_lowpass_bode/ac.csv
python3 "$PLOT" bode 06_rc_lowpass_bode/ac.csv --node out \
    --title "RC low-pass Bode plot (fc = 1591.5 Hz)" \
    --out 06_rc_lowpass_bode/plot.png

echo "== 07_convergence =="
python3 "$ROOT/tools/convergence_data.py"

echo "done."
