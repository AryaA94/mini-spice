"""Host configuration, loaded from a TOML file.

Example (see config.example.toml):

    data_dir = "~/envi-daq/data"
    database = "~/envi-daq/transfers.sqlite3"

    [retry]
    max_attempts = 5
    base_delay_s = 2.0
    max_delay_s = 60.0

    [[logger]]
    name = "roof-01"
    url = "http://192.168.4.1"
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ConfigError(Exception):
    """The config file is missing, unreadable or invalid."""


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 5
    base_delay_s: float = 2.0
    max_delay_s: float = 60.0
    jitter: float = 0.25  # +/- fraction applied to each delay

    def delay(self, attempt: int, rand: float = 0.5) -> float:
        """Backoff before retry number `attempt` (1-based). `rand` is in [0, 1)."""
        base = min(self.max_delay_s, self.base_delay_s * 2 ** (attempt - 1))
        return max(0.0, base * (1 + self.jitter * (2 * rand - 1)))


@dataclass(frozen=True)
class LoggerConfig:
    name: str
    url: str
    timeout_s: float = 10.0
    token: str | None = None  # sent as a Bearer token if the logger needs one


@dataclass(frozen=True)
class Config:
    data_dir: Path
    database: Path
    loggers: list[LoggerConfig] = field(default_factory=list)
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    chunk_size: int = 64 * 1024
    log_file: Path | None = None

    def logger(self, name: str) -> LoggerConfig:
        for lg in self.loggers:
            if lg.name == name:
                return lg
        known = ", ".join(lg.name for lg in self.loggers) or "none"
        raise ConfigError(f"no logger named {name!r} in config (known: {known})")


def _path(value: str, base: Path) -> Path:
    p = Path(value).expanduser()
    return p if p.is_absolute() else (base / p).resolve()


def load(path: str | Path) -> Config:
    path = Path(path).expanduser()
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"config file not found: {path} (run `envi-daq init` to create one)")
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{path}: invalid TOML: {e}")
    return parse(raw, base=path.parent)


def parse(raw: dict, base: Path = Path(".")) -> Config:
    try:
        retry_raw = raw.get("retry", {})
        retry = RetryPolicy(
            max_attempts=int(retry_raw.get("max_attempts", 5)),
            base_delay_s=float(retry_raw.get("base_delay_s", 2.0)),
            max_delay_s=float(retry_raw.get("max_delay_s", 60.0)),
            jitter=float(retry_raw.get("jitter", 0.25)),
        )
        if retry.max_attempts < 1:
            raise ConfigError("retry.max_attempts must be >= 1")

        loggers = []
        for i, lg in enumerate(raw.get("logger", [])):
            if "name" not in lg or "url" not in lg:
                raise ConfigError(f"logger #{i + 1} needs both 'name' and 'url'")
            loggers.append(
                LoggerConfig(
                    name=str(lg["name"]),
                    url=str(lg["url"]).rstrip("/"),
                    timeout_s=float(lg.get("timeout_s", 10.0)),
                    token=lg.get("token"),
                )
            )
        names = [lg.name for lg in loggers]
        if len(names) != len(set(names)):
            raise ConfigError("logger names must be unique")

        return Config(
            data_dir=_path(raw.get("data_dir", "data"), base),
            database=_path(raw.get("database", "transfers.sqlite3"), base),
            loggers=loggers,
            retry=retry,
            chunk_size=int(raw.get("chunk_size", 64 * 1024)),
            log_file=_path(raw["log_file"], base) if raw.get("log_file") else None,
        )
    except (TypeError, ValueError) as e:
        raise ConfigError(f"invalid config value: {e}")


EXAMPLE = """\
# Envi DAQ host configuration
# Relative paths are resolved against this file's directory.

data_dir = "data"                 # verified session files land in data/<logger_id>/
database = "transfers.sqlite3"    # transfer history
log_file = "envi-daq.log"         # optional; remove to log to the console only

[retry]
max_attempts = 5      # per session, per sync run
base_delay_s = 2.0    # doubles each retry: 2, 4, 8, 16 ...
max_delay_s = 60.0
jitter = 0.25

# One [[logger]] block per field logger. On the logger's own access point the
# address is usually http://192.168.4.1; on site Wi-Fi use its DHCP reservation.
[[logger]]
name = "sim-01"
url = "http://127.0.0.1:8080"
timeout_s = 10
"""
