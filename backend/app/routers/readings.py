from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas import AnomalyVerdict, WeatherReading
from app.services.anomaly_detector import AnomalyDetector, get_anomaly_detector
from app.services import alert_service, reading_service, station_service

router = APIRouter(prefix="/readings", tags=["readings"])


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
