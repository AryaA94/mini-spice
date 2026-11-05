"""HTTP client for the logger's on-board API.

The logger firmware exposes a small JSON/HTTP API over its Wi-Fi interface
(see docs/architecture.md for the full contract):

  GET /api/info                       -> {"logger_id", "name", "firmware", "free_bytes", ...}
  GET /api/sessions                   -> {"sessions": [{"id", "started_at", "ended_at",
                                                        "size_bytes", "sha256", "open"}]}
  GET /api/sessions/<id>/data         -> raw session file; honours `Range: bytes=N-`
"""

from __future__ import annotations

import http.client
import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Iterator
from urllib.parse import quote

from envi_daq import __version__


class LoggerError(Exception):
    """A request to the logger failed.

    `transient` errors (timeouts, dropped Wi-Fi, 5xx) are worth retrying;
    the rest (404, malformed responses) are not.
    """

    def __init__(self, message: str, transient: bool = True):
        super().__init__(message)
        self.transient = transient


class RangeNotSatisfiable(LoggerError):
    """The logger rejected our resume offset (HTTP 416); restart from byte 0."""

    def __init__(self, message: str):
        super().__init__(message, transient=True)


@dataclass(frozen=True)
class ManifestEntry:
    session_id: str
    started_at: str | None
    ended_at: str | None
    size_bytes: int
    sha256: str
    open: bool  # still recording; not safe to download yet


@dataclass
class Download:
    """An open download stream. `offset` is where the body starts in the file."""

    offset: int
    total_size: int | None
    _resp: http.client.HTTPResponse

    def chunks(self, size: int) -> Iterator[bytes]:
        try:
            while True:
                buf = self._resp.read(size)
                if not buf:
                    return
                yield buf
        except http.client.IncompleteRead as e:
            if e.partial:
                yield e.partial
            raise LoggerError(f"connection dropped mid-transfer ({len(e.partial)} bytes in last read)")
        except (TimeoutError, socket.timeout):
            raise LoggerError("read timed out mid-transfer")
        except (ConnectionError, OSError) as e:
            raise LoggerError(f"connection lost mid-transfer: {e}")

    def close(self) -> None:
        self._resp.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class LoggerClient:
    def __init__(self, base_url: str, timeout_s: float = 10.0, token: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.token = token

    def _open(self, path: str, headers: dict[str, str] | None = None) -> http.client.HTTPResponse:
        req = urllib.request.Request(self.base_url + path, headers={
            "User-Agent": f"envi-daq/{__version__}",
            **({"Authorization": f"Bearer {self.token}"} if self.token else {}),
            **(headers or {}),
        })
        try:
            return urllib.request.urlopen(req, timeout=self.timeout_s)
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 416:
                raise RangeNotSatisfiable(f"{path}: HTTP 416 range not satisfiable")
            transient = e.code >= 500 or e.code in (408, 429)
            raise LoggerError(f"{path}: HTTP {e.code} {e.reason}", transient=transient)
        except urllib.error.URLError as e:
            raise LoggerError(f"cannot reach logger at {self.base_url}: {e.reason}")
        except (TimeoutError, socket.timeout):
            raise LoggerError(f"timed out after {self.timeout_s}s contacting {self.base_url}")
        except (ConnectionError, http.client.HTTPException, OSError) as e:
            raise LoggerError(f"connection error talking to {self.base_url}: {e}")

    def _json(self, path: str) -> dict:
        with self._open(path) as resp:
            try:
                body = resp.read()
            except (TimeoutError, socket.timeout, OSError, http.client.HTTPException) as e:
                raise LoggerError(f"{path}: failed reading response: {e}")
        try:
            data = json.loads(body)
        except ValueError:
            raise LoggerError(f"{path}: logger returned invalid JSON", transient=False)
        if not isinstance(data, dict):
            raise LoggerError(f"{path}: expected a JSON object", transient=False)
        return data

    def info(self) -> dict:
        info = self._json("/api/info")
        if "logger_id" not in info:
            raise LoggerError("/api/info: response has no logger_id", transient=False)
        return info

    def sessions(self) -> list[ManifestEntry]:
        data = self._json("/api/sessions")
        out = []
        try:
            for s in data["sessions"]:
                out.append(ManifestEntry(
                    session_id=str(s["id"]),
                    started_at=s.get("started_at"),
                    ended_at=s.get("ended_at"),
                    size_bytes=int(s["size_bytes"]),
                    sha256=str(s["sha256"]).lower(),
                    open=bool(s.get("open", False)),
                ))
        except (KeyError, TypeError, ValueError) as e:
            raise LoggerError(f"/api/sessions: malformed manifest ({e!r})", transient=False)
        return out

    def download(self, session_id: str, offset: int = 0) -> Download:
        headers = {"Range": f"bytes={offset}-"} if offset > 0 else {}
        resp = self._open(f"/api/sessions/{quote(session_id, safe='')}/data", headers)
        if resp.status == 206:
            # Content-Range: bytes 1000-4999/5000
            cr = resp.headers.get("Content-Range", "")
            try:
                start = int(cr.split()[1].split("-")[0])
                total = int(cr.rsplit("/", 1)[1])
            except (IndexError, ValueError):
                resp.close()
                raise LoggerError(f"bad Content-Range header: {cr!r}", transient=False)
            if start != offset:
                resp.close()
                raise LoggerError(f"logger resumed at byte {start}, asked for {offset}")
            return Download(offset=start, total_size=total, _resp=resp)
        # 200: logger ignored the Range header and is sending the whole file.
        length = resp.headers.get("Content-Length")
        return Download(offset=0, total_size=int(length) if length else None, _resp=resp)
