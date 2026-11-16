from app import puzzle as pz
from app.main import MAX_GUESSES


def today():
    return pz.puzzle_number(pz.today_on_campus())


def test_buildings_list_hides_attributes(client):
    r = client.get("/api/buildings")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 30
    assert set(data[0]) == {"id", "name", "aliases"}


def test_daily_meta(client):
    r = client.get("/api/daily").json()
    assert r["puzzle"] == today() and r["maxGuesses"] == MAX_GUESSES


def find_daily_answer(client):
    for b in client.get("/api/buildings").json():
        r = client.post("/api/guess", json={"mode": "daily", "puzzle": today(), "buildingId": b["id"]}).json()
        if r["correct"]:
            return b["id"]
    raise AssertionError("no building was correct")


def test_exactly_one_daily_answer(client):
    hits = [
        b["id"]
        for b in client.get("/api/buildings").json()
        if client.post("/api/guess", json={"mode": "daily", "puzzle": today(), "buildingId": b["id"]}).json()["correct"]
    ]
    assert len(hits) == 1


def test_guess_feedback_shape(client):
    r = client.post("/api/guess", json={"mode": "daily", "puzzle": today(), "buildingId": "uc"})
    assert r.status_code == 200
    body = r.json()
    for key in ("zone", "category", "yearBuilt", "floors", "distanceM", "direction", "proximity"):
        assert key in body


def test_unknown_building_404(client):
    r = client.post("/api/guess", json={"mode": "daily", "puzzle": today(), "buildingId": "nope"})
    assert r.status_code == 404


def test_inactive_puzzle_rejected(client):
    r = client.post("/api/guess", json={"mode": "daily", "puzzle": today() - 5, "buildingId": "uc"})
    assert r.status_code == 409


def test_reveal_requires_all_guesses(client):
    body = {"mode": "daily", "puzzle": today(), "guesses": MAX_GUESSES - 1}
    assert client.post("/api/reveal", json=body).status_code == 403
    body["guesses"] = MAX_GUESSES
    r = client.post("/api/reveal", json=body)
    assert r.status_code == 200 and r.json()["id"] == find_daily_answer(client)


def test_practice_flow(client):
    token = client.post("/api/practice").json()["token"]
    answer = client.post("/api/reveal", json={"mode": "practice", "token": token, "guesses": MAX_GUESSES}).json()["id"]
    r = client.post("/api/guess", json={"mode": "practice", "token": token, "buildingId": answer}).json()
    assert r["correct"]


def test_practice_bad_token(client):
    r = client.post("/api/guess", json={"mode": "practice", "token": "garbage", "buildingId": "uc"})
    assert r.status_code == 400


def test_results_and_stats(client):
    p = today()
    for won, guesses in [(True, 3), (True, 3), (True, 5), (False, MAX_GUESSES)]:
        assert client.post("/api/results", json={"puzzle": p, "won": won, "guesses": guesses}).status_code == 201
    s = client.get(f"/api/stats/{p}").json()
    assert s["plays"] == 4 and s["wins"] == 3
    assert s["distribution"][2] == 2 and s["distribution"][4] == 1


def test_results_validation(client):
    assert client.post("/api/results", json={"puzzle": today(), "won": True, "guesses": 0}).status_code == 422
    assert client.post("/api/results", json={"puzzle": today(), "won": True, "guesses": MAX_GUESSES + 1}).status_code == 422
