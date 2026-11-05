"""Web dashboard: `envi-daq dashboard`.

A small stdlib HTTP server for the host computer. It shows every logger's
Wi-Fi health, what's archived, what's waiting and what failed, and it can run
a sync in the background while streaming progress to the browser.

Endpoints (JSON unless noted):
  GET  /                 dashboard page (HTML)
  GET  /api/state        loggers, link health, sessions, recent transfers, totals
  GET  /api/sync?since=N live sync job: phase, current transfer, log lines after N
  POST /api/sync         start a sync      body: {"logger": name?}
  POST /api/retry        re-queue + sync   body: {"logger_id"?, "session_id"?, "include_invalid"?}
  POST /api/probe        ping every logger now (also runs on a timer)
  POST /api/verify       re-check archived files on disk

Binds to 127.0.0.1 by default. Use --host 0.0.0.0 only on a trusted network:
there is no authentication.
"""

from __future__ import annotations

import json
import logging
import socket
import threading
import time
from collections import deque
from dataclasses import asdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from urllib.parse import parse_qs, urlparse

from envi_daq import __version__
from envi_daq import config as cfgm
from envi_daq import db as dbm
from envi_daq.client import LoggerClient, LoggerError
from envi_daq.downloader import Downloader, reverify_archive
from envi_daq.locking import SyncLocked, sync_lock

log = logging.getLogger("envi_daq")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SyncJob:
    """Shared, thread-safe view of the current (or last) background sync."""

    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.scope: str | None = None
        self.phase = "idle"           # idle | discovering | downloading | backoff | done | error
        self.logger: str | None = None
        self.current: dict | None = None
        self.queue: list[str] = []
        self.results: list[dict] = []
        self.error: str | None = None
        self.lines: deque[dict] = deque(maxlen=400)
        self.seq = 0

    def add_line(self, level: str, msg: str) -> None:
        with self.lock:
            self.seq += 1
            self.lines.append({"seq": self.seq, "t": _now(), "level": level, "msg": msg})

    def on_event(self, ev: dict) -> None:
        t = ev["type"]
        with self.lock:
            if t == "discover":
                self.phase, self.logger, self.current, self.queue = "discovering", ev["logger"], None, []
            elif t == "unreachable":
                self.phase = "unreachable"
            elif t == "manifest":
                self.queue = list(ev["to_download"])
                self.phase = "downloading" if self.queue else "up-to-date"
            elif t == "start":
                self.phase = "downloading"
                self.current = {"logger_id": ev["logger_id"], "session_id": ev["session_id"],
                                "attempt": ev["attempt"], "offset": ev["offset"],
                                "done": ev["offset"], "size": ev["size"], "segments": (
                                    (self.current or {}).get("segments", [])
                                    if self.current and self.current["session_id"] == ev["session_id"]
                                    else [])}
                self.current["segments"].append(
                    {"from": ev["offset"], "to": ev["offset"], "kind": "active"})
            elif t == "progress" and self.current:
                self.current["done"] = ev["done"]
                self.current["segments"][-1]["to"] = ev["done"]
            elif t == "backoff" and self.current:
                self.phase = "backoff"
                self.current["backoff_s"] = ev["seconds"]
                self.current["backoff_until"] = time.time() + ev["seconds"]
            elif t == "finish" and self.current:
                segs = self.current["segments"]
                if ev["outcome"] == "ok":
                    for s in segs:
                        s["kind"] = "ok"
                    if ev["session_id"] in self.queue:
                        self.queue.remove(ev["session_id"])
                elif ev.get("discarded"):
                    for s in segs:
                        s["kind"] = "discarded"
                elif ev["outcome"] == "retry":
                    segs[-1]["kind"] = "kept"
                else:
                    segs[-1]["kind"] = "discarded"
                    if ev["session_id"] in self.queue:
                        self.queue.remove(ev["session_id"])
                self.current["outcome"] = ev["outcome"]
                self.current["error"] = ev.get("error")
                self.current.pop("backoff_until", None)

    def snapshot(self, since: int = 0) -> dict:
        with self.lock:
            # Deep-copy: the sync thread keeps mutating the segment list.
            cur = None
            if self.current:
                cur = dict(self.current)
                cur["segments"] = [dict(g) for g in self.current["segments"]]
            if cur and "backoff_until" in cur:
                cur["backoff_left_s"] = round(max(0.0, cur.pop("backoff_until") - time.time()), 1)
            return {
                "running": self.running, "phase": self.phase, "scope": self.scope,
                "started_at": self.started_at, "finished_at": self.finished_at,
                "logger": self.logger, "current": cur, "queue": list(self.queue),
                "results": list(self.results), "error": self.error, "seq": self.seq,
                "lines": [ln for ln in self.lines if ln["seq"] > since],
            }


class _JobLogHandler(logging.Handler):
    def __init__(self, job: SyncJob):
        super().__init__(logging.INFO)
        self.job = job

    def emit(self, record: logging.LogRecord) -> None:
        if self.job.running:
            self.job.add_line(record.levelname, record.getMessage())


