"""Session download engine: resume, verify, retry, record.

For each session a logger reports as closed and that isn't archived yet:

  1. Stream it into  <data_dir>/<logger_id>/<session_id>.csv.part,
     resuming from the .part's current size with an HTTP Range request.
  2. When the byte count reaches the manifest size, check SHA-256 and content.
  3. On success, atomically rename .part -> .csv and mark the session verified.
  4. On a transient failure (Wi-Fi drop, timeout, 5xx, short read), back off
     and retry, keeping the partial file so the next attempt resumes.
     A checksum mismatch also retries, but discards the partial first.
  5. Every attempt is a row in the `transfers` table.
"""

from __future__ import annotations

import logging
import os
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from envi_daq import db as dbm
from envi_daq.client import LoggerClient, LoggerError, RangeNotSatisfiable
from envi_daq.config import LoggerConfig, RetryPolicy
from envi_daq.verify import check_content, sha256_file

log = logging.getLogger("envi_daq")

ProgressFn = Callable[[str, int, int], None]  # (session_id, bytes_done, bytes_total)


class _Retry(Exception):
    """Attempt failed in a way worth retrying."""

    def __init__(self, msg: str, discard_partial: bool = False):
        super().__init__(msg)
        self.discard_partial = discard_partial


class _GiveUp(Exception):
    """Attempt failed in a way retrying won't fix."""

    def __init__(self, msg: str, status: str = dbm.FAILED):
        super().__init__(msg)
        self.status = status


@dataclass
class SessionResult:
    session_id: str
    status: str
    attempts: int
    bytes_received: int
    error: str | None = None


@dataclass
class SyncReport:
    logger_name: str
    logger_id: str | None = None
    reachable: bool = False
    error: str | None = None
    new_sessions: int = 0
    skipped_open: int = 0
    conflicts: int = 0
    results: list[SessionResult] = field(default_factory=list)

    @property
    def downloaded(self) -> list[SessionResult]:
        return [r for r in self.results if r.status == dbm.VERIFIED]

    @property
    def failed(self) -> list[SessionResult]:
        return [r for r in self.results if r.status != dbm.VERIFIED]

    @property
    def ok(self) -> bool:
        return self.reachable and not self.failed and not self.conflicts


def session_paths(data_dir: Path, logger_id: str, session_id: str) -> tuple[Path, Path]:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in session_id)
    final = data_dir / logger_id / f"{safe}.csv"
    return final, final.with_name(final.name + ".part")


