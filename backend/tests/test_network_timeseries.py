"""Regression tests for the network-wide ambient series.

The bug these exist to prevent: the dashboard's "Ambient Network
Temperature Oscillation" chart plotted ONE station's raw trace under a
network-wide title. Because the live feed deliberately injects transient
+/-9-14 unit demo anomalies (so the detector has something genuine to
catch), whenever the chart's reference station happened to be mid-
injection the headline chart read a physically impossible figure --
observed live on 2026-09-21 as "Min: 10.0" across an Indian September,
from a real ~24C value with a -14 injection applied on top.

Aggregating with a MEDIAN across stations is what makes that
structurally impossible to recur: one station mid-injection cannot move
a 60-station median meaningfully, while a real network-wide shift still
moves it.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import Station, WeatherReading
from app.services.reading_service import list_network_timeseries

# This series aggregates across EVERY station in the database, so these
# fixtures must sit in a window no other test file touches -- otherwise
# another test's stations land in the same hourly bucket and move the
# median. 2019 is unused everywhere else in this suite, and every query
# below is bounded at both ends so only these fixtures can be in range.
BASE = datetime(2019, 3, 7, 4, 0, tzinfo=timezone.utc)


class NetworkTimeseriesTests(unittest.TestCase):
    station_ids = [f"NET-TEST-{index:02d}" for index in range(12)]

    def setUp(self) -> None:
        init_db()
        self._cleanup()
        with SessionLocal() as db:
            for station_id in self.station_ids + ["NET-TEST-LOWCONF"]:
                db.add(
                    Station(
                        station_id=station_id,
                        name=station_id,
                        lat=20.0,
                        lon=78.0,
                        health="good",
                        status="OK",
                        health_score=1.0,
                        degradation=0.0,
                        trend_per_day=0.0,
                        days_to_threshold=None,
                        high_conf_alerts=0,
                        alert_rate_pct=0.0,
                        rate_vs_network=1.0,
                        last_seen=BASE,
                        data_quality=(
                            "low_confidence" if station_id == "NET-TEST-LOWCONF" else "good"
                        ),
                    )
                )
            db.commit()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        everyone = self.station_ids + ["NET-TEST-LOWCONF"]
        with SessionLocal() as db:
            db.query(WeatherReading).filter(
                WeatherReading.station_id.in_(everyone)
            ).delete(synchronize_session=False)
            db.query(Station).filter(Station.station_id.in_(everyone)).delete(
                synchronize_session=False
            )
            db.commit()

    def _window(self, hours: int = 1):
        """A from/to pair tight around these fixtures only."""
        return BASE - timedelta(minutes=30), BASE + timedelta(hours=hours)

    def _add(self, db, station_id, moment, temperature) -> None:
        db.add(
            WeatherReading(
                station_id=station_id,
                recorded_at=moment,
                temperature_c=temperature,
                pressure_hpa=950.0,
                humidity_pct=70.0,
                flag=0,
                amp_ratio_p=1.0,
            )
        )

    def test_injected_anomalies_cannot_drag_the_network_figure(self) -> None:
        """The core invariant, and the one that must fail against a mean.

        Nine stations read a normal 28C; three are mid-injection at 10C
        (the feed injects across the whole fleet, so several stations
        being mid-anomaly at once is the normal case, not a corner one).
        The network figure has to stay pinned to what the healthy
        majority is actually reading -- a mean lands near 23.5C here,
        which is both wrong and implausible for an Indian September.
        """
        healthy = self.station_ids[:-3]
        injected = self.station_ids[-3:]

        with SessionLocal() as db:
            for station_id in healthy:
                self._add(db, station_id, BASE, 28.0)
            for station_id in injected:
                self._add(db, station_id, BASE, 10.0)
            db.commit()

        rows = list_network_timeseries(*self._window())
        self.assertEqual(len(rows), 1)

        self.assertAlmostEqual(
            rows[0].T,
            28.0,
            delta=0.5,
            msg=(
                "the network-wide figure moved off what the healthy majority "
                "reads -- injected demo anomalies are being averaged in "
                "instead of medianed out"
            ),
        )

    def test_genuine_network_wide_shift_still_moves_the_figure(self) -> None:
        """The median must not be so inert that it hides a real signal --
        if the whole network is cold, the chart has to say so."""
        with SessionLocal() as db:
            for station_id in self.station_ids:
                self._add(db, station_id, BASE, 12.0)
            db.commit()

        rows = list_network_timeseries(*self._window())
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0].T, 12.0, places=1)

    def test_low_confidence_stations_are_excluded(self) -> None:
        """A station whose source record was flagged unreliable at import
        must not be allowed to move a network-wide number, matching how
        the rest of the UI already refuses to display its readings."""
        with SessionLocal() as db:
            for station_id in self.station_ids:
                self._add(db, station_id, BASE, 28.0)
            # Wildly out of band, and numerous enough to shift a median
            # if it were counted at all.
            for offset in range(20):
                self._add(
                    db,
                    "NET-TEST-LOWCONF",
                    BASE + timedelta(seconds=offset),
                    -30.0,
                )
            db.commit()

        rows = list_network_timeseries(*self._window())
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0].T, 28.0, places=1)

    def test_readings_are_bucketed_by_hour(self) -> None:
        """Separate hours stay separate points, so the chart shows a
        trend rather than collapsing to a single value."""
        with SessionLocal() as db:
            for station_id in self.station_ids:
                self._add(db, station_id, BASE, 24.0)
                self._add(db, station_id, BASE + timedelta(hours=1), 30.0)
            db.commit()

        rows = list_network_timeseries(*self._window(hours=2))
        self.assertEqual(len(rows), 2)
        self.assertAlmostEqual(rows[0].T, 24.0, places=1)
        self.assertAlmostEqual(rows[1].T, 30.0, places=1)
        self.assertLess(rows[0].timestamp, rows[1].timestamp)

    def test_from_bound_is_respected(self) -> None:
        """The frontend asks for a 72-hour window; older readings must
        not leak back in."""
        with SessionLocal() as db:
            for station_id in self.station_ids:
                self._add(db, station_id, BASE - timedelta(days=30), 5.0)
                self._add(db, station_id, BASE, 28.0)
            db.commit()

        rows = list_network_timeseries(*self._window())
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0].T, 28.0, places=1)


if __name__ == "__main__":
    unittest.main()
