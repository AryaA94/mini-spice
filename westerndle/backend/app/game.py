"""Pure scoring logic: compare a guessed building against the answer.

No database or HTTP here, so every rule is unit-tested in isolation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

EARTH_RADIUS_M = 6_371_000.0

# The widest spread on campus (Brescia to King's) is ~2.2 km; anything at or
# beyond this distance scores 0% proximity.
MAX_CAMPUS_DISTANCE_M = 2_500.0

# Within this many years a "built" guess counts as close.
YEAR_CLOSE_WINDOW = 10
# Within this many floors a "floors" guess counts as close.
FLOORS_CLOSE_WINDOW = 1

Match = Literal["correct", "close", "wrong"]
Hint = Literal["higher", "lower", None]

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


@dataclass(frozen=True)
class Building:
    id: str
    name: str
    lat: float
    lon: float
    zone: str
    category: str
    year_built: int
    floors: int


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing from point 1 to point 2, degrees clockwise from north, in [0, 360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def compass_point(bearing: float) -> str:
    """Snap a bearing to one of 8 compass points."""
    return COMPASS[int(((bearing % 360) + 22.5) // 45) % 8]


def proximity_pct(distance_m: float) -> int:
    """100 at the answer, falling linearly to 0 at MAX_CAMPUS_DISTANCE_M."""
    frac = max(0.0, 1.0 - distance_m / MAX_CAMPUS_DISTANCE_M)
    return round(frac * 100)


def compare_numeric(guess: int, answer: int, close_window: int) -> tuple[Match, Hint]:
    """Exact = correct; within the window = close. The hint says which way the answer lies."""
    if guess == answer:
        return "correct", None
    match: Match = "close" if abs(guess - answer) <= close_window else "wrong"
    return match, ("higher" if answer > guess else "lower")


def compare_category(guess: str, answer: str) -> Match:
    return "correct" if guess == answer else "wrong"


def score_guess(guess: Building, answer: Building) -> dict:
    """Feedback for one guess, shaped for the JSON API."""
    if guess.id == answer.id:
        dist, direction = 0.0, None
    else:
        dist = haversine_m(guess.lat, guess.lon, answer.lat, answer.lon)
        direction = compass_point(bearing_deg(guess.lat, guess.lon, answer.lat, answer.lon))

    year_match, year_hint = compare_numeric(guess.year_built, answer.year_built, YEAR_CLOSE_WINDOW)
    floor_match, floor_hint = compare_numeric(guess.floors, answer.floors, FLOORS_CLOSE_WINDOW)

    return {
        "buildingId": guess.id,
        "name": guess.name,
        "correct": guess.id == answer.id,
        "zone": {"value": guess.zone, "match": compare_category(guess.zone, answer.zone)},
        "category": {"value": guess.category, "match": compare_category(guess.category, answer.category)},
        "yearBuilt": {"value": guess.year_built, "match": year_match, "hint": year_hint},
        "floors": {"value": guess.floors, "match": floor_match, "hint": floor_hint},
        "distanceM": round(dist),
        "direction": direction,
        "proximity": proximity_pct(dist),
    }