class Downloader:
    def __init__(
        self,
        history: dbm.HistoryDB,
        data_dir: Path,
        retry: RetryPolicy = RetryPolicy(),
        chunk_size: int = 64 * 1024,
        sleep: Callable[[float], None] = time.sleep,
        rng: random.Random | None = None,
        progress: ProgressFn | None = None,
    ):
        self.db = history
        self.data_dir = Path(data_dir)
        self.retry = retry
        self.chunk_size = chunk_size
        self.sleep = sleep
        self.rng = rng or random.Random()
        self.progress = progress

    # -- whole logger --------------------------------------------------------

    def sync(self, logger: LoggerConfig, client: LoggerClient | None = None,
             only: set[str] | None = None, dry_run: bool = False) -> SyncReport:
        client = client or LoggerClient(logger.url, logger.timeout_s, logger.token)
        report = SyncReport(logger_name=logger.name)

        # Discovery: the logger may be out of Wi-Fi range; retry a few times.
        try:
            info, manifest = self._with_retries(
                lambda: (client.info(), client.sessions()), what=f"{logger.name}: discovery")
        except LoggerError as e:
            report.error = str(e)
            log.error("%s: unreachable: %s", logger.name, e)
            return report
        report.reachable = True
        logger_id = str(info["logger_id"])
        report.logger_id = logger_id
        self.db.upsert_logger(logger_id, logger.name, logger.url, info.get("firmware"))
        log.info("%s: connected to %s (firmware %s), %d sessions in manifest",
                 logger.name, logger_id, info.get("firmware", "?"), len(manifest))

        for m in manifest:
            if m.open:
                report.skipped_open += 1
                continue
            existing = self.db.session(logger_id, m.session_id)
            status = self.db.record_manifest_entry(dbm.Session(
                logger_id=logger_id, session_id=m.session_id, started_at=m.started_at,
                ended_at=m.ended_at, size_bytes=m.size_bytes, sha256=m.sha256))
            if existing is None:
                report.new_sessions += 1
            if status == dbm.CONFLICT:
                report.conflicts += 1
                log.warning("%s/%s: logger checksum changed after archiving; not overwriting",
                            logger_id, m.session_id)
            elif existing is not None and existing.status != dbm.PENDING and status == dbm.PENDING:
                # Manifest changed for a not-yet-archived session: stale partial is useless.
                _, part = session_paths(self.data_dir, logger_id, m.session_id)
                part.unlink(missing_ok=True)

        todo = self.db.needing_download(logger_id)
        if only:
            todo = [s for s in todo if s.session_id in only]
        if dry_run:
            report.results = [SessionResult(s.session_id, s.status, 0, 0, "dry run") for s in todo]
            return report
        for s in todo:
            report.results.append(self.download_session(client, s))
        return report

    # -- one session ---------------------------------------------------------

    def download_session(self, client: LoggerClient, s: dbm.Session) -> SessionResult:
        final, part = session_paths(self.data_dir, s.logger_id, s.session_id)
        final.parent.mkdir(parents=True, exist_ok=True)
        tag = f"{s.logger_id}/{s.session_id}"
        total_received = 0
        last_error = None

        for attempt in range(1, self.retry.max_attempts + 1):
            offset = part.stat().st_size if part.exists() else 0
            if offset > s.size_bytes:
                log.warning("%s: partial file larger than expected; restarting", tag)
                part.unlink()
                offset = 0
            transfer_id, _ = self.db.start_transfer(s.logger_id, s.session_id, offset)
            t0 = time.monotonic()
            received = 0
            try:
                received = self._fetch(client, s, part, offset, tag)
                total_received += received
                rows = self._verify(s, part)
                os.replace(part, final)
                self.db.finish_transfer(transfer_id, "ok", received, time.monotonic() - t0)
                self.db.set_status(s.logger_id, s.session_id, dbm.VERIFIED,
                                   local_path=str(final), row_count=rows)
                log.info("%s: verified (%d bytes, %d rows, attempt %d)",
                         tag, s.size_bytes, rows, attempt)
                return SessionResult(s.session_id, dbm.VERIFIED, attempt, total_received)
            except _Retry as e:
                received = max(received, _size(part) - offset, 0)
                total_received += received
                last_error = str(e)
                self.db.finish_transfer(transfer_id, "retry", received,
                                        time.monotonic() - t0, last_error)
                if e.discard_partial:
                    part.unlink(missing_ok=True)
                if attempt < self.retry.max_attempts:
                    delay = self.retry.delay(attempt, self.rng.random())
                    log.warning("%s: attempt %d/%d failed: %s; retrying in %.1fs",
                                tag, attempt, self.retry.max_attempts, e, delay)
                    self.sleep(delay)
                else:
                    log.error("%s: attempt %d/%d failed: %s; giving up for this run",
                              tag, attempt, self.retry.max_attempts, e)
            except _GiveUp as e:
                self.db.finish_transfer(transfer_id, "error", received,
                                        time.monotonic() - t0, str(e))
                self.db.set_status(s.logger_id, s.session_id, e.status, error=str(e))
                log.error("%s: %s", tag, e)
                return SessionResult(s.session_id, e.status, attempt, total_received, str(e))
            except BaseException as e:
                # KeyboardInterrupt etc.: record it; the .part is kept for resume.
                self.db.finish_transfer(transfer_id, "aborted", _size(part) - offset,
                                        time.monotonic() - t0, repr(e))
                self.db.set_status(s.logger_id, s.session_id, dbm.PENDING, error="interrupted")
                raise

        self.db.set_status(s.logger_id, s.session_id, dbm.FAILED, error=last_error)
        return SessionResult(s.session_id, dbm.FAILED, self.retry.max_attempts,
                             total_received, last_error)

    def _fetch(self, client: LoggerClient, s: dbm.Session, part: Path,
               offset: int, tag: str) -> int:
        """Stream bytes into `part` starting at `offset`. Returns bytes received."""
        if offset == s.size_bytes:
            return 0  # already complete from an earlier attempt; go straight to verify
        try:
            dl = client.download(s.session_id, offset)
        except RangeNotSatisfiable as e:
            raise _Retry(str(e), discard_partial=True)
        except LoggerError as e:
            if e.transient:
                raise _Retry(str(e))
            raise _GiveUp(str(e))

        received = 0
        with dl:
            if dl.total_size is not None and dl.total_size != s.size_bytes:
                raise _Retry(f"logger is serving {dl.total_size} bytes, manifest says "
                             f"{s.size_bytes}; manifest may be stale", discard_partial=True)
            if offset and dl.offset == 0:
                log.info("%s: logger ignored resume request; restarting from byte 0", tag)
            if offset:
                log.info("%s: resuming at byte %d of %d", tag, dl.offset, s.size_bytes)
            mode = "r+b" if dl.offset and part.exists() else "wb"
            with open(part, mode) as f:
                f.seek(dl.offset)
                f.truncate()
                pos = dl.offset
                try:
                    for chunk in dl.chunks(self.chunk_size):
                        f.write(chunk)
                        received += len(chunk)
                        pos += len(chunk)
                        if pos > s.size_bytes:
                            raise _Retry("logger sent more bytes than the manifest size",
                                         discard_partial=True)
                        if self.progress:
                            self.progress(s.session_id, pos, s.size_bytes)
                except LoggerError as e:
                    f.flush()
                    os.fsync(f.fileno())
                    raise _Retry(f"{e} at byte {pos}/{s.size_bytes}")
                f.flush()
                os.fsync(f.fileno())
        if pos < s.size_bytes:
            raise _Retry(f"short transfer: stream ended at byte {pos}/{s.size_bytes}")
        return received

    def _verify(self, s: dbm.Session, part: Path) -> int:
        digest = sha256_file(part)
        if digest != s.sha256:
            raise _Retry(f"sha256 mismatch (got {digest[:12]}..., expected {s.sha256[:12]}...); "
                         "discarding partial and re-downloading", discard_partial=True)
        rep = check_content(part)
        if not rep.ok:
            # The bytes are exactly what the logger has, so retrying won't help.
            # Keep them for inspection.
            final, _ = session_paths(self.data_dir, s.logger_id, s.session_id)
            bad = final.with_name(final.stem + ".invalid.csv")
            os.replace(part, bad)
            raise _GiveUp("content check failed: " + "; ".join(rep.problems) +
                          f" (kept at {bad})", status=dbm.INVALID)
        return rep.rows

    # -- helpers ---------------------------------------------------------------

    def _with_retries(self, fn, what: str):
        for attempt in range(1, self.retry.max_attempts + 1):
            try:
                return fn()
            except LoggerError as e:
                if not e.transient or attempt == self.retry.max_attempts:
                    raise
                delay = self.retry.delay(attempt, self.rng.random())
                log.warning("%s failed (%s); retrying in %.1fs", what, e, delay)
                self.sleep(delay)


def _size(p: Path) -> int:
    try:
        return p.stat().st_size
    except FileNotFoundError:
        return 0


def reverify_archive(history: dbm.HistoryDB, logger_id: str | None = None) -> list[tuple[dbm.Session, str]]:
    """Re-check every verified file on disk. Returns (session, problem) pairs."""
    from envi_daq.verify import check_file

    problems = []
    for s in history.sessions(logger_id=logger_id, status=dbm.VERIFIED):
        res = check_file(s.local_path or "", s.size_bytes, s.sha256)
        if not res.ok:
            problems.append((s, res.reason or "unknown"))
    return problems
