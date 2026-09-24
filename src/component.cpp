#include "minispice/component.hpp"

#include <algorithm>
#include <cmath>

namespace minispice {

namespace {
constexpr double kPi = 3.14159265358979323846;
// DC-operating-point approximation for an inductor: rather than adding a
// zero-volt-source unknown (the textbook-exact way to force "short
// circuit"), we stamp a very small resistance. This is documented as a
// deliberate simplification in DESIGN_DECISIONS.md -- it keeps the unknown
// count identical between DC-op and AC/transient solves, at the cost of a
// tiny (numerically negligible) error versus an exact short.
constexpr double kInductorDcShortResistance = 1e-6;

std::complex<double> phasor(double magnitude, double phase_deg) {
    double rad = phase_deg * kPi / 180.0;
    return {magnitude * std::cos(rad), magnitude * std::sin(rad)};
}
}  // namespace

// ------------------------------------------------------------------- Waveform
// PULSE: V1 until TD, linear ramp to V2 over TR, hold V2 for PW, linear
// ramp back to V1 over TF, hold V1 until the period (PER) repeats -- the
// standard SPICE PULSE shape. A PER of 0 (or omitted) means "repeat
// immediately after one pulse" (period = TR+PW+TF), matching SPICE's own
// default.
// SIN: VO before TD; VO + VA*exp(-(t-TD)*THETA)*sin(2*pi*FREQ*(t-TD)) from
// TD onward (THETA=0 gives an undamped sine, the common case).
double Waveform::value_at(double t) const {
    if (kind == Kind::Sine) {
        if (t < sin_td) return vo;
        double tt = t - sin_td;
        double damp = (theta != 0.0) ? std::exp(-tt * theta) : 1.0;
        return vo + va * damp * std::sin(2.0 * kPi * freq * tt);
    }
    // Pulse
    if (t < td) return v1;
    double tt = t - td;
    double period = (per > 0.0) ? per : (tr + pw + tf);
    if (period <= 0.0) return v1;  // degenerate (zero-width) pulse: nothing to show
    double tm = std::fmod(tt, period);
    if (tm < tr) return (tr > 0.0) ? v1 + (v2 - v1) * (tm / tr) : v2;
    tm -= tr;
    if (tm < pw) return v2;
    tm -= pw;
    if (tm < tf) return (tf > 0.0) ? v2 + (v1 - v2) * (tm / tf) : v1;
    return v1;
}

// ---------------------------------------------------------------- Resistor
void Resistor::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    (void)b;
    stamp_conductance(A, node_p, node_n, 1.0 / resistance);
}
void Resistor::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    (void)b;
    stamp_conductance(A, node_p, node_n, std::complex<double>(1.0 / resistance, 0.0));
}

// --------------------------------------------------------------- Capacitor
// Backward-Euler companion model: i_C(t) = (C/dt)*v(t) - (C/dt)*v_prev.
// Realized as a conductance g_eq = C/dt in parallel with a Norton current
// source of g_eq*v_prev. See DESIGN_DECISIONS.md for the full derivation
// and the matrix-row sign check.
void Capacitor::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double dt) const {
    if (dt <= 0.0) {
        // DC operating point: capacitor is an open circuit, contributes
        // nothing.
        return;
    }
    double g_eq = capacitance / dt;
    stamp_conductance(A, node_p, node_n, g_eq);
    inject_current(b, node_p, node_n, g_eq * prev_voltage_);
}
void Capacitor::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const {
    (void)b;
    stamp_conductance(A, node_p, node_n, std::complex<double>(0.0, omega * capacitance));
}
void Capacitor::commit_timestep(const std::vector<double>& solution) {
    double vp = node_p >= 0 ? solution[static_cast<std::size_t>(node_p)] : 0.0;
    double vn = node_n >= 0 ? solution[static_cast<std::size_t>(node_n)] : 0.0;
    prev_voltage_ = vp - vn;
}

