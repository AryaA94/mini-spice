cmake_minimum_required(VERSION 3.20)
project(minispice LANGUAGES CXX VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

option(MINISPICE_ENABLE_SANITIZERS "Build with AddressSanitizer + UndefinedBehaviorSanitizer" OFF)
option(MINISPICE_BUILD_TESTS "Build the Catch2 test suite" ON)

# MSVC doesn't understand -Wall/-Wextra (fails with D8021), it uses /W4
if(MSVC)
  set(MINISPICE_WARNINGS /W4)
  # needed for M_PI on MSVC
  add_compile_definitions(_USE_MATH_DEFINES)
else()
  set(MINISPICE_WARNINGS -Wall -Wextra -Wpedantic)
endif()

add_library(minispice_core STATIC
  src/component.cpp
  src/netlist.cpp
  src/mna_result.cpp
  src/dc_solver.cpp
  src/transient_solver.cpp
  src/ac_solver.cpp
)
target_include_directories(minispice_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_options(minispice_core PRIVATE ${MINISPICE_WARNINGS})

if(MINISPICE_ENABLE_SANITIZERS)
  target_compile_options(minispice_core PUBLIC -fsanitize=address,undefined -fno-omit-frame-pointer -g)
  target_link_options(minispice_core PUBLIC -fsanitize=address,undefined)
endif()

add_executable(minispice cli/main.cpp)
target_link_libraries(minispice PRIVATE minispice_core)
target_compile_options(minispice PRIVATE ${MINISPICE_WARNINGS})

if(MINISPICE_BUILD_TESTS)
  enable_testing()
  include(FetchContent)
  FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG v3.7.1
  )
  FetchContent_MakeAvailable(Catch2)

  add_executable(minispice_tests
    tests/unit/test_matrix.cpp
    tests/unit/test_netlist.cpp
    tests/unit/test_components.cpp
    tests/unit/test_dc.cpp
    tests/unit/test_transient_analytic.cpp
    tests/unit/test_ac_analytic.cpp
    tests/unit/test_convergence.cpp
    tests/unit/test_edge_cases.cpp
    tests/unit/test_diode.cpp
    tests/unit/test_bjt.cpp
    tests/unit/test_controlled_sources.cpp
    tests/unit/test_waveforms.cpp
    tests/regression/test_golden.cpp
  )
  target_link_libraries(minispice_tests PRIVATE minispice_core Catch2::Catch2WithMain)
  target_include_directories(minispice_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  target_compile_options(minispice_tests PRIVATE ${MINISPICE_WARNINGS})
  target_compile_definitions(minispice_tests PRIVATE
    MINISPICE_EXAMPLES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/examples"
    MINISPICE_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/golden"
  )

  include(${catch2_SOURCE_DIR}/extras/Catch.cmake)
  catch_discover_tests(minispice_tests)
endif()
