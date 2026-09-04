from datetime import datetime
from pathlib import Path
import sys
from threading import Lock
from typing import Any, Protocol

from app.schemas import AnomalyReason, AnomalyVerdict, WeatherReading


ML_DIR = Path(__file__).resolve().parents[3] / "ml"
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from skyguard.stream import StreamingSkyGuard


class AnomalyDetector(Protocol):
    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        """Return an anomaly verdict for one raw weather observation."""


class MockAnomalyDetector:
    """Deterministic contract adapter for tests and local fallback scenarios."""

    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        if reading.T is None or reading.P is None or reading.RH is None:
            return AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.MISSING,
                severity=0.6,
                confidence=0.7,
                degradation=0.2,
                evidence=[["missing_required_signal", 1.0]],
            )

        if reading.T >= 45.0 or reading.T <= -20.0:
            return AnomalyVerdict(
                flag=1,
                reason=AnomalyReason.RANGE,
                severity=0.734,
                confidence=0.83,
                degradation=0.512,
                evidence=[
                    ["temperature_demo_threshold", reading.T],
                    ["amp_ratio_P", reading.amp_ratio_P if reading.amp_ratio_P is not None else 1.0],
                ],
            )

        return AnomalyVerdict(
            flag=0,
            reason=AnomalyReason.OK,
            severity=0.0,
            confidence=0.8,
            degradation=0.0,
            evidence=[["temporary_mock_detector", 0.0]],
        )


class SkyGuardAnomalyDetector:
    """Adapter from the repository's streaming ML engine to the API verdict."""

    def __init__(self) -> None:
        self._streams: dict[str, StreamingSkyGuard] = {}
        self._lock = Lock()

    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        with self._lock:
            stream = self._streams.get(reading.station_id)
            if stream is None:
                stream = StreamingSkyGuard({reading.station_id: self._initial_coeffs(reading)})
                self._streams[reading.station_id] = stream

            raw = stream.update(
                reading.station_id,
                self._local_solar_time(reading.timestamp),
                float(reading.timestamp.timetuple().tm_yday),
                {"T": reading.T, "P": reading.P, "RH": reading.RH},
            )

        return self._to_verdict(raw)

    @staticmethod
    def _initial_coeffs(reading: WeatherReading) -> dict[str, list[float]]:
        return {
            "T": _intercept_coeff(reading.T, 25.0),
            "P": _intercept_coeff(reading.P, 1013.0),
            "RH": _intercept_coeff(reading.RH, 50.0),
        }

    @staticmethod
    def _local_solar_time(timestamp: datetime) -> float:
        return timestamp.hour + timestamp.minute / 60.0 + timestamp.second / 3600.0

    @staticmethod
    def _to_verdict(raw: dict[str, Any]) -> AnomalyVerdict:
        reason = _reason(raw.get("reason"))
        severity = _clamp01(raw.get("severity", 0.0))
        degradation = _clamp01(raw.get("degradation", 0.0))
        confidence = _clamp01(raw.get("confidence", _confidence(reason, severity, degradation)))

        return AnomalyVerdict(
            flag=int(bool(raw.get("flag", 0))),
            reason=reason,
            severity=severity,
            confidence=confidence,
            degradation=degradation,
            evidence=_evidence_pairs(raw.get("evidence", [])),
        )


def _intercept_coeff(value: float | None, default: float) -> list[float]:
    coeffs = [0.0] * 11
    coeffs[0] = float(value) if value is not None else default
    return coeffs


def _reason(value: Any) -> AnomalyReason:
    try:
        return AnomalyReason(str(value))
    except ValueError:
        return AnomalyReason.UNCLASSIFIED


def _clamp01(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _confidence(reason: AnomalyReason, severity: float, degradation: float) -> float:
    if reason is AnomalyReason.OK:
        return round(max(0.5, 1.0 - severity), 3)
    return round(max(severity, degradation, 0.6), 3)


def _evidence_pairs(evidence: Any) -> list[list[Any]]:
    pairs: list[list[Any]] = []
    for item in evidence:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        key, value = item
        pairs.append([_evidence_key(str(key)), _evidence_value(value)])
    return pairs


def _evidence_key(key: str) -> str:
    if key.startswith("z_"):
        return f"spatial_{key}"
    if key.startswith("frozen_"):
        return key.replace("frozen_", "runlen_", 1)
    return key


def _evidence_value(value: Any) -> float:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return 0.0


_anomaly_detector: AnomalyDetector = SkyGuardAnomalyDetector()


def get_anomaly_detector() -> AnomalyDetector:
    return _anomaly_detector
