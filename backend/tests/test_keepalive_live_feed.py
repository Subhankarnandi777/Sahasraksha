"""Regression tests for the live-feed keepalive's value generation.

The bug these exist to prevent: the keepalive used to carry a running
value forward tick to tick, and its demo anomaly injection permanently
displaced that running value by up to 14 units with nothing ever bringing
it back. Over hours a station staggered an unbounded +/-9-14 per anomaly
event until it pinned against the outer clamp and sat there. Observed
live on 2026-09-20: station 42111099999 (Dehradun) held ~0.0C for over 24
continuous hours in September, and because it sat *stably* at that wrong
value the change-based detector reported it as healthy the whole time.
"""
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import keepalive_service
from app.services.keepalive_service import CHANNELS, LiveFeedState


class KeepaliveLiveFeedTests(unittest.TestCase):
    def _window(self):
        # A real-shaped diurnal day: 24 hourly points, temperature
        # swinging 24-34C, pressure and humidity in plausible bands.
        return [
            {
                "timestamp": f"2024-09-01 {hour:02d}:00:00",
                "T": 24.0 + 10.0 * (hour % 12) / 12.0,
                "P": 950.0 + (hour % 6) * 0.5,
                "RH": 70.0 + (hour % 10),
            }
            for hour in range(24)
        ]

    def test_values_never_drift_away_from_real_observations(self) -> None:
        """The core invariant: no matter how many anomalies fire, the feed
        always comes back to the real archived values."""
        window = self._window()
        state = LiveFeedState()
        real_temps = [point["T"] for point in window]
        real_low, real_high = min(real_temps), max(real_temps)

        clean_temps = []
        for tick in range(1, 4001):
            # State must be sampled BOTH before and after the call: on the
            # final tick of an anomaly the counter has already decremented
            # to 0 while the returned value still carries the offset, so
            # checking only afterwards would count it as a clean tick.
            before_anomaly = state.anomaly_left.get("TEST-STATION", 0)
            before_frozen = state.frozen_left.get("TEST-STATION", 0)
            vals = state.next_values("TEST-STATION", window, tick)
            after_anomaly = state.anomaly_left.get("TEST-STATION", 0)
            after_frozen = state.frozen_left.get("TEST-STATION", 0)

            for channel in CHANNELS:
                lo, hi = keepalive_service.BOUNDS[channel]
                self.assertGreaterEqual(vals[channel], lo)
                self.assertLessEqual(vals[channel], hi)

            # Sample only ticks where no anomaly/freeze was in effect at
            # any point -- those are the ticks that must track reality.
            if not any((before_anomaly, before_frozen, after_anomaly, after_frozen)):
                clean_temps.append(vals["T"])

        self.assertGreater(len(clean_temps), 100, "expected plenty of non-anomalous ticks")

        # Every clean tick is the real value plus small noise (sigma 0.15),
        # so a generous 2C band around the real range catches any drift
        # while tolerating noise. Under the old carried-forward walk this
        # failed badly -- values ended up pinned near the -40C clamp.
        self.assertGreaterEqual(
            min(clean_temps),
            real_low - 2.0,
            "feed drifted below the real observed range -- value is being carried forward again",
        )
        self.assertLessEqual(
            max(clean_temps),
            real_high + 2.0,
            "feed drifted above the real observed range -- value is being carried forward again",
        )

    def test_injected_anomaly_is_transient_not_permanent(self) -> None:
        """An injected step must release after ANOMALY_TICKS and leave no
        residue in the values that follow it."""
        window = self._window()
        state = LiveFeedState()
        station = "TEST-STATION"

        # Warm up past WARMUP_TICKS so anomalies are allowed to fire.
        for tick in range(1, keepalive_service.WARMUP_TICKS + 2):
            state.next_values(station, window, tick)

        # Force an anomaly deterministically rather than waiting on chance.
        state.anomaly_offset[station] = {"T": 12.0}
        state.anomaly_left[station] = keepalive_service.ANOMALY_TICKS

        during = []
        for _ in range(keepalive_service.ANOMALY_TICKS):
            # Tick numbers chosen to avoid coinciding with ANOMALY_EVERY,
            # so nothing new is injected mid-test.
            during.append(state.next_values(station, window, 7)["T"])

        self.assertEqual(state.anomaly_left[station], 0, "anomaly should have expired")
        self.assertNotIn(station, state.anomaly_offset, "offset should be cleared on release")

        real_now = keepalive_service._real_value_for_now(window)["T"]
        for value in during:
            self.assertGreater(
                value,
                real_now + 6.0,
                "the anomaly should be clearly visible while it is in effect",
            )

        after = [state.next_values(station, window, 7)["T"] for _ in range(20)]
        for value in after:
            self.assertLess(
                abs(value - real_now),
                2.0,
                "station did not recover to its real value after the anomaly released",
            )

    def test_station_without_real_data_is_skipped_not_invented(self) -> None:
        """Stations with no real archived window must not be fed made-up
        numbers -- the loop skips them entirely."""
        windows = keepalive_service._load_real_windows()
        if not windows:
            self.skipTest("real observation windows file not available")

        # 42875099999 has no clean readings anywhere in the 5-year archive
        # and is deliberately excluded from the windows file.
        self.assertNotIn("42875099999", windows)


if __name__ == "__main__":
    unittest.main()
