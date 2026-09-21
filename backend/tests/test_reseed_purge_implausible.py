"""Regression test for --purge-implausible's date-scoping guard.

The bug this exists to prevent: an earlier version of _purge_implausible
checked ONLY whether a reading's value fell outside a station's 48-hour
reseed-window range (+/- PURGE_MARGIN), with no regard for when the
reading was recorded. Run against a real production database, this
flagged ~14,748 readings and 1,364 alerts for deletion -- an order of
magnitude more than keepalive drift could plausibly account for, because
it was also catching genuine seasonal extremes from the real 2020-2024
bulk-imported archive (a real winter cold snap or summer peak varies far
more from a single 48-hour September snapshot than PURGE_MARGIN allows,
despite being 100% legitimate data). The fix scopes the purge to
recorded_at >= PURGE_NOT_BEFORE (2025-01-01) -- confirmed by scanning
every row of the real archive file that it contains ONLY 2020-2024 dates,
so nothing at or after the cutoff can be genuine historical data.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import AnomalyVerdict, Station, WeatherReading
from app.tools.reseed_september_baseline import PURGE_NOT_BEFORE, _purge_implausible


class PurgeImplausibleDateScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.station_id = "PURGE-TEST-STATION"
        with SessionLocal() as db:
            existing = db.get(Station, self.station_id)
            if existing is None:
                db.add(
                    Station(
                        station_id=self.station_id,
                        name="Purge Test Station",
                        lat=30.3,
                        lon=78.0,
                        health="good",
                        status="OK",
                        health_score=0.9,
                        degradation=0.0,
                        trend_per_day=0.0,
                        days_to_threshold=None,
                        high_conf_alerts=0,
                        alert_rate_pct=0.0,
                        rate_vs_network=1.0,
                        last_seen=datetime.now(timezone.utc),
                        data_quality="good",
                    )
                )
                db.commit()

    def tearDown(self) -> None:
        with SessionLocal() as db:
            db.query(WeatherReading).filter(
                WeatherReading.station_id == self.station_id
            ).delete(synchronize_session=False)
            db.commit()

    def _windows(self):
        # A narrow 48h-style reseed window, like the real one: 24-34C.
        return {
            self.station_id: [
                {"timestamp": "2024-09-01 00:00:00", "T": 24.0 + (h % 10), "P": 950.0, "RH": 70.0}
                for h in range(48)
            ]
        }

    def test_real_historical_extremes_are_never_purged(self) -> None:
        """A real winter cold snap and summer peak, both dated well before
        the cutoff, must survive even though they're far outside the
        48-hour reseed window's own range."""
        with SessionLocal() as db:
            # Genuine archive-era readings (2020-2024) with real extremes.
            db.add(
                WeatherReading(
                    station_id=self.station_id,
                    recorded_at=datetime(2021, 1, 15, tzinfo=timezone.utc),
                    temperature_c=5.0,  # real winter cold snap
                    pressure_hpa=950.0,
                    humidity_pct=70.0,
                    flag=0,
                    amp_ratio_p=1.0,
                )
            )
            db.add(
                WeatherReading(
                    station_id=self.station_id,
                    recorded_at=datetime(2023, 6, 10, tzinfo=timezone.utc),
                    temperature_c=42.0,  # real summer peak
                    pressure_hpa=950.0,
                    humidity_pct=70.0,
                    flag=0,
                    amp_ratio_p=1.0,
                )
            )
            db.commit()

            readings_before = db.query(WeatherReading).filter(
                WeatherReading.station_id == self.station_id
            ).count()

            deleted, _, _, _ = _purge_implausible(db, self._windows(), dry_run=True)
            db.rollback()

            self.assertEqual(
                deleted, 0,
                "real pre-2025 historical extremes were flagged for deletion",
            )
            readings_after = db.query(WeatherReading).filter(
                WeatherReading.station_id == self.station_id
            ).count()
            self.assertEqual(readings_before, readings_after)

    def test_post_cutoff_drift_garbage_is_purged(self) -> None:
        """A reading dated in the live era, far outside the station's real
        range, is exactly what this tool exists to remove."""
        with SessionLocal() as db:
            reading = WeatherReading(
                station_id=self.station_id,
                recorded_at=PURGE_NOT_BEFORE + timedelta(days=200),
                temperature_c=0.3,  # drifted value, live era
                pressure_hpa=950.0,
                humidity_pct=70.0,
                flag=0,
                amp_ratio_p=1.0,
            )
            db.add(reading)
            db.commit()
            reading_id = reading.id

            deleted, _, _, _ = _purge_implausible(db, self._windows(), dry_run=False)
            db.commit()

            self.assertEqual(deleted, 1)
            self.assertIsNone(db.get(WeatherReading, reading_id))

    def test_boundary_reading_exactly_at_cutoff_is_in_scope(self) -> None:
        """recorded_at == PURGE_NOT_BEFORE must be treated as live-era
        (>=), matching the query's own boundary condition."""
        with SessionLocal() as db:
            reading = WeatherReading(
                station_id=self.station_id,
                recorded_at=PURGE_NOT_BEFORE,
                temperature_c=0.3,
                pressure_hpa=950.0,
                humidity_pct=70.0,
                flag=0,
                amp_ratio_p=1.0,
            )
            db.add(reading)
            db.commit()

            deleted, _, _, _ = _purge_implausible(db, self._windows(), dry_run=True)
            db.rollback()

            self.assertEqual(deleted, 1)


if __name__ == "__main__":
    unittest.main()
