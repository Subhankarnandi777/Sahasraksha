from datetime import datetime, timezone
import hashlib
import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.db.database import IS_SQLITE, SessionLocal
from app.db.models import Alert as AlertModel
from app.db.models import AnomalyVerdict as AnomalyVerdictModel
from app.db.models import WeatherReading as WeatherReadingModel
from app.schemas import Alert, AlertStatus, AnomalyReason, AnomalyVerdict, WeatherReading
from app.services import llm_service, station_service, work_order_service

# Alerts at or above this severity get a work order created for them
# automatically -- matching _recommended_action_for_alert's own HIGH/
# CRITICAL "priority service" line in work_order_service.py. Below this,
# a station just showing early/moderate drift doesn't need a technician
# dispatched on its own; a human still triages it from the alerts list.
AUTO_WORK_ORDER_SEVERITY = 0.7


_REASON_VALUES = {reason.value for reason in AnomalyReason}
_STATUS_VALUES = {status.value for status in AlertStatus}
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

def _status(value: str) -> AlertStatus:
    normalized = (value or "").strip().lower()
    if normalized in _STATUS_VALUES:
        return AlertStatus(normalized)

    return AlertStatus.OPEN


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


def _station_display_name(station_id: str) -> str:
    station = station_service.get_station(station_id)
    return station.name if station is not None else station_id


def _to_alert(alert: AlertModel) -> Alert:
    verdict = alert.anomaly_verdict
    return Alert(
        id=alert.id,
        station_id=alert.station_id,
        reading_id=alert.reading_id,
        anomaly_verdict_id=alert.anomaly_verdict_id,
        severity=_severity(alert.severity),
        message=_reason(alert.message).value,
        explanation=alert.explanation,
        status=_status(alert.status),
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


def _resolve_open_alerts(db: Session, station_id: str, resolved_at: datetime) -> None:
    """Close any standing open alert(s) for a station once a fresh
    detector verdict reports it clean (flag=0) again.

    Without this, the FIRST alert a station ever received stayed open
    forever -- nothing in the app auto-resolves alerts, only a manual
    PATCH /alerts/{id}/status does. The open-alert dedup in
    save_verdict_and_create_alert (a new alert is only created when none
    is already open for that station) then silently swallowed every
    later, possibly more severe, real detection for that same station.
    Confirmed live: 60 of 60 stations held an open alert and the "Real-
    Time Anomaly Cadence" chart showed zero new alerts for 6 straight
    hours despite the live keepalive feed actively ticking every station.

    This does not touch station.degradation/status -- accumulated wear is
    a separate, intentionally non-self-healing signal (see
    station_service.update_station_from_verdict's monotonic-degradation
    contract). A standing work order, not an open alert, is what tracks
    "this station still needs a technician" once its live readings have
    returned to normal.
    """
    open_alerts = db.scalars(
        select(AlertModel)
        .where(AlertModel.station_id == station_id)
        .where(AlertModel.status == AlertStatus.OPEN.value)
    ).all()
    for alert in open_alerts:
        alert.status = AlertStatus.RESOLVED.value
        alert.resolved_at = _as_db_datetime(resolved_at)


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
    force_new_alert: bool = False,
) -> AnomalyVerdict:
    """force_new_alert bypasses the open-alert dedup below, always
    creating a fresh alert (after resolving any alert already open for
    this station) regardless of what's currently open. This exists for
    the /demo/inject-anomaly endpoint: a judge explicitly triggering a
    demo injection should always visibly produce a new alert, not
    silently do nothing because that station already had one open from
    hours or days ago (which, before this option existed, was the normal
    case for effectively the whole fleet -- see _resolve_open_alerts)."""
    signature = _reading_signature(reading)

    with SessionLocal() as db:
        existing_verdict = db.scalar(
            select(AnomalyVerdictModel).where(
                AnomalyVerdictModel.reading_signature == signature
            )
        )
        if existing_verdict is not None:
            existing_contract_verdict = _to_anomaly_verdict(existing_verdict)
            if existing_contract_verdict.flag == 0:
                _resolve_open_alerts(db, reading.station_id, reading.timestamp)
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

        created_alert_id: int | None = None

        if verdict.flag == 1:
            if force_new_alert:
                _resolve_open_alerts(db, reading.station_id, reading.timestamp)
                existing_open_alert = None
            else:
                existing_open_alert = db.scalar(
                    select(AlertModel)
                    .where(AlertModel.station_id == reading.station_id)
                    .where(AlertModel.status == AlertStatus.OPEN.value)
                )
            if existing_open_alert is None:
                explanation = llm_service.narrate_evidence(
                    station_name=_station_display_name(reading.station_id),
                    reason=verdict.reason.value,
                    severity=verdict.severity,
                    degradation=verdict.degradation,
                    evidence=verdict.evidence,
                )
                new_alert = AlertModel(
                    station_id=reading.station_id,
                    reading_id=db_reading.id,
                    anomaly_verdict_id=db_verdict.id,
                    severity=str(verdict.severity),
                    message=verdict.reason.value,
                    explanation=explanation,
                    status=AlertStatus.OPEN.value,
                )
                db.add(new_alert)
                db.flush()
                created_alert_id = new_alert.id
        else:
            _resolve_open_alerts(db, reading.station_id, reading.timestamp)

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
        result = _to_anomaly_verdict(db_verdict)

    # Runs in its own session, after the alert above is committed and
    # visible -- work_order_service.create_work_order_for_alert opens a
    # fresh SessionLocal() internally, which would not see an
    # uncommitted row from the transaction above.
    if created_alert_id is not None and _severity(verdict.severity) >= AUTO_WORK_ORDER_SEVERITY:
        try:
            work_order_service.create_work_order_for_alert(created_alert_id)
        except work_order_service.WorkOrderAlreadyExistsError:
            pass

    return result


