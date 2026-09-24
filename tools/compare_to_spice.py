#!/usr/bin/env python3
"""
compare_to_spice.py - runs the same netlists through mini-spice and ngspice
and prints a table of percent errors.

Needs ngspice installed (apt install ngspice).

Two things to watch out for:
  1. ngspice starts transients from the DC operating point unless you pass
     UIC, while mini-spice starts from IC=0. So every .tran here uses UIC.
  2. ngspice uses adaptive time steps, so its points don't line up with
     mini-spice's. Both traces get interpolated at the same checkpoint times.

Usage: python3 tools/compare_to_spice.py
"""
import csv
import math
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BIN = ROOT / "build" / "default" / "minispice"


def require_tools():
    if not BIN.exists():
        sys.exit(f"error: {BIN} not found -- build first (cmake --preset default && cmake --build build/default)")
    if shutil.which("ngspice") is None:
        sys.exit("error: ngspice not found on PATH -- install it (e.g. `apt install ngspice`) to cross-validate")


def run_minispice_dc(circuit_path):
    out = subprocess.run([str(BIN), "dc", str(circuit_path)], check=True, capture_output=True, text=True).stdout
    voltages = {}
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("V(") and "=" in line:
            name = line[2:line.index(")")]
            value = float(line.split("=")[1].strip().split()[0])
            voltages[name] = value
    return voltages


def run_ngspice_dc(circuit_text, nodes):
    prints = " ".join(f"v({n})" for n in nodes)
    deck = f"DC operating point cross-check\n{circuit_text}\n.control\nop\nprint {prints}\n.endc\n.end\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(deck)
        path = f.name
    out = subprocess.run(["ngspice", "-b", path], check=True, capture_output=True, text=True).stdout
    pathlib.Path(path).unlink()
    voltages = {}
    for line in out.splitlines():
        line = line.strip()
        for n in nodes:
            if line.lower().startswith(f"v({n.lower()})") and "=" in line:
                voltages[n] = float(line.split("=")[1].strip())
    return voltages


def run_ngspice_dc_with_model(circuit_text, model_lines, nodes):
    """Like run_ngspice_dc, but with extra .model lines inserted before
    .control (needed for the diode, whose D1 line names a model ngspice
    must be given -- mini-spice's D line carries IS/N inline instead)."""
    prints = " ".join(f"v({n})" for n in nodes)
    deck = f"DC operating point cross-check (with model)\n{circuit_text}\n{model_lines}\n.control\nop\nprint {prints}\n.endc\n.end\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(deck)
        path = f.name
    out = subprocess.run(["ngspice", "-b", path], check=True, capture_output=True, text=True).stdout
    pathlib.Path(path).unlink()
    voltages = {}
    for line in out.splitlines():
        line = line.strip()
        for n in nodes:
            if line.lower().startswith(f"v({n.lower()})") and "=" in line:
                voltages[n] = float(line.split("=")[1].strip())
    return voltages


def run_ngspice_tran(circuit_text, dt, stop, node):
    deck = f"Transient cross-check\n{circuit_text}\n.control\ntran {dt} {stop} UIC\nwrdata /tmp/_ns_tran_out.csv v({node})\n.endc\n.end\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(deck)
        path = f.name
    subprocess.run(["ngspice", "-b", path], check=True, capture_output=True, text=True)
    pathlib.Path(path).unlink()
    times, values = [], []
    with open("/tmp/_ns_tran_out.csv") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2:
                times.append(float(parts[0]))
                values.append(float(parts[1]))
    return times, values


def interp(times, values, t_query):
    if t_query <= times[0]:
        return values[0]
    if t_query >= times[-1]:
        return values[-1]
    for i in range(1, len(times)):
        if times[i] >= t_query:
            t0, t1 = times[i - 1], times[i]
            v0, v1 = values[i - 1], values[i]
            frac = (t_query - t0) / (t1 - t0) if t1 != t0 else 0.0
            return v0 + frac * (v1 - v0)
    return values[-1]


def run_minispice_tran(circuit_path, dt, stop, node):
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
        csv_path = f.name
    subprocess.run([str(BIN), "tran", str(circuit_path), "--dt", str(dt), "--stop", str(stop), "--csv", csv_path],
                    check=True, capture_output=True)
    rows = list(csv.DictReader(open(csv_path)))
    pathlib.Path(csv_path).unlink()
    return [float(r["time"]) for r in rows], [float(r[f"V({node})"]) for r in rows]


