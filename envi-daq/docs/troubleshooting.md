# Troubleshooting

Start with these three commands. Together they answer most questions:

```bash
envi-daq status                     # can we see the logger at all?
envi-daq sessions --errors          # which sessions are stuck, and why?
envi-daq history --session S0042    # every attempt for one session
```

Add `-v` (or `-vv`) to any command for detailed logging. If `log_file` is set
in the config, sync logs are also written there with timestamps.

---

### `UNREACHABLE -- cannot reach logger at http://…: [Errno 113] No route to host` (exit 3)

The host can't reach the logger's address.

- **AP mode**: is the laptop actually joined to `ENVI-xxxx`? Operating systems
  often switch back to a known network silently when the logger's AP has no
  internet access. Turn off "auto-join" for other networks while on site.
- **Site network**: check the logger's address in the router's DHCP lease
  table and compare it with the `url` in `config.toml`.
- `ping <logger ip>`, then `curl http://<logger ip>/api/info`. If curl works
  but envi-daq doesn't, check for a proxy in `HTTP_PROXY` / `http_proxy`.
  urllib respects it, so set `NO_PROXY=<logger ip>`.
- Is the logger asleep? Many loggers turn off Wi-Fi between sample bursts to
  save battery. Wake it, or schedule syncs inside its radio window.

### `timed out after 10s contacting …`

The link is up but marginal. Raise `timeout_s` for that logger, move the host
or antenna closer, or check for 2.4 GHz interference. `history` shows how far
each attempt got, so a session that keeps progressing will finish over
several runs.

### Session keeps failing with `short transfer: stream ended at byte N/M`

Wi-Fi drops mid-transfer. This is expected and handled: each attempt resumes
where the last one stopped (see `resumed_from` in `history`). If a session
ends up `failed`:

```bash
envi-daq retry --session S0042
```

If it fails repeatedly at the **same byte offset**, the logger can't read
that part of its SD card. Pull the card and copy the file directly.

### `logger ignored resume request; restarting from byte 0`

Older firmware doesn't support HTTP `Range`, so every drop restarts the file.
Upgrade the logger firmware, or improve the link so large sessions finish in
one attempt.

### `sha256 mismatch … discarding partial and re-downloading`

The received bytes don't match the logger's checksum. An occasional mismatch is a
transient bit error and is retried automatically. If it **always** happens for
one session, either the logger's manifest hash is stale (a firmware bug: report
it with the session ID) or something on the path modifies the data, such as a
captive portal or a "helpful" proxy. Test with a direct connection.

### Session is `invalid`: `content check failed: …`

The file matches the logger's checksum exactly, so the transfer was fine; the
problem is what the logger wrote. The file is kept as
`<session>.invalid.csv` for inspection. Common causes:

| Message | Likely cause |
|---|---|
| `does not end with a newline` | Logger lost power mid-write |
| `timestamp … goes backwards` | Logger RTC was reset or resynced during the session |
| `N fields, header has M` | SD write error or a firmware bug |
| `not valid UTF-8` | SD card corruption |

If you decide the file is usable anyway (for example, a clock jump you'll correct
downstream), process the `.invalid.csv` by hand. To try downloading it again
after a firmware fix: `envi-daq retry --session S0042 --include-invalid`.

### Session is `conflict`

The logger now reports a different size or hash for a session that's
already archived. envi-daq **never overwrites a verified file**. Check:

- Was the logger's SD card reformatted and session IDs reused? Then this is a
  different recording with the same name. Move the old file aside, then run
  `envi-daq retry --session S0042` after setting its status back with:
  `sqlite3 transfers.sqlite3 "UPDATE sessions SET status='failed' WHERE session_id='S0042'"`.
- Did firmware rewrite a closed session? Report it to the firmware team.

### `envi-daq verify` reports problems

Archived files changed on the host after verification (disk error, someone
edited a CSV, a file was deleted). `envi-daq verify --requeue` deletes the bad
copies and re-downloads them on the next sync, as long as the logger still has them.

### `another envi-daq sync is already running` (exit 4)

A previous sync is still going, which usually means a slow link and a short cron
interval. This is harmless. If no sync is actually running, the lock is
released automatically when the process exits, so a stale lock file is fine
to leave in place.

### `closed N transfer(s) left open by a previous interrupted run`

The previous sync was killed (Ctrl-C, reboot, OOM). Those attempts are
recorded as `aborted`, and their partial files resume normally.

### `config error: …` (exit 2)

The message names the problem. Check that `[[logger]]` blocks each have
`name` and `url`, that names are unique, and that the TOML is valid.
`envi-daq init --force` writes a fresh example config to compare against.

---

## Collecting a bug report

```bash
envi-daq --version
envi-daq status --json > status.json
envi-daq history --limit 200 --json > history.json
envi-daq export sessions.csv
```

Send these along with the `log_file`, and the firmware version from `status`.
