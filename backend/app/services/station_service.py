from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import IS_SQLITE, SessionLocal
from app.db.models import Alert, AnomalyVerdict, Station, WeatherReading, WorkOrder
from app.schemas import AnomalyReason, StationOverview, StationStatus, StationSummary


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value

def _as_db_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc) if not IS_SQLITE else value

    utc_value = value.astimezone(timezone.utc)
    return utc_value.replace(tzinfo=None) if IS_SQLITE else utc_value

def _contract_status(status: str) -> StationStatus:
    normalized = status.strip().upper()
    if normalized in {item.value for item in StationStatus}:
        return StationStatus(normalized)

    legacy_status_map = {
        "ONLINE": StationStatus.OK,
        "GOOD": StationStatus.OK,
        "DEGRADED": StationStatus.MONITOR,
        "WARNING": StationStatus.MONITOR,
        "MAINTENANCE": StationStatus.SCHEDULE,
        "OFFLINE": StationStatus.SERVICE_NOW,
        "CRITICAL": StationStatus.SERVICE_NOW,
    }
    return legacy_status_map.get(normalized, StationStatus.MONITOR)


def _contract_degradation(value: float) -> float:
    if value > 1.0:
        return min(value / 100.0, 1.0)

    return max(value, 0.0)


def _contract_health(station: Station, data_quality: str = "good") -> float | None:
    if data_quality == "low_confidence":
        return None

    if station.health_score is not None:
        return max(min(station.health_score, 1.0), 0.0)

    return max(1.0 - _contract_degradation(station.degradation), 0.0)


def _severity(value: float | int | str | None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0

    return max(min(number, 1.0), 0.0)


def _status_from_verdict(flag: int, reason: AnomalyReason, severity: float, degradation: float) -> StationStatus:
    if flag == 0 and severity < 0.5 and degradation < 0.45:
        return StationStatus.OK
    if degradation >= 0.45 or severity >= 0.8:
        return StationStatus.SERVICE_NOW
    if reason == AnomalyReason.DEGRADING or degradation >= 0.2:
        return StationStatus.SCHEDULE

    return StationStatus.MONITOR


def _to_station_summary(station: Station) -> StationSummary:
    degradation = _contract_degradation(station.degradation)
    data_quality = _station_data_quality(station.station_id)
    return StationSummary(
        station_id=station.station_id,
        name=station.name or station.station_id,
        lat=station.lat if station.lat is not None else 0.0,
        lon=station.lon if station.lon is not None else 0.0,
        health=_contract_health(station, data_quality),
        status=_contract_status(station.status),
        degradation=degradation,
        trend_per_day=station.trend_per_day or 0.0,
        days_to_threshold=station.days_to_threshold,
        high_conf_alerts=station.high_conf_alerts or 0,
        alert_rate_pct=station.alert_rate_pct,
        rate_vs_network=station.rate_vs_network or 1.0,
        last_seen=_as_utc(station.last_seen),
        data_quality=data_quality,
    )


def _station_data_quality(station_id: str) -> str:
    try:
        from app.services.csv_replay_service import station_data_quality
    except Exception:
        return "good"

    try:
        return station_data_quality(station_id)
    except Exception:
        return "good"


def _get_station_model(db: Session, station_id: str) -> Station | None:
    return db.get(Station, station_id)


def list_stations() -> list[StationSummary]:
    with SessionLocal() as db:
        stations = db.scalars(select(Station).order_by(Station.station_id)).all()
        return [_to_station_summary(station) for station in stations]


def get_station(station_id: str) -> StationSummary | None:
    with SessionLocal() as db:
        station = _get_station_model(db, station_id)
        if station is None:
            return None

        return _to_station_summary(station)


def get_station_overview(station_id: str) -> StationOverview | None:
    with SessionLocal() as db:
        station = _get_station_model(db, station_id)
        if station is None:
            return None

        reading_count = db.scalar(
            select(func.count()).select_from(WeatherReading).where(
                WeatherReading.station_id == station_id
            )
        )
        verdict_count = db.scalar(
            select(func.count()).select_from(AnomalyVerdict).where(
                AnomalyVerdict.station_id == station_id
            )
        )
        flagged_verdict_count = db.scalar(
            select(func.count()).select_from(AnomalyVerdict).where(
                AnomalyVerdict.station_id == station_id,
                AnomalyVerdict.flag.is_(True),
            )
        )
        open_alert_count = db.scalar(
            select(func.count()).select_from(Alert).where(
                Alert.station_id == station_id,
                Alert.status == "open",
            )
        )
        resolved_alert_count = db.scalar(
            select(func.count()).select_from(Alert).where(
                Alert.station_id == station_id,
                Alert.status == "resolved",
            )
        )
        active_work_order_count = db.scalar(
            select(func.count()).select_from(WorkOrder).where(
                WorkOrder.station_id == station_id,
                WorkOrder.status != "COMPLETED",
            )
        )
        completed_work_order_count = db.scalar(
            select(func.count()).select_from(WorkOrder).where(
                WorkOrder.station_id == station_id,
                WorkOrder.status == "COMPLETED",
            )
        )

        return StationOverview(
            station=_to_station_summary(station),
            reading_count=reading_count or 0,
            verdict_count=verdict_count or 0,
            flagged_verdict_count=flagged_verdict_count or 0,
            open_alert_count=open_alert_count or 0,
            resolved_alert_count=resolved_alert_count or 0,
            active_work_order_count=active_work_order_count or 0,
            completed_work_order_count=completed_work_order_count or 0,
        )


def station_exists(station_id: str) -> bool:
    with SessionLocal() as db:
        return _get_station_model(db, station_id) is not None


def update_last_seen(station_id: str, last_seen: datetime) -> None:
    with SessionLocal() as db:
        station = _get_station_model(db, station_id)
        if station is not None:
            station.last_seen = _as_db_datetime(last_seen)
            db.commit()


def update_station_from_verdict(
    station_id: str,
    reading_timestamp: datetime,
    flag: int,
    reason: AnomalyReason,
    severity: float,
    degradation: float,
    db: Session | None = None,
) -> bool:
    def apply_update(session: Session) -> bool:
        station = _get_station_model(session, station_id)
        if station is None:
            return False

        contract_degradation = _contract_degradation(degradation)
        station.health_score = max(1.0 - contract_degradation, 0.0)
        station.degradation = contract_degradation
        station.status = _status_from_verdict(
            flag,
            reason,
            _severity(severity),
            contract_degradation,
        ).value
        station.last_seen = _as_db_datetime(reading_timestamp)
        return True

    if db is not None:
        return apply_update(db)

    with SessionLocal() as session:
        updated = apply_update(session)
        if updated:
            session.commit()
        return updated


