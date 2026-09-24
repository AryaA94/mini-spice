#!/usr/bin/env python3
"""
convergence_data.py -- drives the error-vs-timestep convergence plot
(examples/07_convergence/plot.png).

Runs examples/07_convergence/circuit.cir through the built `minispice` CLI
at several halved step sizes, measures the error against the closed-form RC
solution at a fixed evaluation time, and hands the (dt, error) table to
plot_results.py's `convergence` subcommand. This is the script-level
counterpart of tests/unit/test_convergence.cpp, which asserts the same
halving behavior as a pass/fail unit test; this one exists to draw the
picture for the README.
"""
import csv
import math
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BIN = ROOT / "build" / "default" / "minispice"
CIRCUIT = ROOT / "examples" / "07_convergence" / "circuit.cir"
OUT_DIR = ROOT / "examples" / "07_convergence"

R, C, Vs = 1000.0, 1e-6, 5.0
TAU = R * C
EVAL_TIME = 2e-3
DTS = [4e-5, 2e-5, 1e-5, 5e-6, 2.5e-6]


def run_once(dt):
    csv_path = OUT_DIR / f"_tmp_dt_{dt:.1e}.csv"
    subprocess.run(
        [str(BIN), "tran", str(CIRCUIT), "--dt", str(dt), "--stop", str(EVAL_TIME), "--csv", str(csv_path)],
        check=True, capture_output=True,
    )
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    last = rows[-1]
    sim = float(last["V(out)"])
    csv_path.unlink()  # scratch file, not part of the committed example
    analytic = Vs * (1.0 - math.exp(-EVAL_TIME / TAU))
    return abs(sim - analytic)


def main():
    if not BIN.exists():
        sys.exit(f"error: {BIN} not found -- build first")

    errors = [run_once(dt) for dt in DTS]
    for dt, err in zip(DTS, errors):
        print(f"dt={dt:.2e}  abs_error={err:.6e}")

    subprocess.run(
        [
            sys.executable, str(ROOT / "tools" / "plot_results.py"), "convergence",
            "--dts", *[str(d) for d in DTS],
            "--errors", *[str(e) for e in errors],
            "--title", "RC step response: error vs timestep at t=2ms",
            "--out", str(OUT_DIR / "plot.png"),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
