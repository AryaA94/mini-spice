"""Command-line interface.

    envi-daq init                      write a starter config.toml
    envi-daq status                    is each logger reachable? what's pending?
    envi-daq sync [--logger NAME]      download + verify everything new
    envi-daq sessions [--status S]     list sessions and where they are on disk
    envi-daq history [--session ID]    per-attempt transfer log
    envi-daq retry [--session ID]      re-queue failed sessions, then sync
    envi-daq verify                    re-check archived files against their checksums
    envi-daq export FILE.csv           dump sessions or transfers as CSV for analysis
    envi-daq simulate                  run a simulated logger for testing

Exit codes: 0 all good, 1 some sessions failed / conflicts / bad files,
2 config or usage error, 3 a logger was unreachable, 4 another sync is running.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from envi_daq import __version__
from envi_daq import config as cfgm
from envi_daq import db as dbm
from envi_daq.downloader import Downloader, SyncReport, reverify_archive

EXIT_OK, EXIT_FAILURES, EXIT_CONFIG, EXIT_UNREACHABLE, EXIT_LOCKED = 0, 1, 2, 3, 4

log = logging.getLogger("envi_daq")


# -- helpers -------------------------------------------------------------------

def _setup_logging(verbose: int, log_file: Path | None) -> None:
    level = logging.DEBUG if verbose > 1 else logging.INFO if verbose else logging.WARNING
    root = logging.getLogger("envi_daq")
    root.setLevel(logging.DEBUG)
    root.handlers.clear()
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(level)
    console.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    root.addHandler(console)
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setLevel(logging.INFO)
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        root.addHandler(fh)


def _table(rows: list[dict], cols: list[str]) -> str:
    if not rows:
        return "(none)"
    cells = [[("" if r.get(c) is None else str(r.get(c))) for c in cols] for r in rows]
    widths = [max(len(c), *(len(row[i]) for row in cells)) for i, c in enumerate(cols)]
    line = lambda vals: "  ".join(v.ljust(w) for v, w in zip(vals, widths)).rstrip()  # noqa: E731
    return "\n".join([line(cols), line(["-" * w for w in widths]), *map(line, cells)])


def _human(n: int | None) -> str:
    if n is None:
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


@contextmanager
def _sync_lock(db_path: Path):
    """Stop two syncs (e.g. overlapping cron runs) writing the same files."""
    lock_path = db_path.with_name(db_path.name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    f = open(lock_path, "a+")
    try:
        try:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:  # Windows
            import msvcrt
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        yield
    finally:
        f.close()


class _Progress:
    def __init__(self, enabled: bool):
        self.enabled = enabled and sys.stderr.isatty()
        self.last = None

    def __call__(self, sid: str, done: int, total: int) -> None:
        if not self.enabled:
            return
        pct = 100 * done // max(total, 1)
        if (sid, pct) != self.last:
            self.last = (sid, pct)
            sys.stderr.write(f"\r  {sid}: {pct:3d}%  {_human(done)} / {_human(total)}   ")
            if done >= total:
                sys.stderr.write("\n")
            sys.stderr.flush()


# -- commands ------------------------------------------------------------------

def cmd_init(args) -> int:
    path = Path(args.config)
    if path.exists() and not args.force:
        print(f"{path} already exists (use --force to overwrite)", file=sys.stderr)
        return EXIT_CONFIG
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(cfgm.EXAMPLE, encoding="utf-8")
    cfg = cfgm.load(path)
    dbm.HistoryDB(cfg.database).close()
    print(f"wrote {path}\ncreated database {cfg.database}\n"
          f"edit the [[logger]] blocks, then run: envi-daq -c {path} status")
    return EXIT_OK


def _loggers(cfg: cfgm.Config, name: str | None):
    if name:
        return [cfg.logger(name)]
    if not cfg.loggers:
        raise cfgm.ConfigError("no [[logger]] entries in config")
    return cfg.loggers


def cmd_status(args, cfg: cfgm.Config) -> int:
    from envi_daq.client import LoggerClient, LoggerError

    rc = EXIT_OK
    out = []
    with dbm.HistoryDB(cfg.database) as h:
        counts = h.counts()
        for lg in _loggers(cfg, args.logger):
            row = {"logger": lg.name, "url": lg.url}
            try:
                c = LoggerClient(lg.url, lg.timeout_s, lg.token)
                info = c.info()
                manifest = c.sessions()
                lid = str(info["logger_id"])
                known = {s.session_id: s for s in h.sessions(logger_id=lid)}
                closed = [m for m in manifest if not m.open]
                row.update(
                    reachable=True, logger_id=lid, firmware=info.get("firmware"),
                    free=_human(info.get("free_bytes")), on_logger=len(manifest),
                    recording=sum(m.open for m in manifest),
                    to_download=sum(1 for m in closed
                                    if m.session_id not in known
                                    or known[m.session_id].status != dbm.VERIFIED),
                )
                row.update(counts.get(lid, {}))
            except LoggerError as e:
                rc = EXIT_UNREACHABLE
                row.update(reachable=False, error=str(e))
            out.append(row)
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        for r in out:
            if r["reachable"]:
                print(f"{r['logger']} ({r['logger_id']}, fw {r['firmware']}) at {r['url']}: online")
                print(f"  on logger: {r['on_logger']} sessions ({r['recording']} recording), "
                      f"free {r['free']}")
                print(f"  to download: {r['to_download']}   archived: {r.get('verified', 0)}   "
                      f"failed: {r.get('failed', 0)}   invalid: {r.get('invalid', 0)}   "
                      f"conflict: {r.get('conflict', 0)}")
            else:
                print(f"{r['logger']} at {r['url']}: UNREACHABLE -- {r['error']}")
    return rc


def _print_report(rep: SyncReport) -> None:
    if not rep.reachable:
        print(f"{rep.logger_name}: UNREACHABLE -- {rep.error}")
        return
    print(f"{rep.logger_name} ({rep.logger_id}): {rep.new_sessions} new, "
          f"{len(rep.downloaded)} downloaded, {len(rep.failed)} failed, "
          f"{rep.skipped_open} still recording" +
          (f", {rep.conflicts} CONFLICT" if rep.conflicts else ""))
    for r in rep.failed:
        print(f"  {r.session_id}: {r.status} after {r.attempts} attempt(s): {r.error}")


def cmd_sync(args, cfg: cfgm.Config) -> int:
    try:
        lock = _sync_lock(cfg.database)
        lock.__enter__()
    except OSError:
        print("another envi-daq sync is already running", file=sys.stderr)
        return EXIT_LOCKED
    try:
        with dbm.HistoryDB(cfg.database) as h:
            n = h.close_dangling_transfers()
            if n:
                log.warning("closed %d transfer(s) left open by a previous interrupted run", n)
            if getattr(args, "requeue", None):
                lid, sid = args.requeue
                k = h.requeue(logger_id=lid, session_id=sid,
                              statuses=(dbm.FAILED, dbm.INVALID) if args.include_invalid
                              else (dbm.FAILED,))
                print(f"re-queued {k} session(s)")
            dl = Downloader(h, cfg.data_dir, cfg.retry, cfg.chunk_size,
                            progress=_Progress(not args.json))
            only = set(args.session) if args.session else None
            reports = [dl.sync(lg, only=only, dry_run=args.dry_run)
                       for lg in _loggers(cfg, args.logger)]
    finally:
        lock.__exit__(None, None, None)

    if args.json:
        print(json.dumps([{**asdict(r), "ok": r.ok} for r in reports], indent=2))
    else:
        for r in reports:
            if args.dry_run and r.reachable:
                print(f"{r.logger_name}: would download {len(r.results)}: "
                      + (", ".join(x.session_id for x in r.results) or "nothing"))
            else:
                _print_report(r)
    if any(not r.reachable for r in reports):
        return EXIT_UNREACHABLE
    if args.dry_run:
        return EXIT_OK
    return EXIT_OK if all(r.ok for r in reports) else EXIT_FAILURES


def cmd_retry(args, cfg: cfgm.Config) -> int:
    logger_id = None
    if args.logger:
        with dbm.HistoryDB(cfg.database) as h:
            ids = [r["logger_id"] for r in h.loggers() if r["name"] == args.logger]
        logger_id = ids[0] if ids else "__none__"
    args.requeue = (logger_id, args.session[0] if args.session else None)
    args.dry_run = False
    return cmd_sync(args, cfg)


def cmd_sessions(args, cfg: cfgm.Config) -> int:
    with dbm.HistoryDB(cfg.database) as h:
        rows = [asdict(s) for s in h.sessions(status=args.status)]
    if args.logger_id:
        rows = [r for r in rows if r["logger_id"] == args.logger_id]
    if args.json:
        print(json.dumps(rows, indent=2))
        return EXIT_OK
    for r in rows:
        r["size"] = _human(r["size_bytes"])
        r["sha256"] = r["sha256"][:12]
    cols = ["logger_id", "session_id", "status", "started_at", "size", "row_count",
            "attempts", "sha256", "local_path" if not args.errors else "last_error"]
    print(_table(rows, cols))
    return EXIT_OK


def cmd_history(args, cfg: cfgm.Config) -> int:
    with dbm.HistoryDB(cfg.database) as h:
        rows = [dict(r) for r in h.transfers(session_id=args.session, limit=args.limit)]
    if args.json:
        print(json.dumps(rows, indent=2))
        return EXIT_OK
    for r in rows:
        r["bytes"] = _human(r["bytes_received"])
        r["resumed_from"] = r["resumed_from"] or ""
    print(_table(rows, ["transfer_id", "started_at", "logger_id", "session_id", "attempt",
                        "outcome", "resumed_from", "bytes", "duration_s", "error"]))
    return EXIT_OK


def cmd_verify(args, cfg: cfgm.Config) -> int:
    with dbm.HistoryDB(cfg.database) as h:
        total = len(h.sessions(status=dbm.VERIFIED))
        problems = reverify_archive(h)
        if args.requeue:
            for s, reason in problems:
                Path(s.local_path or "").unlink(missing_ok=True)
                h.set_status(s.logger_id, s.session_id, dbm.PENDING,
                             error=f"re-verify failed: {reason}")
    if args.json:
        print(json.dumps({"checked": total, "problems": [
            {"logger_id": s.logger_id, "session_id": s.session_id,
             "path": s.local_path, "problem": p} for s, p in problems]}, indent=2))
    else:
        print(f"checked {total} archived file(s): {len(problems)} problem(s)")
        for s, p in problems:
            print(f"  {s.logger_id}/{s.session_id}: {p}  [{s.local_path}]")
        if problems and args.requeue:
            print("re-queued for download on the next sync")
        elif problems:
            print("run `envi-daq verify --requeue` to re-download them on the next sync")
    return EXIT_FAILURES if problems else EXIT_OK


def cmd_export(args, cfg: cfgm.Config) -> int:
    with dbm.HistoryDB(cfg.database) as h:
        if args.what == "sessions":
            rows = [asdict(s) for s in h.sessions()]
        else:
            rows = [dict(r) for r in h.transfers(limit=None)]
    out = sys.stdout if args.file == "-" else open(args.file, "w", newline="", encoding="utf-8")
    try:
        if rows:
            w = csv.DictWriter(out, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    finally:
        if out is not sys.stdout:
            out.close()
            print(f"wrote {len(rows)} {args.what} row(s) to {args.file}", file=sys.stderr)
    return EXIT_OK


def cmd_simulate(args) -> int:
    from envi_daq.simulator import Faults, SimLogger, SimServer

    lg = SimLogger.generate(
        n_sessions=args.sessions, samples=args.samples, seed=args.seed,
        logger_id=args.logger_id,
        faults=Faults(args.fail_rate, args.drop_rate, args.corrupt_rate, args.latency,
                      ignore_range=args.ignore_range),
    )
    srv = SimServer(lg, args.host, args.port)
    print(f"simulated logger {lg.logger_id} serving {len(lg.sessions)} sessions at {srv.url}")
    print("Ctrl-C to stop")
    try:
        srv.httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.httpd.server_close()
    return EXIT_OK


# -- argument parsing ----------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="envi-daq", description="Download, verify and track "
                                "telemetry sessions from Wi-Fi environmental data loggers.")
    p.add_argument("-c", "--config", default=os.environ.get("ENVI_DAQ_CONFIG", "config.toml"),
                   help="config file (default: $ENVI_DAQ_CONFIG or ./config.toml)")
    p.add_argument("-v", "--verbose", action="count", default=0, help="-v info, -vv debug")
    p.add_argument("--version", action="version", version=f"envi-daq {__version__}")
    # Accept -c / -v after the subcommand too (`envi-daq sync -v`).
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("-c", "--config", default=argparse.SUPPRESS)
    common.add_argument("-v", "--verbose", action="count", default=argparse.SUPPRESS)
    sub = p.add_subparsers(dest="cmd", required=True)
    _add = sub.add_parser
    sub.add_parser = lambda *a, **kw: _add(*a, parents=[common], **kw)  # type: ignore[method-assign]

    s = sub.add_parser("init", help="write a starter config and create the database")
    s.add_argument("--force", action="store_true")

    s = sub.add_parser("status", help="check each logger and summarise what's pending")
    s.add_argument("--logger", help="only this logger (name from config)")
    s.add_argument("--json", action="store_true")

    for name, hlp in (("sync", "download and verify new sessions"),
                      ("retry", "re-queue failed sessions and sync them")):
        s = sub.add_parser(name, help=hlp)
        s.add_argument("--logger", help="only this logger (name from config)")
        s.add_argument("--session", action="append", help="only this session ID (repeatable)")
        s.add_argument("--json", action="store_true")
        if name == "sync":
            s.add_argument("--dry-run", action="store_true", help="list what would download")
        else:
            s.add_argument("--include-invalid", action="store_true",
                           help="also re-queue sessions that failed the content check")

    s = sub.add_parser("sessions", help="list known sessions")
    s.add_argument("--status", choices=dbm.STATUSES)
    s.add_argument("--logger-id")
    s.add_argument("--errors", action="store_true", help="show last error instead of path")
    s.add_argument("--json", action="store_true")

    s = sub.add_parser("history", help="show the transfer log (one row per attempt)")
    s.add_argument("--session")
    s.add_argument("--limit", type=int, default=30)
    s.add_argument("--json", action="store_true")

    s = sub.add_parser("verify", help="re-check archived files on disk")
    s.add_argument("--requeue", action="store_true", help="re-download any that fail")
    s.add_argument("--json", action="store_true")

    s = sub.add_parser("export", help="export sessions or transfers to CSV")
    s.add_argument("file", help="output path, or - for stdout")
    s.add_argument("--what", choices=("sessions", "transfers"), default="sessions")

    s = sub.add_parser("simulate", help="run a simulated logger (no config needed)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8080)
    s.add_argument("--sessions", type=int, default=4)
    s.add_argument("--samples", type=int, default=2000, help="rows per session")
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--logger-id", default="ENV-0A17")
    s.add_argument("--fail-rate", type=float, default=0.0)
    s.add_argument("--drop-rate", type=float, default=0.0)
    s.add_argument("--corrupt-rate", type=float, default=0.0)
    s.add_argument("--latency", type=float, default=0.0)
    s.add_argument("--ignore-range", action="store_true", help="emulate firmware without resume")
    return p


COMMANDS = {
    "status": cmd_status, "sync": cmd_sync, "retry": cmd_retry, "sessions": cmd_sessions,
    "history": cmd_history, "verify": cmd_verify, "export": cmd_export,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "init":
            _setup_logging(args.verbose, None)
            return cmd_init(args)
        if args.cmd == "simulate":
            _setup_logging(args.verbose, None)
            return cmd_simulate(args)
        cfg = cfgm.load(args.config)
        _setup_logging(args.verbose, cfg.log_file)
        return COMMANDS[args.cmd](args, cfg)
    except cfgm.ConfigError as e:
        print(f"config error: {e}", file=sys.stderr)
        return EXIT_CONFIG
    except KeyboardInterrupt:
        print("\ninterrupted; partial downloads are kept and will resume next sync",
              file=sys.stderr)
        return 130
