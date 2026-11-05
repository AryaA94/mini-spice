"""SQLite transfer history.

Three tables:
  loggers    one row per physical logger (keyed by the ID the logger reports)
  sessions   one row per recording session seen in a logger's manifest
  transfers  one row per download attempt (the audit trail)

Schema changes go in MIGRATIONS; PRAGMA user_version tracks which have run.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# Session status values
PENDING = "pending"          # seen in manifest, not yet downloaded
DOWNLOADING = "downloading"  # a transfer is in progress (or was interrupted)
VERIFIED = "verified"        # on disk, size + SHA-256 + content checks passed
FAILED = "failed"            # retries exhausted; `envi-daq retry` re-queues it
INVALID = "invalid"          # bytes match the logger's checksum but content is malformed
CONFLICT = "conflict"        # logger now reports a different checksum for a verified session
STATUSES = (PENDING, DOWNLOADING, VERIFIED, FAILED, INVALID, CONFLICT)

MIGRATIONS = [
    # v1
    """
    CREATE TABLE loggers (
        logger_id   TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        base_url    TEXT NOT NULL,
        firmware    TEXT,
        last_seen   TEXT
    );
    CREATE TABLE sessions (
        logger_id     TEXT NOT NULL REFERENCES loggers(logger_id),
        session_id    TEXT NOT NULL,
        started_at    TEXT,
        ended_at      TEXT,
        size_bytes    INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        local_path    TEXT,
        row_count     INTEGER,
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        first_seen    TEXT NOT NULL,
        completed_at  TEXT,
        PRIMARY KEY (logger_id, session_id)
    );
    CREATE TABLE transfers (
        transfer_id     INTEGER PRIMARY KEY AUTOINCREMENT,
        logger_id       TEXT NOT NULL,
        session_id      TEXT NOT NULL,
        attempt         INTEGER NOT NULL,
        started_at      TEXT NOT NULL,
        finished_at     TEXT,
        resumed_from    INTEGER NOT NULL DEFAULT 0,
        bytes_received  INTEGER NOT NULL DEFAULT 0,
        duration_s      REAL,
        outcome         TEXT,
        error           TEXT,
        FOREIGN KEY (logger_id, session_id) REFERENCES sessions(logger_id, session_id)
    );
    CREATE INDEX ix_transfers_session ON transfers(logger_id, session_id);
    CREATE INDEX ix_sessions_status ON sessions(status);
    """,
    # v2: Wi-Fi link health, one row per contact attempt with a logger
    """
    CREATE TABLE link_samples (
        sample_id    INTEGER PRIMARY KEY AUTOINCREMENT,
        logger_name  TEXT NOT NULL,
        logger_id    TEXT,
        sampled_at   TEXT NOT NULL,
        reachable    INTEGER NOT NULL,
        rssi_dbm     INTEGER,
        latency_ms   REAL,
        error        TEXT
    );
    CREATE INDEX ix_link_samples ON link_samples(logger_name, sample_id);
    """,
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class Session:
    logger_id: str
    session_id: str
    started_at: str | None
    ended_at: str | None
    size_bytes: int
    sha256: str
    status: str = PENDING
    local_path: str | None = None
    row_count: int | None = None
    attempts: int = 0
    last_error: str | None = None
    first_seen: str | None = None
    completed_at: str | None = None


class HistoryDB:
    def __init__(self, path: str | Path):
        path = Path(path)
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.migrate()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @property
    def schema_version(self) -> int:
        return self.conn.execute("PRAGMA user_version").fetchone()[0]

    def migrate(self) -> None:
        version = self.schema_version
        for i, script in enumerate(MIGRATIONS[version:], start=version + 1):
            self.conn.executescript(f"BEGIN; {script}; PRAGMA user_version = {i}; COMMIT;")

    # -- loggers -----------------------------------------------------------

    def upsert_logger(self, logger_id: str, name: str, base_url: str, firmware: str | None) -> None:
        with self.conn:
            self.conn.execute(
                """INSERT INTO loggers (logger_id, name, base_url, firmware, last_seen)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(logger_id) DO UPDATE SET
                     name = excluded.name, base_url = excluded.base_url,
                     firmware = excluded.firmware, last_seen = excluded.last_seen""",
                (logger_id, name, base_url, firmware, now()),
            )

    def loggers(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM loggers ORDER BY name").fetchall()

    # -- sessions ----------------------------------------------------------

    def record_manifest_entry(self, s: Session) -> str:
        """Insert or reconcile a session from a logger's manifest. Returns its status."""
        row = self.conn.execute(
            "SELECT * FROM sessions WHERE logger_id = ? AND session_id = ?",
            (s.logger_id, s.session_id),
        ).fetchone()
        with self.conn:
            if row is None:
                self.conn.execute(
                    """INSERT INTO sessions (logger_id, session_id, started_at, ended_at,
                         size_bytes, sha256, status, first_seen)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (s.logger_id, s.session_id, s.started_at, s.ended_at,
                     s.size_bytes, s.sha256, PENDING, now()),
                )
                return PENDING
            if row["sha256"] == s.sha256 and row["size_bytes"] == s.size_bytes:
                return row["status"]
            if row["status"] == VERIFIED:
                # Never overwrite a verified file; flag it for a human.
                self.conn.execute(
                    """UPDATE sessions SET status = ?, last_error = ?
                       WHERE logger_id = ? AND session_id = ?""",
                    (CONFLICT,
                     f"logger now reports size={s.size_bytes} sha256={s.sha256[:12]}...; "
                     f"archived copy has size={row['size_bytes']} sha256={row['sha256'][:12]}...",
                     s.logger_id, s.session_id),
                )
                return CONFLICT
            # Not yet archived: adopt the logger's new manifest values and start over.
            self.conn.execute(
                """UPDATE sessions SET size_bytes = ?, sha256 = ?, started_at = ?, ended_at = ?,
                     status = ?, last_error = NULL
                   WHERE logger_id = ? AND session_id = ?""",
                (s.size_bytes, s.sha256, s.started_at, s.ended_at, PENDING,
                 s.logger_id, s.session_id),
            )
            return PENDING

    def sessions(self, logger_id: str | None = None, status: str | None = None) -> list[Session]:
        sql, args = "SELECT * FROM sessions WHERE 1=1", []
        if logger_id:
            sql += " AND logger_id = ?"
            args.append(logger_id)
        if status:
            sql += " AND status = ?"
            args.append(status)
        sql += " ORDER BY logger_id, session_id"
        return [_session(r) for r in self.conn.execute(sql, args)]

    def session(self, logger_id: str, session_id: str) -> Session | None:
        r = self.conn.execute(
            "SELECT * FROM sessions WHERE logger_id = ? AND session_id = ?",
            (logger_id, session_id),
        ).fetchone()
        return _session(r) if r else None

    def find_sessions(self, session_id: str) -> list[Session]:
        return [_session(r) for r in self.conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,))]

    def needing_download(self, logger_id: str) -> list[Session]:
        return [_session(r) for r in self.conn.execute(
            "SELECT * FROM sessions WHERE logger_id = ? AND status IN (?, ?) ORDER BY session_id",
            (logger_id, PENDING, DOWNLOADING),
        )]

    def set_status(self, logger_id: str, session_id: str, status: str, *,
                   error: str | None = None, local_path: str | None = None,
                   row_count: int | None = None) -> None:
        assert status in STATUSES, status
        with self.conn:
            self.conn.execute(
                """UPDATE sessions SET status = ?, last_error = ?,
                     local_path = COALESCE(?, local_path),
                     row_count = COALESCE(?, row_count),
                     completed_at = CASE WHEN ? = 'verified' THEN ? ELSE completed_at END
                   WHERE logger_id = ? AND session_id = ?""",
                (status, error, local_path, row_count, status, now(), logger_id, session_id),
            )

    def requeue(self, logger_id: str | None = None, session_id: str | None = None,
                statuses: tuple[str, ...] = (FAILED,)) -> int:
        sql = f"UPDATE sessions SET status = 'pending', last_error = NULL WHERE status IN ({','.join('?' * len(statuses))})"
        args: list = list(statuses)
        if logger_id:
            sql += " AND logger_id = ?"
            args.append(logger_id)
        if session_id:
            sql += " AND session_id = ?"
            args.append(session_id)
        with self.conn:
            return self.conn.execute(sql, args).rowcount

    def counts(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for r in self.conn.execute(
            "SELECT logger_id, status, COUNT(*) n FROM sessions GROUP BY logger_id, status"
        ):
            out.setdefault(r["logger_id"], {})[r["status"]] = r["n"]
        return out

    # -- link health -------------------------------------------------------

    def add_link_sample(self, logger_name: str, logger_id: str | None, reachable: bool,
                        rssi_dbm: int | None = None, latency_ms: float | None = None,
                        error: str | None = None) -> None:
        with self.conn:
            self.conn.execute(
                """INSERT INTO link_samples (logger_name, logger_id, sampled_at, reachable,
                     rssi_dbm, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (logger_name, logger_id, now(), int(reachable), rssi_dbm,
                 None if latency_ms is None else round(latency_ms, 1), error),
            )

    def link_samples(self, logger_name: str, limit: int = 40) -> list[sqlite3.Row]:
        """Most recent samples for one logger, oldest first."""
        rows = self.conn.execute(
            "SELECT * FROM link_samples WHERE logger_name = ? ORDER BY sample_id DESC LIMIT ?",
            (logger_name, limit),
        ).fetchall()
        return rows[::-1]

    def transfer_stats(self) -> dict[str, dict]:
        """Per-logger attempt counts, success rate and effective throughput."""
        out = {}
        for r in self.conn.execute(
            """SELECT logger_id, COUNT(*) attempts, SUM(outcome = 'ok') ok,
                      SUM(outcome = 'retry') retries, SUM(bytes_received) bytes,
                      SUM(duration_s) seconds, SUM(resumed_from > 0) resumes
               FROM transfers WHERE finished_at IS NOT NULL GROUP BY logger_id"""
        ):
            secs = r["seconds"] or 0
            out[r["logger_id"]] = {
                "attempts": r["attempts"], "ok": r["ok"] or 0, "retries": r["retries"] or 0,
                "resumes": r["resumes"] or 0, "bytes": r["bytes"] or 0,
                "success_rate": round((r["ok"] or 0) / r["attempts"], 3) if r["attempts"] else None,
                "throughput_bps": round((r["bytes"] or 0) / secs) if secs > 0 else None,
            }
        return out

    # -- transfers ---------------------------------------------------------

    def start_transfer(self, logger_id: str, session_id: str, resumed_from: int) -> tuple[int, int]:
        """Open a transfer row. Returns (transfer_id, attempt number for this session)."""
        with self.conn:
            self.conn.execute(
                """UPDATE sessions SET attempts = attempts + 1, status = ?
                   WHERE logger_id = ? AND session_id = ?""",
                (DOWNLOADING, logger_id, session_id),
            )
            attempt = self.conn.execute(
                "SELECT attempts FROM sessions WHERE logger_id = ? AND session_id = ?",
                (logger_id, session_id),
            ).fetchone()[0]
            cur = self.conn.execute(
                """INSERT INTO transfers (logger_id, session_id, attempt, started_at, resumed_from)
                   VALUES (?, ?, ?, ?, ?)""",
                (logger_id, session_id, attempt, now(), resumed_from),
            )
        return cur.lastrowid, attempt

    def finish_transfer(self, transfer_id: int, outcome: str, bytes_received: int,
                        duration_s: float, error: str | None = None) -> None:
        with self.conn:
            self.conn.execute(
                """UPDATE transfers SET finished_at = ?, outcome = ?, bytes_received = ?,
                     duration_s = ?, error = ?
                   WHERE transfer_id = ?""",
                (now(), outcome, bytes_received, round(duration_s, 3), error, transfer_id),
            )

    def close_dangling_transfers(self) -> int:
        """Mark transfers left open by a crashed/killed run."""
        with self.conn:
            return self.conn.execute(
                """UPDATE transfers SET outcome = 'aborted', finished_at = ?,
                     error = 'process exited before transfer finished'
                   WHERE finished_at IS NULL""",
                (now(),),
            ).rowcount

    def transfers(self, logger_id: str | None = None, session_id: str | None = None,
                  limit: int | None = 50) -> list[sqlite3.Row]:
        sql, args = "SELECT * FROM transfers WHERE 1=1", []
        if logger_id:
            sql += " AND logger_id = ?"
            args.append(logger_id)
        if session_id:
            sql += " AND session_id = ?"
            args.append(session_id)
        sql += " ORDER BY transfer_id DESC"
        if limit:
            sql += f" LIMIT {int(limit)}"
        return self.conn.execute(sql, args).fetchall()


def _session(r: sqlite3.Row) -> Session:
    return Session(
        logger_id=r["logger_id"], session_id=r["session_id"],
        started_at=r["started_at"], ended_at=r["ended_at"],
        size_bytes=r["size_bytes"], sha256=r["sha256"], status=r["status"],
        local_path=r["local_path"], row_count=r["row_count"],
        attempts=r["attempts"], last_error=r["last_error"],
        first_seen=r["first_seen"], completed_at=r["completed_at"],
    )
