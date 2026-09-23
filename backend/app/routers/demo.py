import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas import AnomalyVerdict, WeatherReading
from app.services.anomaly_detector import AnomalyDetector, get_anomaly_detector
from app.services import alert_service, station_service
from sahasraksha.stream import STEP_LIMITS

router = APIRouter(tags=["demo"])

_CHANNEL_BOUNDS = {"T": (-40.0, 55.0), "P": (850.0, 1080.0), "RH": (0.0, 100.0)}


def _clamp(value: float, channel: str) -> float:
    lo, hi = _CHANNEL_BOUNDS[channel]
    return max(lo, min(hi, value))


@router.post("/demo/inject-anomaly", response_model=AnomalyVerdict, status_code=status.HTTP_200_OK)
def inject_demo_anomaly(
    station_id: str | None = None,
    detector: AnomalyDetector = Depends(get_anomaly_detector),
) -> AnomalyVerdict:
    stations = station_service.list_stations()
    if not stations:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No stations available.")

    if station_id:
        target = next((s for s in stations if s.station_id == station_id), None)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Station '{station_id}' was not found.")
    else:
        # Low-confidence stations have their readings withheld, so the seed
        # below fell back to generic 25 C / 1005 hPa / 60% defaults and the
        # "fault" was measured against numbers that station never reported
        # -- for Bangalore, a ~90 hPa jump from its real pressure. Swami
        # Vivekananda has no archived data at all. Neither is a fair target.
        trusted = [s for s in stations if s.data_quality != "low_confidence"]
        healthy = [s for s in trusted if s.status == "OK"] or trusted or stations
        target = random.choice(healthy)

    seed = {
        "T": target.latest_temperature if target.latest_temperature is not None else 25.0,
        "P": target.latest_pressure if target.latest_pressure is not None else 1005.0,
        "RH": target.latest_humidity if target.latest_humidity is not None else 60.0,
    }
    channel = random.choice(["T", "P", "RH"])
    vals = dict(seed)
    lo, hi = _CHANNEL_BOUNDS[channel]
    base = vals[channel]
    direction = 1 if (hi - base) >= (base - lo) else -1
    margin = STEP_LIMITS[channel] * random.uniform(1.6, 2.2)
    vals[channel] = _clamp(base + direction * margin, channel)

    reading = WeatherReading(
        station_id=target.station_id,
        timestamp=datetime.now(timezone.utc),
        T=round(vals["T"], 2),
        P=round(vals["P"], 2),
        RH=round(vals["RH"], 2),
        flag=0,
    )

    verdict = detector.evaluate(reading)
    # force_new_alert=True: a judge explicitly clicking this button should
    # always see a fresh alert appear, regardless of whether the target
    # station already has one open from earlier real detection.
    return alert_service.save_verdict_and_create_alert(reading, verdict, force_new_alert=True)