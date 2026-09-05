from datetime import datetime, timezone
import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import IS_SQLITE, SessionLocal
from app.db.models import Alert as AlertModel
from app.db.models import AnomalyVerdict as AnomalyVerdictModel
from app.db.models import WeatherReading as WeatherReadingModel
from app.schemas import Alert, AlertStatus, AnomalyReason, AnomalyVerdict, WeatherReading
from app.services import station_service


_REASON_VALUES = {reason.value for reason in AnomalyReason}
_SEVERITY_MAP = {
    "low": 0.25,
    "medium": 0.5,
    "high": 0.75,
    "critical": 1.0,
}


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value


def _as_db_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc) if not IS_SQLITE else value

    utc_value = value.astimezone(timezone.utc)
    return utc_value.replace(tzinfo=None) if IS_SQLITE else utc_value


def _reason(value: str) -> AnomalyReason:
    normalized = value.strip().lower()
    if normalized in _REASON_VALUES:
        return AnomalyReason(normalized)

    return AnomalyReason.UNCLASSIFIED


def _severity(value: str | float | int | None) -> float:
    if value is None:
        return 0.0

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in _SEVERITY_MAP:
            return _SEVERITY_MAP[normalized]
        try:
            return max(min(float(normalized), 1.0), 0.0)
        except ValueError:
            return 0.0

    return max(min(float(value), 1.0), 0.0)


def _evidence(value: Any) -> list[list[Any]]:
    if isinstance(value, list):
        return [item if isinstance(item, list) else [str(index), item] for index, item in enumerate(value)]
    if isinstance(value, dict):
        return [[key, item] for key, item in value.items()]

    return []


def _reading_signature(reading: WeatherReading) -> str:
    payload: dict[str, Any] = {
        "station_id": reading.station_id,
        "timestamp": _as_db_datetime(reading.timestamp).isoformat(),
        "T": reading.T,
        "P": reading.P,
        "RH": reading.RH,
        "flag": reading.flag,
        "amp_ratio_P": reading.amp_ratio_P,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _to_anomaly_verdict(verdict: AnomalyVerdictModel) -> AnomalyVerdict:
    return AnomalyVerdict(
        flag=1 if verdict.flag else 0,
        reason=_reason(verdict.reason),
        severity=_severity(verdict.severity),
        confidence=verdict.confidence,
        degradation=verdict.degradation,
        evidence=_evidence(verdict.evidence),
    )


def _to_alert(alert: AlertModel) -> Alert:
    verdict = alert.anomaly_verdict
    return Alert(
        id=alert.id,
        station_id=alert.station_id,
        reading_id=alert.reading_id,
        anomaly_verdict_id=alert.anomaly_verdict_id,
        severity=_severity(alert.severity),
        message=_reason(alert.message).value,
        status=alert.status,
        confidence=verdict.confidence if verdict else 0.0,
        degradation=verdict.degradation if verdict else 0.0,
        evidence=_evidence(verdict.evidence if verdict else []),
        created_at=_as_utc(alert.created_at),
        resolved_at=_as_utc(alert.resolved_at) if alert.resolved_at else None,
    )


def _find_matching_reading(
    db: Session,
    reading: WeatherReading,
) -> WeatherReadingModel | None:
    return db.scalars(
        select(WeatherReadingModel)
        .where(WeatherReadingModel.station_id == reading.station_id)
        .where(WeatherReadingModel.recorded_at == _as_db_datetime(reading.timestamp))
        .where(WeatherReadingModel.temperature_c == reading.T)
        .where(WeatherReadingModel.humidity_pct == reading.RH)
        .where(WeatherReadingModel.pressure_hpa == reading.P)
        .where(WeatherReadingModel.flag == reading.flag)
        .where(WeatherReadingModel.amp_ratio_p == reading.amp_ratio_P)
        .order_by(WeatherReadingModel.id)
    ).first()


def _get_or_create_reading(db: Session, reading: WeatherReading) -> WeatherReadingModel:
    db_reading = _find_matching_reading(db, reading)
    if db_reading is not None:
        return db_reading

    db_reading = WeatherReadingModel(
        station_id=reading.station_id,
        recorded_at=_as_db_datetime(reading.timestamp),
        temperature_c=reading.T,
        pressure_hpa=reading.P,
        humidity_pct=reading.RH,
        flag=reading.flag,
        amp_ratio_p=reading.amp_ratio_P,
    )
    db.add(db_reading)
    db.flush()
    return db_reading


def save_verdict_and_create_alert(
    reading: WeatherReading,
    verdict: AnomalyVerdict,
) -> AnomalyVerdict:
    signature = _reading_signature(reading)

    with SessionLocal() as db:
        existing_verdict = db.scalar(
            select(AnomalyVerdictModel).where(
                AnomalyVerdictModel.reading_signature == signature
            )
        )
        if existing_verdict is not None:
            existing_contract_verdict = _to_anomaly_verdict(existing_verdict)
            station_service.update_station_from_verdict(
                reading.station_id,
                reading.timestamp,
                existing_contract_verdict.flag,
                existing_contract_verdict.reason,
                existing_contract_verdict.severity,
                existing_contract_verdict.degradation,
                db,
            )
            db.commit()
            return existing_contract_verdict

        db_reading = _get_or_create_reading(db, reading)
        db_verdict = AnomalyVerdictModel(
            station_id=reading.station_id,
            reading_id=db_reading.id,
            reading_signature=signature,
            flag=bool(verdict.flag),
            reason=verdict.reason.value,
            severity=str(verdict.severity),
            confidence=verdict.confidence,
            degradation=verdict.degradation,
            evidence=verdict.evidence,
        )
        db.add(db_verdict)
        db.flush()

        if verdict.flag == 1:
            db.add(
                AlertModel(
                    station_id=reading.station_id,
                    reading_id=db_reading.id,
                    anomaly_verdict_id=db_verdict.id,
                    severity=str(verdict.severity),
                    message=verdict.reason.value,
                    status=AlertStatus.OPEN.value,
                )
            )

        station_service.update_station_from_verdict(
            reading.station_id,
            reading.timestamp,
            verdict.flag,
            verdict.reason,
            verdict.severity,
            verdict.degradation,
            db,
        )
        db.commit()
        db.refresh(db_verdict)
        return _to_anomaly_verdict(db_verdict)


def list_alerts() -> list[Alert]:
    with SessionLocal() as db:
        alerts = db.scalars(select(AlertModel).order_by(AlertModel.created_at)).all()
        return [_to_alert(alert) for alert in alerts]


def get_alert(alert_id: int) -> Alert | None:
    with SessionLocal() as db:
        alert = db.get(AlertModel, alert_id)
        if alert is None:
            return None

        return _to_alert(alert)


def list_alerts_for_station(station_id: str) -> list[Alert]:
    with SessionLocal() as db:
        alerts = db.scalars(
            select(AlertModel)
            .where(AlertModel.station_id == station_id)
            .order_by(AlertModel.created_at)
        ).all()
        return [_to_alert(alert) for alert in alerts]


def update_alert_status(alert_id: int, status: AlertStatus) -> Alert | None:
    with SessionLocal() as db:
        alert = db.get(AlertModel, alert_id)
        if alert is None:
            return None

        alert.status = status.value
        alert.resolved_at = datetime.now(timezone.utc) if status == AlertStatus.RESOLVED else None
        db.commit()
        db.refresh(alert)
        return _to_alert(alert)

