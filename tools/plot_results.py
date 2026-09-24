#!/usr/bin/env python3
"""
plot_results.py - makes the plots in examples/ from the CLI's --csv output
(matplotlib).

Subcommands:
  transient   Plot one or more node voltages vs time, optionally overlaid
              with a dashed analytic curve (--analytic rc|rlc).
  bode        Plot magnitude (dB) and phase (deg) vs frequency, two stacked
              subplots, log-x, from an `ac --csv` output.
  convergence Plot error vs timestep on a log-log scale from a small table
              of (dt, error) pairs -- see tools/convergence_data.py.
"""
import argparse
import csv
import math
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def read_csv(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        rows = [row for row in reader]
    return rows


def analytic_rc(t, R, C, Vs):
    tau = R * C
    return Vs * (1.0 - math.exp(-t / tau))


def analytic_rlc(t, R, L, C, Vs):
    alpha = R / (2.0 * L)
    omega0 = 1.0 / math.sqrt(L * C)
    if alpha < omega0:
        omega_d = math.sqrt(omega0**2 - alpha**2)
        return Vs * (1.0 - math.exp(-alpha * t) * (math.cos(omega_d * t) + (alpha / omega_d) * math.sin(omega_d * t)))
    elif abs(alpha - omega0) < 1e-9 * omega0:
        return Vs * (1.0 - (1.0 + alpha * t) * math.exp(-alpha * t))
    else:
        disc = math.sqrt(alpha**2 - omega0**2)
        s1, s2 = -alpha + disc, -alpha - disc
        return Vs * (1.0 + (s2 * math.exp(s1 * t) - s1 * math.exp(s2 * t)) / (s1 - s2))


def cmd_transient(args):
    rows = read_csv(args.csv)
    t = [float(r["time"]) for r in rows]
    col = f"V({args.node})"
    if col not in rows[0]:
        sys.exit(f"error: column '{col}' not found; available: {list(rows[0].keys())}")
    v = [float(r[col]) for r in rows]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(t, v, label=f"mini-spice V({args.node})", color="#1f77b4", linewidth=1.8)

    if args.analytic == "rc":
        R, C, Vs = args.R, args.C, args.Vs
        analytic = [analytic_rc(ti, R, C, Vs) for ti in t]
        ax.plot(t, analytic, "--", label="analytic (closed form)", color="#d62728", linewidth=1.5)
    elif args.analytic == "rlc":
        R, L, C, Vs = args.R, args.L, args.C, args.Vs
        analytic = [analytic_rlc(ti, R, L, C, Vs) for ti in t]
        ax.plot(t, analytic, "--", label="analytic (closed form)", color="#d62728", linewidth=1.5)

    ax.set_xlabel("time (s)")
    ax.set_ylabel("voltage (V)")
    ax.set_title(args.title or f"Transient response: V({args.node})")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(args.out, dpi=150)
    print(f"wrote {args.out}")


def cmd_bode(args):
    rows = read_csv(args.csv)
    freq = [float(r["freq_hz"]) for r in rows]
    mag_col = f"V({args.node})_mag_db"
    phase_col = f"V({args.node})_phase_deg"
    mag = [float(r[mag_col]) for r in rows]
    phase = [float(r[phase_col]) for r in rows]

    fig, (ax_mag, ax_phase) = plt.subplots(2, 1, figsize=(8, 7), sharex=True)
    ax_mag.semilogx(freq, mag, color="#1f77b4", linewidth=1.8)
    ax_mag.axhline(-3.0103, color="#888888", linestyle=":", linewidth=1, label="-3 dB")
    ax_mag.set_ylabel("magnitude (dB)")
    ax_mag.set_title(args.title or f"Bode plot: V({args.node})")
    ax_mag.grid(True, which="both", alpha=0.3)
    ax_mag.legend()

    ax_phase.semilogx(freq, phase, color="#d62728", linewidth=1.8)
    ax_phase.set_xlabel("frequency (Hz)")
    ax_phase.set_ylabel("phase (deg)")
    ax_phase.grid(True, which="both", alpha=0.3)

    fig.tight_layout()
    fig.savefig(args.out, dpi=150)
    print(f"wrote {args.out}")


def cmd_convergence(args):
    dts = args.dts
    errors = args.errors
    if len(dts) != len(errors):
        sys.exit("error: --dts and --errors must have the same length")

    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    ax.loglog(dts, errors, "o-", color="#1f77b4", label="measured error", linewidth=1.8, markersize=6)

    # Reference slope-1 line anchored at the first point, to visually
    # confirm first-order convergence (backward Euler).
    ref = [errors[0] * (dt / dts[0]) for dt in dts]
    ax.loglog(dts, ref, "--", color="#888888", label="slope = 1 (first order)", linewidth=1.3)

    ax.set_xlabel("timestep dt (s)")
    ax.set_ylabel("absolute error vs analytic (V)")
    ax.set_title(args.title or "Backward-Euler convergence")
    ax.grid(True, which="both", alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(args.out, dpi=150)
    print(f"wrote {args.out}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_tran = sub.add_parser("transient", help="plot node voltage(s) vs time from a `tran --csv` file")
    p_tran.add_argument("csv")
    p_tran.add_argument("--node", default="out")
    p_tran.add_argument("--out", required=True)
    p_tran.add_argument("--title")
    p_tran.add_argument("--analytic", choices=["rc", "rlc"], help="overlay a dashed closed-form curve")
    p_tran.add_argument("--R", type=float)
    p_tran.add_argument("--L", type=float)
    p_tran.add_argument("--C", type=float)
    p_tran.add_argument("--Vs", type=float)
    p_tran.set_defaults(func=cmd_transient)

    p_bode = sub.add_parser("bode", help="plot a Bode magnitude+phase pair from an `ac --csv` file")
    p_bode.add_argument("csv")
    p_bode.add_argument("--node", default="out")
    p_bode.add_argument("--out", required=True)
    p_bode.add_argument("--title")
    p_bode.set_defaults(func=cmd_bode)

    p_conv = sub.add_parser("convergence", help="plot error-vs-timestep on log-log axes")
    p_conv.add_argument("--dts", type=float, nargs="+", required=True)
    p_conv.add_argument("--errors", type=float, nargs="+", required=True)
    p_conv.add_argument("--out", required=True)
    p_conv.add_argument("--title")
    p_conv.set_defaults(func=cmd_convergence)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
