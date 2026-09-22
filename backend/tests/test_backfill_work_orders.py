"""Regression tests for the work-order backfill tool.

Automatic work-order creation (alert_service.AUTO_WORK_ORDER_SEVERITY)
only applies to alerts created going forward. This tool catches up
alerts that were already open before that existed -- e.g. a station
repaired to its real high degradation by repair_station_status.py.
"""
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import Alert as AlertModel
from app.db.models import AnomalyVerdict as AnomalyVerdictModel
from app.db.models import Station
from app.db.models import WeatherReading as WeatherReadingModel
from app.db.models import WorkOrder as WorkOrderModel
from app.tools.backfill_work_orders import find_alerts_needing_work_orders, main as backfill_main


class BackfillWorkOrdersTests(unittest.TestCase):
    station_ids = ["BACKFILL-WO-A", "BACKFILL-WO-B", "BACKFILL-WO-C"]

    def setUp(self) -> None:
        init_db()
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with SessionLocal() as db:
            db.query(WorkOrderModel).filter(
                WorkOrderModel.station_id.in_(self.station_ids)
            ).delete(synchronize_session=False)
            db.query(AlertModel).filter(AlertModel.station_id.in_(self.station_ids)).delete(
                synchronize_session=False
            )
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

    def _make_station_with_open_alert(self, db, station_id: str, severity: float) -> int:
        db.add(
            Station(
                station_id=station_id, name=station_id, lat=20.0, lon=78.0,
                health="good", status="SERVICE NOW", health_score=0.2, degradation=0.8,
                trend_per_day=0.0, days_to_threshold=None, high_conf_alerts=0,
                alert_rate_pct=0.0, rate_vs_network=1.0,
                last_seen=datetime(2026, 9, 20, tzinfo=timezone.utc), data_quality="good",
            )
        )
        reading = WeatherReadingModel(
            station_id=station_id, recorded_at=datetime(2026, 9, 20, tzinfo=timezone.utc),
            temperature_c=40.0, pressure_hpa=940.0, humidity_pct=20.0, flag=1, amp_ratio_p=1.0,
        )
        db.add(reading)
        db.flush()
        verdict = AnomalyVerdictModel(
            station_id=station_id, reading_id=reading.id,
            reading_signature=f"{station_id}_backfill", flag=True, reason="range",
            severity=str(severity), confidence=0.85, degradation=0.8, evidence=[],
        )
        db.add(verdict)
        db.flush()
        alert = AlertModel(
            station_id=station_id, reading_id=reading.id, anomaly_verdict_id=verdict.id,
            severity=str(severity), message="range", status="open",
        )
        db.add(alert)
        db.flush()
        return alert.id

    def test_finds_high_severity_open_alerts_missing_a_work_order(self) -> None:
        with SessionLocal() as db:
            high_id = self._make_station_with_open_alert(db, self.station_ids[0], 0.95)
            low_id = self._make_station_with_open_alert(db, self.station_ids[1], 0.3)
            db.commit()

        with SessionLocal() as db:
            candidates = find_alerts_needing_work_orders(db)
        candidate_ids = {alert.id for alert in candidates}
        self.assertIn(high_id, candidate_ids)
        self.assertNotIn(low_id, candidate_ids)

    def test_skips_alerts_that_already_have_a_work_order(self) -> None:
        with SessionLocal() as db:
            alert_id = self._make_station_with_open_alert(db, self.station_ids[0], 0.9)
            db.add(
                WorkOrderModel(
                    station_id=self.station_ids[0], alert_id=alert_id,
                    priority="CRITICAL", recommended_action="already handled", status="OPEN",
                )
            )
            db.commit()

        with SessionLocal() as db:
            candidates = find_alerts_needing_work_orders(db)
        self.assertNotIn(alert_id, {alert.id for alert in candidates})

    def test_real_run_creates_work_orders_and_is_idempotent(self) -> None:
        with SessionLocal() as db:
            alert_id = self._make_station_with_open_alert(db, self.station_ids[2], 0.97)
            db.commit()

        old_argv = sys.argv
        try:
            sys.argv = ["backfill_work_orders"]
            backfill_main()
            backfill_main()  # second run must not create a duplicate
        finally:
            sys.argv = old_argv

        with SessionLocal() as db:
            work_orders = db.query(WorkOrderModel).filter(WorkOrderModel.alert_id == alert_id).all()
        self.assertEqual(len(work_orders), 1)
        self.assertEqual(work_orders[0].priority, "CRITICAL")


if __name__ == "__main__":
    unittest.main()
