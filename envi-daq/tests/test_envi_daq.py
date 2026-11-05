"""End-to-end and unit tests. Run with:  python -m unittest discover -s tests -v"""

from __future__ import annotations

import io
import json
import random
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from envi_daq import cli
from envi_daq import config as cfgm
from envi_daq import db as dbm
from envi_daq.client import LoggerClient, LoggerError
from envi_daq.downloader import Downloader, reverify_archive, session_paths
from envi_daq.simulator import Faults, SimLogger, SimServer
from envi_daq.verify import check_content, check_file

FAST = cfgm.RetryPolicy(max_attempts=10, base_delay_s=0.0, max_delay_s=0.0, jitter=0.0)


class Env(unittest.TestCase):
    """A temp dir + simulated logger + downloader wired together."""

    faults = Faults()
    n_sessions = 3

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.sim = SimLogger.generate(n_sessions=self.n_sessions, samples=500, seed=7,
                                      faults=self.faults)
        self.server = SimServer(self.sim).start()
        self.db = dbm.HistoryDB(self.dir / "h.sqlite3")
        self.sleeps: list[float] = []
        self.dl = Downloader(self.db, self.dir / "data", FAST, chunk_size=4096,
                             sleep=self.sleeps.append, rng=random.Random(0))
        self.logger = cfgm.LoggerConfig("sim", self.server.url, timeout_s=5)

    def tearDown(self):
        self.server.stop()
        self.db.close()
        self.tmp.cleanup()

    def archived(self, sid: str) -> Path:
        return session_paths(self.dir / "data", self.sim.logger_id, sid)[0]


class TestHappyPath(Env):
    def test_sync_downloads_and_verifies_closed_sessions(self):
        rep = self.dl.sync(self.logger)
        self.assertTrue(rep.ok, rep)
        self.assertEqual(rep.new_sessions, 3)
        self.assertEqual(rep.skipped_open, 1)
        self.assertEqual(len(rep.downloaded), 3)
        for sid in ("S0001", "S0002", "S0003"):
            path = self.archived(sid)
            self.assertEqual(path.read_bytes(), self.sim.sessions[sid].data)
            self.assertFalse(path.with_name(path.name + ".part").exists())
            s = self.db.session(self.sim.logger_id, sid)
            self.assertEqual(s.status, dbm.VERIFIED)
            self.assertEqual(s.row_count, 500)
        self.assertIsNone(self.db.session(self.sim.logger_id, "S0004"))  # still recording
        self.assertEqual([t["outcome"] for t in self.db.transfers()], ["ok"] * 3)

    def test_second_sync_is_a_no_op(self):
        self.dl.sync(self.logger)
        before = len(self.sim.request_log)
        rep = self.dl.sync(self.logger)
        self.assertEqual(rep.results, [])
        self.assertEqual(rep.new_sessions, 0)
        data_requests = [r for r in self.sim.request_log[before:] if "/data" in r]
        self.assertEqual(data_requests, [])

    def test_session_closing_later_is_picked_up(self):
        self.dl.sync(self.logger)
        self.sim.sessions["S0004"].open = False
        rep = self.dl.sync(self.logger)
        self.assertEqual([r.session_id for r in rep.downloaded], ["S0004"])

    def test_only_filter_and_dry_run(self):
        rep = self.dl.sync(self.logger, dry_run=True)
        self.assertEqual(len(rep.results), 3)
        self.assertEqual(self.db.transfers(), [])
        rep = self.dl.sync(self.logger, only={"S0002"})
        self.assertEqual([r.session_id for r in rep.downloaded], ["S0002"])

    def test_reverify_detects_bit_rot_and_deletion(self):
        self.dl.sync(self.logger)
        p1 = self.archived("S0001")
        b = bytearray(p1.read_bytes())
        b[200] ^= 1
        p1.write_bytes(bytes(b))
        self.archived("S0002").unlink()
        problems = {s.session_id: why for s, why in reverify_archive(self.db)}
        self.assertIn("sha256", problems["S0001"])
        self.assertIn("missing", problems["S0002"])
        self.assertNotIn("S0003", problems)


