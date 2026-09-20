from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AlertStatus(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"


class Alert(BaseModel):
    id: int = Field(..., examples=[1])
    station_id: str = Field(..., min_length=1, examples=["AWS_PNQ"])
    reading_id: int = Field(..., examples=[12])
    anomaly_verdict_id: int = Field(..., examples=[7])
    severity: float = Field(..., ge=0.0, le=1.0, examples=[0.734])
    message: str = Field(..., min_length=1, examples=["degrading"])
    explanation: str | None = Field(
        None,
        examples=["AWS_PNQ's pressure sensor jumped 9.2 hPa in one reading -- far outside a normal step, and no neighbour station saw anything similar."],
    )
    status: AlertStatus = Field(..., examples=[AlertStatus.OPEN])
    confidence: float = Field(..., ge=0.0, le=1.0, examples=[0.83])
    degradation: float = Field(..., ge=0.0, le=1.0, examples=[0.512])
    evidence: list[list[Any]] = Field(default_factory=list)
    created_at: datetime
    resolved_at: datetime | None = None


class AlertStatusUpdate(BaseModel):
    status: AlertStatus = Field(..., examples=[AlertStatus.RESOLVED])
