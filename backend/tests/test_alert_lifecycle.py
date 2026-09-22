"""Regression tests for the alert lifecycle: auto-resolution, the demo
"force a fresh alert" path, and automatic work-order creation.

The bug these exist to prevent: nothing in the app ever resolved an
alert except a manual PATCH /alerts/{id}/status, and a new alert was only
ever created when a station had none already open. Once a station got
its first alert, every later -- possibly more severe -- real detection
for that station was silently swallowed forever. Confirmed live on
2026-09-22: 60 of 60 stations held an open alert, and the dashboard's
"Real-Time Anomaly Cadence" showed zero new alerts across 6 hours despite
the live keepalive feed actively ticking every station. The same dedup
also made the "Inject Test Anomaly" demo button a no-op for every single
station.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import sys
import unittest

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import Alert as AlertModel
from app.db.models import Station
from app.db.models import WorkOrder as WorkOrderModel
from app.main import app
from app.schemas import AnomalyReason, AnomalyVerdict, WeatherReading
from app.services import alert_service, station_service


class AlertLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(app)

    def _station_id(self, suffix: str) -> str:
        return f"ALERT-LIFECYCLE-{suffix}"

    def _create_station(self, station_id: str) -> None:
        with SessionLocal() as db:
            station = db.get(Station, station_id)
            if station is None:
                station = Station(
                    station_id=station_id,
                    name=f"{station_id} Station",
                    lat=18.52,
                    lon=73.86,
                    health="good",
                    status="OK",
                    health_score=1.0,
                    degradation=0.0,
                    trend_per_day=0.0,
                    days_to_threshold=None,
                    high_conf_alerts=0,
                    alert_rate_pct=0.0,
                    rate_vs_network=1.0,
                    last_seen=datetime(2026, 9, 4, 0, 0, tzinfo=timezone.utc),
                )
                db.add(station)
            else:
                station.status = "OK"
                station.health_score = 1.0
                station.degradation = 0.0
            db.commit()

    def _reading(self, station_id: str, timestamp: datetime, value: float = 30.0) -> WeatherReading:
        return WeatherReading(
            station_id=station_id,
            timestamp=timestamp,
            T=value,
            P=948.1,
            RH=62.0,
            flag=0,
            amp_ratio_P=0.97,
        )

    def _open_alerts(self, station_id: str) -> list[AlertModel]:
        with SessionLocal() as db:
            return (
                db.query(AlertModel)
                .filter(AlertModel.station_id == station_id, AlertModel.status == "open")
                .all()
            )

    def _all_alerts(self, station_id: str) -> list[AlertModel]:
        with SessionLocal() as db:
            return db.query(AlertModel).filter(AlertModel.station_id == station_id).all()

    def _anomalous_verdict(self, severity: float = 0.6, degradation: float = 0.1) -> AnomalyVerdict:
        return AnomalyVerdict(
            flag=1,
            reason=AnomalyReason.ANOMALY,
            severity=severity,
            confidence=0.8,
            degradation=degradation,
            evidence=[["spatial_z_T", 5.0]],
        )

    def _clean_verdict(self) -> AnomalyVerdict:
        return AnomalyVerdict(
            flag=0,
            reason=AnomalyReason.OK,
            severity=0.0,
            confidence=0.9,
            degradation=0.02,
            evidence=[],
        )

    def test_second_anomaly_is_swallowed_without_a_fix(self) -> None:
        """Documents the ORIGINAL bug shape as a live guard: a second,
        independent anomalous reading on a station that already has an
        open alert must still not create a duplicate OPEN alert -- the
        dedup itself is correct and must survive this patch."""
        station_id = self._station_id("DEDUP")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(),
        )
        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 5, tzinfo=timezone.utc), value=31.0),
            self._anomalous_verdict(),
        )

        open_alerts = self._open_alerts(station_id)
        self.assertEqual(len(open_alerts), 1, "still only one OPEN alert at a time")

    def test_alert_auto_resolves_when_station_reports_clean_again(self) -> None:
        """The core fix: a subsequent clean (flag=0) verdict must resolve
        the standing open alert, so a later real anomaly on the SAME
        station can register instead of being silently swallowed."""
        station_id = self._station_id("AUTORESOLVE")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(),
        )
        self.assertEqual(len(self._open_alerts(station_id)), 1)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 5, tzinfo=timezone.utc), value=29.0),
            self._clean_verdict(),
        )

        self.assertEqual(len(self._open_alerts(station_id)), 0)
        all_alerts = self._all_alerts(station_id)
        self.assertEqual(len(all_alerts), 1)
        self.assertEqual(all_alerts[0].status, "resolved")
        self.assertIsNotNone(all_alerts[0].resolved_at)

        # A fresh anomaly afterwards must be able to register -- this is
        # the actual point of auto-resolving.
        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 10, tzinfo=timezone.utc), value=45.0),
            self._anomalous_verdict(severity=0.8),
        )
        self.assertEqual(len(self._open_alerts(station_id)), 1)

    def test_auto_resolve_does_not_touch_degradation_or_status(self) -> None:
        """Alerts and accumulated wear are separate concerns. A station
        can legitimately have no open alert (clean right now) while still
        showing SERVICE NOW / high degradation from real historical
        detections -- that's what the standing work order is for."""
        station_id = self._station_id("SEPARATION")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(severity=0.95, degradation=0.6),
        )
        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 5, tzinfo=timezone.utc), value=29.0),
            self._clean_verdict(),
        )

        self.assertEqual(len(self._open_alerts(station_id)), 0)
        station = station_service.get_station(station_id)
        self.assertEqual(station.status, "SERVICE NOW")
        self.assertAlmostEqual(station.degradation, 0.6)

    def test_force_new_alert_resolves_prior_and_creates_fresh_one(self) -> None:
        """The demo-injection path: a judge clicking the button on a
        station that already has a standing open alert must still see a
        new one appear, not silent nothing."""
        station_id = self._station_id("FORCE")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(),
        )
        first_open = self._open_alerts(station_id)
        self.assertEqual(len(first_open), 1)
        first_alert_id = first_open[0].id

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 5, tzinfo=timezone.utc), value=50.0),
            self._anomalous_verdict(severity=0.9),
            force_new_alert=True,
        )

        open_after = self._open_alerts(station_id)
        self.assertEqual(len(open_after), 1, "exactly one open alert, not a pile-up")
        self.assertNotEqual(open_after[0].id, first_alert_id, "a genuinely new alert, not the old one")

        with SessionLocal() as db:
            old_alert = db.get(AlertModel, first_alert_id)
            self.assertEqual(old_alert.status, "resolved")

    def test_demo_inject_endpoint_creates_an_alert_even_when_one_is_already_open(self) -> None:
        """End-to-end through the real route: this is the exact bug a
        judge would hit clicking "Inject Test Anomaly" on the live site.

        Asserting just "1 open alert" after the call is not enough to
        catch the original bug -- the pre-fix behaviour ALSO leaves
        exactly 1 open alert (the untouched original one, since the
        dedup silently did nothing). The real assertion is that the
        alert open afterwards is a DIFFERENT row than the one open
        before, i.e. something genuinely new was created.
        """
        station_id = self._station_id("DEMOROUTE")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(),
        )
        before = self._open_alerts(station_id)
        self.assertEqual(len(before), 1)
        original_alert_id = before[0].id

        response = self.client.post(f"/demo/inject-anomaly?station_id={station_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["flag"], 1)

        # Exactly one open alert (the old one resolved, a fresh one open) --
        # not zero (the pre-fix bug) and not two (a pile-up) -- AND it must
        # be a genuinely different row, not the same one left untouched.
        after = self._open_alerts(station_id)
        self.assertEqual(len(after), 1)
        self.assertNotEqual(
            after[0].id,
            original_alert_id,
            "the demo endpoint must produce a NEW alert, not leave the old one sitting open",
        )

    def test_high_severity_alert_gets_an_automatic_work_order(self) -> None:
        station_id = self._station_id("AUTOWO")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(severity=0.95, degradation=0.5),
        )

        with SessionLocal() as db:
            alert = db.query(AlertModel).filter(AlertModel.station_id == station_id).one()
            work_orders = db.query(WorkOrderModel).filter(WorkOrderModel.alert_id == alert.id).all()
        self.assertEqual(len(work_orders), 1)
        self.assertEqual(work_orders[0].priority, "CRITICAL")

    def test_low_severity_alert_does_not_get_an_automatic_work_order(self) -> None:
        station_id = self._station_id("NOWO")
        self._create_station(station_id)

        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, datetime(2026, 9, 4, 10, 0, tzinfo=timezone.utc)),
            self._anomalous_verdict(severity=0.3, degradation=0.05),
        )

        with SessionLocal() as db:
            alert = db.query(AlertModel).filter(AlertModel.station_id == station_id).one()
            work_orders = db.query(WorkOrderModel).filter(WorkOrderModel.alert_id == alert.id).all()
        self.assertEqual(len(work_orders), 0)


if __name__ == "__main__":
    unittest.main()
