# Envi DAQ: Telemetry Download System

Pulls recording sessions off Wi-Fi environmental data loggers onto a host
computer, verifies every file, retries and resumes over unreliable links,
and keeps a full transfer history in SQLite.

**Python 3.11+, standard library only** (urllib, sqlite3, tomllib, http.server).

```
 Field logger  ──Wi-Fi / HTTP──►  Host: envi-daq sync  ──►  data/<logger>/<session>.csv
 (SD sessions,                     resume · retry ·         transfers.sqlite3
  manifest w/ sha256)              size+sha256+content       (every attempt logged)
```

## What it does

- **Session downloads**: reads each logger's manifest and downloads every
  closed session not yet archived. Sessions still recording are skipped.
- **File checks**: byte count, then SHA-256 against the logger's manifest,
  then a content check of the CSV (header, field counts, ISO timestamps that
  never go backwards, numeric values). Files are only renamed into place after
  all three pass.
- **Retries**: transient failures (Wi-Fi drop, timeout, 503, short read)
  back off exponentially with jitter. Dropped transfers **resume** via HTTP
  `Range` instead of starting over. Corrupted transfers are discarded and
  downloaded again.
- **Transfer history**: every attempt is a row in SQLite, recording when it ran, where it resumed,
  how many bytes it moved, how long it took, and why it failed. Data engineers can query
  the database directly or export it to CSV.
- **Built for unattended use**: meaningful exit codes, `--json` output, a
  sync lock so overlapping cron runs are safe, recovery after a crash, and a
  rule that it never overwrites an archived file.

## Quick start (no hardware needed)

```bash
cd envi-daq
pip install .                                   # or use `python -m envi_daq` in place of `envi-daq`

envi-daq simulate --drop-rate 0.35 --corrupt-rate 0.1 &   # a fake logger on :8080 with a bad link
envi-daq init                                   # writes config.toml pointing at it
envi-daq status
envi-daq sync
envi-daq sessions
envi-daq history
```

```
$ envi-daq status
sim-01 (ENV-0A17, fw 2.4.1-sim) at http://127.0.0.1:8080: online
  on logger: 5 sessions (1 recording), free 3.6 GB
  to download: 4   archived: 0   failed: 0   invalid: 0   conflict: 0

$ envi-daq sync
WARNING ENV-0A17/S0001: attempt 1/5 failed: sha256 mismatch (got 0b940f9d5a69..., expected 954d9fd7fe97...); discarding partial and re-downloading; retrying in 2.1s
WARNING ENV-0A17/S0002: attempt 1/5 failed: short transfer: stream ended at byte 69792/92092; retrying in 1.9s
sim-01 (ENV-0A17): 4 new, 4 downloaded, 0 failed, 1 still recording

$ envi-daq history
transfer_id  logger_id  session_id  attempt  outcome  resumed_from  bytes    duration_s  error
-----------  ---------  ----------  -------  -------  ------------  -------  ----------  ------------------------------------------------
6            ENV-0A17   S0004       1        ok                     89.9 KB  0.004
5            ENV-0A17   S0003       1        ok                     89.9 KB  0.004
4            ENV-0A17   S0002       2        ok       69792         21.8 KB  0.004
3            ENV-0A17   S0002       1        retry                  68.2 KB  0.001       short transfer: stream ended at byte 69792/92092
2            ENV-0A17   S0001       2        ok                     89.9 KB  0.004
1            ENV-0A17   S0001       1        retry                  89.9 KB  0.002       sha256 mismatch (got 0b940f9d5a69..., expected 954d9fd7fe97...)
```

The output above is trimmed slightly for width. Attempt 4 resumed at byte 69792 and transferred only the remaining 21.8 KB.

## Commands

| Command | Purpose |
|---|---|
| `envi-daq init` | Write a starter `config.toml` and create the database |
| `envi-daq status` | Is each logger reachable? Firmware, free space, how many sessions are pending |
| `envi-daq sync [--logger N] [--session ID] [--dry-run]` | Download and verify everything new |
| `envi-daq sessions [--status S] [--errors]` | List sessions, their status and where they're stored on disk |
| `envi-daq history [--session ID] [--limit N]` | Per-attempt transfer log |
| `envi-daq retry [--session ID] [--include-invalid]` | Re-queue failed sessions, then sync |
| `envi-daq verify [--requeue]` | Re-check archived files against their recorded checksums |
| `envi-daq export FILE [--what sessions\|transfers]` | Export history as CSV |
| `envi-daq simulate [--fail-rate --drop-rate --corrupt-rate --latency --ignore-range]` | Run a fake logger with fault injection |

Global flags: `-c CONFIG` (or `$ENVI_DAQ_CONFIG`), `-v`/`-vv`, and `--json` on read commands.
Exit codes: `0` ok · `1` failures/conflicts/bad files · `2` config error · `3` unreachable · `4` sync already running.

## Session lifecycle

```
            manifest lists it (closed)
                     │
                     ▼
  ┌──────────► pending ──► downloading ──┬──► verified ──(logger hash changes)──► conflict
  │                              ▲  │    │
  │ retry                 resume │  │    ├──► invalid   (content check failed; quarantined)
  │                              └──┘    │
  └──────────────── failed ◄─────────────┘   (max_attempts exhausted this run)
```

## Docs

- [`docs/architecture.md`](docs/architecture.md): how the logger, the Wi-Fi link and the host fit together, the logger API contract, file checks, failure handling and the SQLite schema
- [`docs/setup.md`](docs/setup.md): install, configure, connect over Wi-Fi, schedule with cron or Task Scheduler, hand off to data engineering
- [`docs/troubleshooting.md`](docs/troubleshooting.md): each error message, what it means and what to do

## Tests

```bash
python -m unittest discover -s tests -v      # also works with pytest
```

The tests run against the simulator over real HTTP. They cover the happy path,
idempotent re-syncs, resuming after drops, re-downloading after corruption,
firmware without `Range` support, exhausted retries followed by `retry`, checksum
conflicts, content quarantine, unreachable loggers, schema migrations,
crash recovery and the CLI end to end.

## Layout

```
envi_daq/
  cli.py          command-line interface, exit codes, sync lock
  config.py       TOML config + retry/backoff policy
  client.py       logger HTTP API client (transient vs permanent errors)
  downloader.py   sync loop: reconcile manifest, resume, verify, retry, commit
  verify.py       size / SHA-256 / CSV content checks
  db.py           SQLite schema, migrations, history queries
  simulator.py    fake logger with fault injection
tests/            unittest suite
docs/             architecture, setup, troubleshooting
```