// ---------------------------------------------------------------- Inductor
// Backward-Euler companion model: i_L(t) = i_prev + (dt/L)*v(t). Realized
// as a conductance g_eq = dt/L in parallel with a current source of value
// -i_prev (see DESIGN_DECISIONS.md; the sign is opposite the capacitor's
// because i_prev adds to the branch current instead of subtracting).
void Inductor::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double dt) const {
    if (dt <= 0.0) {
        // DC operating point: approximate short circuit.
        stamp_conductance(A, node_p, node_n, 1.0 / kInductorDcShortResistance);
        last_dt_ = 0.0;
        return;
    }
    double g_eq = dt / inductance;
    stamp_conductance(A, node_p, node_n, g_eq);
    inject_current(b, node_p, node_n, -prev_current_);
    last_dt_ = dt;
}
void Inductor::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const {
    (void)b;
    // Admittance of an inductor is 1/(j*omega*L) = -j/(omega*L).
    if (omega <= 0.0) {
        // omega == 0 (DC point of an AC sweep, or a degenerate request):
        // an ideal inductor is a short at DC. Approximate the same way the
        // time-domain DC-op path does, for consistency.
        stamp_conductance(A, node_p, node_n, std::complex<double>(1.0 / kInductorDcShortResistance, 0.0));
        return;
    }
    stamp_conductance(A, node_p, node_n, std::complex<double>(0.0, -1.0 / (omega * inductance)));
}
void Inductor::commit_timestep(const std::vector<double>& solution) {
    if (last_dt_ <= 0.0) return;  // DC-op stamp was used; no companion history to advance
    double vp = node_p >= 0 ? solution[static_cast<std::size_t>(node_p)] : 0.0;
    double vn = node_n >= 0 ? solution[static_cast<std::size_t>(node_n)] : 0.0;
    double v = vp - vn;
    double g_eq = last_dt_ / inductance;
    prev_current_ = prev_current_ + g_eq * v;
}

// ----------------------------------------------------------- VoltageSource
// Adds one extra unknown (its own branch current) and a constraint row
// forcing v_p - v_n = dc_value (or the AC phasor, for stamp_ac) -- or, if
// a transient waveform is attached, the waveform's value at time t instead
// (dt > 0 selects a transient step; DC operating point, dt <= 0, always
// uses dc_value, matching SPICE .op behavior for a source with an attached
// PULSE/SIN).
void VoltageSource::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const {
    double v = (has_waveform && dt > 0.0) ? waveform.value_at(t) : dc_value;
    auto br = static_cast<std::size_t>(branch_index);
    if (node_p >= 0) {
        auto p = static_cast<std::size_t>(node_p);
        A(br, p) += 1.0;
        A(p, br) += 1.0;
    }
    if (node_n >= 0) {
        auto n = static_cast<std::size_t>(node_n);
        A(br, n) -= 1.0;
        A(n, br) -= 1.0;
    }
    b[br] += v;
}
void VoltageSource::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    auto br = static_cast<std::size_t>(branch_index);
    if (node_p >= 0) {
        auto p = static_cast<std::size_t>(node_p);
        A(br, p) += std::complex<double>(1.0, 0.0);
        A(p, br) += std::complex<double>(1.0, 0.0);
    }
    if (node_n >= 0) {
        auto n = static_cast<std::size_t>(node_n);
        A(br, n) -= std::complex<double>(1.0, 0.0);
        A(n, br) -= std::complex<double>(1.0, 0.0);
    }
    b[br] += phasor(ac_magnitude, ac_phase_deg);
}

// ----------------------------------------------------------- CurrentSource
// Injects dc_value (or its AC phasor, or a waveform's value at t during a
// transient step) directly into the RHS: no extra unknown needed, since an
// ideal current source's defining equation is already in terms of known
// quantities.
//
// Direction (SPICE's convention, checked against ngspice -- see
// DESIGN_DECISIONS.md #19): for "I1 p n <value>", a positive value flows
// from p *through the source* to n. So the source draws `value` out of
// node p and delivers it into node n. Working through the KCL rows
// ("current leaving the node through components = b(node)"):
//   row p: the source carries `value` away from p, so moving that known
//          term to the RHS gives b(p) -= value;
//   row n: the source delivers `value` into n, so b(n) += value.
// inject_current(b, x, y, i) adds i to x and subtracts it from y, so
// that's inject_current(b, node_n, node_p, value) -- n first. (The first
// version passed node_p first, which reversed every I source; the unit
// test pinned the stamp it had, and nothing compared a circuit against
// ngspice, so it went unnoticed.)
void CurrentSource::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const {
    (void)A;
    double i = (has_waveform && dt > 0.0) ? waveform.value_at(t) : dc_value;
    inject_current(b, node_n, node_p, i);
}
void CurrentSource::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    (void)A;
    inject_current(b, node_n, node_p, phasor(ac_magnitude, ac_phase_deg));
}