class TestResume(Env):
    faults = Faults(drop_rate=0.6)

    def test_dropped_connections_resume_with_range(self):
        rep = self.dl.sync(self.logger)
        self.assertTrue(rep.ok, rep)
        for sid in ("S0001", "S0002", "S0003"):
            self.assertEqual(self.archived(sid).read_bytes(), self.sim.sessions[sid].data)
        resumed = [t for t in self.db.transfers(limit=None) if t["resumed_from"] > 0]
        self.assertTrue(resumed, "expected at least one resumed attempt")
        self.assertTrue(any("range=bytes=" in r for r in self.sim.request_log))
        # Bytes actually pulled over the air should be ~ file size, not N x file size.
        for sid in ("S0001", "S0002", "S0003"):
            pulled = sum(t["bytes_received"] for t in self.db.transfers(session_id=sid, limit=None))
            self.assertLessEqual(pulled, len(self.sim.sessions[sid].data))
        self.assertTrue(self.sleeps, "retries should back off")


class TestCorruption(Env):
    faults = Faults(corrupt_rate=0.5)

    def test_checksum_mismatch_discards_and_redownloads(self):
        rep = self.dl.sync(self.logger)
        self.assertTrue(rep.ok, rep)
        for sid in ("S0001", "S0002", "S0003"):
            self.assertEqual(self.archived(sid).read_bytes(), self.sim.sessions[sid].data)
        errors = [t["error"] for t in self.db.transfers(limit=None) if t["outcome"] == "retry"]
        self.assertTrue(any("sha256 mismatch" in e for e in errors), errors)


class TestNoRangeSupport(Env):
    faults = Faults(drop_rate=0.5, ignore_range=True)

    def test_falls_back_to_full_restart(self):
        rep = self.dl.sync(self.logger)
        self.assertTrue(rep.ok, rep)
        for sid in ("S0001", "S0002", "S0003"):
            self.assertEqual(self.archived(sid).read_bytes(), self.sim.sessions[sid].data)


class TestGivingUp(Env):
    faults = Faults(fail_rate=1.0)

    def test_exhausted_retries_mark_failed_and_retry_requeues(self):
        rep = self.dl.sync(self.logger)
        self.assertFalse(rep.ok)
        self.assertEqual({r.status for r in rep.results}, {dbm.FAILED})
        ts = self.db.transfers(session_id="S0001", limit=None)
        self.assertEqual(len(ts), FAST.max_attempts)
        self.assertEqual(sorted(t["attempt"] for t in ts), list(range(1, FAST.max_attempts + 1)))
        self.assertIn("503", self.db.session(self.sim.logger_id, "S0001").last_error)

        # Failed sessions are not retried automatically...
        self.assertEqual(self.dl.sync(self.logger).results, [])
        # ...until re-queued.
        self.sim.faults.fail_rate = 0.0
        self.assertEqual(self.db.requeue(), 3)
        rep = self.dl.sync(self.logger)
        self.assertTrue(rep.ok, rep)
        self.assertEqual(self.db.session(self.sim.logger_id, "S0001").attempts,
                         FAST.max_attempts + 1)


class TestManifestChanges(Env):
    def test_changed_checksum_after_archive_is_conflict_not_overwrite(self):
        self.dl.sync(self.logger)
        original = self.archived("S0001").read_bytes()
        s = self.sim.sessions["S0001"]
        s.data = s.data + b"2026-06-02T00:00:00Z,1,2,3,4\n"
        rep = self.dl.sync(self.logger)
        self.assertEqual(rep.conflicts, 1)
        self.assertFalse(rep.ok)
        self.assertEqual(self.archived("S0001").read_bytes(), original)
        self.assertEqual(self.db.session(self.sim.logger_id, "S0001").status, dbm.CONFLICT)

    def test_invalid_content_is_quarantined_without_retry(self):
        s = self.sim.sessions["S0002"]
        s.data = s.data.replace(b"timestamp,", b"tmstamp,", 1)
        rep = self.dl.sync(self.logger)
        bad = [r for r in rep.results if r.session_id == "S0002"][0]
        self.assertEqual(bad.status, dbm.INVALID)
        self.assertEqual(bad.attempts, 1)
        self.assertFalse(self.archived("S0002").exists())
        self.assertTrue(self.archived("S0002").with_name("S0002.invalid.csv").exists())


