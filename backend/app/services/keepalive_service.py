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
dashboard never sits static waiting for someone to manually run a script.

Where the values come from
--------------------------
Each tick's value for a station is read from that station's REAL archived
hourly observations (app/tools/data/september_baseline_windows.json,
genuine NOAA-ISD/IMD data -- the same file the reseed tool uses), indexed
by the current hour of day so the diurnal cycle lines up with the actual
clock. A small amount of noise is layered on so consecutive ticks within
the same hour aren't byte-identical (an exact flatline would itself trip
the frozen-sensor detector).

This replaced an unanchored random walk, which was the root cause of the
network drifting into physically impossible readings. The old loop
carried a running value forward tick to tick, and its demo anomaly
injection PERMANENTLY displaced that running value:

    vals[ch] = _clamp(vals[ch] + random.choice([-1, 1]) * random.uniform(9, 14), ch)

Nothing ever brought it back. Each injection shifted the baseline by up to
14 units and the next tick's walk simply continued from the displaced
figure, so over hours a station staggered an unbounded ±9-14 per event
until it hit the outer BOUNDS clamp and sat there. Observed live on
2026-09-20: station 42111099999 (Dehradun) held ~0.0C for over 24
continuous hours in September. Worse, because it then sat *stably* at the
wrong value, the change-based detector saw nothing changing and kept
reporting the station as OK -- an impossible reading that looked healthy.

Driving each tick from real archived data instead means a station's value
is recomputed from scratch every tick rather than accumulated, so it
cannot drift, and an injected anomaly can no longer poison everything
that follows it.

Demo anomalies still happen -- that's the point of this mechanism, it
gives the detector something genuine to catch -- but they are now
TRANSIENT: an offset is applied for a few ticks and then released, so the
station spikes, gets flagged, and recovers. That is both a better
demonstration (detection AND recovery) and a bounded one.

Same warmup + anomaly logic already verified in live_feed_simulator.py,
condensed to run as a background thread inside the deployed backend
itself rather than a separate local script.

Fault frequency and fleet-wide synchronisation
-----------------------------------------------
Every station in the focus set is ticked from the SAME shared `tick`
counter (the loop below increments it once per pass over the whole
focus set, not once per station). ANOMALY_EVERY/ANOMALY_TICKS/
FROZEN_TICKS were originally tuned when FOCUS_COUNT defaulted to 4
stations; at FOCUS_COUNT=60 (the real Render value, LIVE_KEEPALIVE_
STATIONS=60) two problems compounded:

1. The old trigger, `tick % ANOMALY_EVERY == 0`, always started SOME
   fault when it fired -- the `random.random() < 0.5` only chose
   between a step anomaly and a frozen sensor, it never skipped the
   tick entirely. So every warmed, eligible station entered a fault
   at the exact same tick -- the whole fleet flipped to "faulty"
   simultaneously, then partially recovered over the following ~10
   ticks, then sat quiet until the next shared trigger tick. Observed
   live on 2026-09-22: dashboard readings like "28 Healthy / 30
   Monitoring / 2 Service" and "25 Healthy / 33 Monitoring / 2
   Service" -- roughly half the 60-station fleet reading as faulty at
   once, which contradicts the dashboard's own "Stability: Nominal"
   framing.
2. ANOMALY_EVERY=12 with an average fault duration of ~7 ticks
   (0.5*(ANOMALY_TICKS+1) + 0.5*(FROZEN_TICKS+1) = 0.5*4 + 0.5*10 = 7)
   meant each individual station was faulty ~58% of the time it was
   eligible (7/12) -- a majority, not an occasional demo blip.

