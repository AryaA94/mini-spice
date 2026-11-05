# Architecture

Envi DAQ moves recording sessions off environmental data loggers in the field
and onto a host computer, checks that every byte arrived intact, and keeps a
permanent record of every transfer attempt.

```
 ┌─────────────────────────┐        Wi-Fi (802.11 b/g/n)       ┌──────────────────────────────────┐
 │  FIELD LOGGER           │   logger AP  or  site network     │  HOST COMPUTER                   │
 │                         │ ◄───────────────────────────────► │                                  │
 │  sensors → MCU → SD     │       HTTP/1.1, JSON + raw CSV    │  envi-daq sync  (cron / manual)  │
 │  session files S0001…   │                                   │    ├─ LoggerClient   (HTTP)      │
 │  manifest: size+sha256  │   GET /api/info                   │    ├─ Downloader     (resume,    │
 │  HTTP API on :80        │   GET /api/sessions               │    │                  retry)     │
 │                         │   GET /api/sessions/<id>/data     │    ├─ verify         (checks)    │
 │                         │       Range: bytes=N-             │    └─ HistoryDB      (SQLite)    │
 └─────────────────────────┘                                   │                                  │
                                                               │  data/<logger_id>/<session>.csv  │
                                                               │  transfers.sqlite3               │
                                                               └──────────────────────────────────┘
```

## Components

### 1. Logger (field side)

The logger samples its sensors at a fixed interval and writes one CSV file per
**recording session** to its SD card. When a session closes (operator stops it,
the file reaches its size limit, or the logger reboots), the firmware computes
the file's SHA-256 and adds it to the session **manifest**. A session that is
still recording is listed with `"open": true` and is never downloaded: its
size and hash are still changing.

The logger never deletes sessions on its own because of a download. Freeing
SD space is a separate, deliberate operator action, so the host can always
fetch a file again if it needs to.

### 2. Wi-Fi link

There are two supported topologies:

| Topology | Logger address | When to use |
|---|---|---|
| **Logger access point**: the logger runs its own AP (`ENVI-xxxx`), and the host joins it | `http://192.168.4.1` | Site visits with a laptop; no site infrastructure |
| **Site network**: the logger joins existing Wi-Fi as a client | DHCP reservation, e.g. `http://10.20.0.31` | Permanent installs with a fixed host that syncs on a schedule |

Either way, the link is assumed to be **unreliable**: weak signal at range,
interference, and AP power-saving all cause stalls and dropped TCP
connections mid-transfer. The host software is designed around that
assumption (see *Failure handling* below) rather than trying to make the link
reliable.

### 3. Host computer

A Linux, macOS or Windows machine running Python 3.11+. It needs nothing
beyond the standard library. `envi-daq sync` does the following, per configured logger:

1. **Discover**: `GET /api/info` (identity, firmware, free space) and
   `GET /api/sessions` (manifest). Retried with backoff in case the logger is
   briefly unreachable.
2. **Reconcile**: every closed session in the manifest is upserted into the
   `sessions` table. New ones become `pending`.
3. **Download**: each `pending` session streams into `<session>.csv.part`.
4. **Verify**: size, then SHA-256, then content checks (below).
5. **Commit**: atomic `rename(.part → .csv)`, then the session is marked `verified`.

## Logger HTTP API contract

| Request | Response |
|---|---|
| `GET /api/info` | `{"logger_id": "ENV-0A17", "name": "...", "firmware": "2.4.1", "free_bytes": 3900000000, "battery_v": 3.98, "clock": "..."}` |
| `GET /api/sessions` | `{"sessions": [{"id": "S0001", "started_at": "...", "ended_at": "...", "size_bytes": 92084, "sha256": "…", "open": false}, …]}` |
| `GET /api/sessions/<id>/data` | `200` and the full file, or `206` with `Content-Range: bytes N-M/TOTAL` when `Range: bytes=N-` is sent |
| `503` | Logger busy (e.g. flushing SD). Transient, so the host retries |
| `404` | Unknown session. Permanent |
| `416` | Resume offset past end of file. The host discards the partial and restarts |

`logger_id` is the stable hardware identity. Config names (`roof-01`) are
human labels and can change without affecting history.

### Session file format