// ------------------------------------------------------------------ Diode
// Shockley equation I(V) = Is*(exp(V/a) - 1), a = N*Vt. Newton-Raphson
// linearizes this at guess_voltage into a tangent-line companion model:
//   G_eq = dI/dV|_guess = (Is/a) * exp(guess/a)
//   I_eq = I(guess) - G_eq*guess
// stamped exactly like the capacitor's Norton model (same helpers, same
// row-sign derivation) -- see DESIGN_DECISIONS.md for the full derivation.
void Diode::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    double a = ideality * kThermalVoltage;
    double exp_term = std::exp(guess_voltage / a);
    double i0 = is_sat * (exp_term - 1.0);
    double g_eq = (is_sat / a) * exp_term;
    double i_eq = i0 - g_eq * guess_voltage;
    stamp_conductance(A, node_p, node_n, g_eq);
    inject_current(b, node_p, node_n, -i_eq);
}
// AC uses the diode's small-signal conductance at whatever guess_voltage
// its last DC solve converged to (solve_ac_sweep computes that bias point
// first for exactly this reason) -- a fixed real admittance, since this
// model has no junction capacitance to add frequency dependence.
void Diode::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    (void)b;
    double a = ideality * kThermalVoltage;
    double g_eq = (is_sat / a) * std::exp(guess_voltage / a);
    stamp_conductance(A, node_p, node_n, std::complex<double>(g_eq, 0.0));
}
void Diode::reset_nr_state() { guess_voltage = 0.0; }
double Diode::update_nr_guess(const std::vector<double>& solution) {
    double vp = node_p >= 0 ? solution[static_cast<std::size_t>(node_p)] : 0.0;
    double vn = node_n >= 0 ? solution[static_cast<std::size_t>(node_n)] : 0.0;
    double v_new = vp - vn;
    double a = ideality * kThermalVoltage;
    // Voltage-step limiting: cap the change to a bounded number of thermal
    // voltages per iteration so one wild solve can't send the *next*
    // iteration's exp(V/a) toward overflow. A simplified relative of
    // SPICE's "pnjlim" algorithm; see DESIGN_DECISIONS.md for why this
    // bound, and its known limits (a diode wired directly across an ideal
    // source with no current-limiting resistor is a pathological circuit
    // this -- like real diodes -- does not handle gracefully).
    constexpr double kMaxStepThermalVoltages = 10.0;
    double max_delta = kMaxStepThermalVoltages * a;
    if (v_new - guess_voltage > max_delta) v_new = guess_voltage + max_delta;
    if (v_new - guess_voltage < -max_delta) v_new = guess_voltage - max_delta;
    double delta = std::abs(v_new - guess_voltage);
    guess_voltage = v_new;
    return delta;
}

