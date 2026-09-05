from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import argparse
import csv
import math
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.db.database import SessionLocal, init_db
from app.db.models import Station
from app.schemas import StationStatus, WeatherReading
from app.services import alert_service
from app.services.anomaly_detector import SkyGuardAnomalyDetector


PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_COORDS_PATH = PROJECT_ROOT / "data" / "skyguard_station_coords.csv"
DEFAULT_OBSERVATIONS_PATH = PROJECT_ROOT / "data" / "skyguard_big_export.csv"
LOW_CONFIDENCE = "low_confidence"
GOOD_QUALITY = "good"
UNKNOWN_QUALITY = "unknown"
INITIAL_LAST_SEEN = datetime(1970, 1, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class StationMetadata:
    station_id: str
    name: str
    lat: float
    lon: float
    pressure_pct: float | None
    data_quality: str


@dataclass
class StationImportSummary:
    stations_seen: int = 0
    stations_created: int = 0
    stations_updated: int = 0
    low_confidence_station_ids: list[str] = field(default_factory=list)


@dataclass
class ReplaySummary:
    stations_imported: int = 0
    rows_seen: int = 0
    observations_processed: int = 0
    skipped_low_confidence: int = 0
    skipped_invalid: int = 0
    persisted_verdicts: int = 0
    meaningful_station_ids: set[str] = field(default_factory=set)
    low_confidence_station_ids: set[str] = field(default_factory=set)


def load_station_metadata(coords_path: Path | str = DEFAULT_COORDS_PATH) -> dict[str, StationMetadata]:
    path = Path(coords_path)
    metadata: dict[str, StationMetadata] = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            station_id = str(row["station_id"]).strip()
            if not station_id:
                continue
            metadata[station_id] = StationMetadata(
                station_id=station_id,
                name=(row.get("name") or station_id).strip(),
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                pressure_pct=_optional_float(row.get("P_pct")),
                data_quality=_normalize_data_quality(row.get("data_quality")),
            )
    return metadata


def station_data_quality(station_id: str, coords_path: Path | str = DEFAULT_COORDS_PATH) -> str:
    metadata = load_station_metadata(coords_path)
    station = metadata.get(str(station_id))
    return station.data_quality if station is not None else GOOD_QUALITY


def import_stations_from_csv(
    coords_path: Path | str = DEFAULT_COORDS_PATH,
    db: Session | None = None,
) -> StationImportSummary:
    metadata = load_station_metadata(coords_path)
    summary = StationImportSummary(stations_seen=len(metadata))

    def apply(session: Session) -> None:
        for station in metadata.values():
            existing = session.get(Station, station.station_id)
            if existing is None:
                session.add(_new_station(station))
                summary.stations_created += 1
            else:
                existing.name = station.name
                existing.lat = station.lat
                existing.lon = station.lon
                if station.data_quality == LOW_CONFIDENCE:
                    _mark_low_confidence(existing)
                summary.stations_updated += 1

            if station.data_quality == LOW_CONFIDENCE:
                summary.low_confidence_station_ids.append(station.station_id)

    if db is not None:
        apply(db)
        return summary

    with SessionLocal() as session:
        apply(session)
        session.commit()
        return summary


def replay_observations_from_csv(
    coords_path: Path | str = DEFAULT_COORDS_PATH,
    observations_path: Path | str = DEFAULT_OBSERVATIONS_PATH,
    max_observations: int | None = None,
) -> ReplaySummary:
    import_summary = import_stations_from_csv(coords_path)
    metadata = load_station_metadata(coords_path)
    low_confidence_ids = {
        station_id
        for station_id, station in metadata.items()
        if station.data_quality == LOW_CONFIDENCE
    }
    detector = SkyGuardAnomalyDetector()
    latest_by_station: dict[str, tuple[WeatherReading, Any]] = {}
    last_timestamp_by_station: dict[str, datetime] = {}
    summary = ReplaySummary(
        stations_imported=import_summary.stations_seen,
        low_confidence_station_ids=set(low_confidence_ids),
    )

    with Path(observations_path).open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            summary.rows_seen += 1
            station_id = str(row.get("station_id", "")).strip()
            if not station_id:
                summary.skipped_invalid += 1
                continue
            if station_id in low_confidence_ids:
                summary.skipped_low_confidence += 1
                continue

            reading = _reading_from_row(row)
            if reading is None:
                summary.skipped_invalid += 1
                continue

            previous_timestamp = last_timestamp_by_station.get(station_id)
            if previous_timestamp is not None and reading.timestamp < previous_timestamp:
                raise ValueError(
                    f"Observation CSV is not chronological for station {station_id}: "
                    f"{reading.timestamp.isoformat()} came after {previous_timestamp.isoformat()}."
                )
            last_timestamp_by_station[station_id] = reading.timestamp

            verdict = detector.evaluate(reading)
            latest_by_station[station_id] = (reading, verdict)
            summary.observations_processed += 1
            summary.meaningful_station_ids.add(station_id)

            if max_observations is not None and summary.observations_processed >= max_observations:
                break

    for reading, verdict in latest_by_station.values():
        alert_service.save_verdict_and_create_alert(reading, verdict)
        summary.persisted_verdicts += 1

    return summary


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import NOAA station coordinates and replay observations through SkyGuard."
    )
    parser.add_argument("--coords", type=Path, default=DEFAULT_COORDS_PATH)
    parser.add_argument("--observations", type=Path, default=DEFAULT_OBSERVATIONS_PATH)
    parser.add_argument(
        "--stations-only",
        action="store_true",
        help="Only upsert station metadata; do not replay observations.",
    )
    parser.add_argument(
        "--max-observations",
        type=int,
        default=None,
        help="Optional cap for smoke tests. Omit to process the full CSV.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    init_db()
    if args.stations_only:
        summary = import_stations_from_csv(args.coords)
        print(
            "stations_seen={0} stations_created={1} stations_updated={2} "
            "low_confidence={3}".format(
                summary.stations_seen,
                summary.stations_created,
                summary.stations_updated,
                ",".join(summary.low_confidence_station_ids) or "-",
            )
        )
        return 0

    summary = replay_observations_from_csv(
        coords_path=args.coords,
        observations_path=args.observations,
        max_observations=args.max_observations,
    )
    print(
        "stations_imported={0} rows_seen={1} observations_processed={2} "
        "persisted_verdicts={3} meaningful_stations={4} low_confidence={5}".format(
            summary.stations_imported,
            summary.rows_seen,
            summary.observations_processed,
            summary.persisted_verdicts,
            len(summary.meaningful_station_ids),
            ",".join(sorted(summary.low_confidence_station_ids)) or "-",
        )
    )
    return 0


def _new_station(metadata: StationMetadata) -> Station:
    station = Station(
        station_id=metadata.station_id,
        name=metadata.name,
        lat=metadata.lat,
        lon=metadata.lon,
        health="unknown",
        status=StationStatus.MONITOR.value,
        health_score=0.0,
        degradation=0.0,
        trend_per_day=0.0,
        days_to_threshold=None,
        high_conf_alerts=0,
        alert_rate_pct=0.0,
        rate_vs_network=1.0,
        last_seen=INITIAL_LAST_SEEN,
    )
    if metadata.data_quality == LOW_CONFIDENCE:
        _mark_low_confidence(station)
    return station


def _mark_low_confidence(station: Station) -> None:
    station.health = LOW_CONFIDENCE
    station.status = StationStatus.MONITOR.value
    station.health_score = 0.0
    station.degradation = 0.0


def _reading_from_row(row: dict[str, str]) -> WeatherReading | None:
    timestamp = _timestamp(row.get("timestamp"))
    if timestamp is None:
        return None

    values = {
        "T": _optional_float(row.get("T")),
        "P": _optional_float(row.get("P")),
        "RH": _optional_float(row.get("RH")),
    }
    if all(value is None for value in values.values()):
        return None

    return WeatherReading(
        station_id=str(row["station_id"]).strip(),
        timestamp=timestamp,
        T=values["T"],
        P=values["P"],
        RH=values["RH"],
        flag=1 if str(row.get("noaa_bad", "")).strip().lower() == "true" else 0,
        amp_ratio_P=None,
    )


def _timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _optional_float(value: str | None) -> float | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if normalized == "" or normalized.lower() in {"nan", "none", "null", "na", "n/a"}:
        return None
    try:
        number = float(normalized)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _normalize_data_quality(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized == LOW_CONFIDENCE:
        return LOW_CONFIDENCE
    if normalized == GOOD_QUALITY:
        return GOOD_QUALITY
    return UNKNOWN_QUALITY if normalized else GOOD_QUALITY
