#pragma once
// component.hpp
//
// Every device is a Component that stamps itself into the MNA matrix and
// RHS. The solvers just loop over components and call stamp_time_domain()
// or stamp_ac(), so adding a new device only means adding a class here.

#include <complex>
#include <string>
#include <vector>

#include "minispice/matrix.hpp"

namespace minispice {

// Ground ("0" in the netlist) is index -1. It has no row/column since its
// voltage is fixed at 0.
constexpr int kGround = -1;

// Standard 4-entry conductance stamp between p and n. Used by R, and by C/L
// (companion models in transient, admittances in AC).
template <typename Scalar>
void stamp_conductance(Matrix<Scalar>& A, int p, int n, Scalar g) {
    if (p >= 0) A(static_cast<std::size_t>(p), static_cast<std::size_t>(p)) += g;
    if (n >= 0) A(static_cast<std::size_t>(n), static_cast<std::size_t>(n)) += g;
    if (p >= 0 && n >= 0) {
        A(static_cast<std::size_t>(p), static_cast<std::size_t>(n)) -= g;
        A(static_cast<std::size_t>(n), static_cast<std::size_t>(p)) -= g;
    }
}

// Adds a known current i to the RHS: i enters the circuit at p and leaves
// at n. Careful: a netlist "I1 p n" pushes current *into n*, so
// CurrentSource passes node_n first.
template <typename Scalar>
void inject_current(std::vector<Scalar>& b, int p, int n, Scalar i) {
    if (p >= 0) b[static_cast<std::size_t>(p)] += i;
    if (n >= 0) b[static_cast<std::size_t>(n)] -= i;
}

class Component {
public:
    virtual ~Component() = default;

    const std::string& name() const { return name_; }

    // dt == 0: DC operating point (C open, L ~ tiny resistor).
    // dt > 0:  one backward Euler step; C and L use companion models.
    // t is the absolute time at the end of the step (for PULSE/SIN sources).
    virtual void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const = 0;

    // AC stamp at angular frequency omega (rad/s).
    virtual void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const = 0;

    // Only C and L use these.
    virtual void begin_timestep(double /*dt*/) {}
    virtual void commit_timestep(const std::vector<double>& /*solution*/) {}

    // Newton-Raphson hooks for nonlinear devices (D, Q).
    // update_nr_guess() returns how far the guess moved, which the solver
    // uses as its convergence check.
    virtual bool is_nonlinear() const { return false; }
    virtual void reset_nr_state() {}
    virtual double update_nr_guess(const std::vector<double>& /*solution*/) { return 0.0; }

    // Extra MNA unknowns beyond node voltages (a branch current for V and E).
    // The parser assigns the index once it knows how many nodes there are.
    virtual int extra_unknowns() const { return 0; }
    virtual void set_branch_index(int /*index*/) {}
    virtual int get_branch_index() const { return -1; }

protected:
    explicit Component(std::string name) : name_(std::move(name)) {}
    std::string name_;
};

class Resistor final : public Component {
public:
    Resistor(std::string name, int p, int n, double ohms) : Component(std::move(name)), node_p(p), node_n(n), resistance(ohms) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;

    int node_p, node_n;
    double resistance;
};

class Capacitor final : public Component {
public:
    Capacitor(std::string name, int p, int n, double farads, double ic = 0.0)
        : Component(std::move(name)), node_p(p), node_n(n), capacitance(farads), prev_voltage_(ic) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;
    void commit_timestep(const std::vector<double>& solution) override;

    double history_voltage() const { return prev_voltage_; }

    int node_p, node_n;
    double capacitance;

private:
    double prev_voltage_;
};

class Inductor final : public Component {
public:
    Inductor(std::string name, int p, int n, double henries, double ic = 0.0)
        : Component(std::move(name)), node_p(p), node_n(n), inductance(henries), prev_current_(ic) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;
    void commit_timestep(const std::vector<double>& solution) override;

    double history_current() const { return prev_current_; }

    int node_p, node_n;
    double inductance;

private:
    mutable double last_dt_ = 0.0;  // commit_timestep needs the dt that was stamped
    double prev_current_;
};

// PULSE / SIN waveform for V and I sources. Only used in transient; DC uses
// dc_value and AC uses the separate AC magnitude/phase.
struct Waveform {
    enum class Kind { Pulse, Sine };
    Kind kind = Kind::Pulse;

    // PULSE(V1 V2 TD TR TF PW PER)
    double v1 = 0.0, v2 = 0.0, td = 0.0, tr = 0.0, tf = 0.0, pw = 0.0, per = 0.0;
    // SIN(VO VA FREQ TD THETA)
    double vo = 0.0, va = 0.0, freq = 0.0, sin_td = 0.0, theta = 0.0;

    // DC value to use if the netlist didn't give one (same as SPICE).
    double rest_value() const { return kind == Kind::Pulse ? v1 : vo; }

    double value_at(double t) const;
};

class VoltageSource final : public Component {
public:
    VoltageSource(std::string name, int p, int n, double dc, double ac_mag = 0.0, double ac_phase_deg = 0.0)
        : Component(std::move(name)), node_p(p), node_n(n), dc_value(dc), ac_magnitude(ac_mag), ac_phase_deg(ac_phase_deg) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;
    int extra_unknowns() const override { return 1; }
    void set_branch_index(int index) override { branch_index = index; }
    int get_branch_index() const override { return branch_index; }

