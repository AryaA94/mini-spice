"""Westerndle HTTP API (FastAPI).

The answer never reaches the browser before the game ends: guesses are scored
here, and the client only ever learns the answer by guessing it or by using
up all its guesses.
"""

from __future__ import annotations

import os
import random
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import puzzle as pz
from .db import BuildingRow, PlayRow, init_db, make_engine, play_stats, session_factory
from .game import Building, score_guess

MAX_GUESSES = 8


# --- request bodies ---

class GuessIn(BaseModel):
    mode: Literal["daily", "practice"]
    buildingId: str
    puzzle: int | None = None
    token: str | None = None

class RevealIn(BaseModel):
    mode: Literal["daily", "practice"]
    guesses: int = Field(ge=0)
    puzzle: int | None = None
    token: str | None = None

class ResultIn(BaseModel):
    puzzle: int
    won: bool
    guesses: int = Field(ge=1, le=MAX_GUESSES)


def _secret() -> str:
    return os.environ.get("WESTERNDLE_SECRET", "dev-secret-change-me")


def _to_building(r: BuildingRow) -> Building:
    return Building(r.id, r.name, r.lat, r.lon, r.zone, r.category, r.year_built, r.floors)


def create_app(database_url: str | None = None, static_dir: Path | None = None) -> FastAPI:
    engine = make_engine(database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(engine)
        with session_factory(engine)() as s:
            app.state.buildings = {r.id: r for r in s.scalars(select(BuildingRow))}
        yield
        engine.dispose()

    app = FastAPI(title="Westerndle API", lifespan=lifespan)
    Session = session_factory(engine)

    def buildings(request: Request) -> dict[str, BuildingRow]:
        return request.app.state.buildings

    def building_or_404(request: Request, building_id: str) -> BuildingRow:
        b = buildings(request).get(building_id)
        if b is None:
            raise HTTPException(404, f"unknown building '{building_id}'")
        return b

    def answer_for(request: Request, mode: str, puzzle: int | None, token: str | None) -> BuildingRow:
        if mode == "daily":
            if puzzle is None:
                raise HTTPException(422, "daily guesses need a puzzle number")
            today = pz.puzzle_number(pz.today_on_campus())
            # Allow yesterday's puzzle so a game started before midnight can finish.
            if puzzle not in (today, today - 1):
                raise HTTPException(409, "that puzzle is not active")
            answer_id = pz.daily_answer_id(pz.date_for_puzzle(puzzle), list(buildings(request)), _secret())
        else:
            answer_id = pz.read_practice_token(token or "", _secret())
            if answer_id is None:
                raise HTTPException(400, "invalid practice token")
        return building_or_404(request, answer_id)

    # --- routes ---------------------------------------------------------------

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/buildings")
    def list_buildings(request: Request):
        """Names for the autocomplete. Attributes are only revealed by guessing."""
        rows = sorted(buildings(request).values(), key=lambda r: r.name)
        return [{"id": r.id, "name": r.name, "aliases": r.aliases} for r in rows]

    @app.get("/api/daily")
    def daily():
        day = pz.today_on_campus()
        return {"puzzle": pz.puzzle_number(day), "date": day.isoformat(), "maxGuesses": MAX_GUESSES}

    @app.post("/api/practice")
    def new_practice(request: Request):
        answer = random.choice(list(buildings(request)))
        return {"token": pz.make_practice_token(answer, _secret()), "maxGuesses": MAX_GUESSES}

    @app.post("/api/guess")
    def guess(body: GuessIn, request: Request):
        g = building_or_404(request, body.buildingId)
        answer = answer_for(request, body.mode, body.puzzle, body.token)
        result = score_guess(_to_building(g), _to_building(answer))
        result["photo"] = g.photo
        return result

    @app.post("/api/reveal")
    def reveal(body: RevealIn, request: Request):
        """The answer, once a player has used all their guesses."""
        if body.guesses < MAX_GUESSES:
            raise HTTPException(403, "keep guessing")
        a = answer_for(request, body.mode, body.puzzle, body.token)
        return {"id": a.id, "name": a.name, "lat": a.lat, "lon": a.lon, "photo": a.photo}

    @app.post("/api/results", status_code=201)
    def record_result(body: ResultIn):
        today = pz.puzzle_number(pz.today_on_campus())
        if body.puzzle not in (today, today - 1):
            raise HTTPException(409, "that puzzle is not active")
        with Session() as s, s.begin():
            s.add(PlayRow(puzzle=body.puzzle, won=body.won, guesses=body.guesses))
        return {"ok": True}

    @app.get("/api/stats/{puzzle}")
    def stats(puzzle: int):
        with Session() as s:
            return play_stats(s, puzzle, MAX_GUESSES)

    # --- built frontend (production) -------------------------------------------
    static_dir = static_dir or Path(os.environ.get("WESTERNDLE_STATIC", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    if static_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            f = (static_dir / path).resolve()
            if path and f.is_file() and static_dir.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()
