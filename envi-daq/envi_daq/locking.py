"""Cross-platform single-instance lock for sync runs."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path


class SyncLocked(Exception):
    """Another process holds the sync lock."""


@contextmanager
def sync_lock(db_path: Path):
    """Stop two syncs (overlapping cron runs, CLI + dashboard) writing the same files.

    The OS releases the lock when the process exits, so a crash never leaves
    a stale lock behind.
    """
    lock_path = Path(db_path).with_name(Path(db_path).name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    f = open(lock_path, "a+")
    try:
        try:
            try:
                import fcntl
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except ImportError:  # Windows
                import msvcrt
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise SyncLocked(f"another envi-daq sync holds {lock_path}")
        yield
    finally:
        f.close()
