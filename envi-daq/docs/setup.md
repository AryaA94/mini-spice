# Setup

## 1. Install on the host

Requires Python 3.11 or newer, with no other dependencies.

```bash
git clone <this repo> && cd envi-daq
python3 -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install .
envi-daq --version
```

Without installing, you can run it as `python -m envi_daq` from this directory.

## 2. Create a config

```bash
mkdir -p ~/envi-daq && cd ~/envi-daq
envi-daq -c config.toml init
```

This writes `config.toml` and creates `transfers.sqlite3`. Relative paths in
the config resolve against the config file's own folder. Set
`ENVI_DAQ_CONFIG=~/envi-daq/config.toml` so you can drop the `-c` flag.

Add one `[[logger]]` block per logger:

```toml
[[logger]]
name = "roof-01"                 # your label; shows up in output
url = "http://10.20.0.31"        # site network (DHCP reservation)
timeout_s = 10

[[logger]]
name = "creek-02"
url = "http://192.168.4.1"       # logger's own access point
timeout_s = 15                   # longer timeout for marginal links
```

## 3. Connect to the logger over Wi-Fi

**Logger access point (site visit with a laptop)**
1. Power on the logger. Its status LED blinks blue while the AP is up.
2. Join the network `ENVI-<last 4 of serial>` from the laptop.
3. Check the link: `envi-daq status --logger creek-02`

While you're joined to the logger's AP, the laptop has no internet access.
That's expected.

**Site network (permanent install)**
1. Configure the logger's Wi-Fi client settings with the vendor setup tool.
2. Give it a DHCP reservation so its address never changes.
3. Make sure the host can reach it on TCP port 80 (the host firewall and any client isolation on the AP).

## 4. Try it without hardware

```bash
envi-daq simulate --port 8080 &                           # clean link
envi-daq simulate --port 8080 --drop-rate 0.3 --corrupt-rate 0.1 &   # bad link
```

The example config already points `sim-01` at `http://127.0.0.1:8080`.

## 5. First sync

```bash
envi-daq status           # reachable? how many to download?
envi-daq sync --dry-run   # what would download
envi-daq sync -v          # do it, with per-session progress and log lines
envi-daq sessions         # what's archived and where
```

## 6. Open the dashboard

```bash
envi-daq dashboard --open        # http://127.0.0.1:8800
```

Leave it running on the host computer. It checks each logger's link every 30 s
(`--probe-interval`), and **Sync** buttons start a download from the browser. To
reach it from another machine on the site network, use `--host 0.0.0.0`. It has no
login, so only do this on a network you trust.

## 7. Schedule it

Exit codes let a scheduler or monitoring tool tell what happened:
`0` OK · `1` failures/conflicts · `2` config error · `3` logger unreachable · `4` already running.

**Linux / macOS (cron)**, every 30 minutes:

```cron
*/30 * * * * ENVI_DAQ_CONFIG=$HOME/envi-daq/config.toml $HOME/envi-daq/.venv/bin/envi-daq sync >> $HOME/envi-daq/cron.log 2>&1
```

Overlapping runs are safe: the second exits with code 4.

**Windows (Task Scheduler)**: Program `C:\envi-daq\.venv\Scripts\envi-daq.exe`,
arguments `-c C:\envi-daq\config.toml sync`, trigger every 30 minutes.

## 8. Hand off to data engineering

- Verified files: `data/<logger_id>/<session_id>.csv`. Only verified files
  ever appear under this name, so downstream jobs can pick up `*.csv` and skip
  `*.part` and `*.invalid.csv`.
- History: `transfers.sqlite3`, safe to open read-only during a sync.
- CSV snapshots: `envi-daq export sessions.csv` and
  `envi-daq export transfers.csv --what transfers`
- Machine-readable output: `--json` on `status`, `sync`, `sessions`, `history` and `verify`.
