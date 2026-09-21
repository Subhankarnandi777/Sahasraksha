"""Regression tests for the station status/health repair tool.

The bug these exist to prevent: a station's exposed `status` (e.g.
"SERVICE NOW") and `health`/`degradation` came from two disconnected
seeding steps and could contradict each other -- observed live on
2026-09-21 as every station reporting `health: 1.0` even while marked
`status: "SERVICE NOW"`. The station already has real AnomalyVerdict rows
recording what the ML detector actually found; repair_station_status()
must recompute health/degradation/status from that real history so the
three fields can never disagree again.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import AnomalyVerdict as AnomalyVerdictModel
from app.db.models import Station
from app.db.models import WeatherReading as WeatherReadingModel
from app.tools.repair_station_status import repair_station_status

BASE = datetime(2019, 3, 7, 4, 0, tzinfo=timezone.utc)


class RepairStationStatusTests(unittest.TestCase):
    station_ids = [f"REPAIR-TEST-{suffix}" for suffix in ("A", "B", "C", "D")]

    def setUp(self) -> None:
        init_db()
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with SessionLocal() as db:
            db.query(AnomalyVerdictModel).filter(
                AnomalyVerdictModel.station_id.in_(self.station_ids)
            ).delete(synchronize_session=False)
            db.query(WeatherReadingModel).filter(
                WeatherReadingModel.station_id.in_(self.station_ids)
            ).delete(synchronize_session=False)
            db.query(Station).filter(Station.station_id.in_(self.station_ids)).delete(
                synchronize_session=False
            )
            db.commit()

    def _make_contradictory_station(self, db, station_id: str, last_seen: datetime) -> Station:
        """Mimics the actual seeding bug: a demo status hand-set independent
        of health/degradation, which stayed at flat "perfectly fine"
        defaults regardless of what the real detector later found."""
        station = Station(
            station_id=station_id,
            name=station_id,
            lat=20.0,
            lon=78.0,
            health="good",
            status="SERVICE NOW",
            health_score=1.0,
            degradation=0.0,
            trend_per_day=0.0,
            days_to_threshold=None,
            high_conf_alerts=0,
            alert_rate_pct=0.0,
            rate_vs_network=1.0,
            last_seen=last_seen,
            data_quality="good",
        )
        db.add(station)
        return station

    def _add_reading_and_verdict(
        self,
        db,
        station_id: str,
        moment: datetime,
        *,
        flag: bool,
        reason: str,
        severity: float,
        degradation: float,
    ) -> None:
        reading = WeatherReadingModel(
            station_id=station_id,
            recorded_at=moment,
            temperature_c=28.0,
            pressure_hpa=950.0,
            humidity_pct=70.0,
            flag=int(flag),
            amp_ratio_p=1.0,
        )
        db.add(reading)
        db.flush()
        db.add(
            AnomalyVerdictModel(
                station_id=station_id,
                reading_id=reading.id,
                reading_signature=f"{station_id}_{moment.isoformat()}",
                flag=flag,
                reason=reason,
                severity=str(severity),
                confidence=0.8,
                degradation=degradation,
                evidence=[],
            )
        )

    def test_repair_recomputes_a_contradictory_seed_into_a_consistent_state(self) -> None:
        """The load-bearing case: status says SERVICE NOW, health says
        1.0 -- both wrong until repaired from the station's own real,
        already-persisted detection."""
        with SessionLocal() as db:
            self._make_contradictory_station(db, self.station_ids[0], BASE)
            self._add_reading_and_verdict(
                db,
                self.station_ids[0],
                BASE,
                flag=True,
                reason="range",
                severity=0.95,
                degradation=0.6,
            )
            db.commit()

        with SessionLocal() as db:
            summary = repair_station_status(db)
        self.assertIn(self.station_ids[0], summary["repaired"])

        with SessionLocal() as db:
            station = db.get(Station, self.station_ids[0])
            self.assertEqual(station.status, "SERVICE NOW")
            self.assertAlmostEqual(station.degradation, 0.6)
            self.assertAlmostEqual(station.health_score, 0.4)
            # No more contradiction: health_score and status now agree,
            # by construction, because both come from the same degradation.
            self.assertLess(station.health_score, 0.55)

    def test_repair_preserves_last_seen_freshness(self) -> None:
        """Replaying an OLD verdict's timestamp must not regress the
        station's freshness label -- that's a separate, already-correct
        concern owned by the reseed baseline / live keepalive feed."""
        current_last_seen = datetime(2026, 9, 21, 10, 0, tzinfo=timezone.utc)
        with SessionLocal() as db:
            self._make_contradictory_station(db, self.station_ids[1], current_last_seen)
            self._add_reading_and_verdict(
                db,
                self.station_ids[1],
                BASE,  # a much older, real historical verdict
                flag=True,
                reason="anomaly",
                severity=0.7,
                degradation=0.3,
            )
            db.commit()

        with SessionLocal() as db:
            repair_station_status(db)

        with SessionLocal() as db:
            station = db.get(Station, self.station_ids[1])
            last_seen = station.last_seen
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=timezone.utc)
            self.assertEqual(last_seen, current_last_seen)

    def test_repair_ratchets_degradation_to_the_worst_ever_seen(self) -> None:
        """Two verdicts: an old severe one, then a newer mild one. Final
        degradation must reflect the ratcheted max, matching the same
        monotonic-degradation contract update_station_from_verdict already
        guarantees for live ingestion -- accumulated wear does not un-heal
        itself just because the most recent reading looks fine."""
        with SessionLocal() as db:
            self._make_contradictory_station(db, self.station_ids[2], BASE)
            self._add_reading_and_verdict(
                db,
                self.station_ids[2],
                BASE,
                flag=True,
                reason="range",
                severity=0.9,
                degradation=0.5,
            )
            self._add_reading_and_verdict(
                db,
                self.station_ids[2],
                BASE + timedelta(hours=1),
                flag=False,
                reason="ok",
                severity=0.0,
                degradation=0.02,
            )
            db.commit()

        with SessionLocal() as db:
            repair_station_status(db)

        with SessionLocal() as db:
            station = db.get(Station, self.station_ids[2])
            self.assertAlmostEqual(station.degradation, 0.5)
            self.assertAlmostEqual(station.health_score, 0.5)

    def test_stations_with_no_verdict_history_are_left_untouched(self) -> None:
        """Nothing real exists to repair such a station from -- fabricating
        a value would reintroduce the same dishonesty this tool removes."""
        with SessionLocal() as db:
            self._make_contradictory_station(db, self.station_ids[3], BASE)
            db.commit()

        with SessionLocal() as db:
            summary = repair_station_status(db)
        self.assertIn(self.station_ids[3], summary["skipped_no_verdicts"])
        self.assertNotIn(self.station_ids[3], summary["repaired"])

        with SessionLocal() as db:
            station = db.get(Station, self.station_ids[3])
            self.assertEqual(station.status, "SERVICE NOW")
            self.assertAlmostEqual(station.health_score, 1.0)

    def test_dry_run_reports_without_writing(self) -> None:
        with SessionLocal() as db:
            self._make_contradictory_station(db, self.station_ids[0], BASE)
            self._add_reading_and_verdict(
                db,
                self.station_ids[0],
                BASE,
                flag=True,
                reason="range",
                severity=0.95,
                degradation=0.6,
            )
            db.commit()

        with SessionLocal() as db:
            summary = repair_station_status(db, dry_run=True)
        self.assertIn(self.station_ids[0], summary["repaired"])

        with SessionLocal() as db:
            station = db.get(Station, self.station_ids[0])
            # Unchanged in the database -- dry run must not have committed.
            self.assertEqual(station.status, "SERVICE NOW")
            self.assertAlmostEqual(station.health_score, 1.0)
            self.assertAlmostEqual(station.degradation, 0.0)


if __name__ == "__main__":
    unittest.main()
