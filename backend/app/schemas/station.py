from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class StationStatus(str, Enum):
    SERVICE_NOW = "SERVICE NOW"
    SCHEDULE = "SCHEDULE"
    MONITOR = "MONITOR"
    OK = "OK"


class StationSummary(BaseModel):
    station_id: str = Field(..., min_length=1, examples=["AWS_PNQ"])
    name: str = Field(..., min_length=1, examples=["Pune"])
    lat: float = Field(..., ge=-90.0, le=90.0, examples=[18.52])
    lon: float = Field(..., ge=-180.0, le=180.0, examples=[73.86])
    health: float = Field(..., ge=0.0, le=1.0, examples=[0.912])
    status: StationStatus = Field(..., examples=[StationStatus.MONITOR])
    degradation: float = Field(..., ge=0.0, le=1.0, examples=[0.088])
    trend_per_day: float = Field(..., examples=[0.00123])
    days_to_threshold: int | None = Field(None, ge=0, examples=[88])
    high_conf_alerts: int = Field(..., ge=0, examples=[412])
    alert_rate_pct: float = Field(..., ge=0.0, examples=[2.35])
    rate_vs_network: float = Field(..., ge=0.0, examples=[1.8])
    last_seen: datetime


class StationOverview(BaseModel):
    station: StationSummary
    reading_count: int = Field(..., ge=0, examples=[12])
    verdict_count: int = Field(..., ge=0, examples=[5])
    flagged_verdict_count: int = Field(..., ge=0, examples=[2])
    open_alert_count: int = Field(..., ge=0, examples=[1])
    resolved_alert_count: int = Field(..., ge=0, examples=[1])
    active_work_order_count: int = Field(..., ge=0, examples=[1])
    completed_work_order_count: int = Field(..., ge=0, examples=[0])