class TestUnreachable(unittest.TestCase):
    def test_unreachable_logger_reports_error(self):
        with tempfile.TemporaryDirectory() as d, dbm.HistoryDB(Path(d) / "h.db") as h:
            dl = Downloader(h, Path(d), cfgm.RetryPolicy(max_attempts=2, base_delay_s=0),
                            sleep=lambda s: None)
            rep = dl.sync(cfgm.LoggerConfig("gone", "http://127.0.0.1:9", timeout_s=0.5))
            self.assertFalse(rep.reachable)
            self.assertIn("cannot reach", rep.error)

    def test_404_is_permanent(self):
        with SimServer(SimLogger.generate(1, samples=10)) as srv:
            with self.assertRaises(LoggerError) as cm:
                LoggerClient(srv.url).download("NOPE")
            self.assertFalse(cm.exception.transient)


class TestContentChecks(unittest.TestCase):
    def check(self, text: str):
        with tempfile.NamedTemporaryFile("wb", suffix=".csv", delete=False) as f:
            f.write(text.encode())
        try:
            return check_content(f.name)
        finally:
            Path(f.name).unlink()

    def test_good_file_with_comment_and_gaps(self):
        r = self.check("# meta\ntimestamp,t,rh\n2026-01-01T00:00:00Z,1.5,\n"
                       "2026-01-01T00:00:10Z,1.6,nan\n")
        self.assertTrue(r.ok, r.problems)
        self.assertEqual(r.rows, 2)
        self.assertEqual(r.last_timestamp, "2026-01-01T00:00:10Z")

    def test_problems(self):
        cases = {
            "": "empty",
            "timestamp,t\n2026-01-01T00:00:00Z,1": "newline",
            "time,t\n2026-01-01T00:00:00Z,1\n": "first column",
            "timestamp,t\n2026-01-01T00:00:00Z,1,2\n": "fields",
            "timestamp,t\nyesterday,1\n": "bad timestamp",
            "timestamp,t\n2026-01-01T00:00:10Z,1\n2026-01-01T00:00:00Z,1\n": "backwards",
            "timestamp,t\n2026-01-01T00:00:00Z,abc\n": "not a number",
            "timestamp,t\n": "no data rows",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                r = self.check(text)
                self.assertFalse(r.ok)
                self.assertIn(expected, " ".join(r.problems))

    def test_check_file_layers(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.csv"
            p.write_bytes(b"timestamp,t\n2026-01-01T00:00:00Z,1\n")
            import hashlib
            h = hashlib.sha256(p.read_bytes()).hexdigest()
            self.assertTrue(check_file(p, p.stat().st_size, h).ok)
            self.assertIn("size", check_file(p, 1, h).reason)
            self.assertIn("sha256", check_file(p, p.stat().st_size, "0" * 64).reason)
            self.assertIn("missing", check_file(Path(d) / "nope", 1, h).reason)


class TestConfigAndDB(unittest.TestCase):
    def test_backoff_doubles_and_caps(self):
        p = cfgm.RetryPolicy(base_delay_s=2, max_delay_s=10, jitter=0)
        self.assertEqual([p.delay(i) for i in range(1, 6)], [2, 4, 8, 10, 10])
        j = cfgm.RetryPolicy(base_delay_s=4, jitter=0.25)
        self.assertEqual((j.delay(1, 0.0), j.delay(1, 1.0)), (3.0, 5.0))

    def test_config_validation(self):
        with self.assertRaises(cfgm.ConfigError):
            cfgm.parse({"logger": [{"name": "a"}]})
        with self.assertRaises(cfgm.ConfigError):
            cfgm.parse({"logger": [{"name": "a", "url": "x"}, {"name": "a", "url": "y"}]})
        cfg = cfgm.parse({"data_dir": "d", "logger": [{"name": "a", "url": "http://h/"}]},
                         base=Path("/srv"))
        self.assertEqual(cfg.data_dir, Path("/srv/d"))
        self.assertEqual(cfg.logger("a").url, "http://h")

    def test_example_config_parses(self):
        cfg = cfgm.parse(__import__("tomllib").loads(cfgm.EXAMPLE))
        self.assertEqual(cfg.loggers[0].name, "sim-01")

    def test_migrations_are_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "h.db"
            dbm.HistoryDB(path).close()
            with dbm.HistoryDB(path) as h:
                self.assertEqual(h.schema_version, len(dbm.MIGRATIONS))
            conn = sqlite3.connect(path)
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            conn.close()
            self.assertTrue({"loggers", "sessions", "transfers"} <= tables)

    def test_dangling_transfers_closed(self):
        with dbm.HistoryDB(":memory:") as h:
            h.upsert_logger("L", "l", "u", None)
            h.record_manifest_entry(dbm.Session("L", "S1", None, None, 10, "ab"))
            h.start_transfer("L", "S1", 0)
            self.assertEqual(h.close_dangling_transfers(), 1)
            self.assertEqual(h.transfers()[0]["outcome"], "aborted")


class TestCLI(unittest.TestCase):
    def run_cli(self, *argv) -> tuple[int, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = cli.main(list(argv))
        self.stdout = out.getvalue()
        return rc, self.stdout + err.getvalue()

    def test_full_workflow(self):
        with tempfile.TemporaryDirectory() as d, \
                SimServer(SimLogger.generate(2, samples=50)) as srv:
            conf = Path(d) / "config.toml"
            self.assertEqual(self.run_cli("-c", str(conf), "init")[0], 0)
            conf.write_text(conf.read_text().replace("http://127.0.0.1:8080", srv.url))

            rc, out = self.run_cli("-c", str(conf), "status")
            self.assertEqual(rc, 0, out)
            self.assertIn("to download: 2", out)

            rc, out = self.run_cli("-c", str(conf), "sync", "--dry-run")
            self.assertIn("would download 2", out)

            rc, out = self.run_cli("sync", "-c", str(conf), "--json")
            self.assertEqual(rc, 0, out)
            self.assertTrue(json.loads(self.stdout)[0]["ok"])

            rc, out = self.run_cli("-c", str(conf), "sessions")
            self.assertEqual(out.count("verified"), 2)

            rc, out = self.run_cli("-c", str(conf), "history", "--json")
            self.assertEqual(len(json.loads(self.stdout)), 2)

            rc, out = self.run_cli("-c", str(conf), "verify")
            self.assertEqual(rc, 0)
            self.assertIn("checked 2", out)

            csv_path = Path(d) / "t.csv"
            self.run_cli("-c", str(conf), "export", str(csv_path), "--what", "transfers")
            self.assertEqual(len(csv_path.read_text().splitlines()), 3)

            rc, _ = self.run_cli("-c", str(conf), "retry")
            self.assertEqual(rc, 0)

    def test_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.run_cli("-c", f"{d}/missing.toml", "status")[0], cli.EXIT_CONFIG)
            conf = Path(d) / "c.toml"
            conf.write_text('[[logger]]\nname="x"\nurl="http://127.0.0.1:9"\ntimeout_s=0.3\n'
                            '[retry]\nmax_attempts=1\n')
            self.assertEqual(self.run_cli("-c", str(conf), "sync")[0], cli.EXIT_UNREACHABLE)


if __name__ == "__main__":
    unittest.main()
