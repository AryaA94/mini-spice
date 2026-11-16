from datetime import date, datetime, timezone

from app import puzzle as pz

IDS = [f"b{i}" for i in range(40)]


def test_puzzle_numbering_round_trips():
    assert pz.puzzle_number(pz.LAUNCH_DATE) == 1
    for n in (1, 2, 77, 1000):
        assert pz.puzzle_number(pz.date_for_puzzle(n)) == n


def test_daily_is_deterministic():
    d = date(2026, 11, 16)
    assert pz.daily_answer_id(d, IDS, "s") == pz.daily_answer_id(d, list(reversed(IDS)), "s")


def test_no_repeats_within_a_cycle():
    days = [pz.date_for_puzzle(n) for n in range(1, len(IDS) + 1)]
    answers = [pz.daily_answer_id(d, IDS, "s") for d in days]
    assert sorted(answers) == sorted(IDS)


def test_schedule_depends_on_secret():
    days = [pz.date_for_puzzle(n) for n in range(1, 11)]
    assert [pz.daily_answer_id(d, IDS, "a") for d in days] != [pz.daily_answer_id(d, IDS, "b") for d in days]


def test_rollover_uses_campus_time():
    # 03:00 UTC on Nov 17 is still 22:00 on Nov 16 in London, Ontario.
    assert pz.today_on_campus(datetime(2026, 11, 17, 3, 0, tzinfo=timezone.utc)) == date(2026, 11, 16)


def test_practice_token_round_trip():
    t = pz.make_practice_token("ucc", "s")
    assert "ucc" not in t
    assert pz.read_practice_token(t, "s") == "ucc"


def test_practice_token_rejects_tampering():
    t = pz.make_practice_token("ucc", "s")
    assert pz.read_practice_token(t, "other-secret") is None
    flipped = t[:-3] + ("A" if t[-3] != "A" else "B") + t[-2:]
    assert pz.read_practice_token(flipped, "s") is None
    assert pz.read_practice_token("not a token!!", "s") is None
