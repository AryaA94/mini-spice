#include "minispice/component.hpp"

#include <algorithm>
#include <cmath>

namespace minispice {

namespace {
constexpr double kPi = 3.14159265358979323846;
// At DC an inductor should be a short. Instead of adding an extra unknown
// for it, just stamp a tiny resistance (DESIGN_DECISIONS.md #5).
constexpr double kInductorDcShortResistance = 1e-6;

std::complex<double> phasor(double magnitude, double phase_deg) {
    double rad = phase_deg * kPi / 180.0;
    return {magnitude * std::cos(rad), magnitude * std::sin(rad)};
}
}  // namespace

// ------------------------------------------------------------------- Waveform
// PULSE: V1 until TD, ramp to V2 over TR, hold for PW, ramp back over TF,
// repeat every PER (PER = 0 means TR+PW+TF).
// SIN: VO before TD, then VO + VA*exp(-(t-TD)*THETA)*sin(2*pi*FREQ*(t-TD)).
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
// Backward Euler: i = (C/dt)*v - (C/dt)*v_prev, i.e. conductance C/dt in
// parallel with a current source g_eq*v_prev. (DESIGN_DECISIONS.md #3)
void Capacitor::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double dt) const {
    if (dt <= 0.0) {
        // DC: open circuit
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
// Backward Euler: i = i_prev + (dt/L)*v. Note the current source is
// -i_prev, opposite sign from the capacitor. (DESIGN_DECISIONS.md #4)
void Inductor::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double dt) const {
    if (dt <= 0.0) {
        // DC: ~short
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
    // Y = 1/(jwL) = -j/(wL)
    if (omega <= 0.0) {
        // omega = 0: treat as a short, same as the DC path
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
// Extra unknown for the branch current, plus a row forcing
// v_p - v_n = value. In transient with a waveform the value is the
// waveform at time t; at DC it's always dc_value.
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
// Just goes in the RHS, no extra unknown.
// "I1 p n": current flows p -> through source -> n, so it leaves node p
// (b[p] -= i) and enters node n (b[n] += i). That's why node_n is passed
// first. I had this backwards originally (DESIGN_DECISIONS.md #19).
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
// I = Is*(exp(V/a) - 1), a = N*Vt. Linearize at the current guess:
//   G_eq = (Is/a) * exp(guess/a)
//   I_eq = I(guess) - G_eq*guess
void Diode::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    double a = ideality * kThermalVoltage;
    double exp_term = std::exp(guess_voltage / a);
    double i0 = is_sat * (exp_term - 1.0);
    double g_eq = (is_sat / a) * exp_term;
    double i_eq = i0 - g_eq * guess_voltage;
    stamp_conductance(A, node_p, node_n, g_eq);
    inject_current(b, node_p, node_n, -i_eq);
}
// Small-signal conductance at the DC bias point (solve_ac_sweep runs the
// DC solve first). No junction capacitance, so it's purely real.
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
    // Limit each step to 10*a so exp() can't blow up on the next iteration
    // (a simple version of SPICE's pnjlim).
    constexpr double kMaxStepThermalVoltages = 10.0;
    double max_delta = kMaxStepThermalVoltages * a;
    if (v_new - guess_voltage > max_delta) v_new = guess_voltage + max_delta;
    if (v_new - guess_voltage < -max_delta) v_new = guess_voltage - max_delta;
    double delta = std::abs(v_new - guess_voltage);
    guess_voltage = v_new;
    return delta;
}

// ------------------------------------------------------------------- Bjt
// I_B and I_C both depend on Vbe and Vbc, so linearizing needs 4 partials:
//   gpi = dI_B/dVbe = (Is/BF)/Vt * exp(vbe/Vt)
//   gmr = dI_B/dVbc = (Is/BR)/Vt * exp(vbc/Vt)
//   gmf = dI_C/dVbe = Is/Vt * exp(vbe/Vt)
//   go  = dI_C/dVbc = -(Is*(1+1/BR))/Vt * exp(vbc/Vt)
// Rows B and C get I_B and I_C, row E gets minus their sum.
// Full derivation in DESIGN_DECISIONS.md #13.
void Bjt::stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double /*t*/, double /*dt*/) const {
    double vt = kThermalVoltage;
    // PNP = NPN with all voltages/currents negated (s = -1). The
    // conductances don't change sign (s*s = 1), only the currents do.
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
// Small-signal conductances at the DC bias point (solve_ac_sweep runs the
// DC solve first).
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
// Same as a voltage source, except instead of a constant on the RHS the
// branch row gets -gain on ctrl_p and +gain on ctrl_n.
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
// gm*(v(ctrl_p) - v(ctrl_n)) flows out_p -> out_n. It's linear in the node
// voltages so it goes straight into A.
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
