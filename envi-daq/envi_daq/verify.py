"""File checks for downloaded sessions.

Three layers, cheapest first:
  1. size     -- byte count matches the logger's manifest
  2. sha256   -- digest matches the logger's manifest (catches corruption in transit)
  3. content  -- the file parses as a session CSV (catches logger-side problems:
                 truncated writes, SD-card faults, firmware bugs) -- see check_content
"""

from __future__ import annotations

import csv
import hashlib
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

MAX_REPORTED_PROBLEMS = 10


def sha256_file(path: str | Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while buf := f.read(chunk_size):
            h.update(buf)
    return h.hexdigest()


@dataclass
class ContentReport:
    rows: int = 0
    columns: list[str] = field(default_factory=list)
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems

    def problem(self, msg: str) -> None:
        if len(self.problems) < MAX_REPORTED_PROBLEMS:
            self.problems.append(msg)
        elif len(self.problems) == MAX_REPORTED_PROBLEMS:
            self.problems.append("... further problems suppressed")


def _parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def check_content(path: str | Path) -> ContentReport:
    """Validate a session CSV.

    Expected layout: optional `#` comment lines (logger metadata), then a header
    whose first column is `timestamp`, then one row per sample. Timestamps are
    ISO-8601 and must not go backwards. Other columns are numeric; an empty
    cell or `nan` is an allowed missing sample (e.g. a sensor dropout).
    """
    rep = ContentReport()
    path = Path(path)
    size = path.stat().st_size
    if size == 0:
        rep.problem("file is empty")
        return rep
    with open(path, "rb") as f:
        f.seek(-1, 2)
        if f.read(1) != b"\n":
            rep.problem("file does not end with a newline (truncated write?)")

    # Stream the file: sessions can be large, so never hold it all in memory.
    f = open(path, "r", encoding="utf-8", newline="")
    try:
        lines = (ln for ln in f if not ln.startswith("#"))
        reader = csv.reader(lines)
        try:
            header = next(reader, None)
        except UnicodeDecodeError as e:
            rep.problem(f"not valid UTF-8 near byte {e.start}")
            return rep
        if not header:
            rep.problem("no header row")
            return rep
        header = [h.strip() for h in header]
        rep.columns = header
        if header[0] != "timestamp":
            rep.problem(f"first column must be 'timestamp', got {header[0]!r}")
            return rep
        if len(header) < 2:
            rep.problem("no data channels in header")
        try:
            _check_rows(reader, header, rep)
        except UnicodeDecodeError as e:
            rep.problem(f"not valid UTF-8 near byte {e.start}")
    finally:
        f.close()
    if rep.rows == 0 and rep.ok:
        rep.problem("header present but no data rows")
    return rep


def _check_rows(reader, header: list[str], rep: ContentReport) -> None:
    prev: datetime | None = None
    for lineno, row in enumerate(reader, start=2):
        if not row:
            continue
        rep.rows += 1
        if len(row) != len(header):
            rep.problem(f"row {lineno}: {len(row)} fields, header has {len(header)}")
            continue
        try:
            ts = _parse_ts(row[0])
        except ValueError:
            rep.problem(f"row {lineno}: bad timestamp {row[0]!r}")
            continue
        if prev is not None and ts < prev:
            rep.problem(f"row {lineno}: timestamp {row[0]} goes backwards")
        prev = ts
        if rep.first_timestamp is None:
            rep.first_timestamp = row[0]
        rep.last_timestamp = row[0]
        for col, cell in zip(header[1:], row[1:]):
            cell = cell.strip()
            if cell == "" or cell.lower() == "nan":
                continue
            try:
                v = float(cell)
            except ValueError:
                rep.problem(f"row {lineno}: {col}={cell!r} is not a number")
                continue
            if math.isinf(v):
                rep.problem(f"row {lineno}: {col} is infinite")


@dataclass
class FileCheck:
    ok: bool
    reason: str | None = None
    content: ContentReport | None = None


def check_file(path: str | Path, size_bytes: int, sha256: str, content: bool = True) -> FileCheck:
    path = Path(path)
    if not path.exists():
        return FileCheck(False, "file missing")
    actual_size = path.stat().st_size
    if actual_size != size_bytes:
        return FileCheck(False, f"size {actual_size} != expected {size_bytes}")
    digest = sha256_file(path)
    if digest != sha256.lower():
        return FileCheck(False, f"sha256 {digest[:12]}... != expected {sha256[:12]}...")
    if not content:
        return FileCheck(True)
    rep = check_content(path)
    if not rep.ok:
        return FileCheck(False, "content: " + "; ".join(rep.problems), rep)
    return FileCheck(True, content=rep)
