from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.db.database import SessionLocal
from app.db.models import AnomalyVerdict as AnomalyVerdictModel
from app.schemas import AnomalyReason, AnomalyVerdictRecord


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


def _to_verdict_record(verdict: AnomalyVerdictModel) -> AnomalyVerdictRecord:
    return AnomalyVerdictRecord(
        id=verdict.id,
        station_id=verdict.station_id,
        reading_id=verdict.reading_id,
        flag=1 if verdict.flag else 0,
        reason=_reason(verdict.reason),
        severity=_severity(verdict.severity),
        confidence=verdict.confidence,
        degradation=verdict.degradation,
        evidence=_evidence(verdict.evidence),
        created_at=_as_utc(verdict.created_at),
    )


def list_verdicts() -> list[AnomalyVerdictRecord]:
    with SessionLocal() as db:
        verdicts = db.scalars(
            select(AnomalyVerdictModel).order_by(AnomalyVerdictModel.created_at)
        ).all()
        return [_to_verdict_record(verdict) for verdict in verdicts]


def get_verdict(verdict_id: int) -> AnomalyVerdictRecord | None:
    with SessionLocal() as db:
        verdict = db.get(AnomalyVerdictModel, verdict_id)
        if verdict is None:
            return None

        return _to_verdict_record(verdict)


def list_verdicts_for_station(station_id: str) -> list[AnomalyVerdictRecord]:
    with SessionLocal() as db:
        verdicts = db.scalars(
            select(AnomalyVerdictModel)
            .where(AnomalyVerdictModel.station_id == station_id)
            .order_by(AnomalyVerdictModel.created_at)
        ).all()
        return [_to_verdict_record(verdict) for verdict in verdicts]
