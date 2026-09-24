#pragma once
// matrix.hpp
//
// A small, dense linear-algebra layer written from scratch (no Eigen/BLAS)
// because the whole point of this project is to understand what a circuit
// solver actually does at the matrix level, not to call a library.
//
// Templated on Scalar so the *same* elimination code services both:
//   - DC / transient analysis (Scalar = double)
//   - AC analysis              (Scalar = std::complex<double>)
//
// This is intentional: modified nodal analysis (MNA) doesn't care whether
// the entries are real or complex, only the elimination routine's pivoting
// rule needs a magnitude, which std::abs() gives us for both.

#include <complex>
#include <cstddef>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace minispice {

// Thrown when the coefficient matrix is (numerically) singular. Carries the
// row index that had no usable pivot so callers can translate it back into
// "which node has no DC path to ground" / "which nodes are shorted".
class SingularMatrixError : public std::runtime_error {
public:
    explicit SingularMatrixError(std::size_t row, std::string what)
        : std::runtime_error(std::move(what)), row_(row) {}
    std::size_t row() const noexcept { return row_; }

private:
    std::size_t row_;
};

// Returns the magnitude of a real or complex scalar. Used for partial
// pivoting: we always pivot on the entry with the largest magnitude in the
// current column, which is what keeps Gaussian elimination numerically
// stable for the kinds of matrices MNA produces (conductances can span many
// orders of magnitude, e.g. 1e-12 F capacitors next to 1e6 ohm resistors).
template <typename Scalar>
double magnitude(const Scalar& v) {
    if constexpr (std::is_same_v<Scalar, std::complex<double>>) {
        return std::abs(v);
    } else {
        return v < 0 ? static_cast<double>(-v) : static_cast<double>(v);
    }
}

// A plain dense matrix, row-major, stored as a single contiguous buffer.
template <typename Scalar>
class Matrix {
public:
    Matrix() = default;
    Matrix(std::size_t rows, std::size_t cols) : rows_(rows), cols_(cols), data_(rows * cols, Scalar{}) {}

    std::size_t rows() const noexcept { return rows_; }
    std::size_t cols() const noexcept { return cols_; }

    Scalar& operator()(std::size_t r, std::size_t c) { return data_[r * cols_ + c]; }
    const Scalar& operator()(std::size_t r, std::size_t c) const { return data_[r * cols_ + c]; }

    void fill(Scalar v) { std::fill(data_.begin(), data_.end(), v); }

private:
    std::size_t rows_ = 0;
    std::size_t cols_ = 0;
    std::vector<Scalar> data_;
};

// Solves A x = b via Gaussian elimination with partial pivoting.
// A is copied (not modified in place) so the caller can re-solve the same
// system with a different RHS without re-building it, e.g. AC sweeps that
// rebuild A per frequency but transient steps that sometimes reuse it.
//
// On a singular pivot column (all candidates below `epsilon` in magnitude)
// throws SingularMatrixError with the offending row index. This is how the
// solver detects floating nodes (a node with no DC path to ground leaves an
// all-zero row/column in the conductance matrix) and shorted sources.
template <typename Scalar>
std::vector<Scalar> solve_linear_system(Matrix<Scalar> A, std::vector<Scalar> b, double epsilon = 1e-12) {
    const std::size_t n = A.rows();
    if (A.cols() != n) {
        throw std::invalid_argument("solve_linear_system: matrix must be square");
    }
    if (b.size() != n) {
        throw std::invalid_argument("solve_linear_system: rhs size mismatch");
    }

    // Forward elimination with partial pivoting.
    for (std::size_t col = 0; col < n; ++col) {
        // Find the pivot row: the row >= col with the largest-magnitude
        // entry in this column.
        std::size_t pivot_row = col;
        double best = magnitude(A(col, col));
        for (std::size_t r = col + 1; r < n; ++r) {
            double m = magnitude(A(r, col));
            if (m > best) {
                best = m;
                pivot_row = r;
            }
        }

        if (best < epsilon) {
            throw SingularMatrixError(col, "singular matrix: no usable pivot in column " + std::to_string(col));
        }

        if (pivot_row != col) {
            for (std::size_t c = 0; c < n; ++c) std::swap(A(col, c), A(pivot_row, c));
            std::swap(b[col], b[pivot_row]);
        }

        const Scalar pivot = A(col, col);
        for (std::size_t r = col + 1; r < n; ++r) {
            Scalar factor = A(r, col) / pivot;
            if (factor == Scalar{}) continue;
            for (std::size_t c = col; c < n; ++c) {
                A(r, c) -= factor * A(col, c);
            }
            b[r] -= factor * b[col];
        }
    }

    // Back substitution.
    std::vector<Scalar> x(n, Scalar{});
    for (std::size_t i = n; i-- > 0;) {
        Scalar sum = b[i];
        for (std::size_t c = i + 1; c < n; ++c) {
            sum -= A(i, c) * x[c];
        }
        x[i] = sum / A(i, i);
    }
    return x;
}

}  // namespace minispice
