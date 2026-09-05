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
from app.db.models import Station
from app.main import app
from app.schemas import AnomalyReason, AnomalyVerdict, WeatherReading
from app.services import alert_service, station_service


class StationStateFromVerdictTests(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(app)

    def _station_id(self, suffix: str) -> str:
        return f"STATE-VERDICT-{suffix}"

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
                    status="online",
                    health_score=0.99,
                    degradation=0.01,
                    trend_per_day=0.0,
                    days_to_threshold=None,
                    high_conf_alerts=0,
                    alert_rate_pct=0.0,
                    rate_vs_network=1.0,
                    last_seen=datetime(2026, 9, 4, 0, 0, tzinfo=timezone.utc),
                )
                db.add(station)
            else:
                station.health = "good"
                station.status = "online"
                station.health_score = 0.99
                station.degradation = 0.01
                station.trend_per_day = 0.0
                station.days_to_threshold = None
                station.high_conf_alerts = 0
                station.alert_rate_pct = 0.0
                station.rate_vs_network = 1.0
                station.last_seen = datetime(2026, 9, 4, 0, 0, tzinfo=timezone.utc)
            db.commit()

    def _reading(self, station_id: str, timestamp: datetime) -> WeatherReading:
        return WeatherReading(
            station_id=station_id,
            timestamp=timestamp,
            T=30.0,
            P=948.1,
            RH=62.0,
            flag=0,
            amp_ratio_P=0.97,
        )

    def _payload(self, reading: WeatherReading) -> dict:
        if hasattr(reading, "model_dump"):
            return json.loads(reading.model_dump_json())
        return json.loads(reading.json())

    def _save_verdict(
        self,
        suffix: str,
        verdict: AnomalyVerdict,
        timestamp: datetime | None = None,
    ) -> tuple[str, datetime]:
        station_id = self._station_id(suffix)
        reading_time = timestamp or datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
        self._create_station(station_id)
        alert_service.save_verdict_and_create_alert(
            self._reading(station_id, reading_time),
            verdict,
        )
        return station_id, reading_time

    def _station_summary(self, station_id: str) -> dict:
        response = self.client.get("/stations")
        self.assertEqual(response.status_code, 200)
        matches = [station for station in response.json() if station["station_id"] == station_id]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def test_low_or_no_anomaly_verdict_updates_station_as_ok(self) -> None:
        station_id, reading_time = self._save_verdict(
            "OK",
            AnomalyVerdict(
                flag=0,
                reason=AnomalyReason.OK,
                severity=0.0,
                confidence=0.9,
                degradation=0.04,
                evidence=[["spatial_z_P", 0.1]],
            ),
        )

        station = self._station_summary(station_id)
        self.assertEqual(station["status"], "OK")
        self.assertAlmostEqual(station["health"], 0.96)
        self.assertAlmostEqual(station["degradation"], 0.04)
        self.assertEqual(station["last_seen"].replace("+00:00", "Z"), reading_time.isoformat().replace("+00:00", "Z"))

    def test_warning_anomalous_verdict_updates_station_as_monitor(self) -> None:
        station_id, _ = self._save_verdict(
            "MONITOR",
            AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.ANOMALY,
                severity=0.6,
                confidence=0.7,
                degradation=0.12,
                evidence=[["spatial_z_P", 4.2]],
            ),
        )

        station = self._station_summary(station_id)
        self.assertEqual(station["status"], "MONITOR")
        self.assertAlmostEqual(station["health"], 0.88)
        self.assertAlmostEqual(station["degradation"], 0.12)

    def test_degrading_verdict_updates_station_as_schedule(self) -> None:
        station_id, _ = self._save_verdict(
            "SCHEDULE",
            AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.DEGRADING,
                severity=0.55,
                confidence=0.76,
                degradation=0.25,
                evidence=[["tide_loss", 0.25]],
            ),
        )

        station = self._station_summary(station_id)
        self.assertEqual(station["status"], "SCHEDULE")
        self.assertAlmostEqual(station["health"], 0.75)
        self.assertAlmostEqual(station["degradation"], 0.25)

    def test_critical_verdict_updates_station_as_service_now_and_persists(self) -> None:
        station_id, reading_time = self._save_verdict(
            "SERVICE",
            AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.RANGE,
                severity=0.95,
                confidence=0.91,
                degradation=0.52,
                evidence=[["spatial_z_T", 8.1]],
            ),
        )

        station = self._station_summary(station_id)
        self.assertEqual(station["status"], "SERVICE NOW")
        self.assertAlmostEqual(station["health"], 0.48)
        self.assertAlmostEqual(station["degradation"], 0.52)

        with SessionLocal() as db:
            refreshed = db.get(Station, station_id)
            self.assertIsNotNone(refreshed)
            self.assertEqual(refreshed.status, "SERVICE NOW")
            self.assertAlmostEqual(refreshed.health_score, 0.48)
            self.assertAlmostEqual(refreshed.degradation, 0.52)
            self.assertEqual(station_service._as_utc(refreshed.last_seen), reading_time)

    def test_ingest_for_known_station_updates_station_state_from_real_model_verdict(self) -> None:
        station_id = self._station_id("INGEST")
        timestamp = datetime(2026, 9, 4, 14, 0, tzinfo=timezone.utc)
        self._create_station(station_id)

        response = self.client.post(
            "/ingest",
            json=self._payload(self._reading(station_id, timestamp)),
        )

        self.assertEqual(response.status_code, 200)
        station = self._station_summary(station_id)
        self.assertAlmostEqual(station["health"], 1 - response.json()["degradation"])
        self.assertAlmostEqual(station["degradation"], response.json()["degradation"])
        self.assertEqual(station["last_seen"].replace("+00:00", "Z"), timestamp.isoformat().replace("+00:00", "Z"))


if __name__ == "__main__":
    unittest.main()
