#pragma once
// matrix.hpp
//
// Dense matrix + Gaussian elimination, written by hand (no Eigen) since the
// point of the project is to understand the solver.
//
// Templated so the same code does DC/transient (double) and AC
// (std::complex<double>).

#include <complex>
#include <cstddef>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace minispice {

// Singular matrix. The row index lets the caller say which node is floating
// or which source is shorted.
class SingularMatrixError : public std::runtime_error {
public:
    explicit SingularMatrixError(std::size_t row, std::string what)
        : std::runtime_error(std::move(what)), row_(row) {}
    std::size_t row() const noexcept { return row_; }

private:
    std::size_t row_;
};

// |x| for real or complex, used to pick pivots. Partial pivoting matters
// here because MNA entries can span a huge range (pF caps next to MEG resistors).
template <typename Scalar>
double magnitude(const Scalar& v) {
    if constexpr (std::is_same_v<Scalar, std::complex<double>>) {
        return std::abs(v);
    } else {
        return v < 0 ? static_cast<double>(-v) : static_cast<double>(v);
    }
}

// Row-major, one contiguous buffer.
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

// Solves A x = b (Gaussian elimination, partial pivoting). Takes copies so
// the caller's A and b aren't modified.
// Throws SingularMatrixError if a column has no pivot above epsilon, which
// is how floating nodes and shorted sources get caught.
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
        // pick the largest entry in this column as the pivot
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