class Dashboard:
    def __init__(self, cfg: cfgm.Config, probe_interval_s: float = 30.0):
        self.cfg = cfg
        self.job = SyncJob()
        self.probe_interval_s = probe_interval_s
        self._stop = threading.Event()
        self._probe_lock = threading.Lock()
        handler = _JobLogHandler(self.job)
        logging.getLogger("envi_daq").addHandler(handler)
        logging.getLogger("envi_daq").setLevel(logging.DEBUG)
        dbm.HistoryDB(cfg.database).close()  # create / migrate up front

    # -- state ---------------------------------------------------------------

    def state(self) -> dict:
        with dbm.HistoryDB(self.cfg.database) as h:
            known = {r["name"]: dict(r) for r in h.loggers()}
            id_to_name = {r["logger_id"]: r["name"] for r in known.values()}
            counts = h.counts()
            stats = h.transfer_stats()
            loggers = []
            for lc in self.cfg.loggers:
                row = known.get(lc.name, {})
                lid = row.get("logger_id")
                samples = [dict(s) for s in h.link_samples(lc.name, 40)]
                last = samples[-1] if samples else None
                loggers.append({
                    "name": lc.name, "url": lc.url, "logger_id": lid,
                    "firmware": row.get("firmware"), "last_seen": row.get("last_seen"),
                    "online": bool(last and last["reachable"]),
                    "rssi_dbm": last["rssi_dbm"] if last else None,
                    "latency_ms": last["latency_ms"] if last else None,
                    "last_error": last["error"] if last and not last["reachable"] else None,
                    "last_checked": last["sampled_at"] if last else None,
                    "samples": [{"t": s["sampled_at"], "rssi": s["rssi_dbm"],
                                 "ok": bool(s["reachable"])} for s in samples],
                    "counts": counts.get(lid, {}) if lid else {},
                    "stats": stats.get(lid) if lid else None,
                })
            sessions = []
            for s in h.sessions():
                d = asdict(s)
                d["logger_name"] = id_to_name.get(s.logger_id, s.logger_id)
                sessions.append(d)
            transfers = []
            for t in h.transfers(limit=80):
                d = dict(t)
                d["logger_name"] = id_to_name.get(t["logger_id"], t["logger_id"])
                transfers.append(d)
        by_status: dict[str, int] = {}
        for s in sessions:
            by_status[s["status"]] = by_status.get(s["status"], 0) + 1
        all_attempts = sum((v["attempts"] for v in stats.values()), 0)
        all_ok = sum((v["ok"] for v in stats.values()), 0)
        return {
            "version": __version__, "host": socket.gethostname(), "now": _now(),
            "data_dir": str(self.cfg.data_dir), "database": str(self.cfg.database),
            "loggers": loggers, "sessions": sessions, "transfers": transfers,
            "totals": {
                **{k: by_status.get(k, 0) for k in dbm.STATUSES},
                "archived_bytes": sum(s["size_bytes"] for s in sessions if s["status"] == dbm.VERIFIED),
                "attempts": all_attempts,
                "success_rate": round(all_ok / all_attempts, 3) if all_attempts else None,
            },
            "sync": self.job.snapshot(since=10**9),
        }

    # -- actions -------------------------------------------------------------

    def start_sync(self, logger: str | None = None, requeue: dict | None = None) -> tuple[bool, str]:
        if logger is not None:
            self.cfg.logger(logger)  # raises ConfigError for unknown names
        with self.job.lock:
            if self.job.running:
                return False, "a sync is already running"
            self.job.running = True
            self.job.started_at, self.job.finished_at = _now(), None
            self.job.scope = logger or "all loggers"
            self.job.results, self.job.error, self.job.current = [], None, None
            self.job.phase = "starting"
        threading.Thread(target=self._run_sync, args=(logger, requeue), daemon=True).start()
        return True, "started"

    def _run_sync(self, logger: str | None, requeue: dict | None) -> None:
        job = self.job
        job.add_line("INFO", f"sync started ({job.scope})")
        try:
            with sync_lock(self.cfg.database), dbm.HistoryDB(self.cfg.database) as h:
                h.close_dangling_transfers()
                if requeue is not None:
                    statuses = (dbm.FAILED, dbm.INVALID) if requeue.get("include_invalid") else (dbm.FAILED,)
                    n = h.requeue(requeue.get("logger_id"), requeue.get("session_id"), statuses)
                    job.add_line("INFO", f"re-queued {n} session(s)")
                dl = Downloader(h, self.cfg.data_dir, self.cfg.retry, self.cfg.chunk_size,
                                listener=job.on_event)
                targets = [self.cfg.logger(logger)] if logger else self.cfg.loggers
                for lc in targets:
                    rep = dl.sync(lc)
                    res = {"logger": lc.name, "logger_id": rep.logger_id,
                           "reachable": rep.reachable, "error": rep.error,
                           "new": rep.new_sessions, "downloaded": len(rep.downloaded),
                           "failed": len(rep.failed), "conflicts": rep.conflicts,
                           "recording": rep.skipped_open}
                    with job.lock:
                        job.results.append(res)
                    if rep.reachable:
                        job.add_line("INFO" if rep.ok else "WARNING", rep.summary())
        except SyncLocked as e:
            job.error = str(e)
            job.add_line("ERROR", str(e))
        except Exception as e:  # keep the dashboard alive whatever happens
            log.exception("sync crashed")
            job.error = f"{type(e).__name__}: {e}"
            job.add_line("ERROR", job.error)
        finally:
            with job.lock:
                job.running = False
                job.finished_at = _now()
                job.phase = "error" if job.error else "done"
            job.add_line("INFO", "sync finished")

    def probe(self) -> list[dict]:
        """Contact each logger: record signal/latency and register new sessions as pending."""
        if not self._probe_lock.acquire(blocking=False):
            return []
        out = []
        try:
            with dbm.HistoryDB(self.cfg.database) as h:
                for lc in self.cfg.loggers:
                    c = LoggerClient(lc.url, min(lc.timeout_s, 5.0), lc.token)
                    t0 = time.monotonic()
                    try:
                        info = c.info()
                        latency = (time.monotonic() - t0) * 1000
                        manifest = c.sessions()
                    except LoggerError as e:
                        h.add_link_sample(lc.name, None, False, error=str(e))
                        out.append({"logger": lc.name, "online": False, "error": str(e)})
                        continue
                    lid = str(info["logger_id"])
                    rssi = info.get("rssi_dbm")
                    h.upsert_logger(lid, lc.name, lc.url, info.get("firmware"))
                    h.add_link_sample(lc.name, lid, True,
                                      int(rssi) if isinstance(rssi, (int, float)) else None, latency)
                    new = 0
                    for m in manifest:
                        if m.open:
                            continue
                        before = h.session(lid, m.session_id)
                        h.record_manifest_entry(dbm.Session(lid, m.session_id, m.started_at,
                                                            m.ended_at, m.size_bytes, m.sha256))
                        new += before is None
                    out.append({"logger": lc.name, "online": True, "rssi_dbm": rssi, "new": new})
        finally:
            self._probe_lock.release()
        return out

    def verify(self) -> dict:
        with dbm.HistoryDB(self.cfg.database) as h:
            total = len(h.sessions(status=dbm.VERIFIED))
            problems = reverify_archive(h)
        return {"checked": total, "problems": [
            {"logger_id": s.logger_id, "session_id": s.session_id, "path": s.local_path,
             "problem": p} for s, p in problems]}

    def _probe_loop(self) -> None:
        while not self._stop.wait(self.probe_interval_s):
            if not self.job.running:
                try:
                    self.probe()
                except Exception:
                    log.debug("probe failed", exc_info=True)

    # -- server --------------------------------------------------------------

    def serve(self, host: str = "127.0.0.1", port: int = 8800) -> ThreadingHTTPServer:
        httpd = ThreadingHTTPServer((host, port), _handler(self))
        httpd.daemon_threads = True
        if self.probe_interval_s > 0:
            threading.Thread(target=self._probe_loop, daemon=True).start()
        return httpd

    def stop(self) -> None:
        self._stop.set()


