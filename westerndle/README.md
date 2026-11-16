# Westerndle

A daily "-dle" guessing game for **Western University** campus buildings. Every
day there's a new mystery building. Each guess shows how close you are: the
campus zone, the building type, the year it was built, how many floors it has,
and the distance and compass direction to the answer.

- **Daily mode**: one building per day, rolling over at midnight London, ON time. It tracks
  your streaks and win %, and shows how everyone else did.
- **Practice mode**: unlimited random buildings.
- **Share**: a spoiler-free emoji grid, Wordle-style.

*Fan-made. Not affiliated with or endorsed by Western University.*

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript (strict), Tailwind CSS 4, Vite, Vitest |
| Backend | Python 3.13, FastAPI, SQLAlchemy 2, Pydantic |
| Database | PostgreSQL 16 (SQLite works for quick local runs) |
| Testing | pytest (run against both SQLite and PostgreSQL), Vitest |
| Ops | Docker, Docker Compose, GitHub Actions CI |

### Design notes

- **The answer never reaches the browser early.** Guesses are scored on the
  server (`backend/app/game.py`). The browser only gets feedback, so you can't
  find the answer in devtools or the JS bundle.
- **Daily schedule.** The schedule is shuffled with a secret seed and has no
  repeats inside a cycle: every building comes up exactly once per cycle, and
  without `WESTERNDLE_SECRET` the order can't be predicted from the source
  (`backend/app/puzzle.py`).
- **Stateless practice games.** The answer travels with the client in an
  HMAC-signed, obfuscated token. The server stores nothing per game, and a
  token that has been tampered with is rejected.
- **Geometry.** Distance uses the haversine great-circle formula. Direction is
  the initial bearing, snapped to 8 compass points.
- **Global stats.** Finished daily games are stored in PostgreSQL and
  aggregated into a per-puzzle guess distribution.

## Run it

With Docker (PostgreSQL + app on http://localhost:8000):

```bash
docker compose up --build
```

Local development (two terminals):

```bash
cd backend && pip install -r requirements-dev.txt && uvicorn app.main:app --reload
```

```bash
cd frontend && npm install && npm run dev
```

Without `DATABASE_URL` the backend uses a local SQLite file. Point it at
Postgres with `DATABASE_URL=postgresql://user:pass@host/db`.

Tests:

```bash
cd backend && pytest
```

```bash
cd frontend && npm test && npm run typecheck
```

## Editing the building list

All buildings live in `backend/data/buildings.json` and are loaded into the
database on startup.

> **The starter data is approximate.** It was written from memory, so check
> the coordinates, construction years and floor counts against a campus map and
> Western's facilities pages before you launch.

To add a photo for a building, put the image in `frontend/public/photos/` and
set `"photo": "photos/<file>.jpg"`. Only use photos you took yourself or that
are licensed for reuse. The photo is shown on the end-of-game card.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/buildings` | Names and aliases for the autocomplete |
| GET | `/api/daily` | Today's puzzle number and the guess limit |
| POST | `/api/practice` | Start a practice game (returns a token) |
| POST | `/api/guess` | Score a guess |
| POST | `/api/reveal` | Get the answer once all guesses are used |
| POST | `/api/results` | Record a finished daily game |
| GET | `/api/stats/{puzzle}` | Global results for one puzzle |
