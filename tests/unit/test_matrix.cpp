// Unit tests for the matrix / Gaussian-elimination layer: verify against
// hand-computed linear systems, not just "does it run".
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "minispice/matrix.hpp"

using namespace minispice;
using Catch::Matchers::WithinAbs;

TEST_CASE("solve_linear_system solves a hand-computed 2x2 system", "[matrix]") {
    // [2 1][x]   [5]      hand solution: x=1, y=3
    // [1 3][y] = [10]
    Matrix<double> A(2, 2);
    A(0, 0) = 2; A(0, 1) = 1;
    A(1, 0) = 1; A(1, 1) = 3;
    std::vector<double> b = {5, 10};

    auto x = solve_linear_system(A, b);
    REQUIRE_THAT(x[0], WithinAbs(1.0, 1e-9));
    REQUIRE_THAT(x[1], WithinAbs(3.0, 1e-9));
}

TEST_CASE("solve_linear_system solves a hand-computed 3x3 system", "[matrix]") {
    // x + y + z = 6
    // 2y + 5z = -4
    // 2x + 5y - z = 27      hand solution: x=5, y=3, z=-2  (classic textbook system)
    Matrix<double> A(3, 3);
    A(0,0)=1; A(0,1)=1; A(0,2)=1;
    A(1,0)=0; A(1,1)=2; A(1,2)=5;
    A(2,0)=2; A(2,1)=5; A(2,2)=-1;
    std::vector<double> b = {6, -4, 27};

    auto x = solve_linear_system(A, b);
    REQUIRE_THAT(x[0], WithinAbs(5.0, 1e-9));
    REQUIRE_THAT(x[1], WithinAbs(3.0, 1e-9));
    REQUIRE_THAT(x[2], WithinAbs(-2.0, 1e-9));
}

TEST_CASE("solve_linear_system requires partial pivoting to get a zero-pivot system right", "[matrix]") {
    // Without row swapping, A(0,0)=0 causes a divide-by-zero. With partial
    // pivoting it should swap rows 0 and 1 and solve correctly.
    // 0x + 2y = 4
    // 3x + 1y = 5    -> hand solution: x=1, y=2
    Matrix<double> A(2, 2);
    A(0,0)=0; A(0,1)=2;
    A(1,0)=3; A(1,1)=1;
    std::vector<double> b = {4, 5};

    auto x = solve_linear_system(A, b);
    REQUIRE_THAT(x[0], WithinAbs(1.0, 1e-9));
    REQUIRE_THAT(x[1], WithinAbs(2.0, 1e-9));
}

TEST_CASE("solve_linear_system throws SingularMatrixError on a singular system", "[matrix]") {
    // Row 1 is 2x row 0 -> singular.
    Matrix<double> A(2, 2);
    A(0,0)=1; A(0,1)=2;
    A(1,0)=2; A(1,1)=4;
    std::vector<double> b = {1, 2};

    REQUIRE_THROWS_AS(solve_linear_system(A, b), SingularMatrixError);
}

TEST_CASE("solve_linear_system works over complex scalars", "[matrix]") {
    using C = std::complex<double>;
    // (1+j)x + 2y = (3+j)
    //  y = 1         -> from row 2, y=1; substitute: (1+j)x = (1+j) -> x=1
    Matrix<C> A(2, 2);
    A(0,0) = C(1,1); A(0,1) = C(2,0);
    A(1,0) = C(0,0); A(1,1) = C(1,0);
    std::vector<C> b = {C(3,1), C(1,0)};

    auto x = solve_linear_system(A, b);
    REQUIRE_THAT(x[0].real(), WithinAbs(1.0, 1e-9));
    REQUIRE_THAT(x[0].imag(), WithinAbs(0.0, 1e-9));
    REQUIRE_THAT(x[1].real(), WithinAbs(1.0, 1e-9));
    REQUIRE_THAT(x[1].imag(), WithinAbs(0.0, 1e-9));
}
