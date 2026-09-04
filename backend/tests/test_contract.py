from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import Station
from app.main import app


class ContractEndpointTests(unittest.TestCase):
    test_station_id = "TEST-CONTRACT-001"

    @classmethod
    def setUpClass(cls) -> None:
        init_db()
        with SessionLocal() as db:
            if db.get(Station, cls.test_station_id) is None:
                db.add(
                    Station(
                        station_id=cls.test_station_id,
                        name="Contract Test Station",
                        lat=18.52,
                        lon=73.86,
                        health="good",
                        status="online",
                        health_score=0.95,
                        degradation=0.05,
                        trend_per_day=0.001,
                        days_to_threshold=30,
                        high_conf_alerts=0,
                        alert_rate_pct=0.0,
                        rate_vs_network=1.0,
                        last_seen=datetime(2026, 9, 4, tzinfo=timezone.utc),
                    )
                )
                db.commit()
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.station_id = self.test_station_id

    def _reading_payload(self, timestamp: str, temperature: float = 46.2) -> dict:
        return {
            "station_id": self.station_id,
            "timestamp": timestamp,
            "T": temperature,
            "P": 948.1,
            "RH": 62.0,
            "flag": 0,
            "amp_ratio_P": 0.97,
        }

    def test_health_contract(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "running")
        self.assertIn("station_count", body)
        self.assertIn("open_alert_count", body)

    def test_stations_contract_shape(self) -> None:
        response = self.client.get("/stations")
        self.assertEqual(response.status_code, 200)
        station = response.json()[0]
        expected_fields = {
            "station_id",
            "name",
            "lat",
            "lon",
            "health",
            "status",
            "degradation",
            "trend_per_day",
            "days_to_threshold",
            "high_conf_alerts",
            "alert_rate_pct",
            "rate_vs_network",
            "last_seen",
        }
        self.assertEqual(set(station.keys()), expected_fields)
        self.assertIn(station["status"], ["SERVICE NOW", "SCHEDULE", "MONITOR", "OK"])

    def test_ingest_contract_shape(self) -> None:
        response = self.client.post(
            "/ingest",
            json=self._reading_payload("2026-09-04T10:00:00Z"),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.json().keys()),
            {"flag", "reason", "severity", "confidence", "degradation", "evidence"},
        )
        self.assertIn(
            response.json()["reason"],
            ["ok", "range", "step", "frozen", "missing", "drift", "degrading", "anomaly", "unclassified"],
        )

    def test_timeseries_contract_shape(self) -> None:
        timestamp = "2026-09-04T10:01:00Z"
        create_response = self.client.post("/readings", json=self._reading_payload(timestamp, 31.1))
        self.assertEqual(create_response.status_code, 201)

        response = self.client.get(f"/stations/{self.station_id}/timeseries")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 1)
        self.assertEqual(
            set(response.json()[0].keys()),
            {"timestamp", "T", "P", "RH", "flag", "amp_ratio_P"},
        )

    def test_timeseries_unknown_station(self) -> None:
        response = self.client.get("/stations/UNKNOWN/timeseries")
        self.assertEqual(response.status_code, 404)

    def test_alerts_include_evidence_after_verdict(self) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        verdict_response = self.client.post(
            "/readings/verdict",
            json=self._reading_payload(timestamp, 46.9),
        )
        self.assertEqual(verdict_response.status_code, 200)
        self.assertEqual(verdict_response.json()["flag"], 1)

        alerts_response = self.client.get(f"/stations/{self.station_id}/alerts")
        self.assertEqual(alerts_response.status_code, 200)
        matching_alerts = [
            alert for alert in alerts_response.json()
            if alert["evidence"] == verdict_response.json()["evidence"]
        ]
        self.assertGreaterEqual(len(matching_alerts), 1)
        self.assertIn("confidence", matching_alerts[0])
        self.assertIn("degradation", matching_alerts[0])

    def test_ingest_validation(self) -> None:
        payload = self._reading_payload("2026-09-04T10:02:00Z")
        payload["T"] = 1000
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()

