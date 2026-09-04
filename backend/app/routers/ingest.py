from fastapi import APIRouter, Depends, status

from app.schemas import AnomalyVerdict, WeatherReading
from app.services.anomaly_detector import AnomalyDetector, get_anomaly_detector

router = APIRouter(tags=["ingest"])


@router.post("/ingest", response_model=AnomalyVerdict, status_code=status.HTTP_200_OK)
def ingest_reading(
    reading: WeatherReading,
    detector: AnomalyDetector = Depends(get_anomaly_detector),
) -> AnomalyVerdict:
    return detector.evaluate(reading)
