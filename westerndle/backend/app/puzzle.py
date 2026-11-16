"""Which building is the answer: the daily schedule and signed practice tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import random
import secrets
from datetime import date, datetime
from zoneinfo import ZoneInfo

CAMPUS_TZ = ZoneInfo("America/Toronto")
# Puzzle #1 is this date; the number shown to players counts up from here.
LAUNCH_DATE = date(2026, 9, 1)


def today_on_campus(now: datetime | None = None) -> date:
    """The current date in London, Ontario, so the puzzle rolls over at local midnight."""
    now = now or datetime.now(tz=CAMPUS_TZ)
    return now.astimezone(CAMPUS_TZ).date()


def puzzle_number(day: date) -> int:
    return (day - LAUNCH_DATE).days + 1


def date_for_puzzle(number: int) -> date:
    return date.fromordinal(LAUNCH_DATE.toordinal() + number - 1)


def daily_answer_id(day: date, building_ids: list[str], secret: str) -> str:
    """Deterministic, secret-seeded schedule with no repeats inside a cycle.

    Each cycle of len(building_ids) days uses a fresh shuffle, so every building
    appears exactly once per cycle, and the order can't be guessed from the
    public source without the secret.
    """
    ids = sorted(building_ids)
    n = len(ids)
    offset = puzzle_number(day) - 1
    cycle, index = divmod(offset, n)
    rng = random.Random(f"{secret}:{cycle}")
    rng.shuffle(ids)
    return ids[index]


# --- practice mode -----------------------------------------------------------
# The answer travels with the client as an opaque, signed token so practice
# games stay stateless on the server and the answer isn't readable in devtools.


def _sign(payload: bytes, secret: str) -> bytes:
    return hmac.new(secret.encode(), payload, hashlib.sha256).digest()[:16]


def _xor(data: bytes, key: bytes) -> bytes:
    stream = hashlib.sha256(key).digest()
    while len(stream) < len(data):
        stream += hashlib.sha256(stream).digest()
    return bytes(a ^ b for a, b in zip(data, stream))


def make_practice_token(building_id: str, secret: str) -> str:
    nonce = secrets.token_bytes(8)
    hidden = _xor(building_id.encode(), nonce + secret.encode())
    body = nonce + hidden
    return base64.urlsafe_b64encode(body + _sign(body, secret)).decode().rstrip("=")


def read_practice_token(token: str, secret: str) -> str | None:
    """Return the building id, or None if the token is malformed or forged."""
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    except (ValueError, TypeError):
        return None
    if len(raw) < 8 + 1 + 16:
        return None
    body, sig = raw[:-16], raw[-16:]
    if not hmac.compare_digest(sig, _sign(body, secret)):
        return None
    nonce, hidden = body[:8], body[8:]
    try:
        return _xor(hidden, nonce + secret.encode()).decode()
    except UnicodeDecodeError:
        return None
