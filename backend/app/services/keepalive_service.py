"""
Built-in live-feed keepalive.

Render's free tier spins a service down after 15 minutes with no INBOUND
HTTP traffic reaching it -- internal background activity alone does not
count, confirmed against Render's own documented behaviour. The standard
fix is a self-ping: the service periodically calls its own public URL,
which round-trips out through Render's router and back in as genuine
inbound traffic.

This reuses that same requirement to solve two problems with one
mechanism: it keeps the service awake, AND it keeps real, fresh data
flowing through the real /ingest endpoint automatically, so the live
dashboard never sits static on historical data waiting for someone to
manually run a script.

Same warmup + anomaly logic already verified in live_feed_simulator.py,
condensed to run as a background thread inside the deployed backend
itself rather than a separate local script.
"""
import json
import os
import random
import threading
import time
from datetime import datetime, timezone
from urllib import request as urllib_request
from urllib.error import URLError

SELF_URL = os.getenv("SELF_PING_URL", "").rstrip("/")
ENABLED = os.getenv("ENABLE_LIVE_KEEPALIVE", "true").lower() == "true"
TICK_SECONDS = int(os.getenv("LIVE_KEEPALIVE_INTERVAL", "300"))  # 5 min, safe under Render's 15-min sleep
FOCUS_COUNT = int(os.getenv("LIVE_KEEPALIVE_STATIONS", "4"))
WARMUP_TICKS = 6
ANOMALY_EVERY = int(os.getenv("LIVE_KEEPALIVE_ANOMALY_EVERY", "12"))

NOISE = {"T": 0.15, "P": 0.05, "RH": 0.6}
BOUNDS = {"T": (-40.0, 55.0), "P": (850.0, 1080.0), "RH": (0.0, 100.0)}


def _http_json(method, path, payload=None, timeout=15):
    url = f"{SELF_URL}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib_request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib_request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _clamp(value, channel):
    lo, hi = BOUNDS[channel]
    return max(lo, min(hi, value))


def _keepalive_loop():
    # Brief grace period before the first self-ping: Render's own external
    # routing can take a few seconds to finish registering the service as
    # ready right after a deploy, and pinging too early causes a harmless
    # but avoidable 502 on the very first tick.
    time.sleep(15)

    last_values, ticks_seen, frozen_left = {}, {}, {}
    stations, focus, tick = [], [], 0

    while True:
        try:
            if not stations:
                stations = _http_json("GET", "/stations")
                if not stations:
                    time.sleep(TICK_SECONDS)
                    continue
                focus = random.sample(stations, min(FOCUS_COUNT, len(stations)))
                print(f"[keepalive] live feed focus set: "
                      f"{[s['station_id'] for s in focus]}")

            tick += 1
            station = focus[tick % len(focus)]
            sid = station["station_id"]
            seed = {
                "T": station.get("latest_temperature") or 25.0,
                "P": station.get("latest_pressure") or 1005.0,
                "RH": station.get("latest_humidity") or 60.0,
            }
            prev = last_values.get(sid, seed)
            ticks_seen[sid] = ticks_seen.get(sid, 0) + 1
            warmed = ticks_seen[sid] > WARMUP_TICKS

            if frozen_left.get(sid, 0) > 0:
                frozen_left[sid] -= 1
                vals = prev
            elif warmed and tick % ANOMALY_EVERY == 0:
                if random.random() < 0.5:
                    ch = random.choice(["T", "P", "RH"])
                    vals = dict(prev)
                    vals[ch] = _clamp(vals[ch] + random.choice([-1, 1]) * random.uniform(9, 14), ch)
                else:
                    frozen_left[sid] = 9
                    vals = prev
            else:
                vals = {c: _clamp(prev[c] + random.gauss(0, NOISE[c]), c) for c in ["T", "P", "RH"]}

            last_values[sid] = vals
            _http_json("POST", "/ingest", {
                "station_id": sid,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "T": round(vals["T"], 2), "P": round(vals["P"], 2), "RH": round(vals["RH"], 2),
                "flag": 0,
            })
        except URLError as exc:
            print(f"[keepalive] tick failed (network): {exc}")
        except Exception as exc:  # keep the loop alive no matter what
            print(f"[keepalive] tick failed: {exc}")

        time.sleep(TICK_SECONDS)


def start_keepalive():
    if not ENABLED:
        print("[keepalive] disabled via ENABLE_LIVE_KEEPALIVE=false")
        return
    if not SELF_URL:
        print("[keepalive] SELF_PING_URL not set -- skipping "
              "(set it to this service's own public URL to enable)")
        return
    thread = threading.Thread(target=_keepalive_loop, daemon=True)
    thread.start()
    print(f"[keepalive] started, pinging {SELF_URL} every {TICK_SECONDS}s")
