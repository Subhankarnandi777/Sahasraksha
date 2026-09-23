"""The chatbot must count stations the way the site displays them."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers.chat import _effective_status, _severity_tier
from app.schemas.station import StationStatus


def _station(status="OK", quality="good", hours_ago=0.0):
    now = datetime(2026, 9, 23, 3, 0, tzinfo=timezone.utc)
    return SimpleNamespace(
        status=StationStatus(status),
        data_quality=quality,
        last_seen=now - timedelta(hours=hours_ago),
    ), now


class ChatSnapshotStatusTests(unittest.TestCase):
    def test_low_confidence_counts_as_monitor(self) -> None:
        station, now = _station("OK", "low_confidence")
        self.assertEqual(_effective_status(station, now), "MONITOR")

    def test_silent_ok_station_counts_as_monitor(self) -> None:
        station, now = _station("OK", hours_ago=36)
        self.assertEqual(_effective_status(station, now), "MONITOR")

    def test_recent_ok_station_stays_ok(self) -> None:
        station, now = _station("OK", hours_ago=0.2)
        self.assertEqual(_effective_status(station, now), "OK")

    def test_service_now_is_untouched(self) -> None:
        station, now = _station("SERVICE NOW", hours_ago=36)
        self.assertEqual(_effective_status(station, now), "SERVICE NOW")

    def test_tier_names_match_alerts_page(self) -> None:
        self.assertEqual(_severity_tier(0.9), "critical")
        self.assertEqual(_severity_tier(0.6), "elevated")
        self.assertEqual(_severity_tier(0.2), "low")


if __name__ == "__main__":
    unittest.main()
