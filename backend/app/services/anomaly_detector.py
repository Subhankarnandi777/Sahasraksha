from typing import Protocol

from app.schemas import AnomalyReason, AnomalyVerdict, WeatherReading


class AnomalyDetector(Protocol):
    def evaluate(self, reading: WeatherReading) -> AnomalyVerdict:
        """Return an anomaly verdict for one raw weather observation."""


class MockAnomalyDetector:
    """Temporary deterministic contract adapter until the real ML engine is connected."""

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


_anomaly_detector: AnomalyDetector = MockAnomalyDetector()


def get_anomaly_detector() -> AnomalyDetector:
    return _anomaly_detector
