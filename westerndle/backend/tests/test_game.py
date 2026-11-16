import pytest

from app.game import (
    Building,
    bearing_deg,
    compare_numeric,
    compass_point,
    haversine_m,
    proximity_pct,
    score_guess,
)


def b(id, lat, lon, zone="Core", category="Academic", year=1960, floors=4):
    return Building(id, id.upper(), lat, lon, zone, category, year, floors)


def test_haversine_known_distance():
    # One thousandth of a degree of latitude is ~111 m anywhere on Earth.
    assert haversine_m(43.000, -81.0, 43.001, -81.0) == pytest.approx(111.2, abs=0.5)


def test_haversine_zero():
    assert haversine_m(43.0, -81.0, 43.0, -81.0) == 0


@pytest.mark.parametrize(
    "dlat, dlon, expected",
    [(0.01, 0, "N"), (-0.01, 0, "S"), (0, 0.01, "E"), (0, -0.01, "W"), (0.01, 0.0137, "NE"), (-0.01, -0.0137, "SW")],
)
def test_bearing_compass(dlat, dlon, expected):
    # 0.0137 deg of longitude at 43 N is about the same distance as 0.01 deg of latitude.
    assert compass_point(bearing_deg(43.0, -81.0, 43.0 + dlat, -81.0 + dlon)) == expected


@pytest.mark.parametrize("bearing, point", [(0, "N"), (22.4, "N"), (22.5, "NE"), (337.5, "N"), (359.9, "N"), (180, "S")])
def test_compass_boundaries(bearing, point):
    assert compass_point(bearing) == point


def test_proximity_clamps():
    assert proximity_pct(0) == 100
    assert proximity_pct(1250) == 50
    assert proximity_pct(10_000) == 0


@pytest.mark.parametrize(
    "guess, answer, window, expected",
    [
        (1960, 1960, 10, ("correct", None)),
        (1955, 1960, 10, ("close", "higher")),
        (1975, 1960, 10, ("wrong", "lower")),
        (1970, 1960, 10, ("close", "lower")),
        (3, 4, 1, ("close", "higher")),
        (2, 4, 1, ("wrong", "higher")),
    ],
)
def test_compare_numeric(guess, answer, window, expected):
    assert compare_numeric(guess, answer, window) == expected


def test_score_correct_guess():
    a = b("x", 43.0, -81.0)
    r = score_guess(a, a)
    assert r["correct"] and r["distanceM"] == 0 and r["direction"] is None and r["proximity"] == 100
    assert all(r[k]["match"] == "correct" for k in ("zone", "category", "yearBuilt", "floors"))


def test_score_wrong_guess():
    g = b("g", 43.0, -81.0, zone="South", category="Engineering", year=1958, floors=4)
    a = b("a", 43.002, -81.0, zone="Core", category="Engineering", year=1966, floors=6)
    r = score_guess(g, a)
    assert not r["correct"]
    assert r["direction"] == "N"
    assert r["distanceM"] == pytest.approx(222, abs=1)
    assert r["zone"]["match"] == "wrong"
    assert r["category"]["match"] == "correct"
    assert r["yearBuilt"] == {"value": 1958, "match": "close", "hint": "higher"}
    assert r["floors"] == {"value": 4, "match": "wrong", "hint": "higher"}
