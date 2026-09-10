"""
Sahasraksha live-feed simulator (v2).

Cycles through a SMALL, fixed set of stations (not all 60 randomly) so each
one accumulates real streaming history in the live detector before any
anomaly is injected -- step/CUSUM detection needs at least one real prior
reading to compare against, so a cold-start spike will never register.

Usage:
    pip install requests
    python live_feed_simulator.py --base-url https://sahasraksha-backend.onrender.com --interval 5
"""
import argparse
import random
import time
from datetime import datetime, timezone

import requests

NOISE = {"T": 0.15, "P": 0.05, "RH": 0.6}
BOUNDS = {"T": (-40.0, 55.0), "P": (850.0, 1080.0), "RH": (0.0, 100.0)}

WARMUP_TICKS = 6  # real prior readings before a station is eligible for an anomaly

_last_values = {}
_ticks_seen = {}
_frozen_ticks_left = {}   # PER-STATION now -- multiple stations can freeze independently


def clamp(value, channel):
    lo, hi = BOUNDS[channel]
    return max(lo, min(hi, value))


def fetch_stations(base_url, focus_count):
    resp = requests.get(f"{base_url}/stations", timeout=15)
    resp.raise_for_status()
    stations = resp.json()
    return random.sample(stations, min(focus_count, len(stations)))


def seed_from_station(station):
    return {
        "T": station.get("latest_temperature") or 25.0,
        "P": station.get("latest_pressure") or 1005.0,
        "RH": station.get("latest_humidity") or 60.0,
    }


def next_reading(station_id, seed, allow_anomaly, force_anomaly=None):
    prev = _last_values.get(station_id, seed)
    _ticks_seen[station_id] = _ticks_seen.get(station_id, 0) + 1
    warmed_up = _ticks_seen[station_id] > WARMUP_TICKS

    # Already frozen? Keep going regardless of any new trigger this tick --
    # this station's own run takes priority over a fresh anomaly request.
    if _frozen_ticks_left.get(station_id, 0) > 0:
        _frozen_ticks_left[station_id] -= 1
        return prev, f"frozen (continuing, {_frozen_ticks_left[station_id]} left)"

    if allow_anomaly and warmed_up and force_anomaly:
        if force_anomaly == "spike":
            channel = random.choice(["T", "P", "RH"])
            vals = dict(prev)
            vals[channel] = clamp(vals[channel] + random.choice([-1, 1]) * random.uniform(9, 14), channel)
            _last_values[station_id] = vals
            return vals, f"spike injected on {channel}"
        if force_anomaly == "frozen_start":
            # Needs 6 CONSECUTIVE identical readings for THIS station to
            # trigger detection -- give real margin above that minimum.
            _frozen_ticks_left[station_id] = 9
            return prev, "frozen run starting"

    vals = {
        ch: clamp(prev[ch] + random.gauss(0, NOISE[ch]), ch)
        for ch in ["T", "P", "RH"]
    }
    _last_values[station_id] = vals
    return vals, "normal"


def push_reading(base_url, station_id, vals):
    payload = {
        "station_id": station_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "T": round(vals["T"], 2),
        "P": round(vals["P"], 2),
        "RH": round(vals["RH"], 2),
        "flag": 0,
    }
    resp = requests.post(f"{base_url}/ingest", json=payload, timeout=15)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description="Sahasraksha live-feed simulator")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--focus-stations", type=int, default=6,
                        help="How many stations to cycle through (small = builds history fast)")
    parser.add_argument("--anomaly-every", type=int, default=10)
    args = parser.parse_args()

    print(f"Fetching real stations from {args.base_url} ...")
    stations = fetch_stations(args.base_url, args.focus_stations)
    ids = [s["station_id"] for s in stations]
    print(f"Focus set ({len(ids)} stations): {', '.join(ids)}")
    print(f"First {WARMUP_TICKS} ticks per station build real history before any anomaly can fire.\n")

    tick = 0
    while True:
        tick += 1
        station = stations[tick % len(stations)]
        sid = station["station_id"]
        seed = seed_from_station(station)

        force = None
        if tick % args.anomaly_every == 0:
            force = random.choice(["spike", "frozen_start"])

        vals, action = next_reading(sid, seed, allow_anomaly=True, force_anomaly=force)

        try:
            verdict = push_reading(args.base_url, sid, vals)
            flagged = verdict.get("flag")
            reason = verdict.get("reason", "")
            marker = "  <== FLAGGED BY DETECTOR" if flagged else ""
            print(f"[{tick:04d}] {sid:>12s}  T={vals['T']:6.2f}  P={vals['P']:7.2f}  "
                  f"RH={vals['RH']:5.1f}  [{action}]  reason={reason}{marker}")
        except requests.RequestException as exc:
            print(f"[{tick:04d}] {sid:>12s}  request failed: {exc}")

        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
