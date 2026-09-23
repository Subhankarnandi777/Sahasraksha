from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal
from app.db.models import Alert as AlertModel
from app.db.models import WorkOrder as WorkOrderModel
from app.schemas import WorkOrder, WorkOrderPriority, WorkOrderStatus


def count_active_work_orders() -> int:
    """Cheap count for /health -- avoids loading and converting every
    work-order row just to count how many aren't COMPLETED."""
    with SessionLocal() as db:
        return db.scalar(
            select(func.count())
            .select_from(WorkOrderModel)
            .where(WorkOrderModel.status != WorkOrderStatus.COMPLETED.value)
        ) or 0


def count_stations_with_active_work_orders() -> int:
    """Distinct stations with at least one open work order. One station can
    hold several -- each high-severity alert raises its own, and a
    chronically degraded station keeps them open after the alert clears
    (live on 2026-09-23: 8 open orders across 4 stations, 4 of them at
    Sagar) -- so the dashboard shows both numbers instead of letting the
    order count read as a station count."""
    with SessionLocal() as db:
        return db.scalar(
            select(func.count(func.distinct(WorkOrderModel.station_id)))
            .where(WorkOrderModel.status != WorkOrderStatus.COMPLETED.value)
        ) or 0


class WorkOrderAlreadyExistsError(Exception):
    pass


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


def _to_work_order(work_order: WorkOrderModel) -> WorkOrder:
    return WorkOrder(
        id=work_order.id,
        station_id=work_order.station_id,
        alert_id=work_order.alert_id,
        priority=work_order.priority,
        recommended_action=work_order.recommended_action,
        status=work_order.status,
        created_at=_as_utc(work_order.created_at),
        updated_at=_as_utc(work_order.updated_at),
        completed_at=_as_utc(work_order.completed_at) if work_order.completed_at else None,
    )


def _severity_score(value: str | None) -> float:
    if value is None:
        return 0.0

    normalized = value.strip().lower()
    if normalized in _SEVERITY_MAP:
        return _SEVERITY_MAP[normalized]

    try:
        return max(min(float(normalized), 1.0), 0.0)
    except ValueError:
        return 0.0


def _priority_for_alert(alert: AlertModel) -> WorkOrderPriority:
    severity = _severity_score(alert.severity)
    if severity >= 0.9:
        return WorkOrderPriority.CRITICAL
    if severity >= 0.7:
        return WorkOrderPriority.HIGH
    if severity >= 0.4:
        return WorkOrderPriority.MEDIUM

    return WorkOrderPriority.LOW


def _recommended_action_for_alert(alert: AlertModel) -> str:
    priority = _priority_for_alert(alert)
    if priority in {WorkOrderPriority.HIGH, WorkOrderPriority.CRITICAL}:
        return "Inspect station sensors and perform priority service if the alert is confirmed."

    return "Inspect station sensors and confirm the alert condition."


def create_work_order_for_alert(alert_id: int) -> WorkOrder | None:
    with SessionLocal() as db:
        alert = db.get(AlertModel, alert_id)
        if alert is None:
            return None

        existing_work_order = db.scalar(
            select(WorkOrderModel).where(WorkOrderModel.alert_id == alert_id)
        )
        if existing_work_order is not None:
            raise WorkOrderAlreadyExistsError

        work_order = WorkOrderModel(
            station_id=alert.station_id,
            alert_id=alert.id,
            priority=_priority_for_alert(alert).value,
            recommended_action=_recommended_action_for_alert(alert),
            status=WorkOrderStatus.OPEN.value,
        )
        db.add(work_order)

        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise WorkOrderAlreadyExistsError from exc

        db.refresh(work_order)
        return _to_work_order(work_order)


def list_work_orders() -> list[WorkOrder]:
    with SessionLocal() as db:
        work_orders = db.scalars(select(WorkOrderModel).order_by(WorkOrderModel.created_at)).all()
        return [_to_work_order(work_order) for work_order in work_orders]


def get_work_order(work_order_id: int) -> WorkOrder | None:
    with SessionLocal() as db:
        work_order = db.get(WorkOrderModel, work_order_id)
        if work_order is None:
            return None

        return _to_work_order(work_order)


def update_work_order_status(
    work_order_id: int,
    status: WorkOrderStatus,
) -> WorkOrder | None:
    with SessionLocal() as db:
        work_order = db.get(WorkOrderModel, work_order_id)
        if work_order is None:
            return None

        now = datetime.now(timezone.utc)
        work_order.status = status.value
        work_order.updated_at = now
        work_order.completed_at = now if status == WorkOrderStatus.COMPLETED else None

        db.commit()
        db.refresh(work_order)
        return _to_work_order(work_order)
