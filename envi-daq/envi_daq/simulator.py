"""Logger simulator: a stand-in for the field logger's Wi-Fi HTTP API.

Use it to develop and test the host software without hardware, and to
rehearse failure modes on demand:

    envi-daq simulate --port 8080 --sessions 6 --drop-rate 0.3 --corrupt-rate 0.1

Fault injection (each applied independently per data request, from a seeded RNG):
  --fail-rate     respond 503 (logger busy writing to SD card)
  --drop-rate     send part of the body, then cut the connection (Wi-Fi drop)
  --corrupt-rate  flip one byte in the body (bit error the TCP checksum missed)
  --latency       seconds to sleep before every response
  --bandwidth     cap the data rate in bytes/s (a weak link is slow, not just flaky)
  --rssi          reported Wi-Fi signal strength in dBm

`envi-daq demo` runs a small fleet of these (see FLEET) behind the web dashboard.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

COLUMNS = "timestamp,temperature_c,humidity_pct,pressure_hpa,battery_v"


def make_session_csv(logger_id: str, index: int, start: datetime, samples: int,
                     interval_s: int, seed: int) -> bytes:
    rng = random.Random(seed * 1000 + index)
    out = [f"# logger_id={logger_id} session={index:04d} interval_s={interval_s}", COLUMNS]
    batt = 4.15 - 0.02 * index
    for i in range(samples):
        t = start + timedelta(seconds=i * interval_s)
        day = 2 * math.pi * (t.hour * 3600 + t.minute * 60 + t.second) / 86400
        temp = 18 + 6 * math.sin(day - 1.8) + rng.gauss(0, 0.15)
        rh = 55 - 15 * math.sin(day - 1.8) + rng.gauss(0, 0.8)
        p = 1013.2 + 2.5 * math.sin(i / 400) + rng.gauss(0, 0.05)
        batt -= 0.00002
        rh_s = "" if rng.random() < 0.002 else f"{rh:.1f}"  # occasional sensor dropout
        out.append(f"{t.strftime('%Y-%m-%dT%H:%M:%SZ')},{temp:.2f},{rh_s},{p:.2f},{batt:.3f}")
    return ("\n".join(out) + "\n").encode()


@dataclass
class SimSession:
    session_id: str
    started_at: str
    ended_at: str | None
    data: bytes
    open: bool = False

    def manifest(self) -> dict:
        return {
            "id": self.session_id,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "size_bytes": len(self.data),
            "sha256": hashlib.sha256(self.data).hexdigest(),
            "open": self.open,
        }


@dataclass
class Faults:
    fail_rate: float = 0.0
    drop_rate: float = 0.0
    corrupt_rate: float = 0.0
    latency_s: float = 0.0
    ignore_range: bool = False  # emulate old firmware without resume support
    bandwidth_bps: int = 0      # 0 = unlimited


@dataclass
class SimLogger:
    logger_id: str = "ENV-0A17"
    name: str = "Envi field logger (simulated)"
    firmware: str = "2.4.1-sim"
    rssi_dbm: int = -55
    sessions: dict[str, SimSession] = field(default_factory=dict)
    faults: Faults = field(default_factory=Faults)
    seed: int = 1
    request_log: list[str] = field(default_factory=list)

    def __post_init__(self):
        # Separate streams for "does a fault fire?" and "where?", so the two
        # don't correlate when drawn alternately from one generator.
        self.rng = random.Random(f"roll-{self.seed}")
        self.pick_rng = random.Random(f"pick-{self.seed}")
        self.lock = threading.Lock()

    @classmethod
    def generate(cls, n_sessions: int = 4, samples: int = 2000, interval_s: int = 10,
                 seed: int = 1, with_open: bool = True, **kw) -> "SimLogger":
        lg = cls(seed=seed, **kw)
        start = datetime(2026, 6, 1, tzinfo=timezone.utc)
        for i in range(1, n_sessions + 1):
            lg.add_session(i, start, samples, interval_s)
            start += timedelta(seconds=samples * interval_s + 3600)
        if with_open:
            lg.add_session(n_sessions + 1, start, samples // 4, interval_s, open=True)
        return lg

    def add_session(self, index: int, start: datetime, samples: int, interval_s: int,
                    open: bool = False) -> SimSession:
        data = make_session_csv(self.logger_id, index, start, samples, interval_s, self.seed)
        end = start + timedelta(seconds=(samples - 1) * interval_s)
        sid = f"S{index:04d}"
        s = SimSession(sid, start.isoformat(), None if open else end.isoformat(), data, open)
        self.sessions[sid] = s
        return s

    def roll(self, rate: float) -> bool:
        with self.lock:
            return rate > 0 and self.rng.random() < rate


def _handler(lg: SimLogger):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "EnviLogger/" + lg.firmware

        def log_message(self, fmt, *args):  # keep test output quiet
            pass

        def _json(self, code: int, obj) -> None:
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            lg.request_log.append(f"GET {self.path} range={self.headers.get('Range')}")
            if lg.faults.latency_s:
                time.sleep(lg.faults.latency_s)
            if self.path == "/api/info":
                with lg.lock:
                    rssi = lg.rssi_dbm + lg.pick_rng.randint(-4, 4)
                return self._json(200, {
                    "logger_id": lg.logger_id, "name": lg.name, "firmware": lg.firmware,
                    "rssi_dbm": rssi,
                    "free_bytes": 3_900_000_000 - sum(len(s.data) for s in lg.sessions.values()),
                    "battery_v": 3.98, "clock": datetime.now(timezone.utc).isoformat(),
                })
            if self.path == "/api/sessions":
                return self._json(200, {"sessions": [s.manifest() for s in lg.sessions.values()]})
            m = re.fullmatch(r"/api/sessions/([^/]+)/data", self.path)
            if m:
                return self._data(unquote(m.group(1)))
            return self._json(404, {"error": "not found"})

        def _data(self, sid: str) -> None:
            s = lg.sessions.get(sid)
            if s is None:
                return self._json(404, {"error": f"no session {sid}"})
            if lg.roll(lg.faults.fail_rate):
                return self._json(503, {"error": "busy"})
            data = s.data
            start = 0
            rng_hdr = self.headers.get("Range")
            if rng_hdr and not lg.faults.ignore_range:
                mm = re.fullmatch(r"bytes=(\d+)-", rng_hdr.strip())
                if not mm:
                    return self._json(400, {"error": "unsupported range"})
                start = int(mm.group(1))
                if start >= len(data):
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(data)}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
            body = bytearray(data[start:])
            if body and lg.roll(lg.faults.corrupt_rate):
                with lg.lock:
                    i = lg.pick_rng.randrange(len(body))
                body[i] ^= 0x20
            if start:
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
            else:
                self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if len(body) > 1 and lg.roll(lg.faults.drop_rate):
                with lg.lock:
                    cut = lg.pick_rng.randrange(1, len(body))
                self._send(body[:cut])
                self.close_connection = True
                self.connection.shutdown(2)
                return
            self._send(body)

        def _send(self, body: bytes) -> None:
            bw = lg.faults.bandwidth_bps
            if not bw:
                self.wfile.write(body)
                return
            step = max(512, bw // 20)  # ~20 writes per second
            for i in range(0, len(body), step):
                self.wfile.write(body[i:i + step])
                self.wfile.flush()
                time.sleep(len(body[i:i + step]) / bw)

    return Handler


class SimServer:
    """Run a SimLogger on a background thread (used by tests and `envi-daq simulate`)."""

    def __init__(self, logger: SimLogger, host: str = "127.0.0.1", port: int = 0):
        self.logger = logger
        self.httpd = ThreadingHTTPServer((host, port), _handler(logger))
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}"

    def start(self) -> "SimServer":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()


# Demo fleet: one logger per link quality, so the dashboard has something to show.
FLEET = [
    # name, logger_id, rssi, sessions, faults
    ("roof-01", "ENV-0A17", -52, 5, Faults(drop_rate=0.03, bandwidth_bps=160_000)),
    ("creek-02", "ENV-0B3C", -71, 4, Faults(fail_rate=0.1, drop_rate=0.3, corrupt_rate=0.06,
                                            bandwidth_bps=70_000)),
    ("ridge-03", "ENV-0C88", -83, 4, Faults(fail_rate=0.2, drop_rate=0.45, corrupt_rate=0.1,
                                            latency_s=0.15, bandwidth_bps=30_000)),
]


def start_fleet(samples: int = 2000, seed: int = 1) -> list[tuple[str, SimServer]]:
    servers = []
    for i, (name, lid, rssi, n, faults) in enumerate(FLEET):
        lg = SimLogger.generate(n_sessions=n, samples=samples, seed=seed + i, faults=faults,
                                logger_id=lid, rssi_dbm=rssi, name=f"Envi field logger {name}")
        servers.append((name, SimServer(lg).start()))
    return servers


def close_session(lg: SimLogger, samples: int = 2000, interval_s: int = 10) -> str:
    """Finish the open session and start recording a new one (used by the demo)."""
    with lg.lock:
        open_ = [s for s in lg.sessions.values() if s.open]
        for s in open_:
            s.open = False
            s.ended_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        idx = len(lg.sessions) + 1
    lg.add_session(idx, datetime.now(timezone.utc).replace(microsecond=0), samples // 4,
                   interval_s, open=True)
    return open_[0].session_id if open_ else ""
