from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.schemas import AnomalyVerdict, TimeSeriesRow, WeatherReading
from app.services.anomaly_detector import AnomalyDetector, get_anomaly_detector
from app.services import alert_service, reading_service, station_service

router = APIRouter(prefix="/readings", tags=["readings"])


@router.get(
    "/network/timeseries",
    response_model=list[TimeSeriesRow],
    status_code=status.HTTP_200_OK,
)
def list_network_timeseries(
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
) -> list[TimeSeriesRow]:
    """Hourly median across the whole network.

    Backs the dashboard's "Ambient Network Temperature Oscillation" chart,
    which is network-wide by name and now by behaviour too -- see
    reading_service.list_network_timeseries for why the median matters.
    """
    return reading_service.list_network_timeseries(from_, to)


@router.post("", response_model=WeatherReading, status_code=status.HTTP_201_CREATED)
def create_reading(reading: WeatherReading) -> WeatherReading:
    if not station_service.station_exists(reading.station_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{reading.station_id}' was not found.",
        )

    created_reading = reading_service.add_reading(reading)
    station_service.update_last_seen(reading.station_id, reading.timestamp)
    return created_reading


@router.post(
    "/verdict",
    response_model=AnomalyVerdict,
    status_code=status.HTTP_200_OK,
)
def create_reading_verdict(
    reading: WeatherReading,
    detector: AnomalyDetector = Depends(get_anomaly_detector),
) -> AnomalyVerdict:
    if not station_service.station_exists(reading.station_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{reading.station_id}' was not found.",
        )

    verdict = detector.evaluate(reading)
    return alert_service.save_verdict_and_create_alert(reading, verdict)
