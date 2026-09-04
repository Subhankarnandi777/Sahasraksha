from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from app.schemas import AnomalyReason, WeatherReading
from app.services.anomaly_detector import SkyGuardAnomalyDetector


class SkyGuardAdapterTests(unittest.TestCase):
    def _payload(self, reading: WeatherReading) -> dict:
        if hasattr(reading, "model_dump"):
            return json.loads(reading.model_dump_json())
        return json.loads(reading.json())

    def _reading(
        self,
        station_id: str = "ADAPTER-001",
        timestamp: datetime | None = None,
        T: float | None = 30.0,
        P: float | None = 950.0,
        RH: float | None = 60.0,
    ) -> WeatherReading:
        return WeatherReading(
            station_id=station_id,
            timestamp=timestamp or datetime(2026, 9, 4, 10, tzinfo=timezone.utc),
            T=T,
            P=P,
            RH=RH,
            flag=0,
            amp_ratio_P=0.97,
        )

    def test_adapter_uses_streaming_skyguard_contract(self) -> None:
        detector = SkyGuardAnomalyDetector()

        verdict = detector.evaluate(self._reading())

        verdict_body = verdict.model_dump() if hasattr(verdict, "model_dump") else verdict.dict()
        self.assertEqual(
            set(verdict_body.keys()),
            {"flag", "reason", "severity", "confidence", "degradation", "evidence"},
        )
        self.assertIsInstance(verdict.reason, AnomalyReason)
        self.assertGreaterEqual(verdict.confidence, 0.0)
        self.assertLessEqual(verdict.confidence, 1.0)
        self.assertTrue(all(isinstance(pair, list) and len(pair) == 2 for pair in verdict.evidence))

    def test_adapter_preserves_api_evidence_names(self) -> None:
        detector = SkyGuardAnomalyDetector()
        first = self._reading()
        detector.evaluate(first)

        verdict = detector.evaluate(
            self._reading(timestamp=first.timestamp + timedelta(hours=1), P=980.0)
        )

        keys = {key for key, _ in verdict.evidence}
        self.assertTrue(any(key.startswith("spatial_z_") for key in keys))
        self.assertFalse(any(key.startswith("z_") for key in keys))

    def test_adapter_keeps_state_per_station(self) -> None:
        detector = SkyGuardAnomalyDetector()
        timestamp = datetime(2026, 9, 4, 10, tzinfo=timezone.utc)

        detector.evaluate(self._reading("STATION-A", timestamp=timestamp, P=950.0))
        detector.evaluate(self._reading("STATION-B", timestamp=timestamp, P=1000.0))

        verdict_a = detector.evaluate(
            self._reading("STATION-A", timestamp=timestamp + timedelta(hours=1), P=1000.0)
        )
        verdict_b = detector.evaluate(
            self._reading("STATION-B", timestamp=timestamp + timedelta(hours=1), P=1000.0)
        )

        evidence_a = dict(verdict_a.evidence)
        evidence_b = dict(verdict_b.evidence)
        self.assertGreater(evidence_a.get("step_P", 0.0), 0.0)
        self.assertEqual(evidence_b.get("step_P", 0.0), 0.0)

    def test_ingest_uses_skyguard_adapter_evidence(self) -> None:
        client = TestClient(app)
        station_id = "INGEST-ML-ADAPTER"
        first = self._reading(station_id=station_id)
        second = self._reading(
            station_id=station_id,
            timestamp=first.timestamp + timedelta(hours=1),
            P=980.0,
        )

        self.assertEqual(client.post("/ingest", json=self._payload(first)).status_code, 200)
        response = client.post("/ingest", json=self._payload(second))

        self.assertEqual(response.status_code, 200)
        evidence_keys = {key for key, _ in response.json()["evidence"]}
        self.assertTrue(any(key.startswith("spatial_z_") for key in evidence_keys))
        self.assertNotIn("temporary_mock_detector", evidence_keys)


if __name__ == "__main__":
    unittest.main()