// ------------------------------------------------------------------- Bjt
// See component.hpp for the Ebers-Moll equations. Linearizing I_B(Vbe,Vbc)
// and I_C(Vbe,Vbc) at (guess_vbe, guess_vbc) needs all four partials
// (a 2x2 Jacobian), because -- unlike the diode's single controlling
// voltage -- each terminal current here depends on *both* junction
// voltages:
//   gpi = dI_B/dVbe = (Is/BF)/Vt * exp(guess_vbe/Vt)
//   gmr = dI_B/dVbc = (Is/BR)/Vt * exp(guess_vbc/Vt)
//   gmf = dI_C/dVbe = (Is)/Vt    * exp(guess_vbe/Vt)
//   go  = dI_C/dVbc = -(Is*(1+1/BR))/Vt * exp(guess_vbc/Vt)
// Substituting Vbe=v_B-v_E, Vbc=v_B-v_C into the linearized I_B/I_C and
// collecting terms by node gives the nine matrix entries and three RHS
// terms below; DESIGN_DECISIONS.md works through the KCL row derivation
// (why row B gets +I_B's linearization, row C gets +I_C's, and row E gets
// the negative of their sum) in full, the same way component.cpp's other
// comments do for the two-terminal devices.
void Bjt::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    double vt = kThermalVoltage;
    // PNP is modeled as an NPN mirror: negate every voltage and current
    // (s = -1), which the exp()/current terms below apply, while gpi/gmr/
    // gmf/go come out identical either way (the two sign flips in the
    // chain rule -- one from the exponent argument, one from the current
    // -- cancel: s*s = 1). See DESIGN_DECISIONS.md #14 for the full
    // derivation and why only i_c0/i_b0 need the extra factor of s.
    double s = is_pnp ? -1.0 : 1.0;
    double f1 = std::exp(s * guess_vbe / vt);  // exp(s*Vbe/Vt)
    double f2 = std::exp(s * guess_vbc / vt);  // exp(s*Vbc/Vt)

    double i_c0 = s * (is_sat * (f1 - f2) - (is_sat / beta_r) * (f2 - 1.0));
    double i_b0 = s * ((is_sat / beta_f) * (f1 - 1.0) + (is_sat / beta_r) * (f2 - 1.0));

    double gpi = (is_sat / beta_f) * f1 / vt;
    double gmr = (is_sat / beta_r) * f2 / vt;
    double gmf = is_sat * f1 / vt;
    double go = -(is_sat * (1.0 + 1.0 / beta_r)) * f2 / vt;

    double i_c_eq = i_c0 - gmf * guess_vbe - go * guess_vbc;
    double i_b_eq = i_b0 - gpi * guess_vbe - gmr * guess_vbc;

    auto add_a = [&](int r, int c, double val) {
        if (r >= 0 && c >= 0) A(static_cast<std::size_t>(r), static_cast<std::size_t>(c)) += val;
    };
    auto add_b = [&](int r, double val) {
        if (r >= 0) b[static_cast<std::size_t>(r)] += val;
    };

    add_a(node_b, node_b, gpi + gmr);
    add_a(node_b, node_c, -gmr);
    add_a(node_b, node_e, -gpi);
    add_a(node_c, node_b, gmf + go);
    add_a(node_c, node_c, -go);
    add_a(node_c, node_e, -gmf);
    add_a(node_e, node_b, -(gpi + gmr + gmf + go));
    add_a(node_e, node_c, gmr + go);
    add_a(node_e, node_e, gpi + gmf);

    add_b(node_b, -i_b_eq);
    add_b(node_c, -i_c_eq);
    add_b(node_e, i_b_eq + i_c_eq);
}
// AC with a BJT present is refused up front by solve_ac_sweep() (same
// reasoning as the diode -- no DC bias point is established before an AC
// sweep yet), so this is never called in practice; it's implemented
// anyway (the small-signal conductances at whatever guess point the
// component currently holds) so the interface has no silently-wrong stub.
void Bjt::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    (void)b;
    double vt = kThermalVoltage;
    double s = is_pnp ? -1.0 : 1.0;
    double f1 = std::exp(s * guess_vbe / vt);
    double f2 = std::exp(s * guess_vbc / vt);
    double gpi = (is_sat / beta_f) * f1 / vt;
    double gmr = (is_sat / beta_r) * f2 / vt;
    double gmf = is_sat * f1 / vt;
    double go = -(is_sat * (1.0 + 1.0 / beta_r)) * f2 / vt;

    auto add_a = [&](int r, int c, std::complex<double> val) {
        if (r >= 0 && c >= 0) A(static_cast<std::size_t>(r), static_cast<std::size_t>(c)) += val;
    };
    add_a(node_b, node_b, {gpi + gmr, 0.0});
    add_a(node_b, node_c, {-gmr, 0.0});
    add_a(node_b, node_e, {-gpi, 0.0});
    add_a(node_c, node_b, {gmf + go, 0.0});
    add_a(node_c, node_c, {-go, 0.0});
    add_a(node_c, node_e, {-gmf, 0.0});
    add_a(node_e, node_b, {-(gpi + gmr + gmf + go), 0.0});
    add_a(node_e, node_c, {gmr + go, 0.0});
    add_a(node_e, node_e, {gpi + gmf, 0.0});
}
void Bjt::reset_nr_state() {
    guess_vbe = 0.0;
    guess_vbc = 0.0;
}
double Bjt::update_nr_guess(const std::vector<double>& solution) {
    auto v_at = [&](int idx) { return idx >= 0 ? solution[static_cast<std::size_t>(idx)] : 0.0; };
    double new_vbe = v_at(node_b) - v_at(node_e);
    double new_vbc = v_at(node_b) - v_at(node_c);

    constexpr double kMaxStepThermalVoltages = 10.0;
    double max_delta = kMaxStepThermalVoltages * kThermalVoltage;
    auto clamp_step = [&](double new_v, double old_v) {
        if (new_v - old_v > max_delta) return old_v + max_delta;
        if (new_v - old_v < -max_delta) return old_v - max_delta;
        return new_v;
    };
    new_vbe = clamp_step(new_vbe, guess_vbe);
    new_vbc = clamp_step(new_vbc, guess_vbc);

    double delta = std::max(std::abs(new_vbe - guess_vbe), std::abs(new_vbc - guess_vbc));
    guess_vbe = new_vbe;
    guess_vbc = new_vbc;
    return delta;
}