def _page() -> bytes:
    return resources.files("envi_daq").joinpath("web/dashboard.html").read_bytes()


def _handler(app: Dashboard):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"envi-daq/{__version__}"

        def log_message(self, fmt, *args):
            pass

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj, default=str).encode(), "application/json")

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            try:
                data = json.loads(self.rfile.read(n))
            except ValueError:
                return {}
            return data if isinstance(data, dict) else {}

        def do_GET(self):  # noqa: N802
            u = urlparse(self.path)
            if u.path in ("/", "/index.html"):
                return self._send(200, _page(), "text/html; charset=utf-8")
            if u.path == "/api/state":
                return self._json(200, app.state())
            if u.path == "/api/sync":
                since = int(parse_qs(u.query).get("since", ["0"])[0] or 0)
                return self._json(200, app.job.snapshot(since))
            return self._json(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            u = urlparse(self.path)
            body = self._body()
            try:
                if u.path == "/api/sync":
                    ok, msg = app.start_sync(body.get("logger"))
                    return self._json(202 if ok else 409, {"ok": ok, "message": msg})
                if u.path == "/api/retry":
                    ok, msg = app.start_sync(None, requeue={
                        "logger_id": body.get("logger_id"), "session_id": body.get("session_id"),
                        "include_invalid": bool(body.get("include_invalid"))})
                    return self._json(202 if ok else 409, {"ok": ok, "message": msg})
                if u.path == "/api/probe":
                    return self._json(200, {"results": app.probe()})
                if u.path == "/api/verify":
                    return self._json(200, app.verify())
            except cfgm.ConfigError as e:
                return self._json(400, {"ok": False, "message": str(e)})
            return self._json(404, {"error": "not found"})

    return Handler