def run_ngspice_ac(circuit_text, start, stop, ppd, node, with_phase=False):
    deck = f"AC cross-check\n{circuit_text}\n.control\nac dec {ppd} {start} {stop}\nwrdata /tmp/_ns_ac_out.csv db(v({node})) cph(v({node}))\n.endc\n.end\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(deck)
        path = f.name
    subprocess.run(["ngspice", "-b", path], check=True, capture_output=True, text=True)
    pathlib.Path(path).unlink()
    # wrdata writes "freq db freq cph" per row; cph is in radians.
    freqs, mags, phases = [], [], []
    with open("/tmp/_ns_ac_out.csv") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 4:
                freqs.append(float(parts[0]))
                mags.append(float(parts[1]))
                phases.append(math.degrees(float(parts[3])))
    return (freqs, mags, phases) if with_phase else (freqs, mags)


def pct_error(sim, ref):
    if abs(ref) < 1e-12:
        return abs(sim - ref)  # absolute, since relative is undefined near zero
    return 100.0 * abs(sim - ref) / abs(ref)


def main():
    require_tools()
    rows = []  # (case, quantity, minispice, ngspice, pct_err)

    # --- DC cases -----------------------------------------------------
    for name, path in [("Voltage divider V(out)", "01_voltage_divider"), ("Wheatstone bridge V(a)", "02_wheatstone_bridge")]:
        circuit_path = ROOT / "examples" / path / "circuit.cir"
        circuit_text = circuit_path.read_text()
        ms = run_minispice_dc(circuit_path)
        node = "out" if "divider" in name else "a"
        ns = run_ngspice_dc(circuit_text, [node])
        rows.append((name, f"V({node})", ms[node], ns[node], pct_error(ms[node], ns[node])))

    # --- Diode DC case (needs a .model card for ngspice) --------------
    diode_circuit_path = ROOT / "examples" / "08_diode_clipper" / "circuit.cir"
    diode_circuit_text = diode_circuit_path.read_text()
    ms_diode = run_minispice_dc(diode_circuit_path)
    ns_diode = run_ngspice_dc_with_model(
        diode_circuit_text.replace("D1 a 0", "D1 a 0 mydiode"),
        ".model mydiode D(IS=1e-14 N=1)",
        ["a"],
    )
    rows.append(("Diode+resistor V(a)", "V(a)", ms_diode["a"], ns_diode["a"], pct_error(ms_diode["a"], ns_diode["a"])))

    # --- BJT DC cases (need a .model card for ngspice) -----------------
    bjt_circuit_path = ROOT / "examples" / "09_bjt_fixed_bias" / "circuit.cir"
    bjt_circuit_text = bjt_circuit_path.read_text()
    ms_bjt = run_minispice_dc(bjt_circuit_path)
    ns_bjt = run_ngspice_dc_with_model(
        bjt_circuit_text.replace("Q1 col b1 0 IS=1e-16 BF=100 BR=1", "Q1 col b1 0 mynpn"),
        ".model mynpn NPN(IS=1e-16 BF=100 BR=1)",
        ["b1", "col"],
    )
    rows.append(("BJT fixed-bias V(b1)=Vbe", "V(b1)", ms_bjt["b1"], ns_bjt["b1"], pct_error(ms_bjt["b1"], ns_bjt["b1"])))
    rows.append(("BJT fixed-bias V(col)", "V(col)", ms_bjt["col"], ns_bjt["col"], pct_error(ms_bjt["col"], ns_bjt["col"])))

    bjt2_text = (
        "VBB base 0 DC 5\nRB base b1 220k\nVCC vcc 0 DC 12\nRC vcc col 2.2k\nRE emit 0 1k\n"
        "Q1 col b1 emit IS=5e-15 BF=150 BR=2\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(bjt2_text)
        bjt2_path = pathlib.Path(f.name)
    ms_bjt2 = run_minispice_dc(bjt2_path)
    bjt2_path.unlink()
    ns_bjt2 = run_ngspice_dc_with_model(
        bjt2_text.replace("Q1 col b1 emit IS=5e-15 BF=150 BR=2", "Q1 col b1 emit mynpn2"),
        ".model mynpn2 NPN(IS=5e-15 BF=150 BR=2)",
        ["col"],
    )
    rows.append(("BJT w/ emitter degeneration V(col)", "V(col)", ms_bjt2["col"], ns_bjt2["col"], pct_error(ms_bjt2["col"], ns_bjt2["col"])))

    # --- PNP DC case (mirror of the NPN fixed-bias case) --------------
    pnp_circuit_path = ROOT / "examples" / "11_pnp_fixed_bias" / "circuit.cir"
    pnp_circuit_text = pnp_circuit_path.read_text()
    ms_pnp = run_minispice_dc(pnp_circuit_path)
    ns_pnp = run_ngspice_dc_with_model(
        pnp_circuit_text.replace("Q1 col b1 0 IS=1e-16 BF=100 BR=1 TYPE=PNP", "Q1 col b1 0 mypnp"),
        ".model mypnp PNP(IS=1e-16 BF=100 BR=1)",
        ["b1", "col"],
    )
    rows.append(("PNP fixed-bias V(b1)=Veb", "V(b1)", ms_pnp["b1"], ns_pnp["b1"], pct_error(ms_pnp["b1"], ns_pnp["b1"])))
    rows.append(("PNP fixed-bias V(col)", "V(col)", ms_pnp["col"], ns_pnp["col"], pct_error(ms_pnp["col"], ns_pnp["col"])))

    # --- VCVS / VCCS DC cases (native ngspice E/G syntax, no .model needed) ---
    vcvs_circuit_path = ROOT / "examples" / "10_vcvs_amplifier" / "circuit.cir"
    vcvs_text = vcvs_circuit_path.read_text()
    ms_vcvs = run_minispice_dc(vcvs_circuit_path)
    ns_vcvs = run_ngspice_dc(vcvs_text, ["out"])
    rows.append(("VCVS amplifier V(out)", "V(out)", ms_vcvs["out"], ns_vcvs["out"], pct_error(ms_vcvs["out"], ns_vcvs["out"])))

    vccs_text = "V1 in 0 DC 2\nG1 out 0 in 0 0.005\nRload out 0 2k\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(vccs_text)
        vccs_path = pathlib.Path(f.name)
    ms_vccs = run_minispice_dc(vccs_path)
    vccs_path.unlink()
    ns_vccs = run_ngspice_dc(vccs_text, ["out"])
    rows.append(("VCCS transconductance V(out)", "V(out)", ms_vccs["out"], ns_vccs["out"], pct_error(ms_vccs["out"], ns_vccs["out"])))

    # --- Current source direction (DESIGN_DECISIONS.md #19) ------------
    # Second case gives 3V if right and 2V if reversed, not just a sign flip.
    isrc_cases = [
        ("I source into resistor V(n)", "I1 0 n DC 2m\nR1 n 0 1k\n"),
        ("I source + V source V(n)", "V1 in 0 DC 5\nR1 in n 1k\nI1 0 n DC 1m\nR2 n 0 1k\n"),
    ]
    for name, text in isrc_cases:
        with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
            f.write(text)
            isrc_path = pathlib.Path(f.name)
        ms_i = run_minispice_dc(isrc_path)
        isrc_path.unlink()
        ns_i = run_ngspice_dc(text, ["n"])
        rows.append((name, "V(n)", ms_i["n"], ns_i["n"], pct_error(ms_i["n"], ns_i["n"])))

    # --- Transient cases (checkpoint at several times each) -----------
    tran_cases = [
        ("RC step V(out)", "03_rc_step", 1e-5, 5e-3, "out", [0.5e-3, 1e-3, 2e-3, 3e-3, 5e-3]),
        ("Underdamped RLC V(out)", "04_rlc_underdamped", 2e-6, 3e-3, "out", [0.3e-3, 0.6e-3, 1.0e-3, 1.5e-3, 3e-3]),
        ("Overdamped RLC V(out)", "05_rlc_overdamped", 2e-6, 3e-3, "out", [0.5e-3, 1e-3, 2e-3, 3e-3]),
        # PULSE/SIN examples, same dt/stop as their saved CSVs. Checkpoints
        # avoid zero crossings where percent error blows up.
        ("PULSE RC filter V(out)", "12_pulse_rc_filter", 2e-5, 10e-3, "out", [2e-3, 3e-3, 4e-3, 6e-3, 10e-3]),
        ("SIN source V(out)", "13_sine_source", 2e-5, 6e-3, "out", [0.5e-3, 1e-3, 3e-3, 4.5e-3, 6e-3]),
    ]
    for name, path, dt, stop, node, checkpoints in tran_cases:
        circuit_path = ROOT / "examples" / path / "circuit.cir"
        circuit_text = circuit_path.read_text()
        ms_t, ms_v = run_minispice_tran(circuit_path, dt, stop, node)
        ns_t, ns_v = run_ngspice_tran(circuit_text, dt, stop, node)
        for tc in checkpoints:
            ms_val = interp(ms_t, ms_v, tc)
            ns_val = interp(ns_t, ns_v, tc)
            rows.append((f"{name} @ t={tc*1e3:.2f}ms", f"V({node})", ms_val, ns_val, pct_error(ms_val, ns_val)))

    # --- AC case (mag_db at several frequencies incl. corner) ---------
    circuit_path = ROOT / "examples" / "06_rc_lowpass_bode" / "circuit.cir"
    circuit_text = circuit_path.read_text()
    ms_out = subprocess.run([str(BIN), "ac", str(circuit_path), "--start", "10", "--stop", "1e6", "--ppd", "20", "--csv", "/tmp/_ms_ac.csv"],
                             check=True, capture_output=True)
    ms_rows = list(csv.DictReader(open("/tmp/_ms_ac.csv")))
    ms_freqs = [float(r["freq_hz"]) for r in ms_rows]
    ms_mags = [float(r["V(out)_mag_db"]) for r in ms_rows]
    ns_freqs, ns_mags = run_ngspice_ac(circuit_text, 10, 1e6, 20, "out")
    for target_hz in [100, 1000, 1591.5, 10000, 100000]:
        ms_val = interp(ms_freqs, ms_mags, target_hz)
        ns_val = interp(ns_freqs, ns_mags, target_hz)
        rows.append((f"RC low-pass @ {target_hz:.1f} Hz", "|V(out)| dB", ms_val, ns_val, pct_error(ms_val, ns_val)))

    # AC from a current source. Reversing it only shows up in the phase
    # (180 deg off), so compare phase here.
    iac_text = "I1 0 out DC 0 AC 1m\nR1 out 0 1k\nC1 out 0 100n\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(iac_text)
        iac_path = pathlib.Path(f.name)
    subprocess.run([str(BIN), "ac", str(iac_path), "--start", "10", "--stop", "1e6", "--ppd", "20", "--csv", "/tmp/_ms_ac.csv"],
                   check=True, capture_output=True)
    iac_path.unlink()
    ms_rows = list(csv.DictReader(open("/tmp/_ms_ac.csv")))
    ms_freqs = [float(r["freq_hz"]) for r in ms_rows]
    ms_phases = [float(r["V(out)_phase_deg"]) for r in ms_rows]
    ns_freqs, _, ns_phases = run_ngspice_ac(iac_text, 10, 1e6, 20, "out", with_phase=True)
    for target_hz in [100, 1591.5, 10000]:
        ms_val = interp(ms_freqs, ms_phases, target_hz)
        ns_val = interp(ns_freqs, ns_phases, target_hz)
        rows.append((f"I source AC @ {target_hz:.1f} Hz", "phase V(out) deg", ms_val, ns_val, pct_error(ms_val, ns_val)))

    # PULSE on a current source
    ipulse_text = "I1 0 out PULSE(0 5m 1m 0.1m 0.1m 2m 4m)\nR1 out 0 1k\nC1 out 0 1u\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(ipulse_text)
        ipulse_path = pathlib.Path(f.name)
    ms_t, ms_v = run_minispice_tran(ipulse_path, 2e-5, 10e-3, "out")
    ipulse_path.unlink()
    ns_t, ns_v = run_ngspice_tran(ipulse_text, 2e-5, 10e-3, "out")
    for tc in [2e-3, 3e-3, 4e-3, 6e-3, 10e-3]:
        ms_val = interp(ms_t, ms_v, tc)
        ns_val = interp(ns_t, ns_v, tc)
        rows.append((f"I source PULSE into RC @ t={tc*1e3:.2f}ms", "V(out)", ms_val, ns_val, pct_error(ms_val, ns_val)))

    # --- Print markdown table ------------------------------------------
    print("| Case | Quantity | mini-spice | ngspice | % error |")
    print("|---|---|---|---|---|")
    max_err = 0.0
    for case, qty, ms_val, ns_val, err in rows:
        max_err = max(max_err, err)
        print(f"| {case} | {qty} | {ms_val:.6g} | {ns_val:.6g} | {err:.4f}% |")
    print(f"\nMax error across all {len(rows)} checkpoints: {max_err:.4f}%", file=sys.stderr)


if __name__ == "__main__":
    main()