```
# logger_id=ENV-0A17 session=0001 interval_s=10      <- optional comment lines
timestamp,temperature_c,humidity_pct,pressure_hpa,battery_v
2026-06-01T00:00:00Z,13.41,69.4,1013.21,4.150
2026-06-01T00:00:10Z,13.38,,1013.19,4.150             <- empty cell = sensor dropout
```

## File checks

The checks run in order, cheapest first, and the first failure stops the rest:

| Check | Catches | On failure |
|---|---|---|
| **Size** equals the manifest's `size_bytes` | Truncated or over-long transfers | Resume (short) or restart (long) |
| **SHA-256** equals the manifest's `sha256` | Corruption in transit | Discard `.part`, re-download from byte 0 |
| **Content**: header starts with `timestamp`, consistent field counts, ISO timestamps that never go backwards, numeric cells, trailing newline | Logger-side faults: SD write errors, firmware bugs, a clock that jumped | Quarantine as `<session>.invalid.csv`, mark `invalid`, **no retry**: the bytes are exactly what the logger holds |

`envi-daq verify` reruns the size and hash checks over the whole archive later,
to catch bit rot, accidental edits or deleted files on the host.

## Failure handling

| Failure | Detection | Response |
|---|---|---|
| Logger out of range | Connect error/timeout on discovery | Retry with backoff. Then report `UNREACHABLE` (exit 3) and move to the next logger |
| Wi-Fi drop mid-transfer | Stream ends before `size_bytes` | Keep `.part` (fsynced), back off, resume with `Range: bytes=<part size>-` |
| Firmware ignores `Range` | `200` instead of `206` | Truncate `.part`, restart from byte 0 |
| Logger busy | `503` | Back off and retry |
| Corrupted bytes | SHA-256 mismatch | Discard and re-download |
| Retries exhausted | `max_attempts` reached in one run | Mark `failed`. `envi-daq retry` re-queues it |
| Host killed mid-sync | Transfer row with no `finished_at` | Next sync marks it `aborted`. The `.part` resumes |
| Two syncs at once | `flock` on `transfers.sqlite3.lock` | The second exits with code 4 |
| Logger changes an archived session | Manifest hash ≠ archived hash | Mark `conflict` and **never overwrite**. A human decides |

Backoff for retry *n* is `min(max_delay, base_delay × 2ⁿ⁻¹)` ± `jitter`.

## Transfer history (SQLite)

```
loggers   (logger_id PK, name, base_url, firmware, last_seen)
sessions  (logger_id, session_id) PK
          started_at, ended_at, size_bytes, sha256,
          status ∈ {pending, downloading, verified, failed, invalid, conflict},
          local_path, row_count, attempts, last_error, first_seen, completed_at
transfers (transfer_id PK, logger_id, session_id, attempt, started_at, finished_at,
           resumed_from, bytes_received, duration_s,
           outcome ∈ {ok, retry, error, aborted}, error)
```

Each download attempt gets its own `transfers` row, so you can always answer
questions like "how many tries did S0042 take, where did each one resume, and
why did it fail?" The database uses WAL mode, so data engineers can query it
read-only (`sqlite3`, pandas, DBeaver) while a sync is running. Schema
changes are versioned through `PRAGMA user_version` (`envi_daq/db.py:MIGRATIONS`).

Useful queries:

```sql
-- Sessions that needed more than one attempt
SELECT logger_id, session_id, attempts, last_error FROM sessions WHERE attempts > 1;

-- Link quality per logger: share of attempts that failed
SELECT logger_id, ROUND(100.0 * SUM(outcome != 'ok') / COUNT(*), 1) AS pct_failed,
       ROUND(SUM(bytes_received) / SUM(duration_s) / 1024, 1) AS kib_per_s
FROM transfers GROUP BY logger_id;
```

## Code map

| Module | Responsibility |
|---|---|
| `envi_daq/config.py` | TOML config, retry policy and backoff |
| `envi_daq/client.py` | Logger HTTP API, classifying errors as transient or permanent |
| `envi_daq/downloader.py` | Sync orchestration, resume, retry, atomic commit |
| `envi_daq/verify.py` | Size, SHA-256 and content checks |
| `envi_daq/db.py` | SQLite schema, migrations, history queries |
| `envi_daq/cli.py` | `envi-daq` command, output formats, exit codes, sync lock |
| `envi_daq/simulator.py` | Fake logger with fault injection for development and tests |
