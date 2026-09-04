from fastapi import APIRouter, HTTPException, status

from app.schemas import Alert, AlertStatusUpdate
from app.services import alert_service, station_service

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[Alert], status_code=status.HTTP_200_OK)
def list_alerts() -> list[Alert]:
    return alert_service.list_alerts()


@router.get("/alerts/{alert_id}", response_model=Alert, status_code=status.HTTP_200_OK)
def get_alert(alert_id: int) -> Alert:
    alert = alert_service.get_alert(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert '{alert_id}' was not found.",
        )

    return alert


@router.patch(
    "/alerts/{alert_id}/status",
    response_model=Alert,
    status_code=status.HTTP_200_OK,
)
def update_alert_status(alert_id: int, payload: AlertStatusUpdate) -> Alert:
    alert = alert_service.update_alert_status(alert_id, payload.status)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert '{alert_id}' was not found.",
        )

    return alert


@router.get(
    "/stations/{station_id}/alerts",
    response_model=list[Alert],
    status_code=status.HTTP_200_OK,
)
def list_station_alerts(station_id: str) -> list[Alert]:
    if not station_service.station_exists(station_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' was not found.",
        )

    return alert_service.list_alerts_for_station(station_id)