def count_open_alerts() -> int:
    """Cheap count for /health -- avoids loading and converting every alert
    row (each of which previously also triggered a lazy-loaded verdict
    query) just to count how many are open."""
    with SessionLocal() as db:
        return db.scalar(
            select(func.count()).select_from(AlertModel).where(AlertModel.status == "open")
        ) or 0


def list_alerts() -> list[Alert]:
    # _to_alert() reads alert.anomaly_verdict for every row. Without eager
    # loading, SQLAlchemy's default lazy load fires one extra SELECT PER
    # ALERT -- a real N+1 that gets slower every day the keepalive service
    # adds more rows to this table. joinedload folds it into the same query.
    with SessionLocal() as db:
        alerts = db.scalars(
            select(AlertModel)
            .options(joinedload(AlertModel.anomaly_verdict))
            .order_by(AlertModel.created_at)
        ).all()
        return [_to_alert(alert) for alert in alerts]


def get_alert(alert_id: int) -> Alert | None:
    with SessionLocal() as db:
        alert = db.get(AlertModel, alert_id, options=[joinedload(AlertModel.anomaly_verdict)])
        if alert is None:
            return None

        return _to_alert(alert)


def list_open_alerts() -> list[Alert]:
    """Like list_alerts(), but filtered to OPEN at the database level. The
    chatbot's context snapshot needs the currently-open alerts on every
    turn -- filtering in SQL keeps that cheap regardless of how large the
    historical `alerts` table grows (list_alerts() loads every row ever
    created, which is fine for the /alerts page's one-shot fetch but would
    be a real N+1-scale cost if re-run on every chat message)."""
    with SessionLocal() as db:
        alerts = db.scalars(
            select(AlertModel)
            .options(joinedload(AlertModel.anomaly_verdict))
            .where(AlertModel.status == AlertStatus.OPEN.value)
            .order_by(AlertModel.created_at.desc())
        ).all()
        return [_to_alert(alert) for alert in alerts]


def list_alerts_for_station(station_id: str) -> list[Alert]:
    with SessionLocal() as db:
        alerts = db.scalars(
            select(AlertModel)
            .options(joinedload(AlertModel.anomaly_verdict))
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

def resolve_all_open_alerts() -> int:
    """One-off cleanup: bulk-resolve every currently open alert. Needed
    once, right after the per-station dedup fix lands, to clear the
    backlog the un-deduped keepalive fault injection built up."""
    with SessionLocal() as db:
        result = db.execute(
            AlertModel.__table__.update()
            .where(AlertModel.status == AlertStatus.OPEN.value)
            .values(status=AlertStatus.RESOLVED.value, resolved_at=_as_db_datetime(datetime.now(timezone.utc)))
        )
        db.commit()
        return result.rowcount

