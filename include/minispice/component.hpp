#pragma once
// component.hpp
//
// Every device in the circuit is a Component that knows how to "stamp"
// itself into the system matrix/RHS. This is the extensibility hinge of
// the whole engine: dc_solver, transient_solver and ac_solver never look at
// what kind of device they're touching -- they just call stamp_time_domain()
// or stamp_ac() on every component in turn. Adding a new device type (an
// op-amp, a diode, a controlled source...) means writing one new class here
// and never touching a solver.

#include <complex>
#include <string>
#include <vector>

#include "minispice/matrix.hpp"

namespace minispice {

// Ground is node "0" in the netlist and is represented as index -1
// everywhere in resolved (post-parse) component/solver code: it never gets
// a row/column in the system matrix because its voltage is fixed at 0 by
// definition, not by an equation.
constexpr int kGround = -1;

// Adds a conductance g between nodes p and n to the real- or complex-valued
// system matrix A, using the standard four-entry resistive stamp. Shared by
// every component whose time/frequency-domain behavior reduces to "acts
// like a conductance this instant" (R directly; C and L through their
// companion models; C and L directly in the AC domain).
template <typename Scalar>
void stamp_conductance(Matrix<Scalar>& A, int p, int n, Scalar g) {
    if (p >= 0) A(static_cast<std::size_t>(p), static_cast<std::size_t>(p)) += g;
    if (n >= 0) A(static_cast<std::size_t>(n), static_cast<std::size_t>(n)) += g;
    if (p >= 0 && n >= 0) {
        A(static_cast<std::size_t>(p), static_cast<std::size_t>(n)) -= g;
        A(static_cast<std::size_t>(n), static_cast<std::size_t>(p)) -= g;
    }
}

// Injects a known current i into the RHS, flowing from node n to node p
// (i.e. i is a current *entering* the circuit at p and leaving at n). This
// single sign convention is used by every source of injected current:
// independent current sources and the Norton companion sources of C and L.
// Note these parameter names are the helper's own, not a netlist's: an
// independent source "I1 p n" delivers its current into its *n* terminal
// (SPICE's convention), so CurrentSource calls this with node_n first.
template <typename Scalar>
void inject_current(std::vector<Scalar>& b, int p, int n, Scalar i) {
    if (p >= 0) b[static_cast<std::size_t>(p)] += i;
    if (n >= 0) b[static_cast<std::size_t>(n)] -= i;
}

// Abstract base for every device. See the file header for the design
// rationale.
class Component {
public:
    virtual ~Component() = default;

    const std::string& name() const { return name_; }

    // Stamps this component into a real-valued MNA system.
    //   dt == 0.0  -> DC operating point: capacitors are open circuits,
    //                 inductors are approximated as a very small resistance
    //                 (see DESIGN_DECISIONS.md for why this approximation
    //                 was chosen over adding a zero-volt-source unknown).
    //   dt  > 0.0  -> one backward-Euler transient step of size dt; C and L
    //                 substitute their Norton companion models built from
    //                 history that begin_timestep()/commit_timestep()
    //                 maintain.
    virtual void stamp_time_domain(Matrix<double>& A, std::vector<double>& b, double t, double dt) const = 0;

    // Stamps this component into a complex-valued MNA system for an AC
    // sweep point at angular frequency omega (rad/s).
    virtual void stamp_ac(Matrix<std::complex<double>>& A, std::vector<std::complex<double>>& b, double omega) const = 0;

    // Reactive components override these; everything else no-ops.
    virtual void begin_timestep(double /*dt*/) {}
    virtual void commit_timestep(const std::vector<double>& /*solution*/) {}

    // True for components whose stamp depends on the *present solution*
    // itself (a diode's current is a nonlinear function of its own
    // voltage) rather than only on time/history. Solvers use this to
    // decide whether a single linear solve suffices or a Newton-Raphson
    // iteration is needed -- see DESIGN_DECISIONS.md "Newton-Raphson for
    // nonlinear devices". Linear components (R, C, L, V, I) leave this at
    // the default false, so circuits containing none of them keep the
    // original single-solve fast path exactly as before.
    virtual bool is_nonlinear() const { return false; }
    // Newton-Raphson iteration support (only meaningful when
    // is_nonlinear() is true): reset_nr_state() re-seeds the linearization
    // point at the start of a fresh solve (DC or a fresh transient run);
    // update_nr_guess() is called after each iteration's linear solve with
    // the node voltages, and returns how far the internal guess moved (the
    // convergence metric the solver checks against its tolerance).
    virtual void reset_nr_state() {}
    virtual double update_nr_guess(const std::vector<double>& /*solution*/) { return 0.0; }

