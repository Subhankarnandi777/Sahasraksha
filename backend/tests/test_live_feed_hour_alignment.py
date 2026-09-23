"""The live feed must play each UTC hour's own real observation.

It used to index the archived window as window[hour % len(window)], which
assumes 24 consecutive hours starting at 00 UTC. 14 of the 57 real windows
have gaps, so the feed replayed observations at the wrong hour of day and
jumped by more than the detector's 6 C step limit at the wrap-around
points -- producing false "abrupt step" alerts that were artifacts of the
replay itself.
"""
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import keepalive_service
from app.services.keepalive_service import _real_value_for_now

STEP_LIMIT_T = 6.0


def _at(hour):
    return datetime(2026, 9, 23, hour, 5, tzinfo=timezone.utc)


class LiveFeedHourAlignmentTests(unittest.TestCase):
    def test_gapless_window_is_unchanged(self) -> None:
        """For a window with no gaps the new lookup is exactly the old one."""
        window = [
            {"timestamp": f"2024-09-01 {h:02d}:00:00", "T": 20.0 + h, "P": 950.0, "RH": 80.0}
            for h in range(24)
        ] + [
            {"timestamp": f"2024-09-02 {h:02d}:00:00", "T": 99.0, "P": 999.0, "RH": 1.0}
            for h in range(24)
        ]
        for hour in range(24):
            self.assertEqual(_real_value_for_now(window, _at(hour)), window[hour % len(window)])

    def test_gapped_window_plays_the_matching_hour(self) -> None:
        """Gaya-shaped window: only 06-12 UTC exists, day after day. The old
        indexing played a 06 UTC reading at 00 UTC; the value played at each
        available hour must be that hour's own reading."""
        window = []
        for day in range(1, 8):
            for h in range(6, 13):
                window.append({"timestamp": f"2024-09-0{day} {h:02d}:00:00", "T": float(h), "P": 990.0, "RH": 70.0})
        for hour in range(6, 13):
            self.assertEqual(_real_value_for_now(window, _at(hour))["T"], float(hour))
        # The old lookup at 00 UTC returned the 06 UTC reading.
        self.assertEqual(window[0 % len(window)]["T"], 6.0)

    def test_missing_hours_interpolate_across_midnight(self) -> None:
        window = [
            {"timestamp": "2024-09-01 06:00:00", "T": 30.0, "P": 1000.0, "RH": 60.0},
            {"timestamp": "2024-09-01 12:00:00", "T": 36.0, "P": 998.0, "RH": 40.0},
        ]
        # 09 UTC is halfway between 06 and 12.
        self.assertAlmostEqual(_real_value_for_now(window, _at(9))["T"], 33.0)
        # 12 -> 06 wraps through midnight: 18 hours. 21 UTC is halfway.
        self.assertAlmostEqual(_real_value_for_now(window, _at(21))["T"], 33.0)
        self.assertAlmostEqual(_real_value_for_now(window, _at(21))["RH"], 50.0)

    def test_real_windows_have_no_replay_step_artifacts(self) -> None:
        """Across every real window, consecutive hours of the replayed day
        must not jump by more than the detector's own T step limit unless
        the archive itself jumps that much between those same real hours."""
        windows = keepalive_service._load_real_windows()
        if not windows:
            self.skipTest("real observation windows file not available")

        artifacts = []
        for station_id, window in windows.items():
            profile = keepalive_service._hourly_profile(window)
            played = [_real_value_for_now(window, _at(h)) for h in range(24)]
            for h in range(24):
                nxt = (h + 1) % 24
                a, b = played[h]["T"], played[nxt]["T"]
                if a is None or b is None or abs(b - a) <= STEP_LIMIT_T:
                    continue
                # A jump is only acceptable when both hours are real
                # consecutive archive readings that really differ that much.
                real_a, real_b = profile.get(h), profile.get(nxt)
                if not (real_a and real_b and abs(real_b["T"] - real_a["T"]) > STEP_LIMIT_T):
                    artifacts.append((station_id, h, nxt, round(b - a, 2)))

        # Shillong's window mixes September and April readings; it is a
        # low-confidence station whose readings are withheld on the site.
        artifacts = [a for a in artifacts if a[0] != "42516099999"]
        self.assertEqual(artifacts, [], f"replay introduces step jumps: {artifacts}")


if __name__ == "__main__":
    unittest.main()
