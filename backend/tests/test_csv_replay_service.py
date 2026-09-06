from datetime import datetime, timezone
from pathlib import Path
import csv
import sys
import tempfile
import unittest

from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import SessionLocal, init_db
from app.db.models import Station
from app.main import app
from app.services import csv_replay_service


class CsvReplayServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(app)
        self.tempdir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.tempdir.name)
        self.coords_path = self.base_path / "coords.csv"
        self.observations_path = self.base_path / "observations.csv"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _station_id(self, suffix: str) -> str:
        return f"CSV-REPLAY-{suffix}"

    def _write_coords(self) -> tuple[str, str]:
        good_id = self._station_id("GOOD")
        missing_pressure_id = self._station_id("MISSING-P")
        low_id = "43296099999"
        with self.coords_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["station_id", "lat", "lon", "name", "P_pct", "data_quality"],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "station_id": good_id,
                    "lat": "18.52",
                    "lon": "73.86",
                    "name": "CSV Pune",
                    "P_pct": "98.0",
                    "data_quality": "good",
                }
            )
            writer.writerow(
                {
                    "station_id": missing_pressure_id,
                    "lat": "26.91",
                    "lon": "75.79",
                    "name": "CSV Jaipur",
                    "P_pct": "67.0",
                    "data_quality": "good",
                }
            )
            writer.writerow(
                {
                    "station_id": low_id,
                    "lat": "12.95",
                    "lon": "77.633",
                    "name": "BANGALORE/HINDUSTAN AIRPORT",
                    "P_pct": "0.0",
                    "data_quality": "low_confidence",
                }
            )
        return good_id, missing_pressure_id, low_id

    def _write_observations(self, good_id: str, missing_pressure_id: str, low_id: str) -> None:
        with self.observations_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "timestamp",
                    "station_id",
                    "lat",
                    "lon",
                    "alt_m",
                    "T",
                    "P",
                    "RH",
                    "noaa_bad",
                    "source_missing",
                ],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "timestamp": "2024-01-01 00:00:00",
                    "station_id": good_id,
                    "lat": "18.52",
                    "lon": "73.86",
                    "alt_m": "560",
                    "T": "27.4",
                    "P": "1008.4",
                    "RH": "68",
                    "noaa_bad": "False",
                    "source_missing": "False",
                }
            )
            writer.writerow(
                {
                    "timestamp": "2024-01-01 01:00:00",
                    "station_id": good_id,
                    "lat": "18.52",
                    "lon": "73.86",
                    "alt_m": "560",
                    "T": "27.8",
                    "P": "1008.1",
                    "RH": "67",
                    "noaa_bad": "False",
                    "source_missing": "False",
                }
            )
            writer.writerow(
                {
                    "timestamp": "2024-01-01 00:00:00",
                    "station_id": missing_pressure_id,
                    "lat": "26.91",
                    "lon": "75.79",
                    "alt_m": "431",
                    "T": "19.2",
                    "P": "",
                    "RH": "54",
                    "noaa_bad": "False",
                    "source_missing": "True",
                }
            )
            writer.writerow(
                {
                    "timestamp": "2024-01-01 00:00:00",
                    "station_id": low_id,
                    "lat": "12.95",
                    "lon": "77.633",
                    "alt_m": "897",
                    "T": "24.1",
                    "P": "",
                    "RH": "72",
                    "noaa_bad": "False",
                    "source_missing": "True",
                }
            )

    def test_csv_station_import_upserts_station_ids_as_strings(self) -> None:
        good_id, _, low_id = self._write_coords()

        summary = csv_replay_service.import_stations_from_csv(self.coords_path)
        second_summary = csv_replay_service.import_stations_from_csv(self.coords_path)

        self.assertEqual(summary.stations_seen, 3)
        self.assertEqual(summary.stations_created, 3)
        self.assertEqual(second_summary.stations_created, 0)
        with SessionLocal() as db:
            good = db.get(Station, good_id)
            low = db.get(Station, low_id)
            self.assertIsNotNone(good)
            self.assertIsNotNone(low)
            self.assertEqual(good.station_id, good_id)
            self.assertEqual(low.station_id, "43296099999")
            self.assertEqual(low.health, "low_confidence")

    def test_replay_processes_csv_through_skyguard_and_updates_station_state(self) -> None:
        good_id, missing_pressure_id, low_id = self._write_coords()
        self._write_observations(good_id, missing_pressure_id, low_id)

        summary = csv_replay_service.replay_observations_from_csv(
            coords_path=self.coords_path,
            observations_path=self.observations_path,
        )

        self.assertEqual(summary.stations_imported, 3)
        self.assertEqual(summary.observations_processed, 3)
        self.assertEqual(summary.skipped_low_confidence, 1)
        self.assertEqual(summary.persisted_verdicts, 2)
        self.assertIn(good_id, summary.meaningful_station_ids)
        self.assertIn(missing_pressure_id, summary.meaningful_station_ids)
        self.assertNotIn(low_id, summary.meaningful_station_ids)

        response = self.client.get("/stations")
        self.assertEqual(response.status_code, 200)
        stations = {station["station_id"]: station for station in response.json()}
        self.assertIn(good_id, stations)
        self.assertIn(low_id, stations)
        self.assertEqual(stations[good_id]["data_quality"], "good")
        self.assertEqual(stations[missing_pressure_id]["data_quality"], "good")
        self.assertEqual(stations[low_id]["data_quality"], "low_confidence")
        self.assertEqual(stations[good_id]["last_seen"].replace("+00:00", "Z"), "2024-01-01T01:00:00Z")
        self.assertAlmostEqual(
            stations[good_id]["health"],
            1 - stations[good_id]["degradation"],
        )
        self.assertEqual(stations[good_id]["latest_temperature"], 27.8)
        self.assertEqual(stations[good_id]["latest_pressure"], 1008.1)
        self.assertEqual(stations[good_id]["latest_humidity"], 67.0)
        self.assertEqual(stations[missing_pressure_id]["latest_temperature"], 19.2)
        self.assertIsNone(stations[missing_pressure_id]["latest_pressure"])
        self.assertEqual(stations[missing_pressure_id]["latest_humidity"], 54.0)
        self.assertEqual(stations[low_id]["status"], "MONITOR")
        self.assertIsNone(stations[low_id]["health"])
        self.assertIsNone(stations[low_id]["latest_temperature"])
        self.assertIsNone(stations[low_id]["latest_pressure"])
        self.assertIsNone(stations[low_id]["latest_humidity"])

        with SessionLocal() as db:
            refreshed = db.get(Station, good_id)
            self.assertIsNotNone(refreshed)
            self.assertEqual(
                refreshed.last_seen.replace(tzinfo=timezone.utc),
                datetime(2024, 1, 1, 1, 0, tzinfo=timezone.utc),
            )


if __name__ == "__main__":
    unittest.main()
