from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AnomalyReason(str, Enum):
    OK = "ok"
    RANGE = "range"
    STEP = "step"
    FROZEN = "frozen"
    MISSING = "missing"
    DRIFT = "drift"
    DEGRADING = "degrading"
    ANOMALY = "anomaly"
    UNCLASSIFIED = "unclassified"


class AnomalyVerdict(BaseModel):
    flag: int = Field(..., ge=0, le=1, examples=[1])
    reason: AnomalyReason = Field(..., examples=[AnomalyReason.DEGRADING])
    severity: float = Field(..., ge=0.0, le=1.0, examples=[0.734])
    confidence: float = Field(..., ge=0.0, le=1.0, examples=[0.83])
    degradation: float = Field(..., ge=0.0, le=1.0, examples=[0.512])
    evidence: list[list[Any]] = Field(
        default_factory=list,
        examples=[[ ["spatial_z_P", 6.2], ["cusum_P", 14.1], ["tide_loss", 0.51] ]],
    )


class AnomalyVerdictRecord(AnomalyVerdict):
    id: int = Field(..., examples=[1])
    station_id: str = Field(..., min_length=1, examples=["AWS_PNQ"])
    reading_id: int = Field(..., examples=[12])
    created_at: datetime
