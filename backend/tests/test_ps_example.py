"""The problem statement's own example, end to end through the API:
an AWS suddenly reports 55 °C with extremely high humidity and abnormal
pressure while its neighbours read normally."""
from datetime import datetime, timedelta, timezone
import math
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import Station, WeatherReading as WeatherReadingRow
from app.main import app
from app.schemas import WeatherReading
from app.services.anomaly_detector import get_anomaly_detector

# four stations within ~200 km of each other (Pune region)
STATIONS = {
    "PS55-TARGET": (18.52, 73.86),
    "PS55-NB1": (19.08, 72.88),
    "PS55-NB2": (19.99, 73.79),
    "PS55-NB3": (19.09, 74.74),
}
DAYS = 16


def _climate(sid: str, t: datetime) -> tuple[float, float, float]:
    lst = (t.hour + t.minute / 60 + STATIONS[sid][1] / 15) % 24
    T = 29.0 + 5.0 * math.cos(2 * math.pi * (lst - 15) / 24) + 0.3 * (hash(sid) % 3)
    RH = 70.0 - 15.0 * math.cos(2 * math.pi * (lst - 15) / 24)
    P = 950.0 + 1.2 * math.cos(4 * math.pi * (lst - 10) / 24)
    return round(T, 2), round(P, 2), round(RH, 1)


class PsExampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        init_db()
        cls.now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        with SessionLocal() as db:
            for sid, (lat, lon) in STATIONS.items():
                if db.get(Station, sid) is None:
                    db.add(Station(station_id=sid, name=sid, lat=lat, lon=lon, health="good", status="OK",
                                   health_score=0.95, degradation=0.0, trend_per_day=0.0, days_to_threshold=None,
                                   high_conf_alerts=0, alert_rate_pct=0.0, rate_vs_network=1.0,
                                   last_seen=cls.now))
                db.flush()
                for h in range(DAYS * 24, 0, -1):
                    t = cls.now - timedelta(hours=h)
                    T, P, RH = _climate(sid, t)
                    db.add(WeatherReadingRow(station_id=sid, recorded_at=t, temperature_c=T,
                                             pressure_hpa=P, humidity_pct=RH, flag=0, amp_ratio_p=1.0))
            db.commit()
        # neighbours report normally at the current hour, so the engine holds their state
        det = get_anomaly_detector()
        for sid in STATIONS:
            T, P, RH = _climate(sid, cls.now)
            det.evaluate(WeatherReading(station_id=sid, timestamp=cls.now, T=T, P=P, RH=RH, flag=0))
            with SessionLocal() as db:
                db.add(WeatherReadingRow(station_id=sid, recorded_at=cls.now, temperature_c=T,
                                         pressure_hpa=P, humidity_pct=RH, flag=0, amp_ratio_p=1.0))
                db.commit()

    def test_ps55_is_named_impossible_with_estimate_and_action(self) -> None:
        client = TestClient(app)
        r = client.post("/demo/inject-anomaly", params={"station_id": "PS55-TARGET", "scenario": "ps55"})
        self.assertEqual(r.status_code, 200, r.text)
        v = r.json()
        ev = {k: val for k, val in v["evidence"]}
        self.assertEqual(v["flag"], 1)
        self.assertEqual(v["reason"], "impossible")
        self.assertEqual(v["confidence"], 1.0)          # a physics rule, not a statistical guess
        self.assertEqual(ev.get("t_record"), 55.0)
        self.assertIn("dewpoint_ceiling", ev)
        # estimate comes from own harmonic + neighbours; true value here is the climate curve
        T_true, _, _ = _climate("PS55-TARGET", datetime.now(timezone.utc))
        self.assertIn("estimate_T", ev)
        self.assertLess(abs(ev["estimate_T"] - T_true), 4.0)
        # 2.1 with voting neighbours; the stream's own band if other test stations sharing
        # these coordinates are off-baseline and excluded from the vote
        self.assertLessEqual(ev.get("estimate_band_T"), 5.0)

    def test_unknown_scenario_rejected(self) -> None:
        client = TestClient(app)
        r = client.post("/demo/inject-anomaly", params={"station_id": "PS55-TARGET", "scenario": "nope"})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