Both are fixed together: each station is given a stable per-station
phase offset (deterministic hash of its station_id, so it survives
across ticks without needing extra persisted state), and the trigger
becomes `(tick - phase) % ANOMALY_EVERY == 0`. That staggers which
tick each station rolls its fault on, so the fleet no longer flips in
lockstep. ANOMALY_EVERY is also raised so a single station's own
long-run fault fraction (average_duration / ANOMALY_EVERY) drops from
~58% to roughly 12% -- comfortably a small minority of a 60-station
fleet at any instant, tested in tests/test_keepalive_live_feed.py.
"""
import json
import os
import random
import threading
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path
from urllib import request as urllib_request
from urllib.error import URLError

SELF_URL = os.getenv("SELF_PING_URL", "").rstrip("/")
ENABLED = os.getenv("ENABLE_LIVE_KEEPALIVE", "true").lower() == "true"
TICK_SECONDS = int(os.getenv("LIVE_KEEPALIVE_INTERVAL", "300"))  # 5 min, safe under Render's 15-min sleep
FOCUS_COUNT = int(os.getenv("LIVE_KEEPALIVE_STATIONS", "4"))
WARMUP_TICKS = 6
# Was 12 -- tuned for a 4-station demo, where a mean fault fraction of
# ~58% per eligible station was still just one or two stations. At
# FOCUS_COUNT=60 that same fraction meant roughly half the fleet
# reading as faulty at once. 60 brings each station's own long-run
# fault fraction down to ~12% (see module docstring), and combined
# with the per-station phase offset below, keeps simultaneous faults
# to a small, staggered minority of the fleet instead of a fleet-wide
# synchronised burst.
ANOMALY_EVERY = int(os.getenv("LIVE_KEEPALIVE_ANOMALY_EVERY", "60"))

# How many ticks an injected step anomaly stays applied before the station
# recovers to its real value. Long enough for the detector to see it and
# raise an alert, short enough that the station doesn't sit misreporting.
ANOMALY_TICKS = int(os.getenv("LIVE_KEEPALIVE_ANOMALY_TICKS", "3"))
FROZEN_TICKS = 9

NOISE = {"T": 0.15, "P": 0.05, "RH": 0.6}
BOUNDS = {"T": (-40.0, 55.0), "P": (850.0, 1080.0), "RH": (0.0, 100.0)}
CHANNELS = ("T", "P", "RH")

REAL_WINDOWS_PATH = (
    Path(__file__).resolve().parents[1] / "tools" / "data" / "september_baseline_windows.json"
)


def _load_real_windows():
    """Real archived hourly observations, keyed by station_id.

    Returns {} if the file is missing rather than raising -- the keepalive
    is a demo/uptime convenience and must never take the service down.
    """
    try:
        with open(REAL_WINDOWS_PATH, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:
        print(f"[keepalive] could not load real observation windows: {exc}")
        return {}


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


def _real_value_for_now(window):
    """Pick the real observation matching the current hour of day.

    Indexing by hour (rather than walking a cursor forward) keeps the
    diurnal shape aligned with the actual clock and, more importantly,
    makes each tick's value a pure function of real data and the current
    time -- there is no carried-forward state that could accumulate drift.
    """
    hour = datetime.now(timezone.utc).hour
    return window[hour % len(window)]


class LiveFeedState:
    """Per-station demo-feed state.

    Extracted from the loop so the no-drift invariant is directly
    testable: next_values() is the whole of the per-tick value decision,
    and a test can call it for thousands of ticks and assert the output
    never wanders away from the real observations (see
    tests/test_keepalive_live_feed.py).
    """

    def __init__(self):
        self.ticks_seen = {}
        self.frozen_left = {}
        self.anomaly_left = {}
        self.anomaly_offset = {}
        self.last_sent = {}
        self.phase = {}

    def _phase_for(self, station_id):
        """A stable per-station offset in [0, ANOMALY_EVERY), so each
        station's fault-trigger tick is staggered rather than shared.

        Derived from a deterministic hash (crc32, not the builtin hash()
        -- which is salted per-process by PYTHONHASHSEED) so it is the
        same every time for a given station_id, including across test
        runs and process restarts.
        """
        return self.phase.setdefault(
            station_id, zlib.crc32(station_id.encode()) % ANOMALY_EVERY
        )

    def next_values(self, station_id, window, tick):
        self.ticks_seen[station_id] = self.ticks_seen.get(station_id, 0) + 1
        warmed = self.ticks_seen[station_id] > WARMUP_TICKS

        # Always recomputed from real data + current time. No value is
        # ever carried forward, so nothing accumulates.
        real = _real_value_for_now(window)
        vals = {
            channel: _clamp(real[channel] + random.gauss(0, NOISE[channel]), channel)
            for channel in CHANNELS
        }

        if self.frozen_left.get(station_id, 0) > 0:
            # Flatline demo: republish the exact previous value so the
            # frozen-sensor detector has something to catch. Bounded by
            # FROZEN_TICKS, then recovers.
            self.frozen_left[station_id] -= 1
            vals = self.last_sent.get(station_id, vals)
        elif self.anomaly_left.get(station_id, 0) > 0:
            # Step anomaly still in effect -- applied as an offset ON TOP
            # of the real value, never folded into it, so releasing it
            # restores the real value exactly.
            self.anomaly_left[station_id] -= 1
            offset = self.anomaly_offset.get(station_id, {})
            vals = {
                channel: _clamp(vals[channel] + offset.get(channel, 0.0), channel)
                for channel in CHANNELS
            }
            if self.anomaly_left[station_id] == 0:
                self.anomaly_offset.pop(station_id, None)
                print(f"[keepalive] station {station_id} anomaly released, back to real values")
        elif warmed and (tick - self._phase_for(station_id)) % ANOMALY_EVERY == 0:
            if random.random() < 0.5:
                channel = random.choice(list(CHANNELS))
                magnitude = random.choice([-1, 1]) * random.uniform(9, 14)
                self.anomaly_offset[station_id] = {channel: magnitude}
                self.anomaly_left[station_id] = ANOMALY_TICKS
                vals[channel] = _clamp(vals[channel] + magnitude, channel)
                print(f"[keepalive] station {station_id} step anomaly injected on "
                      f"{channel} ({magnitude:+.1f}) for {ANOMALY_TICKS} ticks")
            else:
                self.frozen_left[station_id] = FROZEN_TICKS
                vals = self.last_sent.get(station_id, vals)

        self.last_sent[station_id] = vals
        return vals


def _keepalive_loop():
    # Brief grace period before the first self-ping: Render's own external
    # routing can take a few seconds to finish registering the service as
    # ready right after a deploy, and pinging too early causes a harmless
    # but avoidable 502 on the very first tick.
    time.sleep(15)

    real_windows = _load_real_windows()

    state = LiveFeedState()
    stations, focus, tick = [], [], 0

    while True:
        try:
            if not stations:
                stations = _http_json("GET", "/stations")
                if not stations:
                    time.sleep(TICK_SECONDS)
                    continue
                # Only stations we hold real observations for are eligible.
                # A station with no real archived data (e.g. 42875099999,
                # which has none anywhere in the 5-year archive) is left
                # alone rather than fed invented numbers.
                eligible = [s for s in stations if s.get("station_id") in real_windows]
                if not eligible:
                    print("[keepalive] no stations have real observation windows -- "
                          "self-ping only, no data will be published")
                focus = random.sample(eligible, min(FOCUS_COUNT, len(eligible)))
                print(f"[keepalive] live feed focus set: "
                      f"{[s['station_id'] for s in focus]}")

            tick += 1
            if not focus:
                # Still self-ping so Render doesn't sleep the service.
                try:
                    _http_json("GET", "/health")
                except Exception as exc:
                    print(f"[keepalive] self-ping failed: {exc}")
                time.sleep(TICK_SECONDS)
                continue

            # Update every focus station within this same tick, not just one
            # per tick. The old one-station-per-tick rotation meant a wider
            # focus set made EACH station's own refresh cadence slower --
            # LIVE_KEEPALIVE_STATIONS=60 would have meant once every 60
            # ticks (5 hours) per station instead of once every 4 ticks (20
            # min). Looping over the whole focus set here means the
            # refresh cadence per station stays "every tick" (TICK_SECONDS)
            # regardless of how many stations are in the focus set.
            for station in focus:
                sid = station["station_id"]
                try:
                    window = real_windows.get(sid)
                    if not window:
                        continue

                    vals = state.next_values(sid, window, tick)
                    _http_json("POST", "/ingest", {
                        "station_id": sid,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "T": round(vals["T"], 2), "P": round(vals["P"], 2), "RH": round(vals["RH"], 2),
                        "flag": 0,
                    })
                except URLError as exc:
                    print(f"[keepalive] station {sid} failed (network): {exc}")
                except Exception as exc:  # one station's failure shouldn't skip the rest
                    print(f"[keepalive] station {sid} failed: {exc}")
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
