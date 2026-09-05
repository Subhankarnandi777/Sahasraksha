from fastapi import APIRouter, Depends, status

from app.schemas import AnomalyVerdict, WeatherReading
from app.services.anomaly_detector import AnomalyDetector, get_anomaly_detector
from app.services import alert_service, station_service

router = APIRouter(tags=["ingest"])


@router.post("/ingest", response_model=AnomalyVerdict, status_code=status.HTTP_200_OK)
def ingest_reading(
    reading: WeatherReading,
    detector: AnomalyDetector = Depends(get_anomaly_detector),
) -> AnomalyVerdict:
    verdict = detector.evaluate(reading)
    if not station_service.station_exists(reading.station_id):
        return verdict

    return alert_service.save_verdict_and_create_alert(reading, verdict)