    // Number of *extra* MNA unknowns (beyond node voltages) this component
    // needs, and the callback used to tell it where those unknowns start in
    // the unknown vector once the netlist has finished laying them out.
    // Only independent voltage sources need one (their branch current).
    virtual int extra_unknowns() const { return 0; }
    virtual void set_branch_index(int /*index*/) {}
    // Paired getter for set_branch_index(), used only by the netlist
    // parser's second pass (see netlist.cpp) to convert every
    // extra-unknown component's *relative* ordinal (assigned during
    // parsing, before the final node count is known) into its *absolute*
    // row/column index, generically across every component type that
    // reports extra_unknowns() > 0 -- not just VoltageSource.
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
    mutable double last_dt_ = 0.0;  // dt used in the most recent stamp, needed by commit_timestep
    double prev_current_;
};

// A time-varying source waveform (SPICE's PULSE and SIN forms). Only used
// for transient analysis -- DC operating point uses the source's ordinary
// dc_value (defaulting to the waveform's own rest_value() when no DC value
// was given explicitly), and AC sweeps use the separate ac_magnitude/
// ac_phase_deg fields already on VoltageSource/CurrentSource, not this.
// See DESIGN_DECISIONS.md #17 for why sources needed to start knowing the
// absolute simulation time, not just the step size, to support this.
struct Waveform {
    enum class Kind { Pulse, Sine };
    Kind kind = Kind::Pulse;

    // PULSE(V1 V2 TD TR TF PW PER)
    double v1 = 0.0, v2 = 0.0, td = 0.0, tr = 0.0, tf = 0.0, pw = 0.0, per = 0.0;
    // SIN(VO VA FREQ TD THETA)
    double vo = 0.0, va = 0.0, freq = 0.0, sin_td = 0.0, theta = 0.0;

    // The value used for DC operating point when no explicit DC value was
    // given on the netlist line -- SPICE convention: PULSE's V1 (the
    // "before anything happens" level), SIN's VO (the offset it oscillates
    // around).
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

// An independent current source, "I<name> p n <value>". SPICE's
// convention: a positive value flows from p through the source to n, i.e.
// out of the source's n terminal into the external circuit. So a 2mA
// source "I1 0 n" into a resistor to ground raises n to +2mA*R.
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

// A diode, modeled with the Shockley equation I(V) = Is*(exp(V/(N*Vt)) - 1)
// and solved via Newton-Raphson: at each iteration the diode is replaced by
// its tangent-line companion model (a conductance plus a current source)
// evaluated at guess_voltage, which update_nr_guess() advances toward the
// converged answer. See DESIGN_DECISIONS.md for the full derivation, the
// sign check, and the voltage-limiting scheme that keeps the exponential
// from overflowing during early iterations.
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
    double ideality;   // emission/ideality factor N (dimensionless, typically 1-2)

private:
    // Thermal voltage Vt = k*T/q at T = 300.15K (27C), matching SPICE's
    // universal default TNOM -- deliberately not a round 300K, so this
    // solver's diode DC point matches ngspice's to within numerical
    // tolerance rather than differing by a known, avoidable constant. See
    // DESIGN_DECISIONS.md, which documents the value both ways: the
    // discrepancy this fixed, and the Lambert-W closed-form check that
    // caught it.
    static constexpr double kThermalVoltage = 0.0258649258;
    double guess_voltage = 0.0;  // present Newton-Raphson linearization point
};

// An NPN bipolar junction transistor, modeled with the injection form of
// the Ebers-Moll equations (the same DC/resistive-only model SPICE's
// Level-1 BJT reduces to without the Early effect, ohmic terminal
// resistances, or junction capacitance):
//
//   I_C = Is*(exp(Vbe/Vt) - exp(Vbc/Vt)) - (Is/BR)*(exp(Vbc/Vt) - 1)
//   I_B = (Is/BF)*(exp(Vbe/Vt) - 1) + (Is/BR)*(exp(Vbc/Vt) - 1)
//   I_E = I_B + I_C
//
// Structurally this is two coupled diode junctions (base-emitter,
// base-collector) sharing the same Is, plus BF/BR current-gain terms
// between them -- it reuses the Diode's Newton-Raphson machinery, just
// linearized in two controlling voltages (Vbe, Vbc) instead of one. See
// DESIGN_DECISIONS.md for the full derivation, including the four-term
// Jacobian this requires and the row-by-row KCL sign derivation.
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
    double is_sat;   // saturation current (A), shared by both junctions
    double beta_f;   // forward current gain (BF)
    double beta_r;   // reverse current gain (BR)
    bool is_pnp;     // false = NPN (default), true = PNP -- see DESIGN_DECISIONS.md #14

private:
    static constexpr double kThermalVoltage = 0.0258649258;  // same convention as Diode
    double guess_vbe = 0.0;
    double guess_vbc = 0.0;
};

// A voltage-controlled voltage source (SPICE's "E" device):
// v(out_p) - v(out_n) = gain * (v(ctrl_p) - v(ctrl_n)). Linear, so no
// Newton-Raphson needed -- it stamps directly into the branch-current row
// exactly like VoltageSource, except the RHS constant (dc_value) is
// replaced by a linear combination of the *controlling* nodes' own
// unknowns. Needs one extra unknown (its own branch current), same as any
// ideal voltage source.
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

// A voltage-controlled current source (SPICE's "G" device): a current
// gm*(v(ctrl_p)-v(ctrl_n)) flows from out_p to out_n *through* the device
// -- the same directional convention as a resistor (current leaving out_p
// through the device is +gm*(...), matching stamp_conductance()'s row
// sign), not literally "injected into out_p" despite how that might read;
// confirmed against ngspice's identical G-device convention. Linear, and
// -- unlike Vcvs -- needs no extra unknown at all: the current is already
// a linear function of existing node-voltage unknowns, so it stamps like
// a "cross-coupled resistor" (a resistor whose current depends on a
// *different* node pair's voltage than its own terminals).
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