    int node_p, node_n;
    double dc_value;
    double ac_magnitude, ac_phase_deg;
    int branch_index = -1;
    bool has_waveform = false;
    Waveform waveform;
};

// "I1 p n value": current flows from p through the source to n (SPICE's
// convention), so "I1 0 out 2m" into 1k gives V(out) = +2V.
class CurrentSource final : public Component {
public:
    CurrentSource(std::string name, int p, int n, double dc, double ac_mag = 0.0, double ac_phase_deg = 0.0)
        : Component(std::move(name)), node_p(p), node_n(n), dc_value(dc), ac_magnitude(ac_mag), ac_phase_deg(ac_phase_deg) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;

    int node_p, node_n;
    double dc_value;
    double ac_magnitude, ac_phase_deg;
    bool has_waveform = false;
    Waveform waveform;
};

// Shockley diode, I = Is*(exp(V/(N*Vt)) - 1). Each Newton iteration it's
// replaced by its tangent line at guess_voltage (conductance + current
// source). Derivation in DESIGN_DECISIONS.md #12.
class Diode final : public Component {
public:
    Diode(std::string name, int p, int n, double is_sat, double ideality)
        : Component(std::move(name)), node_p(p), node_n(n), is_sat(is_sat), ideality(ideality) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;
    bool is_nonlinear() const override { return true; }
    void reset_nr_state() override;
    double update_nr_guess(const std::vector<double>& solution) override;

    double guess_voltage_for_test() const { return guess_voltage; }
    static double thermal_voltage() { return kThermalVoltage; }

    int node_p, node_n;
    double is_sat;     // saturation current (A)
    double ideality;   // N, usually 1-2

private:
    // kT/q at 300.15K (27C), SPICE's default TNOM. Using 300K instead gave
    // a ~0.35mV mismatch vs ngspice.
    static constexpr double kThermalVoltage = 0.0258649258;
    double guess_voltage = 0.0;
};

// BJT (NPN or PNP), injection-form Ebers-Moll. No Early effect, terminal
// resistances or junction capacitance:
//
//   I_C = Is*(exp(Vbe/Vt) - exp(Vbc/Vt)) - (Is/BR)*(exp(Vbc/Vt) - 1)
//   I_B = (Is/BF)*(exp(Vbe/Vt) - 1) + (Is/BR)*(exp(Vbc/Vt) - 1)
//   I_E = I_B + I_C
//
// Basically two coupled diodes, so it's Newton-Raphson again but in two
// variables (Vbe, Vbc) with a 2x2 Jacobian. See DESIGN_DECISIONS.md #13/#14.
class Bjt final : public Component {
public:
    Bjt(std::string name, int collector, int base, int emitter, double is_sat, double beta_f, double beta_r,
        bool is_pnp = false)
        : Component(std::move(name)),
          node_c(collector),
          node_b(base),
          node_e(emitter),
          is_sat(is_sat),
          beta_f(beta_f),
          beta_r(beta_r),
          is_pnp(is_pnp) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;
    bool is_nonlinear() const override { return true; }
    void reset_nr_state() override;
    double update_nr_guess(const std::vector<double>& solution) override;

    double guess_vbe_for_test() const { return guess_vbe; }
    double guess_vbc_for_test() const { return guess_vbc; }

    int node_c, node_b, node_e;
    double is_sat;   // saturation current (A)
    double beta_f;   // forward current gain (BF)
    double beta_r;   // reverse current gain (BR)
    bool is_pnp;

private:
    static constexpr double kThermalVoltage = 0.0258649258;  // same convention as Diode
    double guess_vbe = 0.0;
    double guess_vbc = 0.0;
};

// VCVS ("E"): v(out_p) - v(out_n) = gain * (v(ctrl_p) - v(ctrl_n)).
// Stamped like a voltage source, but the control voltage goes in the
// matrix instead of the RHS. Needs a branch current unknown.
class Vcvs final : public Component {
public:
    Vcvs(std::string name, int out_p, int out_n, int ctrl_p, int ctrl_n, double gain)
        : Component(std::move(name)), out_p(out_p), out_n(out_n), ctrl_p(ctrl_p), ctrl_n(ctrl_n), gain(gain) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;
    int extra_unknowns() const override { return 1; }
    void set_branch_index(int index) override { branch_index = index; }
    int get_branch_index() const override { return branch_index; }

    int out_p, out_n, ctrl_p, ctrl_n;
    double gain;
    int branch_index = -1;
};

// VCCS ("G"): gm*(v(ctrl_p) - v(ctrl_n)) flows from out_p to out_n
// through the device (same direction as ngspice). No extra unknown needed,
// it's like a resistor whose current depends on a different node pair.
class Vccs final : public Component {
public:
    Vccs(std::string name, int out_p, int out_n, int ctrl_p, int ctrl_n, double transconductance)
        : Component(std::move(name)), out_p(out_p), out_n(out_n), ctrl_p(ctrl_p), ctrl_n(ctrl_n), gm(transconductance) {}

    void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const override;
    void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const override;

    int out_p, out_n, ctrl_p, ctrl_n;
    double gm;
};

}  // namespace minispice