// ------------------------------------------------------------------ Vcvs
// v(out_p)-v(out_n) = gain*(v(ctrl_p)-v(ctrl_n)) -- an ideal voltage
// source whose "dc_value" is a linear function of two other nodes'
// unknowns instead of a constant. Same branch-row structure as
// VoltageSource::stamp_time_domain (same four A(branch,node)/A(node,branch)
// entries for out_p/out_n), except the RHS constant is replaced by two
// more A entries on the controlling nodes -- linear in the unknowns, so it
// belongs in the matrix, not b.
void Vcvs::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    (void)b;
    auto br = static_cast<std::size_t>(branch_index);
    if (out_p >= 0) {
        auto p = static_cast<std::size_t>(out_p);
        A(br, p) += 1.0;
        A(p, br) += 1.0;
    }
    if (out_n >= 0) {
        auto n = static_cast<std::size_t>(out_n);
        A(br, n) -= 1.0;
        A(n, br) -= 1.0;
    }
    if (ctrl_p >= 0) A(br, static_cast<std::size_t>(ctrl_p)) -= gain;
    if (ctrl_n >= 0) A(br, static_cast<std::size_t>(ctrl_n)) += gain;
}
void Vcvs::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    (void)b;
    auto br = static_cast<std::size_t>(branch_index);
    std::complex<double> one(1.0, 0.0), g(gain, 0.0);
    if (out_p >= 0) {
        auto p = static_cast<std::size_t>(out_p);
        A(br, p) += one;
        A(p, br) += one;
    }
    if (out_n >= 0) {
        auto n = static_cast<std::size_t>(out_n);
        A(br, n) -= one;
        A(n, br) -= one;
    }
    if (ctrl_p >= 0) A(br, static_cast<std::size_t>(ctrl_p)) -= g;
    if (ctrl_n >= 0) A(br, static_cast<std::size_t>(ctrl_n)) += g;
}

// ------------------------------------------------------------------ Vccs
// Current gm*(v(ctrl_p)-v(ctrl_n)) flows from out_p to out_n through the
// device (resistor-like row convention -- see component.hpp for why this
// isn't "injected into out_p" despite the name). No extra unknown: the
// "current source value" is already linear in existing node-voltage
// unknowns, so (unlike an independent current source, whose fixed value
// goes in b) it goes directly in A, as a transconductance stamp between
// two different terminal pairs.
void Vccs::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    (void)b;
    auto p = out_p, n = out_n, cp = ctrl_p, cn = ctrl_n;
    if (p >= 0 && cp >= 0) A(static_cast<std::size_t>(p), static_cast<std::size_t>(cp)) += gm;
    if (p >= 0 && cn >= 0) A(static_cast<std::size_t>(p), static_cast<std::size_t>(cn)) -= gm;
    if (n >= 0 && cp >= 0) A(static_cast<std::size_t>(n), static_cast<std::size_t>(cp)) -= gm;
    if (n >= 0 && cn >= 0) A(static_cast<std::size_t>(n), static_cast<std::size_t>(cn)) += gm;
}
void Vccs::stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double /*omega*/) const {
    (void)b;
    std::complex<double> g(gm, 0.0);
    auto p = out_p, n = out_n, cp = ctrl_p, cn = ctrl_n;
    if (p >= 0 && cp >= 0) A(static_cast<std::size_t>(p), static_cast<std::size_t>(cp)) += g;
    if (p >= 0 && cn >= 0) A(static_cast<std::size_t>(p), static_cast<std::size_t>(cn)) -= g;
    if (n >= 0 && cp >= 0) A(static_cast<std::size_t>(n), static_cast<std::size_t>(cp)) -= g;
    if (n >= 0 && cn >= 0) A(static_cast<std::size_t>(n), static_cast<std::size_t>(cn)) += g;
}

}  // namespace minispice
